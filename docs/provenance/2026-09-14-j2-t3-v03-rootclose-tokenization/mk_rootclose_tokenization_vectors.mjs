// RootClose.sil v0.3/v0.4 §2 全 23 入口 A/B 落位表代币化(ledger 1188, Bettor 纠正范围: RootClose 是持币合约):
// B 类(close_commit/refund_flip) noTokenInput() + 1122 边界; A 类(convert_to_claim/convert_to_refundclaim)
// scanOwnedTokenInputs()==pool_value 全池转出 + tokenOutOk(owner=新建 RootClaim/RefundClaim covenant, 已核非
// ZERO32)。同 PayoutShard/PayoutShardV2 已验证形状, 不重新发明。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const RC = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/RootClose.sil';
const ROOTCLAIM = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/RootClaim.sil';
const REFUNDCLAIM = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/RefundClaim.sil';
const KTT = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/sil-v1/KanetTestToken.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const RC_COV = new Array(32).fill(0xcc);
const SHARD_POOL_ID = new Array(32).fill(0x37);
const DEADLINE_MS = 1700000000000;
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];
const OTHER_SIG = '0x00' + 'ff'.repeat(20);
const ZERO_SIG = '0x' + '00'.repeat(65);

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/RCT_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/RCT_${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${sil}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}
function compileRootClaimInstance({ local_yes = 0, local_no = 0, count = 0, pool_value = 100, closed = 1, winningSide = 0, payoutRoot = ZERO32, claimed_bitmap = 0 }, tag) {
  const ctor = [
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: SHARD_POOL_ID },
    { kind: 'int', value: local_yes }, { kind: 'int', value: local_no }, { kind: 'int', value: count },
    { kind: 'int', value: pool_value }, { kind: 'int', value: closed }, { kind: 'int', value: winningSide },
    { kind: 'bytes', value: payoutRoot }, { kind: 'int', value: claimed_bitmap },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
  ];
  return compileGeneric(ROOTCLAIM, ctor, `rootclaim_${tag}`);
}
function compileRefundClaimInstance({ local_yes = 0, local_no = 0, count = 0, pool_value = 100, closed = 2, winningSide = 0, payoutRoot = ZERO32 }, tag) {
  const ctor = [
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: SHARD_POOL_ID },
    { kind: 'int', value: local_yes }, { kind: 'int', value: local_no }, { kind: 'int', value: count },
    { kind: 'int', value: pool_value }, { kind: 'int', value: closed }, { kind: 'int', value: winningSide },
    { kind: 'bytes', value: payoutRoot },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
  ];
  return compileGeneric(REFUNDCLAIM, ctor, `refundclaim_${tag}`);
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

const rootClaimAnchor = compileRootClaimInstance({}, 'anchor');
const claimTmplHash = rootClaimAnchor.templateHash;
const refundClaimAnchor = compileRefundClaimInstance({}, 'anchor');
const refundclaimTmplHash = refundClaimAnchor.templateHash;
const tokAnchor = compileKTT(RC_COV, 1, 'anchor');
const tokenTmplHash = tokAnchor.templateHash;

const c0 = new Array(32).fill(0x01), c1 = new Array(32).fill(0x02), c2 = new Array(32).fill(0x03), c3 = new Array(32).fill(0x04), c4 = new Array(32).fill(0x05);
const committeeHash = [...b2b([...c0, ...c1, ...c2, ...c3, ...c4])];

function rootCloseCtor({ closed, pool_value = 100, payoutRoot = ZERO32 }) {
  return [hex(committeeHash), DEADLINE_MS, hex(claimTmplHash), hex(refundclaimTmplHash), hex(tokenTmplHash), 0, 0, 0, pool_value, closed, 0, hex(payoutRoot)];
}
const claimCovId = new Array(32).fill(0xdd);
function claimFillerInput() { return { utxo_value: 1, covenant_id: hex(claimCovId), signature_script_hex: '0x00ff' }; }
function selfInput(pool_value, closed) { return { utxo_value: 1, covenant_id: hex(RC_COV), state: { local_yes: 0, local_no: 0, count: 0, pool_value, closed, winningSide: 0, payoutRoot: hex(ZERO32) } }; }
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function fillerInput() { return { utxo_value: 1, covenant_id: hex(RC_COV), signature_script_hex: OTHER_SIG }; }

