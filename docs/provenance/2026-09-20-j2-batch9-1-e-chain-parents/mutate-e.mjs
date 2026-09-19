// mutate-e.mjs — 9-1 首批 E 笔(chainParents + 四个 builder 断言 + 输入下标常量)的变异对照(J2 2026-09-20)。
// 逐个破坏 kasia-console/src/lib/proto-tx-assembly-settlement.mjs, 跑 proto-claim-draw.test.mjs(内含 B 组, 且覆盖 seal / close_commit / convert_to_claim / claim_draw 四个 builder),
// 期望每个变异至少一条 [FAIL](或进程异常退出)。每个变异的每个锚点必须恰好命中 1 次(否则 [ERR ]: 变异脚本与源码不同步); 每次 finally 还原并核对 sha256。
// 一个变异可含多个 [find, repl] 对(用于"把断言挪到 mass/fee 之后"这类要改两处的变异)。
// 运行: node docs/provenance/2026-09-20-j2-batch9-1-e-chain-parents/mutate-e.mjs <worktree 根绝对路径>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.argv[2];
const target = `${ROOT}/kasia-console/src/lib/proto-tx-assembly-settlement.mjs`;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const orig = fs.readFileSync(target), origSha = sha(orig), text = orig.toString('utf8');
const runTest = () => spawnSync(process.execPath, ['src/lib/proto-claim-draw.test.mjs'], { cwd: `${ROOT}/kasia-console`, encoding: 'utf8', timeout: 480000 });

// 让某一步的断言"只在 selectChangeShape 之后才跑"(顺序错误): 断言块改成闭包, 在 assertImpliedFeeMatches / assertClaimDrawLayout 前调用。
const defer = (stepName, afterAnchor) => [
  [`  assertChainParentsMatchBuilder({\n    step: '${stepName}'`, `  const _deferred = () => assertChainParentsMatchBuilder({\n    step: '${stepName}'`],
  [afterAnchor, `_deferred();\n  ${afterAnchor}`],
];
// 让某一步的 builder 忽略入参 chainParents、自证(用与夹具相同的字面值自己造一个)——"assertion 被架空"的变异。
const selfCertify = (stepName, label, vecName, roles) => [[
  `step: '${stepName}', label: '${label}', chainParents, inputHasCovenant: ${vecName},`,
  `step: '${stepName}', label: '${label}', chainParents: { ${roles.map(([r, cov]) => `${r}: { value: 20000000n, spkLen: 35, hasCovenant: ${cov} }`).join(', ')}, fee: { value: feeUtxo.value, spkLen: 34, hasCovenant: false } }, inputHasCovenant: ${vecName},`,
]];

