import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const { blake3 } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake3.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const KTT = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/sil-v1/KanetTestToken.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const CLAIM_COV = new Array(32).fill(0xcc);
const MARKET_COV = new Array(32).fill(0xaa);
const STRANGER_COV = new Array(32).fill(0x99);
const WINNER_PK = new Array(32).fill(0x22);
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];
const DEST_MARKET_SUFFIX = [0x11, 0x22, 0x33];
const OTHER_SIG = '0x00' + 'ff'.repeat(20);
const PLACEHOLDER_SIG = '0x' + '00'.repeat(65);

function compileKTT(ownerCov, amount, tag) {
  const ctor = [
    { kind: 'int', value: amount }, { kind: 'bytes', value: ownerCov }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
    { kind: 'bytes', value: MARKET_TMPL_SUFFIX }, { kind: 'int', value: MARKET_TMPL_SUFFIX.length },
    { kind: 'int', value: 3 }, { kind: 'int', value: 3 },
  ];
  const ctorPath = `scratch/_t1v06_check/KTT_claim_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/KTT_claim_${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${KTT}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}

const tokOwnedByClaim = compileKTT(CLAIM_COV, 100, 'owned_100');
const tokOwnedByStranger = compileKTT(STRANGER_COV, 100, 'stranger_100');
const tokAtMarket = compileKTT(MARKET_COV, 100, 'to_market_100');
const tokAtNewClaim = compileKTT(new Array(32).fill(0xdd), 100, 'to_newclaim_100');
const tokAtShell = compileKTT(STRANGER_COV, 100, 'to_shell_100');
const tokWrongAmount = compileKTT(MARKET_COV, 99, 'to_market_99_wrong');

const tokenTmplHash = tokOwnedByClaim.templateHash;
if (tokOwnedByClaim.templateHash.join(',') !== tokOwnedByStranger.templateHash.join(',')) throw new Error('template invariance broken');

const marketSuffixHash = [...blake3(Uint8Array.from(DEST_MARKET_SUFFIX))];
const wrongMarketSuffixHash = [...blake3(Uint8Array.from([0x99, 0x88, 0x77]))];

function ctorArgs(overrides = {}) {
  return [
    hex(overrides.market_cov_id || MARKET_COV), hex(WINNER_PK), 100,
    hex(overrides.token_tmpl_hash || tokenTmplHash), hex(overrides.market_suffix_hash || marketSuffixHash),
  ];
}

function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function selfInput() { return { utxo_value: 1, covenant_id: hex(CLAIM_COV), signature_script_hex: OTHER_SIG }; }
function fillerInput() { return { utxo_value: 1, covenant_id: hex(new Array(32).fill(0xee)), signature_script_hex: OTHER_SIG }; }
function marketDestInput() { return { utxo_value: 1, covenant_id: hex(MARKET_COV), signature_script_hex: '0x00' + Buffer.from(DEST_MARKET_SUFFIX).toString('hex') }; }
function shellDestInput() { return { utxo_value: 1, covenant_id: hex(STRANGER_COV), signature_script_hex: '0x00' + 'ffffff' }; } // tail != DEST_MARKET_SUFFIX

const tests = [];

// V-CLAIM-1: everything structurally correct for a market-redirect (re-bet) -- fails ONLY at the final
// checkSig (placeholder sig, no real key available offline; same convention as close/cancel_attest B-class
// smoke vectors). Proves: token template verify + ownership check + market-shell verify + output binding
// all independently pass before the sig gate is reached.
tests.push({
  name: 'V-CLAIM-1_fail_only_at_sig_gate_market_redirect_otherwise_valid',
  function: 'spend',
  constructor_args: ctorArgs(),
  args: [PLACEHOLDER_SIG, 1, 2, true, 2, hex(tokOwnedByClaim.prefix), hex(tokOwnedByClaim.suffix), hex(DEST_MARKET_SUFFIX)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [selfInput(), tokenInput(tokOwnedByClaim), marketDestInput()],
    outputs: [{ value: 1 }, { value: 1 }, { value: 1, script_hex: tokAtMarket.scriptHex }],
  },
});
// V-CLAIM-2: everything structurally correct for a new-output redirect (transfer/split) -- same "fails only
// at sig gate" framing.
tests.push({
  name: 'V-CLAIM-2_fail_only_at_sig_gate_new_output_redirect_otherwise_valid',
  function: 'spend',
  constructor_args: ctorArgs(),
  args: [PLACEHOLDER_SIG, 1, 1, false, 2, hex(tokOwnedByClaim.prefix), hex(tokOwnedByClaim.suffix), hex(DEST_MARKET_SUFFIX)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [selfInput(), tokenInput(tokOwnedByClaim), { utxo_value: 1, covenant_id: hex(new Array(32).fill(0xdd)), signature_script_hex: OTHER_SIG }],
    outputs: [{ value: 1 }, { value: 1, script_hex: tokAtNewClaim.scriptHex }, { value: 1, covenant_id: hex(new Array(32).fill(0xdd)), authorizing_input: 2 }],
  },
});
// V-CLAIM-3: fail -- wrong tok_prefix witness (blake3 mismatch), must reject BEFORE reaching ownership/dest
// checks (structural rejection at the template-verify gate).
tests.push({
  name: 'V-CLAIM-3_fail_wrong_tok_prefix_witness_blake3_mismatch',
  function: 'spend',
  constructor_args: ctorArgs(),
  args: [PLACEHOLDER_SIG, 1, 2, true, 2, hex([0xff]), hex(tokOwnedByClaim.suffix), hex(DEST_MARKET_SUFFIX)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [selfInput(), tokenInput(tokOwnedByClaim), marketDestInput()],
    outputs: [{ value: 1 }, { value: 1 }, { value: 1, script_hex: tokAtMarket.scriptHex }],
  },
});
// V-CLAIM-4: fail -- wrong tok_suffix witness (blake3 mismatch), mirrors V-CLAIM-3 for the other half.
tests.push({
  name: 'V-CLAIM-4_fail_wrong_tok_suffix_witness_blake3_mismatch',
  function: 'spend',
  constructor_args: ctorArgs(),
  args: [PLACEHOLDER_SIG, 1, 2, true, 2, hex(tokOwnedByClaim.prefix), hex([0xff, 0xff]), hex(DEST_MARKET_SUFFIX)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [selfInput(), tokenInput(tokOwnedByClaim), marketDestInput()],
    outputs: [{ value: 1 }, { value: 1 }, { value: 1, script_hex: tokAtMarket.scriptHex }],
  },
});
// V-CLAIM-5: fail -- the token being spent (tok_in_idx) is NOT owned by this claim (belongs to a stranger) --
// steals an unrelated present token. Must reject at the ownership check.
tests.push({
  name: 'V-CLAIM-5_fail_token_not_owned_by_this_claim_steal_attempt',
  function: 'spend',
  constructor_args: ctorArgs(),
  args: [PLACEHOLDER_SIG, 1, 2, true, 2, hex(tokOwnedByStranger.prefix), hex(tokOwnedByStranger.suffix), hex(DEST_MARKET_SUFFIX)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [selfInput(), tokenInput(tokOwnedByStranger), marketDestInput()],
    outputs: [{ value: 1 }, { value: 1 }, { value: 1, script_hex: tokAtMarket.scriptHex }],
  },
});
// V-CLAIM-6 (Bettor: "假壳 covenant 被拒的负向量"): dest_idx points to an attacker-controlled covenant whose
// sigScript tail does NOT match the recorded market_suffix_hash -- must be rejected as a fake market shell,
// not silently treated as a legitimate re-bet destination.
tests.push({
  name: 'V-CLAIM-6_fail_shell_covenant_rejected_as_market_destination',
  function: 'spend',
  constructor_args: ctorArgs(),
  args: [PLACEHOLDER_SIG, 1, 2, true, 2, hex(tokOwnedByClaim.prefix), hex(tokOwnedByClaim.suffix), hex(DEST_MARKET_SUFFIX)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [selfInput(), tokenInput(tokOwnedByClaim), shellDestInput()],
    outputs: [{ value: 1 }, { value: 1 }, { value: 1, script_hex: tokAtShell.scriptHex }],
  },
});
// V-CLAIM-7: fail -- output-side amount tampered (99 instead of 100) even though everything else is correct.
tests.push({
  name: 'V-CLAIM-7_fail_output_amount_tampered',
  function: 'spend',
  constructor_args: ctorArgs(),
  args: [PLACEHOLDER_SIG, 1, 2, true, 2, hex(tokOwnedByClaim.prefix), hex(tokOwnedByClaim.suffix), hex(DEST_MARKET_SUFFIX)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [selfInput(), tokenInput(tokOwnedByClaim), marketDestInput()],
    outputs: [{ value: 1 }, { value: 1 }, { value: 1, script_hex: tokWrongAmount.scriptHex }],
  },
});

// V-CLAIM-8 (NWT 1155/1158 系统性扫查 MUST-FIX): to_market_input=false 路径(ii)下, dest_idx 指向一个"裸"
// 输出(未声明 covenant_id) -- OpOutputCovenantId 对此回退 ZERO_HASH(rusty-kaspa opcodes/mod.rs
// unwrap_or(ZERO_HASH))。这条路径此前没有独立验证(不像路径(i)有 market_suffix_hash 尾匹配), 必须靠新加的
// require(target_owner != ZERO32) 单独挡下 -- 结构性拒绝, 不是巧合的后续检查失败。
tests.push({
  name: 'V-CLAIM-8_fail_bare_output_destination_zero_owner_rejected',
  function: 'spend',
  constructor_args: ctorArgs(),
  args: [PLACEHOLDER_SIG, 1, 1, false, 0, hex(tokOwnedByClaim.prefix), hex(tokOwnedByClaim.suffix), hex(DEST_MARKET_SUFFIX)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [selfInput(), tokenInput(tokOwnedByClaim)],
    outputs: [{ value: 1 }, { value: 1 }],
  },
});

fs.writeFileSync('scratch/_t1v06_check/KanetTokenClaim.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'KanetTokenClaim vectors');
