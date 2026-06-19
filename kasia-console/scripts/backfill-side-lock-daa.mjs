#!/usr/bin/env node
// backfill-side-lock-daa.mjs — J1 #27a v2 (Owner hardening sprint 2026-06-14, NWT r1181 single-source).
//
// WHY: #27a v2 added pool_bettor_sides.side_lock_daa (v170) so the committee bettor-exclude set can chain-anchor
// to side_lock_daa <= deadline_daa. Bets ingested BEFORE v170 have side_lock_daa = NULL. At sample time #27a
// fail-louds on NULL → those in-flight markets would batch (c)-refund (Q2-scale problem this sprint exists to fix).
// This one-shot backfill fills side_lock_daa for every NULL-daa bet in a non-terminal market, from the chain.
//
// CANONICAL: reuses captureSideLockDaa() — the SAME fn the live bet ingest calls — so a backfilled daa is
// byte-equal to what a fresh ingest would have written. NWT r1181 mandate: NO local time/guess (that breaks
// determinism). Each node runs this independently; both query their own chain and get the same canonical daa.
//
// SAFE: idempotent (UPDATE ... WHERE side_lock_daa IS NULL only), read-only on chain, never deletes/refunds.
//   --dry-run : report what WOULD be filled, write nothing.
//
// RUN (from kasia-console dir, on EACH node): node scripts/backfill-side-lock-daa.mjs [--dry-run]
//
// SEQUENCE (KANet-UI operator, batch2): migrate (adds v170 column) → THIS backfill → verify NULL-daa count → restart.

import { sqlite } from '../src/db/client.js';
import { captureSideLockDaa } from '../src/services/trade-protocol-filter.js';

const DRY_RUN = process.argv.includes('--dry-run');

// Non-terminal markets only — terminal (completed/cancelled/refunded/refunding/disputed) never re-sample, skip.
// pending_bettors will reach `verifying` (sample) later, so their NULL-daa bets need backfill now too.
const NON_TERMINAL = ['pending_bettors', 'verifying', 'collecting_sigs', 'pending_oracle_deposits'];

const rows = sqlite.prepare(`
  SELECT s.id AS side_id, s.market_id, s.side_p2sh, s.side_lock_tx, s.stake_amount,
         m.spine_p2sh, m.protocol_status
  FROM pool_bettor_sides s
  JOIN pool_markets m ON m.id = s.market_id
  WHERE s.side_lock_daa IS NULL
    AND m.protocol_status IN (${NON_TERMINAL.map(() => '?').join(',')})
  ORDER BY s.market_id, s.id
`).all(...NON_TERMINAL);

const upd = sqlite.prepare('UPDATE pool_bettor_sides SET side_lock_daa = ? WHERE id = ? AND side_lock_daa IS NULL');

console.log(`[backfill-daa] ${DRY_RUN ? '(DRY-RUN) ' : ''}NULL-daa bets in non-terminal markets: ${rows.length}`);
if (rows.length === 0) { console.log('[backfill-daa] nothing to do — all in-flight bets already have side_lock_daa.'); process.exit(0); }

const stat = { ok: 0, settled: 0, rpcFail: 0, unresolved: 0 };
const stillNull = [];   // bets that remain NULL (would fail-loud at sample) — surfaced for operator follow-up

for (const r of rows) {
  const network = String(r.spine_p2sh || '').startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
  let cap;
  try {
    cap = await captureSideLockDaa({
      side_p2sh: r.side_p2sh, side_lock_tx: r.side_lock_tx, stake_amount: r.stake_amount, network,
    });
  } catch (e) {
    cap = { daa: null, reason: `rpc-fail: ${e.message}` };
  }
  const m12 = String(r.market_id).slice(0, 12), tx16 = String(r.side_lock_tx).slice(0, 16);

  if (cap.daa !== null && cap.reason === 'ok') {
    if (!DRY_RUN) upd.run(cap.daa, r.side_id);
    stat.ok++;
    console.log(`[backfill-daa] ${DRY_RUN ? 'WOULD fill' : 'filled  '} market=${m12} bet=${r.side_id} tx=${tx16} daa=${cap.daa}`);
  } else if (cap.reason === 'no-unspent-utxo') {
    // UTXO spent or never paid. For a non-terminal market this bet is not an open position on chain →
    // it will not be in the eligible pool either; leaving NULL is safe (it isn't a live committee member).
    stat.settled++;
    console.log(`[backfill-daa] skip(settled/unpaid) market=${m12} bet=${r.side_id} tx=${tx16}`);
  } else if (String(cap.reason).startsWith('rpc-fail') || cap.reason === 'no-rpc') {
    stat.rpcFail++;
    stillNull.push({ ...r, reason: cap.reason });
    console.warn(`[backfill-daa] RPC-FAIL market=${m12} bet=${r.side_id} tx=${tx16} — ${cap.reason} (re-run to retry)`);
  } else { // daa-unresolved: UTXO found but daaScore shape unknown — must NOT guess (determinism)
    stat.unresolved++;
    stillNull.push({ ...r, reason: cap.reason });
    console.warn(`[backfill-daa] UNRESOLVED market=${m12} bet=${r.side_id} tx=${tx16} — daa not readable from UTXO`);
  }
}

