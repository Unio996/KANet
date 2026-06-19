// pool-payout-root.mjs — #31 payoutRoot off-chain builder (productionized from J2 standalone).
// Feeds chunk_0 plan_commit (= payoutRoot). MUST byte-match SS leaf = blake2b(pk ‖ byte[](amount,8)).
//
// ENDIANNESS (J2 source-verified, NOT assumed): silverscript byte[](int,size) → OpNum2Bin →
//   rusty-kaspa data_stack.rs serialize_i64() = LITTLE-ENDIAN sign-magnitude (low byte first, sign bit
//   in LAST byte). sompi > 0 & < 2^63 → 8-byte UNSIGNED LITTLE-ENDIAN. byte-match self-test 7/7 +
//   re-climb 20/20 (= SS depth-8 climb replica). padding = ZERO32 (malleability-free, NOT dup-last).
import { blake2b } from '@noble/hashes/blake2b';

const ZERO32 = Buffer.alloc(32);
const DEPTH = 8;
const CAP = 1 << DEPTH; // 256 winners/shard (>256 → #26 bshard sharding)

// Exact JS port of rusty-kaspa serialize_i64(num, size) — the on-chain byte[](int,size) behavior (LE sign-magnitude).
export function serializeI64(num, size) {
  const sign = num < 0n ? -1 : (num > 0n ? 1 : 0);
  let positive = num < 0n ? -num : num;
  const bytes = [];
  let lastSaturated = false;
  while (true) {
    if (positive === 0n) {
      if (lastSaturated) { bytes.push(0); lastSaturated = false; } else break;
    } else {
      const value = Number(positive & 0xffn);
      lastSaturated = (value & 0x80) !== 0;
      positive >>= 8n;
      bytes.push(value);
    }
  }
  if (size != null) {
    if (bytes.length > size) throw new Error(`NumberTooLong ${num} > ${size}B`);
    while (bytes.length < size) bytes.push(0);
  }
  if (sign === -1) bytes[bytes.length - 1] |= 0x80;
  return Buffer.from(bytes);
}

// leaf_k = blake2b(pk32 ‖ serializeI64(amount,8))[dkLen 32].
export function payoutLeaf(pkHex, amountSompi) {
  const pk = Buffer.from(pkHex, 'hex');
  if (pk.length !== 32) throw new Error(`pk must be 32B, got ${pk.length}`);
  if (BigInt(amountSompi) <= 0n) throw new Error(`payout amount must be > 0, got ${amountSompi}`);  // min-pot guard
  return Buffer.from(blake2b(Buffer.concat([pk, serializeI64(BigInt(amountSompi), 8)]), { dkLen: 32 }));
}

function levelsOf(winners) {
  if (winners.length > CAP) throw new Error(`>${CAP} winners needs depth>${DEPTH} (SS climb is depth-8; >256 → #26 bshard)`);
  const levels = [];
  let level = new Array(CAP).fill(ZERO32);
  winners.forEach((w, i) => { level[i] = payoutLeaf(w.pk, w.amount); });
  levels.push(level);
  for (let d = 0; d < DEPTH; d++) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(Buffer.from(blake2b(Buffer.concat([level[i], level[i + 1]]), { dkLen: 32 })));
    levels.push(next); level = next;
  }
  return levels;
}

// depth-8 position-aware merkle root = plan_commit (committee-sign in chunk_0).
export function payoutRoot(winners) { return levelsOf(winners)[DEPTH][0]; }

// 8 siblings for leaf at merkle_index idx (flat, = SS winnerSiblings[k*8+lvl] layout).
export function merkleProof(winners, idx) {
  const levels = levelsOf(winners);
  const sibs = []; let pos = idx;
  for (let lvl = 0; lvl < DEPTH; lvl++) { sibs.push(levels[lvl][pos ^ 1]); pos >>= 1; }
  return sibs;
}

// re-climb leaf+siblings to root — EXACT SS climb replica (b_lvl = (idx>>lvl)&1).
export function climbProof(leaf, idx, siblings) {
  let cur = leaf;
  for (let lvl = 0; lvl < DEPTH; lvl++) {
    const b = (idx >> lvl) & 1, sib = siblings[lvl];
    cur = Buffer.from(blake2b(b === 0 ? Buffer.concat([cur, sib]) : Buffer.concat([sib, cur]), { dkLen: 32 }));
  }
  return cur;
}

export const PAYOUT_DEPTH = DEPTH;
export const MAX_WINNERS_PER_SHARD = CAP;
