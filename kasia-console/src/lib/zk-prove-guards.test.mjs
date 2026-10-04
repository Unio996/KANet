// zk-prove-guards.test.mjs — 账本1832 段4(ledger 1835 主网阻断项): zk-prove-worker 的内存门 / 自动重试 / host 预编译 防线单测。
// Run: cd kasia-console && node src/lib/zk-prove-guards.test.mjs
import { join } from 'node:path';
process.env.DB_PATH ||= join(process.env.TEMP || '/tmp', `zk-prove-guards-${process.pid}.db`);
process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64);
process.env.KASPA_NETWORK ||= 'simnet';
process.env.ZK_PROVE_MAX_ATTEMPTS = '3'; process.env.ZK_PROVE_BACKOFF_BASE_SEC = '120';
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const g = await import('./zk-prove-guards.mjs');

console.log('[test] ① 内存门');
ok(g.parseMemAvailableMb('MemTotal: 16373432 kB\nMemAvailable:    8539764 kB\n') === 8339, 'parse MemAvailable kB→MB(向下取整)');
ok(g.parseMemAvailableMb('garbage') === null && g.parseMemAvailableMb('') === null && g.parseMemAvailableMb(null) === null, '解析不了 ⇒ null');
ok(g.memGateDecision({ availMb: 8339, minMb: 6144 }).ok === true, '8339MB >= 6144MB ⇒ 放行');
const low = g.memGateDecision({ availMb: 1090, minMb: 6144 });
ok(low.ok === false && /推迟/.test(low.reason), `1090MB(simnet 实测被杀时的读数)< 6144MB ⇒ 推迟(not fail)`);
ok(g.memGateDecision({ availMb: null, minMb: 6144 }).ok === false, '读不到内存 ⇒ 不放行(fail-closed)');
ok(g.memGateDecision({ availMb: null, gate: 'off' }).ok === true, '显式 off ⇒ 放行(仅调试)');
ok(g.memGateDecision({ availMb: 6144, minMb: 6144 }).ok === true && g.memGateDecision({ availMb: 6143, minMb: 6144 }).ok === false, '阈值边界: ==阈值放行, 少 1MB 推迟');

console.log('[test] ② 重试/退避决策');
ok(g.backoffSeconds(1, 120) === 120 && g.backoffSeconds(2, 120) === 240 && g.backoffSeconds(3, 120) === 480, '退避 120→240→480s(指数)');
ok(g.backoffSeconds(20, 120) === 1800, '退避封顶 1800s');
ok(g.retryDecision({ attempts: 1, maxAttempts: 3 }).action === 'retry' && g.retryDecision({ attempts: 2, maxAttempts: 3 }).action === 'retry', '第 1、2 次失败 ⇒ retry');
ok(g.retryDecision({ attempts: 3, maxAttempts: 3 }).action === 'fail', '第 3 次失败(达上限)⇒ fail');

console.log('[test] ③ host 预编译状态');
ok(g.hostBinaryStatus({ binExists: false }).status === 'missing', '二进制缺失 ⇒ missing(拒绝, 不 cargo run)');
ok(g.hostBinaryStatus({ binExists: true, binMtimeMs: 1000, newestSrcMtimeMs: 2000 }).status === 'stale', '源码比二进制新 ⇒ stale');
ok(g.hostBinaryStatus({ binExists: true, binMtimeMs: 2000, newestSrcMtimeMs: 1000 }).ok === true, '二进制不旧于源码 ⇒ ok');
const fakeFs = { statSync: (p) => ({ isDirectory: () => !/\.rs$|\.toml$/.test(p), mtimeMs: /new\.rs$/.test(p) ? 5000 : 100 }), readdirSync: (p) => (p === '/src' ? ['old.rs', 'new.rs', 'target', 'sub'] : p === '/src/sub' ? ['x.rs'] : []) };
ok(g.newestMtimeMs(['/src'], fakeFs) === 5000, 'newestMtimeMs 取最新文件 mtime, 跳过 target');

