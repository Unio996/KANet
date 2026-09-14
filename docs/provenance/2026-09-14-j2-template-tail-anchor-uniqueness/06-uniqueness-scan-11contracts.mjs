// _j2_verify_uniqueness.mjs — Bettor 追问②: 全部 11 个主网集合约(+ 1 个无关的最小合约)各编译一次,
// 算各自编译产物与 ShardLeaf_direct 那段 132 字节稳定尾部的最长公共后缀, 确认"只有 ShardLeaf_direct
// 匹配得上"这件事, 不是巧合(比如所有 v1.0.0 合约编译器都会在尾部生成一段通用 epilogue)。
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../kasia-console/src/lib/pool-bshard-artifacts.mjs';

const Z32 = '00'.repeat(32);
const byteNode = (n) => ({ kind: 'byte', value: n });
const bytesNode = (arr) => ({ kind: 'bytes', value: arr });
const b32 = () => ctorBytes32V100(Z32);
const i = (n = 0) => ctorIntV100(n);
const ints = (n) => Array.from({ length: n }, () => i(0));

function longestCommonSuffix(a, b) {
  let n = 0;
  const max = Math.min(a.length, b.length);
  while (n < max && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

// —— ① ShardLeaf_direct baseline, 拿到那段 132 字节稳定尾部 ——
const SLD_SIL = './src/lib/ShardLeaf_direct.sil';
const sldCtor = [b32(), b32(), b32(), i(2), i(1), b32(), b32(), b32(), i(0), i(0), i(0), i(0)];
const sldScript = Buffer.from(compileSilV100(SLD_SIL, sldCtor, 'ShardLeaf_direct').script);
const STABLE_TAIL_LEN = 132;
const stableTail = sldScript.subarray(sldScript.length - STABLE_TAIL_LEN);
console.log('ShardLeaf_direct 编译产物长度:', sldScript.length, '取尾部', STABLE_TAIL_LEN, '字节作为比对基准。\n');

// —— ② 全部 11 个主网集合约(含 ShardLeaf_direct 自己, 作为 sanity check 应该=132) + 1 个无关最小合约 ——
const targets = [
  ['KanetTestToken', './src/lib/sil-v1/KanetTestToken.sil', [
    i(0), b32(), byteNode(4), byteNode(0), b32(), b32(), bytesNode(new Array(20).fill(0)), i(20), i(3), i(3),
  ]],
  ['PoolSideTicket', './src/lib/sil-v1/PoolSideTicket.sil', [b32(), i(0), i(0), b32()]],
  ['ShardLeaf_direct', SLD_SIL, sldCtor],
  ['ShardLeaf', './src/lib/ShardLeaf.sil', [b32(), b32(), b32(), i(2), i(1), b32(), i(2000000000000), b32(), i(0), i(0), i(0), i(0)]],
  ['RootClose', './src/lib/RootClose.sil', [b32(), i(2000000000000), b32(), b32(), b32(), i(0), i(0), i(0), i(0), i(0), i(0), b32()]],
  ['RootClaim', './src/lib/RootClaim.sil', [b32(), b32(), i(0), i(0), i(0), i(0), i(0), i(0), b32(), i(0), b32(), b32(), b32()]],
  ['RefundClaim', './src/lib/RefundClaim.sil', [b32(), b32(), i(0), i(0), i(0), i(0), i(0), i(0), b32(), b32(), b32(), b32()]],
  ['KanetTokenClaim', './src/lib/KanetTokenClaim.sil', [b32(), b32(), i(0), b32(), b32()]],
  ['PayoutShard', './src/lib/PayoutShard.sil', [b32(), b32(), b32(), i(0), i(0), b32(), ...ints(17), b32(), b32()]],
  ['PayoutShardV2', './src/lib/PayoutShardV2.sil', [b32(), b32(), b32(), b32(), i(0), i(0), b32(), ...ints(17), i(0), i(0), b32(), b32(), b32(), b32()]],
  ['CloseZkV2', './src/lib/CloseZkV2.sil', [b32(), b32(), b32(), i(2000000000000), i(0), i(0), b32(), i(0), ...ints(17), b32(), b32(), b32()]],
  ['MinProbe(无关最小合约, 单 entry checkSig, 与市场/代币逻辑零关联)', '../docs/provenance/2026-09-14-j2-template-tail-anchor-uniqueness/_min_probe.sil', [b32()]],
];

console.log('=== 与 ShardLeaf_direct 132 字节稳定尾部的最长公共后缀(理论上只有 ShardLeaf_direct 自己应该 =132) ===');
for (const [name, silPath, ctor] of targets) {
  try {
    const script = Buffer.from(compileSilV100(silPath, ctor, name.split('(')[0]).script);
    const lcs = longestCommonSuffix(stableTail, script);
    const flag = name.startsWith('ShardLeaf_direct') ? (lcs === STABLE_TAIL_LEN ? '✅(自比对, 预期 132)' : '🔴 自比对都对不上132, 脚本有误')
      : lcs >= STABLE_TAIL_LEN ? '🔴 危险: 达到或超过 132, 可能被冒充!' : (lcs > 0 ? '⚠ 部分重叠, 但短于132' : '✅ 零重叠');
    console.log(`${name.padEnd(65)} script长度=${script.length.toString().padStart(6)}  与稳定尾部公共后缀=${lcs.toString().padStart(4)}  ${flag}`);
  } catch (e) {
    console.log(`${name.padEnd(65)} 编译失败: ${e.message.slice(0, 120)}`);
  }
}

console.log('\n=== 补充: ShardLeaf(同族最像) 换 3 组不同 ctor 值, 确认 24 字节重叠不会因取值不同而意外逼近132 ===');
import { randomBytes } from 'node:crypto';
for (let k = 0; k < 3; k++) {
  const rnd = () => ctorBytes32V100(randomBytes(32).toString('hex'));
  const ctor = [rnd(), rnd(), rnd(), i(2), i(Math.floor(Math.random()*1e6)), rnd(), i(2000000000000 + k), rnd(), i(0), i(0), i(0), i(0)];
  const script = Buffer.from(compileSilV100('./src/lib/ShardLeaf.sil', ctor, 'ShardLeaf').script);
  const lcs = longestCommonSuffix(stableTail, script);
  console.log(`ShardLeaf 随机组 #${k}: 与 ShardLeaf_direct 稳定尾部公共后缀 = ${lcs}`);
}
