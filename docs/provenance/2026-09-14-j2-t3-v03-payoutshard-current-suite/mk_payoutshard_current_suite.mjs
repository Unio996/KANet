// PayoutShard.sil — 完整现行向量套件（ledger 1209，Bettor 裁：历史快照因 ctor 演进(23→25参数)不适用重跑，
// 必须按当前 ctor 重生成一份完整套件，覆盖 absorb(含 sole-source 6 条 + 1122 边界 3 条 + V-outbind + witness
// 错) / close_attest / cancel_attest / claim / refund_claim(含 draw-down 恰好为 0)）。
//
// 本文件把三份历史生成器(absorb-ab11-and-batest 的 absorb+battest、claim-family-tokenization、
// absorb-sole-source-fix)的向量构造逻辑在【当前 25 参数 ctor】下重新生成，加上一批全新的 absorb 1122
// 边界向量(此前从未存在——1122 边界只在 noTokenInput 侧补过, scanOwnedTokenInputs 侧从未单独补过)。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildMerkle, proveMerkle, root, hex, le8 } from '../2026-09-14-j2-t3-v03-drawdown-mustfix/merkle.mjs';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const { blake3 } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake3.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const KTT = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/sil-v1/KanetTestToken.sil';
const KTC = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/KanetTokenClaim.sil';
const PS = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/PayoutShard.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const PS_COV = new Array(32).fill(0xaa);
const LEAF_COV = new Array(32).fill(0xbb);
const STRANGER_COV = new Array(32).fill(0x99);
const BETTOR_PK = new Array(32).fill(0x22);
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];
const OTHER_SIG = '0x00' + 'ff'.repeat(20);
const ZERO_SIG = '0x' + '00'.repeat(65);
const MERKLE_INDEX = 5;
const DEPTH = 10;

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/PSCS_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/PSCS_${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${sil}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}
function compileKTT(ownerCov, amount, tag) {
  const ctor = [
    { kind: 'int', value: amount }, { kind: 'bytes', value: ownerCov }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
    { kind: 'bytes', value: MARKET_TMPL_SUFFIX }, { kind: 'int', value: MARKET_TMPL_SUFFIX.length },
    { kind: 'int', value: 3 }, { kind: 'int', value: 3 },
  ];
  return compileGeneric(KTT, ctor, `ktt_${tag}`);
}
function compileKTC({ marketCovId, winnerPk, amount, tokenTmplHash, marketSuffixHash }, tag) {
  const ctor = [
    { kind: 'bytes', value: marketCovId }, { kind: 'bytes', value: winnerPk }, { kind: 'int', value: amount },
    { kind: 'bytes', value: tokenTmplHash }, { kind: 'bytes', value: marketSuffixHash },
  ];
  return compileGeneric(KTC, ctor, `ktc_${tag}`);
}

const ktcAnchor = compileKTC({ marketCovId: ZERO32, winnerPk: ZERO32, amount: 0, tokenTmplHash: ZERO32, marketSuffixHash: ZERO32 }, 'anchor');
const claimTmplHash = ktcAnchor.templateHash;
const tokAnchor = compileKTT(PS_COV, 1, 'anchor');
const tokenTmplHash = tokAnchor.templateHash;
const marketSuffixHash = [...blake3(Uint8Array.from(MARKET_TMPL_SUFFIX))];

