// Oracle v0.3 sub 10.x — SS SPOF Path A+B emit (Bettor r93 Owner ship-block).
//
// Compose ctor_params JSON canonical + sha256 hash + dual-sig (maker+taker) →
// Path A: broadcast to chain channel `kanet-prediction-params` (= 1 TX)
// Path B: DM cache to all parties (= maker + taker + each oracle relay)
// Local: INSERT predictions_offers_local_cache (= 自家 console DB sediment for recovery)
//
// Recovery: settler.js detects meta.redeem_script_hex missing → query cache OR chain_event →
//           silverc recompile → derive P2SH → assert match → continue settle.
//
// Per Bettor r93 spec payload schema kanet_prediction_params_v1.

import { sqlite } from '../db/client.js';
import { createHash } from 'node:crypto';
import { sendCommandAsync } from './relay-manager.js';

const PARAMS_CHANNEL = 'kanet-prediction-params';

/**
 * Canonical JSON stringify (= sorted keys deterministic) for hash stability.
 */
function canonicalJsonStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k])).join(',') + '}';
}

/**
 * Compose ctor_params object from offer + metadata + relay lookup.
 * Returns the canonical object (= input to hash + broadcast payload).
 */
export function composeCtorParams(offer, meta) {
  // Resolve oracle pubkeys from oracle_relay_ids (= JSON array of relay_ids)
  let oraclePks = [];
  try {
    const oracleIds = JSON.parse(offer.outcome_oracle_relay_ids || '[]');
    for (const rid of oracleIds) {
      const r = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(rid);
      if (r?.address) {
        // x-only pubkey hex from address — done lazily via caller if needed.
        // Here we record relay_ids; ctor_params consumer (= recompile) re-derives pubkeys.
        oraclePks.push({ relay_id: rid, address: r.address });
      }
    }
  } catch {}

  return {
    offer_id: offer.id,
    p2sh_addr: offer.escrow_p2sh,
    maker_pk: meta.maker_pk || null,
    taker_pk: meta.taker_pk || offer.pending_taker_pubkey,
    broker_pk: meta.broker_pk || null,
    oracle_pks: oraclePks,
    deadline: meta.deadline_seconds || null,
    miner_fee_sompi: parseInt(meta.miner_fee_sompi, 10) || 1_000_000,
    broker_fee_pct: parseInt(meta.broker_fee_pct, 10) || 100,
    oracle_fee_pct: parseInt(meta.oracle_fee_pct, 10) || 100,
    maker_stake_sompi: parseInt(meta.maker_stake_sompi, 10) || 0,
    taker_stake_sompi: parseInt(meta.taker_stake_sompi, 10) || 0,
    market_metadata_hash: meta.market_metadata_hash || null,
    protocol_version: meta.protocol_version || 'v0.3-full',
    redeem_script_hex: meta.redeem_script_hex || null,  // include for fast recovery; recompile verifies hash
  };
}

/**
 * sha256 hash of canonical JSON ctor_params.
 */
