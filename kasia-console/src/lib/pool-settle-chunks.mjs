// pool-settle-chunks.mjs — #31 找零核弹 production chunk planner (productionized from J2 standalone draft).
// Routes a settle into ONE aggregate TX (≤ capacity) or a CHANGE-CHAIN of chunk TXs.
//
// SINGLE SOURCE (J2 ⑤ consolidation, J1 GREEN-lit): mass formula + caps imported from kip9-mass.mjs
//   (estimateMultiOutputStorageMass = FULL formula = old settler L119; STORAGE_MASS_SAFE_THRESHOLD;
//   MAX_TX_FEE_SOMPI). NO replica consts here (was the 4+ scattered-dup problem). Importing the FULL
//   formula (not single-value estimateStorageMass) is the liveness 命门: single-value undercounts →
//   over-pack → mempool reject → stuck (NWT-flagged).
import {
  estimateMultiOutputStorageMass,
  STORAGE_MASS_SAFE_THRESHOLD,
  MAX_TX_FEE_SOMPI,
} from './kip9-mass.mjs';

// post-Toccata per-tx consensus limits (rusty-kaspa params.rs: block compute/storage 500k, transient 1M).
const COMPUTE_CAP = 500_000;
const TRANSIENT_CAP = 1_000_000;
// = ctor maxWinnersPerChunk (settle_chunk for-loop compile bound; storage-derived 1KAS headline).
export const MAX_WINNERS_PER_CHUNK = 47;

// compute-mass approx (4-entry redeem + per-winner witness + spk). Measured @ b367753b sweep.
// ⚠ KNOWN CONSERVATIVE APPROX on the aggregate route (J1 mass-model note): over-estimates aggregate compute
//   (settle_aggregate has no per-winner loop) → errs toward chunk = SAFE. storage dominates at realistic payouts.
const REDEEM_BASE = 2878, REDEEM_PER_WINNER = 601;
const WITNESS_PER_WINNER = 314, SPK = 35, TX_FIXED = 564, SIG_OPS = 5;
function chunkComputeMass(nWinners, nFixedOut, hasChange) {
  const nOut = nFixedOut + nWinners + (hasChange ? 1 : 0);
  const txBytes = TX_FIXED + REDEEM_BASE + nWinners * REDEEM_PER_WINNER + nWinners * WITNESS_PER_WINNER + nOut * SPK;
  return { compute: txBytes + nOut * SPK * 10 + SIG_OPS * 1000, transient: txBytes };
}

// applyKCap: settle_chunk has per-winner merkle for-loop (bound = MAX_WINNERS_PER_CHUNK); settle_aggregate
//   has NO per-winner loop (committee-SIGHASH-attested outputs) → aggregate capacity is MASS-ONLY (no 47 cap).
function fits(inputVals, outVals, nWinners, nFixedOut, hasChange, applyKCap = true) {
  if (applyKCap && nWinners > MAX_WINNERS_PER_CHUNK) return false;
  if (estimateMultiOutputStorageMass(inputVals, outVals) > STORAGE_MASS_SAFE_THRESHOLD) return false;
  const cm = chunkComputeMass(nWinners, nFixedOut, hasChange);
  return cm.compute <= COMPUTE_CAP && cm.transient <= TRANSIENT_CAP;
}

/**
 * @param {{pk:string, amount:number|string|bigint}[]} winners  payouts from computePoolPayouts (merkle_index order;
 *   dust in winners[0]). amount = EXACT sompi (string/BigInt preferred; Number ok for <2^53). Conservation below
 *   normalizes to BigInt — float64 amount > 2^53 would corrupt `change` (R1 cross-node byte-identical 承重墙).
 * @param {{value:number|string|bigint}[]} fixedOutputs  chunk_0 fixed outputs: broker + 5 oracle
 * @param {number|string|bigint} poolValue  total locked sompi (chunk_0 input)
 * @param {string} payoutRootHex  from pool-payout-root builder
 * @returns {{route:'aggregate'|'chunk', numChunks, payoutRoot, chunks}}  chunks[].change = EXACT decimal string
 *   (JSON-serializable, BigInt-exact; ③ does BigInt(change) to build the change UTXO).
 */
export function computeSettleChunks(winners, fixedOutputs, poolValue, payoutRootHex) {
  const n = winners.length;
  // ── value arithmetic in BigInt (conservation = exact sompi → change output is byte-identical cross-node);
  //    mass estimate in Number (heuristic Σ1/v float — segmentation is settler-chosen, NOT consensus). ──
  const amtBI = winners.map(w => BigInt(w.amount));
  const fixedBI = fixedOutputs.map(o => BigInt(o.value));
  const poolBI = BigInt(poolValue);
  const num = (b) => Number(b);  // BigInt→Number for mass est ONLY (never for conservation / output values)
  const fixedNum = fixedBI.map(num);

  // route: does ONE aggregate TX fit (broker+5oracle+ALL winners, NO change)? aggregate = mass-only.
  const aggOut = [...fixedNum, ...amtBI.map(num)];
  if (fits([num(poolBI)], aggOut, n, fixedOutputs.length, false, /*applyKCap=*/false)) {
    return { route: 'aggregate', numChunks: 1, payoutRoot: payoutRootHex,
      chunks: [{ kind: 'aggregate', chunk_kind: 0, seg_lo: 0, seg_hi: n, winners, change: '0' }] };
  }
  // chunk chain: greedy value-aware packing
  const chunks = [];
  let lo = 0, prevChangeBI = poolBI, isFirst = true;
  while (lo < n) {
    const segFixedNum = isFirst ? fixedNum : [];
    const segFixedSumBI = isFirst ? fixedBI.reduce((s, v) => s + v, 0n) : 0n;
    let hi = lo;
    while (hi < n) {
      const segNum = amtBI.slice(lo, hi + 1).map(num);
      const isFinalTry = (hi + 1 === n);
      const outVals = isFinalTry ? [...segFixedNum, ...segNum] : [...segFixedNum, ...segNum, num(prevChangeBI)];
      if (fits([num(prevChangeBI)], outVals, hi + 1 - lo, segFixedNum.length, !isFinalTry)) hi++;
      else break;
    }
    if (hi === lo) throw new Error(`cannot fit even 1 winner at idx ${lo} (payout=${winners[lo].amount} → storage>${STORAGE_MASS_SAFE_THRESHOLD})`);
    const segPaidBI = amtBI.slice(lo, hi).reduce((s, v) => s + v, 0n);
    const isLast = (hi === n);
    const changeBI = isLast ? 0n : (prevChangeBI - segPaidBI - segFixedSumBI);
    if (changeBI < 0n) throw new Error(`negative change chunk lo=${lo}: prevChange=${prevChangeBI} segPaid=${segPaidBI} fixedPaid=${segFixedSumBI}`);
    chunks.push({ kind: isFirst ? 'chunk_0' : (isLast ? 'chunk_last' : 'chunk_mid'),
      chunk_kind: isFirst ? 0 : (isLast ? 2 : 1), seg_lo: lo, seg_hi: hi,
      winners: winners.slice(lo, hi), change: String(changeBI), hwm_out: hi });
    prevChangeBI = changeBI; lo = hi; isFirst = false;
  }
  return { route: 'chunk', numChunks: chunks.length, payoutRoot: payoutRootHex, chunks };
}
