// B2 v0.5 Sub 2d Phase 2a-2 — computePoolPayouts unit test
// Per Bettor r339 critical pushes: maker-as-bettor + forfeit_1 50/25/25 split + broker_relay_id.

import { computePoolPayouts } from '../src/services/pool-market-settler.js';

let pass = 0, fail = 0;
function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) {
    console.log(`  actual:   ${JSON.stringify(actual)}`);
    console.log(`  expected: ${JSON.stringify(expected)}`);
    fail++;
  } else pass++;
}

// Test 1: Unanimous + maker winner + 2 bettor winners + 1 bettor loser, no broker fee
{
  const r = computePoolPayouts({
    participants: [
      { stake: 100, direction: 0, isMaker: true },   // maker bets YES (=0), wins
      { stake: 50,  direction: 0 },                  // bettor1 bets YES, wins
      { stake: 50,  direction: 0 },                  // bettor2 bets YES, wins
      { stake: 200, direction: 1 },                  // bettor3 bets NO, loses
    ],
    winner: 0,
    brokerFeePct: 0,
    oracleBond: 1000,
    unanimous: true,
    silentOracleIndex: null,
  });
  // losingPool = 200, brokerFee=0, distributable=200
  // totalWinnerStake = 100+50+50 = 200
  // maker share: 100 + floor(200*100/200) = 100+100 = 200
  // bettor1: 50 + floor(200*50/200) = 50+50 = 100
  // bettor2: 50 + 50 = 100
  // 3 oracle bond returns: each 1000
  assertEq('T1 unanimous winners payout', {
    brokerFee: r.brokerFee,
    winners: r.winnerPayouts.map(w => w.amount),
    makerExtra: r.makerExtraOutput,
    bondReturns: r.oracleBondReturns.map(o => o.amount),
  }, {
    brokerFee: 0,
    winners: [200, 100, 100],
    makerExtra: null,
    bondReturns: [1000, 1000, 1000],
  });
}

// Test 2: Unanimous + 5% broker fee + maker loses
{
  const r = computePoolPayouts({
    participants: [
      { stake: 100, direction: 1, isMaker: true },   // maker bets NO, loses
      { stake: 200, direction: 0 },                  // bettor1 bets YES, wins
    ],
    winner: 0,
    brokerFeePct: 500,  // 5%
    oracleBond: 1000,
    unanimous: true,
    silentOracleIndex: null,
  });
  // losingPool = 100 (maker only), brokerFee = 100*500/10000 = 5, distributable = 95
  // bettor1: 200 + floor(95*200/200) = 200+95 = 295
  // no maker creator-fee output (unanimous), no winner payout for maker (maker is loser)
  // 3 oracle bond returns: 1000 each
  assertEq('T2 maker loser + 5% broker', {
    brokerFee: r.brokerFee,
    winners: r.winnerPayouts.map(w => w.amount),
    makerExtra: r.makerExtraOutput,
    bondReturns: r.oracleBondReturns.map(o => o.amount),
  }, {
    brokerFee: 5,
    winners: [295],
    makerExtra: null,
    bondReturns: [1000, 1000, 1000],
  });
}

// Test 3: Forfeit_1 (oracle index 2 silent) + maker winner
{
  const r = computePoolPayouts({
    participants: [
      { stake: 100, direction: 0, isMaker: true },   // maker YES, wins
      { stake: 100, direction: 0 },                  // bettor1 YES, wins
      { stake: 200, direction: 1 },                  // bettor2 NO, loses
    ],
    winner: 0,
    brokerFeePct: 0,
    oracleBond: 1000,
    unanimous: false,
    silentOracleIndex: 2,
  });
  // losingPool=200, brokerFee=0, distributable=200
  // Forfeit_1 from oracle3 (bond=1000):
  //   winnerForfeitShare = 500 (50%)
  //   makerForfeitShare = 250 (25%)
  //   perOracleForfeitShare = floor(250/2) = 125 (25%/2 surviving)
  // totalWinnerStake = 200
  // maker payout: 100 + floor((200+500)*100/200) + 250 = 100+350+250 = 700
  // bettor1 payout: 100 + floor(700*100/200) = 100+350 = 450
  // oracle bond returns (oracle 0 + 1, skip 2): 1000+125 = 1125 each
  assertEq('T3 forfeit_1 silent oracle2 + maker winner', {
    brokerFee: r.brokerFee,
    winners: r.winnerPayouts.map(w => w.amount),
    makerExtra: r.makerExtraOutput,
    bondReturns: r.oracleBondReturns,
  }, {
    brokerFee: 0,
    winners: [700, 450],
    makerExtra: null,
    bondReturns: [
      { oracleIndex: 0, amount: 1125 },
      { oracleIndex: 1, amount: 1125 },
    ],
  });
}

// Test 4: Forfeit_1 + maker loser → makerExtra creator-fee output
{
  const r = computePoolPayouts({
    participants: [
      { stake: 100, direction: 1, isMaker: true },   // maker NO, loses
      { stake: 100, direction: 0 },                  // bettor1 YES, wins
    ],
    winner: 0,
    brokerFeePct: 0,
    oracleBond: 1000,
    unanimous: false,
    silentOracleIndex: 0,
  });
  // losingPool=100, brokerFee=0, distributable=100
  // Forfeit_1 oracle0 silent: bond=1000 → winner=500, maker=250, perOracle=125
  // bettor1 payout: 100 + floor((100+500)*100/100) = 100+600 = 700
  // makerExtra: 250 (creator fee since maker is loser)
  // oracle bond returns (skip 0): oracles 1 + 2 each 1125
  assertEq('T4 forfeit_1 + maker loser → creator-fee output', {
    brokerFee: r.brokerFee,
    winners: r.winnerPayouts.map(w => w.amount),
    makerExtra: r.makerExtraOutput,
    bondReturns: r.oracleBondReturns,
  }, {
    brokerFee: 0,
    winners: [700],
    makerExtra: 250,
    bondReturns: [
      { oracleIndex: 1, amount: 1125 },
      { oracleIndex: 2, amount: 1125 },
    ],
  });
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
