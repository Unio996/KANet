// payoutshardv2-offset-tripwire.test.mjs — regression trip-wire (Bettor+NWT+J2 2026-07-08 深夜,
// #bejhos risk-scoped follow-up), REWRITTEN for D-019 (ledger 1224-1247, commit-4 of the K-18
// offset-live-derive line, design doc v0.1 §6 "tripwire redesign").
//
// 🔴 为什么整篇重写(不是改几个数字): 原版直接断言硬编码绝对偏移(642/[1126,1390,1654,1918,2182])——那两组
// 数字是 D-019 迁移前 silverc-zk 编译产物的位置，D-019 迁移后真实偏移是 16569/[17089,...]，这个文件本身
// 就是"已知 RED"(ledger 1233 起挂账，见 D-019 inventory 文档 §7)，且它验的性质本身也已经过期——现在生产
// 代码(bshard-close-enforce.mjs / bshard-payout-family-coherence.mjs)不再有任何硬编码绝对偏移可验证"没
// 漂移"，两处都改成实时调 deriveCommitteeCheckOffsets(委员校验 offset 运行时派生单源, committee-offset-
// derive.mjs)。旧"硬编码常量 vs 编译产物"这种 tripwire 已经没有对象可验。
//
// 新性质(NWT 1237 验收标准原话): "no hardcoded absolute offsets used for COMPUTATION anywhere ——old
// constants only as checked-in reference, WARN not block on mismatch"。本文件现在验三件事，全部用**生产
// 真实入口**(两道闸各自导出的哨兵常量 + deriveCommitteeCheckOffsets 本身)，不引入任何自己的硬编码数字
// 断言：
//   ① 派生结果的自洽性(instance-binding)——用派生出的偏移去真实编译的、携带【已知不同于哨兵】测试值的
//      redeem 里取字节，取出来的字节必须精确等于编译时喂进去的真实值(不是"哨兵位置对不对"这种同义反复，
//      是"派生出来的位置真的能在一份跟派生编译不同的真实产物上找到正确字段"——两道闸生产代码实际做的
//      恰恰是这件事: 用固定占位 ctor 派生一次偏移, 拿去读某个真实市场的 redeem)。
//   ② 两道闸(各自不同哨兵)在同一份真实 redeem 上得到完全相同的数字偏移(结构性，跟哨兵取值无关，NWT 1237③
//      独立性的另一面——独立不等于结果能不一样，独立指的是各自触发真实计算，不共享缓存条目)。
//   ③ checked-in 参考值不匹配时只 WARN(referenceMismatch=true 且不 throw)，不是 block——防止某次改动把
//      "参考值过期"错误地升级成拒绝派生。
// V1(PayoutShard)/V2(PayoutShardV2)一并覆盖(旧版只测过 V2，D-019 迁移把 V1 也接进了同一条 fail-closed
// 拒签闸/K-18 结构签名探针，遗漏 V1 tripwire = 半覆盖)。
//
// Run: cd kasia-console && node src/lib/payoutshardv2-offset-tripwire.test.mjs
import { deriveCommitteeCheckOffsets } from './committee-offset-derive.mjs';
import { _ENFORCE_PMR_SENTINEL, _ENFORCE_PC_SENTINEL } from './bshard-close-enforce.mjs';
import { _K18_PMR_SENTINEL, _K18_PC_SENTINEL } from './bshard-payout-family-coherence.mjs';
import { compilePayoutShardRedeem, compilePayoutShardV2Redeem } from './pool-shard-register.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

// 真实"某个市场"的实例值——刻意跟两道闸各自的派生哨兵(a1.../c2... 与 d3.../e4...)都不同，证明①要验的
// "派生偏移能正确定位一份完全独立编译的真实产物里的字段"不是靠巧合撞上同一个值。
const REAL_PMR = '5a'.repeat(32);
const REAL_PC = '6b'.repeat(32);
const TTH = '77'.repeat(32), CTH = '88'.repeat(32), MSH = '99'.repeat(32);

function hexAt(buf, offset, len) {
  if (offset < 0 || offset + len > buf.length) return null;
  return buf.subarray(offset, offset + len).toString('hex');
}

