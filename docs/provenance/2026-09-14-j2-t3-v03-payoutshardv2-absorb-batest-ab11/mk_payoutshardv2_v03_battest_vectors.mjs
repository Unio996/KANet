// PayoutShardV2.close_attest / cancel_attest B 类 noTokenInput() 向量(镜像 PayoutShard.sil 同名脚本, 适配
// close_attest 多出的 4 个 ZK witness 字段 new_attestedWinner/new_betsRoot/new_refundRoot/new_attestedAtMs)。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const KTT = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/sil-v1/KanetTestToken.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';
const ZERO32 = new Array(32).fill(0);
const PSV2_COV = new Array(32).fill(0xaa);
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];
const OTHER_SIG = '0x00' + 'ff'.repeat(20);
const ZERO_SIG = '0x' + '00'.repeat(65);

function compileKTT(ownerCov, amount, tag) {
  const ctor = [
    { kind: 'int', value: amount }, { kind: 'bytes', value: ownerCov }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
    { kind: 'bytes', value: MARKET_TMPL_SUFFIX }, { kind: 'int', value: MARKET_TMPL_SUFFIX.length },
    { kind: 'int', value: 3 }, { kind: 'int', value: 3 },
  ];
  const ctorPath = `scratch/_t1v06_check/KTTv2b_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/KTTv2b_${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${KTT}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}
const psv2Own100 = compileKTT(PSV2_COV, 100, 'psv2_own_100');

function ctorArgsPSV2({ consolidated_pool = 100, closed = 0, payoutRoot = ZERO32 }) {
  return [
    hex(ZERO32), hex(ZERO32), hex(ZERO32),
    hex(psv2Own100.templateHash),
    consolidated_pool, closed, hex(payoutRoot),
    ...new Array(17).fill(0),
    -1, 0, hex(ZERO32), hex(ZERO32),
  ];
}
function selfInput() { return { utxo_value: 1, covenant_id: hex(PSV2_COV), signature_script_hex: OTHER_SIG }; }
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function fillerInput() { return { utxo_value: 1, covenant_id: hex(PSV2_COV), signature_script_hex: OTHER_SIG }; }

function pkAndSibs() {
  const pk = (n) => new Array(32).fill(n);
  const c0Pk = pk(0x01), c1Pk = pk(0x02), c2Pk = pk(0x03), c3Pk = pk(0x04), c4Pk = pk(0x05);
  const committeePkHash = [...b2b([...c0Pk, ...c1Pk, ...c2Pk, ...c3Pk, ...c4Pk])];
  const zeroSibs = new Array(8).fill(hex(ZERO32));
  return { c0Pk, c1Pk, c2Pk, c3Pk, c4Pk, committeePkHash, zeroSibs };
}

// close_attest witness args: selfOutIdx, new_payoutRoot, new_attestedWinner, new_betsRoot, new_refundRoot,
// new_attestedAtMs, 5 sigs, committeePkHash, 5 pks, 5 idx, 5*8 siblings, tok_prefix, tok_suffix.
function closeAttestArgs(newRoot, { tokPrefix = psv2Own100.prefix, tokSuffix = psv2Own100.suffix } = {}) {
  const { c0Pk, c1Pk, c2Pk, c3Pk, c4Pk, committeePkHash, zeroSibs } = pkAndSibs();
  return [
    0, hex(newRoot), -1, hex(ZERO32), hex(ZERO32), 0,
    ZERO_SIG, ZERO_SIG, ZERO_SIG, ZERO_SIG, ZERO_SIG,
    hex(committeePkHash),
    hex(c0Pk), hex(c1Pk), hex(c2Pk), hex(c3Pk), hex(c4Pk),
    0, 0, 0, 0, 0,
    ...zeroSibs, ...zeroSibs, ...zeroSibs, ...zeroSibs, ...zeroSibs,
    hex(tokPrefix), hex(tokSuffix),
  ];
}
// cancel_attest witness args: selfOutIdx, new_refundRoot, 5 sigs, committeePkHash, 5 pks, 5 idx, 5*8 siblings,
// tok_prefix, tok_suffix (same shape as PayoutShard.sil's cancel_attest).
function cancelAttestArgs(newRoot, { tokPrefix = psv2Own100.prefix, tokSuffix = psv2Own100.suffix } = {}) {
  const { c0Pk, c1Pk, c2Pk, c3Pk, c4Pk, committeePkHash, zeroSibs } = pkAndSibs();
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

const tests = [];

tests.push({
  name: 'V-close_attestV2-1_fail_no_token_sigs_invalid_reaches_sig_gate',
  function: 'close_attest',
  constructor_args: ctorArgsPSV2({}),
  args: closeAttestArgs(ZERO32),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput()], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] },
});
tests.push({
  name: 'V-close_attestV2-2_fail_token_input_present_rejected_by_noTokenInput',
  function: 'close_attest',
  constructor_args: ctorArgsPSV2({}),
  args: closeAttestArgs(ZERO32),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput(), tokenInput(psv2Own100)], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] },
});
tests.push({
  name: 'V-cancel_attestV2-1_fail_no_token_sigs_invalid_reaches_sig_gate',
  function: 'cancel_attest',
  constructor_args: ctorArgsPSV2({}),
  args: cancelAttestArgs(ZERO32),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput()], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] },
});
tests.push({
  name: 'V-cancel_attestV2-2_fail_token_input_present_rejected_by_noTokenInput',
  function: 'cancel_attest',
  constructor_args: ctorArgsPSV2({}),
  args: cancelAttestArgs(ZERO32),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput(), tokenInput(psv2Own100)], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] },
});

// ---------- 1122/1122-补 边界纪律 ----------
function boundaryVectors(labelPrefix, realFnName, argsFn) {
  const out = [];
  out.push({
    name: `V-${labelPrefix}-3_fail_at_bound_8_inputs_no_token_reaches_sig_gate`,
    function: realFnName,
    constructor_args: ctorArgsPSV2({}),
    args: argsFn(ZERO32),
    expect: 'fail',
    tx: { active_input_index: 0, inputs: [selfInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] },
  });
  out.push({
    name: `V-${labelPrefix}-4_fail_bound_plus_one_9_inputs_rejected_by_length_guard`,
    function: realFnName,
    constructor_args: ctorArgsPSV2({}),
    args: argsFn(ZERO32),
    expect: 'fail',
    tx: { active_input_index: 0, inputs: [selfInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] },
  });
  out.push({
    name: `V-${labelPrefix}-5_fail_victim_token_at_last_reachable_index_7`,
    function: realFnName,
    constructor_args: ctorArgsPSV2({}),
    args: argsFn(ZERO32),
    expect: 'fail',
    tx: { active_input_index: 0, inputs: [selfInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), tokenInput(psv2Own100)], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] },
  });
  return out;
}
tests.push(...boundaryVectors('close_attestV2', 'close_attest', closeAttestArgs));
tests.push(...boundaryVectors('cancel_attestV2', 'cancel_attest', cancelAttestArgs));

// ---------- Bettor 1151: witness 供错 prefix/suffix 的负向量 ----------
tests.push({
  name: 'V-close_attestV2-6_fail_witness_wrong_tok_prefix_blake3_mismatch',
  function: 'close_attest',
  constructor_args: ctorArgsPSV2({}),
  args: closeAttestArgs(ZERO32, { tokPrefix: [0xff] }),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput()], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] },
});
tests.push({
  name: 'V-cancel_attestV2-6_fail_witness_wrong_tok_prefix_blake3_mismatch',
  function: 'cancel_attest',
  constructor_args: ctorArgsPSV2({}),
  args: cancelAttestArgs(ZERO32, { tokPrefix: [0xff] }),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput()], outputs: [{ value: 1000, covenant_id: hex(PSV2_COV) }] },
});

fs.writeFileSync('scratch/_t1v06_check/PayoutShardV2_v03_battest.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'B-class vectors');
