// NWT supplement to J2's v0.3 plan-C provenance (task 4 of Bettor dispatch 1410).
// Adapts the existing accepted "fails-only-at-sig-gate" convention (see
// docs/provenance/2026-09-14-j2-t2-kanettokenclaim/mk_kanettokenclaim_vectors.mjs V-CLAIM-1/9) to the
// v0.3 KanetTokenClaim (market_suffix_hash/witness removed) -- same rigor level as the already-accepted
// vectors for this file, not a new methodology. A genuine signed E2E PASS vector is NOT attempted: the
// cli-debugger/session tooling has zero Schnorr-signing support (grepped debugger/ source, no hits), and
// building one would mean independently reverse-engineering the VM's exact sighash preimage outside any
// existing tool -- the same gap the OLD vectors also accepted (see their own header comment referencing
// close_attest/cancel_attest B-class smoke vectors using the identical convention).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('../../../kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const p2sh = (bc) => 'aa20' + Buffer.from(b2b(bc)).toString('hex') + '87';

const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const DIR = 'D:/kanet-tn12/scratch/_nwt_wt_ktt_v03_planc/docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b';
const KTT = `${DIR}/KanetTestToken.v0.3-planC.sil`;
const CLAIM = `${DIR}/KanetTokenClaim.v0.3-planC.sil`;

const ZERO32 = new Array(32).fill(0);
const CLAIM_COV = new Array(32).fill(0xcc);
const MARKET_COV = new Array(32).fill(0xaa); // now just "some covenant", not required to look market-shaped
const WINNER_PK = new Array(32).fill(0x22);
const PLACEHOLDER_SIG = '0x' + '00'.repeat(65);

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `${DIR}/${tag}.ctor.json`;
  const outPath = `${DIR}/${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${sil}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: DIR });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}

function compileKTT(ownerCov, amount, tag) {
  // v0.3 KTT ctor: 8 fields (market_tmpl_suffix/len removed)
  const ctor = [
    { kind: 'int', value: amount }, { kind: 'bytes', value: ownerCov }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
    { kind: 'int', value: 3 }, { kind: 'int', value: 3 },
  ];
  return compileGeneric(KTT, ctor, `ktt_${tag}`);
}

const tokOwnedByClaim = compileKTT(CLAIM_COV, 100, 'owned_100');
const tokenTmplHash = tokOwnedByClaim.templateHash;
const tokAtMarket = compileKTT(MARKET_COV, 100, 'to_market_100');

function ctorArgs() {
  // v0.3 KanetTokenClaim ctor: 4 fields (market_suffix_hash removed)
  return [hex(MARKET_COV), hex(WINNER_PK), 100, hex(tokenTmplHash)];
}
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function selfInput() { return { utxo_value: 1, covenant_id: hex(CLAIM_COV), signature_script_hex: '0x00' + 'ff'.repeat(20) }; }
// dest input deliberately does NOT look market-shaped at all (no tail pattern, no template) -- this is
// exactly the point: v0.3 no longer cares.
function arbitraryDestInput() { return { utxo_value: 1, covenant_id: hex(MARKET_COV), signature_script_hex: '0x0011223344' }; }
function bareDestInput() { return { utxo_value: 1, signature_script_hex: '0x0011223344' }; } // no covenant_id declared

const tests = [];

// NWT-V03-CLAIM-1: path (i) reinvest-into-arbitrary-covenant, no market-shaped tail at all -- structurally
// everything else correct, must reach (and only fail at) the sig gate. Proves v0.3's deletion is complete:
// no residual "market shell" requirement survives on this path.
tests.push({
  name: 'NWT-V03-CLAIM-1_pass_up_to_sig_gate_arbitrary_dest_no_market_shape_required',
  function: 'spend',
  constructor_args: ctorArgs(),
  args: [PLACEHOLDER_SIG, 1, 2, true, 2, hex(tokOwnedByClaim.prefix), hex(tokOwnedByClaim.suffix)],
  expect: 'fail', // fails ONLY at checkSig -- same accepted convention as the pre-v0.3 vectors
  tx: {
    active_input_index: 0,
    inputs: [selfInput(), tokenInput(tokOwnedByClaim), arbitraryDestInput()],
    outputs: [{ value: 1 }, { value: 1 }, { value: 1, script_hex: tokAtMarket.scriptHex }],
  },
});

// NWT-V03-CLAIM-2: the ONE thing that must still be rejected after the deletion -- a bare destination input
// with no declared covenant_id (target_owner falls back to ZERO32). The retained ZERO32 guard (NWT 1176
// MUST-FIX, unrelated to market-shape) must still catch this structurally, BEFORE the sig gate is even
// reached -- proving the deletion did not collateral-damage the guard that protects real funds.
tests.push({
  name: 'NWT-V03-CLAIM-2_fail_bare_dest_zero32_guard_still_live_after_deletion',
  function: 'spend',
  constructor_args: ctorArgs(),
  args: [PLACEHOLDER_SIG, 1, 2, true, 2, hex(tokOwnedByClaim.prefix), hex(tokOwnedByClaim.suffix)],
  expect: 'fail',
  tx: {
    active_input_index: 0,
    inputs: [selfInput(), tokenInput(tokOwnedByClaim), bareDestInput()],
    outputs: [{ value: 1 }, { value: 1 }, { value: 1, script_hex: tokAtMarket.scriptHex }],
  },
});

fs.writeFileSync(`${DIR}/nwt-ktc-v03-vectors.test.json`, JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
