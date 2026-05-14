#!/usr/bin/env node
// _audit_offer_5_fields.mjs — Bug H γ Sub #8 (NWT 11:36 v4 §改造1 + 12:12 audit automation propose)
//
// Audit exchange offers + user_escrow_balances 5 字段 alignment per case:
//   1. offer.maker — 是真 user 还 broker addr?
//   2. offer.taker — accept 后是真 taker addr 还 broker (Bug F surface 现 mode)?
//   3. offer.verification_meta.accepted_chains[0].address — broker addr OR user addr?
//   4. fund_locks.address (if exists) — broker OR user fund?
//   5. user_escrow_balances row — exists for escrow-backed offer? status correct?
//   6. relay_nodes — user registered local OR remote-only?
//
// Usage:
//   node scripts/_audit_offer_5_fields.mjs                          # 列最近 10 active offers
//   node scripts/_audit_offer_5_fields.mjs --offer-id=<uuid>        # 单 offer 详查
//   node scripts/_audit_offer_5_fields.mjs --user=<kasia-addr>      # 按 user 查 (含 escrow)
//   node scripts/_audit_offer_5_fields.mjs --escrow-only            # 只查 escrow-backed offers
//
// Output: 5-field table per offer + audit verdict (PASS / mismatch flags).

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../kasia-console/data/console.db');

// Use createRequire to resolve better-sqlite3 from kasia-console's node_modules
// (script lives in /scripts but DB tooling is in kasia-console workspace).
const requireFromConsole = createRequire(path.resolve(__dirname, '../kasia-console/package.json'));
const Database = requireFromConsole('better-sqlite3');

const argv = process.argv.slice(2);
const opts = {
  offerId: argv.find(a => a.startsWith('--offer-id='))?.split('=')[1],
  user: argv.find(a => a.startsWith('--user='))?.split('=')[1],
  escrowOnly: argv.includes('--escrow-only'),
  limit: parseInt(argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '10', 10),
};

const db = new Database(DB_PATH, { readonly: true });

function audit5Fields(offer) {
  const meta = (() => { try { return JSON.parse(offer.verification_meta || '{}'); } catch { return {}; } })();
  const offerMeta = (() => { try { return JSON.parse(offer.metadata || '{}'); } catch { return {}; } })();
  const isEscrow = offerMeta.source === 'broker-v3-escrow' || !!meta.escrow_id;

  // Lookup maker relay
  const makerRelay = db.prepare('SELECT id, name, role FROM relay_nodes WHERE address = ?').get(offer.maker);
  // Lookup escrow row if escrow-backed
  const escrowRow = isEscrow && meta.escrow_id ? db.prepare('SELECT * FROM user_escrow_balances WHERE id = ?').get(meta.escrow_id) : null;
  // Lookup fund_lock (if exists)
  let fundLock = null;
  try { fundLock = db.prepare('SELECT address, asset, amount, status FROM fund_locks WHERE order_id = ?').get(offer.id); } catch {}

  // Audit field 1: maker
  const f1 = {
    field: 'offer.maker',
    value: offer.maker,
    classified: makerRelay ? `relay=${makerRelay.name} (role=${makerRelay.role || 'unknown'})` : 'unregistered/external',
  };

  // Audit field 2: taker
  const f2 = {
    field: 'offer.taker',
    value: offer.taker || '(null, not yet accepted)',
    classified: offer.taker
      ? (() => {
          const takerRelay = db.prepare('SELECT name FROM relay_nodes WHERE address = ?').get(offer.taker);
          const takerWallet = db.prepare('SELECT chain FROM agent_wallets WHERE address = ?').get(offer.taker);
          if (takerRelay) return `relay=${takerRelay.name}`;
          if (takerWallet) return `EVM/Kaspa wallet (chain=${takerWallet.chain})`;
          return 'external EVM addr OR unregistered';
        })()
      : '',
  };

  // Audit field 3: accepted_chains[0].address
  const acceptedAddr = meta.accepted_chains?.[0]?.address;
  const f3 = {
    field: 'verification_meta.accepted_chains[0].address',
    value: acceptedAddr || '(missing)',
    classified: acceptedAddr ? (() => {
      if (acceptedAddr === offer.maker) return 'maker_relay_addr (broker for escrow mode)';
      if (escrowRow && acceptedAddr === escrowRow.user_target_addr) return 'user_target_addr (escrow path)';
      const brokerWallet = db.prepare('SELECT relay_node_id FROM agent_wallets WHERE address = ?').get(acceptedAddr);
      if (brokerWallet) return `broker EVM wallet (relay=${brokerWallet.relay_node_id?.slice(0,8)})`;
      return 'unknown — external EVM addr';
    })() : '',
  };

  // Audit field 4: fund_locks
  const f4 = {
    field: 'fund_locks',
    value: fundLock ? `${fundLock.amount} ${fundLock.asset} @ ${fundLock.address?.slice(-12)} (status=${fundLock.status})` : '(none)',
    classified: fundLock?.address === offer.maker ? 'locked by maker (broker)' : (fundLock ? 'locked by other' : '-'),
  };

  // Audit field 5: escrow_balances + relay_nodes
  const f5 = {
    field: 'escrow_balance + user relay',
    value: '',
    classified: '',
  };
  if (isEscrow) {
    if (!escrowRow) {
      f5.value = `MISSING — meta.escrow_id=${meta.escrow_id?.slice(0,8)} but no row`;
      f5.classified = '⚠ orphan offer (escrow row deleted OR never created)';
    } else {
      const userRelay = db.prepare('SELECT name FROM relay_nodes WHERE address = ?').get(escrowRow.user_kasia_addr);
      f5.value = `escrow_id=${escrowRow.id.slice(0,8)} status=${escrowRow.status} prepay_tx=${escrowRow.prepayment_tx?.slice(0,16) || '(pending)'}`;
      f5.classified = userRelay ? `user=${userRelay.name} (local relay)` : `user=external (no local relay)`;
    }
  } else {
    f5.value = '(non-escrow offer, legacy broker-as-market-maker)';
    f5.classified = '-';
  }

  // Verdict
  const flags = [];
  if (isEscrow && !escrowRow) flags.push('ORPHAN_ESCROW');
  if (offer.taker === offer.maker) flags.push('SELF_DEAL (maker===taker)');
  if (!acceptedAddr) flags.push('MISSING_ACCEPTED_CHAIN');
  const verdict = flags.length === 0 ? '✓ PASS' : `⚠ ${flags.join(' / ')}`;

  return { offer, isEscrow, escrowRow, fields: [f1, f2, f3, f4, f5], verdict };
}

