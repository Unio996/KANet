// r177 Phase 1 prediction_outcome_share verifier (Bettor r177/r178/r190/r191 + Owner 5/18 一气呵成).
//
// Hybrid Latency Defense per Bettor r177 design doc — 4 layer verification on accept message:
//   (1) expires_at not exceeded
//   (2) deviation guard: maker_published_price vs current_gamma_price ≤ outcome_max_deviation_pp
//   (3) maker signature valid
//   (4) maker in whitelist + stake active
//
// settle verifier: polymarket_uma_mirror oracle_hook checks gamma API for outcomePrice → 1 / 0
// resolution. kanet_consensus oracle_hook = Phase 2 stub.

import { sqlite } from '../db/client.js';

// Bettor r182 polish 2 (5/19): 5s timeout 太紧 (= restart 后 RPC catch-up 3-retry 才过). 10s + 1 retry.
// 真因: cold start gamma API latency 可能 >5s. 单 retry 容忍 transient (= 既守 Hybrid Latency Defense
// 不允许 stale price, 又避免误判 transient flap).
const GAMMA_TIMEOUT_MS = 10000;  // 10s default (was 5s)
const GAMMA_RETRY_COUNT = 1;     // 1 retry on timeout/network (= 2 total attempts)

// Bettor r182 polish 2: retry-wrapped gamma fetch. Throws final error after retries exhausted (= caller catch).
// KI-31 (Bettor r184 5/19): URL 必含 &closed=true — Polymarket gamma default active=true filter,
// resolved market 不返 ('market not found') → settler 永卡 matched. closed=true 实 'include closed'
// (= active + closed 都返, 不破现 active 路径).
async function fetchGammaWithRetry(tokenId) {
  let lastErr;
  for (let attempt = 0; attempt <= GAMMA_RETRY_COUNT; attempt++) {
    try {
      const res = await fetch(
        `https://gamma-api.polymarket.com/markets?clob_token_ids=${encodeURIComponent(tokenId)}&closed=true`,
        { signal: AbortSignal.timeout(GAMMA_TIMEOUT_MS) },
      );
      return res;  // including non-2xx; caller checks res.ok
    } catch (e) {
      lastErr = e;
      if (attempt < GAMMA_RETRY_COUNT) continue;  // retry
    }
  }
  throw lastErr;
}

/**
 * Verify accept message against published prediction offer.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
export async function verifyPredictionMatch(offer, acceptMsg) {
  // Layer 1: expires_at check
  if (offer.expires_at) {
    const exp = new Date(offer.expires_at).getTime();
    if (Number.isFinite(exp) && exp <= Date.now()) {
      return { ok: false, reason: 'offer expired' };
    }
  }

  // Layer 2: deviation guard — current gamma price vs offer published yes_price
  if (offer.outcome_condition_id && offer.outcome_token_id) {
    try {
      const res = await fetchGammaWithRetry(offer.outcome_token_id);
      if (!res.ok) return { ok: false, reason: `gamma HTTP ${res.status}` };
      const arr = await res.json();
      const m = (arr || [])[0];
      if (!m) return { ok: false, reason: 'gamma market not found' };
      let currentPrice;
      try {
        const op = JSON.parse(m.outcomePrices || '[]');
        currentPrice = parseFloat(offer.outcome_side === 'YES' ? op[0] : op[1]);
      } catch {
        return { ok: false, reason: 'gamma outcomePrices parse fail' };
      }
      if (!Number.isFinite(currentPrice)) return { ok: false, reason: 'gamma price not finite' };
      const publishedPrice = parseFloat(offer.published_price || acceptMsg?.published_price || 0);
      const deviationPp = Math.abs(currentPrice - publishedPrice) * 100;
      const maxDeviation = offer.outcome_max_deviation_pp || 5;  // default 5pp per r180 PB(a)
      if (deviationPp > maxDeviation) {
        return { ok: false, reason: `deviation ${deviationPp.toFixed(2)}pp > max ${maxDeviation}pp (gamma ${currentPrice} vs published ${publishedPrice})` };
      }
    } catch (e) {
      // r182 polish 2: gamma 10s + 1 retry 后仍 fail → reject (= 守 Hybrid Latency Defense 不许 stale).
      return { ok: false, reason: `gamma fetch fail: ${e.message}` };
    }
  }

  // Layer 3: signature (ethers signature verify) — Phase 1.5 stub (Phase 2 full impl)
  if (acceptMsg?.signature) {
    // TODO Phase 1.5: verify ethers signature against maker_address recovered from sig
  }

  // Layer 4: maker whitelist + stake active
  if (offer.maker_relay_id) {
    const wl = sqlite.prepare(
      'SELECT relay_node_id, stake_locked_kas, stake_lock_until, active FROM prediction_maker_whitelist WHERE relay_node_id = ? AND active = 1'
    ).get(offer.maker_relay_id);
    if (!wl) return { ok: false, reason: `maker ${offer.maker_relay_id.slice(0, 8)} not whitelisted` };
    const lockUntil = new Date(wl.stake_lock_until).getTime();
    if (!Number.isFinite(lockUntil) || lockUntil <= Date.now()) {
      return { ok: false, reason: 'maker stake lock expired' };
    }
  }

  return { ok: true };
}

/**
 * Settle verifier: check oracle resolution.
 * oracle_hook=polymarket_uma_mirror → gamma outcomePrice === 1 (winner) / 0 (loser)
 * oracle_hook=kanet_consensus → Phase 2 stub (not yet implemented)
 */
export async function verifyPredictionOutcome(offer) {
  if (offer.outcome_oracle_hook === 'kanet_consensus') {
    return { ok: false, reason: 'kanet_consensus oracle Phase 2 not yet implemented' };
  }
  if (offer.outcome_oracle_hook !== 'polymarket_uma_mirror') {
    return { ok: false, reason: `unsupported oracle_hook ${offer.outcome_oracle_hook}` };
  }
  if (!offer.outcome_token_id) return { ok: false, reason: 'missing outcome_token_id' };
  try {
    const res = await fetchGammaWithRetry(offer.outcome_token_id);
    if (!res.ok) return { ok: false, reason: `gamma HTTP ${res.status}` };
    const arr = await res.json();
    const m = (arr || [])[0];
    if (!m) return { ok: false, reason: 'gamma market not found' };
    const op = JSON.parse(m.outcomePrices || '[]');
    const yesPrice = parseFloat(op[0]);
    const noPrice = parseFloat(op[1]);
    if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) return { ok: false, reason: 'outcomePrices not finite' };
    // Resolved if either side hits exactly 1 (Polymarket settle convention)
    if (yesPrice === 1 && noPrice === 0) return { ok: true, resolved: true, winner: 'YES' };
    if (yesPrice === 0 && noPrice === 1) return { ok: true, resolved: true, winner: 'NO' };
    return { ok: true, resolved: false, current: { yes: yesPrice, no: noPrice } };
  } catch (e) {
    return { ok: false, reason: `gamma fetch fail: ${e.message}` };
  }
}
