// 9-2b (iii-1) 补笔(NWT 38b983e4 MUST: 后效待应用)——变异对照。用法(仓库根): node docs/provenance/2026-09-20-j2-batch9-92b3-effects-pending/mutate-effects.mjs > mutation-raw.txt
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = 'kasia-console/src/lib/proto-settlement-driver-core.mjs', STORE = 'kasia-console/src/lib/proto-settlement-store.mjs';
const T = { core: 'src/lib/proto-settlement-driver-core.test.mjs', store: 'src/lib/proto-settlement-store.test.mjs' };
const run = (k) => { const r = spawnSync(process.execPath, [T[k]], { cwd: path.join(ROOT, 'kasia-console'), encoding: 'utf8', timeout: 280000, maxBuffer: 1 << 26 }); return { status: r.status, last: ((r.stdout || '') + (r.stderr || '')).match(/\d+ passed, \d+ failed/)?.[0] || '?' }; };
const sub = (a, b) => (s) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`锚点命中 ${n}: ${a.slice(0, 50)}`); return s.replace(a, () => b); };
const M = [
  ['E1', STORE, sub("WHERE s.subject_type = 'market' AND s.step = 'seal' AND s.status = 'landed' AND m.status = 'betting'", "WHERE s.subject_type = 'market' AND s.step = 'seal' AND s.status = 'landed' AND 1 = 0"), ['store'], 'seal landed 后效待应用不列出'],
  ['E2', STORE, sub("AND (m.status = 'sealed'\n             OR NOT EXISTS", "AND (1 = 0\n             OR NOT EXISTS"), ['store'], 'resolve landed 但市场仍 sealed 不列出'],
  ['E3', STORE, sub("WHERE s.subject_type = 'claim' AND s.step = 'claim_draw' AND s.status = 'landed' AND c.claim_txid IS NULL", "WHERE s.subject_type = 'claim' AND s.step = 'claim_draw' AND s.status = 'landed' AND 1 = 0"), ['store'], 'claim_draw landed 但未记 claim_txid 不列出'],
  ['E4', STORE, sub("AND NOT EXISTS (SELECT 1 FROM proto_settlement_intents i WHERE i.subject_type = 'claim' AND i.subject_id = s.subject_id AND i.step = 'claim_draw')", "AND 1 = 0"), ['store'], 'convert landed 但无 claim_draw 意图不列出'],
  ['E5', STORE, sub("return { landedChecks, preparedRows, advances: deduped, effectsPending };", "return { landedChecks, preparedRows, advances: deduped, effectsPending: [] };"), ['store', 'core'], 'listWork 不返回 effectsPending'],
  ['E6', STORE, sub("else { const w = deriveWinnerBet(marketId, { db, who:", "else if (false) { const w = deriveWinnerBet(marketId, { db, who:"), ['store'], '已 resolved 缺 claim 行不补建(永远挂起)'],
  ['E7', CORE, sub("for (const it of (work.effectsPending || [])) {", "for (const it of []) {"), ['core', 'store'], 'runTick 不处理 effectsPending'],
  ['E8', CORE, sub("alert('settlement_step_unexpected_error', `${intent.intent_key}: 已 landed 但后效应用失败", "if (false) alert('settlement_step_unexpected_error', `${intent.intent_key}: 已 landed 但后效应用失败"), ['core', 'store'], '后效应用失败不报警'],
  ['E9', CORE, sub("out.effectsApplied = 0;\n    for (const it of (work.effectsPending || [])) {           // 最先", "out.effectsApplied = 0;\n    for (const it of (work.landedChecks || []).length ? [] : (work.effectsPending || [])) {           // 最先"), ['core'], 'effectsPending 排在 landed 检查之后(有 landedChecks 时被饿死)'],
];
console.log('BASELINE'); for (const k of Object.keys(T)) { const r = run(k); console.log(`  ${k}: exit=${r.status} ${r.last}`); if (r.status !== 0) { console.log('BASELINE 不绿, 中止'); process.exit(2); } }
let surv = 0;
for (const [id, file, f, tests, why] of M) {
  const abs = path.join(ROOT, file); const orig = fs.readFileSync(abs, 'utf8'); let m;
  try { m = f(orig); } catch (e) { console.log(`${id}: 变换失败(${e.message}) :: ${why}`); surv++; continue; }
  try { fs.writeFileSync(abs, m); const res = tests.map((k) => ({ k, ...run(k) })); const red = res.some((r) => r.status !== 0); if (!red) surv++; console.log(`${id}: ${red ? 'KILLED' : 'SURVIVED'} [${res.map((r) => `${r.k}:exit=${r.status}`).join(' ')}] :: ${why}`); }
  finally { fs.writeFileSync(abs, orig); if (fs.readFileSync(abs, 'utf8') !== orig) throw new Error('还原失败 ' + file); }
}
console.log('RESTORED'); let ok = true; for (const k of Object.keys(T)) { const r = run(k); console.log(`  ${k}: exit=${r.status} ${r.last}`); if (r.status !== 0) ok = false; }
console.log(`SUMMARY mutants=${M.length} survivors=${surv} restored_green=${ok}`); process.exitCode = surv || !ok ? 1 : 0;
