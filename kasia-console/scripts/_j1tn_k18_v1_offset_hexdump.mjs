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
//
// 🔴 v2(2026-07-21, NWT diff 审 d829e8fe 阻塞级发现, #ozzeu-marker-offbyone): probeStructuralSignature
// 早前版本 decodeV1State() 的 PUSH8 marker 守卫错查了 buf[0](应该是 buf[1]=_PS_STATE_START), 20+ 单元
// 断言全绿却没抓到——根因是手搓 fixture 自己也把 buf[0] 设成了 0x08, 跟错误假设自证自洽, 从没有一条走
// 真实 hex dump 字节验证过。已在 bshard-payout-family-coherence.mjs 修正(buf[1] 而不是 buf[0]), 但 NWT
// 要求这条修复必须真跑一遍真实生产数据的 probeStructuralSignature/classifyPayoutShardFamily 结果, 不能
// 只信手搓单测——本版脚本新增这一段直接调用真实函数, 打印结构化判定结果, 不需要人眼再去数 hex 偏移。

const { sqlite: db } = await import('../src/db/client.js');
const { probeStructuralSignature, classifyPayoutShardFamily } = await import('../src/lib/bshard-payout-family-coherence.mjs');

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
slicePreview('前导 byte[0](state 区之前, 不断言具体值——2026-07-21 v2 已订正: 早前误当作 marker=0x08, 实测另有其值)', 0, 1);
slicePreview('真正的 PUSH8 marker byte[1](_PS_STATE_START=1)', 1, 1);
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

// ── v2 新增(NWT diff 审阻塞级发现, 真实数据直接跑函数, 不再靠人眼数 offset) ─────────────────────
console.log(`\n[hexdump] ══════ probeStructuralSignature/classifyPayoutShardFamily 真实数据验证(NWT 要求, 2026-07-21 v2 补) ══════`);
const probeV1 = probeStructuralSignature(row, 'v1_committee');
console.log(`  probeStructuralSignature(row, 'v1_committee') = ${JSON.stringify(probeV1, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
if (!probeV1.ok) {
  console.log(`  ⚠ 真实数据 probeStructuralSignature 返回 FAIL — 若这一行是已知正常 V1 行(非 ozzeu 类可疑样本),
     说明修复后的 offset/marker 假设仍跟真实字节对不上, 需要 J1 进一步核实, 不能当 GREEN 上报。`);
} else {
  console.log(`  ✅ 真实数据 probeStructuralSignature 通过 — marker@1 检查 + predicateCommit@518/poolMerkleRoot@1002 结构签名全部跟这行真实字节吻合。`);
}
const classify = classifyPayoutShardFamily(row);
console.log(`  classifyPayoutShardFamily(row) = ${JSON.stringify(classify, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
console.log(`  (classifyPayoutShardFamily 额外跑 recompile byte-equal, 需要本机有 silverc 才会真判定出 v1_committee——
   若本机没有 D:/silverscript/versioned-builds/ 会在 try/catch 里落到 'unknown' 并记 recompile 异常原因, 那不代表
   structural 层面有问题, 请看上面 probeStructuralSignature 的结果才是本次要验证的重点。)`);

db.close();
