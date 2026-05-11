/**
 * Kelly Criterion for binary prediction markets.
 *
 * Pure math — no LLM, no network, no DB.
 *   f* = (p·b - q) / b
 *   p = your probability of winning
 *   q = 1 - p
 *   b = decimal odds = 1/marketPrice - 1
 */

const DEFAULT_KELLY_FRACTION = 0.25;
const MIN_EDGE_POINTS = 0.05;
const INFO_GAP_TIGHT_MONTHS = 1;
const INFO_GAP_HARD_MONTHS = 3;
const MAX_SIGMA_FOR_BET = 0.30;  // σ > 30% 表示 LLM "完全不知道", 强制 SKIP

// Phase 3e-2 Layer 1 dog/favorite price gates (Sophie 5/10 反事实 +$312.92):
// - dog: buy_price <= 0.10 = deep dog, 体育市场 informational efficient, LLM 反向押系统性输, SKIP
// - favorite: buy_price >= 0.85 = heavy favorite, 已 priced-in, σ < 10% 才允许且 size halve
const DOG_BUY_PRICE_THRESHOLD = 0.10;
const FAVORITE_BUY_PRICE_THRESHOLD = 0.85;
const FAVORITE_SIGMA_TOLERANCE = 0.10;
const FAVORITE_SIZE_PENALTY = 0.5;

// Phase 3e-2 Layer 4 confidence gates (Owner 5/11 钦定 "宁缺毋滥不输前提下再考虑赢"):
// - max(pMid, 1-pMid) < threshold = LLM 自信不足 → SKIP
// - max(pMid, 1-pMid) >= 0.85 AND sigma > 0.10 = "高自信但 LLM 自己不信", SKIP
// J1 #116 propose 0.95 + auto-fallback (反向渐进): 起步 Owner 字面 0.95, 7 天 0 settled 自动降级 0.90/0.85
// activeThreshold 从 config_entries 'bettor_confidence_threshold' 读, default base
const CONFIDENCE_MIN_BASE = 0.95;                    // Owner 字面起步
const CONFIDENCE_FALLBACK_LEVELS = [0.95, 0.90, 0.85]; // 反向降级
const CONFIDENCE_HIGH = 0.85;
const HIGH_CONFIDENCE_MAX_SIGMA = 0.10;

/** Pure Kelly fraction. Returns 0 if no positive edge. */
export function kellyFraction({ p, marketPrice }) {
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  if (p <= 0 || p >= 1) return 0;
  const q = 1 - p;
  const b = (1 / marketPrice) - 1;
  const f = (p * b - q) / b;
  return Math.max(0, f);
}

/**
 * Decide direction + position size with sanity gates.
 *
 * Gates:
 *   - infoGapMonths > 3 → SKIP (training data too stale)
 *   - infoGapMonths > 1 → halve fraction (signal partially stale)
 *   - sigma > 0.05 → variance-proportional shrink
 *   - edge < 5pt → SKIP (摩擦不值)
 *   - no positive Kelly on either side → SKIP
 *
 * @returns {{side:'YES'|'NO'|'SKIP', size:number, fraction:number, reasoning:string[]}}
 */