// ---- CURRENT 25-param ctor (poolMerkleRoot, predicate_commit, token_tmpl_hash, init_consolidated_pool,
// init_closed, init_payoutRoot, init_w0..w16(17), claim_tmpl_hash, market_suffix_hash) ----
function psCtor({ consolidated_pool, closed = 0, payoutRoot = ZERO32, w = new Array(17).fill(0) }) {
  return [hex(ZERO32), hex(ZERO32), hex(tokenTmplHash), consolidated_pool, closed, hex(payoutRoot), ...w, hex(claimTmplHash), hex(marketSuffixHash)];
}
function toCtorObjs(arr) {
  return arr.map((v) => (typeof v === 'string' && v.startsWith('0x')) ? { kind: 'bytes', value: [...Buffer.from(v.slice(2), 'hex')] } : { kind: 'int', value: v });
}
function compilePS(ctorOverrides, tag) { return compileGeneric(PS, toCtorObjs(psCtor(ctorOverrides)), `ps_${tag}`); }
function shardInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function activeSelfInput(instance) { return { utxo_value: 1, covenant_id: hex(PS_COV), utxo_script_hex: instance.scriptHex, signature_script_hex: instance.fullBytecodeHex }; }
function fillerInput() { return { utxo_value: 1, covenant_id: hex(PS_COV), signature_script_hex: OTHER_SIG }; }
const claimCovId = new Array(32).fill(0xdd);
function claimFillerInput() { return { utxo_value: 1, covenant_id: hex(claimCovId), signature_script_hex: '0x00ff' }; }

const psActive100 = compilePS({ consolidated_pool: 100 }, 'active_100');
const psCont150 = compilePS({ consolidated_pool: 150 }, 'cont_150');
const psCont150WrongClosed = compilePS({ consolidated_pool: 150, closed: 1 }, 'cont_150_wrong_closed');
const psCont150WrongRoot = compilePS({ consolidated_pool: 150, payoutRoot: new Array(32).fill(0x77) }, 'cont_150_wrong_root');
const w5wrong = new Array(17).fill(0); w5wrong[5] = 42;
const psCont150WrongW5 = compilePS({ consolidated_pool: 150, w: w5wrong }, 'cont_150_wrong_w5');
const psOwn100 = compileKTT(PS_COV, 100, 'ps_own_100');
const shard50 = compileKTT(LEAF_COV, 50, 'shard_50');
const psOwn30 = compileKTT(PS_COV, 30, 'ps_own2_30');
const psOut150 = compileKTT(PS_COV, 150, 'ps_out_150');
const psOut130wrong = compileKTT(PS_COV, 130, 'ps_out_130_wrong');
const psOut150Stranger = compileKTT(STRANGER_COV, 150, 'ps_out_150_stranger');
const strayAt7 = compileKTT(STRANGER_COV, 1, 'stray_at_index7');   // genuinely non-self-owned, for V-absorb-14

const tests = [];

// ================= absorb: 10 既有(V-absorb-3 已停用, 见下方说明) =================
tests.push({
  name: 'V-absorb-1_pass_owned_plus_incoming_shard', function: 'absorb', expect: 'pass',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut150.scriptHex }] },
});
tests.push({
  name: 'V-absorb-2_fail_smuggled_second_owned_token_uncounted', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 3, 3, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(psOwn30), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut150.scriptHex }] },
});
// V-absorb-3(原"stranger 同模板在场合法不计入,pass")在 ledger 1208 sole-source MUST-FIX 之后【结构性停用】：
// 修复要求"排除 shardInIdx 后不得存在第二个同模板非自持输入"，一笔无关陌生人(stranger)的同模板代币现在
// 与"另一个被静默销毁的合法 leaf"在链上无法区分——新设计故意把两者同等对待、一律拒绝(安全默认收紧，不是
// 回归)。这个场景的负向量版本已经是 sole-source 套件里的 V-SSF-4(见下方直接并入)，不重造一份重复的。
tests.push({
  name: 'V-absorb-4_fail_output_diverted_to_stranger_owner', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut150Stranger.scriptHex }] },
});
tests.push({
  name: 'V-absorb-5_fail_output_wrong_amount', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut130wrong.scriptHex }] },
});
tests.push({
  name: 'V-absorb-6_fail_self_output_below_dust_min', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut150.scriptHex }] },
});
tests.push({
  name: 'V-absorb-7_fail_self_continuation_wrong_closed_field', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150WrongClosed.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut150.scriptHex }] },
});
tests.push({
  name: 'V-absorb-8_fail_self_continuation_wrong_payoutRoot_field', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150WrongRoot.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut150.scriptHex }] },
});
tests.push({
  name: 'V-absorb-9_fail_self_continuation_wrong_w5_field', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150WrongW5.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut150.scriptHex }] },
});
tests.push({
  name: 'V-absorb-10_fail_witness_wrong_tok_prefix_blake3_mismatch', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex([0xff]), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut150.scriptHex }] },
});
tests.push({
  name: 'V-absorb-11_fail_witness_wrong_tok_suffix_blake3_mismatch', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex([0xff, 0xff])],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut150.scriptHex }] },
});

