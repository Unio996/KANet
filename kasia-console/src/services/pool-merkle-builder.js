// B2 v0.5 Sub 2b — Pool Merkle tree builder for bettor sides verification
// Per service spec docs/poolspine-service-layer-spec-2026-05-21.md.
//
// Hash function: blake2b (= matches PoolSide.sil claim_winner Merkle verify)
// Tree depth: max 6 levels (= 2^6 = 64 leaves max, covers v0.5 50-bettor cap)
// Padding sentinel: zero hash (= 32 bytes of 0x00) for empty slots

import { createHash } from 'crypto';

// kaspa-wasm doesn't expose blake2b directly to Node — use noble-hashes OR sha256 placeholder
// Note: SS contract uses OP_BLAKE2B internally. For off-chain verification, must match exactly.
// Production version: use @noble/hashes/blake2b. For first draft, use sha256 placeholder until cross-host verify.

const MAX_DEPTH = 6;
const ZERO_HASH = Buffer.alloc(32, 0).toString('hex');

function hashLeaf(bettorPubkey) {
  // Hash leaf = blake2b(bettorPubkey || direction || stakeAmount) per spec
  // First draft: hash just bettorPubkey for simplicity (= matches PoolSide.sil first draft)
  // Production: include direction + stakeAmount for collision resistance
  const cleanPk = bettorPubkey.startsWith('0x') ? bettorPubkey.slice(2) : bettorPubkey;
  return createHash('sha256').update(Buffer.from(cleanPk, 'hex')).digest('hex');
}

function hashPair(left, right) {
  const leftBuf = Buffer.from(left, 'hex');
  const rightBuf = Buffer.from(right, 'hex');
  return createHash('sha256').update(Buffer.concat([leftBuf, rightBuf])).digest('hex');
}

/**
 * Build full Merkle tree from bettor pubkey list, padded to MAX_DEPTH.
 * @param {string[]} bettorPubkeys - hex strings (32 bytes each)
 * @returns {{ root, levels, leaves }}
 *   levels[0] = leaves
 *   levels[i+1] = parents of levels[i]
 *   levels[MAX_DEPTH] = root (single element)
 */
export function buildSidesMerkleTree(bettorPubkeys) {
  if (!Array.isArray(bettorPubkeys)) throw new Error('bettorPubkeys must be array');
  if (bettorPubkeys.length === 0) {
    // Empty market: all zero hashes
    const levels = [];
    levels[0] = [];
    return { root: ZERO_HASH, levels, leaves: [] };
  }
  if (bettorPubkeys.length > Math.pow(2, MAX_DEPTH)) {
    throw new Error(`bettor count ${bettorPubkeys.length} exceeds max ${Math.pow(2, MAX_DEPTH)} (v0.5 cap)`);
  }

  // Level 0: leaves (= hash of each bettor pubkey)
  const leaves = bettorPubkeys.map(hashLeaf);

  // Pad leaves to 2^MAX_DEPTH with ZERO_HASH
  const paddedLeaves = [...leaves];
  while (paddedLeaves.length < Math.pow(2, MAX_DEPTH)) {
    paddedLeaves.push(ZERO_HASH);
  }

  // Build tree bottom-up
  const levels = [paddedLeaves];
  for (let d = 0; d < MAX_DEPTH; d++) {
    const current = levels[d];
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(hashPair(current[i], current[i + 1]));
    }
    levels.push(next);
  }

  const root = levels[MAX_DEPTH][0];
  return { root, levels, leaves };
}

/**
 * Get Merkle proof (= sibling hashes) for a specific leaf index.
 * @param {{ levels: string[][] }} tree
 * @param {number} leafIndex
 * @returns {string[]} 6 sibling hashes (= MAX_DEPTH levels)
 */
export function getMerkleProof(tree, leafIndex) {
  if (leafIndex < 0 || leafIndex >= Math.pow(2, MAX_DEPTH)) {
    throw new Error(`leafIndex ${leafIndex} out of range`);
  }
  const proof = [];
  let idx = leafIndex;
  for (let d = 0; d < MAX_DEPTH; d++) {
    const siblingIdx = idx ^ 1;
    proof.push(tree.levels[d][siblingIdx]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/**
 * Verify Merkle proof: reconstruct root from leaf + siblings + expected root.
 * @returns {boolean}
 */
export function verifyMerkleProof(leaf, leafIndex, proof, expectedRoot) {
  if (proof.length !== MAX_DEPTH) throw new Error(`proof must be ${MAX_DEPTH} levels`);
  let current = leaf;
  let idx = leafIndex;
  for (let d = 0; d < MAX_DEPTH; d++) {
    const sibling = proof[d];
    if (idx % 2 === 0) {
      current = hashPair(current, sibling);
    } else {
      current = hashPair(sibling, current);
    }
    idx = Math.floor(idx / 2);
  }
  return current === expectedRoot;
}

export { MAX_DEPTH, ZERO_HASH, hashLeaf, hashPair };