export function recommendBet(input) {
  const {
    pMid,
    sigma = 0,
    infoGapMonths = 0,
    yesPrice,
    bankroll,
    kellyFraction: kf = DEFAULT_KELLY_FRACTION,
  } = input;
  // input.confidenceThreshold optional — auto-fallback caller (scanner) passes runtime value

  const reasoning = [];

  if (infoGapMonths > INFO_GAP_HARD_MONTHS) {
    reasoning.push(`info gap ${infoGapMonths.toFixed(1)} > ${INFO_GAP_HARD_MONTHS} months → SKIP`);
    return { side: 'SKIP', size: 0, fraction: 0, reasoning };
  }

  if (sigma > MAX_SIGMA_FOR_BET) {
    reasoning.push(`sigma ${(sigma * 100).toFixed(1)}% > ${MAX_SIGMA_FOR_BET * 100}% (LLM 不确定) → SKIP`);
    return { side: 'SKIP', size: 0, fraction: 0, reasoning };
  }

  // Layer 4 闸 A: confidence 下限 (Owner 5/11 钦定 + J1 #116 auto-fallback)
  // activeThreshold 由 caller 传入 (从 config_entries 读), default 用 base
  const activeThreshold = (typeof input.confidenceThreshold === 'number')
    ? input.confidenceThreshold
    : CONFIDENCE_MIN_BASE;
  const maxConfidence = Math.max(pMid, 1 - pMid);
  if (maxConfidence < activeThreshold) {
    reasoning.push(`max(pMid, 1-pMid)=${(maxConfidence * 100).toFixed(1)}% < ${(activeThreshold * 100).toFixed(0)}% (LLM 自信不足) → SKIP`);
    return { side: 'SKIP', size: 0, fraction: 0, reasoning };
  }

  // Layer 4 闸 B: 高 confidence + 高 sigma 冲突 (LLM 自相矛盾)
  if (maxConfidence >= CONFIDENCE_HIGH && sigma > HIGH_CONFIDENCE_MAX_SIGMA) {
    reasoning.push(`high confidence ${(maxConfidence * 100).toFixed(1)}% but sigma ${(sigma * 100).toFixed(1)}% > ${HIGH_CONFIDENCE_MAX_SIGMA * 100}% (LLM 自相矛盾) → SKIP`);
    return { side: 'SKIP', size: 0, fraction: 0, reasoning };
  }

  const fYes = kellyFraction({ p: pMid, marketPrice: yesPrice });
  const noPrice = 1 - yesPrice;
  const fNo = kellyFraction({ p: 1 - pMid, marketPrice: noPrice });

  let side, fullKelly;
  if (fYes > fNo) {
    side = 'YES';
    fullKelly = fYes;
  } else if (fNo > 0) {
    side = 'NO';
    fullKelly = fNo;
  } else {
    reasoning.push('no positive Kelly on either side → SKIP');
    return { side: 'SKIP', size: 0, fraction: 0, reasoning };
  }

  // Phase 3e-2 Layer 1: dog/favorite price gates (Sophie 5/10 反事实)
  const buyPrice = side === 'YES' ? yesPrice : noPrice;
  if (buyPrice <= DOG_BUY_PRICE_THRESHOLD) {
    reasoning.push(`buy_price $${buyPrice.toFixed(3)} <= $${DOG_BUY_PRICE_THRESHOLD} (deep dog, 体育市场反向押系统性输) → SKIP`);
    return { side: 'SKIP', size: 0, fraction: 0, reasoning };
  }
  let favoritePenalty = 1;
  if (buyPrice >= FAVORITE_BUY_PRICE_THRESHOLD) {
    if (sigma > FAVORITE_SIGMA_TOLERANCE) {
      reasoning.push(`buy_price $${buyPrice.toFixed(3)} >= $${FAVORITE_BUY_PRICE_THRESHOLD} (heavy favorite) AND sigma ${(sigma * 100).toFixed(1)}% > ${FAVORITE_SIGMA_TOLERANCE * 100}% → SKIP`);
      return { side: 'SKIP', size: 0, fraction: 0, reasoning };
    }
    favoritePenalty = FAVORITE_SIZE_PENALTY;
    reasoning.push(`heavy favorite buy_price $${buyPrice.toFixed(3)} (sigma ${(sigma * 100).toFixed(1)}% acceptable) → size × ${FAVORITE_SIZE_PENALTY}`);
  }

  const edge = side === 'YES' ? Math.abs(pMid - yesPrice) : Math.abs((1 - pMid) - noPrice);
  if (edge < MIN_EDGE_POINTS) {
    reasoning.push(`edge ${(edge * 100).toFixed(1)}pt < ${MIN_EDGE_POINTS * 100}pt min → SKIP`);
    return { side: 'SKIP', size: 0, fraction: 0, reasoning };
  }

  let appliedFraction = kf;
  reasoning.push(`base ${kf} Kelly`);

  if (infoGapMonths > INFO_GAP_TIGHT_MONTHS) {
    appliedFraction *= 0.5;
    reasoning.push(`info gap ${infoGapMonths.toFixed(1)} months → halve to ${appliedFraction.toFixed(3)}`);
  }

  if (sigma > 0.05) {
    const sigPenalty = Math.max(0.5, 1 - sigma * 5);
    appliedFraction *= sigPenalty;
    reasoning.push(`sigma ${sigma.toFixed(2)} → penalty ${sigPenalty.toFixed(2)}, fraction ${appliedFraction.toFixed(3)}`);
  }

  const fraction = fullKelly * appliedFraction * favoritePenalty;
  const size = bankroll * fraction;
  reasoning.push(`fullKelly=${fullKelly.toFixed(3)}, applied=${appliedFraction.toFixed(3)}${favoritePenalty < 1 ? ', favorite_penalty=' + favoritePenalty : ''}, size=${size.toFixed(2)}`);

  return { side, size, fraction, reasoning };
}
