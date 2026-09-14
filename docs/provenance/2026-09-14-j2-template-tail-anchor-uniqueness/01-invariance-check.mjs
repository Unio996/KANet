// _j2_verify_template_invariance.mjs — 临时验证脚本(scratch, 不入库): 在写 proto-v0-template-anchors.mjs
// 之前, 先验证一个关键假设: ShardLeaf_direct/RootClaim/RefundClaim 的 extractTemplateArtifact 输出
// (prefix/suffix/hash) 是否真的与"非 State"的 ctor-only 常量字段的具体取值无关(只与 State 区域无关这件事
// 已经由 pool-template-artifact.mjs 的机制保证, 但"非 State 字段值不同是否导致 prefix/suffix 内容不同"
// 这一点从未在这三个合约上实测过——如果不invariant, 这三个"协议常量"的整个设计假设就是错的, 必须现在
// 发现, 不能等落码后才撞见)。
//
// 方法: 每个合约各编译两次, 用两组明显不同的占位值填非 State 字段, 断言两次的 templatePrefix/
// templateSuffix/expectedTemplateHash 是否一致。
//
// Run: cd kasia-console && node ../scratch/_j2_verify_template_invariance.mjs
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../kasia-console/src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../../../kasia-console/src/lib/pool-template-artifact.mjs';

const Z32 = '00'.repeat(32);
const F32 = 'ff'.repeat(32);
const byteNode = (n) => ({ kind: 'byte', value: n });
const bytesNode = (arr) => ({ kind: 'bytes', value: arr });

function cmpArtifacts(label, a, b) {
  const same = Buffer.compare(a.templatePrefix, b.templatePrefix) === 0
    && Buffer.compare(a.templateSuffix, b.templateSuffix) === 0
    && a.expectedTemplateHashHex === b.expectedTemplateHashHex;
  console.log(`${label}: ${same ? '✅ INVARIANT(两次占位值不同, prefix/suffix/hash 完全一致)' : '🔴 NOT INVARIANT(两次不同!! 设计假设有误, 需要重新设计)'}`);
  if (!same) {
    console.log('  prefixLenA/B:', a.templatePrefix.length, b.templatePrefix.length);
    console.log('  suffixLenA/B:', a.templateSuffix.length, b.templateSuffix.length);
    console.log('  hashA:', a.expectedTemplateHashHex);
    console.log('  hashB:', b.expectedTemplateHashHex);
  }
  return same;
}

let allOk = true;

console.log('=== ① ShardLeaf_direct: market_id/ps_tmpl_hash/shard_pool_id/rootclose_tmpl_hash/rootclose_init_payoutRoot/token_tmpl_hash/min_bet 两组不同占位值 ===');
{
  const SIL = './src/lib/ShardLeaf_direct.sil';
  const ctorA = [
    ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
    ctorIntV100(2), ctorIntV100(1),
    ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ];
  const ctorB = [
    ctorBytes32V100(F32), ctorBytes32V100(F32), ctorBytes32V100(F32),
    ctorIntV100(2), ctorIntV100(999999),
    ctorBytes32V100(F32), ctorBytes32V100(F32), ctorBytes32V100(F32),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ];
  const cA = compileSilV100(SIL, ctorA, 'ShardLeaf_direct');
  const cB = compileSilV100(SIL, ctorB, 'ShardLeaf_direct');
  const aA = extractTemplateArtifact(cA);
  const aB = extractTemplateArtifact(cB);
  allOk = cmpArtifacts('ShardLeaf_direct', aA, aB) && allOk;
  console.log('  (供后用) suffix hex(前 40 字节预览):', aA.templateSuffix.subarray(0, 40).toString('hex'));
}

