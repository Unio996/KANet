// pool-commingle-detect.mjs — SINGLE SOURCE for FINDING-2 commingled-spine detection (J1, 2026-06-28).
//
// NWT FINDING-2: pre-fix PoolSpine_v07.sil didn't bake market_id into the redeem (unused ctor param dropped)
// → markets differing only in market_id collapsed to the SAME spine_p2sh (funds commingled, cross-market
// substitution risk). Fix (PoolSpine_v07.sil 88797d88) bakes market_id → post-fix markets have a UNIQUE
// spine_p2sh per market. So the on-chain signature of a buggy/commingled market = its spine_p2sh is shared
// by >1 v0.7 market; an isolated (post-fix or single) market's spine_p2sh is unique.
//
// 单源铁律 (线8 机制哲学, 同 validateResolutionPredicate / 护栏6): the commingled criterion lives HERE, ONCE.
// All three FINDING-2 entry-gates import this — zero drift, one place to reason about:
//   ② trending-exclude  (display, non-money, ship now)      — 热榜不显 commingled 盘
//   ③ register-v07 reject (entry, money-adjacent, next pass) — 用户押不进 commingled bug 盘
//   ① settler skip       (settle, money-adjacent, next pass) — 自治结算跳过 commingled (BSHARD_SETTLE_HOLD)
// NON-money: this module only READS pool_markets; it never mutates status/funds (entry-block ≠ status-cancel,
// J1 decoupling 原则 — status='cancelled' would orphan the settler deadline auto-refund).

const COMMINGLE_SQL =
  "SELECT COUNT(*) AS n FROM pool_markets WHERE spine_p2sh = ? AND protocol_version = 'v0.7'";

const COMMINGLE_SET_SQL =
  "SELECT spine_p2sh FROM pool_markets " +
  "WHERE protocol_version = 'v0.7' AND spine_p2sh IS NOT NULL " +
  "GROUP BY spine_p2sh HAVING COUNT(*) > 1";

/**
 * isCommingledSpine — true iff this spine_p2sh is shared by >1 v0.7 market (= FINDING-2 commingled, pre-fix).
 * Post-fix markets (market_id baked → unique spine) return false. Empty/null spine → false (not commingled).
 * @param {string} spineP2sh  the market's spine_p2sh address
 * @param {object} db         better-sqlite3 handle
 * @returns {boolean}
 */
export function isCommingledSpine(spineP2sh, db) {
  if (!spineP2sh) return false;
  const row = db.prepare(COMMINGLE_SQL).get(spineP2sh);
  return (row?.n || 0) > 1;
}

/**
 * commingledSpineSet — batch form for bulk filtering (e.g. trending over N markets without N queries).
 * Same criterion as isCommingledSpine, evaluated once. Returns a Set of all currently-commingled spine_p2sh.
 * @param {object} db  better-sqlite3 handle
 * @returns {Set<string>}
 */
export function commingledSpineSet(db) {
  const rows = db.prepare(COMMINGLE_SET_SQL).all();
  return new Set(rows.map(r => r.spine_p2sh));
}
