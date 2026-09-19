// NWT 核 D-027 ① runbook: (1) 真实迁移建临时库(真实 schema + 真实 v88 种子), 与活库(只读)逐列对比 events / config_entries / 触发器;
// (2) 在真实 schema 上跑工具 read -> apply -> apply(应 3) -> rollback -> rollback(应 3); (3) 并发: 另一进程持写锁。全程只写临时库, 活库只读打开。
import { createRequire } from 'node:module'; import { spawnSync, spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const ROOT = 'D:/kanet-nwt-cand', CON = path.join(ROOT, 'kasia-console');
const req = createRequire(path.join(CON, 'package.json')); const Database = req('better-sqlite3');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nwt-autotake-')); const TDB = path.join(TMP, 'fresh.db');
const LIVE = 'D:/kanet-tn12/kasia-console/data/console.mainnet.db';
const TOOL = path.join(ROOT, 'docs/provenance/2026-09-20-d027-autotake-off/autotake-off-exec.mjs');
// 1. real migrations into a temp DB
const mig = spawnSync(process.execPath, ['scripts/run-migrations.mjs'], { cwd: CON, env: { ...process.env, DB_PATH: TDB, CONSOLE_ENCRYPTION_KEY: '0'.repeat(64) }, encoding: 'utf8' });
console.log('migrations exit=' + mig.status + '  (fresh DB migrated with the repo\'s real migrations)');
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => `${c.name}:${c.type}:nn=${c.notnull}:dflt=${c.dflt_value}:pk=${c.pk}`);
const trig = (db) => db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' ORDER BY name").all().map((t) => `${t.name}@${t.tbl_name}`);
const fresh = new Database(TDB, { readonly: true }); const live = new Database(LIVE, { readonly: true, fileMustExist: true });
for (const t of ['config_entries', 'events']) {
  const a = cols(fresh, t), b = cols(live, t);
  console.log(`table ${t}: fresh-migrated ${a.length} cols, live ${b.length} cols, identical=${JSON.stringify(a) === JSON.stringify(b)}`);
  if (JSON.stringify(a) !== JSON.stringify(b)) { console.log('   only-in-fresh:', a.filter((x) => !b.includes(x)).join(' | ') || '-'); console.log('   only-in-live :', b.filter((x) => !a.includes(x)).join(' | ') || '-'); }
}
const fT = trig(fresh), lT = trig(live);
console.log(`triggers: fresh=${fT.length} live=${lT.length} on config_entries/events in live: ${lT.filter((x) => /@(config_entries|events)$/.test(x)).length}`);
const ck = (db) => db.prepare("SELECT sql FROM sqlite_master WHERE name IN ('events','config_entries')").all().map((r) => (r.sql.match(/CHECK\s*\([^)]*\)/gi) || []).length);
console.log('CHECK constraints in DDL (events, config_entries) fresh=' + JSON.stringify(ck(fresh)) + ' live=' + JSON.stringify(ck(live)));
const seeded = fresh.prepare("SELECT key, value_encrypted, is_sensitive FROM config_entries WHERE key LIKE 'autotake_%' ORDER BY key").all();
console.log('fresh-migrated seed rows: ' + JSON.stringify(seeded));
console.log('fresh journal_mode = ' + fresh.pragma('journal_mode', { simple: true }));
fresh.close(); live.close();
// 2. tool on the fresh (real-schema) DB
const T = (...a) => { const r = spawnSync(process.execPath, [TOOL, '--db', TDB, '--root', ROOT, ...a], { encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '').trim() }; };
const short = (s) => s.split('\n').map((l) => l.length > 150 ? l.slice(0, 150) + '…' : l).join('\n      ');
let r = T('--mode', 'read'); console.log('\nread          exit=' + r.code + '\n      ' + short(r.out));
r = T('--mode', 'apply'); console.log('apply(no go)  exit=' + r.code + ' ' + r.out.slice(0, 90));
r = T('--mode', 'apply', '--go', 'D-027'); console.log('apply         exit=' + r.code + '\n      ' + short(r.out));
r = T('--mode', 'apply', '--go', 'D-027'); console.log('apply again   exit=' + r.code + ' ' + r.out.slice(0, 110));
const chk = new Database(TDB, { readonly: true });
console.log('mode row after apply: ' + JSON.stringify(chk.prepare("SELECT value_encrypted, updated_at, category FROM config_entries WHERE key='autotake_mode'").get()));
console.log('events rows: ' + JSON.stringify(chk.prepare("SELECT event_scope, event_type, source, level FROM events WHERE source='kanetui-d027-runbook'").all()));
console.log('rows changed other than the target (count of config_entries rows updated after seed): ' + chk.prepare("SELECT COUNT(*) c FROM config_entries WHERE key != 'autotake_enabled' AND updated_at LIKE '%T%'").get().c);
chk.close();
r = T('--mode', 'rollback', '--go', 'D-027'); console.log('rollback      exit=' + r.code + ' ' + r.out.split('\n')[0]);
r = T('--mode', 'rollback', '--go', 'D-027'); console.log('rollback again exit=' + r.code + ' ' + r.out.slice(0, 110));
// 3. concurrency: another process holds a write transaction
const holder = (ms) => spawn(process.execPath, ['-e', `const D=require(${JSON.stringify(path.join(CON, 'node_modules', 'better-sqlite3'))});const d=new D(${JSON.stringify(TDB)});d.exec('BEGIN IMMEDIATE');console.log('held');setTimeout(()=>{d.exec('ROLLBACK');d.close();},${ms});`], { stdio: ['ignore', 'pipe', 'inherit'] });
const wait = (p) => new Promise((res) => p.stdout.once('data', () => res()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// (a) hold 2.5 s, tool timeout 10 s => should wait then succeed
let h = holder(2500); await wait(h); let t0 = Date.now(); r = T('--mode', 'apply', '--go', 'D-027'); console.log(`\nconcurrent writer held 2.5 s, tool timeout 10 s: exit=${r.code} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s ${r.out.split('\n')[0].slice(0, 80)}`);
await sleep(300);
r = T('--mode', 'rollback', '--go', 'D-027');
// (b) hold 6 s, tool timeout 1.5 s => busy, nothing written
h = holder(6000); await wait(h); t0 = Date.now(); r = T('--mode', 'apply', '--go', 'D-027', '--timeout-ms', '1500'); console.log(`concurrent writer held 6 s, tool timeout 1.5 s : exit=${r.code} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s ${r.out.slice(0, 130)}`);
await sleep(6500);
const chk2 = new Database(TDB, { readonly: true });
console.log('after busy attempt: autotake_enabled=' + chk2.prepare("SELECT value_encrypted v FROM config_entries WHERE key='autotake_enabled'").get().v + ', events with config_change (apply) = ' + chk2.prepare("SELECT COUNT(*) c FROM events WHERE event_type='config_change'").get().c + ' (the earlier successful apply + the concurrent (a) apply)');
chk2.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log('\ntemp dir removed: ' + !fs.existsSync(TMP));
