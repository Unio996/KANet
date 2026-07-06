// zk-prove-job-recover.mjs — 手动解锁卡住的 zk_prove_jobs 行(v1 已知限制的恢复路径)
//
// 背景: docs/2026-07-06-zk-close-tick-production-wiring-design.md §2.4。
// zk_prove_jobs 的 partial unique index(status IN pending/in_progress)防止同一 market 重复入队,
// 副作用是若 job 因 J1 机器崩溃/网络断而永久卡在 in_progress, 没有自动恢复路径, 必须手动介入。
//
// 用法:
//   node scripts/zk-prove-job-recover.mjs --list                 # 列出所有非 terminal(pending/in_progress) job + 卡了多久
//   node scripts/zk-prove-job-recover.mjs --unstick <jobId>       # 把指定 job 标成 failed, 解锁该 market 重新入队
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.KANET_CONSOLE_DB || join(__dirname, '..', 'data', 'console.db');
const db = new Database(dbPath);

const args = process.argv.slice(2);

if (args.includes('--list')) {
  const rows = db.prepare(`
    SELECT id, market_id, status, created_at, updated_at,
           CAST((julianday('now') - julianday(updated_at)) * 24 * 60 AS INTEGER) AS minutes_since_update
    FROM zk_prove_jobs
    WHERE status IN ('pending', 'in_progress')
    ORDER BY updated_at ASC
  `).all();
  if (rows.length === 0) {
    console.log('No non-terminal zk_prove_jobs (nothing stuck).');
  } else {
    console.log(`${rows.length} non-terminal job(s):`);
    for (const r of rows) {
      console.log(`  id=${r.id} market=${r.market_id} status=${r.status} stuck_for=${r.minutes_since_update}min (updated_at=${r.updated_at})`);
    }
  }
} else if (args.includes('--unstick')) {
  const idIdx = args.indexOf('--unstick') + 1;
  const jobId = Number(args[idIdx]);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    console.error('Usage: --unstick <jobId> (positive integer)');
    process.exit(1);
  }
  const row = db.prepare('SELECT id, market_id, status FROM zk_prove_jobs WHERE id = ?').get(jobId);
  if (!row) {
    console.error(`No job with id=${jobId}`);
    process.exit(1);
  }
  if (row.status === 'done' || row.status === 'failed') {
    console.log(`Job ${jobId} is already terminal (status=${row.status}), nothing to do.`);
  } else {
    db.prepare("UPDATE zk_prove_jobs SET status = 'failed', error = 'manually unstuck via zk-prove-job-recover.mjs', updated_at = datetime('now') WHERE id = ?").run(jobId);
    console.log(`Job ${jobId} (market=${row.market_id}) marked failed. Market can now be re-enqueued on next zkCloseTick.`);
  }
} else {
  console.log('Usage: node scripts/zk-prove-job-recover.mjs --list | --unstick <jobId>');
}

db.close();
