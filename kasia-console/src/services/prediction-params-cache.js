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
export async function composeCtorParams(offer, meta) {
  // 5/28 NWT r84/Bettor r117 architect ack — compressed shape (hex_pubkey 数组).
  // Before: oracle_pks = [{relay_id (36B), address (76B)}] × 5 = 560B
  // After:  oracle_pks = [hex_pubkey (64B)] × 5 = 320B (= 19% Path A payload reduction)
  // Recovery: address reverse-lookup not needed; silverc recompile takes hex_pubkey directly.
  let oraclePks = [];
  try {
    const oracleIds = JSON.parse(offer.outcome_oracle_relay_ids || '[]');
    const kaspa = await import('kaspa-wasm');
    for (const rid of oracleIds) {
      const r = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(rid);
      if (r?.address) {
        try {
          const xpk = kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(r.address)).toString();
          oraclePks.push(xpk);
        } catch (e) {
          console.warn(`[params-cache] oracle pubkey derive fail for ${rid?.slice(0,8)}: ${e.message}`);
        }
      }
    }
  } catch {}

  // NWT r68 fix: redeem_script_hex NOT in canonical ctor_params (= 1301B = 2602 hex chars 超 5000 broadcast cap).
  // redeem_script is derived OUTPUT of silverc(ctor_params + .sil source), recovery 时 recompile.
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
  };
}

/**
 * Recompile redeem_script_hex from ctor_params via silverc (= NWT r68 fix).
 * Called by recoverPredictionParams to derive redeem_script (= not in canonical payload).
 *
 * INVARIANTS: silverc binary in PATH + .sil source committed.
 */
async function recompileRedeemScript(ctorParams) {
  try {
    // Extract oracle pks as hex array (= computeEscrowP2SH expects x-only hex)
    const kaspa = await import('kaspa-wasm');
    const oraclePksHex = ctorParams.oracle_pks.map(o => {
      if (typeof o === 'string') return o;  // already hex
      // derive from address — recovery 也 needs relay address to derive
      try { return kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(o.address)).toString(); }
      catch { return null; }
    }).filter(Boolean);
    if (oraclePksHex.length !== 5) {
      return { ok: false, error: `expected 5 oracle pks, got ${oraclePksHex.length}` };
    }
    const { computeEscrowP2SH } = await import('../lib/prediction-escrow-ss.mjs');
    const escrow = await computeEscrowP2SH({
      makerPk: ctorParams.maker_pk,
      takerPk: ctorParams.taker_pk,
      brokerPk: ctorParams.broker_pk,
      oraclePks: oraclePksHex,
      deadline: ctorParams.deadline,
      minerFee: ctorParams.miner_fee_sompi,
      brokerFeePct: ctorParams.broker_fee_pct,
      oracleFeePct: ctorParams.oracle_fee_pct,
      makerStakeAmount: ctorParams.maker_stake_sompi,
      takerStakeAmount: ctorParams.taker_stake_sompi,
      network: ctorParams.p2sh_addr?.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet',
    });
    return { ok: true, redeem_script_hex: escrow.redeemScript, p2sh_addr: escrow.p2shAddr };
  } catch (e) {
    return { ok: false, error: `silverc recompile fail: ${e.message}` };
  }
}

/**
 * sha256 hash of canonical JSON ctor_params.
 */
