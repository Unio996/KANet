/**
 * projection.js tests — T3.4 (per task PZ-MATCHER-shipT3 v1.1 §T3.4)
 *
 * Run: node --test kasia-console/test/projection.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { STATE_TRANSITIONS, deriveProtocolStatus, verifyProtocolStatusConsistency } from '../src/services/projection.js';

function setupTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE broadcast_messages (
      tx_hash TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      sender_address TEXT,
      channel_name TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE exchange_offers (
      id TEXT PRIMARY KEY,
      protocol_status TEXT NOT NULL DEFAULT 'open'
    );
  `);
  return db;
}

function insertEvent(db, txHash, content, ts) {
  db.prepare('INSERT INTO broadcast_messages (tx_hash, content, created_at) VALUES (?, ?, ?)').run(txHash, content, ts);
}

test('STATE_TRANSITIONS map covers 9 protocol event_types (per INVARIANTS §9 9-state)', () => {
  const expected = [
    'kanet_exchange_v1', 'kanet_exchange_accept_v1', 'kanet_exchange_paid_v1',
    'kanet_exchange_delivered_v1', 'kanet_exchange_completed_v1', 'kanet_exchange_dispute_v1',
    'kanet_exchange_cancel_v1', 'kanet_exchange_timeout_v1', 'kanet_exchange_resolve_v1',
  ];
  for (const t of expected) {
    assert.ok(STATE_TRANSITIONS[t], `missing mapping for ${t}`);
  }
  assert.equal(STATE_TRANSITIONS['kanet_exchange_v1'], 'open');
  assert.equal(STATE_TRANSITIONS['kanet_exchange_accept_v1'], 'matched');
  assert.equal(STATE_TRANSITIONS['kanet_exchange_paid_v1'], 'verifying');
  assert.equal(STATE_TRANSITIONS['kanet_exchange_delivered_v1'], 'delivering');
  assert.equal(STATE_TRANSITIONS['kanet_exchange_completed_v1'], 'completed');
});

test('deriveProtocolStatus 0 events → open (default)', () => {
  const db = setupTestDb();
  assert.equal(deriveProtocolStatus('offer-A', db), 'open');
});

test('deriveProtocolStatus replay full happy path lifecycle', () => {
  const db = setupTestDb();
  // publish (id field per exchange.js:158)
  insertEvent(db, 'tx1', JSON.stringify({ t: 'kanet_exchange_v1', id: 'offer-A' }), '2026-05-03T01:00:00Z');
  insertEvent(db, 'tx2', JSON.stringify({ t: 'kanet_exchange_accept_v1', offer_id: 'offer-A' }), '2026-05-03T01:01:00Z');
  insertEvent(db, 'tx3', JSON.stringify({ t: 'kanet_exchange_paid_v1', offer_id: 'offer-A', payment_tx: '0xabc' }), '2026-05-03T01:02:00Z');
  insertEvent(db, 'tx4', JSON.stringify({ t: 'kanet_exchange_delivered_v1', offer_id: 'offer-A', delivery_tx: 'kastx' }), '2026-05-03T01:03:00Z');
  insertEvent(db, 'tx5', JSON.stringify({ t: 'kanet_exchange_completed_v1', offer_id: 'offer-A' }), '2026-05-03T01:04:00Z');
  assert.equal(deriveProtocolStatus('offer-A', db), 'completed');
});

test('deriveProtocolStatus traces partial lifecycle (paid → verifying state)', () => {
  const db = setupTestDb();
  insertEvent(db, 'tx1', JSON.stringify({ t: 'kanet_exchange_v1', id: 'offer-B' }), '2026-05-03T01:00:00Z');
  insertEvent(db, 'tx2', JSON.stringify({ t: 'kanet_exchange_accept_v1', offer_id: 'offer-B' }), '2026-05-03T01:01:00Z');
  insertEvent(db, 'tx3', JSON.stringify({ t: 'kanet_exchange_paid_v1', offer_id: 'offer-B' }), '2026-05-03T01:02:00Z');
  // No delivered yet
  assert.equal(deriveProtocolStatus('offer-B', db), 'verifying');
});

test('deriveProtocolStatus dispute path: published → matched → disputed', () => {
  const db = setupTestDb();
  insertEvent(db, 'tx1', JSON.stringify({ t: 'kanet_exchange_v1', id: 'offer-C' }), '2026-05-03T01:00:00Z');
  insertEvent(db, 'tx2', JSON.stringify({ t: 'kanet_exchange_accept_v1', offer_id: 'offer-C' }), '2026-05-03T01:01:00Z');
  insertEvent(db, 'tx3', JSON.stringify({ t: 'kanet_exchange_dispute_v1', offer_id: 'offer-C' }), '2026-05-03T01:02:00Z');
  assert.equal(deriveProtocolStatus('offer-C', db), 'disputed');
});

test('deriveProtocolStatus ignores events for other offers (LIKE % match safeguard)', () => {
  const db = setupTestDb();
  insertEvent(db, 'tx1', JSON.stringify({ t: 'kanet_exchange_v1', id: 'offer-X' }), '2026-05-03T01:00:00Z');
  insertEvent(db, 'tx2', JSON.stringify({ t: 'kanet_exchange_paid_v1', offer_id: 'other-offer' }), '2026-05-03T01:01:00Z');
  // offer-X only saw publish, NOT paid (paid was for other-offer)
  assert.equal(deriveProtocolStatus('offer-X', db), 'open');
});

test('deriveProtocolStatus skips malformed JSON (catch silently)', () => {
  const db = setupTestDb();
  insertEvent(db, 'tx1', JSON.stringify({ t: 'kanet_exchange_v1', id: 'offer-D' }), '2026-05-03T01:00:00Z');
  insertEvent(db, 'tx2', '{"t": malformed", offer_id', '2026-05-03T01:01:00Z'); // bad JSON contains offer_id substring
  assert.equal(deriveProtocolStatus('offer-D', db), 'open');
});

test('verifyProtocolStatusConsistency healthy: db cache == derived', () => {
  const db = setupTestDb();
  db.prepare('INSERT INTO exchange_offers (id, protocol_status) VALUES (?, ?)').run('offer-E', 'matched');
  insertEvent(db, 'tx1', JSON.stringify({ t: 'kanet_exchange_v1', id: 'offer-E' }), '2026-05-03T01:00:00Z');
  insertEvent(db, 'tx2', JSON.stringify({ t: 'kanet_exchange_accept_v1', offer_id: 'offer-E' }), '2026-05-03T01:01:00Z');
  const r = verifyProtocolStatusConsistency('offer-E', db);
  assert.equal(r.dbStatus, 'matched');
  assert.equal(r.derivedStatus, 'matched');
  assert.equal(r.consistent, true);
});

test('verifyProtocolStatusConsistency drift detect: db lags chain', () => {
  const db = setupTestDb();
  // db cache says 'matched' but chain has paid event (= 'verifying')
  db.prepare('INSERT INTO exchange_offers (id, protocol_status) VALUES (?, ?)').run('offer-F', 'matched');
  insertEvent(db, 'tx1', JSON.stringify({ t: 'kanet_exchange_v1', id: 'offer-F' }), '2026-05-03T01:00:00Z');
  insertEvent(db, 'tx2', JSON.stringify({ t: 'kanet_exchange_accept_v1', offer_id: 'offer-F' }), '2026-05-03T01:01:00Z');
  insertEvent(db, 'tx3', JSON.stringify({ t: 'kanet_exchange_paid_v1', offer_id: 'offer-F' }), '2026-05-03T01:02:00Z');
  const r = verifyProtocolStatusConsistency('offer-F', db);
  assert.equal(r.dbStatus, 'matched');
  assert.equal(r.derivedStatus, 'verifying');
  assert.equal(r.consistent, false);
});

test('verifyProtocolStatusConsistency offer not in db → dbStatus=null', () => {
  const db = setupTestDb();
  insertEvent(db, 'tx1', JSON.stringify({ t: 'kanet_exchange_v1', id: 'offer-G' }), '2026-05-03T01:00:00Z');
  const r = verifyProtocolStatusConsistency('offer-G', db);
  assert.equal(r.dbStatus, null);
  assert.equal(r.derivedStatus, 'open');
  assert.equal(r.consistent, false);
});

test('source: projection.js 0 SQL UPDATE / INSERT exchange_offers (read-only per 决断 2)', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/services/projection.js', import.meta.url), 'utf-8');
  // Strict read-only: 0 mutation of exchange_offers (per 决断 2 NOT writer refactor)
  assert.doesNotMatch(src, /UPDATE\s+exchange_offers/i);
  assert.doesNotMatch(src, /INSERT\s+INTO\s+exchange_offers/i);
});
