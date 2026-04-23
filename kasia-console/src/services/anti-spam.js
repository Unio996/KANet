/**
 * Anti-Spam Service — 防止 Agent 骚扰真实用户
 *
 * 四道硬性防护：
 * 1. per-peer 96h 冷却（同一 Agent 96h 内不重复主动联系同一人）
 * 2. 跨 Agent 防重（任何 Agent 24h 内联系过的 peer，其他 Agent 不再联系）
 * 3. 无回复退避（发 3+ 条消息 0 回复 = 30 天冷却）
 * 4. "别发了"关键词检测（对方说 stop → 永久 do_not_contact）
 */

import { sqlite } from '../db/client.js';

// ── Social Style Presets ──
const PRESETS = {
  active:       { peerCooldownHours: 24,  crossAgentHours: 6,  maxNewHandshakes: 5, followUpHours: 24,   maxFollowUps: 3, unansweredMax: 5, unansweredCooldownDays: 7  },
  balanced:     { peerCooldownHours: 48,  crossAgentHours: 12, maxNewHandshakes: 2, followUpHours: 48,   maxFollowUps: 2, unansweredMax: 3, unansweredCooldownDays: 30 },
  conservative: { peerCooldownHours: 96,  crossAgentHours: 24, maxNewHandshakes: 0, followUpHours: null, maxFollowUps: 0, unansweredMax: 1, unansweredCooldownDays: 90 },
};

/**
 * 获取某个 Agent 的生效社交参数（预设 + override 合并）
 */
function getSocialParams(agentAddress) {
  const relay = sqlite.prepare('SELECT social_style, social_overrides FROM relay_nodes WHERE address = ?').get(agentAddress);
  const style = relay?.social_style || 'balanced';
  const base = { ...PRESETS[style] || PRESETS.balanced };
  if (relay?.social_overrides) {
    try {
      const overrides = JSON.parse(relay.social_overrides);
      for (const [k, v] of Object.entries(overrides)) {
        if (v !== null && v !== undefined && v !== '' && base[k] !== undefined) base[k] = Number(v);
      }
    } catch {}
  }
  return base;
}

// "别发了" 关键词（中英文）
const STOP_KEYWORDS = [
  'stop messaging', 'stop contacting', 'leave me alone', 'don\'t message',
  'don\'t contact', 'do not message', 'do not contact', 'unsubscribe',
  'stop sending', 'quit messaging', 'enough', 'go away',
  '别发了', '不要发了', '别再发', '不要再发', '别联系', '不要联系',
  '滚', '烦死了', '别烦我', '不要烦我', '停止', '别骚扰',
];

/**
 * 检查是否可以主动联系某个 peer。
 * 返回 { allowed: true } 或 { allowed: false, reason: string }
 */
