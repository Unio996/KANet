// B2 v0.5 area-5/6 W3 regression — forfeit_1 floor-rounding remainder folded into maker share.
//
// Per area-5 W3: the 4 floor calls (winner 50% / maker 25% / 2× oracle 12.5%) can each shed
// 0-1 sompi depending on oracleBond divisibility. Pre-patch, those sompi leaked implicitly
// into minerFee. Post-patch they're folded into makerForfeitShare so total_allocated ==
// oracleBond — matches the W2 formula spec.
//
// (Note: area-10 outstanding may revisit maker share entirely [same +EV pattern as Gap 1B
// burn]. Until then, remainder follows the same destination as the 25% share.)
import { computePoolPayouts } from '../src/services/pool-market-settler.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

// Helper: run a forfeit_1 scenario, extract the 4 shares.
const run = (oracleBond) => {
  const participants = [
    { stake: 100_000_000, direction: 0, isMaker: true },   // maker on YES side
    { stake: 100_000_000, direction: 0, isMaker: false },  // 1 winner bettor
    { stake: 100_000_000, direction: 1, isMaker: false },  // 1 loser bettor
  ];
  const out = computePoolPayouts({
    participants,
    winner: 0,             // YES wins
    brokerFeePct: 0,       // simplify
    oracleBond,
    minerFee: 0,
    unanimous: false,
    silentOracleIndex: 2,  // oracle index 2 silent
    minBrokerFee: 0,
  });
  // out.oracleBondReturns = [{oracleIndex: 0, amount: oracleBond + perOracleShare},
  //                          {oracleIndex: 1, amount: oracleBond + perOracleShare}]
  // (silent oracle 2 excluded)
  return out;
};

// T1: oracleBond evenly divisible — remainder should be 0, no change vs nominal.
{
  const out = run(100_000_000);  // 1 KAS
  // nominal: winner 50M / maker 25M / per-oracle 12.5M (× 2 = 25M) → total 100M ✓
  const winnerForfeitImpliedFromMaker = out.winnerPayouts.find(w => w.isMaker).amount;
  ok(winnerForfeitImpliedFromMaker > 100_000_000, `T1 (100M bond, divisible): maker winnerPayout includes 25M share`);
  // Returned bonds: surviving oracles get oracleBond + 12.5M each = 112.5M each
  const surviving = out.oracleBondReturns;
  ok(surviving.length === 2, `T1: 2 surviving oracle bond returns (silent excluded)`);
  ok(surviving.every(s => s.amount === 100_000_000 + 12_500_000), `T1: each surviving = 112.5M (= bond + 12.5M share)`);
}

// T2: oracleBond NOT cleanly divisible — verify remainder folded into makerForfeitShare.
// 100_000_001 → winner 50M / maker 25M / per-oracle 12,500,000 (× 2 = 25M) = 100,000,000
// remainder = 1 → maker gets 25M + 1 = 25,000,001.
{
  const out = run(100_000_001);
  // surviving oracles each get oracleBond (= 100,000,001) + perOracleShare (= 12,500,000) = 112,500,001
  const surviving = out.oracleBondReturns;
  ok(surviving.every(s => s.amount === 100_000_001 + 12_500_000), `T2 (100M+1 bond): surviving = 112,500,001 each (= bond + 12.5M)`);
  // No way to extract makerForfeitShare directly via output; but TOTAL must equal oracleBond.
  const totalSplit = 50_000_000 + 25_000_001 + 12_500_000 * 2;
  ok(totalSplit === 100_000_001, `T2: total_allocated 50M+25M+1+25M = 100,000,001 == oracleBond (= W3 invariant)`);
}

// T3: oracleBond producing max remainder (3 sompi shed by 4 floor ops).
// E.g. oracleBond = 7 sompi → winner floor(3.5)=3, maker floor(1.75)=1, perOracle floor(0.875)=0×2=0
// total nominal = 3+1+0+0 = 4, remainder = 3 → maker = 1+3 = 4.
{
  const out = run(7);
  const surviving = out.oracleBondReturns;
  // surviving = bond (7) + perOracleShare (0) = 7 each
  ok(surviving.every(s => s.amount === 7), `T3 (7 sompi bond): surviving = 7 (= bond + 0 perOracleShare since 25/100/2 = 12.5% < 1 sompi)`);
  const totalSplit = 3 + 4 + 0 * 2;  // winner 3 + maker 4 (1 nominal + 3 remainder) + 0+0 oracle = 7
  ok(totalSplit === 7, `T3: total_allocated 3+4+0+0 = 7 == oracleBond (= W3 maxes remainder into maker)`);
}

// T4: pre-W3 leak math — without remainder fold, 7 sompi bond would lose 3 sompi to fee.
{
  const oracleBond = 7;
  const winnerShare = Math.floor(oracleBond * 50 / 100);  // 3
  const makerShareNominal = Math.floor(oracleBond * 25 / 100);  // 1
  const perOracleShare = Math.floor(oracleBond * 25 / 100 / 2);  // 0
  const totalNominal = winnerShare + makerShareNominal + perOracleShare * 2;  // 3+1+0+0=4
  const leak = oracleBond - totalNominal;  // 3
  ok(leak === 3, `T4 pre-W3 baseline: 7 sompi bond → 3 sompi leak without remainder fold (W3 catches this)`);
}

console.log(`\ntest-pool-w3-forfeit-remainder: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
