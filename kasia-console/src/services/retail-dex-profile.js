// retail-dex-profile.js — 用户画像聚合
//
// ⚠ SUPERSEDED BY docs/spec/2026-04-24-dex-broker-v2-glue-layer.md
// ⚠ DO NOT EXTEND — see docs/ANTI-PATTERNS.md (v1 retail-dex case study)
//
// 本文件 155 行 100% 重复 Mind skill 已有能力, 具体:
//   · loadUserProfile (~40 LOC)       → 重复 agent-mind/src/skills/address-profiler.mjs 行为分类 + 画像
//   · deriveTraits (~30 LOC)          → 重复 self-awareness skill + chain_sense 已经做过
//   · formatProfileForBrain           → 重复 context-builder formatForBrain pattern
//   · 聚合 /api/discovery/activity    → Mind address-profiler 直接 fetch 同一 endpoint
//
// v2 删此文件, 画像走 Mind address-profiler + self-awareness 组合.
//
// 实验目的: 证明 KANet 的 Agent 能利用 on-chain identity + history 做到
// "有记忆不重问". 老客户发"买 50 KAS" 一句话直接下单.
//
// 聚合源:
//   identities            — 显示名 / discovery_status / interaction_count / last_seen_at
//   relation_states       — 熟客度 (classification) / 首次见到 / trust_level
//   retail_dex_orders     — 历史下单明细 (side/qty/chain/address/state)
//   mm_orders             — 老 OTC 订单历史
//   chain_events          — 链上事件活动度
//
// 输出扁平 profile 对象, 注入 LLM system prompt 作为 [用户画像].

import { sqlite } from '../db/client.js';

/**
 * 聚合用户画像. 只读, 不写任何表.
 * @param {string} userAddress - 用户 Kasia 地址
 * @param {string} brokerAddress - Broker Kasia 地址 (查关系状态用)
 * @returns {Promise<object>}
 */