// ================= absorb: NEW 1122 边界向量(scanOwnedTokenInputs/countStrayNonOwnedTokenInputs 侧,
// 此前只在 noTokenInput 侧补过, absorb 侧从未单独证过) =================
// 8 输入 = self(active) + shardInIdx token + 6 filler(PS_COV covenant, 非代币形状) -- 恰好=界, 干净放行.
tests.push({
  name: 'V-absorb-12_pass_at_bound_8_inputs_clean',
  function: 'absorb', expect: 'pass',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: {
    active_input_index: 0,
    inputs: [activeSelfInput(psActive100), shardInput(psOwn100), shardInput(shard50), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut150.scriptHex }],
  },
});
// 9 输入(界+1) -- 被 scanOwnedTokenInputs 内部的 require(tx.inputs.length<=MAX_INS_SCAN) 挡下.
tests.push({
  name: 'V-absorb-13_fail_bound_plus_one_9_inputs_rejected_by_length_guard',
  function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: {
    active_input_index: 0,
    inputs: [activeSelfInput(psActive100), shardInput(psOwn100), shardInput(shard50), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut150.scriptHex }],
  },
});
// victim(陌生同模板代币, 未被 shardInIdx 说明)藏在 8 输入内最后可达下标(index 7) -- 证明
// countStrayNonOwnedTokenInputs 的循环真实展开到那里, 不是提前截断. 保留 psOwn100 作为合法基线, 使
// owned_total==consolidated_pool 这条先决检查本身能通过, 不会提前掩盖真正要测的那条检查.
tests.push({
  name: 'V-absorb-14_fail_victim_stray_token_at_last_reachable_index_7',
  function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: {
    active_input_index: 0,
    inputs: [activeSelfInput(psActive100), shardInput(psOwn100), shardInput(shard50), fillerInput(), fillerInput(), fillerInput(), fillerInput(), shardInput(strayAt7)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: psOut150.scriptHex }],
  },
});

