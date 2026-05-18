// N13 v119 SQL-level invariant — UPDATE protocol_status='awaiting_manual_confirm' 不 CHECK fail
// Complement to broker/n13_v119_check_constraint_enum (schema 检) — 本测 runtime SQL UPDATE 路径.
// exchange-machine.js routeToVerification L996 写这值, pre-v119 production crash.
// fix: d7e41952 enum +2 → SQL UPDATE 通过.

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data/console.db');
const TEST_OFFER_ID = `test-awaiting-manual-${Date.now().toString(36)}`;

export default {
  id: 'exchange_route_to_verification_manual_transition',
  description: 'N9/N13 SQL UPDATE protocol_status="awaiting_manual_confirm" 通过 (v119 enum 含此值, routeToVerification manual path)',
  domain: 'exchange',
  tags: ['regression', 'schema', 'routeToVerification', 'awaiting_manual_confirm'],

  async run() {
    const db = new Database(DB_PATH);
    try {
      // Setup: matched offer with manual verification
      db.prepare(`
        INSERT INTO exchange_offers (
          id, maker, give_asset, give_amount, want_asset, want_amount,
          protocol_status, market_key, verification, is_fully_observed,
          created_at, updated_at, broadcast_at, broadcast_tx_id, metadata
        ) VALUES (?, 'kaspa:qtest_maker', 'KAS', '10', 'USDT', '0.4',
          'matched', 'KAS-USDT', 'manual', 1,
          datetime('now'), datetime('now'), datetime('now'), ?, '{}')
      `).run(TEST_OFFER_ID, 'a'.repeat(64));

      // UPDATE to awaiting_manual_confirm — this is what routeToVerification L996 does
      try {
        db.prepare(`UPDATE exchange_offers SET protocol_status='awaiting_manual_confirm', updated_at=datetime('now') WHERE id = ?`).run(TEST_OFFER_ID);
      } catch (err) {
        return { ok: false, error: `UPDATE to awaiting_manual_confirm THROW (CHECK constraint pre-v119): ${err.message}` };
      }

      const row = db.prepare('SELECT protocol_status FROM exchange_offers WHERE id = ?').get(TEST_OFFER_ID);
      if (row?.protocol_status !== 'awaiting_manual_confirm') {
        return { ok: false, error: `protocol_status mismatch: got ${row?.protocol_status}, expected awaiting_manual_confirm` };
      }

      return { ok: true, summary: 'awaiting_manual_confirm UPDATE通过, routeToVerification manual path runtime-clean' };
    } finally {
      try { db.prepare('DELETE FROM exchange_offers WHERE id = ?').run(TEST_OFFER_ID); } catch {}
      db.close();
    }
  },
};
