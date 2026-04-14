/**
 * Peer Reputation Assessment — 基于链上事实的对手方信誉评估
 *
 * 不做虚假的"信誉分"，做事实陈列——让人/Agent 自己判断。
 * 数据全部来自链上（通过 Scout/Relay 采集到 DB）。
 *
 * 核心原则：链上数据不会说谎。
 */

import { sqlite } from '../db/client.js';

/**
 * 评估一个对手方地址的交易信誉。
 *
 * @param {string} myAddress — 我方 Agent 地址
 * @param {string} peerAddress — 对手方地址
 * @returns {object} — 信誉事实报告
 */
export function assessReputation(myAddress, peerAddress) {
  if (!peerAddress) return { risk: 'unknown', reason: '地址为空' };

  // ── 1. 身份信息（链上声明）──
  const identity = sqlite.prepare(
    'SELECT display_name, identity_type, card_mode, card_entity_type, card_summary, card_timestamp, discovered_at, last_seen_at, created_at FROM identities WHERE address = ?'
  ).get(peerAddress);

  const hasCard = !!(identity?.card_mode && identity?.card_entity_type);
  const cardAge = identity?.card_timestamp ? Math.floor((Date.now() - new Date(identity.card_timestamp).getTime()) / 86400000) : null;
  const addressAge = identity?.discovered_at
    ? Math.floor((Date.now() - new Date(identity.discovered_at).getTime()) / 86400000)
    : identity?.created_at
      ? Math.floor((Date.now() - new Date(identity.created_at).getTime()) / 86400000)
      : null;

  // ── 2. 交易历史（mm_orders + exchange_offers UNION）──
  //
  // 原版只查 mm_orders (OTC 遗留表), 不知道 exchange_offers 存在 → 所有 Exchange
  // 模块上的交易对 reputation 层完全失明. Phase 2 P2-02/P2-03 坐实这个 bug.
  // Schema 不同, 用 CASE 表达式把 give/want_asset 映射到统一的 kas_amount/usdt_amount.
  const trades = sqlite.prepare(`
    SELECT * FROM (
      -- OTC legacy
      SELECT status, kas_amount, usdt_amount, created_at, completed_at, 'mm' AS source
      FROM mm_orders
      WHERE peer_address = ? OR agent_address = ?

      UNION ALL

      -- Exchange (new since v37)
      SELECT
        protocol_status AS status,
        CASE WHEN UPPER(give_asset) = 'KAS' THEN CAST(give_amount AS REAL)
             WHEN UPPER(want_asset) = 'KAS' THEN CAST(want_amount AS REAL)
             ELSE 0 END AS kas_amount,
        CASE WHEN UPPER(give_asset) LIKE 'USD%' THEN CAST(give_amount AS REAL)
             WHEN UPPER(want_asset) LIKE 'USD%' THEN CAST(want_amount AS REAL)
             ELSE 0 END AS usdt_amount,
        created_at,
        completed_at,
        'exchange' AS source
      FROM exchange_offers
      WHERE maker = ? OR taker = ?
    )
    ORDER BY created_at DESC
  `).all(peerAddress, peerAddress, peerAddress, peerAddress);

  const completed = trades.filter(t => t.status === 'completed');
  const cancelled = trades.filter(t => t.status === 'cancelled');
  const disputed = trades.filter(t => ['disputed', 'escalated'].includes(t.status));
  const totalTrades = trades.length;
  const completionRate = totalTrades > 0 ? completed.length / totalTrades : null;
  const totalKasVolume = completed.reduce((sum, t) => sum + (t.kas_amount || 0), 0);
  const avgTradeSize = completed.length > 0 ? totalKasVolume / completed.length : 0;

  // ── 3. 与我的关系 ──
  const relation = myAddress ? sqlite.prepare(
    'SELECT status, handshake_observed_at, trust_level FROM relation_states WHERE local_address = ? AND peer_address = ?'
  ).get(myAddress, peerAddress) : null;

  // 我和对手方的历史交易 (mm_orders + exchange_offers UNION)
  const mutualTrades = sqlite.prepare(`
    SELECT * FROM (
      SELECT status, kas_amount, 'mm' AS source FROM mm_orders
      WHERE (agent_address = ? AND peer_address = ?)
         OR (agent_address = ? AND peer_address = ?)

      UNION ALL

      SELECT
        protocol_status AS status,
        CASE WHEN UPPER(give_asset) = 'KAS' THEN CAST(give_amount AS REAL)
             WHEN UPPER(want_asset) = 'KAS' THEN CAST(want_amount AS REAL)
             ELSE 0 END AS kas_amount,
        'exchange' AS source
      FROM exchange_offers
      WHERE (maker = ? AND taker = ?)
         OR (maker = ? AND taker = ?)
    )
  `).all(myAddress, peerAddress, peerAddress, myAddress,
         myAddress, peerAddress, peerAddress, myAddress);
  const mutualCompleted = mutualTrades.filter(t => t.status === 'completed').length;
  const mutualDisputed = mutualTrades.filter(t => ['disputed', 'escalated'].includes(t.status)).length;

  // ── 4. 链上活跃度 ──
  const recentActivity = sqlite.prepare(`
    SELECT COUNT(*) as cnt FROM chain_events
    WHERE (from_address = ? OR to_address = ?) AND observed_at > datetime('now', '-7 days')
  `).get(peerAddress, peerAddress);

  // ── 5. 风险评级（基于事实规则，不是主观判断）──
  let risk = 'low';
  const warnings = [];

  if (totalTrades === 0) {
    risk = 'high';
    warnings.push('零交易记录 — 全新对手方');
  }
  if (!hasCard) {
    if (risk !== 'high') risk = 'medium';
    warnings.push('无 Agent Card — 未声明链上身份');
  }
  if (addressAge !== null && addressAge < 1) {
    risk = 'high';
    warnings.push('地址出现不到 1 天 — 极新账号');
  }
  if (disputed.length > 0) {
    risk = 'high';
    warnings.push(`${disputed.length} 笔交易争议记录`);
  }
  if (completionRate !== null && completionRate < 0.8 && totalTrades >= 3) {
    risk = 'high';
    warnings.push(`完成率仅 ${Math.round(completionRate * 100)}%（${completed.length}/${totalTrades}）`);
  }
  if (totalTrades > 0 && totalTrades <= 2 && completed.length > 0) {
    if (risk === 'low') risk = 'medium';
    warnings.push('交易记录较少，建议小额试探');
  }

  // 好信号
  const positives = [];
  if (hasCard) positives.push('Agent Card 已声明');
  if (completionRate >= 0.95 && totalTrades >= 5) positives.push(`信誉良好（${completed.length}/${totalTrades} 完成）`);
  if (mutualCompleted >= 2) positives.push(`与你有 ${mutualCompleted} 笔成功交易`);
  if (relation?.status === 'active') positives.push('已建立通信关系');
  if (addressAge >= 7) positives.push(`链上活跃 ${addressAge} 天`);
  if (recentActivity?.cnt >= 10) positives.push('近 7 天活跃');

  return {
    // 身份
    name: identity?.display_name || null,
    entityType: identity?.card_entity_type || null,
    hasCard,
    cardAge,
    addressAge,

    // 交易历史
    totalTrades,
    completed: completed.length,
    cancelled: cancelled.length,
    disputed: disputed.length,
    completionRate,
    totalKasVolume: Math.round(totalKasVolume),
    avgTradeSize: Math.round(avgTradeSize),

    // 与我的关系
    relationStatus: relation?.status || 'none',
    trustLevel: relation?.trust_level || 'stranger',
    mutualCompleted,
    mutualDisputed,

    // 活跃度
    recentChainActivity: recentActivity?.cnt || 0,

    // 风险评级
    risk, // 'low' | 'medium' | 'high' | 'unknown'
    warnings,
    positives,

    // 人话摘要
    summary: _buildSummary({ risk, warnings, positives, name: identity?.display_name, totalTrades, completed: completed.length, disputed: disputed.length, hasCard, addressAge, relationStatus: relation?.status, mutualCompleted }),
  };
}

