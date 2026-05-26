// NWT sub 4 SS unit test — silverc compile + abi structure verify
//
// Per Bettor r40 + J1 #26 endorse (a) NWT lean:
//   - NWT 自家 unit test (= 跟 sub 4 SS commit 同 ship per memory feedback_post_fix_real_chain_regression_test_required 5/21)
//   - 真链 mutation TX behavior verify defer J1 operator hat Tier 4 e2e
//
// 验证 invariants (= sub 4 SS file edit + J2 sub 5b align):
//   1. PredictionEscrowUnanimous5 compile PASS + correct contract_name
//   2. PoolSpine compile PASS + correct contract_name
//   3. PredictionEscrowUnanimous5 abi:
//      - settle_dispute entry exists (= renamed from settle, 6 inputs: 5 sig + winner)
//      - settle_consensual entry exists NEW (= 3 inputs: makerSig, takerSig, winner) — J1 #C1 fix verified by entrypoint presence
//      - refund_both unchanged (= 1 input makerSig)
//      - refund_maker_unjoined unchanged
//   4. PoolSpine abi:
//      - settle_unanimous + settle_majority_forfeit_1 + refund_unanimous_silent + refund_maker_unjoined + refund_disagreement 全 present (= 现 entries 不 删)
//   5. Both contracts script bytes nontrivial (= > 500 bytes, sanity check)
//
// Exit 0 if all PASS, exit 1 if any FAIL.
//
// memory:
//   - feedback_post_fix_real_chain_regression_test_required 5/21 — production code change 必 add regression test
//   - feedback_mutation_test_real_invoke 5/20 — import production module + invoke real exported
//   - feedback_silent_skip_pattern_invariant_test 5/14 — helper safety return on unknown shape 必 invariant test (= 此 unit test 是 invariant test)
//   - KI-12 silent skip 第 18 次 (NWT r8 自承) — settle_consensual comment-only constraint = silent skip 防

import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';

const SILVERC = process.env.SILVERC_PATH || 'D:/silverscript/target/release/silverc.exe';
const SPINE_SIL = 'D:/kanet-tn12/kasia-console/src/lib/PoolSpine.sil';
const ESCROW_SIL = 'D:/kanet-tn12/kasia-console/src/lib/PredictionEscrowUnanimous5.sil';

function bytes32Expr(hexStr) {
  const clean = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
  if (clean.length !== 64) throw new Error(`bytes32 must be 64 hex chars, got ${clean.length}`);
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i+2), 16));
  return { kind: 'array', data: bytes.map(b => ({ kind: 'byte', data: b })) };
}

function intExpr(n) {
  return { kind: 'int', data: n };
}

function compile(silPath, ctorJson, label) {
  const ctorPath = `D:/kanet-tn12/kasia-console/_ctor_unit_${label}.json`;
  writeFileSync(ctorPath, JSON.stringify(ctorJson));
  try {
    const stdout = execFileSync(SILVERC, [silPath, '--ctor', ctorPath, '-c'], {
      stdio: 'pipe',
      timeout: 30_000,
    });
    return JSON.parse(stdout.toString());
  } catch (e) {
    const stderr = e.stderr?.toString() || '';
    throw new Error(`silverc compile ${label} fail: ${e.message} | stderr: ${stderr.slice(0, 300)}`);
  }
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: !!condition, detail });
}

// === Test PredictionEscrowUnanimous5 ===

const escrowCtor = [
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000001'),
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000002'),
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000003'),
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000011'),
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000012'),
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000013'),
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000014'),
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000015'),
  intExpr(1779800000),
  intExpr(13130),
  intExpr(100),
  intExpr(100),  // oracleFeePct NEW
  intExpr(12500000000),
  intExpr(12500000000),
];

let escrowArtifact;
try {
  escrowArtifact = compile(ESCROW_SIL, escrowCtor, 'escrow');
  check('escrow_compile_pass', true);
  check('escrow_contract_name', escrowArtifact.contract_name === 'PredictionEscrowUnanimous5',
    `got ${escrowArtifact.contract_name}`);
  check('escrow_script_nontrivial', escrowArtifact.script.length > 500,
    `got ${escrowArtifact.script.length} bytes`);
} catch (e) {
  check('escrow_compile_pass', false, e.message);
}

if (escrowArtifact) {
  const abiNames = (escrowArtifact.abi || []).map(e => e.name);
  check('escrow_abi_has_settle_dispute', abiNames.includes('settle_dispute'),
    `entries: ${abiNames.join(',')}`);
  check('escrow_abi_has_settle_consensual', abiNames.includes('settle_consensual'),
    `entries: ${abiNames.join(',')}`);
  check('escrow_abi_has_refund_both', abiNames.includes('refund_both'));
  check('escrow_abi_has_refund_maker_unjoined', abiNames.includes('refund_maker_unjoined'));
  check('escrow_abi_no_old_settle_name', !abiNames.includes('settle'),
    `should have been renamed to settle_dispute`);

  const settleDispute = escrowArtifact.abi.find(e => e.name === 'settle_dispute');
  if (settleDispute) {
    const inputNames = settleDispute.inputs.map(i => i.name);
    check('escrow_settle_dispute_inputs', inputNames.length === 6 && inputNames.includes('winner'),
      `inputs: ${inputNames.join(',')}`);
  }

  const settleConsensual = escrowArtifact.abi.find(e => e.name === 'settle_consensual');
  if (settleConsensual) {
    const inputNames = settleConsensual.inputs.map(i => i.name);
    check('escrow_settle_consensual_inputs',
      inputNames.length === 3 && inputNames.includes('makerSig') && inputNames.includes('takerSig') && inputNames.includes('winner'),
      `inputs: ${inputNames.join(',')}`);
  }
}

// === Test PoolSpine ===

const spineCtor = [
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000001'),
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000002'),
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000011'),
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000012'),
  bytes32Expr('0000000000000000000000000000000000000000000000000000000000000013'),
  intExpr(1779800000),
  intExpr(13130),
  intExpr(100),
  intExpr(100),  // oracleFeePct NEW
  intExpr(100000000),
  intExpr(7500000000),
  bytes32Expr('00000000000000000000000000000000000000000000000000000000000000ff'),
];

let spineArtifact;
try {
  spineArtifact = compile(SPINE_SIL, spineCtor, 'spine');
  check('spine_compile_pass', true);
  check('spine_contract_name', spineArtifact.contract_name === 'PoolSpine');
  check('spine_script_nontrivial', spineArtifact.script.length > 500,
    `got ${spineArtifact.script.length} bytes`);
} catch (e) {
  check('spine_compile_pass', false, e.message);
}

if (spineArtifact) {
  const abiNames = (spineArtifact.abi || []).map(e => e.name);
  const expectedEntries = [
    'settle_unanimous',
    'settle_majority_forfeit_1',
    'refund_unanimous_silent',
    'refund_maker_unjoined',
    'refund_disagreement',
  ];
  for (const name of expectedEntries) {
    check(`spine_abi_has_${name}`, abiNames.includes(name),
      `entries: ${abiNames.join(',')}`);
  }
}

// === Report ===

let passCount = 0, failCount = 0;
console.log('\n=== NWT sub 4 SS unit test ===\n');
for (const r of results) {
  if (r.pass) {
    console.log(`  ✓ ${r.name}`);
    passCount++;
  } else {
    console.log(`  ✗ ${r.name} ${r.detail ? `(${r.detail})` : ''}`);
    failCount++;
  }
}
console.log(`\n${passCount}/${passCount + failCount} PASS\n`);
process.exit(failCount > 0 ? 1 : 0);
