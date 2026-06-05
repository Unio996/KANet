// J1tn r344 (Bettor 13:16 钦定 + r362 J2 settler 94fe0b1 sync): cross-node sign_req listener
// for 4-of-5 settle, REWRITE per unified protocol envelope:
//   - Listen kanet_pool_oracle_tx_sign_req_v1 (was kanet_pool_sign_req_v1)
//   - Response broadcast (NOT DM) kanet_pool_oracle_tx_sign_resp_v1 with voter_pubkey
//
// Settler dispatchPhase2 sends DM (pool-market-settler.js L1163-1189):
//   {t:kanet_pool_oracle_tx_sign_req_v1, market_id, winner, unanimous,
//    silent_oracle_index, input_count, spine_input_count}
//
// Our response (broadcast on chain via chain_events + voter_pubkey for cross-node identity):
//   {t:kanet_pool_oracle_tx_sign_resp_v1, market_id, voter_pubkey, input_index,
//    winner, signature, epoch:1}
//
// Note: sign_req payload does NOT carry tx_hex bytes. Signer must have phase2_tx_obj in
// local pool_markets.metadata (= written by local dispatchPhase2). If not present, log
// warning + return (= voter cron will eventually pick up if/when local node re-derives
// phase2). This handler is the immediate trigger; voter daemon is the polling backstop.

import { sqlite } from '../db/client.js';
import { sendCommandAsync } from './relay-manager.js';
import { randomUUID } from 'node:crypto';

const HANDLER_REQ_TYPE = 'kanet_pool_oracle_tx_sign_req_v1';

/**
 * Detect if an inbound DM is a pool sign_req. Returns parsed payload OR null.
 */
export function detectPoolSignReq(contentText) {
  if (!contentText || typeof contentText !== 'string') return null;
  const trimmed = contentText.trim();
  if (!trimmed.startsWith('{')) return null;
  let payload;
  try { payload = JSON.parse(trimmed); } catch { return null; }
  if (payload?.t !== HANDLER_REQ_TYPE) return null;
  return payload;
}

/**
 * Handle a kanet_pool_oracle_tx_sign_req_v1 DM. Sign each spine input + emit broadcast
 * chain_events row (pool_oracle_tx_sig event_type, kanet_pool_oracle_tx_sign_resp_v1 payload).
 */