const tests = [];

// ================= B 类: close_commit / refund_flip (noTokenInput + 1122 边界) =================
function committeeArgsCloseCommit(newRoot, rootOutIdx, { tokPrefix = tokAnchor.prefix, tokSuffix = tokAnchor.suffix } = {}) {
  return [
    hex(c0), hex(c1), hex(c2), hex(c3), hex(c4),
    ZERO_SIG, ZERO_SIG, ZERO_SIG, ZERO_SIG, ZERO_SIG,
    rootOutIdx, 0, hex(newRoot),
    hex(tokPrefix), hex(tokSuffix),
  ];
}
function refundFlipArgs(rootOutIdx, { tokPrefix = tokAnchor.prefix, tokSuffix = tokAnchor.suffix } = {}) {
  return [rootOutIdx, hex(tokPrefix), hex(tokSuffix)];
}

// close_commit: V-1 no token input -> noTokenInput() passes -> falls to deadline gate (tx.time default 0 < deadline_ms) -> fails there.
tests.push({
  name: 'V-close_commit-1_fail_no_token_reaches_deadline_gate',
  function: 'close_commit',
  constructor_args: rootCloseCtor({ closed: 0, pool_value: 100 }),
  args: committeeArgsCloseCommit(ZERO32, 0),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput(100, 0)], outputs: [{ value: 1000, covenant_id: hex(RC_COV) }] },
});
// V-2: token-shaped input present -> noTokenInput() must reject BEFORE sig gate is reached.
tests.push({
  name: 'V-close_commit-2_fail_token_input_present_rejected_by_noTokenInput',
  function: 'close_commit',
  constructor_args: rootCloseCtor({ closed: 0, pool_value: 100 }),
  args: committeeArgsCloseCommit(ZERO32, 0),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput(100, 0), tokenInput(tokAnchor)], outputs: [{ value: 1000, covenant_id: hex(RC_COV) }] },
});
// refund_flip mirrors: no sig gate here, next gate after noTokenInput is the deadline check (tx.time defaults
// to 0 in the test harness < deadline+grace) -> fails at deadline gate, proving noTokenInput did not over-block.
tests.push({
  name: 'V-refund_flip-1_fail_no_token_reaches_deadline_gate',
  function: 'refund_flip',
  constructor_args: rootCloseCtor({ closed: 0, pool_value: 100 }),
  args: refundFlipArgs(0),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput(100, 0)], outputs: [{ value: 1000, covenant_id: hex(RC_COV) }] },
});
tests.push({
  name: 'V-refund_flip-2_fail_token_input_present_rejected_by_noTokenInput',
  function: 'refund_flip',
  constructor_args: rootCloseCtor({ closed: 0, pool_value: 100 }),
  args: refundFlipArgs(0),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput(100, 0), tokenInput(tokAnchor)], outputs: [{ value: 1000, covenant_id: hex(RC_COV) }] },
});

