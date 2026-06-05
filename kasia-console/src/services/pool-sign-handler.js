// J1tn r311 (Owner verdict 2026-06-05): cross-node sign_req listener for 4-of-5 settle.
//
// Bettor 4Q 收敛 + Owner 终裁:
//   - organizer (= maker_relay node) DMs each committee oracle's kaspa address with sign_req
//   - This node's processComm decrypts (if recipient PK matches one of our oracle relays)
//   - handleIngestMessage detects kanet_pool_sign_req_v1 payload + routes here
//   - We sign each input via existing sign_input_for_settle IPC + DM sign_resp back to organizer
//
// Shape contract (J2 r336):
//   sign_req:  {t:kanet_pool_sign_req_v1, market_id, sign_req_id:sha256(market_id||attempt),
//               spine_redeem_script_hex, settle_inputs:[{outpoint,p2sh,redeem_hex,input_idx}],
//               expected_committee_pk_hash, deadline:nowMs+timeout_ms}
//   sign_resp: {t:kanet_pool_sign_resp_v1, sign_req_id, voter_pk, sigs:[{input_idx,sig_hex}]}
//
// Idempotency: Kaspa Schnorr sigs are deterministic (RFC6979-style nonce derive from privkey+msg),
//   so same input → same sig 自动. No cache needed. Re-sign on duplicate sign_req = OK.
//
// Anti-spoof: incoming sign_req address-target is our oracle's kaspa address (= verified by
//   processComm decrypt success — only the recipient's privkey can decrypt). organizer
//   identity 验 via market.maker_relay_id pointing at sender (= optional defense; J2's
//   chain-broadcast settle TX naturally rejects bad sigs anyway via SS verify).

import { sqlite } from '../db/client.js';
import { sendCommandAsync } from './relay-manager.js';

const HANDLER_VERSION = 'kanet_pool_sign_req_v1';

/**
 * Detect if an inbound DM is a pool sign_req. Returns parsed payload OR null.
 * @param {string} contentText - decrypted DM plaintext
 * @returns {object|null}
 */
export function detectPoolSignReq(contentText) {
  if (!contentText || typeof contentText !== 'string') return null;
  const trimmed = contentText.trim();
  if (!trimmed.startsWith('{')) return null;
  let payload;
  try { payload = JSON.parse(trimmed); } catch { return null; }
  if (payload?.t !== HANDLER_VERSION) return null;
  return payload;
}

/**
 * Handle a kanet_pool_sign_req_v1 DM. Called by handleIngestMessage after detection.
 *
 * @param {object} params
 * @param {string} params.localAddress  - our oracle relay's kaspa address (= sign_req target)
 * @param {string} params.remoteAddress - organizer (maker_relay) address
 * @param {object} params.payload       - parsed sign_req JSON
 * @returns {Promise<{ ok: boolean, reason?: string, sigCount?: number, dmTxId?: string }>}
 */
