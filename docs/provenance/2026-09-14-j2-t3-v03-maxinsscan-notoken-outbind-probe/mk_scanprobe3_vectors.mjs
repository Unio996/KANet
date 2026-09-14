import fs from 'node:fs';
const D = JSON.parse(fs.readFileSync('D:/kanet-tn12/scratch/_j2_wt_t3_market/docs/provenance/2026-09-13-j2-t1-v0.2-market-scan-probe/token_stub.derived.json', 'utf8'));
const A = JSON.parse(fs.readFileSync('D:/kanet-tn12/scratch/_j2_wt_t3_market/docs/provenance/2026-09-13-j2-t1-v0.2-market-scan-probe/TokenStub_A.compiled.json', 'utf8'));
const B = JSON.parse(fs.readFileSync('D:/kanet-tn12/scratch/_j2_wt_t3_market/docs/provenance/2026-09-13-j2-t1-v0.2-market-scan-probe/TokenStub_B.compiled.json', 'utf8'));

function fullBytecodeHex(compiledJson) {
  const bc = Object.values(compiledJson.contracts)[0].compiled.bytecode;
  return '0x' + Buffer.from(bc).toString('hex');
}
const MARKET_COV_ID = '0x' + '11'.repeat(32);  // == TokenStub A/B's owner field (both minted with owner=market)
const OTHER_COV_ID = '0x' + '99'.repeat(32);

function tokenInput(variant) {
  return {
    utxo_value: 10,
    utxo_script_hex: '0x' + variant.spk,
    signature_script_hex: fullBytecodeHex(variant === D.A ? A : B),
  };
}
const OTHER_SIG = '0x00' + 'ff'.repeat(20);
function fillerInput() { return { utxo_value: 1, covenant_id: MARKET_COV_ID, signature_script_hex: OTHER_SIG }; }

const ctorArgs = ['0x' + D.A.prefix, D.A.prefix.length / 2, '0x' + D.A.suffix, D.A.suffix.length / 2, '0x' + D.A.template_hash];

const vectors = [];

// V-bound-1: exactly 8 inputs (the bound), 3 owned TokenStub_A instances (amount 100 each per TokenStub ctor) + 5 filler -> total=300 pass.
vectors.push({
  name: 'V-bound-1_pass_exactly_at_bound_8_inputs',
  function: 'scan_absorb', constructor_args: ctorArgs, args: [300], expect: 'pass',
  tx: { active_input_index: 0, inputs: [fillerInput(), tokenInput(D.A), tokenInput(D.A), tokenInput(D.A), fillerInput(), fillerInput(), fillerInput(), fillerInput()], outputs: [{ value: 1, covenant_id: MARKET_COV_ID }] },
});

// V-bound-2: 9 inputs (bound+1) -> must be rejected by require(len<=8) alone; content has zero owned tokens so if
// the guard were absent the scan itself would still pass (declared_total=0) -- isolates the guard as sole cause.
vectors.push({
  name: 'V-bound-2_fail_bound_plus_one_rejected_by_length_guard',
  function: 'scan_absorb', constructor_args: ctorArgs, args: [0], expect: 'fail',
  tx: { active_input_index: 0, inputs: new Array(9).fill(0).map(fillerInput), outputs: [{ value: 1, covenant_id: MARKET_COV_ID }] },
});

// V-bound-3: victim (owned token) placed at the LAST reachable index (7) among exactly 8 inputs -- proves loop
// unroll genuinely reaches index 7, not silently truncated short of the declared bound.
const idx7Inputs = [fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), fillerInput(), tokenInput(D.B)];
vectors.push({
  name: 'V-bound-3_pass_victim_at_last_reachable_index_7',
  function: 'scan_absorb', constructor_args: ctorArgs, args: [250], expect: 'pass',
  tx: { active_input_index: 0, inputs: idx7Inputs, outputs: [{ value: 1, covenant_id: MARKET_COV_ID }] },
});
// negative counterpart: same tx but declared_total wrong (omit the victim's amount) -> must fail, proving the
// scan is actually reading index 7's value, not just letting the require pass vacuously.
vectors.push({
  name: 'V-bound-4_fail_victim_at_index_7_not_declared',
  function: 'scan_absorb', constructor_args: ctorArgs, args: [0], expect: 'fail',
  tx: { active_input_index: 0, inputs: idx7Inputs, outputs: [{ value: 1, covenant_id: MARKET_COV_ID }] },
});

