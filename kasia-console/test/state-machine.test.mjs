/**
 * broker-state-machine SA-2 单元测试 — 7 unit test (per task v1.2 spec).
 *
 * Run: node --test test/state-machine.test.mjs
 *
 * mock 模式 (per task v1.2 SA-5a 推荐): in-memory sqlite + INSERT fixture.
 * 不 mock prepare() — SQL 字符串变化时 mock 失效, 测试假绿. in-memory 真跑 SQL 才捕 SQL bug.
 *
 * Tests:
 *   1. illegal transition (e.g. completed → paid) throws
 *   2. missing required tx hash (e.g. paid 不带 paymentTxHash) throws
 *   3. CAS race fail returns ok:false (UPDATE WHERE state=expected 不匹配)
 *   4. no_escrow=true 允许 failed state 无 refundTxHash
 *   5. opts.reason / triggeredBy 进 audit log (chain_events OR broker_workflow_markers 真 INSERT)
 *   6. getOrderState 返 latest state (不 cache)
 *   7. findActiveOrder 仅返非 terminal
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  transition,
  getOrderState,
  findActiveOrder,
  reconcileStaleOrders,
  ALLOWED_TRANSITIONS,
  TX_REQUIRED,
  STATES,
} from '../src/services/broker-state-machine.js';

// ── Test DB setup (in-memory, 跟 prod schema 同 minus triggers/FK) ──
function setupDB() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE retail_dex_orders (
      id TEXT PRIMARY KEY,
      user_kasia_address TEXT NOT NULL,
      side TEXT NOT NULL,
      order_type TEXT NOT NULL DEFAULT 'market',
      qty TEXT,
      pay_chain TEXT,
      pay_address TEXT,
      exchange_offer_id TEXT,
      state TEXT NOT NULL DEFAULT 'aligning',
      pay_tx_hash TEXT,
      deliver_tx_hash TEXT,
      refund_tx_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE chain_events (
      id TEXT PRIMARY KEY,
      txid TEXT NOT NULL,
      from_address TEXT,
      to_address TEXT,
      event_type TEXT NOT NULL,
      payload TEXT,
      observed_by TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      UNIQUE(txid, event_type)
    );
    CREATE TABLE broker_workflow_markers (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      src_event_id TEXT,
      payload TEXT,
      created_at TEXT
    );
  `);
  return db;
}

function seedOrder(db, { id, peer, state = 'aligning', side = 'sell_kas', qty = '50' }) {
  db.prepare(`
    INSERT INTO retail_dex_orders (id, user_kasia_address, side, order_type, qty, state, created_at, updated_at)
    VALUES (?, ?, ?, 'market', ?, ?, datetime('now'), datetime('now'))
  `).run(id, peer, side, qty, state);
}

// 64-hex chain hash (real fmt)
const FAKE_HASH = 'a'.repeat(64);
const FAKE_HASH_2 = 'b'.repeat(64);
const FAKE_HASH_3 = 'c'.repeat(64);

// ── Tests ──────────────────────────────────────────────

describe('SA-2 transition() — 7 unit tests', () => {
  let db;

  beforeEach(() => {
    db = setupDB();
  });

  // ── Test 1: illegal transition throws ─────────────────
  it('1. illegal transition (completed → paid) throws', () => {
    seedOrder(db, { id: 'o1', peer: 'kaspa:p1', state: 'completed' });

    assert.throws(
      () => transition({
        orderId: 'o1',
        expectedFromState: 'completed',
        toState: 'paid',
        opts: { paymentTxHash: FAKE_HASH },
        db,
      }),
      /illegal transition: completed → paid/
    );

    // 也验 unknown fromState throws
    assert.throws(
      () => transition({
        orderId: 'o1',
        expectedFromState: 'bogus_state',
        toState: 'paid',
        opts: { paymentTxHash: FAKE_HASH },
        db,
      }),
      /unknown fromState: bogus_state/
    );
  });

  // ── Test 2: missing required tx hash throws ─────────────
  it('2. missing required tx hash (paid 不带 paymentTxHash) throws', () => {
    seedOrder(db, { id: 'o2', peer: 'kaspa:p2', state: 'awaiting_payment' });

    // paid 必须 paymentTxHash
    assert.throws(
      () => transition({
        orderId: 'o2',
        expectedFromState: 'awaiting_payment',
        toState: 'paid',
        opts: {},  // 空 opts
        db,
      }),
      /paymentTxHash required for paid/
    );

    // refunded 必须 refundTxHash (no_escrow 仅 failed allowed, refunded 不 allow)
    assert.throws(
      () => transition({
        orderId: 'o2',
        expectedFromState: 'awaiting_payment',
        toState: 'refunded',
        opts: {},
        db,
      }),
      /refundTxHash required for refunded/
    );

    // SA-2.fix (NWT r79 reviewer hat): refunded WITH no_escrow=true 仍 throws.
    // 验 no_escrow escape 仅 failed allowed (TX_REQUIRED.refunded='refundTxHash' 无 _or_no_escrow).
    assert.throws(
      () => transition({
        orderId: 'o2',
        expectedFromState: 'awaiting_payment',
        toState: 'refunded',
        opts: { no_escrow: true },  // refunded 不 allow no_escrow escape
        db,
      }),
      /refundTxHash required for refunded/
    );

    // completed 必须 deliveryTxHash
    db.prepare(`UPDATE retail_dex_orders SET state='paid' WHERE id='o2'`).run();
    assert.throws(
      () => transition({
        orderId: 'o2',
        expectedFromState: 'paid',
        toState: 'completed',
        opts: { paymentTxHash: FAKE_HASH },  // 错传 payment 而非 delivery
        db,
      }),
      /deliveryTxHash required for completed/
    );
  });

  // ── Test 3: CAS race fail returns ok:false ─────────────
  it('3. CAS race fail (expectedFromState != current) returns ok:false', () => {
    seedOrder(db, { id: 'o3', peer: 'kaspa:p3', state: 'awaiting_payment' });

    // race scenario: 另一 caller 已 advance 到 paid, current caller 仍以为 awaiting_payment
    db.prepare(`UPDATE retail_dex_orders SET state='paid' WHERE id='o3'`).run();

    // current caller transition awaiting_payment → refunded → CAS fail
    const result = transition({
      orderId: 'o3',
      expectedFromState: 'awaiting_payment',
      toState: 'refunded',
      opts: { refundTxHash: FAKE_HASH },
      db,
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /state mismatch/);

    // 验 row 状态没动 (仍 paid)
    const row = db.prepare(`SELECT state FROM retail_dex_orders WHERE id='o3'`).get();
    assert.equal(row.state, 'paid');
  });

  // ── Test 4: no_escrow=true 允许 failed 无 refundTxHash ─────────
  it('4. no_escrow=true 允许 failed state 无 refundTxHash', () => {
    seedOrder(db, { id: 'o4', peer: 'kaspa:p4', state: 'awaiting_payment' });

    const result = transition({
      orderId: 'o4',
      expectedFromState: 'awaiting_payment',
      toState: 'failed',
      opts: { no_escrow: true, reason: 'publish_failed' },
      db,
    });

    assert.equal(result.ok, true);
    assert.ok(result.transitionedAt);

    // 验 row state = failed, refund_tx_hash NULL
    const row = db.prepare(`SELECT state, refund_tx_hash FROM retail_dex_orders WHERE id='o4'`).get();
    assert.equal(row.state, 'failed');
    assert.equal(row.refund_tx_hash, null);
  });

  // ── Test 5: opts.reason / triggeredBy 进 audit log ─────────
  it('5. opts.reason / triggeredBy 进 audit log (chain_events 真 INSERT)', () => {
    seedOrder(db, { id: 'o5', peer: 'kaspa:p5', state: 'awaiting_payment' });

    // 5a: 真 chain TX (64-hex) → INSERT chain_events
    const result1 = transition({
      orderId: 'o5',
      expectedFromState: 'awaiting_payment',
      toState: 'refunded',
      opts: {
        refundTxHash: FAKE_HASH,
        reason: 'user_cancel',
        triggeredBy: 'broker-cancel-refund',
      },
      db,
    });
    assert.equal(result1.ok, true);

    const ce = db.prepare(`
      SELECT txid, event_type, payload, observed_by FROM chain_events WHERE txid = ?
    `).get(FAKE_HASH);
    assert.ok(ce, 'chain_events row 应存在');
    assert.equal(ce.event_type, 'broker_state_refunded');
    assert.equal(ce.observed_by, 'broker-state-machine.transition');
    const payload = JSON.parse(ce.payload);
    assert.equal(payload.order_id, 'o5');
    assert.equal(payload.from, 'awaiting_payment');
    assert.equal(payload.to, 'refunded');
    assert.equal(payload.reason, 'user_cancel');
    assert.equal(payload.triggered_by, 'broker-cancel-refund');

    // 5b: 无 chain TX (no_escrow) → INSERT broker_workflow_markers
    seedOrder(db, { id: 'o5b', peer: 'kaspa:p5b', state: 'awaiting_payment' });
    const result2 = transition({
      orderId: 'o5b',
      expectedFromState: 'awaiting_payment',
      toState: 'failed',
      opts: { no_escrow: true, reason: 'self_deal', triggeredBy: 'broker-intake-watcher.R4' },
      db,
    });
    assert.equal(result2.ok, true);

    const wm = db.prepare(`
      SELECT event_type, src_event_id, payload FROM broker_workflow_markers WHERE src_event_id = ?
    `).get('o5b');
    assert.ok(wm, 'broker_workflow_markers row 应存在');
    assert.equal(wm.event_type, 'state_failed');
    const wmPayload = JSON.parse(wm.payload);
    assert.equal(wmPayload.reason, 'self_deal');
    assert.equal(wmPayload.triggered_by, 'broker-intake-watcher.R4');
    assert.equal(wmPayload.no_escrow, true);
  });

  // ── Test 6: getOrderState 返 latest state ─────────
  it('6. getOrderState 返 latest state (不 cache)', () => {
    seedOrder(db, { id: 'o6', peer: 'kaspa:p6', state: 'awaiting_payment' });

    const r1 = getOrderState('o6', db);
    assert.equal(r1.state, 'awaiting_payment');
    assert.equal(r1.refund_tx_hash, null);

    // transition → paid
    transition({
      orderId: 'o6',
      expectedFromState: 'awaiting_payment',
      toState: 'paid',
      opts: { paymentTxHash: FAKE_HASH_2 },
      db,
    });

    const r2 = getOrderState('o6', db);
    assert.equal(r2.state, 'paid');
    assert.equal(r2.pay_tx_hash, FAKE_HASH_2);

    // 不存在 → null
    const r3 = getOrderState('not_exist', db);
    assert.equal(r3, null);
  });

  // ── Test 7: findActiveOrder 仅返非 terminal ─────────
  it('7. findActiveOrder 仅返非 terminal state row', () => {
    const peer = 'kaspa:p7';

    // active row
    seedOrder(db, { id: 'o7-active', peer, state: 'awaiting_payment' });
    const r1 = findActiveOrder(peer, db);
    assert.ok(r1);
    assert.equal(r1.id, 'o7-active');
    assert.equal(r1.state, 'awaiting_payment');

    // transition active → terminal
    transition({
      orderId: 'o7-active',
      expectedFromState: 'awaiting_payment',
      toState: 'refunded',
      opts: { refundTxHash: FAKE_HASH_3 },
      db,
    });

    // findActiveOrder 应 null (terminal 不返)
    const r2 = findActiveOrder(peer, db);
    assert.equal(r2, null);

    // 加 1 个 aligning row + 1 paid row, 验 ORDER BY created_at DESC LIMIT 1 + 仅 active
    db.prepare(`INSERT INTO retail_dex_orders (id, user_kasia_address, side, order_type, state, created_at, updated_at)
                VALUES ('o7-aligning', ?, 'sell_kas', 'market', 'aligning', '2026-04-30T01:00:00Z', '2026-04-30T01:00:00Z')`).run(peer);
    db.prepare(`INSERT INTO retail_dex_orders (id, user_kasia_address, side, order_type, state, created_at, updated_at)
                VALUES ('o7-paid', ?, 'sell_kas', 'market', 'paid', '2026-04-30T02:00:00Z', '2026-04-30T02:00:00Z')`).run(peer);

    const r3 = findActiveOrder(peer, db);
    assert.ok(r3);
    assert.equal(r3.id, 'o7-paid');  // most recent created_at
    assert.equal(r3.state, 'paid');
  });

  // ── Bonus: reconcileStaleOrders is legal stub ─────────
  it('bonus: reconcileStaleOrders is legal stub (_stub: true flag)', async () => {
    const result = await reconcileStaleOrders(db);
    assert.equal(result._stub, true);
    assert.equal(result.stale, 0);
    assert.equal(result.forceFailed, 0);
  });
});
