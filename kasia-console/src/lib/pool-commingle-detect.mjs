// pool-commingle-detect.mjs — SINGLE SOURCE for FINDING-2 commingled-spine detection (J1, 2026-06-28).
//
// NWT FINDING-2: pre-fix PoolSpine_v07.sil didn't bake market_id into the redeem (unused ctor param dropped)
// → markets differing only in market_id collapsed to the SAME spine_p2sh (funds commingled, cross-market
// substitution risk). Fix (PoolSpine_v07.sil 88797d88) bakes market_id → post-fix markets have a UNIQUE
// spine_p2sh per market. So the on-chain signature of a buggy/commingled market = its spine_p2sh is shared
// by >1 v0.7 market; an isolated (post-fix or single) market's spine_p2sh is unique.
//
// 单源铁律 (线8 机制哲学, 同 validateResolutionPredicate / 护栏6): the commingled criterion lives HERE, ONCE.
// All FINDING-2 entry-gates import this — zero drift, one place to reason about:
//   ② trending-exclude  (display, non-money)  — 热榜不显 commingled 盘 (commingledSpineSet)
//   ③ register reject   (entry, money-adjacent) — 用户押不进 commingled bug 盘 (assertNotCommingled, 全 6 stake-lock 入口)
//   ① settler skip      (settle, money-adjacent) — 自治结算跳过 commingled (bshard-close-voter)
// NON-money: this module only READS pool_markets; it never mutates status/funds (entry-block ≠ status-cancel,
// J1 decoupling 原则 — status='cancelled' would orphan the settler deadline auto-refund).
//
// ③ 完整性 (commit1 miss 教训, 2026-06-28): commit1 只守 register-v07 单个 handler, 但 stake-lock 入口有 6 个
// (register-v07 / register / register-v06{prep,confirm} / register-external{prep,confirm}), auto-bet+TG /bet 走
// register-v06 dual-handle → commingled 盘漏押。assertNotCommingled = 单源【守卫调用点】, 每个 stake-lock handler
// 顶部一行调 (call-site 单源, 非 scatter 内联 = 防"新加 handler 又漏守")。lint-kanet R-COMMINGLE-GUARD 自维持。
// 防御性铁律: register-external 实践只 v0.5 (commingled=v0.7 N/A), 但码不强制 protocol_version → 也 wire,
// isCommingledSpine 对非 v0.7 spine 返 false = 零害 no-op (别信 'only-used-for-X' 当码不强制 = commit1 同根因)。

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

/**
 * assertNotCommingled — SINGLE-SOURCE guard call-site for the ③ entry-gate. Call at the top of EVERY
 * bettor stake-lock handler (after the market row is loaded). Returns true IFF it already rejected the
 * request (caller must `return` immediately); false = market is clean, proceed.
 *
 * Why a shared guard (not inline isCommingledSpine per handler): commit1 inlined the check in register-v07
 * only and missed the other 5 stake-lock entries (register / register-v06{prep,confirm} /
 * register-external{prep,confirm}). One call-site fn → adding the guard to a new handler is one line, and
 * lint-kanet R-COMMINGLE-GUARD flags any pool_bettor_sides-INSERT handler that forgot to call it.
 *
 * @param {object} market  pool_markets row (must have spine_p2sh)
 * @param {object} reply   fastify reply (409 sent on commingled)
 * @param {object} db      better-sqlite3 handle
 * @returns {boolean}      true = rejected (caller returns), false = clean
 */
export function assertNotCommingled(market, reply, db) {
  if (market && isCommingledSpine(market.spine_p2sh, db)) {
    reply.code(409).send({
      ok: false,
      error: 'market spine commingled (FINDING-2): registration blocked. Existing stakes remain refundable at deadline (outpoint-precise).',
    });
    return true;
  }
  return false;
}
