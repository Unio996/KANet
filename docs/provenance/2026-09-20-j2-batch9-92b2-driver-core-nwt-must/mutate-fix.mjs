// 9-2b(ii) 补笔(NWT e4039235 MUST)——变异对照: 广播失败分类 / 计数 / 幂等。用法(仓库根): node docs/provenance/2026-09-20-j2-batch9-92b2-driver-core-nwt-must/mutate-fix.mjs > mutation-raw.txt
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FILE = path.join(ROOT, 'kasia-console/src/lib/proto-settlement-driver-core.mjs');
const run = () => { const r = spawnSync(process.execPath, ['src/lib/proto-settlement-driver-core.test.mjs'], { cwd: path.join(ROOT, 'kasia-console'), encoding: 'utf8', timeout: 250000 }); return { status: r.status, last: ((r.stdout || '') + (r.stderr || '')).match(/\d+ passed, \d+ failed/)?.[0] || '?' }; };
const sub = (a, b) => (s) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`锚点命中 ${n}: ${a.slice(0, 50)}`); return s.replace(a, () => b); };
const M = [
  ['F1', sub('const gate = EXIT_GATE_REFUSAL_CODES.find((c) => msg.includes(c));', 'const gate = undefined;'), '不识别出口闸的确定性拒绝(仍当瞬时静默重试)'],
  ['F2', sub('export const BROADCAST_FAIL_ALERT_AFTER = 3;', 'export const BROADCAST_FAIL_ALERT_AFTER = 2;'), '阈值 3 → 2'],
  ['F3', sub('if (st.count >= BROADCAST_FAIL_ALERT_AFTER && !st.alerted) {', 'if (st.count >= BROADCAST_FAIL_ALERT_AFTER) {'), '报警不幂等(第 4 次起重复)'],
  ['F4', sub('if (tickId !== st.lastTick) { st.count += 1; st.lastTick = tickId; }', 'st.count += 1; st.lastTick = tickId;'), '同一 tick 内重复也累计'],
  ['F5', sub('if (!st || st.code !== code) {', 'if (!st) {'), 'code 变了不重计'],
  ['F6', sub('pmtFail.delete(key); bcastFail.delete(key);', 'pmtFail.delete(key);'), '成功不清零'],
  ['F7', sub("if (c.track) trackBroadcastFailure(key, c.code, tickId);", ''), '广播失败不计数'],
  ['F8', sub("return { report: true, eventType: 'settlement_step_unexpected_error', level: 'error', code: gate, transient: false };", "return { report: true, eventType: 'settlement_step_unexpected_error', level: 'warn', code: gate, transient: false };"), '确定性拒绝级别降成 warn'],
];
console.log('BASELINE'); const b = run(); console.log(`  exit=${b.status} ${b.last}`); if (b.status !== 0) process.exit(2);
let surv = 0;
for (const [id, f, why] of M) { const orig = fs.readFileSync(FILE, 'utf8'); let m; try { m = f(orig); } catch (e) { console.log(`${id}: 变换失败(${e.message})`); surv++; continue; }
  try { fs.writeFileSync(FILE, m); const r = run(); if (r.status === 0) surv++; console.log(`${id}: ${r.status !== 0 ? 'KILLED' : 'SURVIVED'} exit=${r.status} :: ${why}`); } finally { fs.writeFileSync(FILE, orig); if (fs.readFileSync(FILE, 'utf8') !== orig) throw new Error('还原失败'); } }
const a = run(); console.log(`RESTORED exit=${a.status} ${a.last}`); console.log(`SUMMARY mutants=${M.length} survivors=${surv} restored_green=${a.status === 0}`); process.exitCode = surv || a.status !== 0 ? 1 : 0;
