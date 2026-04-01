/**
 * Signal Engine — 交易信号计算（纯数学，不用 AI）
 *
 * 输入：K线、订单簿、鲸鱼评分
 * 输出：五维信号 + 综合评分 + 市场环境
 *
 * 只有 |composite × confidence| > 60 才推给策略层。
 */

// ═══════════════════════════════════════════════════════════════
//  Technical Indicator Functions
// ═══════════════════════════════════════════════════════════════

/**
 * EMA — Exponential Moving Average
 * @param {number[]} closes - close prices
 * @param {number} period
 * @returns {number} latest EMA value
 */
function calcEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * EMA series — full array of EMA values
 */
function calcEMASeries(closes, period) {
  const result = [];
  if (closes.length < period) return closes.map(() => closes[0] || 0);
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < period; i++) result.push(ema);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

/**
 * ATR — Average True Range
 * @param {{ high: number, low: number, close: number }[]} candles
 * @param {number} period
 * @returns {number}
 */
function calcATR(candles, period) {
  if (candles.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trs.push(tr);
  }
  if (trs.length < period) return trs.reduce((s, v) => s + v, 0) / trs.length;
  // Wilder's smoothing
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/**
 * ADX — Average Directional Index
 * @param {{ high: number, low: number, close: number }[]} candles
 * @param {number} period
 * @returns {number} ADX value (0-100)
 */
function calcADX(candles, period) {
  if (candles.length < period * 2) return 0;

  const plusDM = [], minusDM = [], trs = [];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }

  // Wilder smoothing
  const smooth = (arr, p) => {
    let s = arr.slice(0, p).reduce((a, v) => a + v, 0);
    const result = [s];
    for (let i = p; i < arr.length; i++) {
      s = s - s / p + arr[i];
      result.push(s);
    }
    return result;
  };

  const sTR = smooth(trs, period);
  const sPDM = smooth(plusDM, period);
  const sMDM = smooth(minusDM, period);

  const dx = [];
  for (let i = 0; i < sTR.length; i++) {
    if (sTR[i] === 0) { dx.push(0); continue; }
    const pdi = sPDM[i] / sTR[i] * 100;
    const mdi = sMDM[i] / sTR[i] * 100;
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : Math.abs(pdi - mdi) / sum * 100);
  }

  if (dx.length < period) return dx[dx.length - 1] || 0;
  let adx = dx.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }
  return adx;
}

/**
 * RSI — Relative Strength Index
 * @param {number[]} closes
 * @param {number} period
 * @returns {number} 0-100
 */
function calcRSI(closes, period) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * MACD — Moving Average Convergence Divergence
 * @param {number[]} closes
 * @returns {{ macd: number, signal: number, histogram: number }}
 */
function calcMACD(closes) {
  const ema12 = calcEMASeries(closes, 12);
  const ema26 = calcEMASeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMASeries(macdLine, 9);
  const macd = macdLine[macdLine.length - 1] || 0;
  const signal = signalLine[signalLine.length - 1] || 0;
  return { macd, signal, histogram: macd - signal };
}

/**
 * ROC — Rate of Change
 * @param {number[]} closes
 * @param {number} period
 * @returns {number} percentage change
 */
function calcROC(closes, period) {
  if (closes.length <= period) return 0;
  const old = closes[closes.length - 1 - period];
  const now = closes[closes.length - 1];
  return old === 0 ? 0 : ((now - old) / old) * 100;
}

/**
 * Bollinger Bands
 * @param {number[]} closes
 * @param {number} period
 * @param {number} stdDev
 * @returns {{ upper: number, middle: number, lower: number }}
 */
function calcBollingerBands(closes, period, stdDev) {
  const slice = closes.slice(-period);
  if (slice.length < period) {
    const avg = slice.reduce((s, v) => s + v, 0) / slice.length;
    return { upper: avg, middle: avg, lower: avg };
  }
  const middle = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance) * stdDev;
  return { upper: middle + sd, middle, lower: middle - sd };
}

// ═══════════════════════════════════════════════════════════════
//  Five Signal Calculations
// ═══════════════════════════════════════════════════════════════

/**
 * Trend Signal (-100 ~ +100)
 * EMA 9/21 crossover direction × ADX strength
 */
function calcTrendSignal(candles) {
  const closes = candles.map(c => c.close);
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const adx = calcADX(candles, 14);

  const cross = ema9 > ema21 ? 1 : -1;
  const strength = Math.min(adx / 50, 1);
  return Math.round(cross * strength * 100);
}

