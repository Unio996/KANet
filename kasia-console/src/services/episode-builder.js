/**
 * Episode Builder — 对话故事线聚合
 *
 * 将离散的 chain_events + exchange_offers + messages 聚合为"对话故事线"。
 * (NWT N14 Phase β Step 2 sub#1, 5/18: OTC mm_orders deprecated, exchange_offers = single source)
 * 每个 episode = 一段有起止的交互（交易、握手、对话）。
 *
 * 不修改底层数据表，纯查询时聚合。
 */

import { sqlite } from '../db/client.js';

/**
 * 构建指定 Agent 的 episode 列表。
 *
 * @param {string} agentAddress — Agent 的 Kaspa 地址
 * @param {object} opts
 * @param {number} opts.limit — 最多返回多少个 episode (default 30)
 * @param {string} opts.status — 筛选: 'active' | 'completed' | 'all' (default 'all')
 * @returns {Array<Episode>}
 */
export function buildEpisodes(agentAddress, { limit = 30, status = 'all' } = {}) {
  const episodes = [];

  // ── 1. Trade episodes (from exchange_offers, NWT N14 Phase β Step 2 sub#1) ──
  const tradeEpisodes = _buildTradeEpisodes(agentAddress, limit, status);
  episodes.push(...tradeEpisodes);

  // ── 2. Social episodes (handshakes + conversations not linked to trades) ──
  const socialEpisodes = _buildSocialEpisodes(agentAddress, limit);
  episodes.push(...socialEpisodes);

  // Sort by most recent activity, in_progress first
  episodes.sort((a, b) => {
    // in_progress/disputed before completed
    const aActive = a.status === 'in_progress' || a.status === 'disputed' ? 0 : 1;
    const bActive = b.status === 'in_progress' || b.status === 'disputed' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    // Then by time descending
    return new Date(b.ended_at || b.started_at).getTime() - new Date(a.ended_at || a.started_at).getTime();
  });

  return episodes.slice(0, limit);
}

// ── Trade episodes ────────────────────────────────────────────

const TERMINAL_TRADE = new Set(['completed', 'cancelled', 'expired', 'resolved', 'escalated']);

function _buildTradeEpisodes(agentAddress, limit, statusFilter) {
  // NWT N14 Phase β Step 2 sub#1: 改 exchange_offers (OTC mm_orders deprecated).
  // SQL alias 把 exchange_offers schema 映射成 _orderToEpisode 期望的 order shape, downstream 不动.
  // - side 从 give_asset 推 (give KAS = sell, 否则 buy)
  // - peer_address 是另一方 (maker = me → peer = taker, taker = me → peer = maker)
  // - kas_amount/usdt_amount 从 give/want_asset 抽
  // - paid_at ≈ matched_at (exchange protocol matched → verifying → delivering 不分 paid checkpoint)
  // - verified_at ≈ verifying_started_at, delivered_at ≈ delivering_at
  // - cancel_reason 没直接 column, 留 null
  let query = `
    SELECT
      o.id,
      o.maker AS agent_address,
      CASE WHEN o.maker = ? THEN o.taker ELSE o.maker END AS peer_address,
      i.display_name AS peer_name,
      CASE WHEN UPPER(o.give_asset) = 'KAS' THEN 'sell' ELSE 'buy' END AS side,
      o.protocol_status AS status,
      CASE WHEN UPPER(o.give_asset) = 'KAS' THEN CAST(o.give_amount AS REAL)
           WHEN UPPER(o.want_asset) = 'KAS' THEN CAST(o.want_amount AS REAL) ELSE 0 END AS kas_amount,
      CASE WHEN UPPER(o.give_asset) LIKE 'USD%' THEN CAST(o.give_amount AS REAL)
           WHEN UPPER(o.want_asset) LIKE 'USD%' THEN CAST(o.want_amount AS REAL) ELSE 0 END AS usdt_amount,
      CASE WHEN UPPER(o.give_asset) = 'KAS' AND CAST(o.give_amount AS REAL) > 0
              THEN CAST(o.want_amount AS REAL) / CAST(o.give_amount AS REAL)
           WHEN UPPER(o.want_asset) = 'KAS' AND CAST(o.want_amount AS REAL) > 0
              THEN CAST(o.give_amount AS REAL) / CAST(o.want_amount AS REAL)
           ELSE NULL END AS price,
      o.taker_chain AS chain,
      o.created_at,
      o.matched_at AS accepted_at,
      o.matched_at AS paid_at,
      o.verifying_started_at AS verified_at,
      o.delivering_at AS delivered_at,
      o.completed_at,
      o.payment_tx AS payment_txhash,
      o.delivery_tx AS kas_txhash,
      NULL AS cancel_reason,
      NULL AS counterparty_order_id
    FROM exchange_offers o
    LEFT JOIN identities i
      ON i.address = (CASE WHEN o.maker = ? THEN o.taker ELSE o.maker END)
    WHERE (o.maker = ? OR o.taker = ?)
  `;
  const params = [agentAddress, agentAddress, agentAddress, agentAddress];

  if (statusFilter === 'active') {
    query += ` AND o.protocol_status NOT IN ('completed','cancelled','expired','timed_out','refunded','failed','disputed')`;
  } else if (statusFilter === 'completed') {
    query += ` AND o.protocol_status IN ('completed','cancelled','expired','timed_out','refunded','failed','disputed')`;
  }

  query += ` ORDER BY o.created_at DESC LIMIT ?`;
  params.push(limit);

  const orders = sqlite.prepare(query).all(...params);
  return orders.map(o => _orderToEpisode(o, agentAddress));
}

