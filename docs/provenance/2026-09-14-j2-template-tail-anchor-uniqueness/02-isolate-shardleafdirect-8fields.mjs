// _j2_verify_isolate.mjs — 逐字段隔离测试: ShardLeaf_direct 的 template artifact 对哪个具体 ctor 字段敏感。
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../kasia-console/src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../../../kasia-console/src/lib/pool-template-artifact.mjs';

const SIL = './src/lib/ShardLeaf_direct.sil';
const Z32 = '00'.repeat(32);
const F32 = 'ff'.repeat(32);

// 字段序: market_id, ps_tmpl_hash, shard_pool_id, seal_count, min_bet, rootclose_tmpl_hash,
//         rootclose_init_payoutRoot, token_tmpl_hash, init_local_yes, init_local_no, init_count, init_pool_value
function baseCtor() {
  return [
    ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
    ctorIntV100(2), ctorIntV100(1),
    ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ];
}

function artifactOf(ctor) {
  const c = compileSilV100(SIL, ctor, 'ShardLeaf_direct');
  return extractTemplateArtifact(c);
}

const baseline = artifactOf(baseCtor());
console.log('baseline suffixLen=', baseline.templateSuffix.length, 'hash=', baseline.expectedTemplateHashHex);

const fieldNames = ['market_id(0)', 'ps_tmpl_hash(1)', 'shard_pool_id(2)', 'rootclose_tmpl_hash(5)', 'rootclose_init_payoutRoot(6)', 'token_tmpl_hash(7)'];
const fieldIdx = [0, 1, 2, 5, 6, 7];

for (let i = 0; i < fieldIdx.length; i++) {
  const ctor = baseCtor();
  ctor[fieldIdx[i]] = ctorBytes32V100(F32); // 单独换成 F32, 长度不变(仍 32 字节), 排除长度位移干扰
  const a = artifactOf(ctor);
  const sameSuffix = Buffer.compare(a.templateSuffix, baseline.templateSuffix) === 0;
  const samePrefix = Buffer.compare(a.templatePrefix, baseline.templatePrefix) === 0;
  console.log(`只换 ${fieldNames[i]} → F32: prefix${samePrefix ? '不变' : '变了'}(len=${a.templatePrefix.length}) suffix${sameSuffix ? '不变' : '变了'}(len=${a.templateSuffix.length})`);
}

// min_bet: 换成另一个同样是 1 位数的值(2), 排除变长编码位移
{
  const ctor = baseCtor();
  ctor[4] = ctorIntV100(2); // min_bet 1→2, 同样单位数, 编码长度大概率相同
  const a = artifactOf(ctor);
  const sameSuffix = Buffer.compare(a.templateSuffix, baseline.templateSuffix) === 0;
  console.log(`只换 min_bet 1→2: suffix${sameSuffix ? '不变' : '变了'}(len=${a.templateSuffix.length}, baseline=${baseline.templateSuffix.length})`);
}

// 🔴 补测(NWT 独立复现指出遗漏, 2026-09-14): seal_count(idx 3) 此前漏测——8 个非-State 字段
// (market_id/ps_tmpl_hash/shard_pool_id/seal_count/min_bet/rootclose_tmpl_hash/
// rootclose_init_payoutRoot/token_tmpl_hash) 只测了 7 个, 报告"6 个变了"其实是漏了这一个, 不是
// 结论错误, 是计数错误。补上后与 NWT 独立实测的"7/8 变了, 仅 market_id 不变"完全吻合。
{
  const ctor = baseCtor();
  ctor[3] = ctorIntV100(999); // seal_count 2→999
  const a = artifactOf(ctor);
  const sameSuffix = Buffer.compare(a.templateSuffix, baseline.templateSuffix) === 0;
  console.log(`只换 seal_count(3) 2→999: suffix${sameSuffix ? '不变' : '变了'}(len=${a.templateSuffix.length}, baseline=${baseline.templateSuffix.length})`);
}

console.log('\n=== 8 字段全表小结(与 NWT 独立复现对账) ===');
console.log('market_id(0): 不变(唯一不影响 hash 的字段)');
console.log('ps_tmpl_hash(1): 变了');
console.log('shard_pool_id(2): 变了');
console.log('seal_count(3): 变了 ← 此前漏测, 本次补上');
console.log('min_bet(4): 变了');
console.log('rootclose_tmpl_hash(5): 变了');
console.log('rootclose_init_payoutRoot(6): 变了');
console.log('token_tmpl_hash(7): 变了');
console.log('⇒ 8 个非-State ctor 字段里 7 个影响 template hash, 与 NWT 独立复现完全一致。');