const muts = [
  // ── assertChainParentsMatchBuilder 自身 ──
  ['M-01 ▲ 不再核 hasCovenant(mass plurality 取常量)', [["if (p.hasCovenant !== inputHasCovenant[i]) fail(", 'if (false) fail(']]],
  ['M-02 ▲ 不再核 spkLen', [['if (p.spkLen !== spkByteLen(u.spkHex)) fail(', 'if (false) fail(']]],
  ['M-03 ▲ 不再核 value 与期望面值常量(③)', [["if (role !== 'fee' && p.value !== EXPECTED_INPUT_VALUE_SOMPI[role]) fail(", 'if (false) fail(']]],
  ['M-04 ▲ 不再核 value 与 builder 实际用的面值(④, 超出设计文字的一道)', [['if (p.value !== u.value) fail(', 'if (false) fail(']]],
  ['M-05 ▲ 缺条目被静默跳过(而不是拒)——"缺项当 false"的同族', [["if (!isPlainObj(p)) fail(role, '缺失');", 'if (!isPlainObj(p)) return;']]],
  ['M-06 条目形状校验拆掉(bigint / 整数 / boolean)', [["if (typeof p.value !== 'bigint' || !Number.isInteger(p.spkLen) || p.spkLen <= 0 || typeof p.hasCovenant !== 'boolean') fail(", 'if (false) fail(']]],
  ['M-07 多余角色键不再拒', [['for (const k of Object.keys(chainParents)) if (!roles.includes(k)) fail(', 'for (const k of []) if (!roles.includes(k)) fail(']]],
  ['M-08 入参缺失不再拒(chainParents 变可选)', [['if (!isPlainObj(chainParents)) fail(undefined,', 'if (false) fail(undefined,']]],
  ['M-09 输入角色表不含 fee 槽', [["const roles = [...STEP_INPUT_ROLES[step], 'fee'];", 'const roles = [...STEP_INPUT_ROLES[step]];']]],
  ['M-10 ▲ 错误 .code 改名', [["this.code = 'chain_parents_mismatch';", "this.code = 'chain_parents_bad';"]]],
  ['M-11 错误不再带 .role', [['this.step = step;\n    this.role = role;', 'this.step = step;']]],
  ['M-12 spkLen 取字符数而非字节数', [["const spkByteLen = (hex) => String(hex).replace(/^0x/i, '').length / 2;", "const spkByteLen = (hex) => String(hex).replace(/^0x/i, '').length;"]]],
  // ── 四个 builder 忽略入参、自证(断言被架空) ──
  ['M-13 ▲ seal 忽略入参 chainParents 自证', selfCertify('seal', 'market_seal', 'MARKET_SEAL_INPUT_HAS_COVENANT', [['leaf', true], ['held', true]])],
  ['M-14 ▲ close_commit 忽略入参 chainParents 自证', selfCertify('close_commit', 'close_commit', 'CLOSE_COMMIT_INPUT_HAS_COVENANT', [['rootClose', true]])],
  ['M-15 ▲ convert_to_claim 忽略入参 chainParents 自证', selfCertify('convert_to_claim', 'convert_to_claim', 'CONVERT_TO_CLAIM_INPUT_HAS_COVENANT', [['rootClose', true], ['held', true]])],
  ['M-16 ▲ claim_draw 忽略入参 chainParents 自证', selfCertify('claim_draw', 'claim_draw', 'CLAIM_DRAW_INPUT_HAS_COVENANT', [['rootClaim', true], ['ticket', false], ['held', true]])],
  // ── 顺序: 断言挪到 selectChangeShape 之后 ──
  ['M-17 ▲ seal 的断言挪到 selectChangeShape 之后(在 mass/fee 之后才核)', defer('seal', "assertImpliedFeeMatches(shape.tx, shape.netLoss, 'market_seal');")],
  ['M-18 ▲ close_commit 的断言挪到 selectChangeShape 之后(且在私钥解出之后)', defer('close_commit', "assertImpliedFeeMatches(shape.tx, shape.netLoss, 'close_commit');")],
  ['M-19 ▲ convert_to_claim 的断言挪到 selectChangeShape 之后', defer('convert_to_claim', "assertImpliedFeeMatches(shape.tx, shape.netLoss, 'convert_to_claim');")],
  ['M-20 ▲ claim_draw 的断言挪到 selectChangeShape 之后(且在私钥解出之后)', defer('claim_draw', "assertImpliedFeeMatches(shape.tx, shape.netLoss, 'claim_draw');")],
  // ── 导出常量 ──
  ['M-21 ▲ MARKET_SEAL_INPUT_HAS_COVENANT 的 held 槽改 false', [['export const MARKET_SEAL_INPUT_HAS_COVENANT = Object.freeze([true, true, false]);', 'export const MARKET_SEAL_INPUT_HAS_COVENANT = Object.freeze([true, false, false]);']]],
  ['M-22 ▲ CLOSE_COMMIT_INPUT_HAS_COVENANT 的 rootClose 槽改 false', [['export const CLOSE_COMMIT_INPUT_HAS_COVENANT = Object.freeze([true, false]);', 'export const CLOSE_COMMIT_INPUT_HAS_COVENANT = Object.freeze([false, false]);']]],
  ['M-23 ▲ CONVERT_TO_CLAIM_INPUT_HAS_COVENANT 的 held 槽改 false', [['export const CONVERT_TO_CLAIM_INPUT_HAS_COVENANT = Object.freeze([true, true, false]);', 'export const CONVERT_TO_CLAIM_INPUT_HAS_COVENANT = Object.freeze([true, false, false]);']]],
  ['M-24 ▲ CLAIM_DRAW_INPUT_HAS_COVENANT 的 ticket 槽改 true(ticket 是普通 P2SH, 无 covenant)', [['export const CLAIM_DRAW_INPUT_HAS_COVENANT = Object.freeze([true, false, true, false]);', 'export const CLAIM_DRAW_INPUT_HAS_COVENANT = Object.freeze([true, true, true, false]);']]],
  ['M-25 CLOSE_COMMIT_FEE_IN_INDEX 改 0(signInputIndices 与实际布局不符)', [['export const CLOSE_COMMIT_FEE_IN_INDEX = 1;', 'export const CLOSE_COMMIT_FEE_IN_INDEX = 0;']]],
  ['M-26 MARKET_SEAL_LEAF_IN_INDEX 改 1(与实际布局不符)', [['export const MARKET_SEAL_LEAF_IN_INDEX = 0;', 'export const MARKET_SEAL_LEAF_IN_INDEX = 1;']]],
  ['M-27 ▲ close_commit 不再返回 continuationOutputIndices(P6)', [['continuationOutputIndices: [CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX],', 'continuationOutputIndices: [],']]],
  ['M-28 seal 的 used.held.value 取常量而非 heldInput.value(④ 被架空)', [['held: { value: heldInput.value, spkHex: heldInput.scriptPublicKeyHex },', 'held: { value: GENESIS_OUTPUT_SOMPI, spkHex: heldInput.scriptPublicKeyHex },']]],
];

