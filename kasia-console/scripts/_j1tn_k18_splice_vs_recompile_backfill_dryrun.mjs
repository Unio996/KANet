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

// v2(2026-07-21, 首次 dry-run 后 NWT/KANet-UI/J2 三方地面核实追加): 首版只排除 completed/settle_failed,
// 结果 98 条 MISMATCH 里绝大多数是范围选错的假阳性, 不是真漂移——地面核实坐实的两类假阳性:
//   ①已经不在 closed:0 阶段(refunded 65 条全部有真实 refund_txid 落链, 已经过 refund-close 甚至更后)。
//   ②V2/ZK 家族被拿 V1 编译器错比(attested_v2 全部 + verifying 里混进的 8pson 这类——8pson 是 K-18 §4
//     自己举的已知 incoherent 家族错配范例, protocol_status='verifying' 但实为 V2, 光看状态名筛不出来,
//     这是本版新加 zk_native 过滤的直接动机)。
// v2 收窄口径(两层过滤, 都是保守的"宁可漏查也不可能瞎报"方向——即: 排除标准必须有实证支持, 拿不准的
// 状态一律留在比对范围内, 报告里能看见, 不能悄悄滤掉真正该查的行):
//   TERMINAL: completed/settle_failed(原有)+ refunded/refunding/cancelled(已确认或强烈暗示已过 closed:0
//     阶段, 不该拿 closed:0 模板比)。pruned_expired_waived 保留在范围内(git 全历史搜索零代码路径写过
//     这个状态, 语义不明, 不能假设它已过 closed:0——留着比, 报告里仍能看见它, 交给人工归因)。
//   FAMILY: resolution_rule_spec.zk_native === true 的行排除(V2/ZK 家族, 不该用 compilePayoutShardRedeem
//     这个 V1 专属函数比)。诚实标注: 这个字段本身是可变标记(K-18 §2 原话"唯一家族选择器=可变标记"的
//     那个问题字段), 不是 K-18 §3.1 要建的那个不可变 covenant_family 列(那个还没落地)——用它做过滤只是
//     "目前能拿到的最好信号", 不是权威判定, 报告里仍会把这些行单独列出(不是直接丢弃不报)。
const TERMINAL_STATUSES = new Set(['completed', 'settle_failed', 'refunded', 'refunding', 'cancelled']);

const rows = db.prepare(`
  SELECT ps.logical_market_id, ps.payout_redeem_hex, ps.pool_merkle_root, ps.predicate_commit, ps.payout_ps_outpoint,
         pm.protocol_status, pm.resolution_rule_spec
    FROM payout_shards ps
    LEFT JOIN pool_markets pm ON pm.id = ps.logical_market_id
   ORDER BY ps.logical_market_id
`).all();

console.log(`[k18-backfill-dryrun] DB=${process.env.DB_PATH || '(default ./data/console.db relative to invocation cwd)'}`);
console.log(`[k18-backfill-dryrun] total payout_shards rows: ${rows.length}\n`);

const results = [];
const statusCounts = {};
let matchCount = 0, mismatchCount = 0, recompileFailCount = 0, missingMarketCount = 0;

let familyExcludedCount = 0;
const familyExcludedRows = [];

for (const row of rows) {
  const status = row.protocol_status || '(pool_markets row missing — orphan payout_shards)';
  statusCounts[status] = (statusCounts[status] || 0) + 1;
  if (row.protocol_status == null) missingMarketCount++;

  const isActive = !TERMINAL_STATUSES.has(row.protocol_status);
  if (!isActive) continue;   // 只报活跃态(K-18 §3.4 明确范围), 但上面的 statusCounts 已经统计了全表分布

  let isZkNative = false;
  try { isZkNative = JSON.parse(row.resolution_rule_spec || '{}')?.zk_native === true; } catch {}
  if (isZkNative) {
    familyExcludedCount++;
    familyExcludedRows.push({ marketId: row.logical_market_id, status });
    continue;   // V2/ZK 家族, 不该拿 V1 的 compilePayoutShardRedeem 比——单独列出不是悄悄丢弃, 见下方汇总
  }

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

console.log(`\n[k18-backfill-dryrun] === 聚合报告(v2, 收窄口径) ===`);
console.log(`总 payout_shards 行数: ${rows.length}`);
console.log(`protocol_status 分布(全表, 未过滤): ${JSON.stringify(statusCounts, null, 2)}`);
console.log(`孤儿行(payout_shards 有但 pool_markets 查不到对应市场): ${missingMarketCount}`);
console.log(`TERMINAL 排除(completed/settle_failed/refunded/refunding/cancelled): 参见上方 protocol_status 分布自行相减`);
console.log(`FAMILY 排除(resolution_rule_spec.zk_native===true, 疑似 V2/ZK 家族被拿 V1 编译器错比): ${familyExcludedCount} 行`);
if (familyExcludedRows.length) {
  console.log(`  family-excluded 明细(未丢弃, 只是不纳入本次 V1 recompile 比对——供人工确认这个判断本身对不对):`);
  familyExcludedRows.forEach(r => console.log(`    ${JSON.stringify(r)}`));
}
console.log(`--- 收窄后仍纳入比对(疑似 V1 家族 + 疑似仍在 pre-close 阶段)的 splice-vs-recompile 结果 ---`);
console.log(`MATCH(splice==recompile, byte-exact): ${matchCount}`);
console.log(`MISMATCH(不一致, K-18 硬闸拦这类): ${mismatchCount}`);
console.log(`DECODE_FAIL/RECOMPILE_FAIL(读不出/编不出, 需人工核): ${recompileFailCount}`);
console.log(`\n结论判据(K-18 §3.4): MISMATCH+FAIL 都为 0 → 可以把当前 v0.3 的非阻塞 recompile 校验升级为
硬拒绝闸(hard gate); 只要有一个非零, 必须先人工过一遍这份报告逐行确认原因(§3.4 原话"全部一致才能真正
切换默认权威", 不接受抽样/大部分一致就切)。**v2 诚实边界**: TERMINAL/FAMILY 排除都是基于现有 schema 能
拿到的最好信号(protocol_status 语义 + zk_native 可变标记), 不是 K-18 §3.1 要建的那个不可变
covenant_family 列(还没落地)——排除掉的行不代表"确认无问题", 只代表"用这版脚本的方法论测不出有意义
的信号, 该用别的方法核"。首版(TERMINAL 只排 completed/settle_failed)跑出的 98 条 MISMATCH, 经
NWT/KANet-UI/J2 三方地面核实(refund_txid 实据/8pson 等已知家族错配样本/created_at 时间窗排除 D-001
假说), 已收窄到一个小得多的真正待归因集合——这版脚本的排除逻辑是把那次人工核实的结论回写成可复现的
自动化过滤, 不是凭空新猜的规则。`);

if (mismatchCount > 0 || recompileFailCount > 0) {
  console.log(`\n⚠ 有 ${mismatchCount + recompileFailCount} 行不一致/失败, 完整逐行记录见上方 JSON 输出——`
    + `请把本次运行的完整 stdout 存档(如重定向到文件)供 NWT/团队复核, 不要只贴聚合数字。`);
}

db.close();