console.log(`\n[backfill-daa] ${DRY_RUN ? '(DRY-RUN) ' : ''}done: filled=${stat.ok} skip-settled=${stat.settled} rpc-fail=${stat.rpcFail} unresolved=${stat.unresolved}`);

// TRUE end-state check (NOT "did the op run" — does the GOAL hold), scoped per NWT r1190 determinism ruling.
// #27a fail-louds on ANY NULL row (settler L351-354) — BUT ONLY when a market actually re-samples.
// sampleAndStoreCommittee runs only for markets WITHOUT a cached committee (no pool_committee row); a market
// with a cached committee settles from that committee and NEVER re-checks bet daa → its NULL bets are harmless.
// So the TRUE at-risk set = UNCACHED non-terminal markets (will re-sample) that still have a NULL bet.
// (A "filled=N, exit 0" op success would hide this; and counting ALL NULL markets over-counts the cached-safe ones.)
const ph = NON_TERMINAL.map(() => '?').join(',');
const nullMarkets = sqlite.prepare(`
  SELECT m.id, m.protocol_status, COUNT(*) AS null_bets,
         EXISTS(SELECT 1 FROM pool_committee pc WHERE pc.market_id = m.id) AS cached
  FROM pool_markets m JOIN pool_bettor_sides s ON s.market_id = m.id
  WHERE s.side_lock_daa IS NULL AND m.protocol_status IN (${ph})
  GROUP BY m.id ORDER BY cached ASC, m.protocol_status, null_bets DESC
`).all(...NON_TERMINAL);
const atRisk = nullMarkets.filter(m => !m.cached);   // will re-sample → NULL fail-loud → refund
const cachedSafe = nullMarkets.filter(m => m.cached); // cached committee → never re-sample → NULL never checked (NWT r1190)

if (DRY_RUN) {
  console.log(`[backfill-daa] (DRY-RUN) wrote nothing; counts below reflect PRE-fill — re-run without --dry-run to apply, then re-check.`);
}
if (cachedSafe.length) {
  console.log(`[backfill-daa] ℹ ${cachedSafe.length} non-terminal markets have a NULL bet but a CACHED committee → never re-sample → #27a never checks them → SAFE (settle from cached committee, NWT r1190).`);
}
if (atRisk.length === 0) {
  console.log('[backfill-daa] ✅ no UNCACHED non-terminal market has a NULL-daa bet — no market will fail-loud at sample. All clean.');
} else {
  console.warn(`[backfill-daa] ⚠ ${atRisk.length} UNCACHED non-terminal markets STILL have a NULL-daa bet → they WILL re-sample → #27a fail-loud → (c)-refund the WHOLE market.`);
  console.warn(`[backfill-daa]   cause = spent-UTXO bets (closed/stale positions) whose daa is not recoverable via getUtxosByAddresses (UNSPENT-only).`);
  console.warn(`[backfill-daa]   ⚠ DETERMINISM-SAFE: every node leaves the SAME spent-UTXO NULL set → identical fail-loud → identical refund, NO fork. = accepted mid-flight legacy refund (NWT r1190/r1191, Bettor concur), not a bug.`);
  for (const m of atRisk.slice(0, 25)) console.warn(`      ${m.protocol_status} market=${String(m.id).slice(0,24)} null_bets=${m.null_bets}`);
  if (atRisk.length > 25) console.warn(`      ... +${atRisk.length - 25} more`);
}

// rpc-fail = transient → exit 2 so a re-run is signalled. unresolved (UTXO found, daa shape unknown) = investigate.
if (stat.rpcFail > 0 || stat.unresolved > 0) {
  console.warn(`[backfill-daa] ⚠ ${stat.rpcFail} rpc-fail (re-run to retry) + ${stat.unresolved} unresolved (investigate). Detail:`);
  for (const s of stillNull) console.warn(`    market=${String(s.market_id).slice(0,16)} bet=${s.side_id} reason=${s.reason}`);
  process.exit(2);
}
process.exit(0);
