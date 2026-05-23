// Test: noble-hashes blake2b-256 vs kaspa-wasm internal blake2b (= P2SH addr derivation)
// Verifies our off-chain blake2b matches what kaspa-wasm + SS contract OP_BLAKE2B uses.
//
// Method: build a known redeem script, compute P2SH addr via kaspa-wasm
// (which internally does blake2b(redeem) for the P2SH lock), then independently
// compute blake2b-256(redeem) via noble-hashes. Decode kaspa address back to the
// hash bytes and assert match.

import { blake2b } from '@noble/hashes/blake2b';

const kaspa = await import('kaspa-wasm');
const { ScriptBuilder, addressFromScriptPublicKey, Address } = kaspa;

// Construct a minimal sample redeem script (= 4 OP_NOP bytes).
// Any byte sequence works for hash verification.
const redeem = new Uint8Array([0x61, 0x61, 0x61, 0x61]); // 4 × OP_NOP

// Compute blake2b-256 off-chain
const nobleHash = Buffer.from(blake2b(redeem, { dkLen: 32 })).toString('hex');

// Build P2SH via kaspa-wasm
const builder = ScriptBuilder.fromScript(redeem);
const p2shSpk = builder.createPayToScriptHashScript();

// kaspa-wasm ScriptPublicKey.script returns a hex string, not Uint8Array.
// Layout: [OP_BLAKE2B 0xaa] [OP_DATA_32 0x20] [32 bytes hash] [OP_EQUAL 0x87]
const spkHex = typeof p2shSpk.script === 'string' ? p2shSpk.script : Buffer.from(p2shSpk.script).toString('hex');
console.log('p2sh spk hex:', spkHex);
const spkBytes = Buffer.from(spkHex, 'hex');
const kaspaHashHex = spkBytes.subarray(2, 34).toString('hex');

console.log('redeem:', Buffer.from(redeem).toString('hex'));
console.log('noble blake2b-256:', nobleHash);
console.log('kaspa P2SH hash  :', kaspaHashHex);
console.log('match             :', nobleHash === kaspaHashHex ? '✓' : '✗');

if (nobleHash !== kaspaHashHex) {
  console.error('FAIL: noble blake2b != kaspa P2SH hash');
  process.exit(1);
}
console.log('PASS — noble-hashes blake2b matches kaspa OP_BLAKE2B-256');
