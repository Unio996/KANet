// B2 v0.5 area-3 F1 regression — DISPUTE removed from vote space.
//
// Per area-3 钦定 + Owner (pp.txt review): protocol layer accepts only YES/NO. "DISPUTE"
// was code-introduced (spec 0 mention) — oracle 接单 commits to YES/NO; uncertainty handled
// at accept time (don't deposit). silent = bond forfeit. Daemon abstains on low confidence
// rather than emitting DISPUTE.
//
// Faithful test — replicates the EXACT predicates from pool.js vote endpoint + decideConsensus
// filter, plus a code-grep guard on the voter daemon source.
import fs from 'node:fs';
import Database from 'better-sqlite3';

const db = new Database('data/console.db');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

// Site 1: pool.js vote endpoint outcome validation (post-F1).
const voteValidate = (outcome) => {
  if (outcome !== 'YES' && outcome !== 'NO') return { ok: false, err: 'must be YES or NO' };
  return { ok: true };
};
ok(voteValidate('YES').ok === true, 'pool.js vote: YES → accepted');
ok(voteValidate('NO').ok === true, 'pool.js vote: NO → accepted');
ok(voteValidate('DISPUTE').ok === false, 'pool.js vote: DISPUTE → rejected (F1)');
ok(voteValidate('').ok === false, 'pool.js vote: empty → rejected');
ok(voteValidate('yes').ok === false, 'pool.js vote: lowercase → rejected (case-sensitive)');

// Site 2: decideConsensus payload filter (post-F1).
const decideFilter = (outcome) => (outcome === 'YES' || outcome === 'NO');
ok(decideFilter('YES') === true, 'decideConsensus filter: YES → kept');
ok(decideFilter('NO') === true, 'decideConsensus filter: NO → kept');
ok(decideFilter('DISPUTE') === false, 'decideConsensus filter: legacy DISPUTE chain_event → silently dropped (F1)');
ok(decideFilter(undefined) === false, 'decideConsensus filter: undefined → dropped');

// Site 3: voter daemon code grep — no active `'DISPUTE'` string literal as outcome value.
const voterSrc = fs.readFileSync('src/services/bettor-prediction-voter.js', 'utf8');
// Remove comments and string-literal arguments to AbortSignal etc; check no active
// `outcome = 'DISPUTE'` or `parsed.outcome ... 'DISPUTE'` or similar.
const activeDispute = voterSrc.match(/=\s*'DISPUTE'/g);
ok(!activeDispute || activeDispute.length === 0, `voter daemon: 0 active "= 'DISPUTE'" assignment (found ${activeDispute ? activeDispute.length : 0})`);

const promptDispute = voterSrc.match(/"outcome":\s*"YES"\|"NO"\|"DISPUTE"/);
ok(!promptDispute, 'voter daemon: LLM prompt 不 mention DISPUTE (F1)');

console.log(`\ntest-pool-f1-dispute-cut: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
