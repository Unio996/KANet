// rehearsal-pre-broadcast-gate.selftest.mjs — byte-exact 核实 buildZkCloseDebuggerCase 的字段映射假设
// (J1tn, 2026-07-08): 用真实历史落链数据(CloseZkV2.test.json 里 2026-07-07 3o6cs dust demo 那条
// zk_close_regression_vs_repro4_verified_data 回归用例, commit cb1dd9d8 起 tracked)反推 sigScript/
// gateSuffixHex 拆分点, 喂给 buildZkCloseDebuggerCase, 断言产出跟已落链真实数据逐字段 deep-equal。
// 不是"形状像"就算过, 是跟已知为真的历史数据位对位比对。
//
// Run: cd kasia-console && node src/lib/rehearsal-pre-broadcast-gate.selftest.mjs

import { readFileSync } from 'node:fs';
import { buildZkCloseDebuggerCase } from './rehearsal-pre-broadcast-gate.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const real = JSON.parse(readFileSync(new URL('./CloseZkV2.test.json', import.meta.url), 'utf8')).tests[0];
ok(real.name === 'zk_close_regression_vs_repro4_verified_data' && real.function === 'zk_close', 'fixture is the expected real zk_close regression entry');

// 反推 sigScript-only(args[0]=gateSuffixHex 是真实 signature_script_hex 的尾部, 见 harness 计划里的
// 拆解验证): sigScript = signature_script_hex 去掉 gateSuffixHex 这段尾巴。
const gateSuffixHex = real.args[0];
const realGateSigScriptHex = real.tx.inputs[1].signature_script_hex;
ok(realGateSigScriptHex.endsWith(gateSuffixHex), 'precondition: real signature_script_hex ends with args[0](gateSuffixHex)');
const sigScriptOnly = realGateSigScriptHex.slice(0, realGateSigScriptHex.length - gateSuffixHex.length);

const [gateTmplHash, betsRootBaked, refundRootBaked, attestedAtMs, attestedWinner, closed, payoutRootHex, consolidatedPool] = real.constructor_args;
const guestPayoutRootHex = real.args[1];
const selfOutIdx = real.args[2];

const testCase = buildZkCloseDebuggerCase({
  beforeState: { gateTmplHash, betsRootBaked, refundRootBaked, attestedAtMs, attestedWinner, closed, payoutRootHex, consolidatedPool },
  witness: { sigScript: sigScriptOnly, gateSuffixHex },
  guestPayoutRootHex, selfOutIdx,
  closeZkUtxoValueSompi: real.tx.inputs[0].utxo_value,
  gateUtxoValueSompi: real.tx.inputs[1].utxo_value,
  gateScriptHex: real.tx.inputs[1].utxo_script_hex,
});
const built = testCase.tests[0];

console.log('[test] buildZkCloseDebuggerCase reproduces real landed zk_close data byte-exact:');
ok(JSON.stringify(built.constructor_args) === JSON.stringify(real.constructor_args), 'constructor_args (before-state) byte-exact match');
ok(JSON.stringify(built.args) === JSON.stringify(real.args), 'args (gateSuffixHex/guestPayoutRoot/selfOutIdx) byte-exact match');
ok(JSON.stringify(built.tx.inputs[0]) === JSON.stringify(real.tx.inputs[0]), 'tx.inputs[0] (closezk being spent) byte-exact match');
ok(built.tx.inputs[1].signature_script_hex === real.tx.inputs[1].signature_script_hex, 'reconstructed signature_script_hex (sigScript++gateSuffixHex) byte-exact match');
ok(built.tx.inputs[1].utxo_script_hex === real.tx.inputs[1].utxo_script_hex, 'gate utxo_script_hex passthrough match');
ok(built.tx.inputs[1].utxo_value === real.tx.inputs[1].utxo_value, 'gate utxo_value match');
ok(JSON.stringify(built.tx.outputs) === JSON.stringify(real.tx.outputs), 'tx.outputs (after-state: closed=2, payoutRootField=guestPayoutRoot) byte-exact match');
ok(built.expect === 'pass', "expect='pass'");

// fail-closed guard: beforeState.closed != 1 must throw, not silently build a bogus case.
try {
  buildZkCloseDebuggerCase({ beforeState: { gateTmplHash, betsRootBaked, refundRootBaked, attestedAtMs, attestedWinner, closed: 0, payoutRootHex, consolidatedPool }, witness: { sigScript: sigScriptOnly, gateSuffixHex }, guestPayoutRootHex, selfOutIdx, closeZkUtxoValueSompi: 1, gateUtxoValueSompi: 1, gateScriptHex: 'aa' });
  ok(false, 'closed!=1 should throw');
} catch (e) { ok(/closed=0 != 1/.test(e.message), `closed!=1 fail-closed: ${e.message}`); }

console.log(fails === 0
  ? '\n✅✅ ALL PASS — buildZkCloseDebuggerCase: field mapping verified byte-exact against real landed 2026-07-07 zk_close data'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
