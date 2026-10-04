// rehearsal-pre-broadcast-gate.selftest.mjs — 门②(zk_close 彩排)用例拼装的结构自测(账本1832 段4 重写)。
//   旧版拿 2026-07-07 的历史落链数据(T3 代币化之前的 25 参 ctor)逐字节比对——那份数据对当前合约(28 参, zk_close 带 tok_prefix/tok_suffix)已不是同一形状,
//   继续比对只会固化过期结构。现行验证分两层: ① 本文件: 结构/fail-closed 守卫(纯离线); ② 真实数据: docs/provenance/2026-10-04-j2-settle-tokenize-seg4/seg4_gate_zkclose.mjs
//   (用段3 真 Groth16 出证的市场现跑 gateZkClose ⇒ pass, guestPayoutRoot 翻一位 ⇒ fail)。
// Run: cd kasia-console && node src/lib/rehearsal-pre-broadcast-gate.selftest.mjs
import { buildZkCloseDebuggerCase } from './rehearsal-pre-broadcast-gate.mjs';
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const H = (c) => c.repeat(32);
const before = { gateTmplHash: H('aa'), betsRootBaked: H('bb'), refundRootBaked: H('cc'), attestedAtMs: 1783500123456, attestedWinner: 1, closed: 1, payoutRootHex: '00'.repeat(32), consolidatedPool: '3000000000', tokenTmplHash: H('dd'), claimTmplHash: H('ee'), ownRedeemLen: 13328 };
const base = { beforeState: before, witness: { sigScript: '00', gateSuffixHex: '11' }, guestPayoutRootHex: H('99'), selfOutIdx: 0, closeZkUtxoValueSompi: 20000000, gateUtxoValueSompi: 100000000, gateScriptHex: 'aa20' + H('77') + '87', tokPrefixHex: '6b', tokSuffixHex: '6c' };
const c = buildZkCloseDebuggerCase(base).tests[0];
console.log('[test] buildZkCloseDebuggerCase 当前形状:');
ok(c.function === 'zk_close' && c.constructor_args.length === 28, `ctor 28 参(got ${c.constructor_args.length})`);
ok(c.constructor_args[25] === before.tokenTmplHash && c.constructor_args[26] === before.claimTmplHash && c.constructor_args[27] === 13328, 'ctor 尾三项 = token_tmpl_hash / claim_tmpl_hash / own_redeem_len');
ok(c.args.length === 5 && c.args[3] === '6b' && c.args[4] === '6c', 'args = [gateSuffix, guestPayoutRoot, selfOutIdx, tok_prefix, tok_suffix]');
ok(c.tx.outputs[0].value === 20000000 && c.tx.inputs[0].utxo_value === 20000000, '续约/输入面值 = KAS 面值(dust), 不再是池代币量');
ok(c.tx.outputs[0].constructor_args[1] === undefined || c.tx.outputs[0].constructor_args.length === 28, '续约输出 ctor 同为 28 参');
ok(c.tx.outputs[0].constructor_args[5] === 2 && c.tx.outputs[0].constructor_args[6] === H('99'), '续约状态 closed=2, payoutRootField=guestPayoutRoot');
const thr = (o, re, label) => { try { buildZkCloseDebuggerCase(o); ok(false, label + ' 应 throw'); } catch (e) { ok(re.test(e.message), `${label}: ${e.message.slice(0, 70)}`); } };
thr({ ...base, beforeState: { ...before, closed: 0 } }, /closed=0 != 1/, 'closed!=1 fail-closed');
thr({ ...base, tokPrefixHex: undefined }, /tokPrefixHex/, '缺 tok 见证 fail-closed');
thr({ ...base, beforeState: { ...before, ownRedeemLen: undefined } }, /ownRedeemLen/, '缺 own_redeem_len fail-closed');
console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
