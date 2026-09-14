// CloseZkV2.sil v0.3 §2/§3 代币化(ledger 1170): zk_close/escape_trigger 加 noTokenInput B 类守卫 +
// 1122 边界; claim/escape_claim 改成 KanetTokenClaim 目的地重定向(同 RefundClaim.refund_payout 形状)。
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
// 🔴 更新(2026-09-15, 账本1408/1409/1415, f7342a32·同病同治): 三个路径全部改指向真实已落生产的 v0.3
// 文件(coord/j2-proto-v0-backend 分支 _j2_wt_proto_v0 工作树), 不再用旧 worktree 里的旧版本。
const KTT = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/src/lib/sil-v1/KanetTestToken.sil';
const KTC = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/src/lib/KanetTokenClaim.sil';
const CZK = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/src/lib/CloseZkV2.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const CZK_COV = new Array(32).fill(0xee);
const BETTOR_PK = new Array(32).fill(0x22);
const DEPTH = 10;
const MERKLE_INDEX = 5;

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/CZKtok_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/CZKtok_${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${sil}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}
// v0.3(方案C) ctor: 8 字段, market_tmpl_suffix/market_tmpl_suffix_len 已删除(H1(b) 撤销)。
function compileKTT(ownerCov, amount, tag) {
  const ctor = [
    { kind: 'int', value: amount }, { kind: 'bytes', value: ownerCov }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
    { kind: 'int', value: 3 }, { kind: 'int', value: 3 },
  ];
  return compileGeneric(KTT, ctor, `ktt_${tag}`);
}
// v0.3 方案C 同病同治(账本 1409/1415): KanetTokenClaim ctor 现只有 4 字段(market_suffix_hash 已删)。
function compileKTC({ marketCovId, winnerPk, amount, tokenTmplHash }, tag) {
  const ctor = [
    { kind: 'bytes', value: marketCovId }, { kind: 'bytes', value: winnerPk }, { kind: 'int', value: amount },
    { kind: 'bytes', value: tokenTmplHash },
  ];
  return compileGeneric(KTC, ctor, `ktc_${tag}`);
}

const ktcAnchor = compileKTC({ marketCovId: ZERO32, winnerPk: ZERO32, amount: 0, tokenTmplHash: ZERO32 }, 'anchor');
const claimTmplHash = ktcAnchor.templateHash;
const tokAnchor = compileKTT(CZK_COV, 1, 'anchor');
const tokenTmplHash = tokAnchor.templateHash;

// v0.3 方案C 同病同治(账本 1408/1409/1415, f7342a32): CloseZkV2.sil 自身 ctor 的 market_suffix_hash 字段
// 一并删除(2 个 ctor-only trailing 字段, 不是 3 个)。
function czkCtor({ attestedAtMs = 1700000000000, attestedWinner = -1, closed, payoutRootField = ZERO32, consolidated_pool, betsRootBaked = ZERO32, refundRootBaked = ZERO32, w = new Array(17).fill(0) }) {
  return [
    hex(ZERO32), hex(betsRootBaked), hex(refundRootBaked), attestedAtMs, attestedWinner, closed, hex(payoutRootField), consolidated_pool,
    ...w, hex(tokenTmplHash), hex(claimTmplHash),
  ];
}
function selfInput(overrides) { return { utxo_value: 1, covenant_id: hex(CZK_COV), state: overrides }; }
function fillerInput() { return { utxo_value: 1, covenant_id: hex(CZK_COV), signature_script_hex: '0x00ff' }; }
function tokenFillerInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }

// ★ AB11 self-continuation (ledger 1172/1173): claim/escape_claim's partial branch borrows
// tx.inputs[this.activeInputIndex].sigScript directly, so the ACTIVE input must carry a REAL compiled
// CloseZkV2 instance's full bytecode (not just a `state:` field) -- and any expected partial-branch
// continuation output must likewise be a real compiled instance referenced via `script_hex` (same
// AB11-vectors convention already established for PayoutShard.sil/PayoutShardV2.sil).
function compileCZK(ctorOverrides, tag) {
  const ctor = czkCtor(ctorOverrides);
  return compileGeneric(CZK, ctor.map((v) => {
    if (typeof v === 'number') return { kind: 'int', value: v };
    if (typeof v === 'string' && v.startsWith('0x')) return { kind: 'bytes', value: [...Buffer.from(v.slice(2), 'hex')] };
    throw new Error('unexpected ctor value ' + v);
  }), `czk_${tag}`);
}
function activeSelfInput(instance) { return { utxo_value: 1, covenant_id: hex(CZK_COV), utxo_script_hex: instance.scriptHex, signature_script_hex: instance.fullBytecodeHex }; }

const tests = [];

