// 批9 9-2b(ii) 驱动核心——变异对照(单文件测试逐个跑)。每个变异: 备份 → 改 → 跑 core 测试(S5 变异另跑 assembly 测试) → 必须红 → 还原并校验字节相同。
// 用法(从仓库根): node docs/provenance/2026-09-20-j2-batch9-92b2-driver-core/mutate-92b2.mjs > mutation-raw.txt
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = 'kasia-console/src/lib/proto-settlement-driver-core.mjs';
const ASM = 'kasia-console/src/lib/proto-tx-assembly-settlement.mjs';
const T = { core: 'src/lib/proto-settlement-driver-core.test.mjs', asm: 'src/lib/proto-tx-assembly-settlement.test.mjs' };
const run = (k) => { const r = spawnSync(process.execPath, [T[k]], { cwd: path.join(ROOT, 'kasia-console'), encoding: 'utf8', timeout: 280000, maxBuffer: 1 << 26 }); return { status: r.status, last: ((r.stdout || '') + (r.stderr || '')).match(/\d+ passed, \d+ failed/)?.[0] || '?' }; };
const sub = (a, b) => (s) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`锚点命中 ${n}: ${a.slice(0, 50)}`); return s.replace(a, () => b); };
const M = [];
const mut = (id, file, f, tests, why) => M.push([id, file, f, tests, why]);
mut('Z1', CORE, sub("if (row.status === 'pending') {\n        const dep", 'if (false) {\n        const dep'), ['core'], '不检查依赖已 landed');
mut('Z2', CORE, sub('if (!gate.canSubmit) {', 'if (false) {'), ['core'], 'pmt 门不放行也继续构造');
mut('Z3', CORE, sub('feeCandidates: v.fee && v.fee.candidates, withFeeParent, pmtEvidence })', 'feeCandidates: v.fee && v.fee.candidates, withFeeParent })'), ['core'], 'pmtEvidence 不传给 builder');
mut('Z4', CORE, sub('const orig = buildFail ? buildFail.err : e;', 'const orig = e;'), ['core'], '不留原始错误(传输错被 driveIntent 包装后误分类)');
mut('Z5', CORE, sub('grader.onSuccess(key);', ''), ['core'], 'C1 通过不清传输计数');
mut('Z6', CORE, sub("if (stage === 'broadcast') return { report: false,", "if (false) return { report: false,"), ['core'], '广播失败也报编程错误');
mut('Z7', CORE, sub('deps.intents.mark(key, { status: \'ambiguous\', last_error: \'refund_flip_observed\' });', ''), ['core'], 'refund_flip 探测到了但不置 ambiguous');
mut('Z8', CORE, sub('/^rootClose_(value|outpoint|spk)_drift$/', '/./'), ['core'], 'refund_flip 探测对任何错误都触发');
mut('Z9', CORE, sub('if (!r.landed) return { outcome: \'not_landed\', key: intent.intent_key, depth: r.depth ?? null };', ''), ['core'], '没 landed 也记账');
mut('Z10', CORE, sub('minDepth: deps.minDepth,', 'minDepth: 1,'), ['core'], 'minDepth 写死');
mut('Z11', CORE, sub('const budget = () => out.actioned < cap;', 'const budget = () => true;'), ['core'], 'cap 不生效');
mut('Z12', CORE, sub('if (staleAlerted.has(k)) continue;', ''), ['core'], 'prepared_stale 不幂等');
mut('Z13', CORE, sub('if (slaAlerted.has(k)) return;', ''), ['core'], 'SLA 报警不幂等');
mut('Z14', CORE, sub("if (!Object.prototype.hasOwnProperty.call(SETTLEMENT_ALERTS, eventType)) throw new Error(`settlement alert: 事件名 ${eventType} 未登记进 SETTLEMENT_ALERTS`);", ''), ['core'], '报警名不校验闭集');
mut('Z15', CORE, sub("if (row.status === 'landed' || row.status === 'submitted') return { outcome: 'in_flight', key, status: row.status };", ''), ['core'], 'submitted / landed 也再走构造');
mut('Z16', CORE, sub("if (row.status === 'pending') {\n        const dep", 'if (true) {\n        const dep'), ['core'], 'prepared 行也检查依赖(应只同字节重播)');
mut('Z17', CORE, sub('intent_key: key, tx_json: built.txJson', 'intent_key: subjectId, tx_json: built.txJson'), ['core'], '广播的 intent_key 写错');
mut('Z18', CORE, sub("if (RELAY_FEE_REJECT_CODES.includes(code)) alert('settlement_relay_fee_rejected'", "if (false) alert('settlement_relay_fee_rejected'"), ['core'], 'relay fee 拒绝不报警');
mut('Z19', CORE, sub("close_commit: Object.freeze({ subjectType: 'market', intentStep: 'resolve' })", "close_commit: Object.freeze({ subjectType: 'market', intentStep: 'close_commit' })"), ['core'], 'close_commit 的意图 step 名写错');
mut('Z20', CORE, sub('readFailed: true, reason: `get_past_median_time 抛错', 'readFailed: false, reason: `get_past_median_time 抛错'), ['core'], 'pmt 读抛错不算读失败');
mut('Z21', CORE, sub("if (n === PMT_READ_FAIL_ALERT_AFTER)", "if (n >= PMT_READ_FAIL_ALERT_AFTER)"), ['core'], 'pmt 读失败每次都报(不止第 3 次)');
mut('Z22', CORE, sub("import { classifyC1Error, createTransportAlertGrader, withFeeParent } from './proto-settlement-c1.mjs';", "import { classifyC1Error, createTransportAlertGrader, withFeeParent } from './proto-settlement-c1.mjs';\nimport { sqlite } from '../db/client.js';"), ['core'], '核心又拖进 db/client');
mut('Z23', ASM, sub("pmtEvidence.source === 'relay' && ", ''), ['asm'], 'S5: builder 不校验证据来源');
mut('Z24', ASM, sub('evidenceAgeMs <= PMT_EVIDENCE_MAX_AGE_MS && ', ''), ['asm'], 'S5: builder 不校验证据新鲜度');
mut('Z25', ASM, sub('export const PMT_EVIDENCE_MAX_AGE_MS = 60_000;', 'export const PMT_EVIDENCE_MAX_AGE_MS = 600_000;'), ['asm'], 'S5: 新鲜度阈值放宽到 10 分钟');
console.log('BASELINE'); for (const k of Object.keys(T)) { const r = run(k); console.log(`  ${k}: exit=${r.status} ${r.last}`); if (r.status !== 0) { console.log('BASELINE 不绿, 中止'); process.exit(2); } }
let surv = 0;
for (const [id, file, f, tests, why] of M) {
  const abs = path.join(ROOT, file); const orig = fs.readFileSync(abs, 'utf8');
  let m; try { m = f(orig); } catch (e) { console.log(`${id}: 变换失败(${e.message}) :: ${why}`); surv++; continue; }
  try { fs.writeFileSync(abs, m); const res = tests.map((k) => ({ k, ...run(k) })); const red = res.some((r) => r.status !== 0); if (!red) surv++; console.log(`${id}: ${red ? 'KILLED' : 'SURVIVED'} [${res.map((r) => `${r.k}:exit=${r.status}`).join(' ')}] :: ${why}`); }
  finally { fs.writeFileSync(abs, orig); if (fs.readFileSync(abs, 'utf8') !== orig) throw new Error('还原失败 ' + file); }
}
console.log('RESTORED'); let ok = true; for (const k of Object.keys(T)) { const r = run(k); console.log(`  ${k}: exit=${r.status} ${r.last}`); if (r.status !== 0) ok = false; }
console.log(`SUMMARY mutants=${M.length} survivors=${surv} restored_green=${ok}`); process.exitCode = surv || !ok ? 1 : 0;
