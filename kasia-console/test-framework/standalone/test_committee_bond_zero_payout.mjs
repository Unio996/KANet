// J2-tn #28 regression — committeeMode oracle_bond=0 → oracle take = feeShare (spec 1%), no additive bond
//
// scope: Bettor sprint #28 APPROVE (r-batch2) + NWT r1176 attack-verify ("committeeMode bond=0 →
//        payout oracle=feeShare 断言").
// bug: committeeMode 每委员 settle output = oracleBond + oracleFee/N (ADDITIVE, computePoolPayouts
//      L1426 committeeBondReserve = N×oracleBond reserved off distributable + L1490 bondReturn=oracleBond).
//      固定 oracleBond 1 KAS → 5 委员 5 KAS pool-funded 主导小池 (151 池 oracle 实拿 4.31% vs spec 1%).
// fix: create-v06/v07 默认 oracle_bond_kas 1→0 → committeeBondReserve=0 → committee output=feeShare=1%,
//      省下的 5×bond reserve 归 winner.
//
// 真调生产 export computePoolPayouts (no DB/IPC, L1369 "Extracted for testability") = 非拷贝逻辑.
// run: node test-framework/standalone/test_committee_bond_zero_payout.mjs  (exit 0=PASS, 1=FAIL)

import { computePoolPayouts } from '../../src/services/pool-market-settler.js';

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log(`PASS ${name}`);
  else { fails++; console.error(`FAIL ${name}: ${detail}`); }
}

const e8 = 1e8;
// lwrcl-like pool: maker 150 KAS on NO (direction 1, loser), 1 bettor 1 KAS on YES (direction 0, winner).
const participants = [
  { stake: 150 * e8, direction: 1, isMaker: true },  // maker NO (sole loser)
  { stake: 1 * e8, direction: 0 },                    // DM bettor YES (sole winner)
];
const N = 5;
const base = {
  participants, winner: 0, brokerFeePct: 190, minerFee: 5_000_000,
  unanimous: true, silentOracleIndex: null,
  committeeMode: true, oracleCount: N, oracleFeePct: 100, makerFeePct: 10,
};

const r0 = computePoolPayouts({ ...base, oracleBond: 0 });          // #28 fix
const r1 = computePoolPayouts({ ...base, oracleBond: 1 * e8 });     // old default (1 KAS)

const sumWinner = (r) => r.winnerPayouts.reduce((s, w) => s + w.amount, 0);

// 1. bond=0 → every committee bond-return is 0 (no pool-funded bond)
check('bond=0 → all oracleBondReturns == 0',
  r0.oracleBondReturns.length === N && r0.oracleBondReturns.every(b => b.amount === 0),
  `returns=${JSON.stringify(r0.oracleBondReturns)}`);

// 2. bond=1KAS → every committee bond-return is 1e8 (the old additive inflation)
check('bond=1KAS → all oracleBondReturns == 1e8',
  r1.oracleBondReturns.length === N && r1.oracleBondReturns.every(b => b.amount === 1 * e8),
  `returns=${JSON.stringify(r1.oracleBondReturns)}`);

// 3. CORE: bond=0 winner gets back exactly the 5×bond reserve that bond=1KAS sent to committee
//    (= the 5 KAS pool-funded bond is the entire fee-gap; with bond=0 it goes to the winner, not oracle).
const winnerDelta = sumWinner(r0) - sumWinner(r1);
check('bond=0 winner == bond=1KAS winner + 5×1e8 (saved reserve → winner)',
  winnerDelta === N * e8,
  `winner(bond=0)=${sumWinner(r0)} winner(bond=1)=${sumWinner(r1)} delta=${winnerDelta} want=${N * e8}`);

// 4. broker fee identical (fee-on-TOTAL, independent of bond) — 1.9% of 151 KAS pool
check('broker fee identical across bond (fee-on-TOTAL, bond-independent)',
  r0.brokerFee === r1.brokerFee && r0.brokerFee === Math.floor(151 * e8 * 190 / 10000),
  `broker0=${r0.brokerFee} broker1=${r1.brokerFee} expect=${Math.floor(151 * e8 * 190 / 10000)}`);

if (fails) { console.error(`\n${fails} assertion(s) FAILED`); process.exit(1); }
console.log('\nALL PASS (4 assertions) — #28 committeeMode bond=0 → oracle=feeShare(1%), reserve → winner');
process.exit(0);