// ============ B-class: escape_trigger (simpler, no ZK-gate crypto needed -- adapt existing shape) ============
function baseState(overrides) {
  return { attestedWinner: -1, closed: 1, payoutRootField: ZERO32, consolidated_pool: 100, w0: 0, w1: 0, w2: 0, w3: 0, w4: 0, w5: 0, w6: 0, w7: 0, w8: 0, w9: 0, w10: 0, w11: 0, w12: 0, w13: 0, w14: 0, w15: 0, w16: 0, ...overrides };
}
{
  const st = baseState({});
  tests.push({
    name: 'V-CZK-ET-1_pass_no_token_present_reaches_time_gate',
    function: 'escape_trigger',
    constructor_args: czkCtor(st),
    args: [0, hex(tokAnchor.prefix), hex(tokAnchor.suffix)],
    expect: 'pass',
    tx: {
      lock_time: 1700021600000,
      active_input_index: 0,
      inputs: [selfInput(st)],
      outputs: [{ value: 1000, covenant_id: hex(CZK_COV), state: baseState({ closed: 3 }) }],
    },
  });
}
{
  const st = baseState({});
  tests.push({
    name: 'V-CZK-ET-2_fail_token_input_present_rejected_by_noTokenInput',
    function: 'escape_trigger',
    constructor_args: czkCtor(st),
    args: [0, hex(tokAnchor.prefix), hex(tokAnchor.suffix)],
    expect: 'fail',
    tx: {
      lock_time: 1700021600000,
      active_input_index: 0,
      inputs: [selfInput(st), tokenFillerInput(tokAnchor)],
      outputs: [{ value: 1000, covenant_id: hex(CZK_COV), state: baseState({ closed: 3 }) }],
    },
  });
}
{
  const st = baseState({});
  tests.push({
    name: 'V-CZK-ET-3_fail_before_time_threshold',
    function: 'escape_trigger',
    constructor_args: czkCtor(st),
    args: [0, hex(tokAnchor.prefix), hex(tokAnchor.suffix)],
    expect: 'fail',
    tx: {
      lock_time: 1700021599999,
      active_input_index: 0,
      inputs: [selfInput(st)],
      outputs: [{ value: 1000, covenant_id: hex(CZK_COV), state: baseState({ closed: 3 }) }],
    },
  });
}
// 1122 boundary: at-bound(8 inputs)/bound+1(9)/victim-at-index-7
function boundaryVectors(fnName, buildArgs, buildOutputs) {
  const st = baseState({});
  const out = [];
  out.push({
    name: `V-CZK-${fnName}-B1_pass_at_bound_8_inputs_no_token`,
    function: fnName,
    constructor_args: czkCtor(st),
    args: buildArgs(st),
    expect: 'pass',
    tx: { lock_time: 1700021600000, active_input_index: 0, inputs: [selfInput(st), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: buildOutputs(st) },
  });
  out.push({
    name: `V-CZK-${fnName}-B2_fail_bound_plus_one_9_inputs_rejected_by_length_guard`,
    function: fnName,
    constructor_args: czkCtor(st),
    args: buildArgs(st),
    expect: 'fail',
    tx: { lock_time: 1700021600000, active_input_index: 0, inputs: [selfInput(st), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: buildOutputs(st) },
  });
  out.push({
    name: `V-CZK-${fnName}-B3_fail_victim_token_at_last_reachable_index_7`,
    function: fnName,
    constructor_args: czkCtor(st),
    args: buildArgs(st),
    expect: 'fail',
    tx: { lock_time: 1700021600000, active_input_index: 0, inputs: [selfInput(st), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), tokenFillerInput(tokAnchor)], outputs: buildOutputs(st) },
  });
  return out;
}
tests.push(...boundaryVectors('escape_trigger', (st) => [0, hex(tokAnchor.prefix), hex(tokAnchor.suffix)], (st) => [{ value: 1000, covenant_id: hex(CZK_COV), state: baseState({ closed: 3 }) }]));

// ============ B-class: zk_close (reuse existing real-crypto verified vector, append token witness) ============
// The pre-existing migration vector `zk_close_regression_vs_repro4_verified_data` (docs/provenance/
// 2026-09-14-j2-t3-v03-syntax-migration-closezkv2/) carries REAL sha256/blake2b/gate-P2SH bytes that are
// expensive to reconstruct from scratch -- reuse it verbatim, only appending the new ctor fields (3 trailing
// ZERO32-hash-derived values, computed to match a real tok_prefix/tok_suffix witness) and the new tok_prefix/
// tok_suffix args. `tx.inputs[1]` is the hardcoded gate input position in the source -- any filler/token
// inputs for boundary vectors must go at index >= 2.
const zkCloseReal = JSON.parse(fs.readFileSync('scratch/_t1v06_check/zk_close_real_vector.json', 'utf8'));
function withTokCtorFields(ctorArgsArr) {
  // Original 25-field ctor + 2 new trailing fields (token_tmpl_hash/claim_tmpl_hash) -- market_suffix_hash
  // removed 2026-09-15 (账本 1408/1409/1415, f7342a32, 同病同治 with KanetTokenClaim.sil's own removal).
  return [...ctorArgsArr, hex(tokenTmplHash), hex(claimTmplHash)];
}
function zkCloseVector(name, expect, extraInputs) {
  const t = JSON.parse(JSON.stringify(zkCloseReal)); // deep clone
  t.name = name;
  t.expect = expect;
  t.constructor_args = withTokCtorFields(t.constructor_args);
  t.tx.inputs[0].constructor_args = withTokCtorFields(t.tx.inputs[0].constructor_args);
  t.tx.outputs[0].constructor_args = withTokCtorFields(t.tx.outputs[0].constructor_args);
  t.args = [...t.args, hex(tokAnchor.prefix), hex(tokAnchor.suffix)];
  if (extraInputs) t.tx.inputs = [...t.tx.inputs, ...extraInputs];
  return t;
}
tests.push(zkCloseVector('V-CZK-ZC-1_pass_no_token_present', 'pass', []));
tests.push(zkCloseVector('V-CZK-ZC-2_fail_token_input_present_rejected_by_noTokenInput', 'fail', [tokenFillerInput(tokAnchor)]));
// 1122 boundary for zk_close: gate is hardcoded at index 1, fillers go at index >=2.
tests.push(zkCloseVector('V-CZK-ZC-B1_pass_at_bound_8_inputs_no_token', 'pass', [fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()]));
tests.push(zkCloseVector('V-CZK-ZC-B2_fail_bound_plus_one_9_inputs_rejected_by_length_guard', 'fail', [fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()]));
tests.push(zkCloseVector('V-CZK-ZC-B3_fail_victim_token_at_last_reachable_index_7', 'fail', [fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), tokenFillerInput(tokAnchor)]));