console.log('\n=== ② RootClaim: shard_pool_id/claim_tmpl_hash(自引用)/market_suffix_hash 两组不同占位值 ===');
{
  const SIL = './src/lib/RootClaim.sil';
  const mk = (pad) => [
    ctorBytes32V100(Z32), // ps_tmpl_hash(协议常量占位, 两次相同——本轮只测 shard_pool_id/claim_tmpl_hash/market_suffix_hash)
    ctorBytes32V100(pad), // shard_pool_id
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(Z32), ctorIntV100(0),
    ctorBytes32V100(Z32), // token_tmpl_hash(占位, 两次相同)
    ctorBytes32V100(pad), // claim_tmpl_hash(自引用, 两次不同占位)
    ctorBytes32V100(pad), // market_suffix_hash(两次不同占位)
  ];
  const cA = compileSilV100(SIL, mk(Z32), 'RootClaim');
  const cB = compileSilV100(SIL, mk(F32), 'RootClaim');
  const aA = extractTemplateArtifact(cA);
  const aB = extractTemplateArtifact(cB);
  allOk = cmpArtifacts('RootClaim', aA, aB) && allOk;
}

console.log('\n=== ③ RefundClaim: shard_pool_id/claim_tmpl_hash(自引用)/market_suffix_hash 两组不同占位值 ===');
{
  const SIL = './src/lib/RefundClaim.sil';
  const mk = (pad) => [
    ctorBytes32V100(Z32), // ps_tmpl_hash
    ctorBytes32V100(pad), // shard_pool_id
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(Z32),
    ctorBytes32V100(Z32), // token_tmpl_hash
    ctorBytes32V100(pad), // claim_tmpl_hash(自引用)
    ctorBytes32V100(pad), // market_suffix_hash
  ];
  const cA = compileSilV100(SIL, mk(Z32), 'RefundClaim');
  const cB = compileSilV100(SIL, mk(F32), 'RefundClaim');
  const aA = extractTemplateArtifact(cA);
  const aB = extractTemplateArtifact(cB);
  allOk = cmpArtifacts('RefundClaim', aA, aB) && allOk;
}

console.log('\n=== ④ KanetTestToken: market_tmpl_suffix 两组不同占位值(同长度, 内容不同) ===');
{
  const SIL = './src/lib/sil-v1/KanetTestToken.sil';
  const mk = (fill) => [
    ctorIntV100(0), ctorBytes32V100(Z32), byteNode(4), byteNode(0), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
    bytesNode(new Array(20).fill(fill)), ctorIntV100(20),
    ctorIntV100(3), ctorIntV100(3),
  ];
  const cA = compileSilV100(SIL, mk(0x00), 'KanetTestToken');
  const cB = compileSilV100(SIL, mk(0xff), 'KanetTestToken');
  const aA = extractTemplateArtifact(cA);
  const aB = extractTemplateArtifact(cB);
  allOk = cmpArtifacts('KanetTestToken', aA, aB) && allOk;
}

console.log('\n=== ⑤ PoolSideTicket: 全部非 State 无关字段(此合约无 ctor-only 常量, 全 4 项都是 State——纯对照组, 预期天然 invariant) ===');
{
  const SIL = './src/lib/sil-v1/PoolSideTicket.sil';
  const cA = compileSilV100(SIL, [ctorBytes32V100(Z32), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(Z32)], 'PoolSideTicket');
  const cB = compileSilV100(SIL, [ctorBytes32V100(F32), ctorIntV100(1), ctorIntV100(999), ctorBytes32V100(F32)], 'PoolSideTicket');
  const aA = extractTemplateArtifact(cA);
  const aB = extractTemplateArtifact(cB);
  allOk = cmpArtifacts('PoolSideTicket', aA, aB) && allOk;
}

console.log('\n' + (allOk ? '✅ 全部 5 个合约 INVARIANT——可以放心把这些 template artifact 当协议常量算一次、全市场复用。' : '🔴 存在 NOT INVARIANT 的合约——protocol-constant 假设不成立, 必须停下重新设计, 不能继续写 anchors 脚本。'));
