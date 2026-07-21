// _kanetui_k18_family_backfill_dryrun.mjs — K-18 §3.1 migrate v189 backfill dry-run 报告(KANet-UI, 2026-07-21)
// Bettor 派工(#ugultk): 用 GREEN 版(d829e8fe+ced75f31+09f911da)的 classifyPayoutShardFamily 对生产库
// payout_shards 全量逐行分类, 产出 family 分布 + unknown 行清单 + 在途盘(verifying/settling/collecting_sigs)
// 是否落进 unknown, 供 NWT/团队人工过一遍再决定是否真的执行 v189 的
// K18_BACKFILL_CONFIRMED=1 UPDATE(DoD-4/DoD-5 硬前置)。
//
// 只读, 零写: 全程只 SELECT + classifyPayoutShardFamily(其内部 compilePayoutShardRedeem 只是子进程编译
// 比对字节, 不碰 DB/不签名/不广播)。不执行任何 UPDATE, 不设 K18_BACKFILL_CONFIRMED, 不触碰钱路。
//
// 用法: cd kasia-console && DB_PATH=<生产库路径> node scripts/_kanetui_k18_family_backfill_dryrun.mjs

const { sqlite: db } = await import('../src/db/client.js');
const { classifyPayoutShardFamily } = await import('../src/lib/bshard-payout-family-coherence.mjs');

const IN_FLIGHT_STATUSES = new Set(['verifying', 'settling', 'collecting_sigs']);

// 注: covenant_family 列由 migrate v189 ADD COLUMN, 该迁移在 console 进程启动时才跑(runMigrations()),
// 本脚本只读诊断不代跑迁移/不重启 console——这里查询故意不选 ps.covenant_family(可能还不存在), 只用
// classifyPayoutShardFamily 纯计算(不依赖这个列, 只吃 payout_redeem_hex/pool_merkle_root/predicate_commit)。
const rows = db.prepare(`
  SELECT ps.logical_market_id, ps.payout_redeem_hex, ps.pool_merkle_root, ps.predicate_commit,
         pm.protocol_status, pm.created_at
    FROM payout_shards ps
    LEFT JOIN pool_markets pm ON pm.id = ps.logical_market_id
   ORDER BY ps.logical_market_id
`).all();

console.log(`[k18-family-backfill-dryrun] DB=${process.env.DB_PATH || '(default)'}`);
console.log(`[k18-family-backfill-dryrun] total payout_shards rows: ${rows.length}\n`);

const familyCounts = { v1_committee: 0, v2_zk: 0, unknown: 0 };
const statusCounts = {};
const unknownRows = [];
const inFlightUnknown = [];
let missingMarketCount = 0;

for (const row of rows) {
  const status = row.protocol_status || '(orphan — pool_markets 行缺失)';
  statusCounts[status] = (statusCounts[status] || 0) + 1;
  if (row.protocol_status == null) missingMarketCount++;

  const classify = classifyPayoutShardFamily(row);
  familyCounts[classify.family] = (familyCounts[classify.family] || 0) + 1;

  if (classify.family === 'unknown') {
    const entry = { marketId: row.logical_market_id, status, created_at: row.created_at, detail: classify.detail };
    unknownRows.push(entry);
    if (IN_FLIGHT_STATUSES.has(row.protocol_status)) inFlightUnknown.push(entry);
  }
}

console.log(`[k18-family-backfill-dryrun] === 聚合报告 ===`);
console.log(`总 payout_shards 行数: ${rows.length}`);
console.log(`孤儿行(payout_shards 有但 pool_markets 查不到): ${missingMarketCount}`);
console.log(`(covenant_family 列本次未查——v189 迁移未跑, console 未重启, 列可能还不存在, 本报告只测 classify 纯计算结果)`);
console.log(`\nprotocol_status 分布(全表): ${JSON.stringify(statusCounts, null, 2)}`);
console.log(`\nclassifyPayoutShardFamily 结果分布: ${JSON.stringify(familyCounts, null, 2)}`);
console.log(`\nunknown 行数: ${unknownRows.length}`);
if (unknownRows.length) {
  console.log(`unknown 行明细(逐行, 供人工归因——同款 K-18 DoD-0 triage 方法论: 按 status 分组看是否有已知假阳性模式):`);
  const byStatus = {};
  unknownRows.forEach(r => { (byStatus[r.status] = byStatus[r.status] || []).push(r); });
  for (const [status, list] of Object.entries(byStatus)) {
    console.log(`  status='${status}': ${list.length} 行`);
  }
  console.log(`\n完整 unknown 行 JSON(供存档/交叉核对):`);
  unknownRows.forEach(r => console.log(`  ${JSON.stringify(r)}`));
}

console.log(`\n🔴 在途盘(protocol_status in verifying/settling/collecting_sigs)落进 unknown: ${inFlightUnknown.length} 行`);
if (inFlightUnknown.length) {
  console.log(`⚠ 这些是活跃结算中的市场, 分类不出家族——DoD-4/DoD-5 硬前置关注点, 需要人工在装 K18_BACKFILL_CONFIRMED=1 前逐条核实原因, 不能假设它们安全:`);
  inFlightUnknown.forEach(r => console.log(`  ${JSON.stringify(r)}`));
} else {
  console.log(`✅ 零在途盘落进 unknown——但 unknown 总数是否为 0 才是 DoD-4 硬前置判据(见下), 这条只是"活跃态"这个子维度干净。`);
}

console.log(`\n结论判据(比照 K-18 DoD-0/DoD-4 先例): unknown 总行数=${unknownRows.length}。`
  + (unknownRows.length === 0
      ? ' 全部 0 → 可以支持执行 K18_BACKFILL_CONFIRMED=1 的实际 UPDATE。'
      : ' 非 0 → 不建议现在设 K18_BACKFILL_CONFIRMED=1, 需按上面明细逐行人工归因(参照今晚 K-18 DoD-0 98 条 triage 方法论: 分组假说→独立验证→坐实/证伪), 归因收敛后再决定是否执行/是否需要先修 classifyPayoutShardFamily 本身。'));

db.close();