// ---------- 1123-b3: B 类入口 noTokenInput 负向量 ----------
// V-notoken-1: no token-shaped input present -> pass (legitimate B-class call).
vectors.push({
  name: 'V-notoken-1_pass_no_token_input_present',
  function: 'no_token_entry', constructor_args: ctorArgs, args: [5], expect: 'pass',
  tx: { active_input_index: 0, inputs: [fillerInput(), fillerInput()], outputs: [{ value: 1, covenant_id: MARKET_COV_ID }] },
});
// V-notoken-2: an owned (owner==market) token-shaped input is smuggled in, no continuation anywhere for it,
// entry itself is a no-op-ish call (dummy_state_change=0) -> must fail via require(!found).
vectors.push({
  name: 'V-notoken-2_fail_smuggled_owned_token_no_continuation_noop_entry',
  function: 'no_token_entry', constructor_args: ctorArgs, args: [0], expect: 'fail',
  tx: { active_input_index: 0, inputs: [fillerInput(), tokenInput(D.A)], outputs: [{ value: 1, covenant_id: MARKET_COV_ID }] },
});
// V-notoken-3: same smuggled token, but entry has a REAL (non-zero) state-change witness -> must still fail,
// proving the guard is not tied to the entry being a no-op fixture (1123-b3 second negative).
vectors.push({
  name: 'V-notoken-3_fail_smuggled_owned_token_with_real_state_change',
  function: 'no_token_entry', constructor_args: ctorArgs, args: [42], expect: 'fail',
  tx: { active_input_index: 0, inputs: [fillerInput(), tokenInput(D.A)], outputs: [{ value: 1, covenant_id: MARKET_COV_ID }] },
});

// ---------- 1127①: 输出侧去向负向量 ----------
// V-outbind-1: input scan matches (300), output continuation goes back to the SAME covenant (derived) -> pass.
vectors.push({
  name: 'V-outbind-1_pass_output_bound_to_self',
  function: 'scan_and_bind_output', constructor_args: ctorArgs, args: [300, 0], expect: 'pass',
  tx: {
    active_input_index: 0,
    inputs: [fillerInput(), tokenInput(D.A), tokenInput(D.A), tokenInput(D.A)],
    outputs: [{ value: 300, covenant_id: MARKET_COV_ID }],
  },
});
// V-outbind-2: SAME input scan matches (300, correctly computed), but the output continuation's covenant_id
// is a stranger's id instead of the market's own -- input side is fine, output side silently diverts. Must fail.
const STRANGER_COV_ID = '0x' + '99'.repeat(32);
vectors.push({
  name: 'V-outbind-2_fail_input_matched_output_diverted_to_stranger',
  function: 'scan_and_bind_output', constructor_args: ctorArgs, args: [300, 0], expect: 'fail',
  tx: {
    active_input_index: 0,
    // stranger's covenant_id also present as an (unrelated, non-token) input elsewhere in the same tx, so the
    // output's declared covenant_id resolves via the "continuation" equality path (not a fresh genesis) --
    // isolates the failure to MY require(OpOutputCovenantId==OpInputCovenantId(active)) check, not to the
    // unrelated consensus-layer genesis pre-check (same lesson as the T1 V-T-6b vector construction).
    inputs: [fillerInput(), tokenInput(D.A), tokenInput(D.A), tokenInput(D.A), { utxo_value: 1, covenant_id: STRANGER_COV_ID, signature_script_hex: OTHER_SIG }],
    outputs: [{ value: 300, covenant_id: STRANGER_COV_ID, authorizing_input: 4 }],
  },
});

fs.writeFileSync('scratch/_t1v06_check/MarketScanProbe3.test.json', JSON.stringify({ tests: vectors }, null, 1));
console.log('wrote', vectors.length, 'vectors; TokenStub_B amount=250 per its ctor');