export function computeParamsHash(ctorParams) {
  const canonical = canonicalJsonStringify(ctorParams);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Verify dual-sig (maker_sig + taker_sig) against params_hash + pubkeys (NWT r67 R3 light gap fix).
 * Forge defense: payload may carry valid hash (= attacker-computed self-consistent) but sigs from
 * attacker's keys, not maker_pk/taker_pk in payload. verifyMessage rejects mismatch.
 *
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
export async function verifyParamsDualSig({ ctor_params, params_hash, maker_sig, taker_sig }) {
  if (!ctor_params || !params_hash || !maker_sig || !taker_sig) {
    return { valid: false, reason: 'missing field (ctor_params, params_hash, maker_sig, or taker_sig)' };
  }
  if (!ctor_params.maker_pk || !ctor_params.taker_pk) {
    return { valid: false, reason: 'ctor_params missing maker_pk or taker_pk for verify' };
  }
  try {
    const kaspa = await import('kaspa-wasm');
    const makerValid = kaspa.verifyMessage({ message: params_hash, signature: maker_sig, publicKey: ctor_params.maker_pk });
    if (!makerValid) return { valid: false, reason: 'maker_sig invalid against ctor_params.maker_pk' };
    const takerValid = kaspa.verifyMessage({ message: params_hash, signature: taker_sig, publicKey: ctor_params.taker_pk });
    if (!takerValid) return { valid: false, reason: 'taker_sig invalid against ctor_params.taker_pk' };
    return { valid: true };
  } catch (e) {
    return { valid: false, reason: `verifyMessage exception: ${e.message}` };
  }
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
  const ctorParams = await composeCtorParams(offer, meta);
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

  // 5/28 Bettor r118 architect re-decide: (C) hash-anchor model.
  // Chain TX payload = hash-anchor minimal (~540 chars) — sha256(canonical ctor_params) + signers refs.
  // Full ctor_params stored in 7-party local cache (= maker + taker + 5 oracle DBs each INSERT OR IGNORE).
  // 1-of-7 surviving = enough for recovery. Path B DM 升 best-effort (= not main path).
  // Recovery: chain hash MUST match cache.params_hash else invalid (= forge defense preserved).
  const chainAnchor = {
    t: 'kanet_prediction_params_v1',
    v: 2,  // hash-anchor model (= v1 was full-ctor inline, deprecated due to storage mass empirical fail)
    offer_id: offer.id,
    p2sh_addr: offer.escrow_p2sh,
    params_hash: paramsHash,
    maker_sig: makerSig,
    taker_sig: takerSig,
  };
  const chainPayloadJson = JSON.stringify(chainAnchor);
  // Full payload for Path B DM (= best-effort, may carry full ctor_params for fast recovery)
  const fullPayload = {
    ...chainAnchor,
    ctor_params: ctorParams,
  };
  const payloadJson = chainPayloadJson;  // Path A uses minimal chain anchor

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
  // DM sends — best-effort, full ctor_params payload for cache portability
  const fullPayloadJson = JSON.stringify(fullPayload);
  await Promise.allSettled([...recipientAddrs].map(addr =>
    sendCommandAsync(makerRelayId, { type: 'send_message', target: addr, message: fullPayloadJson })
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
  // Path 1 — chain_event scan (= canonical hash-anchor source per Bettor r118).
  // v2 hash-anchor: chain payload has params_hash + sigs but NO ctor_params. Recovery requires
  //   chain hash + local_cache OR DM cache provides ctor_params. Hash MUST match.
  // v1 legacy: chain payload has inline ctor_params (= old broadcasts pre-r118 refactor).
  const rows = sqlite.prepare(`
    SELECT payload FROM chain_events
    WHERE event_type = 'kanet_prediction_params_v1' AND payload LIKE ?
    ORDER BY observed_at DESC LIMIT 1
  `).all(`%"offer_id":"${offerId}"%`);
  if (rows.length > 0) {
    try {
      const payload = JSON.parse(rows[0].payload);
      // v2 hash-anchor model — chain has no ctor_params. Lookup local_cache by hash.
      if (payload.v === 2 || !payload.ctor_params) {
        const cached = sqlite.prepare(`
          SELECT ctor_params_json, params_hash, p2sh_addr, maker_sig, taker_sig, source
          FROM predictions_offers_local_cache WHERE offer_id = ?
        `).get(offerId);
        if (!cached) {
          console.warn(`[params-recovery] hash-anchor offer=${offerId.slice(0,12)} chain hash exists but NO local cache — try Path B DM history (TODO future production)`);
          return null;
        }
        // Hash MUST match chain anchor (= Bettor r118 forge defense)
        if (cached.params_hash !== payload.params_hash) {
          console.warn(`[params-recovery] hash-anchor mismatch offer=${offerId.slice(0,12)} chain=${payload.params_hash.slice(0,12)} cache=${cached.params_hash.slice(0,12)} — REJECT`);
          return null;
        }
        // Re-verify by recompute hash from cache ctor_params
        const ctorParams = JSON.parse(cached.ctor_params_json);
        const recomputedHash = computeParamsHash(ctorParams);
        if (recomputedHash !== payload.params_hash) {
          console.warn(`[params-recovery] hash-anchor recompute mismatch offer=${offerId.slice(0,12)} — REJECT (cache tamper?)`);
          return null;
        }
        // Dual-sig verify (= forge defense, signers committed to this exact hash on chain)
        const sigCheck = await verifyParamsDualSig({
          ctor_params: ctorParams,
          params_hash: payload.params_hash,
          maker_sig: payload.maker_sig,
          taker_sig: payload.taker_sig,
        });
        if (!sigCheck.valid) {
          console.warn(`[params-recovery] hash-anchor dual-sig REJECT offer=${offerId.slice(0,12)}: ${sigCheck.reason}`);
          return null;
        }
        const recompiled = await recompileRedeemScript(ctorParams);
        if (!recompiled.ok || recompiled.p2sh_addr !== payload.p2sh_addr) {
          console.warn(`[params-recovery] hash-anchor silverc recompile fail OR P2SH mismatch offer=${offerId.slice(0,12)}`);
          return null;
        }
        console.log(`[params-recovery] offer=${offerId.slice(0,12)} restored via HASH-ANCHOR chain + local cache + dual-sig + silverc recompile`);
        return { ctor_params: ctorParams, params_hash: payload.params_hash, source: 'hash_anchor_cache', redeem_script_hex: recompiled.redeem_script_hex, p2sh_addr: recompiled.p2sh_addr };
      }
      // v1 legacy path (= inline ctor_params)
      const recomputedHash = computeParamsHash(payload.ctor_params);
      if (recomputedHash !== payload.params_hash) {
        console.warn(`[params-recovery] chain_event v1 hash mismatch offer=${offerId.slice(0, 12)} — rejecting forge attempt`);
      } else {
        // NWT r67 R3 light gap fix: defense-in-depth dual-sig verify (= 防 attacker self-consistent hash)
        const sigCheck = await verifyParamsDualSig(payload);
        if (!sigCheck.valid) {
          console.warn(`[params-recovery] chain_event dual-sig REJECT offer=${offerId.slice(0, 12)}: ${sigCheck.reason} — forge defense`);
        } else {
        // Cache locally for next time (hot-path optimization, NOT truth source)
        try {
          sqlite.prepare(`
            INSERT OR IGNORE INTO predictions_offers_local_cache
              (offer_id, ctor_params_json, params_hash, p2sh_addr, maker_sig, taker_sig, source, received_at)
            VALUES (?, ?, ?, ?, ?, ?, 'recovery_chain', CURRENT_TIMESTAMP)
          `).run(offerId, JSON.stringify(payload.ctor_params), payload.params_hash, payload.p2sh_addr, payload.maker_sig, payload.taker_sig);
        } catch {}
        // NWT r68 fix: redeem_script not in canonical payload, recompile via silverc
        const recompiled = await recompileRedeemScript(payload.ctor_params);
        if (!recompiled.ok) {
          console.warn(`[params-recovery] silverc recompile fail offer=${offerId.slice(0, 12)}: ${recompiled.error}`);
          return null;
        }
        // P2SH addr assertion: recompiled === broadcast claim
        if (recompiled.p2sh_addr !== payload.p2sh_addr) {
          console.warn(`[params-recovery] P2SH mismatch offer=${offerId.slice(0, 12)}: recompiled=${recompiled.p2sh_addr?.slice(0,30)} broadcast=${payload.p2sh_addr?.slice(0,30)} — rejecting`);
          return null;
        }
        console.log(`[params-recovery] offer=${offerId.slice(0, 12)} restored from CHAIN_EVENT + dual-sig + silverc recompile (= P2SH match) + cached`);
        return { ctor_params: payload.ctor_params, params_hash: payload.params_hash, source: 'chain_event', redeem_script_hex: recompiled.redeem_script_hex, p2sh_addr: recompiled.p2sh_addr };
        }
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
      if (recomputedHash !== cached.params_hash) {
        console.warn(`[params-recovery] local cache hash mismatch offer=${offerId.slice(0, 12)}: stored=${cached.params_hash.slice(0, 12)} recomputed=${recomputedHash.slice(0, 12)} — possible forge`);
      } else {
        // NWT r67 R3 light gap fix (parity with chain_event path): dual-sig verify on fallback too.
        const sigCheck = await verifyParamsDualSig({
          ctor_params: ctorParams,
          params_hash: cached.params_hash,
          maker_sig: cached.maker_sig,
          taker_sig: cached.taker_sig,
        });
        if (!sigCheck.valid) {
          console.warn(`[params-recovery] local cache dual-sig REJECT offer=${offerId.slice(0, 12)}: ${sigCheck.reason} — forge defense (local DB likely tampered)`);
        } else {
          // NWT r68 fix: recompile redeem_script via silverc (same as chain path)
          const recompiled = await recompileRedeemScript(ctorParams);
          if (!recompiled.ok || recompiled.p2sh_addr !== cached.p2sh_addr) {
            console.warn(`[params-recovery] local cache silverc recompile fail OR P2SH mismatch — rejecting`);
          } else {
            console.warn(`[params-recovery] offer=${offerId.slice(0, 12)} restored from LOCAL cache FALLBACK (= reduced trust) + silverc recompile`);
            return { ctor_params: ctorParams, params_hash: cached.params_hash, source: 'local_cache_fallback', redeem_script_hex: recompiled.redeem_script_hex, p2sh_addr: recompiled.p2sh_addr };
          }
        }
      }
    } catch (e) {
      console.warn(`[params-recovery] local cache parse fail: ${e.message}`);
    }
  }

  console.warn(`[params-recovery] offer=${offerId.slice(0, 12)} NOT recoverable (= no chain_event + no local cache)`);
  return null;
}
