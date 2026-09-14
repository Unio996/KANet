// PayoutShardV2.sil — 完整现行向量套件（ledger 1209），同 PayoutShard.sil 那份逐字镜像，适配 30 参数 ctor
// + 24 字段 State（多 attestedWinner/attestedAtMs/betsRootBaked/refundRootBaked 四个 ZK-native 字段）+
// zk_handoff（此前 28 参数 ctor 是历史陈旧，本次一并重生成到当前 30 参数）。
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
const PSV2 = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/PayoutShardV2.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const PSV2_COV = new Array(32).fill(0xaa);
const LEAF_COV = new Array(32).fill(0xbb);
const STRANGER_COV = new Array(32).fill(0x99);
const BETTOR_PK = new Array(32).fill(0x22);
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];
const OTHER_SIG = '0x00' + 'ff'.repeat(20);
const ZERO_SIG = '0x' + '00'.repeat(65);
const MERKLE_INDEX = 5;
const DEPTH = 10;
const splice = JSON.parse(fs.readFileSync('scratch/_t1v06_check/closezk_splice.json', 'utf8'));

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/PSV2CS_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/PSV2CS_${tag}.compiled.json`;
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
const tokAnchor = compileKTT(PSV2_COV, 1, 'anchor');
const tokenTmplHash = tokAnchor.templateHash;
const marketSuffixHash = [...blake3(Uint8Array.from(MARKET_TMPL_SUFFIX))];

// ---- CURRENT 30-param ctor ----
function psCtor({ consolidated_pool, closed = 0, payoutRoot = ZERO32, w = new Array(17).fill(0), attestedWinner = -1, attestedAtMs = 0, betsRootBaked = ZERO32, refundRootBaked = ZERO32, closeZkTmplAnchor = null }) {
  return [hex(ZERO32), hex(ZERO32), closeZkTmplAnchor || hex(ZERO32), hex(tokenTmplHash), consolidated_pool, closed, hex(payoutRoot), ...w, attestedWinner, attestedAtMs, hex(betsRootBaked), hex(refundRootBaked), hex(claimTmplHash), hex(marketSuffixHash)];
}
function toCtorObjs(arr) {
  return arr.map((v) => (typeof v === 'string' && v.startsWith('0x')) ? { kind: 'bytes', value: [...Buffer.from(v.slice(2), 'hex')] } : { kind: 'int', value: v });
}
function compilePS(ctorOverrides, tag) { return compileGeneric(PSV2, toCtorObjs(psCtor(ctorOverrides)), `ps_${tag}`); }
function shardInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function activeSelfInput(instance) { return { utxo_value: 1, covenant_id: hex(PSV2_COV), utxo_script_hex: instance.scriptHex, signature_script_hex: instance.fullBytecodeHex }; }
function fillerInput() { return { utxo_value: 1, covenant_id: hex(PSV2_COV), signature_script_hex: OTHER_SIG }; }
const claimCovId = new Array(32).fill(0xdd);
function claimFillerInput() { return { utxo_value: 1, covenant_id: hex(claimCovId), signature_script_hex: '0x00ff' }; }

const psActive100 = compilePS({ consolidated_pool: 100 }, 'active_100');
const psCont150 = compilePS({ consolidated_pool: 150 }, 'cont_150');
const psCont150WrongClosed = compilePS({ consolidated_pool: 150, closed: 1 }, 'cont_150_wrong_closed');
const psCont150WrongRoot = compilePS({ consolidated_pool: 150, payoutRoot: new Array(32).fill(0x77) }, 'cont_150_wrong_root');
const w5wrong = new Array(17).fill(0); w5wrong[5] = 42;
const psCont150WrongW5 = compilePS({ consolidated_pool: 150, w: w5wrong }, 'cont_150_wrong_w5');
const psCont150WrongAtMs = compilePS({ consolidated_pool: 150, attestedAtMs: 999 }, 'cont_150_wrong_atms');
const psCont150WrongRefundRoot = compilePS({ consolidated_pool: 150, refundRootBaked: new Array(32).fill(0x88) }, 'cont_150_wrong_refundroot');
const psOwn100 = compileKTT(PSV2_COV, 100, 'ps_own_100');
const shard50 = compileKTT(LEAF_COV, 50, 'shard_50');
const psOwn30 = compileKTT(PSV2_COV, 30, 'ps_own2_30');
const psOut150 = compileKTT(PSV2_COV, 150, 'ps_out_150');
const psOut130wrong = compileKTT(PSV2_COV, 130, 'ps_out_130_wrong');
const psOut150Stranger = compileKTT(STRANGER_COV, 150, 'ps_out_150_stranger');
const strayAt7 = compileKTT(STRANGER_COV, 1, 'stray_at_index7');

const tests = [];

// ================= absorb: 12 既有(V-absorbV2-3 已停用) =================
tests.push({ name: 'V-absorbV2-1_pass_owned_plus_incoming_shard', function: 'absorb', expect: 'pass',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });
tests.push({ name: 'V-absorbV2-2_fail_smuggled_second_owned_token_uncounted', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 3, 3, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(psOwn30), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });
// V-absorbV2-3(原pass, stranger present not counted) 同 PayoutShard.sil 那份说明, ledger 1208 后结构性
// 停用——正确版本已是 sole-source 套件的 V-SSF-4, 不重造重复的.
tests.push({ name: 'V-absorbV2-4_fail_output_diverted_to_stranger_owner', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150Stranger.scriptHex }] } });
tests.push({ name: 'V-absorbV2-5_fail_output_wrong_amount', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut130wrong.scriptHex }] } });
tests.push({ name: 'V-absorbV2-6_fail_self_output_below_dust_min', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });
tests.push({ name: 'V-absorbV2-7_fail_self_continuation_wrong_closed_field', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150WrongClosed.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });
tests.push({ name: 'V-absorbV2-8_fail_self_continuation_wrong_payoutRoot_field', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150WrongRoot.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });
tests.push({ name: 'V-absorbV2-9_fail_self_continuation_wrong_w5_field', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150WrongW5.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });
tests.push({ name: 'V-absorbV2-10_fail_witness_wrong_tok_prefix_blake3_mismatch', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex([0xff]), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });
tests.push({ name: 'V-absorbV2-11_fail_witness_wrong_tok_suffix_blake3_mismatch', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex([0xff, 0xff])],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });
tests.push({ name: 'V-absorbV2-12_fail_self_continuation_wrong_attestedAtMs_field', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150WrongAtMs.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });
tests.push({ name: 'V-absorbV2-13_fail_self_continuation_wrong_refundRootBaked_field', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 1, inputs: [shardInput(psOwn100), activeSelfInput(psActive100), shardInput(shard50)],
    outputs: [{ value: 1000, script_hex: psCont150WrongRefundRoot.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });

// ================= absorb: NEW 1122 边界 3 条 =================
tests.push({ name: 'V-absorbV2-14_pass_at_bound_8_inputs_clean', function: 'absorb', expect: 'pass',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 0, inputs: [activeSelfInput(psActive100), shardInput(psOwn100), shardInput(shard50), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });
tests.push({ name: 'V-absorbV2-15_fail_bound_plus_one_9_inputs_rejected_by_length_guard', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 0, inputs: [activeSelfInput(psActive100), shardInput(psOwn100), shardInput(shard50), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });
tests.push({ name: 'V-absorbV2-16_fail_victim_stray_token_at_last_reachable_index_7', function: 'absorb', expect: 'fail',
  constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  tx: { active_input_index: 0, inputs: [activeSelfInput(psActive100), shardInput(psOwn100), shardInput(shard50), fillerInput(), fillerInput(), fillerInput(), fillerInput(), shardInput(strayAt7)],
    outputs: [{ value: 1000, script_hex: psCont150.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: psOut150.scriptHex }] } });

// ================= absorb: sole-source 6 =================
{
  const psOwn100b = compileKTT(PSV2_COV, 100, 'ssf_own100');
  const shardA = compileKTT(new Array(32).fill(0xbb), 50, 'ssf_shardA');
  const shardB = compileKTT(new Array(32).fill(0xcc), 50, 'ssf_shardB');
  const psCont150b = compilePS({ consolidated_pool: 150 }, 'ssf_cont150');
  const tokOut150b = compileKTT(PSV2_COV, 150, 'ssf_tokout150');
  tests.push({ name: 'V-SSF-1_pass_single_leaf_sole_source', function: 'absorb', expect: 'pass',
    constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100b.prefix), hex(psOwn100b.suffix)],
    tx: { active_input_index: 1, inputs: [tokenInput(psOwn100b), activeSelfInput(psActive100), tokenInput(shardA)],
      outputs: [{ value: 1000, script_hex: psCont150b.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: tokOut150b.scriptHex }] } });
  tests.push({ name: 'V-SSF-2_fail_dual_leaf_only_one_named_other_silently_destroyed', function: 'absorb', expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 3, 2, 50, hex(psOwn100b.prefix), hex(psOwn100b.suffix)],
    tx: { active_input_index: 1, inputs: [tokenInput(psOwn100b), activeSelfInput(psActive100), tokenInput(shardA), tokenInput(shardB)],
      outputs: [{ value: 1000, script_hex: psCont150b.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: tokOut150b.scriptHex }] } });
  const psCont200 = compilePS({ consolidated_pool: 200 }, 'ssf_cont200');
  const tokOut200 = compileKTT(PSV2_COV, 200, 'ssf_tokout200');
  tests.push({ name: 'V-SSF-3_fail_shardInIdx_already_self_owned_double_credit', function: 'absorb', expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 0, 2, 100, hex(psOwn100b.prefix), hex(psOwn100b.suffix)],
    tx: { active_input_index: 1, inputs: [tokenInput(psOwn100b), activeSelfInput(psActive100)],
      outputs: [{ value: 1000, script_hex: psCont200.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: tokOut200.scriptHex }] } });
  const strangerStray = compileKTT(new Array(32).fill(0x99), 1, 'ssf_stray');
  tests.push({ name: 'V-SSF-4_fail_unrelated_stray_same_template_input_unaccounted', function: 'absorb', expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100b.prefix), hex(psOwn100b.suffix)],
    tx: { active_input_index: 1, inputs: [tokenInput(psOwn100b), activeSelfInput(psActive100), tokenInput(shardB), tokenInput(strangerStray)],
      outputs: [{ value: 1000, script_hex: psCont150b.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: tokOut150b.scriptHex }] } });
  const extraOwn = compileKTT(PSV2_COV, 1, 'ssf_extraown');
  const psCont151 = compilePS({ consolidated_pool: 151 }, 'ssf_cont151');
  const tokOut151 = compileKTT(PSV2_COV, 151, 'ssf_tokout151');
  tests.push({ name: 'V-SSF-5_fail_hidden_extra_ps_owned_token_uncounted', function: 'absorb', expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 3, 2, 50, hex(psOwn100b.prefix), hex(psOwn100b.suffix)],
    tx: { active_input_index: 1, inputs: [tokenInput(psOwn100b), activeSelfInput(psActive100), tokenInput(extraOwn), tokenInput(shardB)],
      outputs: [{ value: 1000, script_hex: psCont151.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: tokOut151.scriptHex }] } });
  const tokOutWrong = compileKTT(PSV2_COV, 999, 'ssf_tokoutwrong');
  tests.push({ name: 'V-SSF-6_fail_wrong_output_amount', function: 'absorb', expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }), args: [0, 2, 2, 50, hex(psOwn100b.prefix), hex(psOwn100b.suffix)],
    tx: { active_input_index: 1, inputs: [tokenInput(psOwn100b), activeSelfInput(psActive100), tokenInput(shardB)],
      outputs: [{ value: 1000, script_hex: psCont150b.scriptHex }, { value: 1, covenant_id: hex(PSV2_COV) }, { value: 1, script_hex: tokOutWrong.scriptHex }] } });
}

// ================= close_attest / cancel_attest: 12 既有 =================
// close_attest 比 cancel_attest 多 4 个 ZK-native 字段(new_attestedWinner/new_betsRoot/new_refundRoot/
// new_attestedAtMs), 插在 new_payoutRoot 之后、签名之前 -- 两个入口签名不同形, 分开构造 args。
function committeeArgs(fnName, newRoot, { tokPrefix = psOwn100.prefix, tokSuffix = psOwn100.suffix } = {}) {
  const pk = (n) => new Array(32).fill(n);
  const c0Pk = pk(0x01), c1Pk = pk(0x02), c2Pk = pk(0x03), c3Pk = pk(0x04), c4Pk = pk(0x05);
  const committeePkHash = [...b2b([...c0Pk, ...c1Pk, ...c2Pk, ...c3Pk, ...c4Pk])];
  const zeroSibs = new Array(8).fill(hex(ZERO32));
  const head = fnName === 'close_attest'
    ? [0, hex(newRoot), -1, hex(ZERO32), hex(ZERO32), 0]   // selfOutIdx, new_payoutRoot, new_attestedWinner, new_betsRoot, new_refundRoot, new_attestedAtMs
    : [0, hex(newRoot)];   // cancel_attest: selfOutIdx, new_refundRoot
  return [...head, ZERO_SIG, ZERO_SIG, ZERO_SIG, ZERO_SIG, ZERO_SIG, hex(committeePkHash),
    hex(c0Pk), hex(c1Pk), hex(c2Pk), hex(c3Pk), hex(c4Pk), 0, 0, 0, 0, 0,
    ...zeroSibs, ...zeroSibs, ...zeroSibs, ...zeroSibs, ...zeroSibs, hex(tokPrefix), hex(tokSuffix)];
}
function selfInput() { return { utxo_value: 1, covenant_id: hex(PSV2_COV), signature_script_hex: OTHER_SIG }; }
for (const fnName of ['close_attest', 'cancel_attest']) {
  tests.push({ name: `V-${fnName}-1_fail_no_token_sigs_invalid_reaches_sig_gate`, function: fnName, expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }), args: committeeArgs(fnName, ZERO32),
    tx: { active_input_index: 0, inputs: [selfInput()], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] } });
  tests.push({ name: `V-${fnName}-2_fail_token_input_present_rejected_by_noTokenInput`, function: fnName, expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }), args: committeeArgs(fnName, ZERO32),
    tx: { active_input_index: 0, inputs: [selfInput(), shardInput(psOwn100)], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] } });
  tests.push({ name: `V-${fnName}-3_fail_at_bound_8_inputs_no_token_reaches_sig_gate`, function: fnName, expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }), args: committeeArgs(fnName, ZERO32),
    tx: { active_input_index: 0, inputs: [selfInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] } });
  tests.push({ name: `V-${fnName}-4_fail_bound_plus_one_9_inputs_rejected_by_length_guard`, function: fnName, expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }), args: committeeArgs(fnName, ZERO32),
    tx: { active_input_index: 0, inputs: [selfInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] } });
  tests.push({ name: `V-${fnName}-5_fail_victim_token_at_last_reachable_index_7`, function: fnName, expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }), args: committeeArgs(fnName, ZERO32),
    tx: { active_input_index: 0, inputs: [selfInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), shardInput(psOwn100)], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] } });
  tests.push({ name: `V-${fnName}-6_fail_witness_wrong_tok_prefix_blake3_mismatch`, function: fnName, expect: 'fail',
    constructor_args: psCtor({ consolidated_pool: 100 }), args: committeeArgs(fnName, ZERO32, { tokPrefix: [0xff] }),
    tx: { active_input_index: 0, inputs: [selfInput()], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] } });
}

// ================= refund_claim: 6 既有(已是当前 ctor) =================
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
function buildRefundScenario({ consolidated_pool, amount, tag, wrongClaimOut, wrongTokenOwner, wrongTokPrefix, wrongClaimPrefix }) {
  const { treeRoot, siblings } = buildRootFor(amount);
  const heldTok = compileKTT(PSV2_COV, consolidated_pool, `rfc_held_${tag}`);
  const realClaimOut = compileKTC({ marketCovId: PSV2_COV, winnerPk: BETTOR_PK, amount, tokenTmplHash, marketSuffixHash }, `rfc_claimout_${tag}`);
  const claimOut = wrongClaimOut || realClaimOut;
  const tokenOutOwner = wrongTokenOwner || claimCovId;
  const tokenOutToClaim = compileKTT(tokenOutOwner, amount, `rfc_tokoutclaim_${tag}`);
  const exact = consolidated_pool === amount;
  const ctorOverrides = { consolidated_pool, closed: 2, payoutRoot: treeRoot };
  const activeInstance = compilePS(ctorOverrides, `rfc_active_${tag}`);
  const outputs = [];
  if (exact) { outputs.push({ value: 1, covenant_id: hex(PSV2_COV) }); }
  else {
    const contInstance = compilePS({ ...ctorOverrides, consolidated_pool: consolidated_pool - amount, w: nullifierWordsArray(MERKLE_INDEX) }, `rfc_cont_${tag}`);
    outputs.push({ value: 1000, script_hex: contInstance.scriptHex });
  }
  outputs.push({ value: 1, covenant_id: hex(claimCovId), authorizing_input: 2, script_hex: claimOut.scriptHex });
  outputs.push({ value: 1, script_hex: tokenOutToClaim.scriptHex });
  if (!exact) { const remainTokenOut = compileKTT(PSV2_COV, consolidated_pool - amount, `rfc_remaintok_${tag}`); outputs.push({ value: 1, script_hex: remainTokenOut.scriptHex }); }
  else { outputs.push({ value: 1, covenant_id: hex(PSV2_COV) }); }
  const tokPrefix = wrongTokPrefix || heldTok.prefix;
  const claimPrefix = wrongClaimPrefix || ktcAnchor.prefix;
  return {
    function: 'refund_claim', constructor_args: psCtor(ctorOverrides),
    args: [0, 1, 1, 2, 3, hex(BETTOR_PK), amount, MERKLE_INDEX, ...siblings.map(hex), hex(tokPrefix), hex(heldTok.suffix), hex(claimPrefix), hex(ktcAnchor.suffix)],
    tx: { active_input_index: 0, inputs: [activeSelfInput(activeInstance), tokenInput(heldTok), claimFillerInput()], outputs },
  };
}
tests.push({ name: 'V-PSV2RFC-1_pass_partial_with_remainder', expect: 'pass', ...buildRefundScenario({ consolidated_pool: 100, amount: 30, tag: '1' }) });
tests.push({ name: 'V-PSV2RFC-2_pass_exact_no_remainder_drawdown_zero', expect: 'pass', ...buildRefundScenario({ consolidated_pool: 80, amount: 80, tag: '2' }) });
{ const fakeClaimOut = compileKTT(PSV2_COV, 1, 'rfc_fake_claim_shell'); tests.push({ name: 'V-PSV2RFC-3_fail_destination_not_real_claim_template', expect: 'fail', ...buildRefundScenario({ consolidated_pool: 100, amount: 30, tag: '3', wrongClaimOut: fakeClaimOut }) }); }
tests.push({ name: 'V-PSV2RFC-4_fail_token_owner_diverted_to_stranger', expect: 'fail', ...buildRefundScenario({ consolidated_pool: 100, amount: 30, tag: '4', wrongTokenOwner: new Array(32).fill(0x99) }) });
tests.push({ name: 'V-PSV2RFC-5_fail_witness_wrong_tok_prefix', expect: 'fail', ...buildRefundScenario({ consolidated_pool: 100, amount: 30, tag: '5', wrongTokPrefix: [0xff] }) });
tests.push({ name: 'V-PSV2RFC-6_fail_witness_wrong_claim_prefix', expect: 'fail', ...buildRefundScenario({ consolidated_pool: 100, amount: 30, tag: '6', wrongClaimPrefix: [0xff] }) });

// ================= zk_handoff: 5 既有(28→30 参数, 重生成) =================
function zkGenesisBytes(consolidated_pool, attestedWinner) {
  const push8 = (n) => { const b = Buffer.alloc(8); const v = BigInt(n); if (v >= 0n) { b.writeBigUInt64LE(v); } else { const mag = Buffer.alloc(8); mag.writeBigUInt64LE(-v); mag[7] |= 0x80; return [8, ...mag]; } return [8, ...b]; };
  const push32 = (bytes) => [32, ...bytes];
  const zeroWord = [8, 0, 0, 0, 0, 0, 0, 0, 0];
  return [107, ...push8(attestedWinner), ...push8(1), ...push32(ZERO32), ...push8(consolidated_pool), ...new Array(17).fill(zeroWord).flat()];
}
function realCloseZkInstance(consolidated_pool, attestedWinner) {
  const stateBytes = zkGenesisBytes(consolidated_pool, attestedWinner);
  const tA = Buffer.from(splice.templateA.slice(2), 'hex'), tB = Buffer.from(splice.templateB.slice(2), 'hex');
  const tC = Buffer.from(splice.templateC.slice(2), 'hex'), tD = Buffer.from(splice.templateD.slice(2), 'hex');
  const bets = Buffer.from(splice.betsRootBaked.slice(2), 'hex'), refund = Buffer.from(splice.refundRootBaked.slice(2), 'hex');
  const atMs = Buffer.concat([Buffer.from([6]), (() => { const b = Buffer.alloc(6); let v = BigInt(splice.attestedAtMs); for (let i = 0; i < 6; i++) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; })()]);
  const full = Buffer.concat([Buffer.from(stateBytes), tA, bets, tB, atMs, tC, refund, tD]);
  const bc = [...full];
  return { bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}
function buildZkHandoffScenario({ consolidated_pool, wrongTemplateD, wrongTokPrefix, wrongTokenOwner, wrongZkOutput }) {
  const heldTok = compileKTT(PSV2_COV, consolidated_pool, `zk_held_${consolidated_pool}`);
  const zkInstance = wrongZkOutput || realCloseZkInstance(consolidated_pool, -1);
  const tokenOutOwner = wrongTokenOwner || claimCovId;
  const tokenOut = compileKTT(tokenOutOwner, consolidated_pool, `zk_tokout_${consolidated_pool}_${wrongTokenOwner ? 'wrong' : 'ok'}`);
  const tokPrefix = wrongTokPrefix || tokAnchor.prefix;
  const templateD = wrongTemplateD || splice.templateD;
  return {
    function: 'zk_handoff',
    constructor_args: psCtor({ consolidated_pool, closed: 1, attestedAtMs: splice.attestedAtMs, betsRootBaked: [...Buffer.from(splice.betsRootBaked.slice(2), 'hex')], refundRootBaked: [...Buffer.from(splice.refundRootBaked.slice(2), 'hex')], closeZkTmplAnchor: splice.closeZkTmplAnchor }),
    args: [0, 1, 1, hex(tokPrefix), hex(tokAnchor.suffix), splice.templateA, splice.templateB, splice.templateC, templateD],
    tx: {
      active_input_index: 0,
      inputs: [{ utxo_value: 1, covenant_id: hex(PSV2_COV), state: {
        consolidated_pool, closed: 1, payoutRoot: ZERO32, w0: 0, w1: 0, w2: 0, w3: 0, w4: 0, w5: 0, w6: 0, w7: 0, w8: 0, w9: 0, w10: 0, w11: 0, w12: 0, w13: 0, w14: 0, w15: 0, w16: 0,
        attestedWinner: -1, attestedAtMs: splice.attestedAtMs, betsRootBaked: splice.betsRootBaked, refundRootBaked: splice.refundRootBaked,
      } }, tokenInput(heldTok), claimFillerInput()],
      outputs: [
        wrongZkOutput ? { value: 1000, script_hex: wrongZkOutput.scriptHex } : { value: 1000, covenant_id: hex(claimCovId), authorizing_input: 2, script_hex: zkInstance.scriptHex },
        { value: 1, script_hex: tokenOut.scriptHex },
      ],
    },
  };
}
tests.push({ name: 'V-ZKHO-1_pass_full_handoff', expect: 'pass', ...buildZkHandoffScenario({ consolidated_pool: 100 }) });
tests.push({ name: 'V-ZKHO-2_fail_wrong_templateD_anchor_mismatch', expect: 'fail', ...buildZkHandoffScenario({ consolidated_pool: 100, wrongTemplateD: '0x' + Buffer.from(splice.templateD.slice(2), 'hex').fill(0xff, 0, 4).toString('hex') }) });
tests.push({ name: 'V-ZKHO-3_fail_token_owner_diverted_to_stranger', expect: 'fail', ...buildZkHandoffScenario({ consolidated_pool: 100, wrongTokenOwner: new Array(32).fill(0x99) }) });
tests.push({ name: 'V-ZKHO-4_fail_witness_wrong_tok_prefix', expect: 'fail', ...buildZkHandoffScenario({ consolidated_pool: 100, wrongTokPrefix: [0xff] }) });
{ const zkInstanceBareCov = realCloseZkInstance(100, -1); tests.push({ name: 'V-ZKHO-5_fail_zk_output_bare_no_covenant_id_zero32', expect: 'fail', ...buildZkHandoffScenario({ consolidated_pool: 100, wrongZkOutput: zkInstanceBareCov }) }); }

fs.writeFileSync('scratch/_t1v06_check/PayoutShardV2.current-suite.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
