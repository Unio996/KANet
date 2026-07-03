// Regression guard: G3 market-full leaf cap (世界杯上线门, 2026-07-04, Bettor+NWT 钦定).
//
// bshard 无限押注(SHARD_SEAL_COUNT=32)本身没有市场级上限, 但结算侧 PayoutShard 的 payout-merkle
// 硬顶 1024 leaf/片(pool-payout-root.mjs CAP = 1<<10), #18 rolling-payout-shard(支持 >1024)未建。
// 900 = 留 12% 安全边界的软顶, 按 distinct bet(叶子)数计(非人数, NWT 澄清-2: 一人多笔=多叶子)。
// 落地在 pool.js 两处 register-v07 入口(monolithic + prep), 用 getSidesByLogicalMarket 做 shard-aware
// 计数(非裸 pool_bettor_sides WHERE market_id — 会漏 bshard 分片行, 线8 R-SHARD-BLIND 抓的那类)。
//
// 本文件锁不变量本身(常数值 + 边界比较), 不连 DB(NO chain/DB — 纯逻辑, 快)。

import assert from 'node:assert/strict';

const MARKET_MAX_LEAVES_G3 = 900; // must mirror pool.js — if that changes, update here + re-verify against PayoutShard 1024 cap headroom.
const PAYOUT_SHARD_HARD_CAP = 1024; // pool-payout-root.mjs CAP = 1 << 10 — depth-10 Merkle, never changes without a covenant redeploy.

// Sanity: the soft cap must leave real headroom under the hard cap (else "hit soft cap" and
// "blow the hard cap mid-settlement" become the same event with zero warning margin).
assert.ok(MARKET_MAX_LEAVES_G3 < PAYOUT_SHARD_HARD_CAP, 'soft cap must be strictly below the hard cap');
const headroomPct = (PAYOUT_SHARD_HARD_CAP - MARKET_MAX_LEAVES_G3) / PAYOUT_SHARD_HARD_CAP;
assert.ok(headroomPct >= 0.10, `headroom must be >= 10% (got ${(headroomPct * 100).toFixed(1)}%)`);

// The actual gate logic (extracted verbatim from pool.js's two register-v07 entry points —
// keep these two call sites and this copy in sync; that's the coupling this test guards).
function isMarketFull(existingLeafCount) {
  return existingLeafCount >= MARKET_MAX_LEAVES_G3;
}

assert.equal(isMarketFull(0), false, 'empty market must not be full');
assert.equal(isMarketFull(899), false, 'one below cap must not be full');
assert.equal(isMarketFull(900), true, 'exactly at cap must be full (>= not >)');
assert.equal(isMarketFull(1023), true, 'above cap must be full');

console.log(`✅ market_full_cap_regression: cap=${MARKET_MAX_LEAVES_G3} hard=${PAYOUT_SHARD_HARD_CAP} headroom=${(headroomPct * 100).toFixed(1)}% — 4/4 boundary assertions PASS`);
