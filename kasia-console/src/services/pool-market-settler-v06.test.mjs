// v0.6 settler unit tests — pure logic (no chain RPC, no DB writes for sample/load tests).
// Run: node src/services/pool-market-settler-v06.test.mjs

import {
  describeEndBlockRule,
  fetchEndBlockHashCanonical,
  computeV06Payouts,
  THRESHOLD,
  COMMITTEE_SIZE,
} from './pool-market-settler-v06.mjs';

let failed = 0;
function assert(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}` + (detail ? ` — ${detail}` : '')); failed++; }
}
async function expectAsyncThrow(name, fn, fragment) {
  try { await fn(); assert(name, false, 'expected throw'); }
  catch (e) {
    if (!fragment || e.message.includes(fragment)) assert(name, true);
    else assert(name, false, `wrong msg: "${e.message}" want "${fragment}"`);
  }
}
function expectThrow(name, fn, fragment) {
  try { fn(); assert(name, false, 'expected throw'); }
  catch (e) {
    if (!fragment || e.message.includes(fragment)) assert(name, true);
    else assert(name, false, `wrong msg: "${e.message}" want "${fragment}"`);
  }
}

console.log('[pool-market-settler-v06.test] v0.6 settler unit tests');

// 1. describeEndBlockRule constants
{
  const r = describeEndBlockRule(1_000_000);
  assert('rule name', r.rule === 'first_block_with_daa_score_ge_deadline');
  assert('deadline echoed', r.deadline_daa === 1_000_000);
  assert('description mentions anti-grinding', r.description.includes('Anti-grinding'));
}

expectThrow('reject zero deadline', () => describeEndBlockRule(0), 'positive integer');
expectThrow('reject negative deadline', () => describeEndBlockRule(-1), 'positive integer');

// 2. fetchEndBlockHashCanonical with stub reader
{
  const reader = {
    async getBlocksFromDaaScore(minDaa) {
      return [
        { hash: 'aa'.repeat(32), daaScore: minDaa - 1 },  // below threshold
        { hash: 'bb'.repeat(32), daaScore: minDaa },       // first crossing
        { hash: 'cc'.repeat(32), daaScore: minDaa + 1 },
      ];
    },
  };
  const r = await fetchEndBlockHashCanonical(reader, 100_000);
  assert('fetch picks first crossing daaScore', r.hash === 'bb'.repeat(32));
  assert('block_daa matches', r.block_daa === 100_000);
}

await expectAsyncThrow('reject empty chain response', async () => {
  await fetchEndBlockHashCanonical({ async getBlocksFromDaaScore() { return []; } }, 100_000);
}, 'no blocks');

await expectAsyncThrow('reject invalid reader', async () => {
  await fetchEndBlockHashCanonical({}, 100_000);
}, 'chainReader');

await expectAsyncThrow('reject below-threshold-only response', async () => {
  await fetchEndBlockHashCanonical({
    async getBlocksFromDaaScore(minDaa) { return [{ hash: 'aa'.repeat(32), daaScore: minDaa - 5 }]; },
  }, 100_000);
}, 'none crossed');

await expectAsyncThrow('reject wrong hash length', async () => {
  await fetchEndBlockHashCanonical({
    async getBlocksFromDaaScore(minDaa) { return [{ hash: 'aabb', daaScore: minDaa }]; },
  }, 100_000);
}, '64-char hex');

// 3. computeV06Payouts — basic case (= maker loses)
{
  // maker 100 KAS = 10e9 sompi, on NO (direction=1); winner = YES (direction=0).
  // 2 bettors on YES, 1 on NO.
  const r = computeV06Payouts({
    makerStakeSompi: 10_000_000_000,    // 100 KAS
    makerDirection: 1,                   // NO
    brokerFeePct: 100,                   // 1%
    oracleFeePct: 100,                   // 1%
    oracleBondSompi: 100_000_000,        // 1 KAS bond per oracle
    minerFeeSompi: 50_000,               // 0.0005 KAS
    winner: 0,                            // YES wins
    bettors: [
      { pk: 'aa'.repeat(32), direction: 0, stake_sompi: 5_000_000_000 },  // 50 KAS YES
      { pk: 'bb'.repeat(32), direction: 0, stake_sompi: 3_000_000_000 },  // 30 KAS YES
      { pk: 'cc'.repeat(32), direction: 1, stake_sompi: 2_000_000_000 },  // 20 KAS NO
    ],
  });
  // Losers: maker 100 KAS + cc 20 KAS = 120 KAS = 12e9
  assert('losingPool = 12e9 sompi', r.losingPool === '12000000000');
  // brokerFee = 12e9 × 1% = 1.2e8 ≥ MIN_BROKER_FEE (5e6) → use calculated
  assert('brokerFee = 1.2e8', r.brokerFee === '120000000');
  // oracleFeeTotal = 12e9 × 1% = 1.2e8; per committee = 2.4e7
  assert('oracleFeeTotal = 1.2e8', r.oracleFeeTotal === '120000000');
  assert('oracleFeePerCommittee = 2.4e7', r.oracleFeePerCommittee === '24000000');
  // distributable = 12e9 - 5e4 - 1.2e8 - 1.2e8 = 11_759_950_000
  assert('distributable correct', r.distributable === '11759950000');
  // winners pool = 50+30 = 80 KAS = 8e9, distributable share aa = (8e9/8e9) × 50/80 = 50/80 of distributable
  // aa payout = stake 5e9 + 5e9/8e9 × 11_759_950_000 = 5e9 + 7_349_968_750 = 12_349_968_750
  const aa = r.winnerPayouts.find(w => w.pk === 'aa'.repeat(32));
  assert('aa winner payout', aa.payout_sompi === '12349968750');
  // bb payout = 3e9 + 3e9/8e9 × 11_759_950_000 = 3e9 + 4_409_981_250 = 7_409_981_250
  const bb = r.winnerPayouts.find(w => w.pk === 'bb'.repeat(32));
  assert('bb winner payout', bb.payout_sompi === '7409981250');
  // Loser cc gets nothing in winnerPayouts
  assert('cc loser not in winnerPayouts', !r.winnerPayouts.find(w => w.pk === 'cc'.repeat(32)));
  // 2 winner payouts (aa + bb), no maker payout because maker is loser
  assert('2 winner payouts (excluding maker loser)', r.winnerPayouts.length === 2);
}

// 4. computeV06Payouts — maker wins (= maker is winner, gets back stake + share)
{
  const r = computeV06Payouts({
    makerStakeSompi: 10_000_000_000,
    makerDirection: 0,                   // YES
    brokerFeePct: 100,
    oracleFeePct: 100,
    oracleBondSompi: 100_000_000,
    minerFeeSompi: 50_000,
    winner: 0,                            // YES wins → maker wins
    bettors: [
      { pk: 'aa'.repeat(32), direction: 0, stake_sompi: 5_000_000_000 },
      { pk: 'bb'.repeat(32), direction: 1, stake_sompi: 8_000_000_000 },  // 80 KAS NO loser
    ],
  });
  assert('maker wins → maker in winnerPayouts', !!r.winnerPayouts.find(w => w.pk === '__maker__'));
  assert('3 winner payouts (= maker + aa, bb is loser)', r.winnerPayouts.length === 2);
  // losingPool = 80 KAS = 8e9
  assert('losingPool = 8e9', r.losingPool === '8000000000');
}

// 5. computeV06Payouts — reject degenerate cases
expectThrow('no winning side', () => computeV06Payouts({
  makerStakeSompi: 1e10,
  makerDirection: 1,
  brokerFeePct: 100, oracleFeePct: 100, oracleBondSompi: 1e8, minerFeeSompi: 50_000,
  winner: 0,
  bettors: [{ pk: 'aa'.repeat(32), direction: 1, stake_sompi: 5e9 }],
}), 'no winning side');

expectThrow('no losing side', () => computeV06Payouts({
  makerStakeSompi: 1e10,
  makerDirection: 0,
  brokerFeePct: 100, oracleFeePct: 100, oracleBondSompi: 1e8, minerFeeSompi: 50_000,
  winner: 0,
  bettors: [{ pk: 'aa'.repeat(32), direction: 0, stake_sompi: 5e9 }],
}), 'no losing side');

expectThrow('invalid winner', () => computeV06Payouts({
  makerStakeSompi: 1e10, makerDirection: 0, brokerFeePct: 100, oracleFeePct: 100,
  oracleBondSompi: 1e8, minerFeeSompi: 50_000, winner: 2, bettors: [],
}), 'winner');

// 6. THRESHOLD + COMMITTEE_SIZE exports
assert('THRESHOLD = 4', THRESHOLD === 4);
assert('COMMITTEE_SIZE = 5', COMMITTEE_SIZE === 5);

console.log(failed === 0 ? '[pool-market-settler-v06.test] ALL PASS' : `[pool-market-settler-v06.test] ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