/**
 * Auto 模式门槛——是否允许自动接单。
 */
export function isAutoTradeAllowed(reputation) {
  if (reputation.risk === 'high') return { allowed: false, reason: reputation.warnings.join('；') };
  if (reputation.risk === 'unknown') return { allowed: false, reason: '无法评估对手方信誉' };
  // medium risk → 允许但限额减半
  if (reputation.risk === 'medium') return { allowed: true, limitMultiplier: 0.5, reason: '中等风险 — 限额减半' };
  return { allowed: true, limitMultiplier: 1.0 };
}

function _buildSummary({ risk, warnings, positives, name, totalTrades, completed, disputed, hasCard, addressAge, relationStatus, mutualCompleted }) {
  const parts = [];
  const riskIcon = { low: '🟢', medium: '🟡', high: '🔴', unknown: '⚪' }[risk] || '⚪';

  if (name) parts.push(name);
  parts.push(riskIcon + ' ' + { low: '低风险', medium: '中等风险', high: '高风险', unknown: '未知' }[risk]);

  if (totalTrades > 0) {
    parts.push(`${completed}/${totalTrades} 笔交易完成`);
    if (disputed > 0) parts.push(`⚠ ${disputed} 笔争议`);
  } else {
    parts.push('首次交易');
  }

  if (hasCard) parts.push('Card 已声明');
  if (addressAge !== null) parts.push(`链龄 ${addressAge} 天`);
  if (relationStatus === 'active') parts.push('已建立关系');
  if (mutualCompleted > 0) parts.push(`与你 ${mutualCompleted} 笔成功`);

  return parts.join(' · ');
}
