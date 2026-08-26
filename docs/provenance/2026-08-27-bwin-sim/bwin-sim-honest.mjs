// NWT (19) B_win(k) adversarial simulation — models rusty-kaspa 7b1e18cc KIP-0004
// sampled difficulty (consensus/src/processes/difficulty.rs:216 calculate_difficulty_bits).
// Q: first-mover injects ×k hashrate at t0 under steady 10 BPS. How much EXCESS network DAA
//    (over the 10/s baseline) accrues before difficulty re-stabilizes = B_win(k)?
// Units: time in ms. target_rel = target / D0_target (1 at steady). block_time ∝ 1/(H_rel × target_rel).
// Difficulty formula (faithful): new_target = avg_target × measured / expected,
//   measured = max_ts − min_ts over the sampled window; expected = TPB × SR × (len−1);
//   min-ts sample removed before averaging (as in source); constant if window < MIN.

const TPB = 100;          // target_time_per_block ms (10 BPS)
const SR  = 40;           // difficulty_sample_rate = BPS×DIFFICULTY_WINDOW_SAMPLE_INTERVAL = 10×4
const WIN = 661;          // DIFFICULTY_SAMPLED_WINDOW_SIZE = ceil(2641/4)
const MIN = 150;          // MIN_DIFFICULTY_WINDOW_SIZE
const BASE_RATE = 1 / TPB;    // blocks per ms baseline (0.01 = 10/s)

function calcTargetRel(win) {
  // win: array of {ts, tgt} samples (ascending ts). Mirrors calculate_difficulty_bits.
  if (win.length < MIN) return win[win.length - 1].tgt; // fixed-difficulty regime
  let minI = 0, maxI = 0;
  for (let i = 1; i < win.length; i++) { if (win[i].ts < win[minI].ts) minI = i; if (win[i].ts > win[maxI].ts) maxI = i; }
  const minTs = win[minI].ts, maxTs = win[maxI].ts;
  // average target over window EXCLUDING the min-ts sample (source swap_removes it)
  let sum = 0, n = 0;
  for (let i = 0; i < win.length; i++) { if (i === minI) continue; sum += win[i].tgt; n++; }
  const avg = sum / n;
  const measured = Math.max(maxTs - minTs, 1);
  const expected = TPB * SR * n;
  return avg * measured / expected;
}

function simulate(k, { maxBlocks = WIN * SR * 4, injectFixed = false } = {}) {
  // warm-up: full steady window, samples 40 blocks (=4000ms) apart, tgt=1
  const win = [];
  const spacing = SR * TPB; // 4000 ms
  for (let i = 0; i < WIN; i++) win.push({ ts: -(WIN - 1 - i) * spacing, tgt: 1 });
  let t = 0, blocks = 0, tgt = calcTargetRel(win); // ~1
  // fixed-difficulty variant: freeze difficulty (simulate fresh-net < MIN samples)
  let maxExcess = 0, plateau = 0, restabBlock = null;
  const Hrel = k;
  while (blocks < maxBlocks) {
    const curTgt = injectFixed ? 1 : tgt;              // fixed regime: difficulty pinned at D0
    const dt = TPB / (Hrel * curTgt);                  // block_time ∝ 1/(H_rel×target_rel)
    t += dt; blocks++;
    if (blocks % SR === 0) {                            // new sample every 40 blocks
      win.push({ ts: t, tgt: curTgt });
      if (win.length > WIN) win.shift();
      tgt = calcTargetRel(win);
    }
    const excess = blocks - t * BASE_RATE;             // actual DAA − baseline DAA
    if (excess > maxExcess) maxExcess = excess;
    // detect re-stabilization: block_time within 1% of 100ms
    if (restabBlock === null && !injectFixed && Math.abs(dt - TPB) / TPB < 0.01 && blocks > SR) restabBlock = blocks;
  }
  plateau = blocks - t * BASE_RATE; // asymptotic excess (permanent DAA lead)
  return { k, maxExcess, plateau, restabBlock, endT_s: t / 1000 };
}

console.log('=== B_win(k): steady-state regime (§6 gate passed, difficulty responsive) ===');
console.log('k\tB_win(plateau DAA)\tpeak_excess\trestab_block\tsim_wall_s');
const ks = [1.0, 1.5, 2, 3, 5, 10];
const rows = [];
for (const k of ks) {
  const r = simulate(k);
  rows.push(r);
  console.log(`${k}\t${r.plateau.toFixed(0)}\t\t${r.maxExcess.toFixed(0)}\t\t${r.restabBlock}\t\t${r.endT_s.toFixed(0)}`);
}
// monotonicity
let mono = true;
for (let i = 1; i < rows.length; i++) if (rows[i].plateau < rows[i-1].plateau - 1) mono = false;
console.log(`monotonic in k: ${mono}`);
// crude analytic upper bound: full-window × (1 − 1/k)
console.log('\n=== vs crude upper bound (full window 26,440 × (1−1/k)) ===');
for (const k of ks) console.log(`k=${k}\tsim=${rows.find(r=>r.k===k).plateau.toFixed(0)}\tcrude_UB=${(WIN*SR*(1-1/k)).toFixed(0)}`);
// fixed-difficulty regime (fresh-net / post-BPS-fork, difficulty pinned): unbounded ∝ k × duration
console.log('\n=== fixed-difficulty regime (§6 MUST disable Tier-2): excess over T_fixed wall-clock ===');
console.log('formula: excess_DAA = (k − 1) × 10/s × T_fixed_remaining_seconds  [UNBOUNDED in k]');
for (const k of [2,5,10]) {
  const T = 600; // up to 150-sample fixed period ≈ 600s at 10 BPS baseline
  console.log(`k=${k}, T_fixed=${T}s -> excess = ${((k-1)*10*T).toFixed(0)} DAA (and grows with any longer pin)`);
}
console.log(`\nplaceholder in v0.5 doc: B_win = 55,200. sim max (k=10 steady) = ${rows.find(r=>r.k===10).plateau.toFixed(0)}`);
