// smoke-handshake-fix.mjs — 验证 handshake guard + contacts API 过滤修复
// Bug: 2026-04-14 guard 用了 handshake_observed_at 导致 inbound 握手永不入队.
// 修: 改为 handshake_accepted_at.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../kasia-console/package.json'));
const Database = require('better-sqlite3');
const DB = path.join(__dirname, '../kasia-console/data/console.db');
const db = new Database(DB);

// 预清
db.prepare("DELETE FROM pending_actions WHERE local_address LIKE 'kaspa:qtest-hs-%' OR target_address LIKE 'kaspa:qtest-hs-%'").run();
db.prepare("DELETE FROM relation_states WHERE local_address LIKE 'kaspa:qtest-hs-%' OR peer_address LIKE 'kaspa:qtest-hs-%'").run();

process.on('exit', () => {
  try {
    db.prepare("DELETE FROM pending_actions WHERE local_address LIKE 'kaspa:qtest-hs-%' OR target_address LIKE 'kaspa:qtest-hs-%'").run();
    db.prepare("DELETE FROM relation_states WHERE local_address LIKE 'kaspa:qtest-hs-%' OR peer_address LIKE 'kaspa:qtest-hs-%'").run();
  } catch {}
});

const LOCAL = 'kaspa:qtest-hs-local';
const PEER = 'kaspa:qtest-hs-peer';

let pass = 0, fail = 0;
function test(name, fn) {
  try { const r = fn(); if (r) { console.log(`  [PASS] ${name}`); pass++; } else { console.log(`  [FAIL] ${name}`); fail++; } }
  catch (e) { console.log(`  [FAIL] ${name} THROW: ${e.message}`); fail++; }
}

const now = new Date().toISOString();
const { randomUUID } = await import('crypto');

console.log('=== handshake guard + contacts 过滤修复验证 ===\n');

// ─── Scenario 1: 新入站握手 (observed, 未 accept) — 核心场景 ───
{
  db.prepare("DELETE FROM relation_states WHERE local_address = ? AND peer_address = ?").run(LOCAL, PEER);
  // 模拟 observeHandshake 写入行 (state='observed', handshake_observed_at 填, handshake_accepted_at 为 null)
  db.prepare(`INSERT INTO relation_states (id, local_address, peer_address, first_seen_tx, handshake_observed_at, status, updated_at)
    VALUES (?, ?, ?, 'tx-handshake-01', ?, 'observed', ?)`).run(randomUUID(), LOCAL, PEER, now, now);

  // OLD guard (bug): handshake_observed_at IS NOT NULL → 立即命中, pending 永不入队
  const oldGuardHit = db.prepare(`
    SELECT 1 FROM relation_states WHERE local_address = ? AND peer_address = ?
      AND (handshake_observed_at IS NOT NULL OR status IN ('accepted','confirmed','active')) LIMIT 1
  `).get(LOCAL, PEER);
  test('1a. OLD guard 在 observed 首次就错误命中 (证明 bug)', () => !!oldGuardHit);

  // NEW guard (fix): handshake_accepted_at IS NOT NULL → 不命中, 允许入队
  const newGuardHit = db.prepare(`
    SELECT 1 FROM relation_states WHERE local_address = ? AND peer_address = ?
      AND (handshake_accepted_at IS NOT NULL OR status IN ('accepted','confirmed','active')) LIMIT 1
  `).get(LOCAL, PEER);
  test('1b. NEW guard 在 observed 首次不命中 (修复生效)', () => !newGuardHit);

  // 模拟 NEW guard 后的 pending_actions 入队
  if (!newGuardHit) {
    db.prepare(`INSERT OR IGNORE INTO pending_actions
      (id, action_type, direction, local_address, target_address, source, idempotent_key, status, trigger_txid, created_at, updated_at)
      VALUES (?, 'handshake_accept', 'inbound', ?, ?, 'smoke', ?, 'pending', 'tx-handshake-01', ?, ?)`)
      .run(randomUUID(), LOCAL, PEER, `handshake_accept:${LOCAL}:${PEER}`, now, now);
  }
  const pa = db.prepare("SELECT * FROM pending_actions WHERE local_address = ? AND target_address = ?").get(LOCAL, PEER);
  test('1c. pending_actions 已入队 handshake_accept + status=pending', () => pa && pa.action_type === 'handshake_accept' && pa.status === 'pending');
}

// ─── Scenario 2: 重复入站握手 (我方已 accept 过) ───
{
  // 模拟我方已 accept: 推进 status=accepted + 填 handshake_accepted_at
  db.prepare("UPDATE relation_states SET status='accepted', handshake_accepted_at=? WHERE local_address = ? AND peer_address = ?").run(now, LOCAL, PEER);
  // 对方又发一笔握手来 (可能是 retry 或 ACK) → NEW guard 应命中, 不再入队
  const guardHit = db.prepare(`
    SELECT 1 FROM relation_states WHERE local_address = ? AND peer_address = ?
      AND (handshake_accepted_at IS NOT NULL OR status IN ('accepted','confirmed','active')) LIMIT 1
  `).get(LOCAL, PEER);
  test('2. 已 accept 后, NEW guard 命中 (防止浪费 0.2 KAS 重复回握手)', () => !!guardHit);
}

