// pool-fold.mjs — bshard trustless fold OFF-CHAIN helpers (J2, 2026-06-15).
//
// Pairs with J1 on-chain fold covenant PoolShard_fold.sil (ddd043d7). Provides:
//   (1) foldRootCommit() — off-chain commit_v2 builder; MUST byte-match the SS root commit (PoC-3 byte-match gate).
//   (2) buildFoldTree()  — by-root deterministic k-ary fold plan (件3 fold调度; structure from on-chain shard roots).
//
// ── commit_v2 byte layout (EXACT, from PoolShard_fold.sil fold()) ──
//   commit_pre = byte[](yes_sum,16) ‖ byte[](no_sum,16) ‖ byte[](market_id) ‖ byte[](shard_count,4)
//   commit_v2  = blake2b(commit_pre)[dkLen 32]
//   = 16 + 16 + 32 + 4 = 68-byte preimage.
//
// ENDIANNESS: byte[](int,size) = rusty-kaspa serialize_i64 = LE sign-magnitude (J2 source-verified in
//   pool-payout-root.mjs, byte-match 7/7 @size8). We REUSE that exact serializeI64 (same algorithm, sizes
//   16/4) rather than reinvent — the definitive cross-layer byte-match is asserted at fold e2e (件3).

import { blake2b } from '@noble/hashes/blake2b';
import { serializeI64 } from './pool-payout-root.mjs';

// Fold tree fan-in (k). SINGLE SOURCE — must be identical across (a) buildFoldTree, (b) the fold contract
// max_fan_in ctor, and (c) the PoolSide claim's fold_template_hash. The fold template (prefix/suffix) bakes
// the unrolled for-loop, so the template hash is k-dependent → a k mismatch breaks claim's
// readInputStateWithTemplate. J2 件4 mass实测 (2026-06-15): k=16 is conservative (compute 13% / bytecode 40%
// of caps), max viable ≈32; depth log_16 (10k shards → 4 levels). fold is zero-committee-sig → no 880 wall.
export const FOLD_FANIN = 4; // route-split: PoolLeaf max_fan_in=4 (4-ary fold; k=16 redeem exceeded 9999 script-units)

/**
 * Off-chain fold root commit_v2 — byte-matches PoolShard_fold.sil require(blake2b(...)==commit_v2).
 * @param {number|bigint|string} globalYesSompi  folded global YES total (= Σ all shards localYes)
 * @param {number|bigint|string} globalNoSompi   folded global NO total
 * @param {string} marketIdHex32                 32-byte market_id (64 hex chars) — same value baked in fold ctor
 * @param {number} shardCount                    total shard count (关池锚; root.count must == this)
 * @returns {Buffer} 32-byte commit_v2
 */
export function foldRootCommit(globalYesSompi, globalNoSompi, marketIdHex32, shardCount) {
  const yes = serializeI64(BigInt(globalYesSompi), 16);
  const no  = serializeI64(BigInt(globalNoSompi), 16);
  const mid = Buffer.from(marketIdHex32, 'hex');
  if (mid.length !== 32) throw new Error(`market_id must be 32B (64 hex), got ${mid.length}B`);
  const cnt = serializeI64(BigInt(shardCount), 4);
  const preimage = Buffer.concat([yes, no, mid, cnt]);
  if (preimage.length !== 68) throw new Error(`fold commit preimage must be 68B, got ${preimage.length}`);
  return Buffer.from(blake2b(preimage, { dkLen: 32 }));
}

export function foldRootCommitHex(globalYesSompi, globalNoSompi, marketIdHex32, shardCount) {
  return foldRootCommit(globalYesSompi, globalNoSompi, marketIdHex32, shardCount).toString('hex');
}

/**
 * by-root deterministic k-ary fold plan. Structure is derived purely from the ordered shard leaf set
 * (canonical order = shard_index ASC) + max_fan_in k → zero coordination, every node builds the same tree.
 * Returns an array of fold-TX "levels"; each level is an array of fold ops, each op consumes `inputs`
 * (leaf or prior-level fold-node ids) → produces one node. The last level's single node = root.
 *
 * @param {Array<{id:string}|string>} shardLeaves  ordered shard leaves (shard_index ASC); .id or raw id
 * @param {number} k  max_fan_in (= measured in 件4; on-chain for-loop bound)
 * @returns {{ levels: Array<Array<{node:string, inputs:string[]}>>, rootId:string, txCount:number }}
 */
export function buildFoldTree(shardLeaves, k) {
  if (k < 2) throw new Error(`fan-in k must be >= 2, got ${k}`);
  const ids = shardLeaves.map(s => (typeof s === 'string' ? s : s.id));
  if (ids.length === 0) throw new Error('no shard leaves to fold');
  if (ids.length === 1) return { levels: [], rootId: ids[0], txCount: 0 }; // single shard = already its own root

  const levels = [];
  let cur = ids;
  let levelNo = 0;
  let txCount = 0;
  while (cur.length > 1) {
    const ops = [];
    for (let i = 0; i < cur.length; i += k) {
      const inputs = cur.slice(i, i + k);
      // deterministic node id: fold node addressed by level + first-input index (by-root reproducible)
      const node = `fold:L${levelNo}:${i / k}`;
      ops.push({ node, inputs });
      txCount++;
    }
    levels.push(ops);
    cur = ops.map(o => o.node);
    levelNo++;
  }
  return { levels, rootId: cur[0], txCount };
}

/** Total fold TX count for N shards at fan-in k (= Σ ceil(n/k) per level until 1). For 件4 cost projection. */
export function foldTxCount(nShards, k) {
  if (nShards <= 1) return 0;
  let n = nShards, total = 0;
  while (n > 1) { const m = Math.ceil(n / k); total += m; n = m; }
  return total;
}
