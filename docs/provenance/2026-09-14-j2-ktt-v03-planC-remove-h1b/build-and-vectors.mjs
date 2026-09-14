// build-and-vectors.mjs — KTT v0.3(方案C, 删 H1(b))真实编译 + cli-debugger 向量。
// 不改任何生产 .sil 文件——用本目录下的实验性副本 KanetTestToken.v0.3-planC.sil。
// Run(从 kasia-console 目录跑): cd kasia-console && node ../docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b/build-and-vectors.mjs
import { writeFileSync } from 'node:fs';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../kasia-console/src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../../../kasia-console/src/lib/pool-template-artifact.mjs';

const DIR = '../docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b';
const SIL = `${DIR}/KanetTestToken.v0.3-planC.sil`;
const Z32 = '00'.repeat(32);
const byteN = (n) => ({ kind: 'byte', value: n });

console.log('=== ① 真实编译 v0.3(方案C) ===');
const ctor = [ctorIntV100(0), ctorBytes32V100(Z32), byteN(4), byteN(0), ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorIntV100(3), ctorIntV100(3)];
const compiled = compileSilV100(SIL, ctor, 'KanetTestToken');
console.log('脚本长度:', compiled.script.length, '(对照: v0.1原设计3471-5359B视版本, v0.3方案C更小——删除整个市场识别机制)');
console.log('state_layout:', JSON.stringify(compiled.state_layout));
const artifact = extractTemplateArtifact(compiled);
console.log('token_tmpl_hash:', artifact.expectedTemplateHashHex);

console.log('\n=== ② 生成 cli-debugger 向量: 正向"收方为任意 covenant 输入" + 负向"owner 不在场" ===');
const owner = '11'.repeat(32);
const zero32 = '00'.repeat(32);
const arbitraryRecipientCovId = '99'.repeat(32); // 完全任意的 covenant id, 不是任何"市场"类型
const constructorArgs = [100, '0x' + owner, 4, 0, '0x' + zero32, '0x' + zero32, 3, 3];

const baseState = (amount, ownerHex) => ({ amount, owner: '0x' + ownerHex, owner_scheme: 4, borrow_scheme: 0, borrow_guard: '0x' + zero32, extension_commitment: '0x' + zero32 });

const testFile = {
  tests: [
    {
      // 🔴 重要澄清(实测才搞清楚的语义, 不是最初假设的那样): DECL.md"verification mode"原文——
      // "Generated entrypoint args are new_states plus optional extra call args"——args[0] 是
      // NEXT_STATES(调用方声明"转账后应该长什么样"), 不是 prev_states！prev_states 反而是从
      // tx.inputs[] 里带 state 字段的那些输入自动读回来的(同既有 V-T-1 向量的真实结构, 当时误
      // 读成"args[0]=prev_states"是我最初的理解错误, 这次跑向量才用真实调试器行为订正过来)。
      // ownerIsMarketInput 真正检查的是"next_states[j].owner 这个 byte32 值是否对应本 tx 里某个
      // 真实在场的 covenant 输入"——v0.3 删掉后, owner 可以是任意值(只要非 ZERO32), 不需要对应
      // 任何真实在场输入, 也不需要该输入的 sigScript 尾部匹配任何东西。
      name: 'V03-1_pass_owner_field_is_arbitrary_value_no_presence_check',
      function: 'transfer',
      constructor_args: constructorArgs,
      // args[0] = next_states(转账后的新状态, owner=任意值, 不对应任何真实在场输入)
      args: [[baseState(100, arbitraryRecipientCovId)], '0x', [0]],
      expect: 'pass',
      tx: {
        active_input_index: 0,
        inputs: [
          { utxo_value: 1, covenant_id: '0x' + owner, state: baseState(100, owner) }, // prev_states[0] 从这里自动读回
        ],
        outputs: [
          { value: 1, covenant_id: '0x' + owner, state: baseState(100, arbitraryRecipientCovId) }, // 必须与 args[0] 一致(供 validateOutputState 比对)
        ],
      },
    },
    {
      name: 'V03-2_fail_owner_not_present_at_claimed_index',
      function: 'transfer',
      constructor_args: constructorArgs,
      args: [[baseState(100, owner)], '0x', [0]],
      expect: 'fail',
      tx: {
        active_input_index: 0,
        inputs: [
          // covenant_id 故意跟 prev_states[0].owner 对不上(owner 不在场)
          { utxo_value: 1, covenant_id: '0x' + arbitraryRecipientCovId, state: baseState(100, owner) },
        ],
        outputs: [
          { value: 1, covenant_id: '0x' + arbitraryRecipientCovId, state: baseState(100, arbitraryRecipientCovId) },
        ],
      },
    },
  ],
};
writeFileSync(`${DIR}/ktt-v03-vectors.test.json`, JSON.stringify(testFile, null, 1));
console.log('已生成', `${DIR}/ktt-v03-vectors.test.json`);

console.log('\n=== ③ 真实编译 KanetTokenClaim v0.3(方案C, 账本1409扩大范围) ===');
const KTC_SIL = `${DIR}/KanetTokenClaim.v0.3-planC.sil`;
const ktcCtor = [ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorIntV100(100), ctorBytes32V100(Z32)];
const ktcCompiled = compileSilV100(KTC_SIL, ktcCtor, 'KanetTokenClaim');
console.log('KanetTokenClaim 脚本长度:', ktcCompiled.script.length, '(对照: 旧设计 1454 B)');
const ktcArtifact = extractTemplateArtifact(ktcCompiled);
console.log('claim_tmpl_hash:', ktcArtifact.expectedTemplateHashHex);
console.log('(未构造完整 cli-debugger 向量, 见 README "已知限制")');
