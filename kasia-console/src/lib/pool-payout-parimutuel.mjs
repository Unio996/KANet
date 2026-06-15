// pool-payout-parimutuel.mjs — bshard post-fold payoutRoot builder (J2, 2026-06-15).
//
// finding-2 fix (Bettor/NWT/J2/KANet-UI converged): on-chain parimutuel `stake×totalPool/winnerPool` overflows
// i64 (OpMul = checked_mul, hard-fail — rusty-kaspa opcodes/mod.rs L769-773). So payouts are computed OFF-CHAIN
// in BigInt at pool close (post-fold, globals known), committed as a merkle payoutRoot in the spine close-commit;
// the PoolSide claim merkle-PROVES its payout (no on-chain multiply). See docs/2026-06-15-bshard-payout-commit-design-j2.md.
//
// TRUST MODEL (honest,守 G5): payoutRoot is a deterministic function of (winningSide[oracle] + globalYes/No
// [fold-root, on-chain] + stakes[PoolSide, on-chain]) → any node recomputes byte-identical. But the chain can
// neither verify nor dispute it (both hit the same i64 overflow) → it is a committer-TRUST assumption (= v07
// committee-trust level, documented limitation; testnet demo G5 = no economic stake, acceptable; mainnet trustless
// = research backlog). The DETERMINISM half below must be rock-solid — if honest nodes can't agree on the canonical
// root, even off-chain fraud detection collapses.
//
// DETERMINISM (NWT 4 reqs, cross-node byte-equal — same discipline as #31 b30b1ff3):
//   (1) canonical winner order = bettorPk ASC (unique → tie-free; no stake-ASC fork hazard from #31 memory)
//   (2) parimutuel formula single-source = floor(stake * totalPool / winnerPool), BigInt
//   (3) dust → winners[0] (canonical absorber) so Σpayout == totalPool exactly (conservation)
//   (4) leaf = blake2b(pk ‖ serializeI64(payout,8)) [= pool-payout-root payoutLeaf] / depth = ceil(log2 n) / pad = ZERO32

import { blake2b } from '@noble/hashes/blake2b';
import { serializeI64, payoutLeaf } from './pool-payout-root.mjs';

const ZERO32 = Buffer.alloc(32);

/**
 * Off-chain BigInt parimutuel payouts. winners = WINNING-side bettors only.
 * @param {Array<{pk:string, stake:number|bigint|string}>} winners  winning-side bettors (pk hex 64, stake sompi)
 * @param {number|bigint|string} globalYesSompi  fold-root global YES total
 * @param {number|bigint|string} globalNoSompi   fold-root global NO total
 * @param {number} winningSide  0 = YES wins, 1 = NO wins (matches PoolSide direction encoding)
 * @returns {Array<{pk:string, payout:bigint}>}  canonical order (pk ASC), Σpayout == totalPool exactly
 */
export function computeParimutuelPayouts(winners, globalYesSompi, globalNoSompi, winningSide) {
  const totalPool = BigInt(globalYesSompi) + BigInt(globalNoSompi);
  const winnerPool = winningSide === 0 ? BigInt(globalYesSompi) : BigInt(globalNoSompi);
  if (winnerPool <= 0n) throw new Error(`winnerPool must be > 0 (winningSide=${winningSide})`);
  if (winners.length === 0) throw new Error('no winners');
  // (1) canonical order: pk ASC (unique → tie-free → cross-node byte-equal)
  const sorted = [...winners].sort((a, b) => (a.pk < b.pk ? -1 : a.pk > b.pk ? 1 : 0));
  // detect duplicate pk (would fork the index / double-count)
  for (let i = 1; i < sorted.length; i++) if (sorted[i].pk === sorted[i - 1].pk) throw new Error(`duplicate winner pk ${sorted[i].pk}`);
  // (2) single-source BigInt floor formula
  let distributed = 0n;
  const payouts = sorted.map(w => {
    const stake = BigInt(w.stake);
    if (stake <= 0n) throw new Error(`winner stake must be > 0 (pk ${w.pk})`);
    const p = (stake * totalPool) / winnerPool;
    distributed += p;
    return { pk: w.pk, payout: p };
  });
  // (3) dust → winners[0] (canonical absorber) → Σ == totalPool exact
  const dust = totalPool - distributed;
  if (dust < 0n) throw new Error(`over-distributed (dust ${dust} < 0)`);
  payouts[0].payout += dust;
  return payouts;
}

/** Minimal merkle depth to hold n leaves (>=1). */
function depthFor(n) { let d = 0; while ((1 << d) < n) d++; return Math.max(1, d); }

/**
 * Variable-depth position-aware payout merkle tree. leaf = payoutLeaf(pk, payout) = blake2b(pk ‖ ser(payout,8)).
 * (pool-payout-root.mjs is fixed depth-8/256 cap for #31 chunks; bshard global winner set is unbounded → variable depth.)
 * @param {Array<{pk:string, payout:bigint}>} payouts  canonical order (from computeParimutuelPayouts)
 * @returns {{levels:Buffer[][], depth:number, root:Buffer}}
 */
export function buildPayoutTree(payouts) {
  if (payouts.length === 0) throw new Error('no payouts');
  const depth = depthFor(payouts.length);
  const cap = 1 << depth;
  let level = new Array(cap).fill(ZERO32);
  payouts.forEach((w, i) => { level[i] = payoutLeaf(w.pk, w.payout); });
  const levels = [level];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(Buffer.from(blake2b(Buffer.concat([level[i], level[i + 1]]), { dkLen: 32 })));
    levels.push(next); level = next;
  }
  return { levels, depth, root: levels[depth][0] };
}

export function payoutRoot(payouts) { return buildPayoutTree(payouts).root; }
export function payoutRootHex(payouts) { return buildPayoutTree(payouts).root.toString('hex'); }

/** Position-aware merkle proof (depth siblings) for the winner at canonical index idx. */
export function payoutMerkleProof(payouts, idx) {
  const { levels, depth } = buildPayoutTree(payouts);
  const sibs = []; let pos = idx;
  for (let lvl = 0; lvl < depth; lvl++) { sibs.push(levels[lvl][pos ^ 1]); pos >>= 1; }
  return sibs;
}

/** Re-climb a leaf+siblings to the root (EXACT SS climb replica: b = (idx>>lvl)&1). For claim co-verify. */
export function climbPayoutProof(pkHex, payoutBig, idx, siblings) {
  let cur = payoutLeaf(pkHex, payoutBig);
  for (let lvl = 0; lvl < siblings.length; lvl++) {
    const b = (idx >> lvl) & 1, sib = siblings[lvl];
    cur = Buffer.from(blake2b(b === 0 ? Buffer.concat([cur, sib]) : Buffer.concat([sib, cur]), { dkLen: 32 }));
  }
  return cur;
}

export { serializeI64 };
