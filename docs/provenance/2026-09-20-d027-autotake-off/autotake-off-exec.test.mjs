// autotake-off-exec.test.mjs -- tests for the D-027 one-off executor. Runs ONLY against fixture DBs in an mkdtemp dir; never opens the mainnet DB.
//   node --test autotake-off-exec.test.mjs                       (SCRIPT env var = script under test; default = ./autotake-off-exec.mjs next to this file)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'D:/kanet-tn12';
const Database = createRequire(path.join(REPO, 'kasia-console', 'package.json'))('better-sqlite3');
const SCRIPT = path.resolve(process.env.SCRIPT || path.join(path.dirname(fileURLToPath(import.meta.url)), 'autotake-off-exec.mjs'));

// ---- safety: every path this test writes or deletes must be under a fresh temp dir; the mainnet DB is never touched
const TMP = mkdtempSync(path.join(os.tmpdir(), 'autotake-exec-test-'));
const underTmp = (p) => path.resolve(p).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep) && path.resolve(p).toLowerCase().startsWith(path.resolve(TMP).toLowerCase());
assert.ok(underTmp(TMP), 'TMP must be under the OS temp dir');
const MAINNET_DB = path.resolve(REPO, 'kasia-console', 'data', 'console.mainnet.db').toLowerCase();
after(() => { assert.ok(underTmp(TMP)); rmSync(TMP, { recursive: true, force: true }); });

const DDL = `
CREATE TABLE events (id TEXT PRIMARY KEY, trace_id TEXT, event_scope TEXT NOT NULL DEFAULT 'system', event_type TEXT NOT NULL, source TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info',
  conversation_id TEXT, message_id TEXT, reply_id TEXT, tx_record_id TEXT, summary TEXT NOT NULL DEFAULT '', payload_json TEXT, created_at TEXT NOT NULL, agent_address TEXT);
CREATE TABLE config_entries (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, category TEXT NOT NULL DEFAULT 'general', value_encrypted TEXT, value_plain_hint TEXT,
  is_sensitive INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, created_at TEXT NOT NULL);`;
