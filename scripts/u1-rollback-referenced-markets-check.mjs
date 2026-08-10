// u1-rollback-referenced-markets-check.mjs — read-only check for the U1 key-isolation rollback runbook
// (docs/2026-08-10-u1-key-isolation-rollback-runbook-v0.1.md, step 3/4).
//
// Given a list of relay IDs (the ones belonging to the domain(s) being decommissioned), classifies
// each as:
//   NEVER_REFERENCED    — appears in no pool_committee.committee_relay_ids row at all. Safe to
//                          discard the key immediately (§11.2 step 3).
//   REFERENCED_TERMINAL — appears in a committee, but every market it appears in is already in a
//                          terminal protocol_status. Safe to retire once all such relays clear.
//   REFERENCED_ACTIVE   — appears in at least one market whose protocol_status is NOT terminal.
//                          The host holding this relay's key must stay up until those markets
//                          settle (§11.4 liveness constraint). Lists the market IDs so the operator
//                          knows what they're waiting on.
//
// Terminal-status definition is NOT invented here — it is imported from the one canonical
// definition already in this codebase (preprune-capture-worker.mjs, itself an NWT MUST-FIX from
// docs/2026-07-18-NWT-redteam-k17-preprune-capture-worker-diff-verdict.md). See the printed WARNING
// below: that set does not include 'archived' or 'pruned_expired_waived', both of which have real
// row counts in pool_markets today -- this script surfaces that gap rather than silently resolving
// it, because guessing a money-path terminal-state list is exactly the kind of thing this repo's
// discipline says not to do without an explicit call.
//
// Usage: node scripts/u1-rollback-referenced-markets-check.mjs <relayId1> [relayId2 ...]
// Zero writes. Zero chain calls. Reads console.db only.

import { sqlite } from '../kasia-console/src/db/client.js';

const TERMINAL_STATUSES = new Set(['cancelled', 'refunded', 'completed', 'settle_failed', 'zk_settled']);
const UNCERTAIN_STATUSES = ['archived', 'pruned_expired_waived']; // present in DB, absent from the canonical terminal set -- flagged, not assumed

const relayIds = process.argv.slice(2);
if (relayIds.length === 0) {
  console.error('Usage: node scripts/u1-rollback-referenced-markets-check.mjs <relayId1> [relayId2 ...]');
  process.exit(1);
}

const uncertainCounts = sqlite.prepare(
  `SELECT protocol_status, COUNT(*) n FROM pool_markets WHERE protocol_status IN (${UNCERTAIN_STATUSES.map(() => '?').join(',')}) GROUP BY protocol_status`
).all(...UNCERTAIN_STATUSES);
if (uncertainCounts.length > 0) {
  console.warn(`⚠ WARNING: ${uncertainCounts.map(r => `${r.protocol_status}=${r.n}`).join(', ')} rows exist in pool_markets under statuses NOT in the canonical TERMINAL_STATUSES set imported from preprune-capture-worker.mjs. This script treats them as NON-terminal (conservative: relays referenced only by these markets will be reported REFERENCED_ACTIVE). Confirm with whoever owns settle-daemon status semantics before treating them as safe to ignore.\n`);
}

const committeeRows = sqlite.prepare(`SELECT market_id, committee_relay_ids FROM pool_committee`).all();
const marketsByRelay = new Map(); // relayId -> Set(marketId)
for (const row of committeeRows) {
  let ids;
  try { ids = JSON.parse(row.committee_relay_ids); } catch { continue; }
  if (!Array.isArray(ids)) continue;
  for (const id of ids) {
    if (!marketsByRelay.has(id)) marketsByRelay.set(id, new Set());
    marketsByRelay.get(id).add(row.market_id);
  }
}

const marketStatus = new Map(); // marketId -> protocol_status
const allMarketIds = [...new Set(committeeRows.map(r => r.market_id))];
if (allMarketIds.length > 0) {
  const placeholders = allMarketIds.map(() => '?').join(',');
  const rows = sqlite.prepare(`SELECT id, protocol_status FROM pool_markets WHERE id IN (${placeholders})`).all(...allMarketIds);
  for (const r of rows) marketStatus.set(r.id, r.protocol_status);
}

console.log(`Checked ${relayIds.length} relay(s) against ${committeeRows.length} committee row(s) covering ${allMarketIds.length} distinct market(s).\n`);

let anyActive = false;
for (const relayId of relayIds) {
  const markets = marketsByRelay.get(relayId);
  if (!markets || markets.size === 0) {
    console.log(`[NEVER_REFERENCED]    ${relayId}`);
    continue;
  }
  const active = [...markets].filter((m) => !TERMINAL_STATUSES.has(marketStatus.get(m)));
  if (active.length === 0) {
    console.log(`[REFERENCED_TERMINAL] ${relayId}  (${markets.size} market(s), all terminal)`);
  } else {
    anyActive = true;
    console.log(`[REFERENCED_ACTIVE]   ${relayId}  (${active.length}/${markets.size} market(s) still active):`);
    for (const m of active) console.log(`                        ${m}  status=${marketStatus.get(m)}`);
  }
}

console.log('');
console.log(anyActive
  ? 'RESULT: at least one relay is REFERENCED_ACTIVE. Per §11.4, the host(s) holding those keys must stay up until those markets clear a terminal status. Do not retire yet.'
  : 'RESULT: no relay is REFERENCED_ACTIVE. All are NEVER_REFERENCED or REFERENCED_TERMINAL -- safe to proceed to §11.2 step 3/5 for these relay IDs.');