function _orderToEpisode(order, agentAddress) {
  const isBuyer = order.side === 'buy';
  const steps = [];

  // Preload decision reasons from execution_states
  const execReasons = {};
  if (order.id) {
    const execs = sqlite.prepare(
      'SELECT type, display_summary, source, status FROM execution_states WHERE order_id = ? ORDER BY created_at ASC'
    ).all(order.id);
    for (const e of execs) {
      // Map execution type → step type
      const stepType = { accept_order: 'handshake', pay_usdt: 'payment', verify_payment: 'verify', send_kas: 'transfer', publish_order: 'publish', cancel_order: 'cancelled' }[e.type];
      if (stepType && e.display_summary) {
        execReasons[stepType] = { reason: e.display_summary, source: e.source, execStatus: e.status };
      }
    }
  }

  // Step 1: Order created/published
  steps.push({
    type: 'publish',
    label: isBuyer ? `发布买入 ${order.kas_amount} KAS` : `发布卖出 ${order.kas_amount} KAS`,
    detail: `@ $${order.price} · ${(order.chain || 'bnb').toUpperCase()} 链`,
    ts: order.created_at,
    done: true,
  });

  // Step 2: Accepted
  if (order.accepted_at) {
    const peerShort = order.peer_address ? '...' + order.peer_address.slice(-8) : '';
    steps.push({
      type: 'handshake',
      label: `与 ${order.peer_name || peerShort} 达成意向`,
      detail: order.counterparty_order_id ? '双方订单已链接' : '',
      ts: order.accepted_at,
      done: true,
    });
  }

  // Step 3: Payment
  if (order.paid_at) {
    const usdtAmt = (order.usdt_amount || order.kas_amount * order.price).toFixed(2);
    if (isBuyer) {
      steps.push({
        type: 'payment',
        label: `支付 ${usdtAmt} USDT`,
        detail: order.payment_txhash
          ? `${(order.chain || 'bnb').toUpperCase()} 链 · TX ${order.payment_txhash.slice(0, 12)}...`
          : `${(order.chain || 'bnb').toUpperCase()} 链`,
        ts: order.paid_at,
        done: true,
        txhash: order.payment_txhash,
      });
    } else {
      steps.push({
        type: 'payment',
        label: `收到 ${usdtAmt} USDT`,
        detail: order.payment_txhash
          ? `${(order.chain || 'bnb').toUpperCase()} 链确认 · TX ${order.payment_txhash.slice(0, 12)}...`
          : `${(order.chain || 'bnb').toUpperCase()} 链`,
        ts: order.paid_at,
        done: true,
        txhash: order.payment_txhash,
      });
    }
  }

  // Step 4: Verified
  if (order.verified_at) {
    steps.push({
      type: 'verify',
      label: '链上验证通过',
      detail: '确认数达标',
      ts: order.verified_at,
      done: true,
    });
  }

  // Step 5: KAS delivered
  if (order.delivered_at || (order.completed_at && order.kas_txhash)) {
    if (isBuyer) {
      steps.push({
        type: 'transfer',
        label: `收到 ${order.kas_amount} KAS`,
        detail: order.kas_txhash ? `TX ${order.kas_txhash.slice(0, 12)}...` : '交割完成',
        ts: order.delivered_at || order.completed_at,
        done: true,
        txhash: order.kas_txhash,
      });
    } else {
      steps.push({
        type: 'transfer',
        label: `发出 ${order.kas_amount} KAS`,
        detail: order.kas_txhash ? `TX ${order.kas_txhash.slice(0, 12)}...` : '交割完成',
        ts: order.delivered_at || order.completed_at,
        done: true,
        txhash: order.kas_txhash,
      });
    }
  }

  // Terminal step
  if (order.status === 'completed' || order.status === 'resolved') {
    steps.push({
      type: 'complete',
      label: '交易完成',
      detail: '',
      ts: order.completed_at,
      done: true,
    });
  } else if (order.status === 'cancelled' || order.status === 'expired') {
    steps.push({
      type: 'cancelled',
      label: order.status === 'expired' ? '订单过期' : '订单取消',
      detail: order.cancel_reason || '',
      ts: order.completed_at,
      done: true,
    });
  } else if (order.status === 'disputed' || order.status === 'escalated') {
    steps.push({
      type: 'disputed',
      label: order.status === 'escalated' ? '已上报处理' : '争议中',
      detail: order.cancel_reason || '等待解决',
      ts: order.completed_at || new Date().toISOString(),
      done: false,
    });
  } else {
    // Still in progress — show what's next
    const nextStep = _nextTradeStep(order);
    if (nextStep) {
      steps.push({ ...nextStep, done: false });
    }
  }

  // Compute result
  let resultKas = null;
  if (TERMINAL_TRADE.has(order.status) && order.status !== 'cancelled' && order.status !== 'expired') {
    resultKas = isBuyer ? order.kas_amount : -order.kas_amount;
  }

  // Episode status
  let episodeStatus = 'in_progress';
  if (order.status === 'completed' || order.status === 'resolved') episodeStatus = 'completed';
  else if (order.status === 'cancelled' || order.status === 'expired') episodeStatus = 'cancelled';
  else if (order.status === 'disputed' || order.status === 'escalated') episodeStatus = 'disputed';

  // Inject decision reasons into steps
  for (const step of steps) {
    const r = execReasons[step.type];
    if (r) {
      step.reason = r.reason;
      step.reasonSource = r.source; // 'agent' / 'owner' / 'system'
    }
  }

  return {
    episode_id: order.id,
    episode_type: 'trade',
    counterparty_name: order.peer_name || null,
    counterparty_addr: order.peer_address,
    status: episodeStatus,
    side: order.side,
    kas_amount: order.kas_amount,
    price: order.price,
    result_kas: resultKas,
    started_at: order.created_at,
    ended_at: order.completed_at,
    order_status: order.status,
    steps,
  };
}