/**
 * Momentum Signal (-100 ~ +100)
 * RSI + MACD histogram + ROC averaged
 */
function calcMomentumSignal(candles) {
  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes);
  const roc = calcROC(closes, 10);

  const rsiScore = (rsi - 50) * 2; // -100 ~ +100
  const macdScore = Math.sign(macd.histogram) * Math.min(Math.abs(macd.histogram) * 1000, 100);
  const rocScore = Math.max(-100, Math.min(100, roc * 10));

  return Math.round((rsiScore + macdScore + rocScore) / 3);
}

/**
 * Order Flow Signal (-100 ~ +100)
 * Order Book Imbalance — positive=buy pressure, negative=sell pressure
 */
function calcOrderFlowSignal(orderBook) {
  if (!orderBook?.bids?.length || !orderBook?.asks?.length) return 0;
  const bidVol = orderBook.bids.slice(0, 20).reduce((s, [, q]) => s + q, 0);
  const askVol = orderBook.asks.slice(0, 20).reduce((s, [, q]) => s + q, 0);
  const total = bidVol + askVol;
  if (total === 0) return 0;
  return Math.round(((bidVol - askVol) / total) * 100);
}

/**
 * Volatility Signal (0 ~ 100)
 * Bollinger Band width — degree only, no direction
 */
function calcVolatilitySignal(candles) {
  const closes = candles.map(c => c.close);
  const bb = calcBollingerBands(closes, 20, 2);
  if (bb.middle === 0) return 0;
  const bbWidth = (bb.upper - bb.lower) / bb.middle;
  return Math.round(Math.min(bbWidth * 500, 100));
}

/**
 * Whale Signal (-100 ~ +100)
 * From whale-signal.js output: score × direction
 */
function calcWhaleSignal(whaleData) {
  if (!whaleData || !whaleData.score) return 0;
  const dir = whaleData.direction === 'accumulation' ? 1
            : whaleData.direction === 'distribution' ? -1 : 0;
  return Math.round(dir * whaleData.score);
}

// ═══════════════════════════════════════════════════════════════
//  Composite Score + Regime Detection
// ═══════════════════════════════════════════════════════════════

function calcCompositeScore(signals) {
  const weights = {
    trend:     0.30,
    momentum:  0.25,
    orderFlow: 0.25,
    whale:     0.20,
    // volatility is used for risk control, not scoring
  };

  const composite =
    signals.trend     * weights.trend +
    signals.momentum  * weights.momentum +
    signals.orderFlow * weights.orderFlow +
    signals.whale     * weights.whale;

  // Confidence: signal consistency (all same direction = high)
  const values = [signals.trend, signals.momentum, signals.orderFlow, signals.whale];
  const positive = values.filter(v => v > 10).length;
  const negative = values.filter(v => v < -10).length;
  const neutral = values.length - positive - negative;
  const consistency = Math.max(positive, negative) / values.length;

  return {
    composite: Math.round(composite),
    confidence: parseFloat(consistency.toFixed(2)),
  };
}

function detectRegime(candles) {
  const adx = calcADX(candles, 14);
  let regime;
  if (adx > 25) regime = 'trending';
  else if (adx < 20) regime = 'ranging';
  else regime = 'uncertain';
  return { regime, adx: Math.round(adx * 10) / 10 };
}

// ═══════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════

/**
 * Analyze market from raw data.
 *
 * @param {{ high: number, low: number, close: number, volume: number }[]} candles - K-line data
 * @param {{ bids: [number,number][], asks: [number,number][] }} orderBook
 * @param {{ score: number, direction: string }} whaleData - from whale-signal.js
 * @returns {{ composite, confidence, signals, regime, adx, actionable }}
 */
export function analyzeMarket(candles, orderBook, whaleData) {
  if (!candles?.length) {
    return { composite: 0, confidence: 0, signals: {}, regime: 'unknown', adx: 0, actionable: false };
  }

  const signals = {
    trend:      calcTrendSignal(candles),
    momentum:   calcMomentumSignal(candles),
    orderFlow:  calcOrderFlowSignal(orderBook),
    volatility: calcVolatilitySignal(candles),
    whale:      calcWhaleSignal(whaleData),
  };

  const scored = calcCompositeScore(signals);
  const { regime, adx } = detectRegime(candles);

  return {
    ...scored,
    signals,
    regime,
    adx,
    actionable: Math.abs(scored.composite * scored.confidence) > 60,
    analyzedAt: new Date().toISOString(),
  };
}

// Export individual functions for testing
export { calcEMA, calcADX, calcRSI, calcMACD, calcROC, calcBollingerBands, calcATR };
