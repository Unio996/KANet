// kanettokenclaim-e2e-vectors.mjs — KanetTokenClaim v0.3(方案C)端到端 cli-debugger 向量
// (Bettor 要求"落码前必须有，别等 NWT 催"，2026-09-14)。
//
// 沿用既有 docs/provenance/2026-09-14-j2-t2-kanettokenclaim/mk_kanettokenclaim_vectors.mjs 的既定
// 手法："checkSig 放最后，用占位签名(PLACEHOLDER_SIG)构造向量在 sig 门之前的全部结构检查都独立通过，
// 只在最后的 checkSig 这一步 fail"——本仓库既有的、经过 Bettor 认可的向量纪律。
//
// 🔴 修正记录(2026-09-15, Bettor/NWT 用 silverscript v1.0.0 权威源码订正): 本文件第一版误用了
// extractTemplateArtifact(...).expectedTemplateHashHex(blake2b, 无长度前缀)作为 token_tmpl_hash，
// 导致向量在错误的位置失败。真相(`git -C /d/silverscript show origin/master:silverscript-lang/src/
// template.rs` + `compiler/compile/state.rs`，**不是** `/d/silverscript` 本地工作树——那棵树 HEAD
// 落后 origin/master 64 个提交，是 J2 自己的 OP_PICK 修复分支，绝不能当 v1.0.0 语义的源):
//   template_hash(prefix, suffix) = blake3(i64_8B(prefix.len) ‖ prefix ‖ i64_8B(suffix.len) ‖ suffix)
// `readInputStateWithTemplate`/`validateOutputStateWithTemplate` 内建原语与显式 `blake3(...)` 校验
// 用的是**同一个公式**，都等于 `compileSilV100(...).template_hash_bytes`——`pool-template-artifact.mjs`
// 的 `extractTemplateArtifact`(blake2b 公式)是对照旧版编译器订的，v1.0.0 换了公式后这个 helper
// 没跟上，产出的值是错的(此次修法不改这个文件，由 Bettor 另行派工评估影响面)。
// 另外 `readInputStateWithTemplate` 在核 hash **之前**先核 `input_scriptPubKey ==
// ScriptPubKeyP2SHFromRedeemScript(输入自己 sigScript 里的完整字节)`——本文件 v1 版漏了这一步
// (token 输入没给 P2SH 包装的 scriptPubKey)，第一次向量失败在这里，不是 hash 公式的问题。
//
// Run(从 kasia-console 目录跑):
//   cd kasia-console && node ../docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b/kanettokenclaim-e2e-vectors.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../kasia-console/src/lib/pool-bshard-artifacts.mjs';
const require = createRequire(import.meta.url);
const { blake2b } = require('../../../kasia-console/node_modules/@noble/hashes/blake2b.js');

const DIR = '../docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b';
const KTT_SIL = `${DIR}/KanetTestToken.v0.3-planC.sil`;
const KTC_SIL = `${DIR}/KanetTokenClaim.v0.3-planC.sil`;

const byteN = (n) => ({ kind: 'byte', value: n });
const hex = (buf) => '0x' + Buffer.from(buf).toString('hex');
// P2SH scriptPubKey 包装(同 kaspa 协议约定, blake2b——与 silverscript 的 template_hash blake3 是两回事,
// 不要混):`OP_BLAKE2B PUSH32<hash> OP_EQUAL`，同既有 mk_kanettokenclaim_vectors.mjs / NWT 供的
// nwt_build_claim_vectors.mjs 的 p2sh() 手法一致。
const p2sh = (bc) => 'aa20' + Buffer.from(blake2b(Uint8Array.from(bc), { dkLen: 32 })).toString('hex') + '87';
const p2shBuf = (bc) => Buffer.from(p2sh(bc), 'hex');

// 手写编码 KTT 的 State(6 字段: amount/owner/owner_scheme/borrow_scheme/borrow_guard/extension_commitment),
// 同既有 AB11 编码惯例("1字节长度头+值")——用于构造 validateOutputStateWithInputTemplate 期望的续约输出:
// P2SH(tok_prefix ‖ encodeState(newFields) ‖ tok_suffix), 复用消费方 t 的真实 prefix/suffix(不是重新编译
// 一份不同 ctor 的 KTT——那是另一个模板, P2SH 会对不上)。
// 🔴 实测订正(2026-09-15): int 字段的 8 字节值是【小端】, 不是此前记忆里认定的大端——用真实
// compileSilV100 重编译("fresh")与本函数手拼("spliced")逐字节比对才发现(diff 在 state 区第 2
// 字节: fresh=64 00.. 即 LE 100, 手拼原写大端=00..64 BE)。长度头(1 字节)本身之前就是对的,
// 错的只是多字节 int 值内部的字节序——之前只验过总长度匹配, 没有逐字节核对过真值。
function encodeState({ amount, owner, owner_scheme = 4, borrow_scheme = 0, borrow_guard = ZERO32, extension_commitment = ZERO32 }) {
  const int9 = (n) => { const b = Buffer.alloc(9); b[0] = 8; b.writeBigInt64LE(BigInt(n), 1); return b; };
  const byte32 = (buf) => Buffer.concat([Buffer.from([32]), buf]);
  const byte1 = (n) => Buffer.from([1, n]);
  return Buffer.concat([int9(amount), byte32(owner), byte1(owner_scheme), byte1(borrow_scheme), byte32(borrow_guard), byte32(extension_commitment)]);
}
function continuationScript(t, newFields) {
  const { start, len } = t.state_layout;
  const prefix = t.script.subarray(0, start);
  const suffix = t.script.subarray(start + len);
  return Buffer.concat([prefix, encodeState(newFields), suffix]);
}