export function checkOutboundAllowed(agentAddress, peerAddress, { messageType = 'text' } = {}) {
  if (!agentAddress || !peerAddress) return { allowed: false, reason: 'missing_address' };

  const params = getSocialParams(agentAddress);

  // ── Check 0: do_not_contact 标记（永久屏蔽，不受风格影响）──
  const identity = sqlite.prepare(
    "SELECT tags, notes FROM identities WHERE address = ?"
  ).get(peerAddress);

  if (identity?.tags?.includes('do_not_contact')) {
    return { allowed: false, reason: 'do_not_contact' };
  }

  // ── Check 0.5: 协议前置 — text 消息必须先握过手 (2026-04-14 bug fix) ──
  // 场景: J2 看到链上活跃地址, 决定直接冷 DM, 绕过 SEND_HANDSHAKE.
  // Kasia 协议要求 handshake 建立信任通道后才能发消息.
  // 判定条件: chain_events 里存在任一方向的 handshake TX
  // (兄弟 agent 之间跳过这个检查, 本地互通默认可信)
  if (messageType === 'text') {
    const isSibling = sqlite.prepare('SELECT 1 FROM relay_nodes WHERE address = ?').get(peerAddress);
    if (!isSibling) {
      const hsExists = sqlite.prepare(`
        SELECT 1 FROM chain_events
        WHERE event_type = 'handshake'
          AND ((from_address = ? AND to_address = ?)
            OR (from_address = ? AND to_address = ?))
        LIMIT 1
      `).get(agentAddress, peerAddress, peerAddress, agentAddress);
      if (!hsExists) {
        return { allowed: false, reason: 'no_handshake_yet (must SEND_HANDSHAKE first, text requires established channel)' };
      }
    }
  }

  // ── Check 1: per-peer 冷却（按社交风格）──
  const peerCutoff = new Date(Date.now() - params.peerCooldownHours * 3600_000).toISOString();
  const recentOwn = sqlite.prepare(`
    SELECT COUNT(*) as cnt FROM chain_events
    WHERE from_address = ? AND to_address = ?
      AND event_type IN ('comm', 'comm_sent', 'text', 'handshake')
      AND observed_at > ?
  `).get(agentAddress, peerAddress, peerCutoff);

  if (recentOwn?.cnt > 0) {
    return { allowed: false, reason: `peer_cooldown_${params.peerCooldownHours}h (sent ${recentOwn.cnt})` };
  }

  // ── Check 2: 跨 Agent 防重（按社交风格）──
  const crossCutoff = new Date(Date.now() - params.crossAgentHours * 3600_000).toISOString();
  const recentAny = sqlite.prepare(`
    SELECT from_address, COUNT(*) as cnt FROM chain_events
    WHERE to_address = ?
      AND event_type IN ('comm', 'comm_sent', 'text', 'handshake')
      AND observed_at > ?
      AND from_address IN (SELECT address FROM relay_nodes)
    GROUP BY from_address
    LIMIT 1
  `).get(peerAddress, crossCutoff);

  if (recentAny?.cnt > 0 && recentAny.from_address !== agentAddress) {
    return { allowed: false, reason: `cross_agent_${params.crossAgentHours}h (${recentAny.from_address.slice(-8)} already contacted)` };
  }

  // ── Check 3: 无回复退避（按社交风格）──
  const sentCount = sqlite.prepare(`
    SELECT COUNT(*) as cnt FROM chain_events
    WHERE from_address = ? AND to_address = ?
      AND event_type IN ('comm', 'comm_sent', 'text')
  `).get(agentAddress, peerAddress);

  const recvCount = sqlite.prepare(`
    SELECT COUNT(*) as cnt FROM chain_events
    WHERE from_address = ? AND to_address = ?
      AND event_type IN ('comm', 'comm_received', 'text')
  `).get(peerAddress, agentAddress);

  if ((sentCount?.cnt || 0) >= params.unansweredMax && (recvCount?.cnt || 0) === 0) {
    // 检查最后一次发送时间
    const lastSent = sqlite.prepare(`
      SELECT observed_at FROM chain_events
      WHERE from_address = ? AND to_address = ?
        AND event_type IN ('comm', 'comm_sent', 'text')
      ORDER BY observed_at DESC LIMIT 1
    `).get(agentAddress, peerAddress);

    const cooldownEnd = new Date(new Date(lastSent?.observed_at || 0).getTime() + params.unansweredCooldownDays * 86400_000);
    if (cooldownEnd > new Date()) {
      return { allowed: false, reason: `unanswered_backoff (${sentCount.cnt} sent, 0 replies, cooldown until ${cooldownEnd.toISOString().slice(0, 10)})` };
    }
  }

  return { allowed: true };
}

/**
 * 检测收到的消息是否包含"别发了"关键词。
 * 如果是，自动标记 do_not_contact。
 */
export function detectStopRequest(fromAddress, messageText) {
  if (!messageText || !fromAddress) return false;

  const lower = messageText.toLowerCase().trim();
  const matched = STOP_KEYWORDS.some(kw => lower.includes(kw));

  if (matched) {
    console.log(`[anti-spam] STOP detected from ${fromAddress.slice(-8)}: "${messageText.slice(0, 50)}"`);

    // 标记 do_not_contact
    const identity = sqlite.prepare("SELECT id, tags FROM identities WHERE address = ?").get(fromAddress);
    if (identity) {
      const existingTags = identity.tags ? identity.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      if (!existingTags.includes('do_not_contact')) {
        existingTags.push('do_not_contact');
        sqlite.prepare('UPDATE identities SET tags = ?, notes = COALESCE(notes, "") || ? WHERE id = ?')
          .run(existingTags.join(','), `\n[${new Date().toISOString()}] AUTO: Stop request detected — "${messageText.slice(0, 100)}"`, identity.id);
      }
    }

    return true;
  }
  return false;
}

/**
 * 获取 Agent 行为日志 — messages 为主查询（DM 权威源），chain_events 补充链上事���
 * 返回格式：[{ dir, type, peer, peer_name, ts, txid, content }]
 */
