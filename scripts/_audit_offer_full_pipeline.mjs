#!/usr/bin/env node
// _audit_offer_full_pipeline.mjs — AU-02 (NWT 02:49 v5 close 钦定)
//
// Full lifecycle audit: escrow row → publish → match → paid → completed/refunded/cancelled/expired.
// Cross-references user_escrow_balances + exchange_offers + chain_events for one offer (or batch).
// Verifies state machine transitions and TX evidence chain integrity.
//
// Companion to _audit_offer_5_fields.mjs (field cross-check) — this one validates timeline.
//
// Usage:
//   node scripts/_audit_offer_full_pipeline.mjs                          # 最近 10 escrow offers
//   node scripts/_audit_offer_full_pipeline.mjs --offer-id=<uuid>        # 单 offer
//   node scripts/_audit_offer_full_pipeline.mjs --escrow-id=<uuid>       # by escrow row
//   node scripts/_audit_offer_full_pipeline.mjs --status=completed       # filter terminal status

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../kasia-console/data/console.db');
const requireFromConsole = createRequire(path.resolve(__dirname, '../kasia-console/package.json'));
const Database = requireFromConsole('better-sqlite3');

const argv = process.argv.slice(2);
const opts = {
  offerId: argv.find(a => a.startsWith('--offer-id='))?.split('=')[1],
  escrowId: argv.find(a => a.startsWith('--escrow-id='))?.split('=')[1],
  status: argv.find(a => a.startsWith('--status='))?.split('=')[1],
  limit: parseInt(argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '10', 10),
};

const db = new Database(DB_PATH, { readonly: true });

// Pipeline stages per Bug H γ candidate A v2 broker-escrow custody design.
// Each stage requires (a) DB row state, (b) corresponding chain_event (if expected).
const STAGES = [
  { id: 'escrow_create', desc: 'escrow row INSERT (pending_prepay)', requires: 'escrow_row' },
  { id: 'prepay_detected', desc: 'user 真链 prepay TX detected → escrow active', requires: 'escrow_active' },
  { id: 'publish', desc: 'broker publish offer (escrow.offer_id backfilled)', requires: 'offer_id' },
  { id: 'matched', desc: 'taker accept → offer protocol_status=matched', requires: 'exchange_matched_event' },
  { id: 'paid', desc: 'taker pay TX verified → protocol_status=verifying/delivering', requires: 'exchange_paid_event' },
  { id: 'completed', desc: 'broker deliver → completed + settle escrow→user', requires: 'exchange_completed_event' },
];

function auditPipeline(escrow, offer) {
  // chain_events lookup for this offer (via txid prefix match on offer/escrow refs).
  // chain_events.event_type ∈ {exchange_matched, exchange_paid, exchange_completed, exchange_cancelled, exchange_refunded, ...}
  const events = offer ? db.prepare(`
    SELECT txid, event_type, observed_at FROM chain_events
    WHERE event_type LIKE 'exchange_%'
      AND (payload LIKE ? OR txid IN (
        SELECT DISTINCT txid FROM chain_events WHERE payload LIKE ?
      ))
    ORDER BY observed_at ASC
  `).all(`%${offer.id}%`, `%${offer.id}%`) : [];

  const evMap = {};
  for (const e of events) evMap[e.event_type] = e;

  const result = [];
  for (const stage of STAGES) {
    let pass = false, evidence = '';
    switch (stage.id) {
      case 'escrow_create':
        pass = !!escrow;
        evidence = escrow ? `id=${escrow.id.slice(0,8)} created=${escrow.created_at}` : 'MISSING';
        break;
      case 'prepay_detected':
        // detected = prepayment_tx populated (escrow advanced past pending_prepay).
        // Terminal status completed/cancelled/refunded all imply prepay happened (cancel after prepay = clean refund path).
        pass = !!escrow?.prepayment_tx;
        evidence = escrow?.prepayment_tx ? `tx=${escrow.prepayment_tx.slice(0,16)} amount_recv=${escrow.amount_received}` : (escrow?.status === 'pending_prepay' ? '(pending, no prepay yet)' : 'NO PREPAY TX');
        break;
      case 'publish':
        pass = escrow && !!escrow.offer_id && !!offer;
        evidence = offer ? `offer=${offer.id.slice(0,8)} status=${offer.protocol_status}` : (escrow?.offer_id ? `offer_id=${escrow.offer_id.slice(0,8)} BUT offer row MISSING` : 'no offer_id');
        break;
      case 'matched':
        pass = !!evMap['exchange_matched'] || ['matched', 'verifying', 'delivering', 'completed'].includes(offer?.protocol_status || '');
        evidence = evMap['exchange_matched'] ? `tx=${evMap['exchange_matched'].txid.slice(0,16)} @ ${evMap['exchange_matched'].observed_at}` : (offer?.taker ? `taker=${offer.taker.slice(0,12)}... (no chain_event)` : '(no match)');
        break;
      case 'paid':
        pass = !!evMap['exchange_paid'] || ['verifying', 'delivering', 'completed'].includes(offer?.protocol_status || '');
        evidence = evMap['exchange_paid'] ? `tx=${evMap['exchange_paid'].txid.slice(0,16)} @ ${evMap['exchange_paid'].observed_at}` : '(no paid event)';
        break;
      case 'completed':
        pass = !!evMap['exchange_completed'] || offer?.protocol_status === 'completed';
        evidence = evMap['exchange_completed'] ? `tx=${evMap['exchange_completed'].txid.slice(0,16)} @ ${evMap['exchange_completed'].observed_at}` : `(status=${offer?.protocol_status || '-'})`;
        break;
    }
    result.push({ ...stage, pass, evidence });
  }

  // Terminal status — refunded/cancelled/expired are valid terminals (not failures).
  const isTerminal = ['completed', 'refunded', 'cancelled', 'expired'].includes(offer?.protocol_status) || ['refunded', 'cancelled'].includes(escrow?.status);
  const terminalLabel = offer?.protocol_status || escrow?.status || 'unknown';

  return { escrow, offer, events, stages: result, isTerminal, terminalLabel };
}

