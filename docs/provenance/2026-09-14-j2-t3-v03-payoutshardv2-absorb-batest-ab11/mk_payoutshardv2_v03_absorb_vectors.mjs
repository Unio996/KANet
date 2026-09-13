// PayoutShardV2.absorb v0.3 §2/§3 代币化 + AB11 自续约向量(镜像 PayoutShard.sil 同名脚本, 适配 28 ctor 参数
// + 24 字段 State)。
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
const PSV2 = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/PayoutShardV2.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const PSV2_COV = new Array(32).fill(0xaa);
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
  const ctorPath = `scratch/_t1v06_check/KTTv2_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/KTTv2_${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${KTT}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}

const psOwn100 = compileKTT(PSV2_COV, 100, 'ps_own_100');
const shard50 = compileKTT(LEAF_COV, 50, 'shard_50');
const psOwn30 = compileKTT(PSV2_COV, 30, 'ps_own2_30');
const stranger999 = compileKTT(STRANGER_COV, 999, 'stranger_999');
const psOut150 = compileKTT(PSV2_COV, 150, 'ps_out_150');
const psOut130wrong = compileKTT(PSV2_COV, 130, 'ps_out_130_wrong');
const psOut150Stranger = compileKTT(STRANGER_COV, 150, 'ps_out_150_stranger');

if (psOwn100.templateHash.join(',') !== shard50.templateHash.join(',')) throw new Error('template invariance broken');

const tokenTmplHashHex = hex(psOwn100.templateHash);

// ---------- PayoutShardV2 self-continuation instances (AB11 workaround) ----------
// ctor order: poolMerkleRoot, predicate_commit, closeZkTmplAnchor, token_tmpl_hash, init_consolidated_pool,
// init_closed, init_payoutRoot, init_w0..init_w16(17), init_attestedWinner, init_attestedAtMs,
// init_betsRootBaked, init_refundRootBaked.
function ctorArgsPSV2({
  consolidated_pool, closed = 0, payoutRoot = ZERO32, w = new Array(17).fill(0),
  attestedWinner = -1, attestedAtMs = 0, betsRootBaked = ZERO32, refundRootBaked = ZERO32,
}) {
  return [
    hex(ZERO32), hex(ZERO32), hex(ZERO32),
    tokenTmplHashHex,
    consolidated_pool, closed, hex(payoutRoot),
    ...w,
    attestedWinner, attestedAtMs, hex(betsRootBaked), hex(refundRootBaked),
  ];
}
function compilePSV2(stateOverrides, tag) {
  const ctor = ctorArgsPSV2(stateOverrides);
  const ctorPath = `scratch/_t1v06_check/PSV2_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/PSV2_${tag}.compiled.json`;
  const wrapped = ctor.map((v) => {
    if (typeof v === 'number') return { kind: 'int', value: v };
    if (typeof v === 'string' && v.startsWith('0x')) {
      const bytes = Buffer.from(v.slice(2), 'hex');
      return { kind: 'bytes', value: [...bytes] };
    }
    throw new Error('unexpected ctor value ' + v);
  });
  fs.writeFileSync(ctorPath, JSON.stringify(wrapped, null, 1));
  execSync(`"${SILVERC}" "${PSV2}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  return { bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}

// Active-input instance: PSV2's own prior state, consolidated_pool=100, everything else default zero/-1/0.
const psActive100 = compilePSV2({ consolidated_pool: 100 }, 'active_100');
// Expected correct continuation: consolidated_pool=150 (100+50), everything else unchanged.
const psCont150 = compilePSV2({ consolidated_pool: 150 }, 'cont_150');
// Negative: continuation with wrong `closed` field (non-amount, int, top-level control field).
const psCont150WrongClosed = compilePSV2({ consolidated_pool: 150, closed: 1 }, 'cont_150_wrong_closed');
// Negative: continuation with wrong `payoutRoot` field (non-amount, byte[32]).
const psCont150WrongRoot = compilePSV2({ consolidated_pool: 150, payoutRoot: new Array(32).fill(0x77) }, 'cont_150_wrong_root');
// Negative: continuation with wrong `w5` field (non-amount, int, deep in the 17-word nullifier array).
const w5wrong = new Array(17).fill(0); w5wrong[5] = 42;
const psCont150WrongW5 = compilePSV2({ consolidated_pool: 150, w: w5wrong }, 'cont_150_wrong_w5');
// Negative: continuation with wrong `attestedAtMs` field (non-amount, int, ZK-native-only new field --
// proves the 24-field encoding table covers the 4 fields PayoutShard.sil doesn't have, not just the 20 shared ones).
const psCont150WrongAtMs = compilePSV2({ consolidated_pool: 150, attestedAtMs: 999 }, 'cont_150_wrong_atms');
// Negative: continuation with wrong `refundRootBaked` field (non-amount, byte[32], last field in the struct --
// proves the encoding table's tail isn't silently truncated/misaligned).
const psCont150WrongRefundRoot = compilePSV2({ consolidated_pool: 150, refundRootBaked: new Array(32).fill(0x88) }, 'cont_150_wrong_refundroot');

