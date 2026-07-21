// _j1tn_k18_v1_offset_hexdump.mjs — K-18 §5.1 MUST-FIX① 硬前置(2026-07-21)
// docs/2026-07-21-p2-batch1-truth-source-layer-k18-landing-design.md §1/§5.1: P2 设计稿的字节偏移表
// (poolMerkleRoot/predicateCommit 常量区 vs consolidated_pool/closed/payoutRoot/w0..16 state 区的相对
// 位置)只是从 ctor 参数顺序推断, 落码前必须用一个已知 V1 行的真实 hex dump 逐字段核对——先 dump 后写
// offset, 不是先写后验证。本脚本只读、零写, 输出一个已知正常 V1 行(protocol_status='completed')的
// payout_redeem_hex 全量 hex + 按 §1 表格候选 offset 切片预览, 供人眼(J1)核对候选 offset 对不对。
//
// 用法: cd kasia-console && DB_PATH=<生产库路径> node scripts/_j1tn_k18_v1_offset_hexdump.mjs [marketId]
//   不传 marketId = 自动挑一个 completed 状态的 V1 行(排除已知 attested_v2/pruned_expired_waived 等非
//   V1 家族嫌疑行)。

const { sqlite: db } = await import('../src/db/client.js');

const argMarketId = process.argv[2] || null;
const row = argMarketId
  ? db.prepare('SELECT ps.*, pm.protocol_status FROM payout_shards ps LEFT JOIN pool_markets pm ON pm.id = ps.logical_market_id WHERE ps.logical_market_id = ?').get(argMarketId)
  : db.prepare(`
      SELECT ps.*, pm.protocol_status FROM payout_shards ps
        JOIN pool_markets pm ON pm.id = ps.logical_market_id
       WHERE pm.protocol_status = 'completed'
       LIMIT 1
    `).get();

if (!row) {
  console.log('[hexdump] 没找到符合条件的行, 传一个已知 V1 completed 状态的 marketId 试试。');
  process.exit(1);
}

console.log(`[hexdump] marketId=${row.logical_market_id} protocol_status=${row.protocol_status}`);
console.log(`[hexdump] payout_redeem_hex 长度: ${row.payout_redeem_hex.length} hex chars = ${row.payout_redeem_hex.length / 2} bytes`);

const buf = Buffer.from(row.payout_redeem_hex, 'hex');

console.log(`\n[hexdump] 全量 hex(每 32 字节一行, 附 byte offset):`);
for (let i = 0; i < buf.length; i += 32) {
  const chunk = buf.slice(i, i + 32);
  console.log(`  [${String(i).padStart(5, ' ')}] ${chunk.toString('hex')}`);
}

console.log(`\n[hexdump] §1 表格候选 offset 切片预览(人工核对是否对上真实字段边界):`);
function slicePreview(label, off, len) {
  if (off + len > buf.length) { console.log(`  ${label}(offset ${off}, ${len}B): 越界(buf 长度 ${buf.length})`); return; }
  console.log(`  ${label}(offset ${off}, ${len}B): ${buf.slice(off, off + len).toString('hex')}`);
}
// _PS_STATE_START=1 起算(bshard-close-enforce.mjs 现成 helper 用的 offset, 已验证过 state 区本身正确):
slicePreview('state 区起点 marker byte[0]', 0, 1);
slicePreview('consolidated_pool(PUSH8 marker + i64LE)', 1, 9);
try { console.log(`    → 解码 consolidated_pool = ${buf.readBigInt64LE(2)} sompi`); } catch {}
slicePreview('closed(PUSH8 marker + i64LE)', 10, 9);
try { console.log(`    → 解码 closed = ${buf.readBigInt64LE(11)}`); } catch {}
slicePreview('payoutRoot(PUSH32 marker + 32B)', 19, 33);
slicePreview('w0(第一个 nullifier word)', 52, 9);

console.log(`\n[hexdump] 【待人工核实的部分——本脚本不猜】ctor 常量区(poolMerkleRoot/predicateCommit)在这份
redeem 里到底在 state 区(byte 0~204)之前还是之后, 需要人眼比对:`);
console.log(`  DB 里记录的 pool_merkle_root: ${row.pool_merkle_root}`);
console.log(`  DB 里记录的 predicate_commit: ${row.predicate_commit}`);
console.log(`  → 拿这两个值(去掉 0x 前缀的话)去全量 hex 里搜, 看它们实际出现在 buf 的哪个 offset 区间——
     如果出现在 offset 205 之后(state 区结束之后), 支持"常量区在 state 区后面"; 如果出现在 offset 0 之前
     不可能(state 区从 0 开始), 那只可能是"常量区在 state 区前面但 state 区起点不是 offset 0"——这种情况
     需要重新定位 state 区真实起点, 不能默认 _PS_STATE_START=1 全局适用(那个常量是从别的函数抄来的,
     语境是"已经知道 psRedeemHex 是纯 state 区" vs 这里是"完整 redeem 包含 ctor+state"两种可能不同的输入)。`);

const poolMerkleRootHex = String(row.pool_merkle_root || '').replace(/^0x/, '').toLowerCase();
const predicateCommitHex = String(row.predicate_commit || '').replace(/^0x/, '').toLowerCase();
const fullHex = buf.toString('hex');
if (poolMerkleRootHex) {
  const idx = fullHex.indexOf(poolMerkleRootHex);
  console.log(`\n  poolMerkleRoot 在 hex 字符串里的位置: ${idx === -1 ? '未找到(可能有 push-opcode 包裹/编码差异, 需要人工再查)' : `hex 字符 offset ${idx} = byte offset ${idx / 2}`}`);
}
if (predicateCommitHex) {
  const idx = fullHex.indexOf(predicateCommitHex);
  console.log(`  predicateCommit 在 hex 字符串里的位置: ${idx === -1 ? '未找到(可能有 push-opcode 包裹/编码差异, 需要人工再查)' : `hex 字符 offset ${idx} = byte offset ${idx / 2}`}`);
}

db.close();