const T0 = '2026-09-13 15:33:53';
let n = 0;
function fixture({ wal = true, autotake = 'true', sensitive = 0, omit = false, extra = true } = {}) {
  const file = path.join(TMP, `fx${++n}.db`);
  assert.ok(underTmp(file) && file.toLowerCase() !== MAINNET_DB);
  const d = new Database(file);
  if (wal) d.pragma('journal_mode = WAL');
  d.exec(DDL);
  const ins = d.prepare('INSERT INTO config_entries (id,key,category,value_encrypted,value_plain_hint,is_sensitive,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?)');
  if (!omit) ins.run('c1', 'autotake_enabled', 'broker_autotake', autotake, null, sensitive, T0, T0);
  ins.run('c2', 'autotake_mode', 'broker_autotake', 'auto', null, 0, T0, T0);
  ins.run('c3', 'autotake_min_discount_pct', 'broker_autotake', '0.5', null, 0, T0, T0);
  if (extra) ins.run('c4', 'some_other_flag', 'general', 'true', 'hint', 0, T0, T0);   // another row whose value is 'true' (so an un-keyed UPDATE would hit >1 rows)
  d.close();
  return file;
}
const snap = (file) => { const d = new Database(file, { readonly: true }); try { return { cfg: d.prepare('SELECT * FROM config_entries ORDER BY key').all(), ev: d.prepare('SELECT * FROM events ORDER BY created_at').all() }; } finally { d.close(); } };
const run = (file, ...args) => {
  assert.ok(underTmp(file) && file.toLowerCase() !== MAINNET_DB, 'test may only point the tool at a fixture DB');
  const r = spawnSync(process.execPath, [SCRIPT, '--db', file, ...args], { encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const byKey = (s, k) => s.cfg.find((r) => r.key === k);

test('read mode: exit 0, prints both rows, changes nothing (rows + no event)', () => {
  const f = fixture(); const before = snap(f);
  const r = run(f, '--mode', 'read');
  assert.equal(r.code, 0); assert.match(r.out, /journal_mode=wal/); assert.match(r.out, /READ .*"key":"autotake_enabled".*"value_encrypted":"true"/); assert.match(r.out, /READ .*"key":"autotake_mode".*"value_encrypted":"auto"/);
  assert.deepEqual(snap(f), before);
});
test('read mode lists the D-027 events already recorded (none before, one after apply, two after rollback)', () => {
  const f = fixture(); assert.match(run(f, '--mode', 'read').out, /EVENTS 0/);
  assert.equal(run(f, '--mode', 'apply', '--go', 'D-027').code, 0); const r1 = run(f, '--mode', 'read').out; assert.match(r1, /EVENTS 1/); assert.match(r1, /EVENT .*config_change.*true -> false/);
  assert.equal(run(f, '--mode', 'rollback', '--go', 'D-027').code, 0); assert.match(run(f, '--mode', 'read').out, /EVENTS 2/);
});
test('read is the default mode', () => { const f = fixture(); const r = run(f); assert.equal(r.code, 0); assert.match(r.out, /READ /); assert.deepEqual(snap(f).ev, []); });
test('read works while another connection holds the DB open in WAL (the console situation) and with a writer mid-transaction', () => {
  const f = fixture(); const w = new Database(f); w.pragma('journal_mode'); w.exec('BEGIN IMMEDIATE'); w.prepare("UPDATE config_entries SET updated_at='x' WHERE key='some_other_flag'").run();
  try { const r = run(f, '--mode', 'read'); assert.equal(r.code, 0); assert.match(r.out, /"value_encrypted":"true"/); } finally { w.exec('ROLLBACK'); w.close(); }
});

test('apply: exactly autotake_enabled true->false + updated_at; every other cell of every row untouched; one event with before/after/time', () => {
  const f = fixture(); const b = snap(f);
  const r = run(f, '--mode', 'apply', '--go', 'D-027');
  assert.equal(r.code, 0, r.out); assert.match(r.out, /DONE apply: autotake_enabled 'true' -> 'false'/); assert.match(r.out, /AFTER .*"value_encrypted":"false"/);
  const a = snap(f);
  const A0 = byKey(b, 'autotake_enabled'), A1 = byKey(a, 'autotake_enabled');
  assert.equal(A1.value_encrypted, 'false'); assert.notEqual(A1.updated_at, A0.updated_at); assert.match(A1.updated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual({ ...A1, value_encrypted: A0.value_encrypted, updated_at: A0.updated_at }, A0, 'category/hint/is_sensitive/id/created_at unchanged');
  for (const k of ['autotake_mode', 'autotake_min_discount_pct', 'some_other_flag']) assert.deepEqual(byKey(a, k), byKey(b, k), `${k} untouched`);
  assert.equal(a.ev.length, 1); const e = a.ev[0]; const p = JSON.parse(e.payload_json);
  assert.equal(e.event_scope, 'system'); assert.equal(e.event_type, 'config_change'); assert.equal(e.source, 'kanetui-d027-runbook'); assert.equal(e.level, 'info');
  assert.equal(e.created_at, A1.updated_at); assert.match(e.summary, /true -> false/); assert.match(e.summary, /D-027/); assert.match(e.summary, /autotake_mode untouched \('auto'\)/);
  assert.deepEqual([p.decision, p.key, p.before, p.after, p.previous_updated_at, p.changed_at, p.mode_value_untouched], ['D-027', 'autotake_enabled', 'true', 'false', T0, A1.updated_at, 'auto']);
});
test('apply leaves the DB in WAL (the tool never changes journal_mode)', () => {
  const f = fixture(); assert.equal(run(f, '--mode', 'apply', '--go', 'D-027').code, 0);
  const d = new Database(f, { readonly: true }); try { assert.equal(d.pragma('journal_mode', { simple: true }), 'wal'); } finally { d.close(); }
});
test('apply without --go D-027 (or with another token): exit 2, nothing written', () => {
  for (const args of [[], ['--go', 'yes'], ['--go', 'd-027'], ['--go']]) { const f = fixture(); const b = snap(f); const r = run(f, '--mode', 'apply', ...args); assert.equal(r.code, 2, r.out); assert.deepEqual(snap(f), b); }
});
test('unknown mode / bad timeout / missing db: exit 2', () => {
  const f = fixture(); assert.equal(run(f, '--mode', 'wipe', '--go', 'D-027').code, 2); assert.equal(run(f, '--mode', 'read', '--timeout-ms', 'abc').code, 2);
  assert.equal(run(path.join(TMP, 'does-not-exist.db'), '--mode', 'read').code, 2);
});
test('precondition: already false -> exit 3, nothing written, no event', () => { const f = fixture({ autotake: 'false' }); const b = snap(f); const r = run(f, '--mode', 'apply', '--go', 'D-027'); assert.equal(r.code, 3); assert.match(r.out, /is 'false', expected 'true'/); assert.deepEqual(snap(f), b); });
test('precondition: value must match exactly (TRUE / " true" / "1" / null all refused)', () => {
  for (const v of ['TRUE', ' true', 'true ', '1', null]) { const f = fixture({ autotake: v }); const b = snap(f); assert.equal(run(f, '--mode', 'apply', '--go', 'D-027').code, 3, String(v)); assert.deepEqual(snap(f), b); }
});
test('precondition: row absent -> exit 3; sensitive row -> exit 3; nothing written', () => {
  for (const o of [{ omit: true }, { sensitive: 1 }]) { const f = fixture(o); const b = snap(f); const r = run(f, '--mode', 'apply', '--go', 'D-027'); assert.equal(r.code, 3, r.out); assert.deepEqual(snap(f), b); }
});
test('journal_mode is not wal -> exit 2, nothing written', () => { const f = fixture({ wal: false }); const b = snap(f); const r = run(f, '--mode', 'apply', '--go', 'D-027'); assert.equal(r.code, 2); assert.match(r.out, /expected 'wal'/); assert.deepEqual(snap(f), b); });
test('UPDATE that changes 0 rows (a trigger swallows it) -> exit 4, rolled back, no event', () => {
  const f = fixture(); const d = new Database(f); d.exec("CREATE TRIGGER swallow BEFORE UPDATE ON config_entries BEGIN SELECT RAISE(IGNORE); END"); d.close(); const b = snap(f);
  const r = run(f, '--mode', 'apply', '--go', 'D-027'); assert.equal(r.code, 4, r.out); assert.match(r.out, /changed 0 rows/); assert.deepEqual(snap(f), b);
});
test('an un-keyed UPDATE would hit 2 rows here (fixture sanity: two rows have value true) -- the tool touches only autotake_enabled', () => {
  const f = fixture(); const d = new Database(f, { readonly: true }); assert.equal(d.prepare("SELECT count(*) c FROM config_entries WHERE value_encrypted='true'").get().c, 2); d.close();
  assert.equal(run(f, '--mode', 'apply', '--go', 'D-027').code, 0); assert.equal(byKey(snap(f), 'some_other_flag').value_encrypted, 'true');
});
test('event insert fails -> exit 5 and the config UPDATE is rolled back (one transaction)', () => {
  const f = fixture(); const d = new Database(f); d.exec("CREATE TRIGGER noev BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'no events today'); END"); d.close(); const b = snap(f);
  const r = run(f, '--mode', 'apply', '--go', 'D-027'); assert.equal(r.code, 5, r.out); assert.match(r.out, /stage 'event'/); assert.deepEqual(snap(f), b);
});
test('post-commit re-read disagrees (a trigger flips it back) -> exit 5, not a false "done"', () => {
  const f = fixture(); const d = new Database(f); d.exec("CREATE TRIGGER flipback AFTER UPDATE OF value_encrypted ON config_entries WHEN NEW.key='autotake_enabled' AND NEW.value_encrypted='false' BEGIN UPDATE config_entries SET value_encrypted='true' WHERE key='autotake_enabled'; END"); d.close();
  const r = run(f, '--mode', 'apply', '--go', 'D-027'); assert.equal(r.code, 5, r.out); assert.match(r.out, /AFTER .*"value_encrypted":"true"/);
});
test('write lock held by another connection: waits --timeout-ms then exit 5 (SQLITE_BUSY), nothing written', () => {
  const f = fixture(); const b = snap(f); const w = new Database(f); w.pragma('journal_mode'); w.exec('BEGIN IMMEDIATE');
  try { const t = Date.now(); const r = run(f, '--mode', 'apply', '--go', 'D-027', '--timeout-ms', '400'); assert.equal(r.code, 5, r.out); assert.match(r.out, /SQLITE_BUSY|locked/i); assert.match(r.out, /stage .begin./); assert.ok(Date.now() - t >= 300, 'it did wait for the lock'); } finally { w.exec('ROLLBACK'); w.close(); }
  assert.deepEqual(snap(f), b);
});
test('an open reader transaction does not block the write (WAL); it keeps its snapshot until it ends, then sees false; a fresh reader sees false immediately', () => {
  const f = fixture(); const rd = new Database(f); rd.pragma('journal_mode'); rd.exec('BEGIN'); assert.equal(rd.prepare("SELECT value_encrypted v FROM config_entries WHERE key='autotake_enabled'").get().v, 'true');
  try {
    const r = run(f, '--mode', 'apply', '--go', 'D-027'); assert.equal(r.code, 0, r.out);
    assert.equal(rd.prepare("SELECT value_encrypted v FROM config_entries WHERE key='autotake_enabled'").get().v, 'true', 'old snapshot inside the open txn');
    const fresh = new Database(f, { readonly: true }); assert.equal(fresh.prepare("SELECT value_encrypted v FROM config_entries WHERE key='autotake_enabled'").get().v, 'false'); fresh.close();
  } finally { rd.exec('COMMIT'); }
  assert.equal(rd.prepare("SELECT value_encrypted v FROM config_entries WHERE key='autotake_enabled'").get().v, 'false', 'a long-lived connection sees it on its next statement'); rd.close();
});
test('rollback: after apply, rollback restores true and adds a config_change_rollback event; second rollback -> exit 3', () => {
  const f = fixture(); assert.equal(run(f, '--mode', 'apply', '--go', 'D-027').code, 0);
  const r = run(f, '--mode', 'rollback', '--go', 'D-027'); assert.equal(r.code, 0, r.out); assert.match(r.out, /DONE rollback: autotake_enabled 'false' -> 'true'/);
  const a = snap(f); assert.equal(byKey(a, 'autotake_enabled').value_encrypted, 'true'); assert.equal(byKey(a, 'autotake_mode').value_encrypted, 'auto');
  assert.deepEqual(a.ev.map((e) => e.event_type).sort(), ['config_change', 'config_change_rollback']);
  const p = JSON.parse(a.ev.find((e) => e.event_type === 'config_change_rollback').payload_json); assert.deepEqual([p.before, p.after], ['false', 'true']);
  const b = snap(f); assert.equal(run(f, '--mode', 'rollback', '--go', 'D-027').code, 3); assert.deepEqual(snap(f), b);
});
test('rollback without --go, and apply twice, are refused', () => {
  const f = fixture(); assert.equal(run(f, '--mode', 'apply', '--go', 'D-027').code, 0); const b = snap(f);
  assert.equal(run(f, '--mode', 'rollback').code, 2); assert.equal(run(f, '--mode', 'apply', '--go', 'D-027').code, 3); assert.deepEqual(snap(f), b);
});

test('static: script only ever QUERIES journal_mode; touches no other table/row; no secrets-ish strings; default DB is the mainnet console DB', () => {
  const s = readFileSync(SCRIPT, 'utf8');
  const code = s.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  assert.deepEqual(code.match(/\.pragma\([^)]*\)/g), [".pragma('journal_mode', { simple: true })"], 'the only pragma call is the read-only journal_mode query');
  assert.doesNotMatch(code, /\bpragma\s+\w/i, 'no SQL-text PRAGMA statement'); assert.match(code, /readonly: MODE === .read./, 'read mode opens the DB read-only'); assert.doesNotMatch(code, /wal_checkpoint|locking_mode|synchronous/i);
  assert.deepEqual([...new Set(code.match(/\bUPDATE\s+\w+\s+SET\b/g) || [])], ['UPDATE config_entries SET'], 'the only UPDATE statement targets config_entries');
  assert.equal((code.match(/\bUPDATE\s+config_entries\s+SET value_encrypted = \?, updated_at = \? WHERE key = \? AND value_encrypted = \? AND is_sensitive = 0/g) || []).length, 1, 'the UPDATE has exactly the documented shape');
  assert.deepEqual([...new Set(code.match(/INSERT INTO\s+\w+/g) || [])], ['INSERT INTO events']);
  assert.doesNotMatch(s, /DELETE\s+FROM|DROP\s|ALTER\s|value_plain_hint\s*=|is_sensitive\s*=\s*1|private|mnemonic|secret/i);
  assert.match(s, /kasia-console['"], 'data', 'console\.mainnet\.db'/); assert.ok(existsSync(SCRIPT));
});