const ZERO32 = Buffer.alloc(32, 0x00);
const CLAIM_COV = Buffer.alloc(32, 0xcc);
const STRANGER_COV = Buffer.alloc(32, 0x99);
const SHELL_COV = Buffer.alloc(32, 0x77); // 假壳目标: 任意 covenant, 不是市场也不是任何已知类型
const WINNER_PK = Buffer.alloc(32, 0x22);
const PLACEHOLDER_SIG = '0x' + '00'.repeat(65);

console.log('=== ① 编译 KanetTestToken v0.3(占位代币, 用于构造真实代币输入) ===');
function compileKTT(ownerCovBuf, amount) {
  const ctor = [ctorIntV100(amount), ctorBytes32V100(ownerCovBuf.toString('hex')), byteN(4), byteN(0), ctorBytes32V100(ZERO32.toString('hex')), ctorBytes32V100(ZERO32.toString('hex')), ctorIntV100(3), ctorIntV100(3)];
  const compiled = compileSilV100(KTT_SIL, ctor, 'KanetTestToken');
  const script = Buffer.from(compiled.script);
  const templateHashHex = Buffer.from(compiled.template_hash_bytes).toString('hex'); // 权威值: blake3(i64_8B+prefix+i64_8B+suffix)
  return { script, scriptPubKeyHex: '0x' + p2sh(script), templateHashHex, state_layout: compiled.state_layout };
}
const tokOwnedByClaim = compileKTT(CLAIM_COV, 100);
const tokOwnedByStranger = compileKTT(STRANGER_COV, 100);
console.log('token_tmpl_hash(权威值, compiled.template_hash_bytes):', tokOwnedByClaim.templateHashHex);
if (tokOwnedByClaim.templateHashHex !== tokOwnedByStranger.templateHashHex) throw new Error('template invariance broken(不同 owner 应该产出相同 token_tmpl_hash)');

// tok_prefix/tok_suffix witness: 从真实编译产物按 state_layout 边界切(同 readInputStateWithTemplate
// 内部逻辑一致的切法——prefix = bytecode[..start], suffix = bytecode[start+len..])。
function prefixSuffixOf(t) {
  const { start, len } = t.state_layout;
  return { prefix: t.script.subarray(0, start), suffix: t.script.subarray(start + len) };
}
const psClaim = prefixSuffixOf(tokOwnedByClaim);
const psStranger = prefixSuffixOf(tokOwnedByStranger);

console.log('\n=== ② 编译 KanetTokenClaim v0.3(方案C, 无 market_suffix_hash ctor) ===');
const ktcCtor = [ctorBytes32V100(STRANGER_COV.toString('hex')) /* market_cov_id, 展示用, 不参与本次检查 */, ctorBytes32V100(WINNER_PK.toString('hex')), ctorIntV100(100), ctorBytes32V100(tokOwnedByClaim.templateHashHex)];
const ktcCompiled = compileSilV100(KTC_SIL, ktcCtor, 'KanetTokenClaim');
console.log('KanetTokenClaim 脚本长度:', ktcCompiled.script.length);

function tokenInput(t) {
  // 🔴 关键修正: 必须同时给 scriptPubKey(P2SH 包装, 供 readInputStateWithTemplate 的
  // input_scriptPubKey==ScriptPubKeyP2SHFromRedeemScript(...) 这条先手检查)和 signature_script_hex
  // (完整编译产物字节, 代表这个 input 花费时揭示的真实 redeem script——KTT genesis 不需要签名,
  // 所以 sigScript 就是纯 redeem 字节, 不需要额外 witness 前缀)。
  return { utxo_value: 10, utxo_script_hex: t.scriptPubKeyHex, signature_script_hex: hex(t.script) };
}

const constructorArgs = [hex(STRANGER_COV), hex(WINNER_PK), 100, '0x' + tokOwnedByClaim.templateHashHex];

const tests = [];

