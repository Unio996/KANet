// closezk-v2-anchor-crosscheck.test.mjs — T-ANCHOR-XCHECK permanent regression test
// (docs/2026-09-14-j2-closezkv2-anchor-crosscheck-ticket-v0.1.md, NWT 4f659405 §四 + Bettor 1297 定案③):
// instance-binding proof that computeCloseZkTmplAnchor's dummy-derived templateA/B/C/D boundaries slice
// out the SAME bytes on a completely independent, REAL-value compile of CloseZkV2.sil — not "dummy
// reconstructed equals dummy" (that's computeCloseZkTmplAnchor's own existing round-trip self-proof),
// but "dummy-derived boundaries correctly predict a different real compile's structure". Mirrors the
// instance-binding method already proven for PayoutShard/PayoutShardV2 in
// payoutshardv2-offset-tripwire.test.mjs, applied here to CloseZkV2.sil.
//
// 🔴 permanent TEST, not a runtime gate (NWT 4f659405 §四 point 4, Bettor 1297 定案③): computeCloseZkTmplAnchor
// already has its own round-trip self-proof, and this property doesn't vary per-market (same .sil, same
// compiler pin) — the risk is "did someone break the .sil/ctor-shape assumption", which a code-level
// regression test catches just as well as a per-call runtime check, without paying a repeat-compile cost
// on every real genesis-mint.
//
// Run: cd kasia-console && node src/lib/closezk-v2-anchor-crosscheck.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._ANCHORXCHECK_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_anchorxcheck_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _ANCHORXCHECK_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { computeCloseZkTmplAnchor, _sliceCloseZkTemplateSegments } = await import('./pool-shard-register.mjs');
const { compileCloseZkV2Redeem, CLOSEZK_V2_SIL } = await import('./closezk-v2-mint.mjs');
const { extractTemplateArtifact } = await import('./pool-template-artifact.mjs');
const { blake2b } = await import('@noble/hashes/blake2b');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

// 固定测试用真实值 — 全部跟 computeCloseZkTmplAnchor 内部的 dummy 值(gateTmplHash 除外, 那个两边必须
// 一样, 是调用方传的同一份市场承诺)不同, 同 session 一贯"distinct non-zero markers"纪律，避免任何两个
// marker 意外相等造成假阳性。attestedAtMs 特意选一个跟 dummyAtMs(1783500000000)不同、但仍在
// [2^40,2^47) 真实生产值域内的量级(NWT §四 point 1 原话："比如 2^41 附近某个具体数字")——这条测试验的
// 是"生产范围内任意真实值都适用"，不是重复测 T-CLOSEZK-ATMS-WIDTH 已经覆盖的编码宽度边界本身。
const GATE = 'ab'.repeat(32);
// 账本 1415/1458 修: marketSuffixHash 已从 CloseZkV2.sil 构造参数删除(见 compileCloseZkV2Redeem 顶注)，
// 不再是需要两边一致的第四个真实承诺——REAL_SUFFIX 保留常量本身(仍传给 compileCloseZkV2Redeem，会被
// 无害忽略)但不再传给 computeCloseZkTmplAnchor。
const REAL_TOKEN = 'c1'.repeat(32), REAL_CLAIM = 'c2'.repeat(32), REAL_SUFFIX = 'c3'.repeat(32);
const REAL_BETS_ROOT = 'd1'.repeat(32), REAL_REFUND_ROOT = 'd2'.repeat(32);
const REAL_ATMS = 2 ** 41 + 123456789;   // 落在 [2^40,2^47) 内, 跟 dummyAtMs 不同, 6 字节编码

