// broker_ensure_relation_rate_limit — KI N19.265 Sub 5.1 (NWT r247.7 ship lock)
//
// Invariant: broker IS_SERVICE _ensureRelation rate-limits at 10 auto-observe per hour.
// 10 fresh stranger peers → 10 chain_event 'auto_handshake_by_broker' rows emitted.
// 11th fresh peer → rate-limit skip (= no new chain_event).
//
// Uses direct router.js import (= no real DM round-trip, no Kaspa cost).
// Simulates handleMessage call for 11 unique fake stranger peer addresses.
//
// Cleanup: removes test relation_states + chain_events post-run.

import { randomUUID } from 'crypto';
// NWT r247.8: use shared sqlite (= same connection as router.js handleMessage writes)
// to eliminate WAL read-snapshot cache mismatch suspected in initial Sub 5.1 test fail.
import { sqlite as db } from '../../../src/db/client.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';  // Trader-B

export default {
  id: 'broker_ensure_relation_rate_limit',
  description: 'KI N19.265 Sub 5: _ensureRelation 10/h rate limit + auto chain_event audit',
  domain: 'system',
  tags: ['regression', 'p1', 'ki-n19265', 'sub-5', 'broker-service'],
  skip_in_batch: true,  // production cron auto_handshake_by_broker rows can interfere; manual fire only

  async run() {
    const failures = [];
    const broker = db.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
    if (!broker?.address) {
      return { ok: false, error: 'broker relay not found' };
    }

    // Generate 11 fake stranger peers (test-prefixed for cleanup)
    const fakeStrangers = Array.from({ length: 11 }, () =>
      `kaspa:test_stranger_${randomUUID().replace(/-/g, '').slice(0, 32)}`
    );

    try {
      const { handleMessage } = await import('../../../src/services/broker-v3/router.js');

      // Clean any prior test fixture rows + reset rate-limit window for broker.
      db.prepare(`DELETE FROM relation_states WHERE peer_address LIKE 'kaspa:test_stranger_%'`).run();
      db.prepare(`DELETE FROM chain_events WHERE event_type='auto_handshake_by_broker' AND to_address LIKE 'kaspa:test_stranger_%'`).run();
      // Reset rate-limit window: backdate ALL recent auto_handshake_by_broker rows for this broker
      // so the 10/h window starts fresh for the test. (Production rows preserved with backdated timestamp.)
      db.prepare(`
        UPDATE chain_events SET observed_at = datetime('now', '-2 hours')
        WHERE event_type='auto_handshake_by_broker'
          AND from_address = ?
          AND observed_at > datetime('now', '-1 hour')
      `).run(broker.address);

      // Fire 11 stranger DMs (msg='back' = no-op menu, _ensureRelation fires regardless)
      for (let i = 0; i < 11; i++) {
        await handleMessage(fakeStrangers[i], 'back', { relayNodeId: BROKER_RELAY_ID, inbound_txid: `test-handshake-${i}` });
      }

      // Invariant 1: exactly 10 'auto_handshake_by_broker' chain_events (= rate limit caps 11th)
      const auditRows = db.prepare(`
        SELECT COUNT(*) c FROM chain_events
        WHERE event_type='auto_handshake_by_broker'
          AND to_address LIKE 'kaspa:test_stranger_%'
      `).get().c;
      if (auditRows !== 10) failures.push(`I1: expected 10 audit rows, got ${auditRows}`);

      // Invariant 2: 10 relation_states rows created (= first 10 strangers onboarded)
      const relRows = db.prepare(`
        SELECT COUNT(*) c FROM relation_states
        WHERE peer_address LIKE 'kaspa:test_stranger_%' AND local_address = ?
      `).get(broker.address).c;
      if (relRows !== 10) failures.push(`I2: expected 10 relation_states rows, got ${relRows}`);

      // Invariant 3: classification anti-promote — should be 'seen_candidate' OR NULL (not 'responsive_agent'/'verified_agent').
      // acceptHandshake internal logic conditionally promotes from 'seen_candidate'/'declared_candidate' to 'responsive_agent',
      // but for fresh test peers with NULL initial classification, my UPDATE sets to 'seen_candidate' after.
      // Permissive check: accept 'seen_candidate' OR NULL (= classification gate intact, no auto-promote).
      const promoted = db.prepare(`
        SELECT COUNT(*) c FROM relation_states
        WHERE peer_address LIKE 'kaspa:test_stranger_%' AND local_address = ?
          AND classification IN ('responsive_agent', 'verified_agent')
      `).get(broker.address).c;
      if (promoted > 0) failures.push(`I3: ${promoted} rows promoted to responsive/verified (anti-promote gate broken)`);

      // Invariant 4: status 'accepted' (= acceptHandshake fired)
      const wrongStatus = db.prepare(`
        SELECT COUNT(*) c FROM relation_states
        WHERE peer_address LIKE 'kaspa:test_stranger_%' AND local_address = ?
          AND status != 'accepted'
      `).get(broker.address).c;
      if (wrongStatus > 0) failures.push(`I4: ${wrongStatus} rows have status != 'accepted'`);

      // Invariant 5: 11th stranger NOT in relation_states (= rate-limited)
      const eleventhPresent = db.prepare(`
        SELECT COUNT(*) c FROM relation_states
        WHERE peer_address = ? AND local_address = ?
      `).get(fakeStrangers[10], broker.address).c;
      if (eleventhPresent !== 0) failures.push(`I5: 11th stranger should be rate-limited but exists in relation_states`);

      // Cleanup test fixture
      db.prepare(`DELETE FROM relation_states WHERE peer_address LIKE 'kaspa:test_stranger_%'`).run();
      db.prepare(`DELETE FROM chain_events WHERE event_type='auto_handshake_by_broker' AND to_address LIKE 'kaspa:test_stranger_%'`).run();

      // Diagnostic dump for failure cases (NWT r247.8 dig request).
      if (failures.length > 0) {
        const sample = db.prepare(`
          SELECT classification, status, peer_address
          FROM relation_states WHERE peer_address LIKE 'kaspa:test_stranger_%'
          ORDER BY updated_at DESC LIMIT 5
        `).all();
        const auditSample = db.prepare(`
          SELECT to_address, observed_at FROM chain_events
          WHERE event_type='auto_handshake_by_broker' AND to_address LIKE 'kaspa:test_stranger_%'
          ORDER BY observed_at DESC LIMIT 5
        `).all();
        // Cleanup before reporting (= no state pollution even on fail)
        db.prepare(`DELETE FROM relation_states WHERE peer_address LIKE 'kaspa:test_stranger_%'`).run();
        db.prepare(`DELETE FROM chain_events WHERE event_type='auto_handshake_by_broker' AND to_address LIKE 'kaspa:test_stranger_%'`).run();
        return {
          ok: false,
          error: failures.join('; '),
          failures,
          diag_relation_sample: sample,
          diag_audit_sample: auditSample,
          diag_audit_count: auditRows,
          diag_relation_count: relRows,
        };
      }
      return {
        ok: true,
        summary: `5 invariant PASS: 10 audit rows / 10 relation_states / no promote / status 'accepted' / 11th rate-limited`,
      };
    } finally {
      // NWT r247.8: shared sqlite no .close() (= singleton, Console keeps it open).
    }
  },
};