// V03-CLAIM-1(取代旧 V-CLAIM-6): 目标是一个"假壳"covenant(既不是市场也不是任何已知类型, 尾部字节
// 也完全不匹配任何东西)——旧设计下这必须被拒(V-CLAIM-6), v0.3 下这应该【只在 sig 门失败】(结构性
// 全部通过), 因为"目标必须是市场"这条检查已经不存在。这个行为反转本身就是删除生效的直接证据。
tests.push({
  name: 'V03-CLAIM-1_fail_only_at_sig_gate_shell_destination_now_structurally_accepted',
  function: 'spend',
  constructor_args: constructorArgs,
  args: [PLACEHOLDER_SIG, 1, 2, true, 2, hex(psClaim.prefix), hex(psClaim.suffix)],
  expect: 'fail', // 只在 sig 门失败(占位签名必然验不过), 不是在市场识别这一步失败
  tx: {
    active_input_index: 0,
    inputs: [
      { utxo_value: 1, covenant_id: hex(CLAIM_COV), signature_script_hex: '0x00' + 'ff'.repeat(20) },
      tokenInput(tokOwnedByClaim),
      { utxo_value: 1, covenant_id: hex(SHELL_COV), signature_script_hex: '0x00' + 'aabbcc' }, // 假壳: 任意尾部, 旧设计下必被拒
    ],
    outputs: [{ value: 1 }, { value: 1 }, { value: 1, script_hex: hex(p2shBuf(continuationScript(tokOwnedByClaim, { amount: 100, owner: SHELL_COV }))) }],
  },
});

// V03-CLAIM-2(=旧 V-CLAIM-5, 未变): 被消费的代币不归本 claim 所有(偷一个恰好同笔存在的陌生人代币)——
// 这条检查(H1 在场纪律最后一步)完全没有被本次改动触及, 应该继续在 ownership 检查这一步就拒绝
// (不是"结构性通过只差签名", 是真的更早失败——如果这个向量意外变成 fail-only-at-sig-gate, 说明
// ownership 检查被误删了)。
tests.push({
  name: 'V03-CLAIM-2_fail_token_not_owned_by_this_claim_unchanged_by_v03',
  function: 'spend',
  constructor_args: constructorArgs,
  args: [PLACEHOLDER_SIG, 1, 2, true, 2, hex(psStranger.prefix), hex(psStranger.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [
      { utxo_value: 1, covenant_id: hex(CLAIM_COV), signature_script_hex: '0x00' + 'ff'.repeat(20) },
      tokenInput(tokOwnedByStranger),
      { utxo_value: 1, covenant_id: hex(SHELL_COV), signature_script_hex: '0x00' + 'aabbcc' },
    ],
    outputs: [{ value: 1 }, { value: 1 }, { value: 1, script_hex: hex(p2shBuf(continuationScript(tokOwnedByStranger, { amount: 100, owner: SHELL_COV }))) }],
  },
});

// V03-CLAIM-3(=旧 V-CLAIM-8, 未变, to_market_input=false 路径): dest_idx 指向一个"裸"输出(未声明
// covenant_id)——OpOutputCovenantId 回退 ZERO_HASH, 必须被【保留】的 require(target_owner!=ZERO32) 挡下。
tests.push({
  name: 'V03-CLAIM-3_fail_bare_output_destination_zero_owner_rejected_kept_guard',
  function: 'spend',
  constructor_args: constructorArgs,
  args: [PLACEHOLDER_SIG, 1, 1, false, 0, hex(psClaim.prefix), hex(psClaim.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [
      { utxo_value: 1, covenant_id: hex(CLAIM_COV), signature_script_hex: '0x00' + 'ff'.repeat(20) },
      tokenInput(tokOwnedByClaim),
    ],
    outputs: [{ value: 1 }, { value: 1 }], // 输出[0] 未声明 covenant_id
  },
});

// V03-CLAIM-4(=旧 V-CLAIM-9, 未变, to_market_input=true 路径): dest_idx 指向一个"裸"输入(未声明
// covenant_id)——即使(v0.3 下已经不存在的)尾部匹配这条检查还在也不该替代 covenant 绑定背书;
// 现在这条检查已经删除, 更要单独确认 ZERO32 守卫本身依然独立生效, 不依赖任何已删除的旁路。
tests.push({
  name: 'V03-CLAIM-4_fail_dest_input_bare_no_covenant_id_zero32_guard_kept',
  function: 'spend',
  constructor_args: constructorArgs,
  args: [PLACEHOLDER_SIG, 1, 2, true, 2, hex(psClaim.prefix), hex(psClaim.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [
      { utxo_value: 1, covenant_id: hex(CLAIM_COV), signature_script_hex: '0x00' + 'ff'.repeat(20) },
      tokenInput(tokOwnedByClaim),
      { utxo_value: 1, signature_script_hex: '0x00' + 'aabbcc' }, // 裸输入, 无 covenant_id
    ],
    outputs: [{ value: 1 }, { value: 1 }, { value: 1, script_hex: hex(p2shBuf(continuationScript(tokOwnedByClaim, { amount: 100, owner: SHELL_COV }))) }],
  },
});

writeFileSync(`${DIR}/kanettokenclaim-v03-vectors.test.json`, JSON.stringify({ tests }, null, 1));
console.log(`\n已生成 ${tests.length} 条向量: ${DIR}/kanettokenclaim-v03-vectors.test.json`);
