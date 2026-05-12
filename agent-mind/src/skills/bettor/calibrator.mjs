/**
 * LLM Confidence Calibrator — Phase 3f-1 Sub #2 (Bettor r55 architect spec).
 *
 * 把 LLM estimateP() 输出 (pMid + sigma) 跟 market price (marketYes) 比较, 三分类
 * confidence band (low/mid/high), 再用对应 damping 系数压 Kelly fraction.
 *
 * Greece $242→$48 实证: LLM pMid=0.008 vs market YES=0.18, 偏差 17pp, 但 sigma=0.03
 * (LLM 自信 5%), Kelly base fraction 24% bankroll, 一把押 $242 输. 接入 calibrator 后
 * gap=17pp ∈ [10,30]pp + sigma=0.03 ≤ 0.05 (其实落入 mid 因为 gap ≥ 0.10 不满足 high
 * tight 条件) → band='mid' → fraction × 0.50 → $121. 实际本应触 rule 1 (Greece 21pp <
 * 30pp 不到 low), 但 mid damping 已经把仓位减半. Eurovision Final 偏差更大时 rule 1 命中.
 *
 * Pure function — no LLM, no DB, no network. Caller wire 在 scanner.scanOne 调
 * estimateP 后, recommendBet 前, 拿 result.band + result.reason 持久化到
 * bettor_recommendations.calibrator_confidence.
 */

const DEVIATION_LOW_THRESHOLD = 0.30;   // |gap| > 30pp → LLM/市场极端分歧 = 过自信
const DEVIATION_TIGHT_THRESHOLD = 0.10; // |gap| ≤ 10pp + low sigma = tight agreement
const SIGMA_LOW_THRESHOLD = 0.15;       // sigma > 15pp → LLM 自报高不确定性
const SIGMA_TIGHT_THRESHOLD = 0.05;     // sigma ≤ 5pp + tight gap = high band

const DAMPING_COEF = { low: 0.20, mid: 0.50, high: 1.00 };

/**
 * Three-band confidence classification on LLM-vs-market alignment + LLM self-reported uncertainty.
 *
 * Precedence (top-to-bottom, first match wins):
 *   1. |gap| > 0.30 → 'low'  (extreme disagreement, likely overconfident)
 *   2. sigma > 0.15 → 'low'  (LLM 自报 high uncertainty)
 *   3. |gap| ≤ 0.10 AND sigma ≤ 0.05 → 'high' (tight agreement + low uncertainty)
 *   4. otherwise → 'mid' (moderate gap or moderate sigma)
 *
 * @param {object} input
 * @param {number} input.llmPMid - LLM estimateP 主估 ∈ [0, 1]
 * @param {number} input.marketYes - Market YES price (probability) ∈ [0, 1]
 * @param {number} input.sigma - LLM self-reported uncertainty width ∈ [0, 1]
 * @returns {{ band: 'low'|'mid'|'high', reason: string }}
 */
export function classifyConfidence({ llmPMid, marketYes, sigma }) {
  if (typeof llmPMid !== 'number' || llmPMid < 0 || llmPMid > 1) {
    throw new Error(`classifyConfidence: invalid llmPMid ${llmPMid}`);
  }
  if (typeof marketYes !== 'number' || marketYes < 0 || marketYes > 1) {
    throw new Error(`classifyConfidence: invalid marketYes ${marketYes}`);
  }
  if (typeof sigma !== 'number' || sigma < 0 || sigma > 1) {
    throw new Error(`classifyConfidence: invalid sigma ${sigma}`);
  }

  const gap = Math.abs(llmPMid - marketYes);
  const gapPp = (gap * 100).toFixed(1);
  const sigmaPp = (sigma * 100).toFixed(1);

  if (gap > DEVIATION_LOW_THRESHOLD) {
    return { band: 'low', reason: `LLM-market gap ${gapPp}pp > 30pp (extreme disagreement, likely overconfident)` };
  }
  if (sigma > SIGMA_LOW_THRESHOLD) {
    return { band: 'low', reason: `sigma ${sigmaPp}pp > 15pp (LLM self-reports high uncertainty)` };
  }
  if (gap <= DEVIATION_TIGHT_THRESHOLD && sigma <= SIGMA_TIGHT_THRESHOLD) {
    return { band: 'high', reason: `gap ${gapPp}pp ≤ 10pp + sigma ${sigmaPp}pp ≤ 5pp (tight agreement, low uncertainty)` };
  }
  return { band: 'mid', reason: `gap ${gapPp}pp + sigma ${sigmaPp}pp (moderate disagreement or uncertainty)` };
}

/**
 * Apply damping coefficient based on confidence band.
 *
 * Damping:
 *   low → ×0.20 (effective ~5% bankroll cap on Kelly default 0.25)
 *   mid → ×0.50 (~12% cap)
 *   high → ×1.00 (Kelly unchanged)
 *
 * @param {object} input
 * @param {'low'|'mid'|'high'} input.band
 * @param {number} input.baseFraction - Kelly recommended fraction ∈ [0, 1]
 * @returns {number} adjustedFraction
 */
export function applyConfidenceDamping({ band, baseFraction }) {
  if (!(band in DAMPING_COEF)) {
    throw new Error(`applyConfidenceDamping: invalid band "${band}" (expected low|mid|high)`);
  }
  if (typeof baseFraction !== 'number' || baseFraction < 0) {
    throw new Error(`applyConfidenceDamping: invalid baseFraction ${baseFraction}`);
  }
  return baseFraction * DAMPING_COEF[band];
}
