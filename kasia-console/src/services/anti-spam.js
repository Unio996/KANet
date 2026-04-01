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
export function checkOutboundAllowed(agentAddress, peerAddress) {
  if (!agentAddress || !peerAddress) return { allowed: false, reason: 'missing_address' };

  const params = getSocialParams(agentAddress);

  // ── Check 0: do_not_contact 标记（永久屏蔽，不受风格影响）──
  const identity = sqlite.prepare(
    "SELECT tags, notes FROM identities WHERE address = ?"
  ).get(peerAddress);

  if (identity?.tags?.includes('do_not_contact')) {
    return { allowed: false, reason: 'do_not_contact' };
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
 * 获取 Agent 全部链上行为 — 直接从 chain_events 读，和链上总数一一对应
 * 支持按地址分组、按时间排序
 */
export function getActivityLog(agentAddress, limit = 200, offset = 0, peerAddress = null) {
  // 支持按 peer 筛选 + 分页
  let sql = `
    SELECT
      ce.id,
      CASE WHEN ce.from_address = ? THEN 'out' ELSE 'in' END as dir,
      ce.event_type,
      ce.from_address,
      ce.to_address,
      ce.observed_at as ts,
      ce.txid,
      ce.payload,
      m.content_text as msg_content,
      r.reply_text as reply_content
    FROM chain_events ce
    LEFT JOIN messages m ON m.source_txid = ce.txid AND ce.txid IS NOT NULL
    LEFT JOIN replies r ON r.sent_txid = ce.txid AND ce.txid IS NOT NULL
    WHERE (ce.from_address = ? OR ce.to_address = ?)`;
  const params = [agentAddress, agentAddress, agentAddress];

  if (peerAddress) {
    sql += ` AND (ce.from_address = ? OR ce.to_address = ?)`;
    params.push(peerAddress, peerAddress);
  }

  sql += ` ORDER BY ce.observed_at DESC`;
  // 不在 SQL 里 LIMIT，后面合并 replies 后再分页
  const events = sqlite.prepare(sql).all(...params);

  // 补充 Agent 的回复（replies 表，很多没有 chain_events 对应记录）
  let replySql = `
    SELECT
      'out' as dir, 'reply' as event_type,
      li.address as from_address, ri.address as to_address,
      r.created_at as ts, r.sent_txid as txid, NULL as payload,
      NULL as msg_content, r.reply_text as reply_content
    FROM replies r
    JOIN conversations c ON c.id = r.conversation_id
    JOIN identities li ON li.id = c.local_identity_id
    LEFT JOIN identities ri ON ri.id = c.remote_identity_id
    WHERE li.address = ?`;
  const replyParams = [agentAddress];

  if (peerAddress) {
    replySql += ` AND ri.address = ?`;
    replyParams.push(peerAddress);
  }
  replySql += ` ORDER BY r.created_at DESC`;

  const replyRows = sqlite.prepare(replySql).all(...replyParams);

  // 去重：如果 reply 的 sent_txid 已经在 chain_events 里出现过，跳过
  const existingTxids = new Set(events.filter(e => e.txid).map(e => e.txid));
  // 也按时间去重：如果同一秒有 chain_event out，跳过对应 reply
  const existingOutTs = new Set(events.filter(e => e.dir === 'out').map(e => e.ts?.slice(0, 19)));

  for (const r of replyRows) {
    if (r.txid && existingTxids.has(r.txid)) continue;
    // 检查是否有同一秒的 chain_event（避免重复）
    const rTs = r.ts?.slice(0, 19);
    if (rTs && existingOutTs.has(rTs)) continue;
    events.push(r);
  }

  // 按时间排序后分页
  events.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  const paged = events.slice(offset, offset + limit);

  // 补充 peer 名称（批量查一次）
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

  // 对 dir=out 且 txid 没匹配到的，按时间窗口从 replies 补内容
  // 先按 peer 批量查 conversation_id
  const convCache = {};
  function getConvId(agentAddr, peerAddr) {
    const key = agentAddr + ':' + peerAddr;
    if (convCache[key] !== undefined) return convCache[key];
    const conv = sqlite.prepare(`
      SELECT c.id FROM conversations c
      JOIN identities li ON li.id = c.local_identity_id
      JOIN identities ri ON ri.id = c.remote_identity_id
      WHERE li.address = ? AND ri.address = ?
      LIMIT 1
    `).get(agentAddr, peerAddr);
    convCache[key] = conv?.id || null;
    return convCache[key];
  }

  // 预加载需要的 replies（按会话+时间段）
  const replyCache = {};
  function getReplyByTime(convId, ts) {
    if (!convId || !ts) return null;
    const key = convId + ':' + ts;
    if (replyCache[key] !== undefined) return replyCache[key];
    // 在事件时间前后 5 秒内找 reply
    const r = sqlite.prepare(`
      SELECT reply_text FROM replies
      WHERE conversation_id = ?
        AND created_at BETWEEN datetime(?, '-5 seconds') AND datetime(?, '+5 seconds')
      LIMIT 1
    `).get(convId, ts, ts);
    replyCache[key] = r?.reply_text || null;
    return replyCache[key];
  }

  return paged.map(e => {
    const peer = e.dir === 'out' ? e.to_address : e.from_address;

    // 优先从 txid JOIN 取内容
    let content = e.msg_content || e.reply_content || null;

    // 回退：对 out 的 comm/text 事件，按时间从 replies 补
    if (!content && e.dir === 'out' && ['comm', 'comm_sent', 'text'].includes(e.event_type)) {
      const convId = getConvId(agentAddress, peer);
      content = getReplyByTime(convId, e.ts);
    }
    if (!content && e.payload) {
      try {
        const p = JSON.parse(e.payload);
        content = p.message || p.text || p.content || p.body || null;
      } catch {}
      if (!content && e.payload.length > 0 && e.payload.length < 500 && !e.payload.startsWith('{')) {
        content = e.payload;
      }
    }

    return {
      dir: e.dir,
      type: e.event_type,
      peer: peer || null,
      peer_name: nameMap[peer] || null,
      ts: e.ts,
      txid: e.txid || null,
      content: content,
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
 */
export function getMergedContacts(agentAddress) {
  const ceStats = getActivityByPeer(agentAddress);
  const ceMap = {};
  for (const s of ceStats) ceMap[s.peer] = s;

  const relations = sqlite.prepare(`
    SELECT rs.peer_address as peer, rs.status, rs.trust_level, rs.handshake_observed_at, rs.handshake_accepted_at, rs.updated_at,
      i.id as identity_id, i.display_name, i.tags, i.notes, i.card_entity_type, i.card_summary
    FROM relation_states rs
    LEFT JOIN identities i ON i.address = rs.peer_address
    WHERE rs.local_address = ?
  `).all(agentAddress);

  const rsMap = {};
  for (const r of relations) rsMap[r.peer] = r;

  const allPeers = new Set([...Object.keys(ceMap), ...Object.keys(rsMap)]);
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
      is_local: ce.is_local !== undefined ? ce.is_local : isLocal(peer),
    });
  }

  merged.sort((a, b) => (b.last_ts || '').localeCompare(a.last_ts || ''));
  return merged;
}