let allRed = true;
try {
  const t0 = Date.now();
  const base = runTest();
  console.log('基线(未变异):', (base.stdout || '').split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop(), `exit=${base.status}`, `(${Math.round((Date.now() - t0) / 1000)}s/次)`);
  if (base.status !== 0) allRed = false;
  for (const [name, edits] of muts) {
    let cur = text, bad = false;
    for (const [find, repl] of edits) {
      const c = cur.split(find).length - 1;
      if (c !== 1) { console.log(`[ERR ] ${name}: 变异锚点命中 ${c} 次(需要恰 1 次): ${find.slice(0, 70).replace(/\n/g, '\\n')}`); bad = true; break; }
      cur = cur.replace(find, repl);
    }
    if (bad) { allRed = false; continue; }
    fs.writeFileSync(target, cur);
    const r = runTest();
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const failed = out.split('\n').filter((l) => l.startsWith('[FAIL]'));
    const red = failed.length > 0 || r.status !== 0;
    if (!red) allRed = false;
    const firstName = failed[0] ? failed[0].replace(/^\[FAIL\]\s*/, '').split(/[ ⇒:]/)[0] : '';
    console.log(`${red ? '[RED ]' : '[GREEN⚠ 变异存活!]'} ${name}  →  ${failed.length} 条 FAIL${failed.length ? `(首条: ${firstName})` : ''}${failed.length === 0 && r.status !== 0 ? `(进程异常退出 exit=${r.status})` : ''}`);
    fs.writeFileSync(target, orig);
  }
} finally {
  fs.writeFileSync(target, orig);
  console.log(sha(fs.readFileSync(target)) === origSha ? `[RESTORED] proto-tx-assembly-settlement.mjs 已还原, sha256 ${origSha.slice(0, 16)}… 一致` : '[!!! 还原失败 !!!]');
}
console.log(allRed ? '\n全部变异均被测试抓到' : '\n⚠ 有变异存活或锚点失配, 见上');
process.exit(allRed ? 0 : 1);
