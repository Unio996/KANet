// #10 counting-regression harness — scaffold (task#33 fallout, 2026-07-03 Bettor 派工).
//
// Background: #33 proved `settle_evidence.winners` (bshard-settle-daemon.mjs pre-fix) counted
// ANY claim attempt with a txId, including failed-but-landed-tx entries (not-landed / splice-
// mismatch). 21 markets flagged as possible under-pays off that field; the field itself cannot
// be used as ground truth for "how many winners actually got paid" — that's the whole bug.
//
// Scope of THIS file: lock the counting-SOURCE-OF-TRUTH invariant as a static regression guard —
// no code path may report a "winners paid" count sourced from evidence.winners /
// settle_evidence.winners / any pre-#33 raw claims.length. It must come from the corrected
// fields settleMarketLive() now emits: `complete` (bool) + `expected_winners` (int) +
// `attempted` (int), or from a fresh chain re-derivation (never a stored count field verbatim).
//
// What's PENDING (do NOT fill until ready — see #33 retroactive chain-verify, owner=NWT):
//   - Per-market golden values for the 21 flagged markets (real winner count from on-chain
//     claim TXs, independently re-derived). Once NWT lands those, add fixtures below asserting
//     each flagged market_id's TRUE winner count against a fresh chain re-derivation — never
//     against evidence.winners itself (that would be circular / self-certifying the bug).
//   - A live "recompute vs display" comparator harness (query real settled markets, recompute
//     landed-claim count from kaspa_tx_log independently, diff against whatever the UI/bot/
//     canary-stats currently displays) — this is the piece that answers Owner's "why did the
//     number change" question by classifying divergence as display-bug (UI reads a stale/wrong
//     field but underlying settle_evidence.complete/expected_winners/attempted are correct) vs
//     data-corruption (the stored fields themselves don't match on-chain reality). Needs #33's
//     golden values to have something authoritative to diff against — blocked until then.
//
// Run: `node counting_source_of_truth_regression.test.mjs` from this directory.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// pool/ -> predictions/ -> cases/ -> test-framework/ -> kasia-console/ -> repo root
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SRC_DIR = join(REPO_ROOT, 'kasia-console', 'src');

// Static guard (pure Node walk, no shell-out — grep isn't on PATH by default on Windows):
// scan production src for the banned pattern (evidence.winners used as a "winners paid" count
// OUTSIDE the one place that's allowed to compute it — the settleMarketLive `complete`
// derivation itself, which is the source of truth, not a consumer of it).
function grepBannedPattern() {
  const pattern = /evidence\.winners\b/;
  const hits = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.(m?js)$/.test(name)) continue;
      const lines = readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => { if (pattern.test(line)) hits.push(`${p}:${i + 1}:${line.trim()}`); });
    }
  }
  walk(SRC_DIR);
  return hits;
}

const hits = grepBannedPattern();
// Known-safe: the writer-side log line in bshard-settle-daemon.mjs that filters
// (c.txId && c.received === true && !c.error) before counting — that IS the corrected logic,
// not a consumer trusting the raw field. Anything else touching evidence.winners is a regression.
const unexpected = hits.filter(h => !h.includes('bshard-settle-daemon.mjs'));
assert.equal(unexpected.length, 0,
  `counting-source-of-truth regression: found evidence.winners usage outside the known-fixed ` +
  `writer (bshard-settle-daemon.mjs): ${JSON.stringify(unexpected)}`);

console.log(`✅ counting_source_of_truth_regression: no evidence.winners consumers outside the fixed writer (${hits.length} total hit(s), all expected).`);
console.log('⏳ PENDING (blocked on #33 NWT retroactive chain-verify): per-market golden-value fixtures + live recompute-vs-display comparator. Scaffold only — see file header.');