function _nextTradeStep(order) {
  const isBuyer = order.side === 'buy';
  switch (order.status) {
    case 'published':
      return { type: 'handshake', label: '等待对手方接受', detail: '', ts: null };
    case 'accepted':
      return isBuyer
        ? { type: 'payment', label: '等待支付 USDT', detail: '', ts: null }
        : { type: 'payment', label: '等待买方付款', detail: '', ts: null };
    case 'paying':
      return { type: 'payment', label: '付款进行中...', detail: '', ts: null };
    case 'paid':
      return { type: 'verify', label: '等待链上确认', detail: '', ts: null };
    case 'verified':
      return isBuyer
        ? { type: 'transfer', label: '等待卖方发送 KAS', detail: '', ts: null }
        : { type: 'transfer', label: `准备发送 ${order.kas_amount} KAS`, detail: '', ts: null };
    case 'delivering':
      return { type: 'complete', label: '交割中，即将完成', detail: '', ts: null };
    default:
      return null;
  }
}

// ── Episode detail (lazy-loaded per tab) ──────────────────────

/**
 * 获取 episode 的详细数据（通讯录/会话/凭证）。
 * 按需加载，不在 buildEpisodes 中返回。
 *
 * @param {string} orderId — mm_orders.id (trade episode) or social episode id
 * @param {string} agentAddress
 * @returns {{ profile, messages, evidence }}
 */