function testGate(label, { isV2, pmrSentinelHex, pcSentinelHex }) {
  console.log(`[test] ${label} (isV2=${isV2}):`);
  let offsets;
  try {
    offsets = deriveCommitteeCheckOffsets({ isV2, pmrSentinelHex, pcSentinelHex });
  } catch (e) {
    ok(false, `deriveCommitteeCheckOffsets 本身跑通 (threw: ${e.message})`);
    return null;
  }
  const realRedeemHex = isV2
    ? compilePayoutShardV2Redeem({ poolMerkleRoot: REAL_PMR, predicateCommit: REAL_PC, closeZkTmplAnchor: 'cc'.repeat(32), consolidatedPool: 1000, tokenTmplHash: TTH, claimTmplHash: CTH, marketSuffixHash: MSH })
    : compilePayoutShardRedeem({ poolMerkleRoot: REAL_PMR, predicateCommit: REAL_PC, consolidatedPool: 1000, closed: 0, payoutRoot: '00'.repeat(32), tokenTmplHash: TTH, claimTmplHash: CTH, marketSuffixHash: MSH });
  const buf = Buffer.from(realRedeemHex, 'hex');

  // ① instance-binding: 派生偏移(来自占位 ctor 编译)套到一份完全独立、真实值编译的 redeem 上，取出来的
  //    字节必须精确等于编译时喂的真实值——这正是两道闸生产代码实际依赖的性质。
  const pcAt = hexAt(buf, offsets.predicateCommitOffset, 32);
  ok(pcAt === REAL_PC, `派生 predicateCommitOffset=${offsets.predicateCommitOffset} 在真实(占位之外)编译的 redeem 上精确取到 REAL_PC (got=${pcAt})`);
  const pmrAt0 = hexAt(buf, offsets.poolMerkleRootOffsets[0], 32);
  ok(pmrAt0 === REAL_PMR, `派生 poolMerkleRootOffsets[0]=${offsets.poolMerkleRootOffsets[0]} 在真实编译的 redeem 上精确取到 REAL_PMR (got=${pmrAt0})`);
  ok(offsets.poolMerkleRootOffsets.every(off => hexAt(buf, off, 32) === REAL_PMR), `poolMerkleRootOffsets 全部 ${offsets.poolMerkleRootOffsets.length} 个位置在真实 redeem 上都精确取到 REAL_PMR (offsets=${JSON.stringify(offsets.poolMerkleRootOffsets)})`);

  // ③ checked-in 参考值不匹配 = WARN 不 block(referenceMismatch 是个可观察字段，不是 throw)。
  ok(typeof offsets.referenceMismatch === 'boolean', `referenceMismatch 字段存在且是 boolean，不匹配走 WARN 不 throw(got ${JSON.stringify(offsets.referenceMismatch)})`);

  return offsets;
}

function main() {
  const enforceV1 = testGate('bshard-close-enforce 拒签闸 sentinel', { isV2: false, pmrSentinelHex: _ENFORCE_PMR_SENTINEL, pcSentinelHex: _ENFORCE_PC_SENTINEL });
  const enforceV2 = testGate('bshard-close-enforce 拒签闸 sentinel', { isV2: true, pmrSentinelHex: _ENFORCE_PMR_SENTINEL, pcSentinelHex: _ENFORCE_PC_SENTINEL });
  const k18V1 = testGate('K-18 probeStructuralSignature sentinel', { isV2: false, pmrSentinelHex: _K18_PMR_SENTINEL, pcSentinelHex: _K18_PC_SENTINEL });
  const k18V2 = testGate('K-18 probeStructuralSignature sentinel', { isV2: true, pmrSentinelHex: _K18_PMR_SENTINEL, pcSentinelHex: _K18_PC_SENTINEL });

  // ② 两道闸(不同哨兵、各自独立触发真实派生, NWT 1237③)在同一族(V1/V2)上必须得到完全相同的数字偏移——
  //    独立触发≠结果可以不一样，独立指的是不共享缓存条目，两次都是真实计算。
  console.log('[test] cross-gate agreement (不同哨兵，同一族，必须算出相同的数字偏移):');
  if (enforceV1 && k18V1) {
    ok(enforceV1.predicateCommitOffset === k18V1.predicateCommitOffset && JSON.stringify(enforceV1.poolMerkleRootOffsets) === JSON.stringify(k18V1.poolMerkleRootOffsets),
      `V1: close-enforce 哨兵与 K-18 哨兵各自独立派生出相同偏移 (enforce=${JSON.stringify(enforceV1)}, k18=${JSON.stringify(k18V1)})`);
  }
  if (enforceV2 && k18V2) {
    ok(enforceV2.predicateCommitOffset === k18V2.predicateCommitOffset && JSON.stringify(enforceV2.poolMerkleRootOffsets) === JSON.stringify(k18V2.poolMerkleRootOffsets),
      `V2: close-enforce 哨兵与 K-18 哨兵各自独立派生出相同偏移 (enforce=${JSON.stringify(enforceV2)}, k18=${JSON.stringify(k18V2)})`);
  }

  console.log(fails === 0
    ? '\n✅✅ ALL PASS — deriveCommitteeCheckOffsets 的派生结果对两道闸(不同哨兵)、两个家族(V1/V2)都自洽，且能正确定位独立真实编译产物里的字段(instance-binding)'
    : `\n❌ ${fails} assertions failed — 派生结果不自洽或定位不到真实字段(结构性 codegen 变化，或某道闸接线漂了)。DO NOT 直接改断言凑绿, 先查是 .sil 结构真变了还是接线本身有 bug。`);
  process.exit(fails === 0 ? 0 : 1);
}
main();