export async function handlePoolSignReq({ localAddress, remoteAddress, payload }) {
  // 1. Validate payload shape
  const required = ['market_id', 'sign_req_id', 'spine_redeem_script_hex', 'settle_inputs', 'expected_committee_pk_hash', 'deadline'];
  for (const f of required) {
    if (payload[f] === undefined || payload[f] === null) {
      console.warn(`[pool-sign-handler] reject ${payload.sign_req_id?.slice(0, 12)}: missing field ${f}`);
      return { ok: false, reason: `missing field ${f}` };
    }
  }
  if (!Array.isArray(payload.settle_inputs) || payload.settle_inputs.length === 0) {
    return { ok: false, reason: 'settle_inputs must be non-empty array' };
  }
  if (Number(payload.deadline) < Date.now()) {
    return { ok: false, reason: `sign_req expired (deadline ${payload.deadline} < now ${Date.now()})` };
  }

  // 2. Resolve which of our local oracle relays owns localAddress
  const oracleRelay = sqlite.prepare(
    'SELECT id, name, address FROM relay_nodes WHERE address = ? AND is_oracle = 1'
  ).get(localAddress);
  if (!oracleRelay) {
    console.warn(`[pool-sign-handler] reject ${payload.sign_req_id?.slice(0, 12)}: no local is_oracle=1 relay matches address ${localAddress?.slice(-12)}`);
    return { ok: false, reason: 'no local oracle relay matches target address' };
  }

  // 3. Verify this oracle is in the market's committee (chain truth — pool_committee row should
  //    contain this oracle's PK derived from address). Defer to expected_committee_pk_hash check
  //    via on-chain SS validation; here we just confirm the market exists + is in collecting_sigs.
  const market = sqlite.prepare(
    'SELECT id, protocol_status, maker_relay_id FROM pool_markets WHERE id = ?'
  ).get(payload.market_id);
  if (!market) {
    console.warn(`[pool-sign-handler] reject ${payload.sign_req_id?.slice(0, 12)}: market ${payload.market_id?.slice(0, 12)} not in local DB (cross-node envelope gap?)`);
    return { ok: false, reason: 'market not in local DB' };
  }
  // collecting_sigs / verifying both acceptable per J2 settler-tick flow
  if (!['verifying', 'collecting_sigs', 'pending_bettors'].includes(market.protocol_status)) {
    console.warn(`[pool-sign-handler] reject ${payload.sign_req_id?.slice(0, 12)}: market status=${market.protocol_status} not signable`);
    return { ok: false, reason: `market status=${market.protocol_status} not signable` };
  }

  // 4. Get our oracle's x-only pubkey via relay IPC (= will be voter_pk in resp)
  let voterPk;
  try {
    const pkRes = await sendCommandAsync(oracleRelay.id, { type: 'get_pubkey' });
    if (!pkRes?.x_only_pubkey) throw new Error(pkRes?.error || 'no x_only_pubkey in response');
    voterPk = String(pkRes.x_only_pubkey).toLowerCase();
  } catch (e) {
    console.warn(`[pool-sign-handler] get_pubkey fail for relay=${oracleRelay.name}: ${e.message}`);
    return { ok: false, reason: `get_pubkey fail: ${e.message}` };
  }

  // 5. Sign each input via sign_input_for_settle IPC.
  //    Kaspa Schnorr sigs are deterministic (BIP340 / RFC6979) → idempotent re-sign safe.
  const sigs = [];
  for (const inp of payload.settle_inputs) {
    if (typeof inp.input_idx !== 'number' || !inp.outpoint || !inp.redeem_hex) {
      console.warn(`[pool-sign-handler] skip malformed input idx=${inp.input_idx}`);
      continue;
    }
    try {
      const signRes = await sendCommandAsync(oracleRelay.id, {
        type: 'sign_input_for_settle',
        tx_hex: payload.tx_hex || '',
        input_index: inp.input_idx,
        p2sh_address: inp.p2sh,
        redeem_script_hex: inp.redeem_hex,
        outpoint: inp.outpoint,
        spine_redeem_script_hex: payload.spine_redeem_script_hex,
      });
      if (!signRes?.ok || !signRes.sig_hex) {
        console.warn(`[pool-sign-handler] sign_input_for_settle fail input=${inp.input_idx}: ${signRes?.error || 'no sig'}`);
        continue;
      }
      sigs.push({ input_idx: inp.input_idx, sig_hex: String(signRes.sig_hex) });
    } catch (e) {
      console.warn(`[pool-sign-handler] sign IPC exception input=${inp.input_idx}: ${e.message}`);
    }
  }

  if (sigs.length === 0) {
    return { ok: false, reason: 'no inputs signed successfully' };
  }

  // 6. Build + send sign_resp DM back to organizer (= remoteAddress)
  const respPayload = {
    t: 'kanet_pool_sign_resp_v1',
    sign_req_id: payload.sign_req_id,
    voter_pk: voterPk,
    sigs,
  };
  const respJson = JSON.stringify(respPayload);

  try {
    const dmRes = await sendCommandAsync(oracleRelay.id, {
      type: 'send_message',
      target: remoteAddress,
      message: respJson,
    });
    if (!dmRes?.ok && !dmRes?.txId) {
      console.warn(`[pool-sign-handler] sign_resp DM fail: ${dmRes?.error || 'no txId'}`);
      return { ok: false, reason: `sign_resp DM fail: ${dmRes?.error}`, sigCount: sigs.length };
    }
    console.log(`[pool-sign-handler] OK market=${payload.market_id.slice(0, 12)} sign_req=${payload.sign_req_id.slice(0, 12)} oracle=${oracleRelay.name} sigs=${sigs.length}/${payload.settle_inputs.length} dm=${dmRes.txId?.slice(0, 16)}`);
    return { ok: true, sigCount: sigs.length, dmTxId: dmRes.txId };
  } catch (e) {
    console.warn(`[pool-sign-handler] send_message exception: ${e.message}`);
    return { ok: false, reason: `send_message exception: ${e.message}`, sigCount: sigs.length };
  }
}
