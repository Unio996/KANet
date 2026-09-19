// NWT: a LONG-LIVED connection (as the console's shared better-sqlite3 handle) must see the tool's COMMIT on its next getConfig-style read, with no reopen.
import { createRequire } from 'node:module'; import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'D:/kanet-nwt-cand', CON = path.join(ROOT, 'kasia-console'); const Database = createRequire(path.join(CON, 'package.json'))('better-sqlite3');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nwt-autotake3-')); const TDB = path.join(TMP, 'fresh.db');
spawnSync(process.execPath, ['scripts/run-migrations.mjs'], { cwd: CON, env: { ...process.env, DB_PATH: TDB, CONSOLE_ENCRYPTION_KEY: '0'.repeat(64) } });
const console_ = new Database(TDB); console_.pragma('journal_mode = WAL');                     // the "console": one long-lived read/write handle, WAL
const getConfig = (k) => { const r = console_.prepare('SELECT * FROM config_entries WHERE key = ?').get(k); return r ? r.value_encrypted : null; };   // literally getConfig()'s query
console.log('long-lived handle, before : autotake_enabled = ' + getConfig('autotake_enabled'));
console_.prepare("SELECT COUNT(*) FROM events").get();                                          // some unrelated activity on the same handle
const r = spawnSync(process.execPath, [path.join(ROOT, 'docs/provenance/2026-09-20-d027-autotake-off/autotake-off-exec.mjs'), '--db', TDB, '--root', ROOT, '--mode', 'apply', '--go', 'D-027'], { encoding: 'utf8' });
console.log('tool exit=' + r.status);
console.log('long-lived handle, after  : autotake_enabled = ' + getConfig('autotake_enabled') + '   (same handle, no reopen, no restart)');
// what the runtime-gate expression evaluates to:
console.log('gate  enabled !== "true" => return  : ' + (getConfig('autotake_enabled') !== 'true'));
console_.close(); fs.rmSync(TMP, { recursive: true, force: true });