// ---- 1122/1122-补 边界纪律 (Bettor 1188: B 类 3 条边界 x 2 入口 = 6 条) ----
function boundaryVectorsCloseCommit() {
  const out = [];
  out.push({
    name: 'V-close_commit-3_fail_at_bound_8_inputs_no_token_reaches_deadline_gate',
    function: 'close_commit',
    constructor_args: rootCloseCtor({ closed: 0, pool_value: 100 }),
    args: committeeArgsCloseCommit(ZERO32, 0),
    expect: 'fail',
    tx: { active_input_index: 0, inputs: [selfInput(100, 0), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1000, covenant_id: hex(RC_COV) }] },
  });
  out.push({
    name: 'V-close_commit-4_fail_bound_plus_one_9_inputs_rejected_by_length_guard',
    function: 'close_commit',
    constructor_args: rootCloseCtor({ closed: 0, pool_value: 100 }),
    args: committeeArgsCloseCommit(ZERO32, 0),
    expect: 'fail',
    tx: { active_input_index: 0, inputs: [selfInput(100, 0), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1000, covenant_id: hex(RC_COV) }] },
  });
  out.push({
    name: 'V-close_commit-5_fail_victim_token_at_last_reachable_index_7',
    function: 'close_commit',
    constructor_args: rootCloseCtor({ closed: 0, pool_value: 100 }),
    args: committeeArgsCloseCommit(ZERO32, 0),
    expect: 'fail',
    tx: { active_input_index: 0, inputs: [selfInput(100, 0), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), tokenInput(tokAnchor)], outputs: [{ value: 1000, covenant_id: hex(RC_COV) }] },
  });
  return out;
}
function boundaryVectorsRefundFlip() {
  const out = [];
  out.push({
    name: 'V-refund_flip-3_fail_at_bound_8_inputs_no_token_reaches_deadline_gate',
    function: 'refund_flip',
    constructor_args: rootCloseCtor({ closed: 0, pool_value: 100 }),
    args: refundFlipArgs(0),
    expect: 'fail',
    tx: { active_input_index: 0, inputs: [selfInput(100, 0), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1000, covenant_id: hex(RC_COV) }] },
  });
  out.push({
    name: 'V-refund_flip-4_fail_bound_plus_one_9_inputs_rejected_by_length_guard',
    function: 'refund_flip',
    constructor_args: rootCloseCtor({ closed: 0, pool_value: 100 }),
    args: refundFlipArgs(0),
    expect: 'fail',
    tx: { active_input_index: 0, inputs: [selfInput(100, 0), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1000, covenant_id: hex(RC_COV) }] },
  });
  out.push({
    name: 'V-refund_flip-5_fail_victim_token_at_last_reachable_index_7',
    function: 'refund_flip',
    constructor_args: rootCloseCtor({ closed: 0, pool_value: 100 }),
    args: refundFlipArgs(0),
    expect: 'fail',
    tx: { active_input_index: 0, inputs: [selfInput(100, 0), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), tokenInput(tokAnchor)], outputs: [{ value: 1000, covenant_id: hex(RC_COV) }] },
  });
  return out;
}
tests.push(...boundaryVectorsCloseCommit());
tests.push(...boundaryVectorsRefundFlip());

// ---- witness 供错 prefix 负向量(两入口各一条) ----
tests.push({
  name: 'V-close_commit-6_fail_witness_wrong_tok_prefix_blake3_mismatch',
  function: 'close_commit',
  constructor_args: rootCloseCtor({ closed: 0, pool_value: 100 }),
  args: committeeArgsCloseCommit(ZERO32, 0, { tokPrefix: [0xff] }),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput(100, 0)], outputs: [{ value: 1000, covenant_id: hex(RC_COV) }] },
});
tests.push({
  name: 'V-refund_flip-6_fail_witness_wrong_tok_prefix_blake3_mismatch',
  function: 'refund_flip',
  constructor_args: rootCloseCtor({ closed: 0, pool_value: 100 }),
  args: refundFlipArgs(0, { tokPrefix: [0xff] }),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput(100, 0)], outputs: [{ value: 1000, covenant_id: hex(RC_COV) }] },
});

