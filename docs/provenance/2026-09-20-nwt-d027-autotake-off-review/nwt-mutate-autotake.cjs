const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const F = 'autotake-off-exec.mjs'; const orig = fs.readFileSync(F, 'utf8'); const sha0 = crypto.createHash('sha256').update(orig).digest('hex');
const R = (a, b) => s => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`pattern matched ${n}x: ${a.slice(0, 60)}`); return s.replace(a, b); };
const M = [
  ['NWT-a1 busy timeout option not passed to the connection (default 5 s)', R("readonly: MODE === 'read', timeout: TIMEOUT_MS }", "readonly: MODE === 'read' }")],
  ['NWT-a2 UPDATE drops is_sensitive=0 (precondition in same txn still checks)', R("WHERE key = ? AND value_encrypted = ? AND is_sensitive = 0`", "WHERE key = ? AND value_encrypted = ?`")],
  ['NWT-a3 no explicit ROLLBACK on precondition failure (process exit closes txn)', R("if (before.value_encrypted !== FROM) { db.exec('ROLLBACK'); die(3,", "if (before.value_encrypted !== FROM) { die(3,")],
  ['NWT-a4 event payload previous_updated_at replaced by now', R("previous_updated_at: before.updated_at,", "previous_updated_at: now,")],
  ['NWT-a5 event source/scope literal changed (breaks read-mode EVENTS lookup)', R("'system', ?, 'kanetui-d027-runbook', 'info'", "'system', ?, 'other-source', 'info'")],
  ['NWT-a6 rollback mode requires FROM=true (direction on the precondition side)', R("const FROM = MODE === 'apply' ? 'true' : 'false';", "const FROM = 'true';")],
  ['NWT-a7 exit code 0 even if post-read differs', R("process.exit(a2 && a2.value_encrypted === TO ? 0 : 5);", "process.exit(0);")],
];
const out = [];
for (const [n, fn] of M) {
  let m; try { m = fn(orig); } catch (e) { out.push('?? ' + n + ' :: ' + e.message); continue; }
  fs.writeFileSync(F, m);
  const r = cp.spawnSync(process.execPath, ['--test', 'autotake-off-exec.test.mjs'], { encoding: 'utf8', timeout: 240000 });
  const fails = ((r.stdout || '').match(/^# fail (\d+)/m) || [])[1];
  out.push((r.status === 0 ? 'SURVIVED ' : 'killed   ') + n + (r.status === 0 ? '' : '   (test run exit=' + r.status + ')'));
  fs.writeFileSync(F, orig);
}
fs.writeFileSync(F, orig);
console.log(out.join('\n')); console.log('restored sha256 identical: ' + (sha0 === crypto.createHash('sha256').update(fs.readFileSync(F)).digest('hex')) + '  ' + sha0.slice(0, 16));
