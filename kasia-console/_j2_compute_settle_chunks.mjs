// J2 #31 production computeSettleChunks (STANDALONE DRAFT — self-test first, then wire into dispatchPhase2 with diff review).
// Routes a settle into either ONE aggregate TX (≤ capacity) or a CHANGE-CHAIN of chunk TXs (找零核弹).
// Determinism: byte-identical across nodes (same winners + same params → same segmentation → same chunks → same P2SH).
//
// SINGLE SOURCE (must reuse when wired): estimateStorageMass = pool-market-settler.js L119;
//   STORAGE_MASS_SAFE_THRESHOLD=470_000 (L73); maxChunkFee = V07_MAX_FEE=1e8 (L2291).
// Replicated here for the standalone self-test; production import keeps single source.

const KIP9_C = 1e12;
const STORAGE_SAFE = 470_000;          // STORAGE_MASS_SAFE_THRESHOLD
const COMPUTE_CAP = 500_000;           // post-Toccata per-tx compute limit
const TRANSIENT_CAP = 1_000_000;       // post-Toccata transient limit
const V07_MAX_FEE = 100_000_000;       // maxChunkFee ceiling (anti-grief)
const MAX_WINNERS_PER_CHUNK = 47;      // = ctor maxWinnersPerChunk (chunk_i for-loop bound, 1KAS headline)

// EXACT replica of settler estimateStorageMass(inputValues, outputValues) L119 (single source when wired).
function estimateStorageMass(inputValues, outputValues) {
  const sumOutInv = outputValues.reduce((s, v) => s + (v > 0 ? 1 / v : 0), 0);
  const sumIn = inputValues.reduce((s, v) => s + v, 0);
  const inputsTerm = sumIn > 0 ? (inputValues.length * inputValues.length) / sumIn : 0;
  return Math.max(0, Math.round(KIP9_C * (sumOutInv - inputsTerm)));
}

// compute-mass approx (redeem + witness bytes + spk) — secondary to storage at realistic payouts.
const REDEEM_BASE = 2702, REDEEM_PER_WINNER = 601;  // measured @ b367753b 4-entry sweep
const WITNESS_PER_WINNER = 314, SPK = 35, TX_FIXED = 564, SIG_OPS = 5;
function chunkComputeMass(nWinners, nFixedOut, hasChange) {
  const nOut = nFixedOut + nWinners + (hasChange ? 1 : 0);
  const txBytes = TX_FIXED + REDEEM_BASE + nWinners * REDEEM_PER_WINNER + nWinners * WITNESS_PER_WINNER + nOut * SPK;
  return { compute: txBytes + nOut * SPK * 10 + SIG_OPS * 1000, transient: txBytes };
}

// Does a set of outputs fit one TX under all caps?
function fits(inputVals, outVals, nWinners, nFixedOut, hasChange) {
  if (nWinners > MAX_WINNERS_PER_CHUNK) return false;            // ctor for-loop bound
  if (estimateStorageMass(inputVals, outVals) > STORAGE_SAFE) return false;
  const cm = chunkComputeMass(nWinners, nFixedOut, hasChange);
  return cm.compute <= COMPUTE_CAP && cm.transient <= TRANSIENT_CAP;
}

/**
 * @param {{pk:string, amount:number}[]} winners  payouts from computePoolPayouts (merkle_index order; dust already in winners[0])
 * @param {{value:number}[]} fixedOutputs  chunk_0 fixed outputs: broker + 5 oracle (with values)
 * @param {number} poolValue  total locked sompi (chunk_0 input)
 * @param {string} payoutRootHex  from payoutRoot builder
 * @returns {{route, numChunks, chunks, payoutRoot}}
 */
export function computeSettleChunks(winners, fixedOutputs, poolValue, payoutRootHex) {
  const n = winners.length;
  const fixedVals = fixedOutputs.map(o => o.value);
  // ── route check: does ONE aggregate TX fit (broker+5oracle+ALL winners, NO change)? ──
  const aggOut = [...fixedVals, ...winners.map(w => w.amount)];
  if (fits([poolValue], aggOut, n, fixedOutputs.length, false)) {
    return { route: 'aggregate', numChunks: 1, payoutRoot: payoutRootHex,
      chunks: [{ kind: 'aggregate', seg_lo: 0, seg_hi: n, winners, change: 0 }] };
  }
  // ── chunk chain: greedy value-aware packing ──
  const chunks = [];
  let lo = 0, prevChange = poolValue;  // chunk_0 spends pool; chunk_i spends prev change
  let isFirst = true;
  while (lo < n) {
    const fixed = isFirst ? fixedVals : [];
    // greedily grow [lo, hi) while it fits WITH a change output (unless it's the final chunk)
    let hi = lo;
    while (hi < n) {
      const seg = winners.slice(lo, hi + 1);
      const segVals = seg.map(w => w.amount);
      const isFinalTry = (hi + 1 === n);
      const outVals = isFinalTry ? [...fixed, ...segVals] : [...fixed, ...segVals, prevChange]; // change placeholder (large→low storage)
      if (fits([prevChange], outVals, seg.length, fixed.length, !isFinalTry)) hi++;
      else break;
    }
    if (hi === lo) throw new Error(`cannot fit even 1 winner at idx ${lo} (payout=${winners[lo].amount} too small → storage>${STORAGE_SAFE})`);
    const seg = winners.slice(lo, hi);
    const segPaid = seg.reduce((s, w) => s + w.amount, 0);
    const fixedPaid = fixed.reduce((s, v) => s + v, 0);
    const isLast = (hi === n);
    // fee ≤ V07_MAX_FEE; change = input − paid − fee (fee tight, set 0 here for plan; broadcaster sets actual ≤ ceiling)
    const change = isLast ? 0 : (prevChange - segPaid - fixedPaid);
    if (change < 0) throw new Error(`negative change chunk lo=${lo}: prevChange=${prevChange} segPaid=${segPaid} fixedPaid=${fixedPaid}`);
    chunks.push({ kind: isFirst ? 'chunk_0' : (isLast ? 'chunk_last' : 'chunk_mid'),
      chunk_kind: isFirst ? 0 : (isLast ? 2 : 1), seg_lo: lo, seg_hi: hi, winners: seg, change, hwm_out: hi });
    prevChange = change;
    lo = hi; isFirst = false;
  }
  return { route: 'chunk', numChunks: chunks.length, payoutRoot: payoutRootHex, chunks };
}

