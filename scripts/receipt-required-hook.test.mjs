#!/usr/bin/env node
// receipt-required-hook.test.mjs — durable regression for scripts/receipt-required-hook.mjs (规则48).
// Bettor r-? requested an empirical lock after a real-transcript zero-warn bug. Fixtures use the REAL
// Claude Code transcript shape: each line {type, message:{role, content:[blocks]}}, tool_result is a
// role=user message, each block (thinking/text/tool_use/tool_result) often its own line.
// Run: node scripts/receipt-required-hook.test.mjs   (exit 0 all pass / 1 any fail)

import { writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const HOOK = new URL('./receipt-required-hook.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// cwd-INDEPENDENT: write the temp fixture next to THIS test file (absolute, via import.meta.url),
// not `./` — else running from a different cwd (e.g. /tmp) gives a flawed-setup false alarm
// (both KANet-UI and Bettor hit this; the test must mirror production = run from anywhere).
const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let _seq = 0;
function runHook(lines) {
  const tmp = `${HERE}_rr_test_${_seq++}.jsonl`;
  writeFileSync(tmp, lines.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const r = spawnSync('node', [HOOK], { input: JSON.stringify({ transcript_path: tmp }), encoding: 'utf8' });
  try { unlinkSync(tmp); } catch { /* ignore */ }
  return /receipt-required/.test(r.stderr || '');
}

// real Claude Code shape helpers
const userPrompt = (t) => ({ type: 'user', message: { role: 'user', content: t } });
const asstText = (t) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] } });
const asstThink = (t) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: t }] } });
const asstTool = (name) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input: {} }] } });
const toolResult = (c) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: c }] } });

const CLAIM = '已发频道消息。';
const cases = [
  { name: 'claim + clean no-receipt result → WARN',
    lines: [userPrompt('do it'), asstThink('plan'), asstText(CLAIM), asstTool('Bash'), toolResult('Error: route not found')],
    expectWarn: true },
  { name: 'claim + sent <hex> receipt → SILENT',
    lines: [userPrompt('do it'), asstText(CLAIM), asstTool('Bash'), toolResult('sent 1fcc6a9a26')],
    expectWarn: false },
  { name: 'claim + exit-0 receipt → SILENT',
    lines: [userPrompt('do it'), asstText('已 commit 了。'), asstTool('Bash'), toolResult('HEAD: 0c50898d\nexit 0')],
    expectWarn: false },
  { name: 'no claim (thinking only) → SILENT',
    lines: [userPrompt('think'), asstThink('deep thoughts'), asstText('我在分析这个设计点。')],
    expectWarn: false },
  { name: 'claim + tool_result content as OBJECT no receipt → WARN',
    lines: [userPrompt('do it'), asstText(CLAIM), asstTool('Bash'), toolResult([{ type: 'text', text: 'route not found' }])],
    expectWarn: true },
  { name: 'flat shape (role at top, content array) claim no-receipt → WARN',
    lines: [{ role: 'user', content: 'do it' }, { role: 'assistant', content: [{ type: 'text', text: CLAIM }] }, { role: 'user', content: [{ type: 'tool_result', content: 'failed' }] }],
    expectWarn: true },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const warned = runHook(c.lines);
  const ok = warned === c.expectWarn;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name} (warned=${warned}, expect=${c.expectWarn})`);
  ok ? pass++ : fail++;
}
console.log(`\n${fail === 0 ? '✅' : '❌'} receipt-required hook regression: ${pass}/${pass + fail} pass`);
process.exit(fail === 0 ? 0 : 1);
