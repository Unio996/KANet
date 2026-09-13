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
const PS = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/PayoutShard.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const PS_COV = new Array(32).fill(0xaa);
const LEAF_COV = new Array(32).fill(0xbb);
const STRANGER_COV = new Array(32).fill(0x99);
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];
const OTHER_SIG = '0x00' + 'ff'.repeat(20);

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
const shard50 = compileKTT(LEAF_COV, 50, 'shard_50');
const psOwn30 = compileKTT(PS_COV, 30, 'ps_own2_30');
const stranger999 = compileKTT(STRANGER_COV, 999, 'stranger_999');
const psOut150 = compileKTT(PS_COV, 150, 'ps_out_150');
const psOut130wrong = compileKTT(PS_COV, 130, 'ps_out_130_wrong');
const psOut150Stranger = compileKTT(STRANGER_COV, 150, 'ps_out_150_stranger');

if (psOwn100.templateHash.join(',') !== shard50.templateHash.join(',')) throw new Error('template invariance broken');

const tokenPrefixHex = hex(psOwn100.prefix);
const tokenSuffixHex = hex(psOwn100.suffix);
const tokenTmplHashHex = hex(psOwn100.templateHash);

// ---------- PayoutShard self-continuation instances (AB11 workaround: active input must carry the FULL real
// PayoutShard bytecode now, since absorb() slices tx.inputs[this.activeInputIndex].sigScript directly) ----------
function ctorArgsPS({ consolidated_pool, closed = 0, payoutRoot = ZERO32, w = new Array(17).fill(0) }) {
  return [
    hex(ZERO32), hex(ZERO32),
    tokenPrefixHex, psOwn100.prefix.length, tokenSuffixHex, psOwn100.suffix.length, tokenTmplHashHex,
    consolidated_pool, closed, hex(payoutRoot),
    ...w,
  ];
}
function compilePS(stateOverrides, tag) {
  const ctor = ctorArgsPS(stateOverrides);
  const ctorPath = `scratch/_t1v06_check/PS_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/PS_${tag}.compiled.json`;
  // constructor_args here use raw JS values (ints/hex strings); silverc --ctor wants {kind,value} wrapped JSON.
  const wrapped = ctor.map((v) => {
    if (typeof v === 'number') return { kind: 'int', value: v };
    if (typeof v === 'string' && v.startsWith('0x')) {
      const bytes = Buffer.from(v.slice(2), 'hex');
      return { kind: 'bytes', value: [...bytes] };
    }
    throw new Error('unexpected ctor value ' + v);
  });
  fs.writeFileSync(ctorPath, JSON.stringify(wrapped, null, 1));
  execSync(`"${SILVERC}" "${PS}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  return { bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}

// Active-input instance: PS's own prior state, consolidated_pool=100, everything else default zero.
const psActive100 = compilePS({ consolidated_pool: 100 }, 'active_100');
// Expected correct continuation: consolidated_pool=150 (100+50), everything else unchanged.
const psCont150 = compilePS({ consolidated_pool: 150 }, 'cont_150');
// Negative: continuation with wrong `closed` field (non-amount, int, top-level control field).
const psCont150WrongClosed = compilePS({ consolidated_pool: 150, closed: 1 }, 'cont_150_wrong_closed');
// Negative: continuation with wrong `payoutRoot` field (non-amount, byte[32]).
const psCont150WrongRoot = compilePS({ consolidated_pool: 150, payoutRoot: new Array(32).fill(0x77) }, 'cont_150_wrong_root');
// Negative: continuation with wrong `w5` field (non-amount, int, deep in the 17-word nullifier array).
const w5wrong = new Array(17).fill(0); w5wrong[5] = 42;
const psCont150WrongW5 = compilePS({ consolidated_pool: 150, w: w5wrong }, 'cont_150_wrong_w5');

function ctorArgsPSHex({ consolidated_pool, closed = 0, payoutRoot = ZERO32 }) {
  return [
    hex(ZERO32), hex(ZERO32),
    tokenPrefixHex, psOwn100.prefix.length, tokenSuffixHex, psOwn100.suffix.length, tokenTmplHashHex,
    consolidated_pool, closed, hex(payoutRoot),
    ...new Array(17).fill(0),
  ];
}
function shardInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function activeSelfInput() { return { utxo_value: 1, covenant_id: hex(PS_COV), utxo_script_hex: psActive100.scriptHex, signature_script_hex: psActive100.fullBytecodeHex }; }

const tests = [];

// V-absorb-1: pass -- PS owns 1 prior token(100), absorbs incoming shard(50) -> output=150, dust KAS on selfOutIdx.
tests.push({
  name: 'V-absorb-1_pass_owned_plus_incoming_shard',
  function: 'absorb',
  constructor_args: ctorArgsPSHex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50],
  expect: 'pass',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PS_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
// V-absorb-2: fail -- a SECOND PS-owned token (30) smuggled in, scan sums both (130) but consolidated_pool=100.
tests.push({
  name: 'V-absorb-2_fail_smuggled_second_owned_token_uncounted',
  function: 'absorb',
  constructor_args: ctorArgsPSHex({ consolidated_pool: 100 }),
  args: [0, 3, 3, 50],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(psOwn30), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PS_COV) },
      { value: 1, covenant_id: hex(PS_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
// V-absorb-3: pass -- same-template but different-owner (stranger) token legitimately present, not counted.
tests.push({
  name: 'V-absorb-3_pass_stranger_same_template_present_not_counted',
  function: 'absorb',
  constructor_args: ctorArgsPSHex({ consolidated_pool: 100 }),
  args: [0, 3, 3, 50],
  expect: 'pass',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(stranger999), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PS_COV) },
      { value: 1, covenant_id: hex(PS_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
// V-absorb-4: fail -- output-side diversion: token continuation owner is a stranger's covenant.
tests.push({
  name: 'V-absorb-4_fail_output_diverted_to_stranger_owner',
  function: 'absorb',
  constructor_args: ctorArgsPSHex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PS_COV) },
      { value: 1, script_hex: psOut150Stranger.scriptHex },
    ],
  },
});
// V-absorb-5: fail -- wrong amount on the token continuation (130 instead of 150).
tests.push({
  name: 'V-absorb-5_fail_output_wrong_amount',
  function: 'absorb',
  constructor_args: ctorArgsPSHex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PS_COV) },
      { value: 1, script_hex: psOut130wrong.scriptHex },
    ],
  },
});
// V-absorb-6: fail -- correct self-continuation state, but KAS value below DUST_MIN.
tests.push({
  name: 'V-absorb-6_fail_self_output_below_dust_min',
  function: 'absorb',
  constructor_args: ctorArgsPSHex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PS_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
// V-absorb-7: fail -- self-continuation with wrong `closed` field (non-amount, int, top-level control).
tests.push({
  name: 'V-absorb-7_fail_self_continuation_wrong_closed_field',
  function: 'absorb',
  constructor_args: ctorArgsPSHex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150WrongClosed.scriptHex },
      { value: 1, covenant_id: hex(PS_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
// V-absorb-8: fail -- self-continuation with wrong `payoutRoot` field (non-amount, byte[32]).
tests.push({
  name: 'V-absorb-8_fail_self_continuation_wrong_payoutRoot_field',
  function: 'absorb',
  constructor_args: ctorArgsPSHex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150WrongRoot.scriptHex },
      { value: 1, covenant_id: hex(PS_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
// V-absorb-9: fail -- self-continuation with wrong `w5` field (non-amount, int, deep in nullifier array --
// proves the hand-rolled encoding covers every field, not just the ones near the front).
tests.push({
  name: 'V-absorb-9_fail_self_continuation_wrong_w5_field',
  function: 'absorb',
  constructor_args: ctorArgsPSHex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150WrongW5.scriptHex },
      { value: 1, covenant_id: hex(PS_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});

fs.writeFileSync('scratch/_t1v06_check/PayoutShard_v03_absorb.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'absorb vectors');