// ================= A 类: convert_to_claim / convert_to_refundclaim (scanOwnedTokenInputs + tokenOutOk) =================
function buildConvertScenario({ kind, tag, divertOwner, wrongTokPrefix, extraSmuggled, wrongTemplate, bareOutput }) {
  const isClaim = kind === 'claim';
  const heldTok = compileKTT(RC_COV, 100, `held_${tag}`);
  const anchor = isClaim ? rootClaimAnchor : refundClaimAnchor;
  const realTarget = isClaim
    ? compileRootClaimInstance({ pool_value: 100, closed: 1, payoutRoot: ZERO32, claimed_bitmap: 0 }, tag)
    : compileRefundClaimInstance({ pool_value: 100, closed: 2, payoutRoot: ZERO32 }, tag);
  const fakeTarget = wrongTemplate
    ? (isClaim ? compileRefundClaimInstance({ pool_value: 100, closed: 2 }, `fake_${tag}`) : compileRootClaimInstance({ pool_value: 100, closed: 1 }, `fake_${tag}`))
    : null;
  const target = fakeTarget || realTarget;
  const tokOutOwner = divertOwner || claimCovId;
  const tokOut = compileKTT(tokOutOwner, 100, `tokout_${tag}`);

  const inputs = [selfInput(100, isClaim ? 1 : 2), claimFillerInput(), tokenInput(heldTok)];
  let tokenInIdx = 2;
  if (extraSmuggled) {
    const extra = compileKTT(RC_COV, 1, `extra_${tag}`);
    inputs.push(tokenInput(extra));
  }

  const outputs = [];
  if (bareOutput) {
    outputs.push({ value: 1000, script_hex: target.scriptHex });   // no covenant_id declared
  } else {
    outputs.push({ value: 1000, covenant_id: hex(claimCovId), authorizing_input: 1, script_hex: target.scriptHex });
  }
  outputs.push({ value: 1, script_hex: tokOut.scriptHex });

  const tokPrefix = wrongTokPrefix || heldTok.prefix;
  const tokSuffix = heldTok.suffix;

  return {
    function: isClaim ? 'convert_to_claim' : 'convert_to_refundclaim',
    constructor_args: rootCloseCtor({ closed: isClaim ? 1 : 2, pool_value: 100 }),
    args: [0, hex(anchor.prefix), hex(anchor.suffix), tokenInIdx, 1, hex(tokPrefix), hex(tokSuffix)],
    tx: { active_input_index: 0, inputs, outputs },
  };
}

for (const kind of ['claim', 'refundclaim']) {
  const k = kind === 'claim' ? 'claim' : 'refundclaim';
  const fnTag = kind === 'claim' ? 'convert_to_claim' : 'convert_to_refundclaim';
  const kindArg = kind === 'claim' ? 'claim' : 'refund';
  tests.push({ name: `V-${fnTag}-1_pass_real_bridge_full_pool_token_out`, expect: 'pass', ...buildConvertScenario({ kind: kindArg, tag: `${k}_pass` }) });
  tests.push({ name: `V-${fnTag}-2_fail_bare_output_no_covenant_id_zero32`, expect: 'fail', ...buildConvertScenario({ kind: kindArg, tag: `${k}_bare`, bareOutput: true }) });
  tests.push({ name: `V-${fnTag}-3_fail_fake_template_shell`, expect: 'fail', ...buildConvertScenario({ kind: kindArg, tag: `${k}_fake`, wrongTemplate: true }) });
  tests.push({ name: `V-${fnTag}-4_fail_outbind_token_diverted_to_stranger`, expect: 'fail', ...buildConvertScenario({ kind: kindArg, tag: `${k}_divert`, divertOwner: new Array(32).fill(0x99) }) });
  tests.push({ name: `V-${fnTag}-5_fail_witness_wrong_tok_prefix`, expect: 'fail', ...buildConvertScenario({ kind: kindArg, tag: `${k}_wtok`, wrongTokPrefix: [0xff] }) });
  tests.push({ name: `V-${fnTag}-6_fail_smuggled_second_owned_token_uncounted`, expect: 'fail', ...buildConvertScenario({ kind: kindArg, tag: `${k}_smuggle`, extraSmuggled: true }) });
}

fs.writeFileSync('scratch/_t1v06_check/RootClose.tokenization.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