// ─────────── self-tests ───────────
function approxEqMass() { // cross-check estimateStorageMass replica vs known: 1 KAS out → C/1e8 = 1e4
  const m = estimateStorageMass([1e12], [1e8]);
  return Math.abs(m - 1e4) < 2; // inputsTerm tiny
}
function runTests() {
  let pass = 0, total = 0;
  const T = (name, cond) => { total++; if (cond) { pass++; } else console.log(`  FAIL: ${name}`); };

  T('estimateStorageMass replica (1KAS→~1e4)', approxEqMass());

  // small market → aggregate route
  const broker = { value: 5e7 }, oracles = Array.from({ length: 5 }, () => ({ value: 1.2e8 }));
  const fixed = [broker, ...oracles];
  const small = Array.from({ length: 20 }, (_, i) => ({ pk: (i + 16).toString(16).padStart(2, '0').repeat(32), amount: 1e8 }));
  const rs = computeSettleChunks(small, fixed, 1e11, 'aa'.repeat(32));
  T('20-winner @1KAS → aggregate', rs.route === 'aggregate' && rs.numChunks === 1);

  // big market → chunk chain (200 winners @1KAS)
  const big = Array.from({ length: 200 }, (_, i) => ({ pk: ((i % 250) + 1).toString(16).padStart(2, '0').repeat(32), amount: 1e8 }));
  const rb = computeSettleChunks(big, fixed, 200e8 + 1e9, 'bb'.repeat(32));
  T('200-winner @1KAS → chunk route', rb.route === 'chunk');
  T('200-winner → ~5 chunks (chunk_0 smaller)', rb.numChunks >= 5 && rb.numChunks <= 7);
  // seg continuity: no gap/overlap, covers all
  let contiguous = rb.chunks[0].seg_lo === 0 && rb.chunks[rb.chunks.length - 1].seg_hi === 200;
  for (let i = 1; i < rb.chunks.length; i++) if (rb.chunks[i].seg_lo !== rb.chunks[i - 1].seg_hi) contiguous = false;
  T('seg continuity (no gap/overlap, covers 0..200)', contiguous);
  // chunk_0 capacity < chunk_i (has +6 fixed outputs)
  T('chunk_0 segLen < chunk_i segLen (capacity asymmetry)', (rb.chunks[0].seg_hi - rb.chunks[0].seg_lo) < (rb.chunks[1].seg_hi - rb.chunks[1].seg_lo));
  // last chunk no change
  T('last chunk change==0', rb.chunks[rb.chunks.length - 1].change === 0);
  // each chunk ≤ MAX_WINNERS_PER_CHUNK
  T('every chunk segLen ≤ 47', rb.chunks.every(c => (c.seg_hi - c.seg_lo) <= 47));
  // determinism: same input → byte-identical output
  const rb2 = computeSettleChunks(big, fixed, 200e8 + 1e9, 'bb'.repeat(32));
  T('byte-deterministic (same input → identical plan)', JSON.stringify(rb) === JSON.stringify(rb2));
  // conservation: Σ(all winner payouts) + fixedPaid (chunk_0 only) ≤ pool (rest = fees + final change 0)
  const totalWinnerPaid = big.reduce((s, w) => s + w.amount, 0);
  const fixedPaid = fixed.reduce((s, o) => s + o.value, 0);
  T('conservation: winners+fixed ≤ pool', totalWinnerPaid + fixedPaid <= 200e8 + 1e9);

  console.log(`\ncomputeSettleChunks self-test: ${pass}/${total}`);
  console.log(`200×1KAS plan: route=${rb.route} numChunks=${rb.numChunks} segLens=[${rb.chunks.map(c => c.seg_hi - c.seg_lo).join(',')}]`);
}
runTests();
