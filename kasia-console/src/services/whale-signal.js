/**
 * Whale Signal Function — 链上大额异动信号
 *
 * 将 whale alert 频率 + 金额 + KAS 价格耦合为一个有意义的信号分数。
 *
 * 输入：最近 N 分钟的 whale moves + 当前 KAS 价格
 * 输出：0-100 信号分数 + 方向 + 摘要
 *
 * 核心逻辑：
 *   1. 美元等值阈值（动态，跟价格走）
 *   2. 频率异常（vs 历史基线）
 *   3. 方向聚合（INFLOW/OUTFLOW 偏向）
 *   4. 金额集中度（单笔巨额 vs 多笔小额）
 *
 * 所有参数可调，UI 面板实时显示。
 */

import { sqlite } from '../db/client.js';
import { getCachedKasPrice } from './market-data.js';

// ── 可调参数（默认值，UI 可改） ──────────────────────────────────
const DEFAULT_PARAMS = {
  windowMinutes: 30,           // 信号计算窗口
  usdThreshold: 50_000,        // 美元等值门槛：低于此不计入信号
  baselineHours: 24,           // 历史基线窗口（计算"正常"频率）
  frequencyWeight: 0.4,        // 频率异常权重
  volumeWeight: 0.35,          // 金额异常权重
  directionWeight: 0.25,       // 方向偏向权重
};

/**
 * 计算鲸鱼信号
 *
 * @param {object} [params] — 覆盖默认参数
 * @returns {{ score, direction, summary, details }}
 */
export function computeWhaleSignal(params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const now = new Date();

  // 1. 获取当前 KAS 价格
  const kasPrice = _getKasPrice();
  if (!kasPrice || kasPrice <= 0) {
    return { score: 0, direction: 'neutral', summary: 'Price unavailable', details: { kasPrice: 0 } };
  }

  // 2. 获取窗口内的 whale alerts
  const windowAlerts = _getRecentAlerts(p.windowMinutes);

  // 3. 过滤：只保留 >= usdThreshold 的
  const significant = windowAlerts.filter(a => {
    const usdValue = (a.amountKas || 0) * kasPrice;
    a._usdValue = usdValue;
    return usdValue >= p.usdThreshold;
  });

  if (significant.length === 0) {
    return {
      score: 0,
      direction: 'neutral',
      summary: `No significant whale activity (window: ${p.windowMinutes}min, threshold: $${(p.usdThreshold / 1000).toFixed(0)}K)`,
      details: { kasPrice, totalAlerts: windowAlerts.length, significantAlerts: 0, windowMinutes: p.windowMinutes },
    };
  }

  // 4. 频率信号：当前窗口 vs 历史基线
  const baselineRate = _getBaselineRate(p.baselineHours, p.windowMinutes, kasPrice, p.usdThreshold);
  const currentRate = significant.length;
  const frequencyRatio = baselineRate > 0 ? currentRate / baselineRate : (currentRate > 0 ? 5 : 0);
  // 归一化到 0-100：ratio=1 → 0, ratio=3 → 50, ratio>=5 → 100
  const frequencyScore = Math.min(100, Math.max(0, (frequencyRatio - 1) * 25));

  // 5. 金额信号：总美元量 vs 日均
  const totalUsd = significant.reduce((sum, a) => sum + a._usdValue, 0);
  const avgDailyUsd = _getAvgDailyVolume(p.baselineHours, kasPrice, p.usdThreshold);
  const volumeRatio = avgDailyUsd > 0 ? totalUsd / (avgDailyUsd * p.windowMinutes / (24 * 60)) : (totalUsd > 0 ? 5 : 0);
  const volumeScore = Math.min(100, Math.max(0, (volumeRatio - 1) * 25));

  // 6. 方向信号：INFLOW vs OUTFLOW 偏向
  let inflowUsd = 0, outflowUsd = 0, transferUsd = 0;
  for (const a of significant) {
    if (a.direction === 'INFLOW') inflowUsd += a._usdValue;
    else if (a.direction === 'OUTFLOW') outflowUsd += a._usdValue;
    else transferUsd += a._usdValue;
  }
  const totalDirectional = inflowUsd + outflowUsd || 1;
  const directionBias = (inflowUsd - outflowUsd) / totalDirectional; // -1 to +1
  const directionScore = Math.abs(directionBias) * 100; // 0-100
  const direction = directionBias > 0.2 ? 'accumulation'
    : directionBias < -0.2 ? 'distribution'
    : 'neutral';

  // 7. 加权合成
  const score = Math.round(
    frequencyScore * p.frequencyWeight +
    volumeScore * p.volumeWeight +
    directionScore * p.directionWeight
  );

  // 8. 生成摘要
  const topMove = significant.reduce((max, a) => a._usdValue > (max._usdValue || 0) ? a : max, {});
  const summary = [
    `Signal: ${score}/100 (${direction})`,
    `${significant.length} moves ≥ $${(p.usdThreshold / 1000).toFixed(0)}K in ${p.windowMinutes}min`,
    `Total: $${(totalUsd / 1000).toFixed(0)}K`,
    `Largest: $${((topMove._usdValue || 0) / 1000).toFixed(0)}K (${Math.round(topMove.amountKas || 0).toLocaleString()} KAS)`,
    direction !== 'neutral' ? `Direction: ${direction} (bias: ${(directionBias * 100).toFixed(0)}%)` : '',
  ].filter(Boolean).join(' | ');

  return {
    score,
    direction,
    summary,
    details: {
      kasPrice,
      windowMinutes: p.windowMinutes,
      usdThreshold: p.usdThreshold,
      totalAlerts: windowAlerts.length,
      significantAlerts: significant.length,
      totalUsd: Math.round(totalUsd),
      frequencyScore: Math.round(frequencyScore),
      volumeScore: Math.round(volumeScore),
      directionScore: Math.round(directionScore),
      inflowUsd: Math.round(inflowUsd),
      outflowUsd: Math.round(outflowUsd),
      transferUsd: Math.round(transferUsd),
      directionBias: Math.round(directionBias * 100) / 100,
      baselineRate: Math.round(baselineRate * 10) / 10,
      currentRate,
      topMove: topMove.amountKas ? {
        amountKas: Math.round(topMove.amountKas),
        usd: Math.round(topMove._usdValue),
        direction: topMove.direction,
        address: topMove.address,
      } : null,
    },
  };
}