export async function getUserProfile(userAddress, brokerAddress) {
  // 1. 基础身份
  const idn = sqlite.prepare(
    'SELECT display_name, discovery_status, confidence_score, interaction_count, last_seen_at, tags, notes, card_entity_type FROM identities WHERE address = ?'
  ).get(userAddress);

  // 2. 社交关系 (与 Broker 的历史)
  const rs = brokerAddress ? sqlite.prepare(
    'SELECT status, classification, trust_level, handshake_accepted_at, updated_at FROM relation_states WHERE local_address = ? AND peer_address = ?'
  ).get(brokerAddress, userAddress) : null;

  // 3. retail_dex_orders 历史 (最近 10 笔, 按时间倒序)
  const history = sqlite.prepare(`
    SELECT id, side, order_type, qty, price, pay_chain, pay_address, quoted_usdt,
      state, deliver_tx_hash, created_at, updated_at
    FROM retail_dex_orders
    WHERE user_kasia_address = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(userAddress);

  // 4. 从历史推偏好 (最常用链 + 最常用付款地址)
  const completed = history.filter(o => o.state === 'completed' || o.state === 'executing');
  const chainCounts = {};
  const addrCounts = {};
  let totalKasBought = 0;
  let totalKasSold = 0;
  let lastCompletedOrder = null;

  for (const o of history) {
    if (o.pay_chain) chainCounts[o.pay_chain] = (chainCounts[o.pay_chain] || 0) + 1;
    if (o.pay_address) addrCounts[o.pay_address] = (addrCounts[o.pay_address] || 0) + 1;
    if (o.state === 'completed') {
      if (o.side === 'buy_kas') totalKasBought += parseFloat(o.qty) || 0;
      if (o.side === 'sell_kas') totalKasSold += parseFloat(o.qty) || 0;
      if (!lastCompletedOrder) lastCompletedOrder = o;
    }
  }
  const preferredChain = Object.keys(chainCounts).sort((a, b) => chainCounts[b] - chainCounts[a])[0] || null;
  const preferredAddress = Object.keys(addrCounts).sort((a, b) => addrCounts[b] - addrCounts[a])[0] || null;

  // 5. mm_orders (老 OTC) 笔数, 作为熟客度辅助指标
  const mmCount = sqlite.prepare(
    "SELECT COUNT(*) as c FROM mm_orders WHERE peer_address = ? AND status IN ('completed','resolved')"
  ).get(userAddress)?.c || 0;

  // 6. 链上活动量 (chain_events 来往笔数)
  const chainActivity = sqlite.prepare(
    "SELECT COUNT(*) as c FROM chain_events WHERE from_address = ? OR to_address = ?"
  ).get(userAddress, userAddress)?.c || 0;

  return {
    address: userAddress,
    display_name: idn?.display_name || null,
    entity_type: idn?.card_entity_type || null,
    discovery_status: idn?.discovery_status || 'unknown',
    interaction_count: idn?.interaction_count || 0,
    last_seen_at: idn?.last_seen_at || null,
    tags: idn?.tags || null,
    notes: idn?.notes || null,
    // 关系
    relation_status: rs?.status || null,
    relation_classification: rs?.classification || null,
    trust_level: rs?.trust_level || 'normal',
    first_handshake_at: rs?.handshake_accepted_at || null,
    // 交易历史
    is_returning: history.length > 0,
    is_completed_customer: completed.length > 0,
    total_orders: history.length,
    completed_orders: completed.length,
    last_order: lastCompletedOrder ? {
      id_short: lastCompletedOrder.id.slice(0, 8),
      when: lastCompletedOrder.updated_at,
      side: lastCompletedOrder.side,
      qty: lastCompletedOrder.qty,
      pay_chain: lastCompletedOrder.pay_chain,
      pay_address: lastCompletedOrder.pay_address,
      quoted_usdt: lastCompletedOrder.quoted_usdt,
    } : null,
    preferred_chain: preferredChain,
    preferred_address: preferredAddress,
    total_kas_bought: totalKasBought,
    total_kas_sold: totalKasSold,
    // 辅助指标
    mm_orders_completed: mmCount,
    chain_activity_count: chainActivity,
  };
}

/**
 * 格式化画像为 LLM system prompt 段落.
 * 新用户 → 短提示, 老用户 → 丰富数据 (让 LLM 能引用).
 */
export function formatProfileForPrompt(profile) {
  if (!profile) return '[用户画像] 查询失败';

  const lines = ['[用户画像]'];
  // 身份
  if (profile.display_name) lines.push(`- 名字: ${profile.display_name}`);
  else lines.push(`- 名字: 未知 (地址尾号 ${profile.address.slice(-8)})`);

  // 熟客度
  if (profile.is_returning) {
    lines.push(`- 熟客度: ${profile.relation_classification || '未知'} (关系 ${profile.relation_status || 'n/a'})`);
    lines.push(`- 历史订单: ${profile.total_orders} 笔 / 成交 ${profile.completed_orders} 笔`);
    if (profile.total_kas_bought > 0) lines.push(`- 累计买: ${profile.total_kas_bought.toFixed(2)} KAS`);
    if (profile.total_kas_sold > 0) lines.push(`- 累计卖: ${profile.total_kas_sold.toFixed(2)} KAS`);
  } else {
    lines.push('- 新客户 (第一次跟你下单)');
  }

  // 上次订单细节 (关键 — LLM 可直接复用)
  if (profile.last_order) {
    const lo = profile.last_order;
    const when = lo.when ? new Date(lo.when).toISOString().slice(0, 10) : '未知';
    lines.push(`- 上次成交: ${when}, ${lo.side === 'buy_kas' ? '买' : '卖'} ${lo.qty} KAS via ${lo.pay_chain}`);
    if (lo.pay_address) lines.push(`- 上次付款地址: ${lo.pay_address}`);
  }

  // 偏好 (如果和上次一样就不重复)
  if (profile.preferred_chain && (!profile.last_order || profile.preferred_chain !== profile.last_order.pay_chain)) {
    lines.push(`- 最常用链: ${profile.preferred_chain}`);
  }
  if (profile.preferred_address && (!profile.last_order || profile.preferred_address !== profile.last_order.pay_address)) {
    lines.push(`- 最常用地址: ${profile.preferred_address}`);
  }

  // 关系备注
  if (profile.tags) lines.push(`- 标签: ${profile.tags}`);
  if (profile.trust_level && profile.trust_level !== 'normal') lines.push(`- 信任: ${profile.trust_level}`);

  return lines.join('\n');
}
