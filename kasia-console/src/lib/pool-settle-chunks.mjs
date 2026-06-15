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
const REDEEM_BASE = 2702, REDEEM_PER_WINNER = 601;
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
 * @param {{pk:string, amount:number}[]} winners  payouts from computePoolPayouts (merkle_index order; dust in winners[0])
 * @param {{value:number}[]} fixedOutputs  chunk_0 fixed outputs: broker + 5 oracle
 * @param {number} poolValue  total locked sompi (chunk_0 input)
 * @param {string} payoutRootHex  from pool-payout-root builder
 * @returns {{route:'aggregate'|'chunk', numChunks, payoutRoot, chunks}}
 */
export function computeSettleChunks(winners, fixedOutputs, poolValue, payoutRootHex) {
  const n = winners.length;
  const fixedVals = fixedOutputs.map(o => o.value);
  // route: does ONE aggregate TX fit (broker+5oracle+ALL winners, NO change)? aggregate = mass-only.
  const aggOut = [...fixedVals, ...winners.map(w => w.amount)];
  if (fits([poolValue], aggOut, n, fixedOutputs.length, false, /*applyKCap=*/false)) {
    return { route: 'aggregate', numChunks: 1, payoutRoot: payoutRootHex,
      chunks: [{ kind: 'aggregate', chunk_kind: 0, seg_lo: 0, seg_hi: n, winners, change: 0 }] };
  }
  // chunk chain: greedy value-aware packing
  const chunks = [];
  let lo = 0, prevChange = poolValue, isFirst = true;
  while (lo < n) {
    const fixed = isFirst ? fixedVals : [];
    let hi = lo;
    while (hi < n) {
      const seg = winners.slice(lo, hi + 1);
      const segVals = seg.map(w => w.amount);
      const isFinalTry = (hi + 1 === n);
      const outVals = isFinalTry ? [...fixed, ...segVals] : [...fixed, ...segVals, prevChange];
      if (fits([prevChange], outVals, seg.length, fixed.length, !isFinalTry)) hi++;
      else break;
    }
    if (hi === lo) throw new Error(`cannot fit even 1 winner at idx ${lo} (payout=${winners[lo].amount} → storage>${STORAGE_MASS_SAFE_THRESHOLD})`);
    const seg = winners.slice(lo, hi);
    const segPaid = seg.reduce((s, w) => s + w.amount, 0);
    const fixedPaid = fixed.reduce((s, v) => s + v, 0);
    const isLast = (hi === n);
    const change = isLast ? 0 : (prevChange - segPaid - fixedPaid);
    if (change < 0) throw new Error(`negative change chunk lo=${lo}: prevChange=${prevChange} segPaid=${segPaid} fixedPaid=${fixedPaid}`);
    chunks.push({ kind: isFirst ? 'chunk_0' : (isLast ? 'chunk_last' : 'chunk_mid'),
      chunk_kind: isFirst ? 0 : (isLast ? 2 : 1), seg_lo: lo, seg_hi: hi, winners: seg, change, hwm_out: hi });
    prevChange = change; lo = hi; isFirst = false;
  }
  return { route: 'chunk', numChunks: chunks.length, payoutRoot: payoutRootHex, chunks };
}
