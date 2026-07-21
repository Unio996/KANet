// _j1tn_k18_v1_structural_probe.mjs — K-18 §3.3(b) 结构探针, V1 侧(2026-07-21)
// docs/2026-07-18-payoutshard-family-coherence-gate-design.md §3.3(b): "结构探针: stored payout_redeem_hex
// 的家族判别——复用 readPayoutShardV2AttestedState 的 fail-closed 手法(bshard-close-enforce.mjs:196-218,
// 长度/marker/值域三重), V1 侧同款写一个"。
//
// 背景: K-18 §3.4 backfill dry-run(dacafdb9 v2)收窄后仍有 7-8 个 verifying 状态市场(7jy3s/s6zwj/tha3l/
// 9ez2u/9jaty/j34vb/3mzoh + kr5l4 待查)的 payout_redeem_hex 跟 compilePayoutShardRedeem(closed:0) 重编译
// 对不上, KANet-UI 地面核实已排除 refund-close/V2-ZK 家族/D-001 编译器版本/cohort B 四个假说, 交回给需要
// 读 covenant 字节结构的人(K18 作者域)。本脚本只做诊断输出(storedLen + 关键 offset 解码值 + 跟一个
// 已知正常 V1 行的对比), 不下结论——数值异常与否需要人眼判断, 脚本负责把该看的字段摆出来。
//
// 只读, 零写。用法(在有生产库的机器):
//   cd kasia-console && DB_PATH=<生产库路径> node scripts/_j1tn_k18_v1_structural_probe.mjs <marketId1> <marketId2> ...
//   不传参数 = 探这 8 个默认 ID(7jy3s/s6zwj/tha3l/9ez2u/9jaty/j34vb/3mzoh/kr5l4 的 ext-pool-v07 前缀需要
//   补全——本机(J1tn)不知道完整 id, 若默认列表匹配不到行, 请显式传完整 marketId)。

const { sqlite: db } = await import('../src/db/client.js');

const DEFAULT_SUFFIXES = ['7jy3s', 's6zwj', 'tha3l', '9ez2u', '9jaty', 'j34vb', '3mzoh', 'kr5l4'];
const args = process.argv.slice(2);

let targets;
if (args.length > 0) {
  targets = args;
} else {
  // 后缀模糊匹配(本机不知道完整 id 中间的时间戳段)
  const like = DEFAULT_SUFFIXES.map(() => `logical_market_id LIKE ?`).join(' OR ');
  const params = DEFAULT_SUFFIXES.map(s => `%${s}`);
  targets = db.prepare(`SELECT logical_market_id FROM payout_shards WHERE ${like}`).all(...params).map(r => r.logical_market_id);
  console.log(`[v1-structural-probe] 未传参数, 用后缀模糊匹配到 ${targets.length}/${DEFAULT_SUFFIXES.length} 个默认目标: ${JSON.stringify(targets)}`);
}

// 对照组: 抽一个已知 MATCH(splice==recompile 正常)的 V1 行做基线, 供肉眼对比字段是否同形状。
const baseline = db.prepare(`
  SELECT ps.logical_market_id, ps.payout_redeem_hex, pm.protocol_status
    FROM payout_shards ps JOIN pool_markets pm ON pm.id = ps.logical_market_id
   WHERE pm.protocol_status = 'completed' LIMIT 1
`).get();

function dump(label, marketId, redeemHex) {
  if (!redeemHex) { console.log(`[${label}] ${marketId}: 未找到该行(payout_shards 里没有这个 marketId, 检查 id 是否完整/拼写)`); return; }
  const b = Buffer.from(redeemHex, 'hex');
  console.log(`\n[${label}] ${marketId}`);
  console.log(`  byteLength: ${b.length}`);
  console.log(`  hex[0..2]: ${b.slice(0, 2).toString('hex')} (期望 byte[1]=08=PUSH8 marker, 若不是说明 state 区起点不在预期 offset 1)`);
  // consolidated_pool: offset 2, i64LE, 8 bytes (紧跟 PUSH8 marker 之后)
  let cp = null;
  try { cp = b.readBigInt64LE(2).toString(); } catch (e) { cp = `解码失败: ${e.message}`; }
  console.log(`  consolidatedPool(offset 2, i64LE): ${cp} ${/^\d+$/.test(String(cp)) && BigInt(cp) >= 0n && BigInt(cp) < 10n ** 15n ? '(数值域看起来合理, <10^15 sompi=<1000万KAS)' : '(⚠ 数值域看起来不合理, 需要人眼核实是不是解码位置错了)'}`);
  console.log(`  hex[10..12](state 区后一段, 紧跟 consolidatedPool 之后, 预期是下一个字段的 PUSH marker): ${b.slice(10, 12).toString('hex')}`);
  console.log(`  hex 前 60 字节预览: ${b.slice(0, 60).toString('hex')}`);
  console.log(`  hex 末 30 字节预览: ${b.slice(-30).toString('hex')}`);
}

if (baseline) {
  dump('BASELINE(completed 状态已知正常行)', baseline.logical_market_id, baseline.payout_redeem_hex);
} else {
  console.log('[v1-structural-probe] ⚠ 找不到任何 completed 状态的 payout_shards 行做基线对比, 只能看目标行自身数值是否在合理范围, 没有同库对照样本');
}

for (const t of targets) {
  const row = db.prepare('SELECT logical_market_id, payout_redeem_hex, pool_merkle_root, predicate_commit FROM payout_shards WHERE logical_market_id = ?').get(t)
    || db.prepare('SELECT logical_market_id, payout_redeem_hex, pool_merkle_root, predicate_commit FROM payout_shards WHERE logical_market_id LIKE ?').get(`%${t}%`);
  dump('TARGET', t, row?.payout_redeem_hex);
  if (row) {
    console.log(`  pool_merkle_root: ${row.pool_merkle_root?.slice(0, 16)}… (${row.pool_merkle_root?.length} hex chars, 期望 64=32B)`);
    console.log(`  predicate_commit: ${row.predicate_commit?.slice(0, 16)}… (${row.predicate_commit?.length} hex chars, 期望 64=32B)`);
  }
}

console.log(`\n[v1-structural-probe] 完成, 零写。上面每个 TARGET 行的 byteLength/consolidatedPool 解码值/hex 预览
请跟 BASELINE 对比——如果 byteLength 明显不同(比如报告里提到的 22196/16564 vs 正常应该是 21792)或
consolidatedPool 解码出荒谬数值, 说明这行的 payout_redeem_hex 结构本身就跟当前 compilePayoutShardRedeem
模板不是同一种形状(可能是更早期的 schema/字段布局, 也可能是数据本身有问题)——具体是哪种需要人工读 hex
预览比对, 本脚本不下结论。`);

db.close();