/**
 * @param {string} episodeId — mm_orders.id (trade) or 'social-xxx'
 * @param {string} agentAddress
 * @param {string} [peerAddress] — required for social episodes
 */
export function getEpisodeDetail(episodeId, agentAddress, peerAddress = null) {
  // Trade episode: look up order (NWT N14 Phase β Step 2 sub#1: exchange_offers, mm_orders deprecated)
  // shape alias to keep downstream _buildEvidence + _buildCounterpartyProfile compat.
  const order = episodeId ? sqlite.prepare(`
    SELECT
      id,
      maker AS agent_address,
      CASE WHEN maker IS NOT NULL THEN taker ELSE maker END AS peer_address,
      CASE WHEN UPPER(give_asset) = 'KAS' THEN 'sell' ELSE 'buy' END AS side,
      protocol_status AS status,
      CASE WHEN UPPER(give_asset) = 'KAS' THEN CAST(give_amount AS REAL)
           WHEN UPPER(want_asset) = 'KAS' THEN CAST(want_amount AS REAL) ELSE 0 END AS kas_amount,
      CASE WHEN UPPER(give_asset) LIKE 'USD%' THEN CAST(give_amount AS REAL)
           WHEN UPPER(want_asset) LIKE 'USD%' THEN CAST(want_amount AS REAL) ELSE 0 END AS usdt_amount,
      taker_chain AS chain,
      created_at,
      matched_at AS accepted_at,
      completed_at,
      payment_tx AS payment_txhash,
      delivery_tx AS kas_txhash
    FROM exchange_offers
    WHERE id = ?
  `).get(episodeId) : null;
  // peer_address logic: if I'm maker, peer = taker; if I'm taker, peer = maker
  if (order && order.agent_address === agentAddress) {
    // I'm maker, peer_address already set to taker by CASE above (since maker IS NOT NULL)
  } else if (order && order.peer_address === agentAddress) {
    // I'm taker, swap so peer_address is maker
    const tmp = order.agent_address;
    order.agent_address = order.peer_address;
    order.peer_address = tmp;
  }
  const resolvedPeer = order?.peer_address || peerAddress;

  if (!resolvedPeer) return { profile: null, messages: [], evidence: [] };

  const profile = _buildCounterpartyProfile(agentAddress, resolvedPeer);
  const messages = _buildMessages(agentAddress, resolvedPeer);
  const evidence = order ? _buildEvidence(order, agentAddress) : _buildSocialEvidence(agentAddress, resolvedPeer);

  return { profile, messages, evidence };
}

/**
 * 社交 episode 的链上凭证（握手 TX）
 */
