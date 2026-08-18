// ③-1..③-7 验收(预注册于设计报告 §8, 事后不加项)
// 🔴 安全闸(照 u1-registration.test.mjs 的写法): import 前把 DB_PATH 指到临时库, 并断言它真是临时库。
//    上一版脚本没设 DB_PATH ⇒ client.js 落到【真 console.db】⇒ 迁移被跑到了 live 库上(幂等无损, 但不该做)。
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
const dir = mkdtempSync(join(tmpdir(), 'v197-accept-'));
process.env.DB_PATH = join(dir, 'probe.db');
const { runMigrations } = await import('../db/migrate.js');
const { sqlite, dbPath } = await import('../db/client.js');
const { createChallengeStore } = await import('./u1-challenge-store.mjs');
assert.ok(dbPath.startsWith(dir), `安全闸: 必须临时库, 实际 ${dbPath}`);
runMigrations();

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('[PASS] ' + n); pass++; } catch (e) { console.log('[FAIL] ' + n + ' :: ' + e.message); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m || 'assert'); };
const MIG = new URL('../db/migrate.js', import.meta.url);
const TST = new URL('./u1-registration.test.mjs', import.meta.url);
const liveSql = () => sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='u1_identity_challenge'").get()?.sql;
const consume = (c) => sqlite.prepare('UPDATE u1_identity_challenge SET used_at=? WHERE challenge=? AND used_at IS NULL').run(Date.now(), c).changes;
const issue = (c) => sqlite.prepare('INSERT OR REPLACE INTO u1_identity_challenge VALUES (?,NULL,?)').run(c, Date.now() + 60000);

t('③-1 幂等: 再跑一次 migrate 不抛, 表结构逐字不变', () => {
  const before = liveSql(); A(before, '表不存在');
  runMigrations();
  A(liveSql() === before, '第二次迁移后结构变了');
});
t('③-2 用的就是生产迁移(非副本) + expires_at 已收紧', () => {
  const live = liveSql();
  A(/challenge\s+TEXT\s+PRIMARY KEY/.test(live), 'challenge 不是 PK');
  A(/expires_at\s+INTEGER NOT NULL/.test(live), 'expires_at 未 NOT NULL');
  A(readFileSync(MIG, 'utf8').includes('CREATE TABLE IF NOT EXISTS u1_identity_challenge'), 'migrate.js 无该 DDL');
});
t('③-3 CAS 真成立: 并发消费同一 challenge 恰好一个 changes===1', () => {
  issue('c1'); const a = consume('c1'), b = consume('c1');
  A(a + b === 1, `两次消费结果 ${a}/${b}`);
});
t('③-4 🔵 部分索引【不是闸】的正向证明: 删掉它后 CAS 仍全绿', () => {
  A(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_u1_challenge_unused'").get(), '索引本应存在');
  sqlite.exec('DROP INDEX idx_u1_challenge_unused');
  issue('c2'); const a = consume('c2'), b = consume('c2');
  A(a + b === 1, '删索引后 CAS 变了 ⇒ 它其实参与正确性, §3 那句"仅巡检"就是错的');
  runMigrations();
});
t('③-5 expires_at NOT NULL 生效: 缺该列必抛', () => {
  let threw = false;
  try { sqlite.prepare('INSERT INTO u1_identity_challenge (challenge, used_at) VALUES (?,NULL)').run('c3'); } catch { threw = true; }
  A(threw, '缺 expires_at 竟写进去了');
});
t('③-6 夹具不含 DDL 字面量且走真迁移(负面+正面 grep)', () => {
  const s = readFileSync(TST, 'utf8');
  A(!/CREATE TABLE IF NOT EXISTS u1_identity_challenge/.test(s), '夹具仍自带 DDL');
  A(!/productionDdl/.test(s), '仍留着正则抽取那套弱机制');
  A(/runMigrations\(\)/.test(s), '夹具没走真迁移');
});
t('③-7 表不存在时工厂必须拒(fail-closed 现状保留)', () => {
  // 🔵 不另开 better-sqlite3 裸 import —— 那要新增 M0a 例外 = 扩大受审面。
  //    用【同一个 handle + 一个不存在的表名】走的是工厂里完全相同的那条存在性校验。
  let threw = false;
  try { createChallengeStore(sqlite, 'u1_identity_challenge_absent'); } catch { threw = true; }
  A(threw, '表不存在时工厂竟造出了 store');
});
console.log(`\n③ 验收: ${pass} PASS / ${fail} FAIL   (临时库 ${dbPath})`);