function printAudit(a) {
  console.log('═'.repeat(80));
  console.log(`offer ${a.offer.id} (status=${a.offer.protocol_status}, escrow=${a.isEscrow ? 'YES' : 'no'})`);
  console.log(`  ${a.offer.give_amount} ${a.offer.give_asset} → ${a.offer.want_amount} ${a.offer.want_asset} (${a.offer.want_chain || '-'})`);
  console.log(`  created: ${a.offer.created_at} | expires: ${a.offer.expires_at}`);
  console.log('───');
  for (const f of a.fields) {
    console.log(`  [${f.field}]`);
    console.log(`    value: ${f.value}`);
    console.log(`    classified: ${f.classified}`);
  }
  console.log(`  ${a.verdict}`);
}

// Main
let offers = [];
if (opts.offerId) {
  const r = db.prepare('SELECT * FROM exchange_offers WHERE id = ? OR id LIKE ?').get(opts.offerId, `${opts.offerId}%`);
  if (r) offers = [r];
  else { console.error(`offer ${opts.offerId} not found`); process.exit(1); }
} else if (opts.user) {
  offers = db.prepare(`
    SELECT eo.* FROM exchange_offers eo
    LEFT JOIN user_escrow_balances ueb ON ueb.offer_id = eo.id
    WHERE eo.maker = ? OR ueb.user_kasia_addr = ?
       OR JSON_EXTRACT(eo.metadata, '$.user_id') = ?
    ORDER BY eo.created_at DESC LIMIT ?
  `).all(opts.user, opts.user, opts.user, opts.limit);
} else if (opts.escrowOnly) {
  offers = db.prepare(`
    SELECT eo.* FROM exchange_offers eo
    INNER JOIN user_escrow_balances ueb ON ueb.offer_id = eo.id
    ORDER BY eo.created_at DESC LIMIT ?
  `).all(opts.limit);
} else {
  offers = db.prepare(`
    SELECT * FROM exchange_offers
    WHERE protocol_status NOT IN ('expired', 'cancelled')
    ORDER BY created_at DESC LIMIT ?
  `).all(opts.limit);
}

if (!offers.length) {
  console.log('No matching offers found.');
  process.exit(0);
}

console.log(`\nAuditing ${offers.length} offer(s)...\n`);
let pass = 0, flagged = 0;
for (const o of offers) {
  const a = audit5Fields(o);
  printAudit(a);
  if (a.verdict.startsWith('✓')) pass++;
  else flagged++;
}
console.log('═'.repeat(80));
console.log(`\nVerdict: ${pass}/${offers.length} PASS, ${flagged} flagged.`);
process.exit(flagged > 0 ? 1 : 0);