function ctorArgsPSV2Hex({ consolidated_pool, closed = 0, payoutRoot = ZERO32 }) {
  return ctorArgsPSV2({ consolidated_pool, closed, payoutRoot });
}
function shardInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function activeSelfInput() { return { utxo_value: 1, covenant_id: hex(PSV2_COV), utxo_script_hex: psActive100.scriptHex, signature_script_hex: psActive100.fullBytecodeHex }; }

const tests = [];

tests.push({
  name: 'V-absorbV2-1_pass_owned_plus_incoming_shard',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  expect: 'pass',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
tests.push({
  name: 'V-absorbV2-2_fail_smuggled_second_owned_token_uncounted',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 3, 3, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(psOwn30), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
tests.push({
  name: 'V-absorbV2-3_pass_stranger_same_template_present_not_counted',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 3, 3, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  expect: 'pass',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(stranger999), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
tests.push({
  name: 'V-absorbV2-4_fail_output_diverted_to_stranger_owner',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut150Stranger.scriptHex },
    ],
  },
});
tests.push({
  name: 'V-absorbV2-5_fail_output_wrong_amount',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut130wrong.scriptHex },
    ],
  },
});
tests.push({
  name: 'V-absorbV2-6_fail_self_output_below_dust_min',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
tests.push({
  name: 'V-absorbV2-7_fail_self_continuation_wrong_closed_field',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150WrongClosed.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
tests.push({
  name: 'V-absorbV2-8_fail_self_continuation_wrong_payoutRoot_field',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150WrongRoot.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
tests.push({
  name: 'V-absorbV2-9_fail_self_continuation_wrong_w5_field',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150WrongW5.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
// V-absorbV2-10/11 (Bettor 1151, 同 PayoutShard.sil): witness 供错 tok_prefix/tok_suffix.
tests.push({
  name: 'V-absorbV2-10_fail_witness_wrong_tok_prefix_blake3_mismatch',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex([0xff]), hex(psOwn100.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
tests.push({
  name: 'V-absorbV2-11_fail_witness_wrong_tok_suffix_blake3_mismatch',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex([0xff, 0xff])],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
// V-absorbV2-12/13 (PayoutShardV2 特有, 24 字段编码表 4 个新增字段覆盖): wrong attestedAtMs / refundRootBaked.
tests.push({
  name: 'V-absorbV2-12_fail_self_continuation_wrong_attestedAtMs_field',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150WrongAtMs.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});
tests.push({
  name: 'V-absorbV2-13_fail_self_continuation_wrong_refundRootBaked_field',
  function: 'absorb',
  constructor_args: ctorArgsPSV2Hex({ consolidated_pool: 100 }),
  args: [0, 2, 2, 50, hex(psOwn100.prefix), hex(psOwn100.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 1,
    inputs: [shardInput(psOwn100), activeSelfInput(), shardInput(shard50)],
    outputs: [
      { value: 1000, script_hex: psCont150WrongRefundRoot.scriptHex },
      { value: 1, covenant_id: hex(PSV2_COV) },
      { value: 1, script_hex: psOut150.scriptHex },
    ],
  },
});

fs.writeFileSync('scratch/_t1v06_check/PayoutShardV2_v03_absorb.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'absorb vectors');