export function getActivityLog(agentAddress, limit = 200, offset = 0, peerAddress = null) {
  // ── 主查询：messages 表（DM 消息权威源）──
  // 通过 conversations 关联 identities 拿到 peer address
  let msgSql = `
    SELECT
      m.id,
      m.direction as dir,
      m.message_type as event_type,
      m.content_text,
      m.source_txid as txid,
      m.created_at as ts,
      CASE m.direction
        WHEN 'inbound'  THEN ri.address
        WHEN 'outbound' THEN ri.address
      END as peer_address
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    JOIN identities li ON li.id = c.local_identity_id
    LEFT JOIN identities ri ON ri.id = c.remote_identity_id
    WHERE li.address = ?
      AND m.message_type != 'query_card'`;
  const msgParams = [agentAddress];

  if (peerAddress) {
    msgSql += ` AND ri.address = ?`;
    msgParams.push(peerAddress);
  }
  msgSql += ` ORDER BY m.created_at DESC LIMIT 500`;

  const msgRows = sqlite.prepare(msgSql).all(...msgParams).map(r => ({
    dir: r.dir === 'inbound' ? 'in' : 'out',
    event_type: r.event_type,
    from_address: r.dir === 'inbound' ? r.peer_address : agentAddress,
    to_address: r.dir === 'inbound' ? agentAddress : r.peer_address,
    ts: r.ts,
    txid: r.txid || null,
    content: r.content_text || null,
    source: 'message',
  }));

  // ���─ 补充查询：chain_events 表（链上事件，排除已在 messages 里��类型）──
  let ceSql = `
    SELECT
      ce.id,
      CASE WHEN ce.from_address = ? THEN 'out' ELSE 'in' END as dir,
      ce.event_type,
      ce.from_address,
      ce.to_address,
      ce.observed_at as ts,
      ce.txid,
      ce.payload
    FROM chain_events ce
    WHERE (ce.from_address = ? OR ce.to_address = ?)
      AND ce.event_type IN ('payment', 'payment_verified', 'payment_failed',
                            'kas_delivery', 'self_stash')`;
  const ceParams = [agentAddress, agentAddress, agentAddress];

  if (peerAddress) {
    ceSql += ` AND (ce.from_address = ? OR ce.to_address = ?)`;
    ceParams.push(peerAddress, peerAddress);
  }
  ceSql += ` ORDER BY ce.observed_at DESC LIMIT 200`;

  const ceRows = sqlite.prepare(ceSql).all(...ceParams).map(r => {
    let content = null;
    if (r.payload) {
      try {
        const p = JSON.parse(r.payload);
        content = p.message || p.text || p.content || p.body || null;
      } catch {}
      if (!content && r.payload.length > 0 && r.payload.length < 500 && !r.payload.startsWith('{')) {
        content = r.payload;
      }
    }
    return {
      dir: r.dir,
      event_type: r.event_type,
      from_address: r.from_address,
      to_address: r.to_address,
      ts: r.ts,
      txid: r.txid || null,
      content,
      source: 'chain_event',
    };
  });

  // ── 合并 + 去重（同一 txid 优先保留 message）──
  const merged = [...msgRows, ...ceRows];
  merged.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

  const seenTxids = new Set();
  const deduped = merged.filter(row => {
    if (!row.txid) return true;
    if (seenTxids.has(row.txid)) return false;
    seenTxids.add(row.txid);
    return true;
  });

  // ── 分页 ──
  const paged = deduped.slice(offset, offset + limit);

  // ── 补充 peer 名称 ──
  const peerAddrs = new Set();
  for (const e of paged) {
    const peer = e.dir === 'out' ? e.to_address : e.from_address;
    if (peer) peerAddrs.add(peer);
  }
  const nameMap = {};
  for (const addr of peerAddrs) {
    const id = sqlite.prepare('SELECT display_name FROM identities WHERE address = ?').get(addr);
    const rn = sqlite.prepare('SELECT name FROM relay_nodes WHERE address = ?').get(addr);
    nameMap[addr] = rn?.name || id?.display_name || null;
  }

  return paged.map(e => {
    const peer = e.dir === 'out' ? e.to_address : e.from_address;
    return {
      dir: e.dir,
      type: e.event_type,
      peer: peer || null,
      peer_name: nameMap[peer] || null,
      ts: e.ts,
      txid: e.txid || null,
      content: e.content,
    };
  });
}

/**
 * 按 peer 地址聚合行为统计
 */
export function getActivityByPeer(agentAddress) {
  const stats = sqlite.prepare(`
    SELECT
      CASE WHEN ce.from_address = ? THEN ce.to_address ELSE ce.from_address END as peer,
      SUM(CASE WHEN ce.from_address = ? THEN 1 ELSE 0 END) as out_count,
      SUM(CASE WHEN ce.to_address = ? THEN 1 ELSE 0 END) as in_count,
      COUNT(*) as total,
      COUNT(DISTINCT ce.txid) as unique_total,
      MIN(ce.observed_at) as first_ts,
      MAX(ce.observed_at) as last_ts,
      GROUP_CONCAT(DISTINCT ce.event_type) as types
      ,SUM(CASE WHEN ce.event_type = 'handshake' AND ce.to_address = ? THEN 1 ELSE 0 END) as hs_in
      ,SUM(CASE WHEN ce.event_type = 'handshake' AND ce.from_address = ? THEN 1 ELSE 0 END) as hs_out
    FROM chain_events ce
    WHERE (ce.from_address = ? OR ce.to_address = ?) AND
      CASE WHEN ce.from_address = ? THEN ce.to_address ELSE ce.from_address END IS NOT NULL
    GROUP BY peer
    ORDER BY MAX(ce.observed_at) DESC
  `).all(agentAddress, agentAddress, agentAddress, agentAddress, agentAddress, agentAddress, agentAddress, agentAddress);

  // 补名称 + identity_id
  for (const s of stats) {
    const rn = sqlite.prepare('SELECT name FROM relay_nodes WHERE address = ?').get(s.peer);
    const id = sqlite.prepare('SELECT id, display_name, tags, notes FROM identities WHERE address = ?').get(s.peer);
    s.peer_name = rn?.name || id?.display_name || null;
    s.tags = id?.tags || '';
    s.notes = id?.notes || '';
    s.identity_id = id?.id || null;
    s.is_local = !!rn;
  }

  return stats;
}

