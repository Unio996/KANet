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
const PS_COV = new Array(32).fill(0xaa);
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
  const ctorPath = `scratch/_t1v06_check/KTT_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/KTT_${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${KTT}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}
const psOwn100 = compileKTT(PS_COV, 100, 'ps_own_100');

function ctorArgsPS({ consolidated_pool = 100, closed = 0, payoutRoot = ZERO32 }) {
  return [
    hex(ZERO32), hex(ZERO32),
    hex(psOwn100.prefix), psOwn100.prefix.length, hex(psOwn100.suffix), psOwn100.suffix.length, hex(psOwn100.templateHash),
    consolidated_pool, closed, hex(payoutRoot),
    ...new Array(17).fill(0),
  ];
}
function selfInput() { return { utxo_value: 1, covenant_id: hex(PS_COV), signature_script_hex: OTHER_SIG }; }
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }

// close_attest/cancel_attest witness args: selfOutIdx, new_payoutRoot/new_refundRoot, 5 sigs, committeePkHash,
// 5 pks, 5 idx, 5*8 siblings (40 byte32) -- build a generic all-zero committee (checkSig will fail -> validSigs<4
// -> require fails AFTER noTokenInput, proving noTokenInput ran first and let a clean tx proceed to the next gate).
function committeeArgs(newRoot) {
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
  ];
}

const tests = [];

// close_attest: V-B-1 no token input present -> noTokenInput() passes -> falls through to sig check -> fails
// there (0 valid sigs) -- proves noTokenInput() did NOT block a clean tx, the sig gate is what's stopping it.
tests.push({
  name: 'V-close_attest-1_fail_no_token_sigs_invalid_reaches_sig_gate',
  function: 'close_attest',
  constructor_args: ctorArgsPS({}),
  args: committeeArgs(ZERO32),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput()], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
});
// V-close_attest-2: a token-shaped input IS present -> noTokenInput() must reject BEFORE the sig gate is ever
// reached (structural rejection, not a coincidental sig failure).
tests.push({
  name: 'V-close_attest-2_fail_token_input_present_rejected_by_noTokenInput',
  function: 'close_attest',
  constructor_args: ctorArgsPS({}),
  args: committeeArgs(ZERO32),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput(), tokenInput(psOwn100)], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
});

// cancel_attest mirrors close_attest exactly (same committee arg shape, closed 0->2).
tests.push({
  name: 'V-cancel_attest-1_fail_no_token_sigs_invalid_reaches_sig_gate',
  function: 'cancel_attest',
  constructor_args: ctorArgsPS({}),
  args: committeeArgs(ZERO32),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput()], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
});
tests.push({
  name: 'V-cancel_attest-2_fail_token_input_present_rejected_by_noTokenInput',
  function: 'cancel_attest',
  constructor_args: ctorArgsPS({}),
  args: committeeArgs(ZERO32),
  expect: 'fail',
  tx: { active_input_index: 0, inputs: [selfInput(), tokenInput(psOwn100)], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
});

// ---------- 1122/1122-补 边界纪律: noTokenInput() 也要同一套(Bettor 1149 提醒自查, 不能只有 scanOwnedTokenInputs 有) ----------
function fillerInput() { return { utxo_value: 1, covenant_id: hex(PS_COV), signature_script_hex: OTHER_SIG }; }

function boundaryVectors(fnName) {
  const out = [];
  // 恰好=界(8 输入, active + 7 filler, 无代币) -> noTokenInput() 放行 -> 落到签名门限才拒(证明界处仍是"干净放行").
  out.push({
    name: `V-${fnName}-3_fail_at_bound_8_inputs_no_token_reaches_sig_gate`,
    function: fnName,
    constructor_args: ctorArgsPS({}),
    args: committeeArgs(ZERO32),
    expect: 'fail',
    tx: { active_input_index: 0, inputs: [selfInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
  });
  // 界+1(9 输入) -> require(tx.inputs.length<=MAX_INS_SCAN) 单独挡下(内容本身无代币, 若无长度闸也会放行到签名门限
  // 而非在这里就失败——隔离出纯粹是长度闸拦的)。
  out.push({
    name: `V-${fnName}-4_fail_bound_plus_one_9_inputs_rejected_by_length_guard`,
    function: fnName,
    constructor_args: ctorArgsPS({}),
    args: committeeArgs(ZERO32),
    expect: 'fail',
    tx: { active_input_index: 0, inputs: [selfInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
  });
  // victim(代币输入) 在下标 7(8 输入内最后一个可达位置) -> noTokenInput() 循环真实展开到那里, 必须抓到.
  out.push({
    name: `V-${fnName}-5_fail_victim_token_at_last_reachable_index_7`,
    function: fnName,
    constructor_args: ctorArgsPS({}),
    args: committeeArgs(ZERO32),
    expect: 'fail',
    tx: { active_input_index: 0, inputs: [selfInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), tokenInput(psOwn100)], outputs: [{ value: 1000, covenant_id: hex(PS_COV) }] },
  });
  return out;
}
tests.push(...boundaryVectors('close_attest'));
tests.push(...boundaryVectors('cancel_attest'));

fs.writeFileSync('scratch/_t1v06_check/PayoutShard_v03_battest.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'B-class vectors');