// ================= absorb: sole-source 6 (ledger 1208, 直接并入, 复用 sole-source-fix 的构造) =================
{
  const psOwn100b = compileKTT(PS_COV, 100, 'ssf_own100');
  const shardA = compileKTT(new Array(32).fill(0xbb), 50, 'ssf_shardA');
  const shardB = compileKTT(new Array(32).fill(0xcc), 50, 'ssf_shardB');
  const psCont150b = compilePS({ consolidated_pool: 150 }, 'ssf_cont150');
  const tokOut150b = compileKTT(PS_COV, 150, 'ssf_tokout150');
  tests.push({
    name: 'V-SSF-1_pass_single_leaf_sole_source', function: 'absorb', expect: 'pass',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: [0, 2, 2, 50, hex(psOwn100b.prefix), hex(psOwn100b.suffix)],
    tx: { active_input_index: 1, inputs: [tokenInput(psOwn100b), activeSelfInput(psActive100), tokenInput(shardA)],
      outputs: [{ value: 1000, script_hex: psCont150b.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: tokOut150b.scriptHex }] },
  });
  tests.push({
    name: 'V-SSF-2_fail_dual_leaf_only_one_named_other_silently_destroyed', function: 'absorb', expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: [0, 3, 2, 50, hex(psOwn100b.prefix), hex(psOwn100b.suffix)],
    tx: { active_input_index: 1, inputs: [tokenInput(psOwn100b), activeSelfInput(psActive100), tokenInput(shardA), tokenInput(shardB)],
      outputs: [{ value: 1000, script_hex: psCont150b.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: tokOut150b.scriptHex }] },
  });
  const psCont200 = compilePS({ consolidated_pool: 200 }, 'ssf_cont200');
  const tokOut200 = compileKTT(PS_COV, 200, 'ssf_tokout200');
  tests.push({
    name: 'V-SSF-3_fail_shardInIdx_already_self_owned_double_credit', function: 'absorb', expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: [0, 0, 2, 100, hex(psOwn100b.prefix), hex(psOwn100b.suffix)],
    tx: { active_input_index: 1, inputs: [tokenInput(psOwn100b), activeSelfInput(psActive100)],
      outputs: [{ value: 1000, script_hex: psCont200.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: tokOut200.scriptHex }] },
  });
  const strangerStray = compileKTT(new Array(32).fill(0x99), 1, 'ssf_stray');
  tests.push({
    name: 'V-SSF-4_fail_unrelated_stray_same_template_input_unaccounted', function: 'absorb', expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: [0, 2, 2, 50, hex(psOwn100b.prefix), hex(psOwn100b.suffix)],
    tx: { active_input_index: 1, inputs: [tokenInput(psOwn100b), activeSelfInput(psActive100), tokenInput(shardB), tokenInput(strangerStray)],
      outputs: [{ value: 1000, script_hex: psCont150b.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: tokOut150b.scriptHex }] },
  });
  const extraOwn = compileKTT(PS_COV, 1, 'ssf_extraown');
  const psCont151 = compilePS({ consolidated_pool: 151 }, 'ssf_cont151');
  const tokOut151 = compileKTT(PS_COV, 151, 'ssf_tokout151');
  tests.push({
    name: 'V-SSF-5_fail_hidden_extra_ps_owned_token_uncounted', function: 'absorb', expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: [0, 3, 2, 50, hex(psOwn100b.prefix), hex(psOwn100b.suffix)],
    tx: { active_input_index: 1, inputs: [tokenInput(psOwn100b), activeSelfInput(psActive100), tokenInput(extraOwn), tokenInput(shardB)],
      outputs: [{ value: 1000, script_hex: psCont151.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: tokOut151.scriptHex }] },
  });
  const tokOutWrong = compileKTT(PS_COV, 999, 'ssf_tokoutwrong');
  tests.push({
    name: 'V-SSF-6_fail_wrong_output_amount', function: 'absorb', expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: [0, 2, 2, 50, hex(psOwn100b.prefix), hex(psOwn100b.suffix)],
    tx: { active_input_index: 1, inputs: [tokenInput(psOwn100b), activeSelfInput(psActive100), tokenInput(shardB)],
      outputs: [{ value: 1000, script_hex: psCont150b.scriptHex }, { value: 1, covenant_id: hex(PS_COV) }, { value: 1, script_hex: tokOutWrong.scriptHex }] },
  });
}