/**
 * 获取外发统计摘要 — 按 peer 聚合
 */
export function getOutboundStats(agentAddress) {
  const stats = sqlite.prepare(`
    SELECT
      ce.to_address as peer,
      i.display_name as peer_name,
      i.tags as peer_tags,
      COUNT(*) as sent_count,
      MIN(ce.observed_at) as first_sent,
      MAX(ce.observed_at) as last_sent,
      (SELECT COUNT(*) FROM chain_events ce2
       WHERE ce2.from_address = ce.to_address AND ce2.to_address = ?
       AND ce2.event_type IN ('comm', 'comm_received')) as reply_count
    FROM chain_events ce
    LEFT JOIN identities i ON i.address = ce.to_address
    WHERE ce.from_address = ?
      AND ce.event_type IN ('comm', 'comm_sent', 'handshake')
    GROUP BY ce.to_address
    ORDER BY sent_count DESC
  `).all(agentAddress, agentAddress);

  return stats;
}

/**
 * 合并通讯录：relation_states ∪ chain_events 取并集
 *
 * 语义 (2026-04-23 修): 通讯录 = 已接受握手的对端 (accepted/confirmed/active/stale).
 *   observed (单向收到握手我方未 accept) 不算联系人, 属"待审批请求".
 *   blocked 默认隐藏.
 * 参数 {includeObserved, includeBlocked} 开关向前兼容.
 */
export function getMergedContacts(agentAddress, { includeObserved = false, includeBlocked = false } = {}) {
  const ceStats = getActivityByPeer(agentAddress);
  const ceMap = {};
  for (const s of ceStats) ceMap[s.peer] = s;

  const allowedStatuses = ['accepted', 'confirmed', 'active', 'stale'];
  if (includeObserved) allowedStatuses.push('observed');
  if (includeBlocked) allowedStatuses.push('blocked');
  const placeholders = allowedStatuses.map(() => '?').join(',');

  const relations = sqlite.prepare(`
    SELECT rs.peer_address as peer, rs.status, rs.trust_level, rs.classification, rs.handshake_observed_at, rs.handshake_accepted_at, rs.updated_at,
      i.id as identity_id, i.display_name, i.tags, i.notes, i.card_entity_type, i.card_summary
    FROM relation_states rs
    LEFT JOIN identities i ON i.address = rs.peer_address
    WHERE rs.local_address = ?
      AND rs.status IN (${placeholders})
  `).all(agentAddress, ...allowedStatuses);

  const rsMap = {};
  for (const r of relations) rsMap[r.peer] = r;

  // Only show peers that have a relation_states entry (real contacts, not just chain interactions)
  const allPeers = new Set(Object.keys(rsMap));
  const isLocal = (addr) => !!sqlite.prepare('SELECT 1 FROM relay_nodes WHERE address = ?').get(addr);

  const merged = [];
  for (const peer of allPeers) {
    const ce = ceMap[peer] || {};
    const rs = rsMap[peer] || {};
    merged.push({
      peer,
      peer_name: ce.peer_name || rs.display_name || null,
      identity_id: ce.identity_id || rs.identity_id || null,
      tags: ce.tags || rs.tags || '',
      notes: ce.notes || rs.notes || '',
      entity_type: rs.card_entity_type || null,
      summary: rs.card_summary || null,
      out_count: ce.out_count || 0,
      in_count: ce.in_count || 0,
      total: ce.total || 0,
      unique_total: ce.unique_total || ce.total || 0,
      types: ce.types || '',
      hs_in: ce.hs_in || 0,
      hs_out: ce.hs_out || 0,
      first_ts: ce.first_ts || rs.handshake_observed_at || null,
      last_ts: ce.last_ts || rs.updated_at || null,
      status: rs.status || null,
      trust_level: rs.trust_level || 'normal',
      classification: rs.classification || 'seen_candidate',
      is_local: ce.is_local !== undefined ? ce.is_local : isLocal(peer),
    });
  }

  merged.sort((a, b) => (b.last_ts || '').localeCompare(a.last_ts || ''));
  return merged;
}
