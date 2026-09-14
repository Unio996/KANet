// _j2_verify_stable_tail.mjs — 找 ShardLeaf_direct 编译产物里"无论哪个非-State ctor 字段怎么变都不变"
// 的那段真正稳定的尾部长度(如果存在), 这是回答 Bettor ③ 的关键: market_tmpl_suffix 如果不是"整个
// state_layout 意义下的 suffix", 而是"某个固定短尾", 环可能就不成立。
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../kasia-console/src/lib/pool-bshard-artifacts.mjs';

const Z32 = '00'.repeat(32);
const F32 = 'ff'.repeat(32);
const SIL = './src/lib/ShardLeaf_direct.sil';

function ctorWith({ marketId = Z32, psTmplHash = Z32, shardPoolId = Z32, minBet = 1, rootcloseTmplHash = Z32, rootcloseInitPayoutRoot = Z32, tokenTmplHash = Z32 } = {}) {
  return [
    ctorBytes32V100(marketId), ctorBytes32V100(psTmplHash), ctorBytes32V100(shardPoolId),
    ctorIntV100(2), ctorIntV100(minBet),
    ctorBytes32V100(rootcloseTmplHash), ctorBytes32V100(rootcloseInitPayoutRoot), ctorBytes32V100(tokenTmplHash),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ];
}

function scriptOf(ctor) {
  return Buffer.from(compileSilV100(SIL, ctor, 'ShardLeaf_direct').script);
}

function longestCommonSuffix(a, b) {
  let n = 0;
  const max = Math.min(a.length, b.length);
  while (n < max && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

const baseline = scriptOf(ctorWith());
console.log('baseline 全脚本长度:', baseline.length);

const variants = [
  ['全部换 F32/大 min_bet', ctorWith({ marketId: F32, psTmplHash: F32, shardPoolId: F32, minBet: 987654321, rootcloseTmplHash: F32, rootcloseInitPayoutRoot: F32, tokenTmplHash: F32 })],
  ['只换 token_tmpl_hash', ctorWith({ tokenTmplHash: F32 })],
  ['只换 shard_pool_id', ctorWith({ shardPoolId: F32 })],
  ['只换 min_bet(1→987654321)', ctorWith({ minBet: 987654321 })],
  ['只换 rootclose_tmpl_hash', ctorWith({ rootcloseTmplHash: F32 })],
];

let minStable = Infinity;
for (const [label, ctor] of variants) {
  const s = scriptOf(ctor);
  const lcs = longestCommonSuffix(baseline, s);
  console.log(`${label}: 脚本长度=${s.length}, 与 baseline 共同尾部长度=${lcs}`);
  minStable = Math.min(minStable, lcs);
}

console.log('\n所有变体共同的最小稳定尾部长度 =', minStable, '字节');
if (minStable > 0) {
  console.log('稳定尾部内容(hex):', baseline.subarray(baseline.length - minStable).toString('hex'));
  console.log('→ 如果这个值 > 0 且在所有实验里都稳定, 说明确实存在一段"无论 ctor 非-State 字段怎么变都不变"的');
  console.log('  固定尾部字节, market_tmpl_suffix 若被设计为"取这段固定尾部的一部分", 环可能不成立(需要);');
  console.log('  但如果 minStable 很小(比如 < market_tmpl_suffix_len 实际需要的长度), 仍然不够用。');
} else {
  console.log('→ 不存在任何稳定尾部, market_tmpl_suffix 无法脱离 token_tmpl_hash/shard_pool_id 等非-State 字段的值, 环是真实存在的。');
}

console.log('\n=== 补充: 5 组随机值(排除 F32 巧合)再验一遍最小稳定尾部 ===');
import('node:crypto').then(({ randomBytes }) => {
  let minR = Infinity;
  for (let i = 0; i < 5; i++) {
    const rnd = () => randomBytes(32).toString('hex');
    const s = scriptOf(ctorWith({ marketId: rnd(), psTmplHash: rnd(), shardPoolId: rnd(), minBet: Math.floor(Math.random() * 1e9), rootcloseTmplHash: rnd(), rootcloseInitPayoutRoot: rnd(), tokenTmplHash: rnd() }));
    const lcs = longestCommonSuffix(baseline, s);
    console.log(`随机组 #${i}: 共同尾部长度=${lcs}`);
    minR = Math.min(minR, lcs);
  }
  console.log('5 组随机值最小稳定尾部 =', minR, '(与之前 132 对比)');
});