console.log('[test] ④ worker 的 _retryOrFail(真 DB: 临时库 + 迁移)');
const { runMigrations } = await import('../db/migrate.js');
runMigrations();
const { sqlite: db } = await import('../db/client.js');
const cols = db.prepare('PRAGMA table_info(zk_prove_jobs)').all().map((c) => c.name);
ok(cols.includes('attempts') && cols.includes('next_attempt_at'), 'v220 迁移: zk_prove_jobs 有 attempts/next_attempt_at 列');
const w = await import('../services/zk-prove-worker.mjs');
const mkJob = (mid) => { const r = db.prepare("INSERT INTO zk_prove_jobs (market_id, status, ordered_bets_json, bets_root_hex, attested_winner, created_at, updated_at) VALUES (?, 'in_progress', '[]', ?, 0, datetime('now'), datetime('now'))").run(mid, 'aa'.repeat(32)); return db.prepare('SELECT * FROM zk_prove_jobs WHERE id = ?').get(r.lastInsertRowid); };
db.prepare("CREATE TABLE IF NOT EXISTS pool_markets_stub (id TEXT)").run();
let job = mkJob('m-retry-1');
ok(w._retryOrFail(job, 'RISC0 proving fail: cargo run exited 9') === 'retry', '第 1 次失败 ⇒ retry');
let row = db.prepare('SELECT * FROM zk_prove_jobs WHERE id = ?').get(job.id);
ok(row.status === 'pending' && row.attempts === 1 && /\[retry 1\/3\]/.test(row.error) && row.next_attempt_at != null, `回 pending, attempts=1, next_attempt_at 已设(${row.next_attempt_at})`);
const dueNow = db.prepare("SELECT 1 FROM zk_prove_jobs WHERE id = ? AND status = 'pending' AND (next_attempt_at IS NULL OR julianday(next_attempt_at) <= julianday('now'))").get(job.id);
ok(!dueNow, '退避期内 tick 的到点过滤不会选中它');
db.prepare("UPDATE zk_prove_jobs SET next_attempt_at = datetime('now', '-1 seconds') WHERE id = ?").run(job.id);
ok(!!db.prepare("SELECT 1 FROM zk_prove_jobs WHERE id = ? AND status = 'pending' AND (next_attempt_at IS NULL OR julianday(next_attempt_at) <= julianday('now'))").get(job.id), '退避到点后重新可选');
job = db.prepare('SELECT * FROM zk_prove_jobs WHERE id = ?').get(job.id); db.prepare("UPDATE zk_prove_jobs SET status='in_progress' WHERE id=?").run(job.id);
ok(w._retryOrFail({ ...job, status: 'in_progress' }, 'again') === 'retry', '第 2 次失败 ⇒ retry');
job = db.prepare('SELECT * FROM zk_prove_jobs WHERE id = ?').get(job.id); db.prepare("UPDATE zk_prove_jobs SET status='in_progress' WHERE id=?").run(job.id);
const last = w._retryOrFail({ ...job, status: 'in_progress' }, 'third');
row = db.prepare('SELECT * FROM zk_prove_jobs WHERE id = ?').get(job.id);
ok(last === 'failed' && row.status === 'failed' && row.attempts === 3 && /已尝试 3\/3/.test(row.error), `第 3 次失败 ⇒ failed(attempts=3, error 含「已尝试 3/3」)`);
const evs = db.prepare("SELECT event_type FROM events WHERE event_type IN ('zk_prove_worker_retry','zk_prove_worker_fail')").all().map((e) => e.event_type);
ok(evs.filter((e) => e === 'zk_prove_worker_retry').length === 2 && evs.includes('zk_prove_worker_fail'), `事件留痕: 2 条 retry + 1 条 fail (got ${evs.join(',')})`);
console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
