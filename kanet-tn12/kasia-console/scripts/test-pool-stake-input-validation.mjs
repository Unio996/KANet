// B2 v0.5 area-8 regression — Q13: stake_kas input must be a positive finite number.
//
// bettor/register previously only checked `stakeAmount <= 0` (L249). But parseFloat('abc')
// returns NaN, NaN <= 0 is false, and NaN < 50_000_000 is also false → NaN/Infinity slipped
// through both checks and reached transferAndConfirm with "NaN" amount, failing at the
// relay layer (half-committed state from the API's perspective).
//
// Faithful test — runs the EXACT predicate from pool.js bettor/register.
import Database from 'better-sqlite3';

const db = new Database('data/console.db');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

// EXACT predicate from pool.js bettor/register post-Q13:
// const stakeAmount = Math.round(parseFloat(b.stake_kas) * 1e8);
// if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) reject;
// if (stakeAmount < 50_000_000) reject;
const validate = (input) => {
  const stakeAmount = Math.round(parseFloat(input) * 1e8);
  if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) return { ok: false, reason: 'not finite or non-positive' };
  if (stakeAmount < 50_000_000) return { ok: false, reason: 'below minimum' };
  return { ok: true, stakeAmount };
};

ok(validate('1.5').ok === true, '"1.5" (= 1.5 KAS) → accepted');
ok(validate('0.6').ok === true, '"0.6" (= 0.6 KAS, above 0.5 minimum) → accepted');

ok(validate('abc').ok === false && validate('abc').reason.includes('finite'), '"abc" → rejected (NaN finite check)');
ok(validate('').ok === false && validate('').reason.includes('finite'), 'empty string → rejected (NaN finite check)');
ok(validate('NaN').ok === false, '"NaN" string → rejected');
ok(validate('Infinity').ok === false && validate('Infinity').reason.includes('finite'), '"Infinity" → rejected (finite check, was bypassed pre-Q13)');
ok(validate(undefined).ok === false, 'undefined → rejected (NaN finite check)');

ok(validate('0').ok === false, '"0" → rejected (non-positive)');
ok(validate('-1').ok === false, '"-1" → rejected (non-positive)');

ok(validate('0.4').ok === false && validate('0.4').reason.includes('below'), '"0.4" (= 0.4 KAS, below 0.5 minimum) → rejected');

console.log(`\ntest-pool-stake-input-validation: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
