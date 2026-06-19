// J2.1 (Bettor r3+r6+r14 + path A LOCK r19 + fix d5d4ecbdd r126) — pool merkle derivation for v0.6.
//
// Mirrors J1's PoolSpine_v06.sil + PoolSide_v06.sil position-aware climb (d5d4ecbdd r126 fix
// closing J2 r105 + Bettor r20 finding: original "leftmost-only" climb was broken for any
// non-position-0 leaf → protocol liveness 0%).
//
// Algorithm (byte-identical with d5d4ecbdd path A SS):
//   - hash = blake2b-256 (Kaspa native, silverc primitive)
//   - leaf = blake2b(pk_bytes) — 32 bytes from 32-byte pk
//   - tree depth = 8 (pool ≤256, Bettor r12 + J2 r102 economic justification)
//   - pad: repeat the last leaf to fill 2^depth slots (J1 pool-p2sh-v06.mjs convention)
//   - sort: oracle PKs ascending (= deterministic, 0 ambiguity)
//   - internal node: blake2b(left || right)
//   - proof: 8 sibling hashes + leaf index (= position bits for climb direction)
//   - SS climb verify: bit_i = (idx >> i) & 1; if 0 → hash(cur || sib), if 1 → hash(sib || cur)
//
// This module owns: buildPoolMerkleTree, getPoolMerkleProof, verifyPoolMerkleProof.
// Used by: pool snapshot (= bake into spine ctor) + committee proof generation (= settle args).

import { blake2b } from '@noble/hashes/blake2b';

const POOL_DEPTH = 8;
const POOL_MAX_SIZE = 1 << POOL_DEPTH; // 256

function b2b(buf) {
  return Buffer.from(blake2b(buf, { dkLen: 32 }));
}

function cat(a, b) {
  return Buffer.concat([a, b]);
}

function pkToBytes(pkHex) {
  const clean = pkHex.startsWith('0x') ? pkHex.slice(2) : pkHex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error(`pk must be 64 hex chars (32 bytes), got ${clean.length}`);
  return Buffer.from(clean, 'hex');
}

export function hashPoolLeaf(pkHex) {
  return b2b(pkToBytes(pkHex));
}

/**
 * Build full pool merkle tree from oracle PK list.
 * Returns: { root, levels, sortedPks } where:
 *   - root: 32-byte Buffer
 *   - levels: array [level0..level8], level0 = padded leaves, level8 = [root]
 *   - sortedPks: PKs sorted ascending hex (= deterministic input ordering)
 *
 * Pool size constraint: 1 ≤ pks.length ≤ 256 (POOL_MAX_SIZE).
 */
export function buildPoolMerkleTree(pkHexList) {
  if (!Array.isArray(pkHexList)) throw new Error('pkHexList must be array');
  if (pkHexList.length === 0) throw new Error('pool empty (≥1 required)');
  if (pkHexList.length > POOL_MAX_SIZE) {
    throw new Error(`pool size ${pkHexList.length} exceeds max ${POOL_MAX_SIZE} (depth-${POOL_DEPTH})`);
  }

  // sort ascending (case-insensitive hex)
  const sortedPks = [...pkHexList].map(s => {
    const c = s.startsWith('0x') ? s.slice(2) : s;
    return c.toLowerCase();
  }).sort();

  // level 0: leaves
  const leaves = sortedPks.map(hashPoolLeaf);

  // pad to 256 by repeating the last leaf (J1 doc convention)
  const padded = [...leaves];
  const lastLeaf = leaves[leaves.length - 1];
  while (padded.length < POOL_MAX_SIZE) padded.push(lastLeaf);

  // build tree bottom-up
  const levels = [padded];
  for (let d = 0; d < POOL_DEPTH; d++) {
    const cur = levels[d];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) {
      next.push(b2b(cat(cur[i], cur[i + 1])));
    }
    levels.push(next);
  }

  const root = levels[POOL_DEPTH][0];
  return { root, levels, sortedPks };
}

/**
 * Get merkle proof for oracle PK at given pool index.
 *
 * Index = position of pk in sortedPks (0-255). Caller resolves pk → index via sortedPks lookup.
 * Returns: 8 sibling Buffers (one per depth level, level 0 first).
 */
export function getPoolMerkleProof(tree, leafIndex) {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= POOL_MAX_SIZE) {
    throw new Error(`leafIndex ${leafIndex} out of range [0, ${POOL_MAX_SIZE})`);
  }
  const siblings = [];
  let idx = leafIndex;
  for (let d = 0; d < POOL_DEPTH; d++) {
    const sibIdx = idx ^ 1;
    siblings.push(tree.levels[d][sibIdx]);
    idx = idx >> 1;
  }
  return siblings;
}

/**
 * Verify merkle proof — mirrors SS climb byte-identical (d5d4ecbdd r126 path A fix).
 * Returns: true if leaf at leafIndex with siblings produces expectedRoot.
 *
 * SS climb: bit_i = (idx >> i) & 1; if 0 → hash(cur||sib), if 1 → hash(sib||cur).
 */
export function verifyPoolMerkleProof(leafPkHex, leafIndex, siblings, expectedRoot) {
  if (!Array.isArray(siblings) || siblings.length !== POOL_DEPTH) {
    throw new Error(`siblings must be ${POOL_DEPTH}-element array`);
  }
  let cur = hashPoolLeaf(leafPkHex);
  let idx = leafIndex;
  for (let d = 0; d < POOL_DEPTH; d++) {
    const sib = siblings[d];
    const bit = idx & 1;
    cur = bit === 0 ? b2b(cat(cur, sib)) : b2b(cat(sib, cur));
    idx = idx >> 1;
  }
  const expected = Buffer.isBuffer(expectedRoot) ? expectedRoot : Buffer.from(expectedRoot, 'hex');
  return cur.equals(expected);
}

/**
 * Derive committeePkHash = blake2b(c0||c1||c2||c3||c4) — matches PoolSpine_v06 + PoolSide_v06
 * dispute_reveal commitment. Pks are 32-byte hex strings, concatenated as bytes.
 */
export function deriveCommitteePkHash(committeePkHexArray) {
  if (!Array.isArray(committeePkHexArray) || committeePkHexArray.length !== 5) {
    throw new Error('committee must be exactly 5 PKs');
  }
  const concat = Buffer.concat(committeePkHexArray.map(pkToBytes));
  return b2b(concat);
}

export { POOL_DEPTH, POOL_MAX_SIZE };
