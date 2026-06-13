// gateF: fee-on-total parimutuel 单元测 (Owner 终裁 2026-06-13). 守恒 exact + ⑦数值 + wash + edge.
// 跑: node kasia-console/scripts/gateF-fee-on-total.mjs   (Bettor r853 follow-up: commit + regression).
import { computePoolPayouts } from '../src/services/pool-market-settler.js';

const KAS = 100000000n; // 1 KAS = 1e8 sompi
function k(n) { return Number(BigInt(n) * KAS); }
let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗ FAIL', msg); } }
function conservation(r, totalPool, bondReserve, minerFee, label) {
  const winSum = r.winnerPayouts.reduce((s, w) => s + w.amount, 0);
  const sum = r.brokerFee + r.oracleFeeTotal + r.makerFee + winSum + bondReserve + minerFee;
  assert(sum === totalPool, `${label}: Σ(${sum}) == totalPool(${totalPool}) [broker=${r.brokerFee} oracle=${r.oracleFeeTotal} maker=${r.makerFee} win=${winSum} bond=${bondReserve} miner=${minerFee}]`);
}
const FEES = { brokerFeePct: 190, oracleFeePct: 100, makerFeePct: 10, minBrokerFee: 0 };

console.log('\n=== ⑦平衡: YES100 + NO100 = 200 KAS (single winner) ===');
{
  const r = computePoolPayouts({ participants: [
    { stake: k(100), direction: 0, isMaker: true }, { stake: k(100), direction: 1, isMaker: false },
  ], winner: 0, ...FEES, oracleBond: 0, minerFee: 0, unanimous: true, silentOracleIndex: null, committeeMode: false, oracleCount: 5 });
  assert(r.brokerFee === k(38)/10, 'broker 3.8'); assert(r.oracleFeeTotal === k(2), 'oracle 2');
  assert(r.makerFee === k(2)/10, 'maker 0.2'); assert(r._distributable === k(194), 'dist 194');
  assert(r.winnerPayouts[0].amount === k(194), 'winner 194 (net +94)'); conservation(r, k(200), 0, 0, '⑦平衡');
}

console.log('\n=== 多 winner pro-rata: Alice60 Bob40 YES / Carol70 Dave30 NO ===');
{
  const r = computePoolPayouts({ participants: [
    { stake: k(60), direction: 0, isMaker: true }, { stake: k(40), direction: 0, isMaker: false },
    { stake: k(70), direction: 1, isMaker: false }, { stake: k(30), direction: 1, isMaker: false },
  ], winner: 0, ...FEES, oracleBond: 0, minerFee: 0, unanimous: true, silentOracleIndex: null, committeeMode: false, oracleCount: 5 });
  assert(r.winnerPayouts.find(w=>w.participantIndex===0).amount === Number(194n*KAS*60n/100n), 'Alice 116.4');
  assert(r.winnerPayouts.find(w=>w.participantIndex===1).amount === Number(194n*KAS*40n/100n), 'Bob 77.6');
  conservation(r, k(200), 0, 0, '多winner');
}

console.log('\n=== wash 反作弊: 自押 50Y+50N (+ other 50Y/50N), YES 赢 ===');
{
  // wash = idx0(YES50)+idx1(NO50); other = idx2(YES50)+idx3(NO50). 同人 idx0/idx1 净 = -3% rake.
  const r = computePoolPayouts({ participants: [
    { stake: k(50), direction: 0, isMaker: false }, { stake: k(50), direction: 1, isMaker: false },
    { stake: k(50), direction: 0, isMaker: true }, { stake: k(50), direction: 1, isMaker: false },
  ], winner: 0, ...FEES, oracleBond: 0, minerFee: 0, unanimous: true, silentOracleIndex: null, committeeMode: false, oracleCount: 5 });
  // YES 侧合计 100 (idx0 50 + idx2 50). wash idx0 拿 194×50/100=97. wash 净 = 97 − 100(他 50Y+50N) = -3.
  const washYesPayout = r.winnerPayouts.find(w=>w.participantIndex===0).amount;
  const washNet = washYesPayout - k(100); // 他押了 100 (50Y+50N), NO 侧输光
  assert(washYesPayout === Number(194n*KAS*50n/100n), 'wash YES50 拿 97');
  assert(washNet === -k(3), `wash 净 = -3 KAS (=3% rake, 不盈利) [净=${washNet/1e8}]`);
  conservation(r, k(200), 0, 0, 'wash');
}

console.log('\n=== edge L/W<3.1%: winner-heavy (YES 1000 / NO 10), winner 可净负 + 无 underflow ===');
{
  const r = computePoolPayouts({ participants: [
    { stake: k(1000), direction: 0, isMaker: true }, { stake: k(10), direction: 1, isMaker: false },
  ], winner: 0, ...FEES, oracleBond: 0, minerFee: 0, unanimous: true, silentOracleIndex: null, committeeMode: false, oracleCount: 5 });
  // totalPool 1010, fee 3%×1010=30.3, dist≈979.7. winner 拿 dist, net = dist − 1000 (净负, loser池10<fee30).
  assert(r.winnerPayouts[0].amount >= 0, 'winner payout >= 0 (无 underflow)');
  assert(r.winnerPayouts[0].amount < k(1000), 'winner-heavy: winner 拿 < 本金 (净负, fee-on-total 抽自己)');
  conservation(r, k(1010), 0, 0, 'edge L/W<3.1%');
}

console.log('\n=== committeeMode bond reserve + minerFee + 非整除 dust ===');
{
  const oracleBond = k(1), N = 5, minerFee = 13130;
  const r = computePoolPayouts({ participants: [
    { stake: k(33), direction: 0, isMaker: true }, { stake: k(33), direction: 0, isMaker: false },
    { stake: k(34), direction: 0, isMaker: false }, { stake: k(100), direction: 1, isMaker: false },
  ], winner: 0, ...FEES, oracleBond, minerFee, unanimous: true, silentOracleIndex: null, committeeMode: true, oracleCount: N });
  conservation(r, k(200), N * oracleBond, minerFee, 'committeeMode+dust');
  assert(r.winnerPayouts.every(w => w.amount >= 0), 'all winner >= 0');
}

console.log(`\n=== RESULT: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