export function computeParamsHash(ctorParams) {
  const canonical = canonicalJsonStringify(ctorParams);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Sign params_hash via relay's ecdsa_sign IPC (= secp256k1 over message).
 */
async function signParamsHash(relayId, paramsHash) {
  const res = await sendCommandAsync(relayId, { type: 'ecdsa_sign', message: paramsHash });
  if (!res?.ok || !res.signature) {
    throw new Error(`ecdsa_sign fail relay=${relayId?.slice(0, 12)}: ${res?.error || 'no signature'}`);
  }
  return res.signature;
}

/**
 * Emit Path A (broadcast) + Path B (DM cache) + Local INSERT.
 * Idempotent: caches dedupe by offer_id PK.
 *
 * Returns { ok, params_hash, broadcast_tx_id?, dm_count?, local_cache_inserted }.
 */
export async function emitPredictionParamsCache({ offer, meta, makerRelayId, takerRelayId }) {
  const ctorParams = composeCtorParams(offer, meta);
  const paramsHash = computeParamsHash(ctorParams);

  // Dual-sign — maker + taker
  let makerSig, takerSig;
  try {
    [makerSig, takerSig] = await Promise.all([
      signParamsHash(makerRelayId, paramsHash),
      signParamsHash(takerRelayId, paramsHash),
    ]);
  } catch (e) {
    console.warn(`[params-cache] dual-sig fail offer=${offer.id?.slice(0, 12)}: ${e.message}`);
    return { ok: false, error: `dual-sig fail: ${e.message}`, params_hash: paramsHash };
  }

  // Local INSERT first (= 防 broadcast/DM fail 丢 sediment) — idempotent INSERT OR IGNORE
  let localCacheInserted = false;
  try {
    const result = sqlite.prepare(`
      INSERT OR IGNORE INTO predictions_offers_local_cache
        (offer_id, ctor_params_json, params_hash, p2sh_addr, maker_sig, taker_sig, source, received_at)
      VALUES (?, ?, ?, ?, ?, ?, 'publish', CURRENT_TIMESTAMP)
    `).run(offer.id, JSON.stringify(ctorParams), paramsHash, offer.escrow_p2sh, makerSig, takerSig);
    localCacheInserted = result.changes > 0;
  } catch (e) {
    console.warn(`[params-cache] local cache INSERT fail offer=${offer.id?.slice(0, 12)}: ${e.message}`);
  }

  const payload = {
    t: 'kanet_prediction_params_v1',
    offer_id: offer.id,
    p2sh_addr: offer.escrow_p2sh,
    ctor_params: ctorParams,
    params_hash: paramsHash,
    maker_sig: makerSig,
    taker_sig: takerSig,
  };
  const payloadJson = JSON.stringify(payload);

  // Path A — broadcast to chain channel (= canonical truth, MUST succeed per NWT r64 catch).
  // local_cache 是 mutable → 攻击者删 console.db + 改 cache table 可 forge.
  // chain_events 真 immutable → recovery 信 chain_events 才 trust 真路径.
  // Path A broadcast fail = whole emit fail (caller decides to retry).
  let broadcastTxId = null;
  try {
    const r = await sendCommandAsync(makerRelayId, {
      type: 'send_broadcast',
      channel: PARAMS_CHANNEL,
      message: payloadJson,
    });
    broadcastTxId = r?.txId || null;
  } catch (e) {
    console.error(`[params-cache] Path A broadcast FAIL offer=${offer.id?.slice(0, 12)}: ${e.message}`);
    return { ok: false, error: `Path A broadcast required but failed: ${e.message}`, params_hash: paramsHash };
  }
  if (!broadcastTxId) {
    console.error(`[params-cache] Path A broadcast 0 txId offer=${offer.id?.slice(0, 12)}`);
    return { ok: false, error: 'Path A broadcast returned no txId', params_hash: paramsHash };
  }

  // Path B — DM cache to maker + taker + each oracle (= addresses)
  let dmCount = 0;
  const recipientAddrs = new Set();
  if (offer.maker_kaspa_addr) recipientAddrs.add(offer.maker_kaspa_addr);
  if (offer.taker) recipientAddrs.add(offer.taker);
  try {
    const oracleIds = JSON.parse(offer.outcome_oracle_relay_ids || '[]');
    for (const rid of oracleIds) {
      const r = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(rid);
      if (r?.address) recipientAddrs.add(r.address);
    }
  } catch {}
  // DM sends — async non-blocking
  await Promise.allSettled([...recipientAddrs].map(addr =>
    sendCommandAsync(makerRelayId, { type: 'send_message', target: addr, message: payloadJson })
      .then(() => { dmCount++; })
      .catch(e => console.warn(`[params-cache] Path B DM to ${addr?.slice(0, 20)} fail: ${e.message}`))
  ));

  console.log(`[params-cache] offer=${offer.id?.slice(0, 12)} hash=${paramsHash.slice(0, 12)} bcast=${broadcastTxId?.slice(0, 12) || 'fail'} dm=${dmCount}/${recipientAddrs.size} cache=${localCacheInserted ? 'NEW' : 'DUP'}`);
  return {
    ok: true,
    params_hash: paramsHash,
    broadcast_tx_id: broadcastTxId,
    dm_count: dmCount,
    dm_total: recipientAddrs.size,
    local_cache_inserted: localCacheInserted,
  };
}

/**
 * Recovery — try chain_event (= truth) → local_cache (= fast path) → fail.
 *
 * Per NWT r64 真挑 #1: chain_events 真 immutable, local_cache mutable → 攻击者删 console.db
 * + 改 cache table 可 forge. Recovery 必 chain_events first 才 trust.
 *
 * Returns ctor_params if found and verified, null otherwise.
 *
 * INVARIANTS for recovery (= NWT r64 真挑 #2):
 *   - silverc binary in PATH OR $SILVERSCRIPT_COMPILER set
 *   - .sil source committed in repo (= src/lib/PredictionEscrowUnanimous5.sil + Variant A 等)
 *   - kasia-wasm OP_PUSHDATA2 bypass active (= sub 8/9 era patch)
 */
export async function recoverPredictionParams(offerId) {
  // Path 1 — chain_event scan (= canonical truth)
  const rows = sqlite.prepare(`
    SELECT payload FROM chain_events
    WHERE event_type = 'kanet_prediction_params_v1' AND payload LIKE ?
    ORDER BY observed_at DESC LIMIT 1
  `).all(`%"offer_id":"${offerId}"%`);
  if (rows.length > 0) {
    try {
      const payload = JSON.parse(rows[0].payload);
      const recomputedHash = computeParamsHash(payload.ctor_params);
      if (recomputedHash === payload.params_hash) {
        // Cache locally for next time (hot-path optimization, NOT truth source)
        try {
          sqlite.prepare(`
            INSERT OR IGNORE INTO predictions_offers_local_cache
              (offer_id, ctor_params_json, params_hash, p2sh_addr, maker_sig, taker_sig, source, received_at)
            VALUES (?, ?, ?, ?, ?, ?, 'recovery_chain', CURRENT_TIMESTAMP)
          `).run(offerId, JSON.stringify(payload.ctor_params), payload.params_hash, payload.p2sh_addr, payload.maker_sig, payload.taker_sig);
        } catch {}
        console.log(`[params-recovery] offer=${offerId.slice(0, 12)} restored from CHAIN_EVENT (= canonical truth) + cached locally`);
        return { ctor_params: payload.ctor_params, params_hash: payload.params_hash, source: 'chain_event' };
      } else {
        console.warn(`[params-recovery] chain_event hash mismatch offer=${offerId.slice(0, 12)} — rejecting forge attempt`);
      }
    } catch (e) {
      console.warn(`[params-recovery] chain_event parse fail: ${e.message}`);
    }
  }

  // Path 2 — local_cache fallback (= fast hot-path, NOT trusted unless chain_event also matches)
  // Only used if chain_event lookup fails (e.g. scout not yet ingested OR offline).
  // Re-verify hash + warn that this is fallback path.
  const cached = sqlite.prepare(`
    SELECT ctor_params_json, params_hash, p2sh_addr, maker_sig, taker_sig, source
    FROM predictions_offers_local_cache WHERE offer_id = ?
  `).get(offerId);
  if (cached) {
    try {
      const ctorParams = JSON.parse(cached.ctor_params_json);
      const recomputedHash = computeParamsHash(ctorParams);
      if (recomputedHash === cached.params_hash) {
        console.warn(`[params-recovery] offer=${offerId.slice(0, 12)} restored from LOCAL cache FALLBACK (source=${cached.source}) — chain_event lookup failed; reduced trust level`);
        return { ctor_params: ctorParams, params_hash: cached.params_hash, source: 'local_cache_fallback' };
      } else {
        console.warn(`[params-recovery] local cache hash mismatch offer=${offerId.slice(0, 12)}: stored=${cached.params_hash.slice(0, 12)} recomputed=${recomputedHash.slice(0, 12)} — possible forge`);
      }
    } catch (e) {
      console.warn(`[params-recovery] local cache parse fail: ${e.message}`);
    }
  }

  console.warn(`[params-recovery] offer=${offerId.slice(0, 12)} NOT recoverable (= no chain_event + no local cache)`);
  return null;
}