fs.writeFileSync('scratch/_t1v06_check/CloseZkV2.tokenization.part1.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'B-class(escape_trigger+zk_close) vectors');

// ============ A-class: claim / escape_claim (KanetTokenClaim redirect, same shape as RefundClaim.refund_payout) ============
function buildRootFor(amount, idx = MERKLE_INDEX) {
  const leaves = {}; leaves[idx] = [...b2b([...BETTOR_PK, ...le8(amount)])];
  const levels = buildMerkle(DEPTH, leaves);
  const siblings = proveMerkle(levels, idx, DEPTH);
  return { treeRoot: root(levels, DEPTH), siblings };
}
function nullifierWords(merkleIndex) {
  const wordIdx = Math.floor(merkleIndex / 63);
  const bitIn = merkleIndex % 63;
  const mask = 1 << bitIn;
  const words = new Array(17).fill(0);
  words[wordIdx] = mask;
  const w = {};
  words.forEach((v, i) => { w[`w${i}`] = v; });
  return w;
}
const claimCovId = new Array(32).fill(0xdd);
function claimFillerInput() { return { utxo_value: 1, covenant_id: hex(claimCovId), signature_script_hex: '0x00ff' }; }

function buildClaimFamilyScenario({ fnName, closedVal, rootFieldName, consolidated_pool, amount, tag, wrongClaimOut, wrongTokenOwner, wrongTokPrefix, wrongClaimPrefix }) {
  const { treeRoot, siblings } = buildRootFor(amount);
  const heldTok = compileKTT(CZK_COV, consolidated_pool, `held_${tag}`);
  const realClaimOut = compileKTC({ marketCovId: CZK_COV, winnerPk: BETTOR_PK, amount, tokenTmplHash }, `claimout_${tag}`);
  const claimOut = wrongClaimOut || realClaimOut;
  const tokenOutOwner = wrongTokenOwner || claimCovId;
  const tokenOutToClaim = compileKTT(tokenOutOwner, amount, `tokoutclaim_${tag}`);
  const exact = consolidated_pool === amount;
  // payoutRootField (claim) is a real State field (part of continuation); refundRootBaked (escape_claim) is a
  // ctor-only immutable constant (baked once at genesis, NEVER re-declared in a State{} continuation literal --
  // same ctor-param-vs-instance-field distinction this project applies everywhere).
  const isPayoutField = rootFieldName === 'payoutRootField';
  const ctorRootFields = isPayoutField ? { payoutRootField: treeRoot } : { refundRootBaked: treeRoot };

  const st = baseState({ closed: closedVal, consolidated_pool, ...(isPayoutField ? { payoutRootField: treeRoot } : {}) });
  const activeCtorOverrides = { ...st, ...ctorRootFields };
  const activeInstance = compileCZK(activeCtorOverrides, `active_${tag}`);

  const outputs = [];
  if (exact) {
    outputs.push({ value: 1, covenant_id: hex(CZK_COV) }); // rootOutIdx unused in exact branch
  } else {
    const wordIdx = Math.floor(MERKLE_INDEX / 63);
    const w = new Array(17).fill(0); w[wordIdx] = 1 << (MERKLE_INDEX % 63);
    const contInstance = compileCZK({
      ...activeCtorOverrides,
      consolidated_pool: consolidated_pool - amount,
      w,
    }, `cont_${tag}`);
    outputs.push({ value: 1000, script_hex: contInstance.scriptHex });
  }
  outputs.push({ value: 1, covenant_id: hex(claimCovId), authorizing_input: 2, script_hex: claimOut.scriptHex });
  outputs.push({ value: 1, script_hex: tokenOutToClaim.scriptHex });
  if (!exact) {
    const remainTokenOut = compileKTT(CZK_COV, consolidated_pool - amount, `remaintok_${tag}`);
    outputs.push({ value: 1, script_hex: remainTokenOut.scriptHex });
  } else {
    outputs.push({ value: 1, covenant_id: hex(CZK_COV) });
  }

  const tokPrefix = wrongTokPrefix || heldTok.prefix;
  const claimPrefix = wrongClaimPrefix || ktcAnchor.prefix;

  return {
    function: fnName,
    constructor_args: czkCtor(activeCtorOverrides),
    args: [0, 1, 1, 2, 3, hex(BETTOR_PK), amount, MERKLE_INDEX, ...siblings.map(hex), hex(tokPrefix), hex(heldTok.suffix), hex(claimPrefix), hex(ktcAnchor.suffix)],
    tx: {
      active_input_index: 0,
      inputs: [activeSelfInput(activeInstance), tokenFillerInput(heldTok), claimFillerInput()],
      outputs,
    },
  };
}

for (const [fnName, closedVal, rootFieldName] of [['claim', 2, 'payoutRootField'], ['escape_claim', 3, 'refundRootBaked']]) {
  const P = fnName === 'claim' ? 'CLM' : 'ESC';
  tests.push({ name: `V-CZK-${P}-1_pass_partial_refund_with_remainder`, expect: 'pass', ...buildClaimFamilyScenario({ fnName, closedVal, rootFieldName, consolidated_pool: 100, amount: 30, tag: `${P}1` }) });
  tests.push({ name: `V-CZK-${P}-2_pass_exact_no_remainder`, expect: 'pass', ...buildClaimFamilyScenario({ fnName, closedVal, rootFieldName, consolidated_pool: 80, amount: 80, tag: `${P}2` }) });
  {
    const fakeClaimOut = compileKTT(CZK_COV, 1, `${P}_fake_claim_shell`);
    tests.push({ name: `V-CZK-${P}-3_fail_destination_not_real_claim_template`, expect: 'fail', ...buildClaimFamilyScenario({ fnName, closedVal, rootFieldName, consolidated_pool: 100, amount: 30, tag: `${P}3`, wrongClaimOut: fakeClaimOut }) });
  }
  tests.push({ name: `V-CZK-${P}-4_fail_token_owner_diverted_to_stranger`, expect: 'fail', ...buildClaimFamilyScenario({ fnName, closedVal, rootFieldName, consolidated_pool: 100, amount: 30, tag: `${P}4`, wrongTokenOwner: new Array(32).fill(0x99) }) });
  tests.push({ name: `V-CZK-${P}-5_fail_witness_wrong_tok_prefix`, expect: 'fail', ...buildClaimFamilyScenario({ fnName, closedVal, rootFieldName, consolidated_pool: 100, amount: 30, tag: `${P}5`, wrongTokPrefix: [0xff] }) });
  tests.push({ name: `V-CZK-${P}-6_fail_witness_wrong_claim_prefix`, expect: 'fail', ...buildClaimFamilyScenario({ fnName, closedVal, rootFieldName, consolidated_pool: 100, amount: 30, tag: `${P}6`, wrongClaimPrefix: [0xff] }) });
}

fs.writeFileSync('scratch/_t1v06_check/CloseZkV2.tokenization.part2.test.json', JSON.stringify({ tests: tests.filter(t => t.function === 'claim' || t.function === 'escape_claim') }, null, 1));
console.log('wrote', tests.filter(t => t.function === 'claim' || t.function === 'escape_claim').length, 'A-class(claim+escape_claim) vectors');
