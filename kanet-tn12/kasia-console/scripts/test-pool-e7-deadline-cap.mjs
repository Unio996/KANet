// B2 v0.5 area-8 E7 regression — pool market deadline hard cap.
//
// Without an upper bound, a maker can lock funds for 100 years. Hard cap defaults to 30 days
// (testnet) and is env-tunable via POOL_DEADLINE_MAX_DAY (mainnet expected 365). Super-long
// horizon markets are deferred to Phase 5.
//
// Faithful test — runs the EXACT predicate from pool.js create endpoint.
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

const DAY_MS = 86400_000;

// EXACT predicate from pool.js create:
const cap = (envValue, outcomeEndDate, nowMs) => {
  const maxDeadlineDay = parseInt(envValue, 10) || 30;
  const outcomeEndMs = new Date(outcomeEndDate).getTime();
  return outcomeEndMs <= nowMs + maxDeadlineDay * DAY_MS;
};

const now = Date.now();

// Default 30 day cap (env not set)
ok(cap(undefined, new Date(now + 1 * DAY_MS).toISOString(), now) === true, 'default 30d: 1 day out → accepted');
ok(cap(undefined, new Date(now + 29 * DAY_MS).toISOString(), now) === true, 'default 30d: 29 days out → accepted');
ok(cap(undefined, new Date(now + 31 * DAY_MS).toISOString(), now) === false, 'default 30d: 31 days out → rejected');
ok(cap(undefined, new Date(now + 365 * DAY_MS).toISOString(), now) === false, 'default 30d: 1 year out → rejected');
ok(cap(undefined, new Date(now + 100 * 365 * DAY_MS).toISOString(), now) === false, 'default 30d: 100 years out → rejected');

// env-tuned 365 (mainnet default)
ok(cap('365', new Date(now + 90 * DAY_MS).toISOString(), now) === true, 'env 365d: 90 days out → accepted');
ok(cap('365', new Date(now + 364 * DAY_MS).toISOString(), now) === true, 'env 365d: 364 days out → accepted');
ok(cap('365', new Date(now + 400 * DAY_MS).toISOString(), now) === false, 'env 365d: 400 days out → rejected');

// env edge cases
ok(cap('abc', new Date(now + 1 * DAY_MS).toISOString(), now) === true, 'env "abc" (NaN) → falls back to default 30d');
ok(cap('0', new Date(now + 1 * DAY_MS).toISOString(), now) === true, 'env "0" (parseInt 0, falsy) → falls back to default 30d');
ok(cap('1', new Date(now + 0.5 * DAY_MS).toISOString(), now) === true, 'env "1": 12h out → accepted');
ok(cap('1', new Date(now + 2 * DAY_MS).toISOString(), now) === false, 'env "1": 2 days out → rejected');

console.log(`\ntest-pool-e7-deadline-cap: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