console.log('[test] T-ANCHOR-XCHECK instance-binding: dummy-derived templateA/B/C/D 边界套到一份完全独立、真实值编译出的 CloseZkV2 产物上，必须精确切出相同字节:');
{
  // ① dummy 路径(生产实际调用的函数，不是重新实现一遍)——同一份 gateTmplHash/tokenTmplHash/claimTmplHash/
  //   marketSuffixHash(这四个是"这个市场"的真实承诺，两边必须一致，不是要交叉校验的对象)。
  const anchor = computeCloseZkTmplAnchor(CLOSEZK_V2_SIL, GATE, REAL_TOKEN, REAL_CLAIM);

  // ② 完全独立的真实值编译(compileCloseZkV2Redeem，生产实际调用的函数)——attestedAtMs/betsRootBaked/
  //   refundRootBaked 全部换成跟 dummy 不同的真实值，attestedWinner/consolidatedPool 也换成非 dummy 值。
  const realRedeemHex = compileCloseZkV2Redeem({
    gateTmplHash: GATE, betsRootBaked: REAL_BETS_ROOT, refundRootBaked: REAL_REFUND_ROOT,
    attestedAtMs: REAL_ATMS, attestedWinner: 1, consolidatedPool: 987654321,
    tokenTmplHash: REAL_TOKEN, claimTmplHash: REAL_CLAIM, marketSuffixHash: REAL_SUFFIX,
  });
  const realBuf = Buffer.from(realRedeemHex, 'hex');

  // ③ 对这份真实、独立编译产物重新走一次 extractTemplateArtifact + _sliceCloseZkTemplateSegments(同一个
  //   共享函数，喂真实值而不是 dummy 值)——不是重新发明一套切分逻辑。CloseZkV2.sil 的 state_layout 是
  //   固定宽度编码(pool-shard-register.mjs 的 _CLOSEZK_SUFFIX_BASE=214=start(1)+len(213)，不随 ctor
  //   值变，本 session ctor-int-encoding-width-probe-v0.1.md 矩阵实测已证明同类字段跨真实值稳定)，
  //   直接构造等价 {script, state_layout} 对象喂给 extractTemplateArtifact，不需要为了拿 state_layout
  //   而重新真编译一次(compileCloseZkV2Redeem 本身已经是一次真编译，没必要编两次)。
  const realArtifact = extractTemplateArtifact({ script: [...realBuf], state_layout: { start: 1, len: 213 } });
  const realSegments = _sliceCloseZkTemplateSegments(realBuf, realArtifact.templateSuffix, {
    betsRootHex: REAL_BETS_ROOT, refundRootHex: REAL_REFUND_ROOT, attestedAtMsValue: REAL_ATMS,
  });

  // ④ 核心断言：dummy 路径算出的 anchor.templateA/B/C/D，必须跟从真实独立产物上重新切出的
  //   realSegments.templateA/B/C/D 逐字节相等——这才是"套用到真实值"这条假设的真正证明，不是
  //   "dummy 自己拼回等于 dummy 自己"这种同义反复(那是 computeCloseZkTmplAnchor 已有的 round-trip 自证)。
  ok(anchor.templateA.equals(realSegments.templateA), `templateA 在真实独立编译产物上精确一致(len dummy=${anchor.templateA.length}, real=${realSegments.templateA.length})`);
  ok(anchor.templateB.equals(realSegments.templateB), `templateB 在真实独立编译产物上精确一致(len dummy=${anchor.templateB.length}, real=${realSegments.templateB.length})`);
  ok(anchor.templateC.equals(realSegments.templateC), `templateC 在真实独立编译产物上精确一致(len dummy=${anchor.templateC.length}, real=${realSegments.templateC.length})`);
  ok(anchor.templateD.equals(realSegments.templateD), `templateD 在真实独立编译产物上精确一致(len dummy=${anchor.templateD.length}, real=${realSegments.templateD.length})`);

  // ⑤ 附带 sanity：anchor.anchorHex 本身应该等于对这四段真实切出的片段重新算一遍 hash(如果④全过，这条
  //   必然也过，纯粹是把"四段相等"这件事换一个更贴近实际用途的角度再断言一次，不是独立信息)。
  const realAnchorHex = Buffer.from(blake2b(Buffer.concat([realSegments.templateA, realSegments.templateB, realSegments.templateC, realSegments.templateD]), { dkLen: 32 })).toString('hex');
  ok(realAnchorHex === anchor.anchorHex, `从真实产物重新切出的四段算出的 hash 跟 dummy 路径的 anchorHex 完全一致(dummy=${anchor.anchorHex.slice(0, 16)}..., real=${realAnchorHex.slice(0, 16)}...)`);
}

console.log('\n[test] negative(证明这条测试不是摆设，真能抓到不一致): 用一个不同的 gateTmplHash 编译真实产物(模拟"两处独立实现的输入意外不同步"这个真实故障模式，同本票 T-ANCHOR-XCHECK 现状分析原话)，四段模板不应该再全部匹配:');
{
  const anchor = computeCloseZkTmplAnchor(CLOSEZK_V2_SIL, GATE, REAL_TOKEN, REAL_CLAIM);
  const DIFFERENT_GATE = 'ff'.repeat(32);   // 故意跟 anchor 用的 GATE 不同
  const mismatchedRedeemHex = compileCloseZkV2Redeem({
    gateTmplHash: DIFFERENT_GATE, betsRootBaked: REAL_BETS_ROOT, refundRootBaked: REAL_REFUND_ROOT,
    attestedAtMs: REAL_ATMS, attestedWinner: 1, consolidatedPool: 987654321,
    tokenTmplHash: REAL_TOKEN, claimTmplHash: REAL_CLAIM, marketSuffixHash: REAL_SUFFIX,
  });
  const mismatchedBuf = Buffer.from(mismatchedRedeemHex, 'hex');
  const mismatchedArtifact = extractTemplateArtifact({ script: [...mismatchedBuf], state_layout: { start: 1, len: 213 } });
  const mismatchedSegments = _sliceCloseZkTemplateSegments(mismatchedBuf, mismatchedArtifact.templateSuffix, {
    betsRootHex: REAL_BETS_ROOT, refundRootHex: REAL_REFUND_ROOT, attestedAtMsValue: REAL_ATMS,
  });
  // 实测确认(不猜测): gateTmplHash 的字节差异体现在 templateB 里(不是 templateA——四段各自对应
  // .sil 源码里不同 require 语句之间的间隔区域，不是"第几个 ctor 参数就落在第几段"这种简单对应关系)，
  // 断言"四段不是全部相等"而不是硬编码具体是哪一段，避免测试对".sil 未来微调后差异挪到另一段"这种
  // 无关紧要的细节过分敏感——核心事实(某处确实不同、能被抓到)才是这条负向向量要证明的。
  const allEqual = anchor.templateA.equals(mismatchedSegments.templateA) && anchor.templateB.equals(mismatchedSegments.templateB)
    && anchor.templateC.equals(mismatchedSegments.templateC) && anchor.templateD.equals(mismatchedSegments.templateD);
  ok(!allEqual, `gateTmplHash 不同 → 四段模板至少有一段检测出不一致，不是巧合全等(A equal=${anchor.templateA.equals(mismatchedSegments.templateA)}, B equal=${anchor.templateB.equals(mismatchedSegments.templateB)}, C equal=${anchor.templateC.equals(mismatchedSegments.templateC)}, D equal=${anchor.templateD.equals(mismatchedSegments.templateD)})`);
}

console.log(fails === 0 ? '\n✅✅ ALL PASS — dummy-derived template boundaries correctly predict an independent real-value compile, and correctly reject a real mismatch' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
