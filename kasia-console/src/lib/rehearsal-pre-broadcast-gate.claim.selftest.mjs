// rehearsal-pre-broadcast-gate.claim.selftest.mjs — 门③(claim) buildZkClaimDebuggerCase 字段映射核实
// (J1tn, 2026-07-08)。
//
// ⚠ 诚实边界(区别于门②的 selftest): claim 全链从未真实触发过(NWT/Bettor 昨晚反复确认), 没有真实落链
// 数据可比对。本自测对照的是 CloseZkV2.test.json 里两条已被 cli-debugger --run-all 实跑验证过 "expect":
// "pass" 的回归用例(合成哨兵值 1111.../2222.../3333..., 非真实链上数据)——验证的是"我的函数产出跟已知
// 被 debugger 接受的结构逐字段一致", 不是"跟真实链上数据 byte-exact"(门②那种更强的证据等级不存在于此)。
//
// Run: cd kasia-console && node src/lib/rehearsal-pre-broadcast-gate.claim.selftest.mjs

import { readFileSync } from 'node:fs';
import { buildZkClaimDebuggerCase } from './rehearsal-pre-broadcast-gate.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const fixtures = JSON.parse(readFileSync(new URL('./CloseZkV2.test.json', import.meta.url), 'utf8')).tests;
const firstWinner = fixtures.find(t => t.name === 'claim_normal_first_winner');
const dustBoundary = fixtures.find(t => t.name === 'claim_dust_boundary_final_winner');
ok(!!firstWinner && !!dustBoundary, 'both known-good claim fixtures found in CloseZkV2.test.json');

function toBeforeState(real) {
  const [gateTmplHash, betsRootBaked, refundRootBaked, attestedAtMs, attestedWinner, closed, payoutRootHex, consolidatedPool, ...wWords] = real.constructor_args;
  return { gateTmplHash, betsRootBaked, refundRootBaked, attestedAtMs, attestedWinner, closed, payoutRootHex, consolidatedPool, wWords };
}

console.log('[test] buildZkClaimDebuggerCase reproduces claim_normal_first_winner (not-last-claimant, continuation branch):');
{
  const real = firstWinner;
  const beforeState = toBeforeState(real);
  const currentState = { w0: '0', w1: '0' }; // pre-claim: all-zero words (matches real fixture's before-ctor w0..16=0)
  for (let i = 2; i < 17; i++) currentState['w' + i] = '0';
  const [selfOutIdx, payoutOutIdx, bettorPk, payout, merkle_index, ...siblingsHex] = real.args;
  const witness = { bettorPk, payout: BigInt(payout), merkle_index, siblings: siblingsHex };

  const built = buildZkClaimDebuggerCase({ beforeState, currentState, witness, selfOutIdx, payoutOutIdx, closeZkUtxoValueSompi: real.tx.inputs[0].utxo_value }).tests[0];
  ok(JSON.stringify(built.constructor_args) === JSON.stringify(real.constructor_args), 'constructor_args match');
  ok(JSON.stringify(built.args) === JSON.stringify(real.args), 'args match');
  ok(built.tx.inputs[0].utxo_value === real.tx.inputs[0].utxo_value, 'tx.inputs[0].utxo_value match');
  ok(JSON.stringify(built.tx.outputs) === JSON.stringify(real.tx.outputs), 'tx.outputs match (continuation w0=1 nullifier bit + p2pk payout)');
}

console.log('[test] buildZkClaimDebuggerCase reproduces claim_dust_boundary_final_winner (last-claimant, no-continuation branch):');
{
  const real = dustBoundary;
  const beforeState = toBeforeState(real);
  const currentState = {}; for (let i = 0; i < 17; i++) currentState['w' + i] = '0';
  const [selfOutIdx, payoutOutIdx, bettorPk, payout, merkle_index, ...siblingsHex] = real.args;
  const witness = { bettorPk, payout: BigInt(payout), merkle_index, siblings: siblingsHex };

  const built = buildZkClaimDebuggerCase({ beforeState, currentState, witness, selfOutIdx, payoutOutIdx, closeZkUtxoValueSompi: real.tx.inputs[0].utxo_value }).tests[0];
  ok(JSON.stringify(built.constructor_args) === JSON.stringify(real.constructor_args), 'constructor_args match');
  ok(JSON.stringify(built.args) === JSON.stringify(real.args), 'args match');
  ok(JSON.stringify(built.tx.outputs) === JSON.stringify(real.tx.outputs), 'tx.outputs match (single p2pk payout, no continuation — exact pool drain)');
}

console.log('[test] fail-closed guards:');
{
  const beforeState = toBeforeState(firstWinner);
  try {
    buildZkClaimDebuggerCase({ beforeState: { ...beforeState, closed: 1 }, currentState: {}, witness: { bettorPk: 'aa', payout: 1n, merkle_index: 0, siblings: Array(10).fill('00'.repeat(32)) }, selfOutIdx: 0, payoutOutIdx: 1, closeZkUtxoValueSompi: 1 });
    ok(false, 'closed!=2 should throw');
  } catch (e) { ok(/closed=1 != 2/.test(e.message), `closed!=2 fail-closed: ${e.message}`); }

  try {
    buildZkClaimDebuggerCase({ beforeState, currentState: {}, witness: { bettorPk: 'aa', payout: 1n, merkle_index: 0, siblings: Array(9).fill('00'.repeat(32)) }, selfOutIdx: 0, payoutOutIdx: 1, closeZkUtxoValueSompi: 100000000 });
    ok(false, 'siblings.length!=10 should throw');
  } catch (e) { ok(/siblings 长度=9/.test(e.message), `siblings!=10 fail-closed: ${e.message}`); }
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — buildZkClaimDebuggerCase: field mapping matches known-good debugger-verified fixtures (synthetic data, claim never landed on real chain — see honest-boundary note at top)'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
