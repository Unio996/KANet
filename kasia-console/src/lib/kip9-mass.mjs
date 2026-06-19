// kip9-mass.mjs — Shared KIP-9 storage_mass aware fee helpers.
//
// J1tn r303 P0-#1 sweep helper refactor (Bettor r346/r366b 钦定 fork 合 1 helper):
// 5 call sites 之前各抄 storage_mass 公式 + STORAGE_MASS_C const (= 1e12 empirical), 现
// 抽到此 lib 统一. 改一处全自动同步.
//
// Background: D11 ko421 实证 KIP-9 storage_mass 公式 mass(output) ≈ STORAGE_MASS_C / value
// (= 1e12 empirical, derived from ko421 5M sompi output → kaspad reported mass 200K, 5e6 × 2e5 ≈ 1e12).
// For low-value outputs (< 0.1 KAS), storage_mass dominates total TX mass. settler 必算入
// 否则 fee 不够覆盖 mempool floor (= "fee X < mempool floor Y" reject, p2sh.mjs L40-65 红线 7).
//
// 5 call sites that use this helper (post-refactor):
//   - settler.js dispatchPhase2 (settle TX)
//   - settler.js dispatchRefundDisagreement (refund_disagreement TX)
//   - settler.js computeMassAwareV07RefundFee (refund_maker_unjoined TX, BigInt path)
//   - api/pool.js bettor-refund-claim endpoint (PoolSide entry 2 manual claim)
//   - services/bettor-refund-claim-auto.mjs (PoolSide entry 2 cron auto)

// KIP-9 empirical constant (= ko421 实证). For small-value outputs:
//   storage_mass(output) ≈ STORAGE_MASS_C / output_value_sompi
export const STORAGE_MASS_C = 1_000_000_000_000;

// Mempool floor sompi-per-mass + 10% safety margin (= qlfpv 实测 442000/4420=100, +10% = 110).
export const SOMPI_PER_MASS = 110;

// Absolute floor for MIN_BROKER_FEE_SOMPI (= dynamic 算出过低退路).
export const MIN_BROKER_FEE_FLOOR = 5_000_000;  // 0.05 KAS

// —— #31 single-source consts (J2 ⑤ consolidation, J1 GREEN-lit; was scattered: settler L69/L73 +
//    SETTLE_FEE_MAX L1798 + V07_MAX_FEE L2291 + pool-p2sh-v08 V08_MAX_CHUNK_FEE = 4+ local dups). ——
export const STORAGE_MASS_CAP = 500_000;             // kaspad standardness storage cap (post-Toccata block)
export const STORAGE_MASS_SAFE_THRESHOLD = 470_000;  // settle/chunk pack target (6% headroom under cap)
export const MAX_TX_FEE_SOMPI = 100_000_000;         // anti-grief per-TX miner-fee ceiling (= 1 KAS = old V07_MAX_FEE)

/**
 * Estimate KIP-9 storage_mass for a single output value.
 * mass(output) ≈ STORAGE_MASS_C / output_value_sompi (dominant for low-value outputs).
 *
 * @param {number|bigint|string} outputValueSompi
 * @returns {number} mass units (= positive integer)
 */
export function estimateStorageMass(outputValueSompi) {
  const v = Number(outputValueSompi) || 0;
  const safeV = Math.max(1000, v);
  return Math.ceil(STORAGE_MASS_C / safeV);
}

/**
 * Estimate a full transaction's KIP-9 storage mass (multi-input/multi-output).
 *   storage_mass = C × max(0, Σ(1/output_value) − inputCount² / Σ(input_value))
 * Verified vs UAT cycle 3 observed mass. DISTINCT from single-value estimateStorageMass() above
 * (J1 r303 collision discipline): this is the full formula (was pool-market-settler.js L119; moved here
 * for #31 single-source so settler + pool-settle-chunks share it without a settler↔chunks circular import).
 * ⚠ #31 chunk packing MUST use THIS (full), not the single-value approx (single-value undercounts →
 *   over-pack → mempool reject → no valid chunk plan = stuck = liveness 命门, NWT-flagged).
 *
 * @param {number[]} inputValues  sompi value of each input UTXO
 * @param {number[]} outputValues sompi value of each output
 * @returns {number} estimated storage mass
 */
export function estimateMultiOutputStorageMass(inputValues, outputValues) {
  const sumOutInv = outputValues.reduce((s, v) => s + (v > 0 ? 1 / v : 0), 0);
  const sumIn = inputValues.reduce((s, v) => s + v, 0);
  const inputsTerm = sumIn > 0 ? (inputValues.length * inputValues.length) / sumIn : 0;
  return Math.max(0, Math.round(STORAGE_MASS_C * (sumOutInv - inputsTerm)));
}

/**
 * Compute self-balanced dynamicMinBrokerFee for settle TX (dispatchPhase2 path).
 * Goal: storage_mass(broker_output) ≈ compute_mass (= 自平衡, 不爆 fee budget).
 *
 * @param {number} computeMassEst byte-mass estimate (= txByteEstimate × MASS_MULTIPLIER)
 * @returns {number} dynamicMinBrokerFee sompi (= MIN_BROKER_FEE_FLOOR if dynamic too low)
 */
export function computeDynamicMinBrokerFee(computeMassEst) {
  const safe = Math.max(1000, computeMassEst);
  return Math.max(MIN_BROKER_FEE_FLOOR, Math.ceil(STORAGE_MASS_C / safe));
}

/**
 * Compute total mass-aware dynamic fee for a TX where storage_mass is dominated by ONE output.
 * Used by single-output paths (= refund_maker_unjoined, bettor side refund).
 *
 * @param {number} computeMassEst byte-mass estimate
 * @param {number|bigint|string} dominantOutputValueSompi value of the smallest non-trivial output
 * @param {number} [minFee=2_000_000] absolute fee floor
 * @param {number} [maxFee=100_000_000] absolute fee cap
 * @returns {{storageMass: number, totalMass: number, dynamicFee: number}}
 */
export function computeSingleOutputFee(computeMassEst, dominantOutputValueSompi, minFee = 2_000_000, maxFee = 100_000_000) {
  const storageMass = estimateStorageMass(dominantOutputValueSompi);
  const totalMass = computeMassEst + storageMass;
  let dynamicFee = Math.max(minFee, totalMass * SOMPI_PER_MASS);
  if (dynamicFee > maxFee) dynamicFee = maxFee;
  return { storageMass, totalMass, dynamicFee };
}

/**
 * Compute total mass-aware dynamic fee for a TX with N small-value outputs (= refund_disagreement
 * has 3 oracle bond outputs each at oracleBond sompi).
 *
 * @param {number} computeMassEst byte-mass estimate
 * @param {number|bigint|string} smallOutputValueSompi value of each small output
 * @param {number} smallOutputCount count of small outputs
 * @param {number} [minFee=2_000_000] absolute fee floor
 * @param {number} [maxFee=100_000_000] absolute fee cap
 * @returns {{storageMass: number, totalMass: number, dynamicFee: number}}
 */
export function computeMultiOutputFee(computeMassEst, smallOutputValueSompi, smallOutputCount, minFee = 2_000_000, maxFee = 100_000_000) {
  const perOutputMass = estimateStorageMass(smallOutputValueSompi);
  const storageMass = perOutputMass * Math.max(0, smallOutputCount);
  const totalMass = computeMassEst + storageMass;
  let dynamicFee = Math.max(minFee, totalMass * SOMPI_PER_MASS);
  if (dynamicFee > maxFee) dynamicFee = maxFee;
  return { storageMass, totalMass, dynamicFee };
}
