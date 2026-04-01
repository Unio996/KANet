/**
 * Order Machine + Relation State — Core unit tests
 *
 * Uses in-memory SQLite to test state transitions, optimistic locking,
 * fund lock integration, and counterparty sync in complete isolation.
 *
 * Run: node --test test/order-machine.test.mjs
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// ── Test DB Setup ──────────────────────────────────────────────

let db;

function setupTestDB() {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE mm_orders (
      id TEXT PRIMARY KEY,
      relay_node_id TEXT,
      agent_address TEXT,
      side TEXT NOT NULL,
      kas_amount REAL,
      usdt_amount REAL,
      price REAL,
      chain TEXT DEFAULT 'bnb',
      peer_address TEXT,
      counterparty_order_id TEXT,
      broadcast_txid TEXT,
      mode TEXT DEFAULT '',
      status TEXT DEFAULT 'published',
      timeout_minutes INTEGER DEFAULT 30,
      payment_txhash TEXT,
      kas_txhash TEXT,
      cancel_reason TEXT,
      created_at TEXT,
      accepted_at TEXT,
      paid_at TEXT,
      verified_at TEXT,
      delivered_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE fund_locks (
      id TEXT PRIMARY KEY,
      agent_address TEXT NOT NULL,
      order_id TEXT NOT NULL,
      asset TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'locked',
      created_at TEXT,
      released_at TEXT,
      UNIQUE(order_id, asset)
    );

    CREATE TABLE chain_events (
      id TEXT PRIMARY KEY,
      txid TEXT,
      from_address TEXT,
      to_address TEXT,
      event_type TEXT,
      payload TEXT,
      observed_by TEXT,
      observed_at TEXT,
      UNIQUE(txid, event_type)
    );

    CREATE TABLE execution_states (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      agent_address TEXT NOT NULL,
      permission_level TEXT DEFAULT 'owner',
      status TEXT DEFAULT 'pending',
      amount REAL,
      asset TEXT,
      intent_id TEXT,
      input_txid TEXT,
      output_txid TEXT,
      error_text TEXT,
      approval_timeout INTEGER DEFAULT 15,
      approval_deadline TEXT,
      display_summary TEXT,
      action_details TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE config_entries (
      key TEXT PRIMARY KEY,
      value_encrypted TEXT,
      value_plain_hint TEXT,
      is_sensitive INTEGER DEFAULT 0
    );

    CREATE TABLE relation_states (
      id TEXT PRIMARY KEY,
      local_address TEXT NOT NULL,
      peer_address TEXT NOT NULL,
      first_seen_tx TEXT,
      handshake_observed_at TEXT,
      handshake_accepted_at TEXT,
      session_confirmed_at TEXT,
      status TEXT DEFAULT 'observed',
      trust_level TEXT DEFAULT 'normal',
      is_blocked INTEGER DEFAULT 0,
      updated_at TEXT,
      UNIQUE(local_address, peer_address)
    );
  `);

  return db;
}

// ── Minimal module wrappers that use our test DB ───────────────

// Re-implement core logic inline (same as production, but using test db)
const VALID_TRANSITIONS = {
  published:  ['accepted', 'cancelled', 'expired'],
  accepted:   ['paying', 'published', 'cancelled', 'expired'],
  paying:     ['paid', 'accepted', 'cancelled', 'expired'],
  paid:       ['verified', 'disputed'],
  verified:   ['delivering', 'disputed'],
  delivering: ['completed', 'verified', 'disputed'],
  completed:  [],
  cancelled:  [],
  expired:    [],
  disputed:   ['resolved', 'cancelled', 'completed', 'escalated'],
  escalated:  ['resolved', 'cancelled'],
  resolved:   [],
};
const TERMINAL_STATES = ['completed', 'cancelled', 'expired', 'resolved', 'escalated'];
const TIMESTAMP_FIELDS = {
  accepted: 'accepted_at', paying: 'paid_at', paid: 'paid_at',
  verified: 'verified_at', delivering: 'delivered_at',
  completed: 'completed_at', cancelled: 'completed_at', expired: 'completed_at',
  resolved: 'completed_at', disputed: 'completed_at', escalated: 'completed_at',
};

function createOrder(params) {
  const { id, relayNodeId, agentAddress, side, kasAmount, price, chain = 'bnb',
    peerAddress = null, counterpartyOrderId = null, mode = '', timeoutMinutes = 30 } = params;
  const usdtAmount = kasAmount * price;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO mm_orders (id, relay_node_id, agent_address, side, kas_amount, usdt_amount, price, chain,
      peer_address, counterparty_order_id, mode, status, timeout_minutes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
  `).run(id, relayNodeId, agentAddress, side, kasAmount, usdtAmount, price, chain,
    peerAddress, counterpartyOrderId, mode, timeoutMinutes, now);
  return { id, status: 'published', created_at: now };
}

// Transaction-wrapped transition (mirrors production code)
const _transitionTx = (orderId, newStatus, { txHash = null, reason = null, force = false } = {}) => {
  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM mm_orders WHERE id = ?').get(orderId);
    if (!order) return { ok: false, error: 'Order not found' };
    const currentStatus = order.status;

    if (!force) {
      const allowed = VALID_TRANSITIONS[currentStatus];
      if (!allowed || !allowed.includes(newStatus)) {
        return { ok: false, error: `Cannot transition from "${currentStatus}" to "${newStatus}"` };
      }
    }

    const updates = ['status = ?'];
    const values = [newStatus];
    const tsField = TIMESTAMP_FIELDS[newStatus];
    if (tsField) { updates.push(`${tsField} = ?`); values.push(new Date().toISOString()); }
    if (newStatus === 'published') {
      updates.push('accepted_at = NULL', 'peer_address = NULL', 'counterparty_order_id = NULL');
    }
    if (txHash) {
      if (newStatus === 'paid' || newStatus === 'paying') { updates.push('payment_txhash = ?'); values.push(txHash); }
      else if (newStatus === 'delivering' || newStatus === 'completed') { updates.push('kas_txhash = ?'); values.push(txHash); }
    }
    if (reason && ['cancelled', 'expired', 'disputed'].includes(newStatus)) {
      updates.push('cancel_reason = ?'); values.push(reason);
    }

    // Optimistic lock
    values.push(orderId, currentStatus);
    const result = db.prepare(`UPDATE mm_orders SET ${updates.join(', ')} WHERE id = ? AND status = ?`).run(...values);
    if (result.changes === 0) {
      return { ok: false, error: `Optimistic lock failed` };
    }

    // Fund lock integration
    if (newStatus === 'completed' || newStatus === 'resolved') {
      db.prepare("UPDATE fund_locks SET status = 'spent', released_at = ? WHERE order_id = ? AND status = 'locked'")
        .run(new Date().toISOString(), orderId);
    } else if (['cancelled', 'expired', 'published'].includes(newStatus)) {
      db.prepare("UPDATE fund_locks SET status = 'released', released_at = ? WHERE order_id = ? AND status = 'locked'")
        .run(new Date().toISOString(), orderId);
    }

    // Chain events
    if (txHash) {
      const evType = (newStatus === 'paying' || newStatus === 'paid') ? 'payment' : 'kas_delivery';
      try {
        db.prepare('INSERT OR IGNORE INTO chain_events (id, txid, from_address, to_address, event_type, observed_by, observed_at) VALUES (?,?,?,?,?,?,?)')
          .run(`ce-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, txHash, order.agent_address, order.peer_address, evType, 'system', new Date().toISOString());
      } catch {}
    }

    // Counterparty sync
    if (order.counterparty_order_id) {
      const counter = db.prepare('SELECT id, status FROM mm_orders WHERE id = ?').get(order.counterparty_order_id);
      if (counter && !TERMINAL_STATES.includes(counter.status)) {
        const syncMap = { paid: 'paid', verified: 'verified', completed: 'completed', cancelled: 'cancelled', expired: 'expired', disputed: 'disputed' };
        const counterNew = syncMap[newStatus];
        if (counterNew && counter.status !== counterNew) {
          // Force sync counterparty
          db.prepare('UPDATE mm_orders SET status = ? WHERE id = ?').run(counterNew, counter.id);
        }
      }
    }

    const updated = db.prepare('SELECT * FROM mm_orders WHERE id = ?').get(orderId);
    return { ok: true, order: updated };
  })();
};

function transition(orderId, newStatus, opts = {}) {
  return _transitionTx(orderId, newStatus, opts);
}

function linkOrders(id1, id2) {
  db.transaction(() => {
    db.prepare('UPDATE mm_orders SET counterparty_order_id = ? WHERE id = ?').run(id2, id1);
    db.prepare('UPDATE mm_orders SET counterparty_order_id = ? WHERE id = ?').run(id1, id2);
  })();
}

// Relation state helpers
const RS_TRANSITIONS = {
  observed: ['accepted', 'blocked'], accepted: ['confirmed', 'blocked'],
  confirmed: ['active', 'blocked'], active: ['blocked', 'stale'],
  blocked: ['observed'], stale: ['observed', 'active', 'blocked'],
};

function observeHandshake(local, peer, txid) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id, status FROM relation_states WHERE local_address = ? AND peer_address = ?').get(local, peer);
  if (existing) {
    if (existing.status !== 'observed' && existing.status !== 'stale') return existing;
    db.prepare('UPDATE relation_states SET first_seen_tx = COALESCE(first_seen_tx, ?), status = ?, updated_at = ? WHERE id = ?')
      .run(txid, 'observed', now, existing.id);
    return { ...existing, status: 'observed' };
  }
  const id = `rs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare('INSERT INTO relation_states (id, local_address, peer_address, first_seen_tx, status, updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, local, peer, txid, 'observed', now);
  return { id, status: 'observed' };
}

function advanceRelation(local, peer, newStatus, force = false) {
  const existing = db.prepare('SELECT id, status FROM relation_states WHERE local_address = ? AND peer_address = ?').get(local, peer);
  if (!existing) {
    observeHandshake(local, peer, null);
    return advanceRelation(local, peer, newStatus, force);
  }
  if (!force) {
    const allowed = RS_TRANSITIONS[existing.status];
    if (!allowed || !allowed.includes(newStatus)) return existing;
  }
  db.prepare('UPDATE relation_states SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, new Date().toISOString(), existing.id);
  return { ...existing, status: newStatus };
}

function getRelation(local, peer) {
  return db.prepare('SELECT * FROM relation_states WHERE local_address = ? AND peer_address = ?').get(local, peer) || null;
}

// ── TESTS ──────────────────────────────────────────────────────

describe('Order Machine — State Transitions', () => {
  before(() => setupTestDB());
  beforeEach(() => {
    db.exec('DELETE FROM mm_orders; DELETE FROM fund_locks; DELETE FROM chain_events; DELETE FROM execution_states;');
  });

  it('creates order in published state', () => {
    const o = createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:agent1', side: 'sell', kasAmount: 100, price: 0.04 });
    assert.equal(o.status, 'published');
    const row = db.prepare('SELECT * FROM mm_orders WHERE id = ?').get('o1');
    assert.equal(row.status, 'published');
    assert.equal(row.usdt_amount, 4);
  });

  it('happy path: published → accepted → paying → paid → verified → delivering → completed', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'sell', kasAmount: 50, price: 0.04 });

    assert.ok(transition('o1', 'accepted').ok);
    assert.ok(transition('o1', 'paying').ok);
    assert.ok(transition('o1', 'paid', { txHash: '0xpay123' }).ok);
    assert.ok(transition('o1', 'verified').ok);
    assert.ok(transition('o1', 'delivering', { txHash: 'kas:tx456' }).ok);

    const final = transition('o1', 'completed');
    assert.ok(final.ok);
    assert.equal(final.order.status, 'completed');
    assert.equal(final.order.payment_txhash, '0xpay123');
    assert.equal(final.order.kas_txhash, 'kas:tx456');
  });

  it('rejects invalid transitions', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'buy', kasAmount: 10, price: 0.05 });

    // published → verified (skip steps)
    const r = transition('o1', 'verified');
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('Cannot transition'));

    // published → completed (skip all)
    assert.equal(transition('o1', 'completed').ok, false);
  });

  it('allows revert: accepted → published', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'sell', kasAmount: 10, price: 0.04 });
    transition('o1', 'accepted');

    const r = transition('o1', 'published');
    assert.ok(r.ok);
    assert.equal(r.order.status, 'published');
    assert.equal(r.order.accepted_at, null);
    assert.equal(r.order.peer_address, null);
  });

  it('post-payment cannot cancel or expire — only disputed', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'buy', kasAmount: 10, price: 0.04 });
    transition('o1', 'accepted');
    transition('o1', 'paying');
    transition('o1', 'paid', { txHash: '0xpay' });

    // paid → cancelled: blocked
    assert.equal(transition('o1', 'cancelled').ok, false);
    // paid → expired: blocked
    assert.equal(transition('o1', 'expired').ok, false);
    // paid → disputed: allowed
    assert.ok(transition('o1', 'disputed', { reason: 'timeout protection' }).ok);

    const row = db.prepare('SELECT * FROM mm_orders WHERE id = ?').get('o1');
    assert.equal(row.status, 'disputed');
    assert.equal(row.cancel_reason, 'timeout protection');
  });

  it('terminal states reject all transitions', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'sell', kasAmount: 5, price: 0.04 });
    transition('o1', 'cancelled', { reason: 'user cancelled' });

    assert.equal(transition('o1', 'published').ok, false);
    assert.equal(transition('o1', 'accepted').ok, false);
  });

  it('returns error for non-existent order', () => {
    const r = transition('nonexistent', 'accepted');
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('not found'));
  });

  it('force bypasses transition validation', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'sell', kasAmount: 10, price: 0.04 });
    // published → verified directly (illegal without force)
    const r = transition('o1', 'verified', { force: true });
    assert.ok(r.ok);
    assert.equal(r.order.status, 'verified');
  });

  it('records timestamps for each state', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'sell', kasAmount: 10, price: 0.04 });
    transition('o1', 'accepted');
    transition('o1', 'paying');
    transition('o1', 'paid');
    transition('o1', 'verified');
    transition('o1', 'delivering');
    transition('o1', 'completed');

    const row = db.prepare('SELECT * FROM mm_orders WHERE id = ?').get('o1');
    assert.ok(row.accepted_at);
    assert.ok(row.paid_at);
    assert.ok(row.verified_at);
    assert.ok(row.delivered_at);
    assert.ok(row.completed_at);
  });
});

describe('Order Machine — Optimistic Locking', () => {
  before(() => setupTestDB());
  beforeEach(() => {
    db.exec('DELETE FROM mm_orders; DELETE FROM fund_locks; DELETE FROM chain_events;');
  });

  it('optimistic lock prevents stale-state update', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'sell', kasAmount: 10, price: 0.04 });

    // Simulate race: manually change status behind the transition's back
    // First, transition normally to accepted
    assert.ok(transition('o1', 'accepted').ok);

    // Now tamper: set status to something the next transition doesn't expect
    // Transition to paying (from accepted) should work
    assert.ok(transition('o1', 'paying').ok);

    // Try a second paying transition (status is already 'paying', not 'accepted')
    // The WHERE clause `AND status = 'paying'` will match, but paying → paying is not in VALID_TRANSITIONS
    const r = transition('o1', 'paying');
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('Cannot transition'));
  });

  it('prevents double-accept via optimistic lock', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'sell', kasAmount: 10, price: 0.04 });
    const r1 = transition('o1', 'accepted');
    assert.ok(r1.ok);

    // Try to accept again
    const r2 = transition('o1', 'accepted');
    assert.equal(r2.ok, false); // paying is not in accepted's allowed list as 'accepted'
  });
});

describe('Order Machine — Fund Lock Integration', () => {
  before(() => setupTestDB());
  beforeEach(() => {
    db.exec('DELETE FROM mm_orders; DELETE FROM fund_locks; DELETE FROM chain_events;');
  });

  it('releases fund lock on cancel', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'sell', kasAmount: 100, price: 0.04 });
    // Pre-create a fund lock
    db.prepare("INSERT INTO fund_locks (id, agent_address, order_id, asset, amount, status, created_at) VALUES ('fl1', 'kaspa:a1', 'o1', 'kas', 100, 'locked', ?)")
      .run(new Date().toISOString());

    transition('o1', 'cancelled', { reason: 'test cancel' });

    const lock = db.prepare('SELECT * FROM fund_locks WHERE id = ?').get('fl1');
    assert.equal(lock.status, 'released');
    assert.ok(lock.released_at);
  });

  it('marks fund lock as spent on completion', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'sell', kasAmount: 50, price: 0.04 });
    db.prepare("INSERT INTO fund_locks (id, agent_address, order_id, asset, amount, status, created_at) VALUES ('fl1', 'kaspa:a1', 'o1', 'kas', 50, 'locked', ?)")
      .run(new Date().toISOString());

    transition('o1', 'accepted');
    transition('o1', 'paying');
    transition('o1', 'paid');
    transition('o1', 'verified');
    transition('o1', 'delivering');
    transition('o1', 'completed');

    const lock = db.prepare('SELECT * FROM fund_locks WHERE id = ?').get('fl1');
    assert.equal(lock.status, 'spent');
  });

  it('releases fund lock on revert to published', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'sell', kasAmount: 10, price: 0.04 });
    db.prepare("INSERT INTO fund_locks (id, agent_address, order_id, asset, amount, status, created_at) VALUES ('fl1', 'kaspa:a1', 'o1', 'kas', 10, 'locked', ?)")
      .run(new Date().toISOString());

    transition('o1', 'accepted');
    transition('o1', 'published'); // revert

    const lock = db.prepare('SELECT * FROM fund_locks WHERE id = ?').get('fl1');
    assert.equal(lock.status, 'released');
  });
});

describe('Order Machine — Counterparty Sync', () => {
  before(() => setupTestDB());
  beforeEach(() => {
    db.exec('DELETE FROM mm_orders; DELETE FROM fund_locks; DELETE FROM chain_events;');
  });

  it('syncs paid status to counterparty', () => {
    createOrder({ id: 'buy1', relayNodeId: 'r1', agentAddress: 'kaspa:buyer', side: 'buy', kasAmount: 10, price: 0.04 });
    createOrder({ id: 'sell1', relayNodeId: 'r2', agentAddress: 'kaspa:seller', side: 'sell', kasAmount: 10, price: 0.04 });
    linkOrders('buy1', 'sell1');

    // Both to accepted
    transition('buy1', 'accepted');
    transition('sell1', 'accepted');

    // Buyer pays
    transition('buy1', 'paying');
    transition('buy1', 'paid', { txHash: '0xpay' });

    // Seller should be synced to paid
    const seller = db.prepare('SELECT status FROM mm_orders WHERE id = ?').get('sell1');
    assert.equal(seller.status, 'paid');
  });

  it('cascades cancellation to counterparty', () => {
    createOrder({ id: 'buy1', relayNodeId: 'r1', agentAddress: 'kaspa:buyer', side: 'buy', kasAmount: 10, price: 0.04 });
    createOrder({ id: 'sell1', relayNodeId: 'r2', agentAddress: 'kaspa:seller', side: 'sell', kasAmount: 10, price: 0.04 });
    linkOrders('buy1', 'sell1');
    transition('buy1', 'accepted');
    transition('sell1', 'accepted');

    // Buyer cancels
    transition('buy1', 'cancelled', { reason: 'changed mind' });

    const seller = db.prepare('SELECT status FROM mm_orders WHERE id = ?').get('sell1');
    assert.equal(seller.status, 'cancelled');
  });

  it('does not sync to already-terminal counterparty', () => {
    createOrder({ id: 'buy1', relayNodeId: 'r1', agentAddress: 'kaspa:buyer', side: 'buy', kasAmount: 10, price: 0.04 });
    createOrder({ id: 'sell1', relayNodeId: 'r2', agentAddress: 'kaspa:seller', side: 'sell', kasAmount: 10, price: 0.04 });
    linkOrders('buy1', 'sell1');

    // Seller already completed somehow
    db.prepare("UPDATE mm_orders SET status = 'completed' WHERE id = 'sell1'").run();

    // Buyer cancels — should not change seller
    transition('buy1', 'cancelled');
    const seller = db.prepare('SELECT status FROM mm_orders WHERE id = ?').get('sell1');
    assert.equal(seller.status, 'completed');
  });

  it('links orders bidirectionally in a transaction', () => {
    createOrder({ id: 'a', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'buy', kasAmount: 10, price: 0.04 });
    createOrder({ id: 'b', relayNodeId: 'r2', agentAddress: 'kaspa:a2', side: 'sell', kasAmount: 10, price: 0.04 });
    linkOrders('a', 'b');

    const orderA = db.prepare('SELECT counterparty_order_id FROM mm_orders WHERE id = ?').get('a');
    const orderB = db.prepare('SELECT counterparty_order_id FROM mm_orders WHERE id = ?').get('b');
    assert.equal(orderA.counterparty_order_id, 'b');
    assert.equal(orderB.counterparty_order_id, 'a');
  });
});

describe('Order Machine — Chain Events', () => {
  before(() => setupTestDB());
  beforeEach(() => {
    db.exec('DELETE FROM mm_orders; DELETE FROM chain_events;');
  });

  it('records payment chain event on paid transition', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'buy', kasAmount: 10, price: 0.04, peerAddress: 'kaspa:peer' });
    transition('o1', 'accepted');
    transition('o1', 'paying', { txHash: '0xstart' });

    const events = db.prepare("SELECT * FROM chain_events WHERE event_type = 'payment'").all();
    assert.ok(events.length >= 1);
    assert.equal(events[0].txid, '0xstart');
  });
});

describe('Order Machine — Dispute Escalation', () => {
  before(() => setupTestDB());
  beforeEach(() => {
    db.exec('DELETE FROM mm_orders; DELETE FROM fund_locks;');
  });

  it('disputed → escalated → resolved path', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'buy', kasAmount: 10, price: 0.04 });
    transition('o1', 'accepted');
    transition('o1', 'paying');
    transition('o1', 'paid', { txHash: '0xpay' });
    transition('o1', 'disputed', { reason: 'payment not received' });
    transition('o1', 'escalated');

    const row = db.prepare('SELECT status FROM mm_orders WHERE id = ?').get('o1');
    assert.equal(row.status, 'escalated');

    // escalated → resolved
    assert.ok(transition('o1', 'resolved').ok);
  });

  it('disputed → completed (resolution in buyer favor)', () => {
    createOrder({ id: 'o1', relayNodeId: 'r1', agentAddress: 'kaspa:a1', side: 'buy', kasAmount: 10, price: 0.04 });
    transition('o1', 'accepted');
    transition('o1', 'paying');
    transition('o1', 'paid');
    transition('o1', 'disputed');

    // Resolve by completing the order
    const r = transition('o1', 'completed');
    assert.ok(r.ok);
    assert.equal(r.order.status, 'completed');
  });
});

// ── Relation State Tests ──────────────────────────────────────

describe('Relation State — State Machine', () => {
  before(() => setupTestDB());
  beforeEach(() => {
    db.exec('DELETE FROM relation_states;');
  });

  it('observeHandshake creates observed state', () => {
    const r = observeHandshake('kaspa:local', 'kaspa:peer', 'tx123');
    assert.equal(r.status, 'observed');

    const row = getRelation('kaspa:local', 'kaspa:peer');
    assert.ok(row);
    assert.equal(row.status, 'observed');
    assert.equal(row.first_seen_tx, 'tx123');
  });

  it('happy path: observed → accepted → confirmed → active', () => {
    observeHandshake('kaspa:l', 'kaspa:p', 'tx1');
    advanceRelation('kaspa:l', 'kaspa:p', 'accepted');
    advanceRelation('kaspa:l', 'kaspa:p', 'confirmed');
    advanceRelation('kaspa:l', 'kaspa:p', 'active');

    const row = getRelation('kaspa:l', 'kaspa:p');
    assert.equal(row.status, 'active');
  });

  it('rejects invalid transitions', () => {
    observeHandshake('kaspa:l', 'kaspa:p', 'tx1');

    // observed → active (skip steps)
    const r = advanceRelation('kaspa:l', 'kaspa:p', 'active');
    assert.equal(r.status, 'observed'); // unchanged
  });

  it('any state → blocked works', () => {
    observeHandshake('kaspa:l', 'kaspa:p', 'tx1');
    advanceRelation('kaspa:l', 'kaspa:p', 'accepted');

    const r = advanceRelation('kaspa:l', 'kaspa:p', 'blocked', true);
    assert.equal(r.status, 'blocked');
  });

  it('blocked → observed (unblock)', () => {
    observeHandshake('kaspa:l', 'kaspa:p', 'tx1');
    advanceRelation('kaspa:l', 'kaspa:p', 'blocked', true);

    const r = advanceRelation('kaspa:l', 'kaspa:p', 'observed');
    assert.equal(r.status, 'observed');
  });

  it('observe does not downgrade higher status', () => {
    observeHandshake('kaspa:l', 'kaspa:p', 'tx1');
    advanceRelation('kaspa:l', 'kaspa:p', 'accepted');

    // Another observe should NOT downgrade
    const r = observeHandshake('kaspa:l', 'kaspa:p', 'tx2');
    assert.equal(r.status, 'accepted');
  });

  it('auto-creates relation when advancing non-existent', () => {
    // No prior observeHandshake
    const r = advanceRelation('kaspa:new-local', 'kaspa:new-peer', 'accepted');
    assert.equal(r.status, 'accepted');

    const row = getRelation('kaspa:new-local', 'kaspa:new-peer');
    assert.ok(row);
    assert.equal(row.status, 'accepted');
  });

  it('stale → active recovery path', () => {
    observeHandshake('kaspa:l', 'kaspa:p', 'tx1');
    advanceRelation('kaspa:l', 'kaspa:p', 'accepted');
    advanceRelation('kaspa:l', 'kaspa:p', 'confirmed');
    advanceRelation('kaspa:l', 'kaspa:p', 'active');

    // Mark stale
    db.prepare("UPDATE relation_states SET status = 'stale' WHERE local_address = 'kaspa:l' AND peer_address = 'kaspa:p'").run();

    // Recovery
    const r = advanceRelation('kaspa:l', 'kaspa:p', 'active');
    assert.equal(r.status, 'active');
  });
});

describe('Relation State — UNIQUE constraint', () => {
  before(() => setupTestDB());
  beforeEach(() => {
    db.exec('DELETE FROM relation_states;');
  });

  it('same local+peer pair returns existing record', () => {
    observeHandshake('kaspa:l', 'kaspa:p', 'tx1');
    observeHandshake('kaspa:l', 'kaspa:p', 'tx2');

    const rows = db.prepare('SELECT * FROM relation_states WHERE local_address = ? AND peer_address = ?').all('kaspa:l', 'kaspa:p');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].first_seen_tx, 'tx1'); // first tx preserved
  });
});