function _buildSocialEvidence(agentAddress, peerAddress) {
  const events = sqlite.prepare(`
    SELECT txid, event_type, from_address, to_address, observed_at
    FROM chain_events
    WHERE event_type = 'handshake'
      AND ((from_address = ? AND to_address = ?) OR (from_address = ? AND to_address = ?))
      AND txid IS NOT NULL
    ORDER BY observed_at ASC
  `).all(agentAddress, peerAddress, peerAddress, agentAddress);

  return events.map(e => ({
    txhash: e.txid,
    type: 'handshake',
    description: e.from_address === agentAddress ? '你发起的握手' : '对方发起的握手',
    status: 'confirmed',
    ts: e.observed_at,
  }));
}

function _buildCounterpartyProfile(agentAddress, peerAddress) {
  if (!peerAddress) return null;

  // Display name
  const identity = sqlite.prepare('SELECT display_name FROM identities WHERE address = ?').get(peerAddress);

  // Relation state
  const relation = sqlite.prepare(
    'SELECT status, trust_level, handshake_observed_at FROM relation_states WHERE local_address = ? AND peer_address = ?'
  ).get(agentAddress, peerAddress);

  // Trade stats with this peer (NWT N14 Phase β Step 2 sub#1: exchange_offers, mm_orders deprecated)
  const tradeStats = sqlite.prepare(`
    SELECT
      COUNT(*) as trade_count,
      SUM(CASE WHEN protocol_status IN ('disputed') THEN 1 ELSE 0 END) as dispute_count,
      SUM(CASE WHEN protocol_status = 'completed'
               THEN CASE WHEN UPPER(give_asset) = 'KAS' THEN CAST(give_amount AS REAL)
                         WHEN UPPER(want_asset) = 'KAS' THEN CAST(want_amount AS REAL) ELSE 0 END
               ELSE 0 END) as total_volume
    FROM exchange_offers
    WHERE (maker = ? AND taker = ?) OR (maker = ? AND taker = ?)
  `).get(agentAddress, peerAddress, peerAddress, agentAddress);

  const disputeRate = tradeStats.trade_count > 0
    ? ((tradeStats.dispute_count / tradeStats.trade_count) * 100).toFixed(1)
    : '0.0';

  return {
    displayName: identity?.display_name || null,
    address: peerAddress,
    trustLevel: relation?.trust_level || 'stranger',
    relationStatus: relation?.status || 'none',
    tradeCount: tradeStats.trade_count || 0,
    disputeCount: tradeStats.dispute_count || 0,
    disputeRate: parseFloat(disputeRate),
    totalVolume: tradeStats.total_volume || 0,
    firstContact: relation?.handshake_observed_at || null,
  };
}

function _buildMessages(agentAddress, peerAddress) {
  if (!peerAddress) return [];

  // Get conversation messages between these two addresses
  // Messages are linked through identities → conversations → messages
  const rows = sqlite.prepare(`
    SELECT m.content_text, m.direction, m.message_type, m.received_at
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    JOIN identities li ON c.local_identity_id = li.id
    JOIN identities ri ON c.remote_identity_id = ri.id
    WHERE li.address = ? AND ri.address = ?
      AND m.message_type = 'text'
    ORDER BY m.received_at DESC
    LIMIT 30
  `).all(agentAddress, peerAddress);

  return rows.reverse().map(m => {
    // Try to extract plain text from JSON content
    let text = m.content_text || '';
    if (text.startsWith('{')) {
      try {
        const j = JSON.parse(text);
        text = j.label || j.summary || j.message || text;
      } catch { /* keep raw */ }
    }
    return {
      sender: m.direction === 'outbound' ? 'self' : 'peer',
      text: text.slice(0, 500),
      ts: m.received_at,
    };
  });
}

