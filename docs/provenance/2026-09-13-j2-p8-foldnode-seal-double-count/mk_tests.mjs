// P8 + C1 向量生成（J2 2026-09-13）· FoldNode 诊断副本(只加 allow 注解) · RootStub 作 root 模板
import fs from 'node:fs';
const P = 'D:/kanet-tn12/scratch/_j2_p8';
const d = JSON.parse(fs.readFileSync(`${P}/rootstub_B.derived.json`, 'utf8'));
const ones32 = '0x' + '11'.repeat(32), zero32 = '0x' + '00'.repeat(32);
const COV_X = '0x' + 'aa'.repeat(32), COV_Y = '0x' + 'bb'.repeat(32);
const SHARD_COUNT = 3, MAX_FAN_IN = 4;
// ctor: market_id, commit_v2, shard_count, max_fan_in, root_tmpl_hash, root_init_payoutRoot, init_local_yes, init_local_no, init_count, init_pool_value
const ctor = [ones32, ones32, SHARD_COUNT, MAX_FAN_IN, '0x' + d.template_hash, zero32, 0, 0, 0, 0];
// A = 未折满 (count 1, pool 50); B = 已折满 (count == shard_count = 3, pool 100)
const A = { local_yes: 10, local_no: 40, count: 1, pool_value: 50 };
const B = { local_yes: 30, local_no: 70, count: 3, pool_value: 100 };
const SUM = { local_yes: 40, local_no: 110, count: 4, pool_value: 150 };
const inA = { utxo_value: 50, covenant_id: COV_X, state: A };
const inB = { utxo_value: 100, covenant_id: COV_X, state: B };
const inB_otherCov = { utxo_value: 100, covenant_id: COV_Y, state: B };
const leafOut = (s) => ({ value: s.pool_value, covenant_id: COV_X, state: s });
const rootOut = { value: 100, script_hex: d.p2sh_spk_hex };   // RootStub(B 的 sealed 7-field state) 的 P2SH spk
const sealArgs = (rootOutIdx) => [rootOutIdx, '0x' + d.prefix, '0x' + d.suffix];
const T = (name, fn, expect, tx, args = []) => ({ name, function: fn, constructor_args: ctor, args, expect, tx });

const tests = [
  // ── P8: 同一笔组合 tx, 两个输入各自的脚本是否都接受 ──
  T('p8_fold_leader_accepts_group_with_sealed_B', 'fold', 'pass',
    { active_input_index: 0, inputs: [inA, inB], outputs: [leafOut(SUM), rootOut] }),
  T('p8_seal_to_root_B_accepts_same_tx', 'seal_to_root', 'pass',
    { active_input_index: 1, inputs: [inA, inB], outputs: [leafOut(SUM), rootOut] }, sealArgs(1)),
  // 对照: 只有 B 单输入走 seal(合法形)
  T('c1_single_input_seal_pass', 'seal_to_root', 'pass',
    { active_input_index: 0, inputs: [inB], outputs: [rootOut] }, sealArgs(0)),
  // C1 反向量(修后应 fail): 同 cov 两输入, B 跑 seal —— 现状预期 pass = 缺口存在
  T('c1_two_same_cov_inputs_seal_CURRENTLY_PASSES', 'seal_to_root', 'pass',
    { active_input_index: 1, inputs: [inA, inB], outputs: [leafOut(SUM), rootOut] }, sealArgs(1)),
  // C1 弱注入: 第二输入换成【不同】cov id ⇒ 修后也应 pass(判的是同 cov 计数)
  T('c1_second_input_not_our_cov_seal_pass', 'seal_to_root', 'pass',
    { active_input_index: 1, inputs: [{ utxo_value: 50 }, inB], outputs: [{ value: 50, script_hex: d.p2sh_spk_hex }, rootOut] }, sealArgs(1)),   // 裸(非 covenant)第二输入: 修后也应 pass(判的是同 cov 计数)
  // C1 fold 对照: 同 cov 两输入走 fold(cov 声明自己管组) ⇒ pass (count_sum 2 ≠ shard_count 3, 不触发 commit_v2 校验)
  T('c1_fold_control_two_inputs_pass', 'fold', 'pass',
    { active_input_index: 0, inputs: [inA, { utxo_value: 100, covenant_id: COV_X, state: { local_yes: 30, local_no: 70, count: 1, pool_value: 100 } }], outputs: [leafOut({ local_yes: 40, local_no: 110, count: 2, pool_value: 150 })] }),
  // P8 后果: 双记后的 leaf(count 4 ≠ shard_count 3) 再也 seal 不了 ⇒ 其 150 KAS(含 A 的 50)只剩 fold 路
  T('p8_aftermath_leaf_count4_cannot_seal', 'seal_to_root', 'fail',
    { active_input_index: 0, inputs: [{ utxo_value: 150, covenant_id: COV_X, state: SUM }], outputs: [{ value: 150, script_hex: d.p2sh_spk_hex }] }, sealArgs(0)),
  // P8 基线: 不带 B 的 fold(单 A 输入)⇒ pass, 证 fold 本身不依赖 B
  T('p8_baseline_fold_A_alone', 'fold', 'pass',
    { active_input_index: 0, inputs: [inA], outputs: [leafOut(A)] }),
  // harness 自检: seal 的 root 输出 value 改错 ⇒ 必 fail(证 seal 真在核 value weld)
  T('h_seal_root_value_wrong_fails', 'seal_to_root', 'fail',
    { active_input_index: 1, inputs: [inA, inB], outputs: [leafOut(SUM), { value: 99, script_hex: d.p2sh_spk_hex }] }, sealArgs(1)),
  // harness 自检: fold 的 leaf 和算错 ⇒ 必 fail
  T('h_fold_sum_wrong_fails', 'fold', 'fail',
    { active_input_index: 0, inputs: [inA, inB], outputs: [leafOut({ ...SUM, pool_value: 149 }), rootOut] }),
];
fs.writeFileSync(`${P}/FoldNode_diag.test.json`, JSON.stringify({ tests }, null, 2));
fs.writeFileSync(`${P}/FoldNode_diag.args.json`, JSON.stringify(ctor.map(v => typeof v === 'number' ? { kind: 'int', value: v } : { kind: 'bytes', value: [...Buffer.from(v.slice(2), 'hex')] })));
console.log('tests', tests.length);
