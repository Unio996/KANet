// pool-template-artifact.mjs — foreign-template artifact builder for validateOutputStateWithTemplate /
// readInputStateWithTemplate (J2, 2026-06-15, bshard register↔PoolSide leaf-side binding).
//
// The bshard shard-leaf covenant binds a bettor's stake to a real PoolSide output via
// validateOutputStateWithTemplate(psIdx, {PoolSide State}, templatePrefix, templateSuffix, expectedTemplateHash).
// J1's leaf .sil bakes (templatePrefix, templateSuffix, expectedTemplateHash) as constants. This module
// produces those constants from the silverc-compiled PoolSide artifact — byte-matching the on-chain check.
//
// EXACT FORMULA (source-verified, silverscript-lang/src/compiler/compile.rs L1871-1883, NOT assumed):
//   prefix = redeem[0 .. state_layout.start]
//   state  = redeem[state_layout.start .. state_layout.start + state_layout.len]   (EXCLUDED from template)
//   suffix = redeem[state_layout.start + state_layout.len .. ]
//   actual_template = prefix ‖ suffix
//   expected_template_hash = blake2b(actual_template)          // dkLen 32
//   P2SH = ScriptPubKeyP2SHFromRedeemScript(prefix ‖ state ‖ suffix)
//
// state_layout {start, len} is emitted by silverc (compile.rs L185: start = selector_prefix_len,
// len = field_prolog_script.len()). A contract with NO explicit State has len 0 → not templatable
// (the sharded PoolSide variant must declare its State fields explicitly — J1 SS domain).

import { blake2b } from '@noble/hashes/blake2b';

/**
 * @param {{script:number[]|Buffer, state_layout:{start:number,len:number}}} compiled  silverc output JSON
 * @returns {{templatePrefix:Buffer, templateSuffix:Buffer, templatePrefixLen:number, templateSuffixLen:number,
 *            encodedStateLen:number, expectedTemplateHash:Buffer, expectedTemplateHashHex:string}}
 */
export function extractTemplateArtifact(compiled) {
  const script = Buffer.from(compiled.script);
  const sl = compiled.state_layout;
  if (!sl || typeof sl.start !== 'number' || typeof sl.len !== 'number') {
    throw new Error('compiled.state_layout {start,len} required (recompile with silverc that emits state_layout)');
  }
  if (sl.len <= 0) {
    throw new Error('contract has no explicit State (state_layout.len=0) — cannot template; declare State fields');
  }
  if (sl.start < 0 || sl.start + sl.len > script.length) {
    throw new Error(`state_layout out of bounds: start=${sl.start} len=${sl.len} script=${script.length}`);
  }
  const prefix = script.subarray(0, sl.start);
  const stateRegion = script.subarray(sl.start, sl.start + sl.len);
  const suffix = script.subarray(sl.start + sl.len);
  // round-trip invariant: prefix ‖ state ‖ suffix == full redeem
  if (Buffer.concat([prefix, stateRegion, suffix]).compare(script) !== 0) {
    throw new Error('internal: prefix+state+suffix != redeem');
  }
  const template = Buffer.concat([prefix, suffix]);
  const expectedTemplateHash = Buffer.from(blake2b(template, { dkLen: 32 }));
  return {
    templatePrefix: prefix,
    templateSuffix: suffix,
    templatePrefixLen: prefix.length,
    templateSuffixLen: suffix.length,
    encodedStateLen: stateRegion.length,
    expectedTemplateHash,
    expectedTemplateHashHex: expectedTemplateHash.toString('hex'),
  };
}

/** Convenience: load a silverc output JSON file and extract the artifact. */
export function extractTemplateArtifactFromFile(path, readFileSync) {
  const compiled = JSON.parse(readFileSync(path, 'utf8'));
  return extractTemplateArtifact(compiled);
}