function _buildEvidence(order, agentAddress) {
  const evidence = [];

  // Payment evidence (USDT)
  if (order.payment_txhash) {
    evidence.push({
      txhash: order.payment_txhash,
      type: 'payment',
      description: `${(order.usdt_amount || 0).toFixed(2)} USDT 付款 (${(order.chain || 'bnb').toUpperCase()})`,
      status: 'confirmed',
      ts: order.paid_at,
    });
  } else if (['paid', 'verified', 'delivering', 'completed', 'disputed'].includes(order.status)) {
    evidence.push({
      txhash: null,
      type: 'payment',
      description: 'USDT 付款凭证',
      status: order.status === 'disputed' ? 'missing' : 'pending',
      ts: order.paid_at,
    });
  }

  // KAS delivery evidence
  if (order.kas_txhash) {
    evidence.push({
      txhash: order.kas_txhash,
      type: 'transfer',
      description: `${order.kas_amount} KAS 交割`,
      status: 'confirmed',
      ts: order.delivered_at || order.completed_at,
    });
  } else if (['delivering', 'completed', 'disputed'].includes(order.status)) {
    evidence.push({
      txhash: null,
      type: 'transfer',
      description: `${order.kas_amount} KAS 交割凭证`,
      status: order.status === 'disputed' ? 'missing' : 'pending',
      ts: null,
    });
  }

  // Chain events linked to this order
  const chainEvts = sqlite.prepare(
    "SELECT txid, event_type, from_address, to_address, observed_at FROM chain_events WHERE payload LIKE ? AND txid IS NOT NULL ORDER BY observed_at ASC"
  ).all(`%${order.id}%`);

  for (const ce of chainEvts) {
    // Skip if already covered by payment/kas txhash
    if (ce.txid === order.payment_txhash || ce.txid === order.kas_txhash) continue;
    evidence.push({
      txhash: ce.txid,
      type: ce.event_type,
      description: _eventDescription(ce),
      status: 'confirmed',
      ts: ce.observed_at,
    });
  }

  // ── Dispute conclusion (auto-generated) ──
  if (order.status === 'disputed' || order.status === 'escalated') {
    const hasPaymentProof = !!order.payment_txhash;
    const hasKasProof = !!order.kas_txhash;
    const isBuyer = order.side === 'buy';

    let conclusion;
    if (hasPaymentProof && hasKasProof) {
      conclusion = { level: 'success', text: '交易双方凭证均已验证，链上记录完整' };
    } else if (isBuyer && hasPaymentProof && !hasKasProof) {
      conclusion = { level: 'warning', text: '你已支付 USDT 且有链上凭证，但对方 KAS 交割凭证缺失。你持有完整证明。' };
    } else if (!isBuyer && hasKasProof && !hasPaymentProof) {
      conclusion = { level: 'warning', text: '你已发送 KAS 且有链上凭证，但对方 USDT 付款凭证缺失。你持有完整证明。' };
    } else if (!hasPaymentProof && !hasKasProof) {
      conclusion = { level: 'error', text: '双方均无链上凭证，无法自动判定。需人工介入。' };
    } else {
      conclusion = { level: 'neutral', text: '凭证状态不完整，建议核实链上记录。' };
    }
    evidence.push({ txhash: null, type: 'conclusion', description: conclusion.text, status: conclusion.level, ts: null });
  }

  return evidence;
}

function _eventDescription(ce) {
  const typeMap = { payment: '付款记录', kas_delivery: 'KAS 交割', payment_failed: '付款失败', verify_success: '验证成功', underpayment: '金额不足' };
  return typeMap[ce.event_type] || ce.event_type;
}

// ── Social episodes ───────────────────────────────────────────

