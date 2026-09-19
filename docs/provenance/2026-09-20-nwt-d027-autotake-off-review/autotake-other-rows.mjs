// NWT: on a real-schema (freshly migrated) temp DB, apply the tool and compare EVERY other config_entries row cell-by-cell before/after; and every other table's row count.
import { createRequire } from 'node:module'; import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
const ROOT = 'D:/kanet-nwt-cand', CON = path.join(ROOT, 'kasia-console'); const Database = createRequire(path.join(CON, 'package.json'))('better-sqlite3');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nwt-autotake2-')); const TDB = path.join(TMP, 'fresh.db');
spawnSync(process.execPath, ['scripts/run-migrations.mjs'], { cwd: CON, env: { ...process.env, DB_PATH: TDB, CONSOLE_ENCRYPTION_KEY: '0'.repeat(64) } });
const snap = () => { const d = new Database(TDB, { readonly: true }); const rows = d.prepare("SELECT * FROM config_entries WHERE key != 'autotake_enabled' ORDER BY id").all(); const target = d.prepare("SELECT * FROM config_entries WHERE key = 'autotake_enabled'").get();
  const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name); const counts = {}; for (const t of tables) counts[t] = d.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c; d.close(); return { rows, target, counts }; };
const before = snap();
const r = spawnSync(process.execPath, [path.join(ROOT, 'docs/provenance/2026-09-20-d027-autotake-off/autotake-off-exec.mjs'), '--db', TDB, '--root', ROOT, '--mode', 'apply', '--go', 'D-027'], { encoding: 'utf8' });
const after = snap();
console.log('tool exit=' + r.status);
console.log('other config_entries rows: before=' + before.rows.length + ' after=' + after.rows.length + ' cell-by-cell identical=' + (JSON.stringify(before.rows) === JSON.stringify(after.rows)) + '  sha256(before)=' + crypto.createHash('sha256').update(JSON.stringify(before.rows)).digest('hex').slice(0, 12) + ' sha256(after)=' + crypto.createHash('sha256').update(JSON.stringify(after.rows)).digest('hex').slice(0, 12));
const changedCols = Object.keys(before.target).filter((k) => before.target[k] !== after.target[k]);
console.log('target row: columns that changed = ' + JSON.stringify(changedCols) + '  (value_encrypted ' + before.target.value_encrypted + ' -> ' + after.target.value_encrypted + ')');
const diffTables = Object.keys(after.counts).filter((t) => after.counts[t] !== before.counts[t]);
console.log('tables whose row count changed = ' + JSON.stringify(diffTables.map((t) => `${t}: ${before.counts[t]} -> ${after.counts[t]}`)));
fs.rmSync(TMP, { recursive: true, force: true });
