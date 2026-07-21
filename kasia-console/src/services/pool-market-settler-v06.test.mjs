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
// 2026-07-16 J2 (settler 域坏测试卡, Bettor #o0ddcf.1 派工): 契约已升级为 SPC-only fail-closed
// (pool-market-settler-v06.mjs:104-106, 'J2-tn r332' 注释——无 ring buffer fallback, 单点
// chainReader.getBlockAtDaa(minDaa) 直查, 不再是 chainReader.getBlocksFromDaaScore 返回数组
// 让本函数自己 scan 找第一个 crossing 的块)。本文件 mock 一直停在旧契约, 从没跟着升级过
// (git diff 确认: J1 spc_daa_index 落码零接触本文件, 是更早的 signature 改动漏改测试)。
// 逐 case 重写为新契约 mock; "reject below-threshold-only response" 测的是旧 scan 逻辑,
// 新契约下该场景不存在(threshold-crossing 由 chainReader 自己的 SPC walk 负责, 不再是本函数
// 的职责), 整条删除而非改写。
{
  // current at 100_100, picked at 100_000 → depth 100 ≥ 50 default → OK
  const reader = {
    async getBlockAtDaa(minDaa) { return { hash: 'bb'.repeat(32), daaScore: minDaa }; },
    async getCurrentDaaScore() { return 100_100; },
  };
  const r = await fetchEndBlockHashCanonical(reader, 100_000);
  assert('fetch picks block at deadline daaScore', r.hash === 'bb'.repeat(32));
  assert('block_daa matches', r.block_daa === 100_000);
  assert('finality_depth_actual = 100', r.finality_depth_actual === 100);
}

await expectAsyncThrow('reject no block found at deadline (SPC walk未达)', async () => {
  await fetchEndBlockHashCanonical({
    async getBlockAtDaa() { return null; },
    async getCurrentDaaScore() { return 100_100; },
  }, 100_000);
}, 'no block at daaScore');

await expectAsyncThrow('reject invalid reader (no getCurrentDaaScore)', async () => {
  await fetchEndBlockHashCanonical({}, 100_000);
}, 'chainReader');

await expectAsyncThrow('reject reader missing getCurrentDaaScore (F-S1 finality)', async () => {
  await fetchEndBlockHashCanonical({
    async getBlockAtDaa(minDaa) { return { hash: 'aa'.repeat(32), daaScore: minDaa }; },
  }, 100_000);
}, 'getCurrentDaaScore');

await expectAsyncThrow('reject invalid reader (no getBlockAtDaa)', async () => {
  await fetchEndBlockHashCanonical({
    async getCurrentDaaScore() { return 100_100; },
  }, 100_000);
}, 'getBlockAtDaa');

await expectAsyncThrow('reject chain rewinded (currentDaa < picked block daaScore)', async () => {
  await fetchEndBlockHashCanonical({
    async getBlockAtDaa(minDaa) { return { hash: 'bb'.repeat(32), daaScore: minDaa }; },
    async getCurrentDaaScore() { return 99_999; }, // < picked block daaScore 100_000
  }, 100_000);
}, 'rewinded');

await expectAsyncThrow('reject wrong hash length', async () => {
  await fetchEndBlockHashCanonical({
    async getBlockAtDaa(minDaa) { return { hash: 'aabb', daaScore: minDaa }; },
    async getCurrentDaaScore() { return 100_100; },
  }, 100_000);
}, '64-char hex');

// F-S1 finality depth tests (Bettor r48 close gate ① residual fix)
await expectAsyncThrow('reject pre-finality block (depth < 50 default)', async () => {
  await fetchEndBlockHashCanonical({
    async getBlockAtDaa(minDaa) { return { hash: 'bb'.repeat(32), daaScore: minDaa }; },
    async getCurrentDaaScore() { return 100_010; }, // depth = 10, < 50 default
  }, 100_000);
}, 'finality');

{
  // custom finalityDepth=20 allows depth-30 block
  const r = await fetchEndBlockHashCanonical({
    async getBlockAtDaa(minDaa) { return { hash: 'bb'.repeat(32), daaScore: minDaa }; },
    async getCurrentDaaScore() { return 100_030; },
  }, 100_000, 20);
  assert('custom finalityDepth=20 + depth 30 passes', r.hash === 'bb'.repeat(32));
}

await expectAsyncThrow('reject negative finalityDepth', async () => {
  await fetchEndBlockHashCanonical({
    async getBlockAtDaa(minDaa) { return { hash: 'bb'.repeat(32), daaScore: minDaa }; },
    async getCurrentDaaScore() { return 100_100; },
  }, 100_000, -1);
}, 'non-negative');

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

// 7. F-P1 fix (BigInt totalIn): test with stake > 2^53 (= 9e15 sompi, 9e7 KAS pool)
{
  // 9e7 KAS = 9e15 sompi > 2^53 (9.0e15). Without BigInt totalIn, Number precision would lose.
  const big = 9_000_000_000_000_000n; // 9e7 KAS = 9e15 sompi
  const r = computeV06Payouts({
    makerStakeSompi: big,
    makerDirection: 1,
    brokerFeePct: 100, oracleFeePct: 100, oracleBondSompi: 100_000_000,
    minerFeeSompi: 50_000,
    winner: 0,
    bettors: [{ pk: 'aa'.repeat(32), direction: 0, stake_sompi: big }],
  });
  // If F-P1 not fixed, balance would silently fail. With fix, computation succeeds.
  assert('F-P1: large stake (>2^53) computes without precision-induced balance fail',
    !!r.winnerPayouts.find(w => w.pk === 'aa'.repeat(32)));
}

// 8. F-P3 fix (tolerance widened): many winners + dust
{
  // 20 winners, each gets pro-rata share with residue per winner
  const bettors = [];
  for (let i = 0; i < 20; i++) {
    bettors.push({ pk: (i.toString(16).padStart(2, '0')).repeat(32), direction: 0, stake_sompi: 1_000_000_000 });
  }
  bettors.push({ pk: 'ff'.repeat(32), direction: 1, stake_sompi: 5_000_000_000 });
  const r = computeV06Payouts({
    makerStakeSompi: 10_000_000_000,
    makerDirection: 1,
    brokerFeePct: 99, oracleFeePct: 99, oracleBondSompi: 100_000_000,
    minerFeeSompi: 50_000,
    winner: 0,
    bettors,
  });
  // 20 winners share distributable → up to 20 sompi residue allowed
  assert('F-P3: many winners (20) compute under tolerance (= numWinners + 5)',
    r.winnerPayouts.length === 20);
}

console.log(failed === 0 ? '[pool-market-settler-v06.test] ALL PASS' : `[pool-market-settler-v06.test] ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
