// pool-shard-state-serialize.mjs — PoolShard_fold State (7-field) off-chain serializer (J2, 2026-06-15).
//
// M3 per-state P2SH (J1 compile-probe + J2 confirm: changing init_local_yes 0→999 changes script sha →
// State is baked into the script at state_layout{start:1, len:87}). The continuation output's scriptPubKey is
// per-state (= P2SH of template + new State), and validateOutputState binds it (TUTORIAL: "validate continuation
// into the SAME contract template"). So the relay must compute the per-state continuation P2SH:
//   new_P2SH = blake2b( input_redeem[0:1] ‖ serializePoolShardState(new_state) ‖ input_redeem[88:] )
// i.e. splice the new 87-byte State region into the input redeem at [start:start+len] and hash.
// This module produces that canonical 87-byte State region, byte-identical to the on-chain encoding.
//
// ENCODING (J2 compile-extracted from aa041d91 PoolShard_fold, NOT assumed — state_layout {start:1, len:87};
// verified base(zeros) == 08·(0)×8 ×6 + 20·(0)×32, and yes=999 → offset 1-8 = e7030000_00000000 LE):
//   [0x08][local_yes   i64-LE 8B]  off 0  / 1
//   [0x08][local_no    i64-LE 8B]  off 9  / 10
//   [0x08][count       i64-LE 8B]  off 18 / 19
//   [0x08][pool_value  i64-LE 8B]  off 27 / 28
//   [0x08][closed      i64-LE 8B]  off 36 / 37
//   [0x08][winningSide i64-LE 8B]  off 45 / 46
//   [0x20][payoutRoot  32B       ] off 54 / 55
//   total = 6*9 + 33 = 87 bytes (= state_layout.len).
// (0x08 = OP_PUSHBYTES_8, 0x20 = OP_PUSHBYTES_32; int = 8-byte LE = serializeI64(n,8) for non-negative state ints.)
// State field ORDER matches the contract State declaration (local_yes, local_no, count, pool_value, closed,
// winningSide, payoutRoot) — must not be reordered (positional baked encoding).

import { serializeI64 } from './pool-payout-root.mjs';

const PUSH8 = Buffer.from([0x08]);
const PUSH32 = Buffer.from([0x20]);

function asBuf32(x, name) {
  const b = Buffer.isBuffer(x) ? x : Buffer.from(x, 'hex');
  if (b.length !== 32) throw new Error(`${name} must be 32B, got ${b.length}`);
  return b;
}

/**
 * Serialize the PoolShard_fold State to the exact on-chain field-prolog bytes (87B).
 * @param {object} s { local_yes, local_no, count, pool_value, closed, winningSide, payoutRoot(32B hex|Buffer) }
 *                    (int fields accept bigint|number|numeric-string; all must be >= 0)
 * @returns {Buffer} 87-byte State region (byte-matches the on-chain baked State; for relay per-state P2SH splice)
 */
export function serializePoolShardState({ local_yes, local_no, count, pool_value, closed, winningSide, payoutRoot }) {
  const ints = { local_yes, local_no, count, pool_value, closed, winningSide };
  for (const [k, v] of Object.entries(ints)) {
    if (v == null) throw new Error(`${k} required`);
    if (BigInt(v) < 0n) throw new Error(`${k} must be >= 0 (state ints non-negative), got ${v}`);
  }
  if (closed !== 0 && closed !== 1 && closed !== 2 && BigInt(closed) > 2n) {
    throw new Error(`closed must be 0|1|2 (open|settled|cancelled), got ${closed}`);
  }
  const out = Buffer.concat([
    PUSH8, serializeI64(BigInt(local_yes), 8),
    PUSH8, serializeI64(BigInt(local_no), 8),
    PUSH8, serializeI64(BigInt(count), 8),
    PUSH8, serializeI64(BigInt(pool_value), 8),
    PUSH8, serializeI64(BigInt(closed), 8),
    PUSH8, serializeI64(BigInt(winningSide), 8),
    PUSH32, asBuf32(payoutRoot, 'payoutRoot'),
  ]);
  if (out.length !== 87) throw new Error(`pool-shard state must be 87B (== state_layout.len), got ${out.length}`);
  return out;
}

/**
 * Compute the per-state continuation P2SH script-hash by splicing the new State into the input redeem.
 * new_redeem = redeem[0:start] ‖ serializePoolShardState(newState) ‖ redeem[start+len:] ; scriptHash = blake2b(new_redeem).
 * The relay turns scriptHash → P2SH address (kaspa ScriptPubKeyP2SH). validateOutputState enforces this on-chain,
 * so a wrong address → TX rejected (fail-safe, no fund loss).
 * @param {Buffer} inputRedeem  the current pool UTXO's full redeem script (revealed by the relay)
 * @param {object} newState     the continuation State (7 fields)
 * @param {function} blake2b32  blake2b(buf)->32B Buffer (caller supplies, e.g. @noble/hashes blake2b dkLen 32)
 * @param {{start:number,len:number}} stateLayout  from the compiled artifact ({start:1, len:87})
 * @returns {Buffer} 32-byte continuation script-hash (→ P2SH)
 */
export function computeContinuationScriptHash(inputRedeem, newState, blake2b32, stateLayout = { start: 1, len: 87 }) {
  if (!Buffer.isBuffer(inputRedeem)) throw new Error('inputRedeem must be a Buffer (revealed redeem)');
  const stateBytes = serializePoolShardState(newState);
  if (stateBytes.length !== stateLayout.len) throw new Error(`state ${stateBytes.length}B != stateLayout.len ${stateLayout.len}`);
  const spliced = Buffer.concat([
    inputRedeem.slice(0, stateLayout.start),
    stateBytes,
    inputRedeem.slice(stateLayout.start + stateLayout.len),
  ]);
  return Buffer.from(blake2b32(spliced));
}

// Field offsets within the 87-byte State region (for readers/verifiers).
export const POOL_SHARD_STATE_LAYOUT = Object.freeze({
  local_yes: { prefix: 0, value: 1, len: 8 },
  local_no: { prefix: 9, value: 10, len: 8 },
  count: { prefix: 18, value: 19, len: 8 },
  pool_value: { prefix: 27, value: 28, len: 8 },
  closed: { prefix: 36, value: 37, len: 8 },
  winningSide: { prefix: 45, value: 46, len: 8 },
  payoutRoot: { prefix: 54, value: 55, len: 32 },
  total: 87,
});
