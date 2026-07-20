// _j1tn_k18_splice_vs_recompile_backfill_dryrun.mjs — K-18 §3.4 硬前置(NWT MUST-FIX②, 2026-07-21)
// docs/2026-07-18-payoutshard-family-coherence-gate-design.md §3.4:
//   "权威切换前, 对现网所有处于 verifying/settling 活跃态的 V1 盘(全量, 非抽样)跑 splice 结果 vs
//    recompile 结果的 byte-exact 对照, 逐行记录, 全部一致才能真正切默认权威"
// 关联: docs/2026-07-21-p0-consolidated-pool-rederive-implementation-plan.md §3b/§5 DoD-4(v0.3)。
//
// 只读, 不写任何数据, 不广播, 不触碰钱路——诊断脚本(命名跟随既有 _<agent>_<purpose>.mjs 惯例,
// 落 kasia-console/scripts/, 跟 _j2tn_dryrun_committee_sample.mjs 等同类脚本同款位置, 便于跨机器
// 拉取运行——不放 scratch/, 那个目录 gitignore, KANet-UI 拉不到)。
//
// 为什么本机(J1tn)跑不了: 需要①生产 console.db(本机是独立 TN12 节点自己的库, payout_shards=0 行,
// bshard 状态不跨节点同步)②pinned silverc 二进制(D:/silverscript/versioned-builds/ 本机不存在)——两个
// 都只有 operator/KANet-UI 主机有。J1 出脚本, 请在有权限的机器上跑, DB_PATH 按实际生产库路径传。
//
// 用法(在 kasia-console/ 目录下跑, 跟项目其它脚本同款相对位置约定):
//   cd kasia-console && node scripts/_j1tn_k18_splice_vs_recompile_backfill_dryrun.mjs
//   (默认读 ./data/console.db, 可用 DB_PATH env 覆盖成生产库真实路径)
//
// 输出: 逐行 JSON 记录(每个 payout_shards 行的 splice==recompile 判定)+ 末尾聚合报告(总行数/一致数/
// 不一致数/recompile 失败数, 按 pool_markets.protocol_status 分布)。
//
// 只读性质说明: 复用项目自己的 sqlite client(src/db/client.js, 跟其它脚本同款连接方式, 没有独立
// readonly 模式)但本脚本代码里只有 SELECT, 零 UPDATE/INSERT/DELETE——不需要额外 readonly flag 也不会
// 写数据, 少一层跟生产 client 不一致的连接逻辑。

const { sqlite: db } = await import('../src/db/client.js');

// compilePayoutShardRedeem 依赖 silverc 子进程(pool-shard-register.mjs → pool-bshard-artifacts.mjs
// compileSil), 本脚本直接 import 复用同一份权威实现, 不重新发明编译逻辑。
const { compilePayoutShardRedeem } = await import('../src/lib/pool-shard-register.mjs');

// K-18 §3.4 范围 = "verifying/settling 活跃态"——本库 protocol_status 是自由文本无 CHECK 约束(migrate.js
// pool_markets v46 定义), 已知会出现的值(读码坐实, 非猜): pending_bettors/verifying/completed/
// settled_partial_claims/needs_manual_attribution/settle_failed/zk_ready/zk_settled。终态(不应还有可花费
// PS 状态需要担心 splice/recompile 分歧的)= completed/settle_failed(daemon 已放弃重试)。其余一律算"活跃"
// 保守纳入(宁可多查不可漏查, 报告里会显示每个状态各多少行, 人工过一遍确认没漏)。
const TERMINAL_STATUSES = new Set(['completed', 'settle_failed']);

const rows = db.prepare(`
  SELECT ps.logical_market_id, ps.payout_redeem_hex, ps.pool_merkle_root, ps.predicate_commit, ps.payout_ps_outpoint,
         pm.protocol_status
    FROM payout_shards ps
    LEFT JOIN pool_markets pm ON pm.id = ps.logical_market_id
   ORDER BY ps.logical_market_id
`).all();

console.log(`[k18-backfill-dryrun] DB=${process.env.DB_PATH || '(default ./data/console.db relative to invocation cwd)'}`);
console.log(`[k18-backfill-dryrun] total payout_shards rows: ${rows.length}\n`);

const results = [];
const statusCounts = {};
let matchCount = 0, mismatchCount = 0, recompileFailCount = 0, missingMarketCount = 0;

for (const row of rows) {
  const status = row.protocol_status || '(pool_markets row missing — orphan payout_shards)';
  statusCounts[status] = (statusCounts[status] || 0) + 1;
  if (row.protocol_status == null) missingMarketCount++;

  const isActive = !TERMINAL_STATUSES.has(row.protocol_status);
  if (!isActive) continue;   // 只报活跃态(K-18 §3.4 明确范围), 但上面的 statusCounts 已经统计了全表分布

  let consolidatedPool;
  try {
    consolidatedPool = Buffer.from(row.payout_redeem_hex, 'hex').readBigInt64LE(2).toString();
  } catch (e) {
    results.push({ marketId: row.logical_market_id, status, verdict: 'DECODE_FAIL', error: e.message });
    recompileFailCount++;
    continue;
  }

  let recompiled;
  try {
    recompiled = compilePayoutShardRedeem({
      poolMerkleRoot: row.pool_merkle_root, predicateCommit: row.predicate_commit,
      consolidatedPool, closed: 0,
    });
  } catch (e) {
    results.push({ marketId: row.logical_market_id, status, verdict: 'RECOMPILE_FAIL', error: e.message });
    recompileFailCount++;
    continue;
  }

  const match = recompiled === row.payout_redeem_hex;
  if (match) matchCount++; else mismatchCount++;
  results.push({
    marketId: row.logical_market_id, status, verdict: match ? 'MATCH' : 'MISMATCH',
    consolidatedPool, storedLen: row.payout_redeem_hex.length, recompiledLen: recompiled.length,
  });
  console.log(JSON.stringify(results[results.length - 1]));
}

console.log(`\n[k18-backfill-dryrun] === 聚合报告 ===`);
console.log(`总 payout_shards 行数: ${rows.length}`);
console.log(`protocol_status 分布: ${JSON.stringify(statusCounts, null, 2)}`);
console.log(`孤儿行(payout_shards 有但 pool_markets 查不到对应市场): ${missingMarketCount}`);
console.log(`--- 活跃态(非 completed/settle_failed)范围内 splice-vs-recompile 结果 ---`);
console.log(`MATCH(splice==recompile, byte-exact): ${matchCount}`);
console.log(`MISMATCH(不一致, K-18 硬闸拦这类): ${mismatchCount}`);
console.log(`DECODE_FAIL/RECOMPILE_FAIL(读不出/编不出, 需人工核): ${recompileFailCount}`);
console.log(`\n结论判据(K-18 §3.4): MISMATCH+FAIL 都为 0 → 可以把当前 v0.3 的非阻塞 recompile 校验升级为
硬拒绝闸(hard gate); 只要有一个非零, 必须先人工过一遍这份报告逐行确认原因(§3.4 原话"全部一致才能真正
切换默认权威", 不接受抽样/大部分一致就切)。`);

if (mismatchCount > 0 || recompileFailCount > 0) {
  console.log(`\n⚠ 有 ${mismatchCount + recompileFailCount} 行不一致/失败, 完整逐行记录见上方 JSON 输出——`
    + `请把本次运行的完整 stdout 存档(如重定向到文件)供 NWT/团队复核, 不要只贴聚合数字。`);
}

db.close();