// ─── Scenario 3: idempotent_key 去重 ───
{
  db.prepare("DELETE FROM pending_actions WHERE local_address = ? AND target_address = ?").run(LOCAL, PEER);
  db.prepare("UPDATE relation_states SET status='observed', handshake_accepted_at=NULL WHERE local_address = ? AND peer_address = ?").run(LOCAL, PEER);
  const key = `handshake_accept:${LOCAL}:${PEER}`;

  // 第一次入队
  db.prepare(`INSERT OR IGNORE INTO pending_actions
    (id, action_type, direction, local_address, target_address, source, idempotent_key, status, trigger_txid, created_at, updated_at)
    VALUES (?, 'handshake_accept', 'inbound', ?, ?, 'smoke', ?, 'pending', 't1', ?, ?)`)
    .run(randomUUID(), LOCAL, PEER, key, now, now);
  // 第二次入队 (同一 idempotent_key) → 应被 IGNORE
  db.prepare(`INSERT OR IGNORE INTO pending_actions
    (id, action_type, direction, local_address, target_address, source, idempotent_key, status, trigger_txid, created_at, updated_at)
    VALUES (?, 'handshake_accept', 'inbound', ?, ?, 'smoke', ?, 'pending', 't2', ?, ?)`)
    .run(randomUUID(), LOCAL, PEER, key, now, now);

  const cnt = db.prepare("SELECT COUNT(*) as c FROM pending_actions WHERE local_address = ? AND target_address = ?").get(LOCAL, PEER);
  test('3. idempotent_key 保证重复入队只存 1 行 (防 N 份 pending_action 竞争)', () => cnt.c === 1);
}

// ─── Scenario 4: contacts/list API 默认过滤 ───
{
  // 构造真实 identities + relay_nodes 便于 API 路径
  // 先找现有 Trader-B 用作 local, 构造 fake peer 只写 relation_states (不建 relay)
  const traderB = db.prepare("SELECT id, address FROM relay_nodes WHERE is_dex_broker=1 LIMIT 1").get();
  if (!traderB) {
    test('4. 缺 broker relay, skip', () => true);
  } else {
    // 清理并注入 3 条不同 status 的 relation_states
    db.prepare("DELETE FROM relation_states WHERE local_address = ? AND peer_address LIKE 'kaspa:qtest-hs-%'").run(traderB.address);
    for (const [peer, status] of [
      ['kaspa:qtest-hs-obs', 'observed'],
      ['kaspa:qtest-hs-acc', 'accepted'],
      ['kaspa:qtest-hs-act', 'active'],
    ]) {
      db.prepare(`INSERT INTO relation_states (id, local_address, peer_address, first_seen_tx, handshake_observed_at, status, updated_at)
        VALUES (?, ?, ?, 'tx', ?, ?, ?)`).run(randomUUID(), traderB.address, peer, now, status, now);
    }
    // 直接跑 NEW SQL
    const allowedStatuses = ['accepted', 'confirmed', 'active', 'stale'];
    const placeholders = allowedStatuses.map(() => '?').join(',');
    const def = db.prepare(`
      SELECT peer_address, status FROM relation_states WHERE local_address = ? AND status IN (${placeholders}) AND peer_address LIKE 'kaspa:qtest-hs-%'
    `).all(traderB.address, ...allowedStatuses);

    const statuses = def.map(r => r.status).sort();
    test('4a. 默认只返 accepted/active 两行 (observed 被过滤)', () =>
      statuses.length === 2 && statuses.includes('accepted') && statuses.includes('active') && !statuses.includes('observed'));

    // include_observed=1
    const withObs = db.prepare(`
      SELECT peer_address, status FROM relation_states WHERE local_address = ? AND status IN (${placeholders.concat(',?')}) AND peer_address LIKE 'kaspa:qtest-hs-%'
    `).all(traderB.address, ...allowedStatuses, 'observed');
    test('4b. include_observed=1 → 包含 observed 行', () =>
      withObs.map(r => r.status).includes('observed'));

    // /api/contacts/pending 逻辑: 只 observed
    const pending = db.prepare(`
      SELECT peer_address, status FROM relation_states WHERE local_address = ? AND status = 'observed' AND peer_address LIKE 'kaspa:qtest-hs-%'
    `).all(traderB.address);
    test('4c. /api/contacts/pending 只返 observed 一行', () =>
      pending.length === 1 && pending[0].status === 'observed');
  }
}

// ─── Scenario 5: 588 现状的回溯验证 ───
{
  const traderB = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
  const peer588 = 'kaspa:qqscw77lnjdjuafrjh8nz5hxlat83cehv0waauh40cmu09xhtnurgcqs3s588';
  // 真实 588 行应该 status='observed' handshake_accepted_at=null
  const real = db.prepare("SELECT status, handshake_accepted_at FROM relation_states WHERE local_address = ? AND peer_address = ?").get(traderB, peer588);
  test('5a. 588 在 DB 里确实 observed + null accepted_at', () => real?.status === 'observed' && real?.handshake_accepted_at === null);

  // 新 guard 对 588 不命中 → 修复后重启 Console 再 ingest 时能入队
  const newGuard = db.prepare(`
    SELECT 1 FROM relation_states WHERE local_address = ? AND peer_address = ?
      AND (handshake_accepted_at IS NOT NULL OR status IN ('accepted','confirmed','active')) LIMIT 1
  `).get(traderB, peer588);
  test('5b. NEW guard 对 588 不命中 (修复后会入 pending 触发 accept)', () => !newGuard);

  // 默认 contacts API 过滤 588 不应出现
  const inContacts = db.prepare(`
    SELECT 1 FROM relation_states WHERE local_address = ? AND peer_address = ? AND status IN ('accepted','confirmed','active','stale') LIMIT 1
  `).get(traderB, peer588);
  test('5c. 默认通讯录查询 588 不出现 (修复后 UI 不再错误显示)', () => !inContacts);
}

console.log(`\n=== ${pass} pass / ${fail} fail ===`);
db.close();
process.exit(fail === 0 ? 0 : 1);