function _buildSocialEpisodes(agentAddress, limit) {
  // Find recent handshakes not connected to any trade
  const handshakes = sqlite.prepare(`
    SELECT ce.txid, ce.from_address, ce.to_address, ce.observed_at,
      i.display_name AS peer_name,
      rs.status AS relation_status
    FROM chain_events ce
    LEFT JOIN identities i ON i.address = CASE
      WHEN ce.from_address = ? THEN ce.to_address
      ELSE ce.from_address END
    LEFT JOIN relation_states rs ON rs.local_address = ? AND rs.peer_address = CASE
      WHEN ce.from_address = ? THEN ce.to_address
      ELSE ce.from_address END
    WHERE ce.event_type = 'handshake'
      AND (ce.from_address = ? OR ce.to_address = ?)
    ORDER BY ce.observed_at DESC
    LIMIT ?
  `).all(agentAddress, agentAddress, agentAddress, agentAddress, agentAddress, limit);

  // Group by counterparty, take the latest handshake per peer
  const seen = new Set();
  const episodes = [];

  for (const hs of handshakes) {
    const peerAddr = hs.from_address === agentAddress ? hs.to_address : hs.from_address;
    if (!peerAddr || seen.has(peerAddr)) continue;
    seen.add(peerAddr);

    // Count messages with this peer
    const msgCount = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM chain_events
      WHERE event_type IN ('text', 'comm')
        AND ((from_address = ? AND to_address = ?) OR (from_address = ? AND to_address = ?))
    `).get(agentAddress, peerAddr, peerAddr, agentAddress)?.cnt || 0;

    const steps = [];

    // Step 1: Handshake
    const isInbound = hs.to_address === agentAddress;
    steps.push({
      type: 'handshake',
      label: isInbound ? `${hs.peer_name || '对方'} 向你发起握手` : `你向 ${hs.peer_name || '对方'} 发起握手`,
      detail: hs.relation_status === 'active' ? '已建立信任连接' : `状态: ${hs.relation_status || 'unknown'}`,
      ts: hs.observed_at,
      done: true,
      txhash: hs.txid,
    });

    // Step 2: Messages summary
    if (msgCount > 0) {
      // Get latest message time
      const latest = sqlite.prepare(`
        SELECT observed_at FROM chain_events
        WHERE event_type IN ('text', 'comm')
          AND ((from_address = ? AND to_address = ?) OR (from_address = ? AND to_address = ?))
        ORDER BY observed_at DESC LIMIT 1
      `).get(agentAddress, peerAddr, peerAddr, agentAddress);

      steps.push({
        type: 'negotiate',
        label: `${msgCount} 条消息交互`,
        detail: '',
        ts: latest?.observed_at,
        done: true,
      });
    }

    // Check for any trade with this peer (NWT N14 Phase β Step 2 sub#1: exchange_offers)
    const tradeWithPeer = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM exchange_offers
      WHERE (maker = ? AND taker = ?) OR (maker = ? AND taker = ?)
    `).get(agentAddress, peerAddr, peerAddr, agentAddress)?.cnt || 0;

    if (tradeWithPeer > 0) continue; // Skip — already covered by trade episodes

    episodes.push({
      episode_id: `social-${hs.txid?.slice(0, 12)}`,
      episode_type: 'social',
      counterparty_name: hs.peer_name || null,
      counterparty_addr: peerAddr,
      status: hs.relation_status === 'active' ? 'completed' : 'in_progress',
      side: null,
      kas_amount: null,
      price: null,
      result_kas: null,
      started_at: hs.observed_at,
      ended_at: msgCount > 0 ? steps[steps.length - 1].ts : hs.observed_at,
      order_status: null,
      steps,
    });
  }

  return episodes;
}

// ── Mind Summary: structured data for Agent reflection + context ──────

/**
 * Build a concise summary of this Agent's episode history for Mind injection.
 * Used by Context Builder for reflect/proactive/reactive.
 *
 * @param {string} agentAddress
 * @param {object} opts
 * @param {number} opts.days — how far back to look (default 7)
 * @param {string} [opts.peerAddress] — if set, only episodes with this peer
 * @returns {{ performance, activeTrades, peerSummary }}
 */
