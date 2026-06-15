// pool-close-commit.mjs — bshard spine close-commit off-chain serializer (J2, 2026-06-15).
//
// The spine PoolSpine_v08_shard close_commit entry writes the State {closed, winningSide, payoutRoot,
// fold_tmpl_hash, shard_count} (committee 4-of-5 attest). The claim_passthrough recreates it byte-identical.
// This module produces the State byte serialization that validateOutputState commits, so the off-chain
// close_commit TX builder + committee sighash match the on-chain encoding exactly.
//
// STATE ENCODING (J2 compile-extracted from PoolSpine_v08_shard.sil 6d5113b2, NOT assumed — state_layout
// {start:1, len:93}, each field push-prefixed in the field-prolog):
//   [0x08][closed       i64-LE 8B]   offset 0  (prefix) / 1 (value)
//   [0x08][winningSide  i64-LE 8B]   offset 9  / 10
//   [0x20][payoutRoot   32B        ] offset 18 / 19
//   [0x20][fold_tmpl    32B        ] offset 51 / 52
//   [0x08][shard_count  i64-LE 8B]   offset 84 / 85
//   total = 9+9+33+33+9 = 93 bytes.
// (0x08 = OP_PUSHBYTES_8, 0x20 = OP_PUSHBYTES_32. int = 8-byte LE = serializeI64(n,8) for non-negative state ints.)

import { serializeI64 } from './pool-payout-root.mjs';

const PUSH8 = Buffer.from([0x08]);
const PUSH32 = Buffer.from([0x20]);

function asBuf32(x, name) {
  const b = Buffer.isBuffer(x) ? x : Buffer.from(x, 'hex');
  if (b.length !== 32) throw new Error(`${name} must be 32B, got ${b.length}`);
  return b;
}

/**
 * Serialize the spine close-commit State to the exact on-chain field-prolog bytes (93B).
 * @param {object} s  { closed, winningSide, payoutRoot(32B hex|Buffer), foldTmplHash(32B hex|Buffer), shardCount }
 * @returns {Buffer} 93-byte state region (byte-matches validateOutputState commit)
 */
export function serializeCloseCommitState({ closed, winningSide, payoutRoot, foldTmplHash, shardCount }) {
  // closed 3-state {0=open, 1=settled, 2=cancelled} — M3 F2 fix (refund flips 0→2, write-once latch; b1e9ca14).
  // The cancel state (closed=2) is set on-chain by refund_draw; off-chain it must be serializable for the
  // refund-passthrough recreated-spine state (committee/relay sighash byte-match).
  if (closed !== 0 && closed !== 1 && closed !== 2) throw new Error(`closed must be 0|1|2 (open|settled|cancelled), got ${closed}`);
  if (winningSide !== 0 && winningSide !== 1) throw new Error(`winningSide must be 0|1, got ${winningSide}`);
  if (!(Number(shardCount) >= 0)) throw new Error(`shardCount must be >= 0, got ${shardCount}`);
  const out = Buffer.concat([
    PUSH8, serializeI64(BigInt(closed), 8),
    PUSH8, serializeI64(BigInt(winningSide), 8),
    PUSH32, asBuf32(payoutRoot, 'payoutRoot'),
    PUSH32, asBuf32(foldTmplHash, 'foldTmplHash'),
    PUSH8, serializeI64(BigInt(shardCount), 8),
  ]);
  if (out.length !== 93) throw new Error(`close-commit state must be 93B, got ${out.length}`);
  return out;
}

/**
 * Assemble the close-commit values (single-source: oracle outcome + my payoutRoot + fold artifact + shard count).
 * closed is forced to 1 (this IS the close). Returns the value object + its serialized form for committee sighash.
 * @returns {{ state: object, stateBytes: Buffer, stateHex: string }}
 */
export function buildCloseCommit({ winningSide, payoutRoot, foldTmplHash, shardCount }) {
  const state = { closed: 1, winningSide, payoutRoot, foldTmplHash, shardCount };
  const stateBytes = serializeCloseCommitState(state);
  return { state, stateBytes, stateHex: stateBytes.toString('hex') };
}

// Field offsets within the 93-byte state region (for readers/verifiers).
export const CLOSE_COMMIT_LAYOUT = Object.freeze({
  closed: { prefix: 0, value: 1, len: 8 },
  winningSide: { prefix: 9, value: 10, len: 8 },
  payoutRoot: { prefix: 18, value: 19, len: 32 },
  foldTmplHash: { prefix: 51, value: 52, len: 32 },
  shardCount: { prefix: 84, value: 85, len: 8 },
  total: 93,
});
