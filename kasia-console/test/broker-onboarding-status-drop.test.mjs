/**
 * broker_onboarding.status DROP (v194) regression
 *
 * 设计: docs/2026-07-29-broker-onboarding-status-vestigial-drop-design.md
 * 批准: Bettor 2026-07-29 (四面独立核: 逻辑依赖/响应面/历史数据三路一致/DROP可行性) · NWT GREEN
 * Run: node --test test/broker-onboarding-status-drop.test.mjs
 *
 * 验收 (对应 Bettor 三条 live 验收的 offline 版 + 我 grep 抓到的 §5 漏改 INSERT):
 *   ① DROP 后 status 列实际不在 (PRAGMA)                     — Bettor 验收①
 *   ② 反向 SELECT status 抛 no such column (fail-loud)        — Bettor 验收②(改动的全部目的)
 *   ③ onboard INSERT (新 6 列无 status) 成功                  — 守住我 §5 漏改 INSERT 的洞(Bettor 验收③"没搞坏别的")
 *   ④ approvedBrokers 式查询 fork 逻辑不依赖 status           — Bettor 验收③ fork 正常
 *   ⑤ 前置断言: 有非 pending 行时 throw, 不静默 DROP 掉数据   — NWT 加固的前置断言
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// v173 建表 (含 status) —— 复现 DROP 前的真实 schema (migrate.js v173 逐字)
function v173Schema(db) {
  db.exec(`
    CREATE TABLE broker_onboarding (
      id                  TEXT PRIMARY KEY,
      broker_address      TEXT NOT NULL UNIQUE,
      bot_token_encrypted TEXT,
      bot_username        TEXT,
      status              TEXT NOT NULL DEFAULT 'pending',
      note                TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    )
  `);
}

// v194 DROP 逻辑 (复现 migrate.js v194: 前置断言 + DROP, 含 NWT 加固的 OR IS NULL)
function v194Drop(db) {
  const cols = db.prepare('PRAGMA table_info(broker_onboarding)').all();
  if (cols.some((c) => c.name === 'status')) {
    const bad = db
      .prepare("SELECT COUNT(*) AS n FROM broker_onboarding WHERE status != 'pending' OR status IS NULL")
      .get().n;
    if (bad > 0) throw new Error(`[v194] ${bad} 行 status 非 'pending' ⇒ 停止 DROP`);
    db.exec('ALTER TABLE broker_onboarding DROP COLUMN status');
  }
}

describe('broker_onboarding.status DROP (v194)', () => {
  it('① DROP 后 status 列实际不在 (PRAGMA)', () => {
    const db = new Database(':memory:');
    v173Schema(db);
    v194Drop(db);
    const cols = db.prepare('PRAGMA table_info(broker_onboarding)').all().map((c) => c.name);
    assert.ok(!cols.includes('status'), 'status 列应已被 DROP');
    assert.ok(cols.includes('broker_address') && cols.includes('bot_token_encrypted'), '其他列应保留');
    db.close();
  });

  it('② 反向 SELECT status 抛 no such column (fail-loud = 陷阱结构性关闭)', () => {
    const db = new Database(':memory:');
    v173Schema(db);
    v194Drop(db);
    assert.throws(
      () => db.prepare('SELECT status FROM broker_onboarding').all(),
      /no such column/i,
      '任何 b.status gate 应当场 SQL 报错, 而非静默返回空集'
    );
    db.close();
  });

  it('③ onboard INSERT (新 6 列无 status) 成功 —— 守住 §5 漏改 INSERT 的洞', () => {
    const db = new Database(':memory:');
    v173Schema(db);
    v194Drop(db);
    // kanet-broker.js:85 改后的 INSERT: 6 列, 无 status
    assert.doesNotThrow(() => {
      db.prepare(
        `INSERT INTO broker_onboarding (id, broker_address, bot_token_encrypted, bot_username, created_at, updated_at)
         VALUES (?,?,?,?,?,?)`
      ).run('id1', 'kaspatest:qtest', 'enc', '@bot', 't', 't');
    });
    const row = db.prepare('SELECT broker_address, bot_token_encrypted FROM broker_onboarding WHERE id=?').get('id1');
    assert.equal(row.broker_address, 'kaspatest:qtest');
    db.close();
  });

  it('④ approvedBrokers 式查询 (fork 逻辑) 不依赖 status', () => {
    const db = new Database(':memory:');
    v173Schema(db);
    v194Drop(db);
    const ins = db.prepare(
      `INSERT INTO broker_onboarding (id, broker_address, bot_token_encrypted, bot_username, created_at, updated_at)
       VALUES (?,?,?,?,?,?)`
    );
    ins.run('id1', 'addr1', 'enc-token', '@bot', 't', 't'); // 有 token ⇒ 可 fork
    ins.run('id2', 'addr2', null, null, 't', 't'); //          无 token ⇒ 不 fork
    const forkable = db.prepare('SELECT broker_address FROM broker_onboarding WHERE bot_token_encrypted IS NOT NULL').all();
    assert.equal(forkable.length, 1, '只有带 token 的 broker 可 fork');
    assert.equal(forkable[0].broker_address, 'addr1');
    db.close();
  });

  it('⑤ 前置断言: 有非 pending 行时 throw, 不静默 DROP 掉数据', () => {
    const db = new Database(':memory:');
    v173Schema(db);
    db.prepare(
      `INSERT INTO broker_onboarding (id, broker_address, status, created_at, updated_at) VALUES (?,?,?,?,?)`
    ).run('id1', 'addr1', 'approved', 't', 't');
    assert.throws(() => v194Drop(db), /停止 DROP/, '有非 pending 行应 throw, 不 DROP');
    const cols = db.prepare('PRAGMA table_info(broker_onboarding)').all().map((c) => c.name);
    assert.ok(cols.includes('status'), 'throw 后 status 列应仍在 (未 DROP)');
    db.close();
  });
});
