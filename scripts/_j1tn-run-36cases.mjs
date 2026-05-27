// Run all 36 dm-agent cases as individual --case= invocations.
// Default runner skips skip_in_batch=true in batch mode; --case= bypasses that.
//
// Env required:
//   KANET_CONSOLE_URL=http://127.0.0.1:3300
//   KANET_DB_PATH=D:/kanet-testnet/kasia-console/data/console.db
//   PREDICTION_AGENT_ENABLED=1
//   (optional) PREDICTION_AGENT_RELAY_ID=<J1tn-Alice id>
//   (optional) TEST_USER_ADDR / TEST_USER_PK / CONCUR_USER_0..4
//
// Output: PASS / FAIL / SKIP summary + per-case trace file path.

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const CASES_DIR = 'D:/Anthropic/kasia-console/test-framework/cases/predictions/dm-agent';
const CWD = 'D:/Anthropic/kasia-console';

const files = readdirSync(CASES_DIR)
  .filter(f => f.endsWith('.test.mjs'))
  .sort()
  .map(f => path.join(CASES_DIR, f));

console.log(`Found ${files.length} dim cases. Running...\n`);

const results = [];
for (const file of files) {
  const rel = path.relative(CWD, file).replace(/\\/g, '/');
  await new Promise(resolve => {
    const child = spawn('node', ['scripts/test.mjs', `--case=${rel}`, '--quiet'], {
      cwd: CWD,
      env: process.env,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    // Per-case wall-clock cap: 45s. Long real_chain cases use wait_for_db_row internally; even with
    // their 60s+180s polls they should respect timeout_ms. If a case exceeds 45s here, kill it +
    // record as ? — caller can re-run that one specifically.
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 45000);
    child.on('exit', code => {
      clearTimeout(killer);
      const id = path.basename(file, '.test.mjs');
      // parse last summary line OR result line
      const lines = (stdout + '\n' + stderr).split('\n');
      const summary = lines.find(l => /Summary:/.test(l)) || '';
      const resultLine = lines.find(l => /^[✓✗] /.test(l)) || '';
      const pass = resultLine.startsWith('✓');
      const fail = resultLine.startsWith('✗');
      results.push({ id, pass, fail, exit: code, summary: summary.trim(), result: resultLine.trim() });
      console.log(`${pass ? '✓' : fail ? '✗' : '?'} ${id}`);
      resolve();
    });
  });
}

console.log('\n' + '═'.repeat(60));
const pass = results.filter(r => r.pass).length;
const fail = results.filter(r => r.fail).length;
const other = results.length - pass - fail;
console.log(`Total: ${results.length}  ·  PASS: ${pass}  ·  FAIL: ${fail}  ·  OTHER: ${other}`);
console.log('═'.repeat(60));

if (fail > 0) {
  console.log('\nFAILED:');
  results.filter(r => r.fail).forEach(r => console.log(`  ✗ ${r.id} :: ${r.result}`));
}
if (other > 0) {
  console.log('\nOTHER (no clear ✓/✗):');
  results.filter(r => !r.pass && !r.fail).forEach(r => console.log(`  ? ${r.id} exit=${r.exit} :: ${r.summary || r.result || 'no output'}`));
}
process.exit(fail > 0 ? 1 : 0);
