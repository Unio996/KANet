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
 * T-J2-2026-05-11 Phase 2 E.3 (NWT #18 ABE audit E):
 * 读 reputation_summary 表 (E.1 schema, E.2 hook 实时 upsert)。fast cached read 路径。
 * 表未存在 (migrate v97 未跑) OR address 无 row (首次 settlement 前) → return null,
 * caller 走 lazy UNION fallback (assessReputation 主路径)。
 *
 * @param {string} address — 对手方地址
 * @returns {object|null} — { completed_count, disputed_count, timed_out_count, total_kas_volume, total_usd_volume, last_event_at } OR null
 */
export function _readSummary(address) {
  if (!address) return null;
  try {
    return sqlite.prepare(`
      SELECT completed_count, disputed_count, timed_out_count,
             total_kas_volume, total_usd_volume, last_event_at, last_updated_at
      FROM reputation_summary
      WHERE address = ?
    `).get(address) || null;
  } catch (err) {
    // reputation_summary 表未存在 — migrate v97 未跑 OR fresh install
    if (err.message.includes('no such table')) return null;
    console.warn(`[reputation E.3] _readSummary err: ${err.message}`);
    return null;
  }
}

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

  // ── 2. 交易历史（exchange_offers, NWT N14 Phase β Step 2 sub#1）──
  //
  // OTC mm_orders 已 deprecated (5/18 Phase α/β). exchange_offers 是 single source of truth.
  // 原 UNION mm + exchange 删. mm_orders 5/18 ALL-TIME 4 row (test 残, 0 production completed),
  // reputation 反查影响 negligible (NWT N6.2 Q8 共识).
  const trades = sqlite.prepare(`
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
      'exchange' AS source,
      CASE WHEN taker IS NOT NULL THEN 1 ELSE 0 END AS had_taker
    FROM exchange_offers
    WHERE maker = ? OR taker = ?
    ORDER BY created_at DESC
  `).all(peerAddress, peerAddress);

  const completed = trades.filter(t => t.status === 'completed');
  const cancelled = trades.filter(t => t.status === 'cancelled');
  const disputed = trades.filter(t => ['disputed', 'escalated'].includes(t.status));
  // Phase 2 Finding #9 (2026-04-14 修): expired / 未 matched 的 cancelled 不算违约.
  // 只有"进入过交割阶段后" (had_taker=1) 的结果才计入完成率分母.
  // Maker 挂的没接到的单过期不该扣声誉.
  const matchedCancelled = trades.filter(t => t.status === 'cancelled' && t.had_taker);
  const totalTrades = trades.length;
  const actionableTotal = completed.length + disputed.length + matchedCancelled.length;
  const completionRate = actionableTotal > 0 ? completed.length / actionableTotal : null;
  const totalKasVolume = completed.reduce((sum, t) => sum + (t.kas_amount || 0), 0);
  const avgTradeSize = completed.length > 0 ? totalKasVolume / completed.length : 0;

  // ── 3. 与我的关系 ──
  const relation = myAddress ? sqlite.prepare(
    'SELECT status, handshake_observed_at, trust_level FROM relation_states WHERE local_address = ? AND peer_address = ?'
  ).get(myAddress, peerAddress) : null;

  // 我和对手方的历史交易 (exchange_offers only, NWT N14 Phase β Step 2 sub#1)
  const mutualTrades = sqlite.prepare(`
    SELECT
      protocol_status AS status,
      CASE WHEN UPPER(give_asset) = 'KAS' THEN CAST(give_amount AS REAL)
           WHEN UPPER(want_asset) = 'KAS' THEN CAST(want_amount AS REAL)
           ELSE 0 END AS kas_amount,
      'exchange' AS source
    FROM exchange_offers
    WHERE (maker = ? AND taker = ?)
       OR (maker = ? AND taker = ?)
  `).all(myAddress, peerAddress, peerAddress, myAddress);
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
    cancelled: cancelled.length,             // 所有 cancelled (含未 match 过期)
    matchedCancelled: matchedCancelled.length, // 只算真违约 (had_taker=1)
    disputed: disputed.length,
    completionRate,
    actionableTotal,                          // 完成率分母: completed+disputed+matchedCancelled
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
