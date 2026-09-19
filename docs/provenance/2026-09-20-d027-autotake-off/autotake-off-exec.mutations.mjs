// autotake-off-exec.mutations.mjs -- mutation harness for the D-027 executor. Run from THIS directory: node autotake-off-exec.mutations.mjs  (expects: ALL MUTANTS KILLED)
// mutation harness for autotake-off-exec.mjs: each mutant is a temp copy; tests run against it via SCRIPT env
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os'; import path from 'node:path';
const here = process.cwd();
const src = readFileSync(path.join(here, 'autotake-off-exec.mjs'), 'utf8');
const M = {
  M1_no_changes_check: ["if (r.changes !== 1) {", "if (false) {"],
  M2_no_precondition_value: ["if (before.value_encrypted !== FROM) {", "if (false) {"],
  M3_unkeyed_update: ["WHERE key = ? AND value_encrypted = ?", "WHERE ? IS NOT NULL AND value_encrypted = ?"],
  M4_commit_before_event: ["stage = 'event';\n", "db.exec('COMMIT'); db.exec('BEGIN IMMEDIATE'); stage = 'event';\n"],
  M5_no_go_check: ["MODE !== 'read' && GO !== 'D-027'", "false"],
  M6_no_wal_check: ["if (jm !== 'wal') {", "if (false) {"],
  M7_rollback_direction: ["const TO = MODE === 'apply' ? 'false' : 'true';", "const TO = MODE === 'apply' ? 'false' : 'false';"],
  M8_no_updated_at: [".run(TO, now, KEY, FROM)", ".run(TO, before.updated_at, KEY, FROM)"],
  M9_postread_ignored: ["process.exit(a2 && a2.value_encrypted === TO ? 0 : 5);", "process.exit(0);"],
  M10_deferred_begin: ["db.exec('BEGIN IMMEDIATE');", "db.exec('BEGIN');"],
  M11_read_writable: ["readonly: MODE === 'read'", "readonly: false"],
  M12_no_sensitive_check: ["if (before.is_sensitive !== 0) {", "if (false) {"],
  M13_no_absent_check: ["if (!before) {", "if (false) {"],
  M14_sets_journal_mode: ["const jm = String(db.pragma('journal_mode', { simple: true })).toLowerCase();", "db.pragma('journal_mode = DELETE'); const jm = 'wal';"],
  M15_touches_mode_row: [".run(TO, now, KEY, FROM);", ".run(TO, now, KEY, FROM); db.prepare(\"UPDATE config_entries SET updated_at = ? WHERE key = 'autotake_mode'\").run(now);"],
};
const tmp = mkdtempSync(path.join(os.tmpdir(), 'atmut-'));
let bad = 0;
for (const [name, [a, b]] of Object.entries(M)) {
  if (src.split(a).length !== 2) { console.log(`${name}: ANCHOR NOT UNIQUE/ABSENT`); bad++; continue; }
  const f = path.join(tmp, name + '.mjs'); writeFileSync(f, src.replace(a, () => b));
  const r = spawnSync(process.execPath, ['--test', path.join(here, 'autotake-off-exec.test.mjs')], { env: { ...process.env, SCRIPT: f }, encoding: 'utf8' });
  const fails = ((r.stdout || '').match(/^ℹ fail (\d+)/m) || [])[1];
  const killed = r.status !== 0;
  console.log(`${name}: ${killed ? 'KILLED' : 'SURVIVED'} (failing tests: ${fails})`);
  if (!killed) bad++;
}
rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `SURVIVORS/ERRORS: ${bad}` : 'ALL MUTANTS KILLED');