function printAudit(a) {
  console.log('═'.repeat(80));
  console.log(`escrow ${a.escrow?.id?.slice(0,8) || '-'} ↔ offer ${a.offer?.id?.slice(0,8) || '-'}`);
  console.log(`  ${a.escrow?.side || '?'} ${a.escrow?.target_amount || '?'} KAS via ${a.escrow?.chain || '?'} — terminal=${a.terminalLabel}`);
  console.log('───');
  for (const s of a.stages) {
    const mark = s.pass ? '✓' : (a.isTerminal && ['matched','paid','completed'].includes(s.id) ? '·' : '✗');
    console.log(`  ${mark} ${s.desc}`);
    console.log(`     ${s.evidence}`);
  }
  // Verdict: PASS if either reached completed OR terminated cleanly (refunded/cancelled/expired).
  const completedReached = a.stages.find(s => s.id === 'completed')?.pass;
  const verdict = completedReached ? '✓ FULL COMPLETION'
    : (a.isTerminal ? `✓ CLEAN TERMINAL (${a.terminalLabel})`
    : `⏳ IN-FLIGHT (${a.terminalLabel})`);
  console.log(`  → ${verdict}`);
}

// Main
let escrows = [];
if (opts.offerId) {
  const off = db.prepare('SELECT * FROM exchange_offers WHERE id = ? OR id LIKE ?').get(opts.offerId, `${opts.offerId}%`);
  if (!off) { console.error(`offer ${opts.offerId} not found`); process.exit(1); }
  const esc = db.prepare('SELECT * FROM user_escrow_balances WHERE offer_id = ?').get(off.id);
  escrows = [{ escrow: esc, offer: off }];
} else if (opts.escrowId) {
  const esc = db.prepare('SELECT * FROM user_escrow_balances WHERE id = ? OR id LIKE ?').get(opts.escrowId, `${opts.escrowId}%`);
  if (!esc) { console.error(`escrow ${opts.escrowId} not found`); process.exit(1); }
  const off = esc.offer_id ? db.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(esc.offer_id) : null;
  escrows = [{ escrow: esc, offer: off }];
} else {
  const where = opts.status ? `WHERE eo.protocol_status = '${opts.status}'` : '';
  const rows = db.prepare(`
    SELECT ueb.id FROM user_escrow_balances ueb
    LEFT JOIN exchange_offers eo ON eo.id = ueb.offer_id
    ${where}
    ORDER BY ueb.created_at DESC LIMIT ?
  `).all(opts.limit);
  for (const r of rows) {
    const esc = db.prepare('SELECT * FROM user_escrow_balances WHERE id = ?').get(r.id);
    const off = esc.offer_id ? db.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(esc.offer_id) : null;
    escrows.push({ escrow: esc, offer: off });
  }
}

if (!escrows.length) { console.log('No matching escrow/offer pairs.'); process.exit(0); }

console.log(`\nAuditing ${escrows.length} pipeline(s)...\n`);
let completed = 0, terminal = 0, inflight = 0;
for (const pair of escrows) {
  const a = auditPipeline(pair.escrow, pair.offer);
  printAudit(a);
  const completedHit = a.stages.find(s => s.id === 'completed')?.pass;
  if (completedHit) completed++;
  else if (a.isTerminal) terminal++;
  else inflight++;
}
console.log('═'.repeat(80));
console.log(`\nSummary: ${completed} completed / ${terminal} clean-terminal / ${inflight} in-flight (of ${escrows.length}).`);
process.exit(0);
