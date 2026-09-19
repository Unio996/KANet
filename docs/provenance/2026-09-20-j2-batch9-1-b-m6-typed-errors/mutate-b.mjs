// mutate-b.mjs — 9-1 首批 B 笔(M6 必填参数 + 类型化错误)的变异对照(J2 2026-09-20)。
// 逐个破坏 kasia-console/src/lib/proto-settlement-chain-checks.mjs, 跑 proto-settlement-chain-checks.test.mjs, 期望每个变异至少一条 [FAIL](或进程异常退出)。
// 每个变异的锚点必须恰好命中 1 次; 每次 finally 还原并核对 sha256。
// 运行: node docs/provenance/2026-09-20-j2-batch9-1-b-m6-typed-errors/mutate-b.mjs <worktree 根绝对路径>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.argv[2];
const target = `${ROOT}/kasia-console/src/lib/proto-settlement-chain-checks.mjs`;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const orig = fs.readFileSync(target), origSha = sha(orig), text = orig.toString('utf8');

const OP_LINE = '    if (String(gotOp.transactionId).toLowerCase() !== String(wantOp.transactionId).toLowerCase() || Number(gotOp.index) !== wantOp.index) {';
const COV_LINE = '    const covOk = wantCov === null ? gotCov === null : (gotCov !== null && gotCov.toLowerCase() === wantCov.toLowerCase());';
const muts = [
  ['M-1  outpoint 比较整个拆掉', OP_LINE, '    if (false) {'],
  ['M-2  ▲ outpoint 只比 txid(漏 index——N-T1 同族: 同 txid 另一个 index 会被当成目标)', OP_LINE, '    if (String(gotOp.transactionId).toLowerCase() !== String(wantOp.transactionId).toLowerCase()) {'],
  ['M-3  outpoint 只比 index(漏 txid)', OP_LINE, '    if (Number(gotOp.index) !== wantOp.index) {'],
  ['M-4  outpoint txid 比较区分大小写', OP_LINE, '    if (String(gotOp.transactionId) !== String(wantOp.transactionId) || Number(gotOp.index) !== wantOp.index) {'],
  ['M-5  ▲ covenant 只比"有/无"、不比 id 相等', COV_LINE, '    const covOk = (wantCov === null) === (gotCov === null);'],
  ['M-6  covenant 比较整个拆掉', COV_LINE, '    const covOk = true;'],
  ['M-7  期望"无 covenant"(ticket)时不检查链上是否真无', '    const covOk = wantCov === null ? gotCov === null :', '    const covOk = wantCov === null ? true :'],
  ['M-8  链上缺 covenantId 键不再 fail-closed(缺键被当成"无 covenant")', "    if (!Object.prototype.hasOwnProperty.call(u, 'covenantId')) {", '    if (false) {'],
  ['M-9  ▲ expectedOutpoints 变成可选(缺参不再是 chain_check_params_missing)', "  if (!expectedOutpoints || typeof expectedOutpoints !== 'object') throw E(", '  if (false) throw E('],
  ['M-10 expectedCovenantIds 变成可选', "  if (!expectedCovenantIds || typeof expectedCovenantIds !== 'object') throw E(", '  if (false) throw E('],
  ['M-11 预期 outpoint 的形状校验拆掉', "    if (!wantOp || typeof wantOp !== 'object' || !HEX64.test(String(wantOp.transactionId ?? '').toLowerCase()) || !Number.isInteger(wantOp.index) || wantOp.index < 0) {", '    if (false) {'],
  ['M-12 链上条目缺 outpoint 不再 fail-closed', "    if (!gotOp || typeof gotOp !== 'object' || gotOp.transactionId === undefined || gotOp.index === undefined) {", '    if (false) {'],
  ['M-13 ▲ 类型化错误退化成普通 Error(丢 .code)', 'const E = (code, message, role) => new SettlementChainCheckError(code, message, { step, role });', 'const E = (code, message, role) => new Error(message);'],
  ['M-14 outpoint 漂移的 .code 串成 value_drift', 'throw E(`${role}_outpoint_drift`, `${role}_outpoint_drift — fail-closed: assertSettlementInputValuesOnChain(${step}): ${role} 的链上 outpoint(', 'throw E(`${role}_value_drift`, `${role}_outpoint_drift — fail-closed: assertSettlementInputValuesOnChain(${step}): ${role} 的链上 outpoint('],
  ['M-15 ▲ 消息里的原标签被改(value_drift → value_mismatch)——破坏调用方正则(C7)', 'const tag = `assertSettlementInputValuesOnChain(${step}): ${role}_value_drift — fail-closed`;', 'const tag = `assertSettlementInputValuesOnChain(${step}): ${role}_value_mismatch — fail-closed`;'],
  ['M-16 错误对象不再带 step/role', '    this.step = step;\n    this.role = role;\n', ''],
  ['M-17 闭集缺一类(去掉 covenant_class_mismatch)', "const kinds = ['value_drift', 'spk_drift', 'outpoint_drift', 'covenant_class_mismatch'];", "const kinds = ['value_drift', 'spk_drift', 'outpoint_drift'];"],
  ['M-18 缺 builder 假设 spk 的 .code 串成 spk_drift', "if (!wantSpk) throw E('chain_check_params_missing',", 'if (!wantSpk) throw E(`${role}_spk_drift`,'],
  ['M-19 未知步骤的 .code 串成 params_missing', "if (!roles) throw E('chain_check_unknown_step',", "if (!roles) throw E('chain_check_params_missing',"],
  ['M-20 ▲ 面值 BigInt 解析异常不再包成类型化错误(裸 SyntaxError 逃出闭集)', '    try { got = BigInt(u.value); } catch {', '    try { got = BigInt(u.value); } catch (rawErr) { throw rawErr; } if (false) {'],
];

let allRed = true;
try {
  const base = spawnSync(process.execPath, ['src/lib/proto-settlement-chain-checks.test.mjs'], { cwd: `${ROOT}/kasia-console`, encoding: 'utf8', timeout: 180000 });
  console.log('基线(未变异):', (base.stdout || '').split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop(), `exit=${base.status}`);
  if (base.status !== 0) allRed = false;
  for (const [name, find, repl] of muts) {
    const c = text.split(find).length - 1;
    if (c !== 1) { console.log(`[ERR ] ${name}: 变异锚点命中 ${c} 次(需要恰 1 次)——变异脚本与源码不同步`); allRed = false; continue; }
    fs.writeFileSync(target, text.replace(find, repl));
    const r = spawnSync(process.execPath, ['src/lib/proto-settlement-chain-checks.test.mjs'], { cwd: `${ROOT}/kasia-console`, encoding: 'utf8', timeout: 180000 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const fails = out.split('\n').filter((l) => l.startsWith('[FAIL]')).length;
    const red = fails > 0 || r.status !== 0;
    if (!red) allRed = false;
    console.log(`${red ? '[RED ]' : '[GREEN⚠ 变异存活!]'} ${name}  →  ${fails} 条 FAIL${fails === 0 && r.status !== 0 ? '(进程异常退出 exit=' + r.status + ')' : ''}`);
    fs.writeFileSync(target, orig);
  }
} finally {
  fs.writeFileSync(target, orig);
  console.log(sha(fs.readFileSync(target)) === origSha ? `[RESTORED] proto-settlement-chain-checks.mjs 已还原, sha256 ${origSha.slice(0, 16)}… 一致` : '[!!! 还原失败 !!!]');
}
console.log(allRed ? '\n全部变异均被测试抓到' : '\n⚠ 有变异存活或锚点失配, 见上');
process.exit(allRed ? 0 : 1);