export async function handlePoolSignReq({ localAddress, remoteAddress, payload }) {
  // 1. Validate payload shape (J2 r361 settler-side schema)
  const required = ['market_id', 'winner', 'input_count', 'spine_input_count'];
  for (const f of required) {
    if (payload[f] === undefined || payload[f] === null) {
      console.warn(`[pool-sign-handler] reject ${payload.market_id?.slice(0, 12) || '?'}: missing field ${f}`);
      return { ok: false, reason: `missing field ${f}` };
    }
  }

  // 2. Resolve which of our local oracle relays owns localAddress
  const oracleRelay = sqlite.prepare(
    'SELECT id, name, address FROM relay_nodes WHERE address = ? AND is_oracle = 1'
  ).get(localAddress);
  if (!oracleRelay) {
    console.warn(`[pool-sign-handler] reject market=${payload.market_id?.slice(0, 12)}: no local is_oracle=1 relay matches address ${localAddress?.slice(-12)}`);
    return { ok: false, reason: 'no local oracle relay matches target address' };
  }

  // 3. Load market + phase2_tx_obj (needed to call sign_input_for_settle)
  const market = sqlite.prepare(
    'SELECT id, protocol_status, metadata FROM pool_markets WHERE id = ?'
  ).get(payload.market_id);
  if (!market) {
    console.warn(`[pool-sign-handler] reject market ${payload.market_id?.slice(0, 12)} not in local DB`);
    return { ok: false, reason: 'market not in local DB' };
  }
  let meta = {};
  try { meta = JSON.parse(market.metadata || '{}'); } catch {}
  if (!meta.phase2_tx_obj) {
    console.warn(`[pool-sign-handler] market ${market.id.slice(0, 12)} no phase2_tx_obj in local metadata — cross-node dispatchPhase2 hasn't materialized locally; voter cron will retry when local re-derive lands`);
    return { ok: false, reason: 'phase2_tx_obj not in local metadata (cross-node materialize pending)' };
  }

  // 4. Get voter_pubkey via relay IPC (= canonical cross-node identity)
  let voterPubkey;
  try {
    const pkRes = await sendCommandAsync(oracleRelay.id, { type: 'get_pubkey' });
    if (!pkRes?.x_only_pubkey) throw new Error(pkRes?.error || 'no x_only_pubkey');
    voterPubkey = String(pkRes.x_only_pubkey).toLowerCase();
  } catch (e) {
    console.warn(`[pool-sign-handler] get_pubkey fail relay=${oracleRelay.name}: ${e.message}`);
    return { ok: false, reason: `get_pubkey fail: ${e.message}` };
  }

  // 5. Sign each spine input via sign_input_for_settle IPC + INSERT chain_events
  //    (same pattern as voter daemon L505-555, broadcast envelope shape unified per 94fe0b1).
  const spineInputCount = Number(payload.spine_input_count) || 1;
  let signedAny = 0;
  for (let inputIdx = 0; inputIdx < spineInputCount; inputIdx++) {
    // Skip if already signed this input for this market (= idempotent re-DM safe)
    const existing = sqlite.prepare(`
      SELECT id FROM chain_events
      WHERE event_type = 'pool_oracle_tx_sig' AND from_address = ?
        AND payload LIKE ? AND payload LIKE ?
      LIMIT 1
    `).get(oracleRelay.address, `%"market_id":"${market.id}"%`, `%"input_index":${inputIdx}%`);
    if (existing) continue;

    let signResult;
    try {
      signResult = await sendCommandAsync(oracleRelay.id, {
        type: 'sign_input_for_settle',
        tx_hex: JSON.stringify(meta.phase2_tx_obj),
        input_index: inputIdx,
      });
    } catch (e) {
      console.warn(`[pool-sign-handler] sign IPC exception market=${market.id.slice(0,12)} input=${inputIdx}: ${e.message}`);
      continue;
    }
    if (!signResult?.ok || !signResult.signature) {
      console.warn(`[pool-sign-handler] sign fail market=${market.id.slice(0,12)} input=${inputIdx}: ${signResult?.error || 'no sig'}`);
      continue;
    }

    const respPayload = JSON.stringify({
      t: 'kanet_pool_oracle_tx_sign_resp_v1',
      market_id: market.id,
      voter_pubkey: voterPubkey,             // 94fe0b1 canonical cross-node identity
      voter_relay_id: oracleRelay.id,        // transitional, settler dual-accepts
      input_index: inputIdx,
      winner: payload.winner,
      signature: signResult.signature,
      epoch: 1,
    });
    const syntheticTxid = `pool_oracle_tx_sig:${oracleRelay.id.slice(0,8)}:${market.id.slice(0,12)}:i${inputIdx}:${Date.now()}`;
    sqlite.prepare(`
      INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
      VALUES (?, ?, 'pool_oracle_tx_sig', ?, ?, ?, 'pool-sign-handler', CURRENT_TIMESTAMP)
    `).run(randomUUID(), syntheticTxid, oracleRelay.address, oracleRelay.address, respPayload);
    signedAny++;
  }

  if (signedAny === 0) {
    return { ok: false, reason: 'no inputs signed (all already-signed or all-fail)' };
  }
  console.log(`[pool-sign-handler] OK market=${market.id.slice(0,12)} oracle=${oracleRelay.name} signed=${signedAny}/${spineInputCount} winner=${payload.winner} via voter_pubkey=${voterPubkey.slice(0,12)}`);
  return { ok: true, signed: signedAny };
}
