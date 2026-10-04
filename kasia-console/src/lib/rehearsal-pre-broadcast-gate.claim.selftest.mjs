// rehearsal-pre-broadcast-gate.claim.selftest.mjs — 门③(claim 彩排)用例拼装的结构自测(账本1832 段4 重写)。
//   旧版比对 T3 之前的 claim 回归用例(25 参 ctor + 裸 P2PK 派彩), 与当前代币化 CloseZkV2.claim 不是同一形状。现行验证: ① 本文件(结构/守卫, 离线);
//   ② 真实: seg4_synthetic.mjs GATE_TEST=1(同一 closed==3 状态上 gateTokenClaim 诚实 ⇒ pass / 金额被改 ⇒ fail, 结果 seg4_gate_test.json)。
// Run: cd kasia-console && node src/lib/rehearsal-pre-broadcast-gate.claim.selftest.mjs
import { buildTokenClaimDebuggerCase } from './rehearsal-pre-broadcast-gate.mjs';
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const H = (c) => c.repeat(32);
const before = { gateTmplHash: H('aa'), betsRootBaked: H('bb'), refundRootBaked: H('cc'), attestedAtMs: 1783500123456, attestedWinner: 1, closed: 2, payoutRootHex: H('dd'), consolidatedPool: '3000000000', tokenTmplHash: H('ee'), claimTmplHash: H('ff'), ownRedeemLen: 13328 };
const dump = { selfOutIdx: 0, claimOutIdx: 1, tokOutIdx: 2, remainOutIdx: 3,
  inputs: [{ prev_txid: H('01'), prev_index: 0, utxo_value: '20000000', utxo_script_hex: 'aa20' + H('02') + '87', covenant_id: H('03'), signature_script_hex: '00' }, { prev_txid: H('04'), prev_index: 1, utxo_value: '40000000', signature_script_hex: '01' }, { prev_txid: H('05'), prev_index: 0, utxo_value: '350000000', signature_script_hex: '02' }],
  outputs: [{ value: '20000000', script_hex: 'aa20' + H('06') + '87', covenant_id: H('03'), authorizing_input: 0 }, { value: '100000000', script_hex: 'aa20' + H('07') + '87', covenant_id: H('08'), authorizing_input: 2 }] };
const witness = { bettor_pk: H('09'), amount: '1000000000', merkle_index: 2, siblings_hex: Array.from({ length: 10 }, (_, i) => String(i).padStart(2, '0').repeat(32)), tok_prefix_hex: '6b', tok_suffix_hex: '6c', claim_prefix_hex: '6d', claim_suffix_hex: '6e' };
const t = buildTokenClaimDebuggerCase({ kind: 'claim', beforeState: before, dump, witness }).tests[0];
console.log('[test] buildTokenClaimDebuggerCase 当前形状:');
ok(t.function === 'claim' && t.constructor_args.length === 28 && t.constructor_args[27] === 13328, 'function=claim, ctor 28 参(尾 own_redeem_len)');
ok(t.args.length === 8 + 10 + 4 && t.args[0] === 0 && t.args[1] === 1 && t.args[2] === 1 && t.args[3] === 2 && t.args[4] === 3, 'args = 5 个 idx + bettorPk/amount/merkle_index + 10 siblings + tok/claim 模板见证(共 22)');
ok(t.tx.outputs[1].authorizing_input === 2 && t.tx.outputs[0].authorizing_input === 0, '续约(authInput 0) 与 genesis 输出(authInput=fee 输入 2)分别标注授权输入');
ok(t.tx.inputs[0].covenant_id === '0x' + H('03'), '输入 covenant id 透传(合约读 OpInputCovenantId)');
const e = buildTokenClaimDebuggerCase({ kind: 'escape_claim', beforeState: { ...before, closed: 3 }, dump, witness }).tests[0];
ok(e.function === 'escape_claim' && e.constructor_args[5] === 3, 'escape_claim: closed==3');
const thr = (fn, re, l) => { try { fn(); ok(false, l + ' 应 throw'); } catch (x) { ok(re.test(x.message), `${l}: ${x.message.slice(0, 70)}`); } };
thr(() => buildTokenClaimDebuggerCase({ kind: 'claim', beforeState: { ...before, closed: 3 }, dump, witness }), /closed=3 != 2/, 'claim 遇 closed!=2 fail-closed');
thr(() => buildTokenClaimDebuggerCase({ kind: 'refund_claim', beforeState: before, dump, witness }), /不支持/, '未知 kind fail-closed');
console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
