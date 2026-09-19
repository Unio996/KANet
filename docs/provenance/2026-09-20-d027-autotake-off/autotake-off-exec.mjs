// autotake-off-exec.mjs -- D-027 ①: set mainnet config_entries.autotake_enabled from 'true' to 'false' (and back, for rollback).
// One-off tool, lives in scratch/ at execution time (NOT landed in the repo); its sha256 is recorded in the runbook + provenance.
//   node scratch\autotake-off-exec.mjs --mode read                       (default; read-only; prints the rows + facts; never writes)
//   node scratch\autotake-off-exec.mjs --mode apply    --go D-027        (ONE transaction: precondition check -> UPDATE (changes must be exactly 1) -> event INSERT -> COMMIT)
//   node scratch\autotake-off-exec.mjs --mode rollback --go D-027        (the inverse: 'false' -> 'true', with its own event)
//   options: --db <path> (default: the mainnet console DB)  --timeout-ms <n> (default 10000: how long to wait for SQLite's write lock)
// Exit codes: 0 done / read ok;  2 usage or environment error;  3 precondition not met (row missing / sensitive / value not the expected one) -- NOTHING written;
//             4 UPDATE changed a number of rows other than 1 -- rolled back, NOTHING written;  5 any other error (busy timeout, event insert failed, ...) -- rolled back.
// It never touches autotake_mode, category, value_plain_hint, is_sensitive, created_at, or any other row. It never issues PRAGMA journal_mode = ... (WAL is left as the console set it).
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MODE = opt('--mode', 'read');
const GO = opt('--go', '');
const TIMEOUT_MS = Number(opt('--timeout-ms', '10000'));
const REPO = path.resolve(opt('--root', 'D:/kanet-tn12'));
const DB = path.resolve(opt('--db', path.join(REPO, 'kasia-console', 'data', 'console.mainnet.db')));
const KEY = 'autotake_enabled', MODE_KEY = 'autotake_mode';
const die = (code, msg) => { console.log(msg); process.exit(code); };

if (!['read', 'apply', 'rollback'].includes(MODE)) die(2, `usage: --mode read|apply|rollback (got ${MODE})`);
if (MODE !== 'read' && GO !== 'D-027') die(2, `refusing to write: pass --go D-027 (this runbook's Bettor-GO token) to ${MODE}`);
if (!Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS < 100) die(2, 'bad --timeout-ms');
let Database;
try { Database = createRequire(path.join(REPO, 'kasia-console', 'package.json'))('better-sqlite3'); } catch (e) { die(2, `cannot load better-sqlite3 from ${REPO}: ${e.message}`); }

let db;
try { db = new Database(DB, { fileMustExist: true, readonly: MODE === 'read', timeout: TIMEOUT_MS }); } catch (e) { die(2, `cannot open ${DB}: ${e.message}`); }
const jm = String(db.pragma('journal_mode', { simple: true })).toLowerCase();   // query form only: reports the mode, changes nothing
const row = (k) => db.prepare('SELECT key, category, is_sensitive, value_encrypted, value_plain_hint, created_at, updated_at FROM config_entries WHERE key = ?').get(k);
const show = (label, r) => console.log(`${label} ${r ? JSON.stringify(r) : '(row absent)'}`);

if (MODE === 'read') {
  console.log(`db=${path.basename(DB)} journal_mode=${jm}`);
  const a = row(KEY), m = row(MODE_KEY);
  show('READ', a); show('READ', m);
  const ev = db.prepare("SELECT id, event_type, level, summary, created_at FROM events WHERE source = 'kanetui-d027-runbook' ORDER BY created_at").all();
  console.log(`EVENTS ${ev.length}`); for (const e of ev) console.log(`EVENT ${JSON.stringify(e)}`);
  db.close(); process.exit(0);
}

// ---- write modes: the transition table
const FROM = MODE === 'apply' ? 'true' : 'false';
const TO = MODE === 'apply' ? 'false' : 'true';
const EVENT_TYPE = MODE === 'apply' ? 'config_change' : 'config_change_rollback';
if (jm !== 'wal') { db.close(); die(2, `journal_mode is '${jm}', expected 'wal' (the console's setting); refusing to write`); }

let stage = 'begin';
try {
  db.exec('BEGIN IMMEDIATE');   // take the write lock up front: wait up to --timeout-ms, or fail with SQLITE_BUSY (nothing written)
  stage = 'precondition';
  const before = row(KEY), modeBefore = row(MODE_KEY);
  if (!before) { db.exec('ROLLBACK'); die(3, `PRECONDITION FAILED: ${KEY} row absent`); }
  if (before.is_sensitive !== 0) { db.exec('ROLLBACK'); die(3, `PRECONDITION FAILED: ${KEY} is flagged sensitive; this tool only handles is_sensitive=0`); }
  if (before.value_encrypted !== FROM) { db.exec('ROLLBACK'); die(3, `PRECONDITION FAILED: ${KEY} is '${before.value_encrypted}', expected '${FROM}' for ${MODE}`); }
  const now = new Date().toISOString();
  stage = 'update';
  const r = db.prepare(`UPDATE config_entries SET value_encrypted = ?, updated_at = ? WHERE key = ? AND value_encrypted = ? AND is_sensitive = 0`).run(TO, now, KEY, FROM);
  if (r.changes !== 1) { db.exec('ROLLBACK'); die(4, `UPDATE changed ${r.changes} rows (must be exactly 1); rolled back, nothing written`); }
  stage = 'event';
  const summary = `config_entries.${KEY} ${FROM} -> ${TO} at ${now} (D-027${MODE === 'rollback' ? ' ROLLBACK' : ''}); ${MODE_KEY} untouched ('${modeBefore ? modeBefore.value_encrypted : 'absent'}')`;
  const payload = { decision: 'D-027', key: KEY, before: FROM, after: TO, previous_updated_at: before.updated_at, changed_at: now, mode_key: MODE_KEY, mode_value_untouched: modeBefore ? modeBefore.value_encrypted : null, executor: 'KANet-UI', tool: 'autotake-off-exec.mjs' };
  const e = db.prepare(`INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at) VALUES (?, 'system', ?, 'kanetui-d027-runbook', 'info', ?, ?, ?)`).run(randomUUID(), EVENT_TYPE, summary, JSON.stringify(payload), now);
  if (e.changes !== 1) { db.exec('ROLLBACK'); die(5, 'event insert did not insert exactly 1 row; rolled back'); }
  stage = 'commit';
  db.exec('COMMIT');
  console.log(`DONE ${MODE}: ${KEY} '${FROM}' -> '${TO}' committed at ${now}`);
} catch (err) {
  try { db.exec('ROLLBACK'); } catch { /* no transaction open */ }
  die(5, `ERROR at stage '${stage}': ${err.code || ''} ${err.message} -- rolled back, nothing written`);
}
// ---- post-read on a fresh statement (what any other connection will now see)
const a2 = row(KEY), m2 = row(MODE_KEY);
show('AFTER', a2); show('AFTER', m2);
db.close();
process.exit(a2 && a2.value_encrypted === TO ? 0 : 5);