export function buildMindSummary(agentAddress, { days = 7, peerAddress = null } = {}) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // ── Trade performance (NWT N14 Phase β Step 2 sub#1: exchange_offers, mm_orders deprecated) ──
  // Derive shape: side from give_asset, kas_amount/price from give/want, peer from maker/taker swap.
  const trades = sqlite.prepare(`
    SELECT
      protocol_status AS status,
      CASE WHEN UPPER(give_asset) = 'KAS' THEN 'sell' ELSE 'buy' END AS side,
      CASE WHEN UPPER(give_asset) = 'KAS' THEN CAST(give_amount AS REAL)
           WHEN UPPER(want_asset) = 'KAS' THEN CAST(want_amount AS REAL) ELSE 0 END AS kas_amount,
      CASE WHEN UPPER(give_asset) = 'KAS' AND CAST(give_amount AS REAL) > 0
              THEN CAST(want_amount AS REAL) / CAST(give_amount AS REAL)
           WHEN UPPER(want_asset) = 'KAS' AND CAST(want_amount AS REAL) > 0
              THEN CAST(give_amount AS REAL) / CAST(want_amount AS REAL)
           ELSE NULL END AS price,
      taker_chain AS chain,
      CASE WHEN maker = ? THEN taker ELSE maker END AS peer_address,
      created_at,
      completed_at,
      (SELECT display_name FROM identities WHERE address = (CASE WHEN maker = ? THEN taker ELSE maker END)) AS peer_name
    FROM exchange_offers
    WHERE (maker = ? OR taker = ?) AND created_at > ?
    ${peerAddress ? 'AND ((maker = ? AND taker = ?) OR (maker = ? AND taker = ?))' : ''}
    ORDER BY created_at DESC LIMIT 50
  `).all(...(peerAddress
    ? [agentAddress, agentAddress, agentAddress, agentAddress, since, agentAddress, peerAddress, peerAddress, agentAddress]
    : [agentAddress, agentAddress, agentAddress, agentAddress, since]));

  let completed = 0, disputed = 0, cancelled = 0, inProgress = 0;
  let totalVolume = 0;
  const counterparties = {};
  const chainUsage = {};

  for (const t of trades) {
    if (t.status === 'completed' || t.status === 'resolved') { completed++; totalVolume += t.kas_amount || 0; }
    else if (t.status === 'disputed' || t.status === 'escalated') disputed++;
    else if (t.status === 'cancelled' || t.status === 'expired') cancelled++;
    else inProgress++;

    if (t.chain) chainUsage[t.chain] = (chainUsage[t.chain] || 0) + 1;
    if (t.peer_address) {
      const key = t.peer_address;
      if (!counterparties[key]) counterparties[key] = { name: t.peer_name, completed: 0, disputed: 0, volume: 0 };
      if (t.status === 'completed' || t.status === 'resolved') { counterparties[key].completed++; counterparties[key].volume += t.kas_amount || 0; }
      if (t.status === 'disputed' || t.status === 'escalated') counterparties[key].disputed++;
    }
  }

  // ── Active / disputed trades ──
  const activeTrades = trades
    .filter(t => !['completed', 'resolved', 'cancelled', 'expired'].includes(t.status))
    .map(t => ({
      status: t.status,
      side: t.side,
      amount: t.kas_amount,
      price: t.price,
      peer: t.peer_name || t.peer_address?.slice(-12),
      chain: t.chain,
      started: t.created_at?.slice(0, 16),
    }));

  // ── Peer summary (for reactive context) ──
  let peerSummary = null;
  if (peerAddress && counterparties[peerAddress]) {
    const cp = counterparties[peerAddress];
    peerSummary = {
      name: cp.name,
      trades: cp.completed + cp.disputed,
      completed: cp.completed,
      disputed: cp.disputed,
      disputeRate: cp.completed + cp.disputed > 0
        ? Math.round(cp.disputed / (cp.completed + cp.disputed) * 100)
        : 0,
      totalVolume: cp.volume,
    };
  }

  // ── Top counterparties (for reflect) ──
  const topCounterparties = Object.entries(counterparties)
    .map(([addr, d]) => ({ addr: addr.slice(-12), ...d }))
    .sort((a, b) => (b.completed + b.disputed) - (a.completed + a.disputed))
    .slice(0, 5);

  return {
    performance: {
      days,
      total: trades.length,
      completed, disputed, cancelled, inProgress,
      totalVolume: Math.round(totalVolume * 100) / 100,
      chainUsage,
    },
    activeTrades,
    peerSummary,
    topCounterparties,
  };
}