/**
 * 获取/更新参数（存 DB config_entries）
 */
export function getParams() {
  try {
    const row = sqlite.prepare("SELECT value_encrypted FROM config_entries WHERE key = 'whale_signal_params'").get();
    if (row?.value_encrypted) return { ...DEFAULT_PARAMS, ...JSON.parse(row.value_encrypted) };
  } catch {}
  return { ...DEFAULT_PARAMS };
}

export function setParams(overrides) {
  const merged = { ...getParams(), ...overrides };
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO config_entries (id, key, category, value_encrypted, is_sensitive, updated_at, created_at)
    VALUES ('whale_signal_params', 'whale_signal_params', 'whale_signal', ?, 0, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_encrypted = ?, updated_at = ?
  `).run(JSON.stringify(merged), now, now, JSON.stringify(merged), now);
  return merged;
}

// ── 内部数据获取 ─────────────────────────────────────────────────

function _getKasPrice() {
  try {
    // 1. 优先用做市报价（实时）
    const quote = sqlite.prepare('SELECT mexc_price FROM mm_quotes ORDER BY created_at DESC LIMIT 1').get();
    if (quote?.mexc_price) return quote.mexc_price;
    // 2. 回退到 market-data 缓存（MEXC 价格，10 分钟缓存）
    const p = getCachedKasPrice();
    if (p > 0) return p;
    return 0;
  } catch {
    return 0;
  }
}

function _getRecentAlerts(windowMinutes) {
  try {
    return sqlite.prepare(`
      SELECT payload_json FROM events
      WHERE event_type = 'whale_alert' AND created_at > datetime('now', '-${windowMinutes} minutes')
      ORDER BY created_at DESC
    `).all().map(r => {
      try { return JSON.parse(r.payload_json); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function _getBaselineRate(baselineHours, windowMinutes, kasPrice, usdThreshold) {
  // 过去 N 小时内，平均每 windowMinutes 分钟有多少条 >= usdThreshold 的 alert
  try {
    const kasThreshold = usdThreshold / kasPrice;
    const total = sqlite.prepare(`
      SELECT COUNT(*) as n FROM events
      WHERE event_type = 'whale_alert' AND created_at > datetime('now', '-${baselineHours} hours')
    `).get().n;
    // 粗算：总条数中大概有多少比例超过阈值（用最近的样本估算）
    const sample = sqlite.prepare(`
      SELECT payload_json FROM events
      WHERE event_type = 'whale_alert' AND created_at > datetime('now', '-${baselineHours} hours')
      ORDER BY created_at DESC LIMIT 200
    `).all();
    let aboveThreshold = 0;
    for (const r of sample) {
      try {
        const p = JSON.parse(r.payload_json);
        if ((p.amountKas || 0) >= kasThreshold) aboveThreshold++;
      } catch {}
    }
    const ratio = sample.length > 0 ? aboveThreshold / sample.length : 0;
    const totalAbove = total * ratio;
    const windows = (baselineHours * 60) / windowMinutes;
    return windows > 0 ? totalAbove / windows : 0;
  } catch {
    return 0;
  }
}

function _getAvgDailyVolume(baselineHours, kasPrice, usdThreshold) {
  try {
    const kasThreshold = usdThreshold / kasPrice;
    const rows = sqlite.prepare(`
      SELECT payload_json FROM events
      WHERE event_type = 'whale_alert' AND created_at > datetime('now', '-${baselineHours} hours')
    `).all();
    let totalKas = 0;
    for (const r of rows) {
      try {
        const p = JSON.parse(r.payload_json);
        if ((p.amountKas || 0) >= kasThreshold) totalKas += p.amountKas;
      } catch {}
    }
    const days = baselineHours / 24;
    return days > 0 ? (totalKas * kasPrice) / days : 0;
  } catch {
    return 0;
  }
}