// ================= close_attest / cancel_attest: 12 既有(移植到当前 25 参数 ctor) =================
function committeeArgs(newRoot, { tokPrefix = psOwn100.prefix, tokSuffix = psOwn100.suffix } = {}) {
  const pk = (n) => new Array(32).fill(n);
  const c0Pk = pk(0x01), c1Pk = pk(0x02), c2Pk = pk(0x03), c3Pk = pk(0x04), c4Pk = pk(0x05);
  const committeePkHash = [...b2b([...c0Pk, ...c1Pk, ...c2Pk, ...c3Pk, ...c4Pk])];
  const zeroSibs = new Array(8).fill(hex(ZERO32));
  return [
    0, hex(newRoot),
    ZERO_SIG, ZERO_SIG, ZERO_SIG, ZERO_SIG, ZERO_SIG,
    hex(committeePkHash),
    hex(c0Pk), hex(c1Pk), hex(c2Pk), hex(c3Pk), hex(c4Pk),
    0, 0, 0, 0, 0,
    ...zeroSibs, ...zeroSibs, ...zeroSibs, ...zeroSibs, ...zeroSibs,
    hex(tokPrefix), hex(tokSuffix),
  ];
}
function selfInput() { return { utxo_value: 1, covenant_id: hex(PS_COV), signature_script_hex: OTHER_SIG }; }
for (const fnName of ['close_attest', 'cancel_attest']) {
  tests.push({
    name: `V-${fnName}-1_fail_no_token_sigs_invalid_reaches_sig_gate`, function: fnName, expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: committeeArgs(ZERO32),
    tx: { active_input_index: 0, inputs: [selfInput()], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
  });
  tests.push({
    name: `V-${fnName}-2_fail_token_input_present_rejected_by_noTokenInput`, function: fnName, expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: committeeArgs(ZERO32),
    tx: { active_input_index: 0, inputs: [selfInput(), shardInput(psOwn100)], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
  });
  tests.push({
    name: `V-${fnName}-3_fail_at_bound_8_inputs_no_token_reaches_sig_gate`, function: fnName, expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: committeeArgs(ZERO32),
    tx: { active_input_index: 0, inputs: [selfInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
  });
  tests.push({
    name: `V-${fnName}-4_fail_bound_plus_one_9_inputs_rejected_by_length_guard`, function: fnName, expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: committeeArgs(ZERO32),
    tx: { active_input_index: 0, inputs: [selfInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
  });
  tests.push({
    name: `V-${fnName}-5_fail_victim_token_at_last_reachable_index_7`, function: fnName, expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: committeeArgs(ZERO32),
    tx: { active_input_index: 0, inputs: [selfInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), shardInput(psOwn100)], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
  });
  tests.push({
    name: `V-${fnName}-6_fail_witness_wrong_tok_prefix_blake3_mismatch`, function: fnName, expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }),
    args: committeeArgs(ZERO32, { tokPrefix: [0xff] }),
    tx: { active_input_index: 0, inputs: [selfInput()], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
  });
}

// ================= claim / refund_claim: 12 既有(已是当前 ctor, 逐字复用 claim-family-tokenization 逻辑) =================
function buildRootFor(amount, idx = MERKLE_INDEX) {
  const leaves = {}; leaves[idx] = [...b2b([...BETTOR_PK, ...le8(amount)])];
  const levels = buildMerkle(DEPTH, leaves);
  const siblings = proveMerkle(levels, idx, DEPTH);
  return { treeRoot: root(levels, DEPTH), siblings };
}
function nullifierWordsArray(merkleIndex) {
  const wordIdx = Math.floor(merkleIndex / 63);
  const w = new Array(17).fill(0); w[wordIdx] = 1 << (merkleIndex % 63);
  return w;
}
function buildClaimScenario({ fnName, closedVal, consolidated_pool, amount, tag, wrongClaimOut, wrongTokenOwner, wrongTokPrefix, wrongClaimPrefix }) {
  const { treeRoot, siblings } = buildRootFor(amount);
  const heldTok = compileKTT(PS_COV, consolidated_pool, `cf_held_${tag}`);
  const realClaimOut = compileKTC({ marketCovId: PS_COV, winnerPk: BETTOR_PK, amount, tokenTmplHash, marketSuffixHash }, `cf_claimout_${tag}`);
  const claimOut = wrongClaimOut || realClaimOut;
  const tokenOutOwner = wrongTokenOwner || claimCovId;
  const tokenOutToClaim = compileKTT(tokenOutOwner, amount, `cf_tokoutclaim_${tag}`);
  const exact = consolidated_pool === amount;
  const ctorOverrides = { consolidated_pool, closed: closedVal, payoutRoot: treeRoot };
  const activeInstance = compilePS(ctorOverrides, `cf_active_${tag}`);
  const outputs = [];
  if (exact) {
    outputs.push({ value: 1, covenant_id: hex(PS_COV) });
  } else {
    const contInstance = compilePS({ ...ctorOverrides, consolidated_pool: consolidated_pool - amount, w: nullifierWordsArray(MERKLE_INDEX) }, `cf_cont_${tag}`);
    outputs.push({ value: 1000, script_hex: contInstance.scriptHex });
  }
  outputs.push({ value: 1, covenant_id: hex(claimCovId), authorizing_input: 2, script_hex: claimOut.scriptHex });
  outputs.push({ value: 1, script_hex: tokenOutToClaim.scriptHex });
  if (!exact) {
    const remainTokenOut = compileKTT(PS_COV, consolidated_pool - amount, `cf_remaintok_${tag}`);
    outputs.push({ value: 1, script_hex: remainTokenOut.scriptHex });
  } else {
    outputs.push({ value: 1, covenant_id: hex(PS_COV) });
  }
  const tokPrefix = wrongTokPrefix || heldTok.prefix;
  const claimPrefix = wrongClaimPrefix || ktcAnchor.prefix;
  return {
    function: fnName,
    constructor_args: psCtor(ctorOverrides),
    args: [0, 1, 1, 2, 3, hex(BETTOR_PK), amount, MERKLE_INDEX, ...siblings.map(hex), hex(tokPrefix), hex(heldTok.suffix), hex(claimPrefix), hex(ktcAnchor.suffix)],
    tx: { active_input_index: 0, inputs: [activeSelfInput(activeInstance), tokenInput(heldTok), claimFillerInput()], outputs },
  };
}
for (const [fnName, closedVal, tagP] of [['claim', 1, 'CLM'], ['refund_claim', 2, 'RFC']]) {
  tests.push({ name: `V-PSCF-${tagP}-1_pass_partial_with_remainder`, expect: 'pass', ...buildClaimScenario({ fnName, closedVal, consolidated_pool: 100, amount: 30, tag: `${tagP}1` }) });
  tests.push({ name: `V-PSCF-${tagP}-2_pass_exact_no_remainder_drawdown_zero`, expect: 'pass', ...buildClaimScenario({ fnName, closedVal, consolidated_pool: 80, amount: 80, tag: `${tagP}2` }) });
  {
    const fakeClaimOut = compileKTT(PS_COV, 1, `cf_${tagP}_fake_claim_shell`);
    tests.push({ name: `V-PSCF-${tagP}-3_fail_destination_not_real_claim_template`, expect: 'fail', ...buildClaimScenario({ fnName, closedVal, consolidated_pool: 100, amount: 30, tag: `${tagP}3`, wrongClaimOut: fakeClaimOut }) });
  }
  tests.push({ name: `V-PSCF-${tagP}-4_fail_token_owner_diverted_to_stranger`, expect: 'fail', ...buildClaimScenario({ fnName, closedVal, consolidated_pool: 100, amount: 30, tag: `${tagP}4`, wrongTokenOwner: new Array(32).fill(0x99) }) });
  tests.push({ name: `V-PSCF-${tagP}-5_fail_witness_wrong_tok_prefix`, expect: 'fail', ...buildClaimScenario({ fnName, closedVal, consolidated_pool: 100, amount: 30, tag: `${tagP}5`, wrongTokPrefix: [0xff] }) });
  tests.push({ name: `V-PSCF-${tagP}-6_fail_witness_wrong_claim_prefix`, expect: 'fail', ...buildClaimScenario({ fnName, closedVal, consolidated_pool: 100, amount: 30, tag: `${tagP}6`, wrongClaimPrefix: [0xff] }) });
}

fs.writeFileSync('scratch/_t1v06_check/PayoutShard.current-suite.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
