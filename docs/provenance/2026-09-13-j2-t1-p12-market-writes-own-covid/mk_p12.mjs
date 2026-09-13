// P12 运行期向量生成(J2 2026-09-13 T1 v0.5 A″): 市场写自己 cov-id 进领取输出 · 领取输出 P2SH 由 ClaimStub 编译产物派生
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_c_branch/kasia-console/node_modules/@noble/hashes/blake2b.js');
const hex = (a) => Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + hex(blake2b(Uint8Array.from(bytecode), { dkLen: 32 })) + '87';
// 算法自检: 对 P8 存档的 RootStub 重算 P2SH 必须等于其 p2sh_spk_hex
const p8 = JSON.parse(fs.readFileSync('D:/kanet-tn12/docs/provenance/2026-09-13-j2-p8-foldnode-seal-double-count/rootstub_B.derived.json', 'utf8'));
const p8spk = p2sh(Buffer.from(p8.prefix + p8.state + p8.suffix, 'hex'));
if (p8spk !== p8.p2sh_spk_hex) throw new Error(`P2SH 算法自检失败: ${p8spk} ≠ ${p8.p2sh_spk_hex}`);
console.log('P2SH 算法自检 OK (P8 RootStub 重算一致)');
const derive = (f) => { const c = Object.values(JSON.parse(fs.readFileSync(f, 'utf8')).contracts)[0].compiled; const bc = c.bytecode; const { offset, len } = c.state_span;
  return { template_hash: hex(c.template_hash), prefix: hex(bc.slice(0, offset)), state: hex(bc.slice(offset, offset + len)), suffix: hex(bc.slice(offset + len)), spk: p2sh(bc), bytecode_len: bc.length, state_span: c.state_span }; };
const dM = derive('v100_Claim_M.json'), dX = derive('v100_Claim_X.json'), dAmt = derive('v100_Claim_M_amt.json');
if (dM.template_hash !== dX.template_hash || dM.prefix !== dX.prefix || dM.suffix !== dX.suffix) throw new Error('ClaimStub 模板不稳定?');
fs.writeFileSync('claim_M.derived.json', JSON.stringify({ M: dM, X: { spk: dX.spk }, M_amt: { spk: dAmt.spk } }, null, 2));
const H = (n) => '0x' + n.toString(16).padStart(2, '0').repeat(32);
const M = H(0xaa), X = H(0xbb), WIN = H(0x77);
const S = { token_tmpl_hash: H(0x22), token_prefix_len: 1, token_suffix_len: 40, claim_tmpl_hash: '0x' + dM.template_hash, oracle_pk: H(0x33), question_hash: H(0x44), deadline: 1000 };
const ctor = [S.token_tmpl_hash, S.token_prefix_len, S.token_suffix_len, S.claim_tmpl_hash, S.oracle_pk, S.question_hash, S.deadline];
const marketIn = (cov) => ({ utxo_value: 1000, covenant_id: cov, state: S });
const marketOut = (cov) => ({ value: 1000, covenant_id: cov, state: S });
const claimOut = (spk) => ({ value: 500, script_hex: spk });
const args = (amount = 500) => [1, WIN, amount, '0x' + dM.prefix, '0x' + dM.suffix];
const T = (name, expect, tx, a = args()) => ({ name, function: 'payout_claim', constructor_args: ctor, args: a, expect, tx });
const tests = [
  T('p12_market_writes_own_covid_pass', 'pass', { active_input_index: 0, inputs: [marketIn(M)], outputs: [marketOut(M), claimOut(dM.spk)] }),
  T('p12_claim_built_with_attacker_covid_fail', 'fail', { active_input_index: 0, inputs: [marketIn(M)], outputs: [marketOut(M), claimOut(dX.spk)] }),
  T('p12_market_is_X_claim_says_M_fail', 'fail', { active_input_index: 0, inputs: [marketIn(X)], outputs: [marketOut(X), claimOut(dM.spk)] }),
  T('p12_claim_amount_tampered_fail', 'fail', { active_input_index: 0, inputs: [marketIn(M)], outputs: [marketOut(M), claimOut(dAmt.spk)] }),
  T('p12_market_state_tampered_fail', 'fail', { active_input_index: 0, inputs: [marketIn(M)], outputs: [{ value: 1000, covenant_id: M, state: { ...S, deadline: 1001 } }, claimOut(dM.spk)] }),
  T('harness_flip_pass_vector', 'fail', { active_input_index: 0, inputs: [marketIn(M)], outputs: [marketOut(M), claimOut(dM.spk)] }),
];
fs.writeFileSync('P12.test.json', JSON.stringify({ tests }, null, 2));
console.log('tests', tests.length, 'claim tmpl', dM.template_hash.slice(0, 16), 'spk M', dM.spk.slice(0, 20), 'spk X', dX.spk.slice(0, 20));
