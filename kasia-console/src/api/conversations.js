import { listConversations, getConversation, getDashboardStats } from '../data/state/conversations.js';
import { updateIdentity, getIdentityById, getIdentityByAddress, upsertIdentity, setTrustLevel, listIdentities } from '../data/settings/identities.js';
import { getMessagesByConversation } from '../data/state/messages.js';
import { getRepliesByConversation } from '../data/state/replies.js';
import { getTxsByConversation } from '../data/state/tx-records.js';
import { getEventStats, listEvents } from '../data/state/events.js';
import { listRelayNodes } from '../data/settings/relay-nodes.js';
import { fmtDate, relativeTime } from '../lib/time.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import { sqlite } from '../db/client.js';
import { getReply, resolveRelayNodeId } from '../services/mind-manager.js';
import { buildEpisodes, getEpisodeDetail, buildMindSummary } from '../services/episode-builder.js';

export async function registerConversationRoutes(fastify) {
  // Home → welcome if no agents, otherwise chat (partner-first, not dashboard-first)
  fastify.get('/', async (request, reply) => {
    const hasAgents = listRelayNodes().length > 0;
    return reply.redirect(hasAgents ? '/chat' : '/welcome');
  });

  // Agent profile page — v2 (design system)
  fastify.get('/agent', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const tab = request.query.tab || '';
    return reply.view('agent-v2', { title: '我的 Agent', t, lang, dir, langs, _page: 'agent', _agentTab: tab });
  });

  // Agent profile page — legacy (for rollback if needed)
  fastify.get('/agent-legacy', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    return reply.view('agent', { title: '我的 Agent', t, lang, dir, langs });
  });

  // Agent profile API — returns all relay agents with card/stats
  // v28: reads from relation_states (unified protocol state layer)
  fastify.get('/api/agent/profile', async (request, reply) => {
    const relays = listRelayNodes();
    const agents = [];
    for (const r of relays) {
      const identity = sqlite.prepare('SELECT * FROM identities WHERE address = ?').get(r.address);

      // Stats from relation_states (single source of truth)
      const relStats = sqlite.prepare(
        'SELECT status, COUNT(*) as c FROM relation_states WHERE local_address = ? GROUP BY status'
      ).all(r.address);
      const statusMap = {};
      relStats.forEach(s => statusMap[s.status] = s.c);

      const contactCount = Object.values(statusMap).reduce((s, v) => s + v, 0);
      const handshakeCount = (statusMap.active || 0) + (statusMap.confirmed || 0) + (statusMap.accepted || 0);
      const interactionCount = sqlite.prepare(
        'SELECT COUNT(*) as c FROM chain_events WHERE from_address = ? OR to_address = ?'
      ).get(r.address, r.address)?.c || 0;
      const firstActive = sqlite.prepare(
        'SELECT MIN(handshake_observed_at) as t FROM relation_states WHERE local_address = ?'
      ).get(r.address)?.t || null;
      const lastActive = sqlite.prepare(
        'SELECT MAX(updated_at) as t FROM relation_states WHERE local_address = ?'
      ).get(r.address)?.t || null;

      agents.push({
        id: r.id,
        name: r.name,
        address: r.address,
        card: identity ? {
          mode: identity.card_mode,
          entityType: identity.card_entity_type,
          skills: identity.card_skills_json ? JSON.parse(identity.card_skills_json) : [],
          summary: identity.card_summary,
          version: identity.card_version,
        } : null,
        stats: { contactCount, interactionCount, handshakeCount, firstActive, lastActive, ...statusMap },
      });
    }
    return agents;
  });

  // Agent Mind reply — unified entry point for relay and external callers.
  // All AI replies go through mind-manager. No adapter fallback.
  fastify.post('/api/agent/reply', async (request, reply) => {
    const { relayNodeId, peer, message, txId, channel } = request.body || {};
    if (!peer || !message) return reply.code(400).send({ error: 'peer and message required' });

    const resolved = resolveRelayNodeId(relayNodeId);
    const aiReply = await getReply(resolved, peer, message, channel);
    return reply.send({ reply: aiReply || '' });
  });

  // Agent Mind skills query — returns active mind skills for a specific account
  fastify.get('/api/agent/mind-skills', async (request, reply) => {
    const { relay_node_id } = request.query;
    let skills;
    if (relay_node_id) {
      // Per-account: return skills owned by this account
      skills = sqlite.prepare(
        "SELECT name, display_name, description FROM skills WHERE action_type = 'mind' AND status = 'active' AND relay_node_id = ?"
      ).all(relay_node_id);
    } else {
      // Fallback: return all active mind skills (backward compat)
      skills = sqlite.prepare(
        "SELECT name, display_name, description FROM skills WHERE action_type = 'mind' AND status = 'active'"
      ).all();
    }
    return reply.send(skills);
  });

  // Chat history + peer profile for Mind context — returns recent conversation with a peer
  fastify.get('/api/agent/peer-context', async (request, reply) => {
    const { my_address, peer_address, limit: rawLimit } = request.query;
    if (!peer_address) return reply.code(400).send({ error: 'peer_address required' });
    const limit = Math.min(parseInt(rawLimit) || 20, 50);

    // 1. Peer identity (who are they?)
    const identity = sqlite.prepare(
      'SELECT address, display_name, card_entity_type, card_skills_json, card_summary, card_mode, trust_level, tags, notes FROM identities WHERE address = ?'
    ).get(peer_address);

    // 2. Recent chat history (messages + replies interleaved)
    //    Find conversation between my_address and peer_address
    let chatHistory = [];
    if (my_address) {
      const conv = sqlite.prepare(`
        SELECT c.id FROM conversations c
        JOIN identities li ON c.local_identity_id = li.id
        JOIN identities ri ON c.remote_identity_id = ri.id
        WHERE li.address = ? AND ri.address = ?
        ORDER BY c.updated_at DESC LIMIT 1
      `).get(my_address, peer_address);

      if (conv) {
        const messages = sqlite.prepare(`
          SELECT 'in' as dir, content_text as text, received_at as ts
          FROM messages WHERE conversation_id = ? AND content_text != ''
          ORDER BY received_at DESC LIMIT ?
        `).all(conv.id, limit);

        const replies = sqlite.prepare(`
          SELECT 'out' as dir, reply_text as text, created_at as ts
          FROM replies WHERE conversation_id = ? AND reply_text != ''
          ORDER BY created_at DESC LIMIT ?
        `).all(conv.id, limit);

        chatHistory = [...messages, ...replies]
          .sort((a, b) => new Date(a.ts) - new Date(b.ts))
          .slice(-limit);
      }
    }

    // 3. Broadcast history (if peer appeared in broadcast channels)
    const broadcasts = sqlite.prepare(`
      SELECT sender_address, content, created_at as ts
      FROM broadcast_messages
      WHERE sender_address = ? OR sender_address = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(peer_address, my_address || '', Math.min(limit, 10));

    // 4. Relation status from relation_states (唯一真相源)
    let connectionStatus = null;
    if (my_address) {
      const rs = sqlite.prepare(
        'SELECT status FROM relation_states WHERE local_address = ? AND peer_address = ?'
      ).get(my_address, peer_address);
      connectionStatus = rs?.status || null;
    }

    return reply.send({
      peer: identity ? {
        address: identity.address,
        name: identity.display_name,
        entityType: identity.card_entity_type,
        skills: identity.card_skills_json ? JSON.parse(identity.card_skills_json) : null,
        summary: identity.card_summary,
        mode: identity.card_mode,
        trustLevel: identity.trust_level,
        tags: identity.tags,
        notes: identity.notes,
        connectionStatus,
      } : { address: peer_address, connectionStatus },
      chatHistory,
      recentBroadcasts: broadcasts.reverse(),
    });
  });

  // Agent Mind event reporting — public, no auth (local agent-mind process)
  fastify.post('/api/agent/mind-event', async (request, reply) => {
    const { agentName, eventType, summary, payload } = request.body || {};
    if (!eventType || !summary) return reply.code(400).send({ error: 'eventType and summary required' });

    const { insertEvent } = await import('../data/state/events.js');
    const eventId = await insertEvent({
      eventScope: 'mind',
      eventType,
      source: agentName || 'agent-mind',
      level: 'info',
      summary,
      payloadJson: payload || null,
    });
    return reply.send({ ok: true, eventId });
  });

  // Query recent Mind skill events
  fastify.get('/api/agent/mind-events', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit) || 20, 100);
    const rows = sqlite.prepare(`
      SELECT event_type, source, summary, payload_json, created_at
      FROM events WHERE event_scope = 'mind'
      ORDER BY created_at DESC LIMIT ?
    `).all(limit);
    return reply.send(rows);
  });

  // Agent skill invocation counter — called by Mind after gatherAll()
  fastify.post('/api/agent/skill-invoked', async (request, reply) => {
    const { names, relayNodeId } = request.body || {};
    if (!Array.isArray(names) || names.length === 0) return reply.send({ ok: true });
    const now = new Date().toISOString();
    const stmt = sqlite.prepare(
      `UPDATE skills SET invoke_count = invoke_count + 1, last_invoked_at = ? WHERE name = ? AND (relay_node_id = ? OR relay_node_id IS NULL) AND status = 'active'`
    );
    for (const name of names) {
      stmt.run(now, name, relayNodeId || null);
    }
    return reply.send({ ok: true, updated: names.length });
  });

  // Agent spending summary — breakdown of KAS costs
  fastify.get('/api/agent/spending', async (request, reply) => {
    const { relay_node_id, days = '1' } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });

    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relay_node_id);
    if (!relay) return reply.code(404).send({ error: 'Agent not found' });
    const addr = relay.address;
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    // Count activities — handshakes from relation_states, comms from interaction_records
    const handshakes = sqlite.prepare(
      "SELECT COUNT(*) as c FROM relation_states WHERE local_address = ? AND handshake_accepted_at > ?"
    ).get(addr, since);
    const comms = sqlite.prepare(
      "SELECT COUNT(*) as c FROM interaction_records WHERE address_a = ? AND interaction_type = 'comm' AND occurred_at > ?"
    ).get(addr, since);
    const bcasts = sqlite.prepare(
      "SELECT COUNT(*) as c FROM broadcast_messages WHERE sender_address = ? AND created_at > ?"
    ).get(addr, since);

    // Actual TX fees from chain (real spend, not estimates)
    const txFees = sqlite.prepare(`
      SELECT t.txid, t.fee, t.created_at, m.message_type
      FROM tx_records t
      LEFT JOIN messages m ON t.trace_id = m.trace_id
      WHERE t.direction = 'outbound' AND t.created_at > ?
        AND t.conversation_id IN (
          SELECT c.id FROM conversations c
          JOIN identities i ON c.local_identity_id = i.id WHERE i.address = ?
        )
      ORDER BY t.created_at DESC LIMIT 50
    `).all(since, addr);

    const totalFee = txFees.reduce((s, t) => s + (parseFloat(t.fee) || 0), 0);

    return reply.send({
      days: parseInt(days),
      breakdown: {
        handshakes: { count: handshakes?.c || 0 },
        messages: { count: comms?.c || 0 },
        broadcasts: { count: bcasts?.c || 0 },
      },
      total: totalFee,
      txCount: txFees.length,
      recentTxs: txFees.slice(0, 20),
    });
  });

  // Agent TX history — returns tx_records associated with a relay node
  fastify.get('/api/agent/tx-history', async (request, reply) => {
    const { relay_node_id } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    const limit = Math.min(parseInt(request.query.limit) || 20, 100);

    const rows = sqlite.prepare(`
      SELECT t.id, t.trace_id, t.conversation_id, t.direction, t.network,
             t.txid, t.amount, t.fee, t.confirmations, t.status,
             t.created_at, t.updated_at,
             m.content_text AS related_message
      FROM tx_records t
      LEFT JOIN messages m ON t.trace_id = m.trace_id
      WHERE t.conversation_id IN (
        SELECT c.id FROM conversations c
        JOIN identities i ON c.local_identity_id = i.id
        WHERE i.address = (SELECT address FROM relay_nodes WHERE id = ?)
      )
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(relay_node_id, limit);

    return reply.send(rows);
  });

  // Episode history — "对话故事线"聚合视图
  fastify.get('/api/history/episodes', async (request, reply) => {
    const { relay_node_id, status } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });

    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relay_node_id);
    if (!relay) return reply.code(404).send({ error: 'relay not found' });

    const limit = Math.min(parseInt(request.query.limit) || 30, 100);
    const episodes = buildEpisodes(relay.address, { limit, status: status || 'all' });
    return reply.send(episodes);
  });

  // Episode detail — lazy-load per tab (通讯录/会话/凭证)
  // Supports both trade episodes (order_id) and social episodes (peer_address)
  fastify.get('/api/history/episode-detail', async (request, reply) => {
    const { order_id, peer_address, relay_node_id } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    if (!order_id && !peer_address) return reply.code(400).send({ error: 'order_id or peer_address required' });

    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relay_node_id);
    if (!relay) return reply.code(404).send({ error: 'relay not found' });

    const detail = getEpisodeDetail(order_id || null, relay.address, peer_address || null);
    return reply.send(detail);
  });

  // Mind summary — structured episode data for Agent reflection + context
  fastify.get('/api/history/mind-summary', async (request, reply) => {
    const { relay_node_id, peer_address, days } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });

    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relay_node_id);
    if (!relay) return reply.code(404).send({ error: 'relay not found' });

    const summary = buildMindSummary(relay.address, {
      days: parseInt(days) || 7,
      peerAddress: peer_address || null,
    });
    return reply.send(summary);
  });

  // ── NEW PAGES: contacts / story / graph ──────────────────────────────

  // API: contacts with episode summary (merged view)
  fastify.get('/api/contacts/list', async (request, reply) => {
    const { relay_node_id } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });

    const relay = sqlite.prepare('SELECT address, name FROM relay_nodes WHERE id = ?').get(relay_node_id);
    if (!relay) return reply.code(404).send({ error: 'relay not found' });

    // Get relations (message counts from chain_events, not stored in relation_states)
    const relations = sqlite.prepare(`
      SELECT rs.peer_address, rs.status, rs.trust_level, rs.handshake_accepted_at, rs.updated_at,
        i.id as identity_id, i.display_name, i.card_entity_type, i.card_summary, i.tags, i.notes
      FROM relation_states rs
      LEFT JOIN identities i ON i.address = rs.peer_address
      WHERE rs.local_address = ?
      ORDER BY rs.updated_at DESC
    `).all(relay.address);

    // Message counts per peer (from chain_events — from_address/to_address)
    const msgSent = sqlite.prepare(`
      SELECT to_address as peer, COUNT(*) as c FROM chain_events
      WHERE from_address = ? AND event_type IN ('comm','comm_sent') AND to_address IS NOT NULL
      GROUP BY to_address
    `).all(relay.address);
    const msgRecv = sqlite.prepare(`
      SELECT from_address as peer, COUNT(*) as c FROM chain_events
      WHERE to_address = ? AND event_type IN ('comm','comm_received') AND from_address IS NOT NULL
      GROUP BY from_address
    `).all(relay.address);
    const msgMap = {};
    for (const m of msgSent) { if (!msgMap[m.peer]) msgMap[m.peer] = {}; msgMap[m.peer].sent = m.c; }
    for (const m of msgRecv) { if (!msgMap[m.peer]) msgMap[m.peer] = {}; msgMap[m.peer].received = m.c; }

    // Get trade stats per peer
    const tradeStats = sqlite.prepare(`
      SELECT peer_address,
        COUNT(*) as trade_count,
        SUM(CASE WHEN status IN ('completed','resolved') THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status IN ('disputed','escalated') THEN 1 ELSE 0 END) as disputed,
        SUM(CASE WHEN status IN ('completed','resolved') THEN kas_amount ELSE 0 END) as total_volume,
        MAX(created_at) as last_trade_at
      FROM mm_orders
      WHERE agent_address = ? AND peer_address IS NOT NULL
      GROUP BY peer_address
    `).all(relay.address);

    const tradeMap = {};
    for (const t of tradeStats) tradeMap[t.peer_address] = t;

    const contacts = relations.map(r => {
      const trades = tradeMap[r.peer_address] || {};
      const msgs = msgMap[r.peer_address] || {};
      return {
        id: r.identity_id || null,
        address: r.peer_address,
        name: r.display_name || null,
        status: r.status,
        trustLevel: r.trust_level || 'normal',
        entityType: r.card_entity_type,
        summary: r.card_summary,
        tags: r.tags || '',
        notes: r.notes || '',
        msgsSent: msgs.sent || 0,
        msgsReceived: msgs.received || 0,
        connectedAt: r.handshake_accepted_at,
        tradeCount: trades.trade_count || 0,
        tradeCompleted: trades.completed || 0,
        tradeDisputed: trades.disputed || 0,
        tradeVolume: trades.total_volume || 0,
        lastTradeAt: trades.last_trade_at,
      };
    });

    return reply.send(contacts);
  });

  // --- Contacts management JSON APIs ---

  const TRUST_LEVELS = ['owner', 'recommended', 'normal', 'blocked'];

  // Update contact: display_name, tags, trust_level, notes
  fastify.post('/api/contacts/update', async (request, reply) => {
    const { id, display_name, tags, trust_level, notes } = request.body || {};
    if (!id) return reply.code(400).send({ ok: false, error: 'id required' });
    await updateIdentity(id, {
      displayName: display_name,
      notes,
      tags,
      trustLevel: TRUST_LEVELS.includes(trust_level) ? trust_level : undefined,
    });
    // Sync trust_level to relation_states (the authoritative source for contacts list)
    if (TRUST_LEVELS.includes(trust_level)) {
      const identity = await getIdentityById(id);
      if (identity?.address) {
        sqlite.prepare('UPDATE relation_states SET trust_level = ? WHERE peer_address = ?')
          .run(trust_level, identity.address);
      }
    }
    return reply.send({ ok: true });
  });

  // Add contact manually
  fastify.post('/api/contacts/add', async (request, reply) => {
    const { address, display_name, trust_level, notes } = request.body || {};
    if (!address?.trim()) return reply.code(400).send({ ok: false, error: 'address required' });
    await upsertIdentity({
      network: 'mainnet',
      address: address.trim(),
      displayName: display_name?.trim() || null,
      identityType: 'remote',
    });
    const identity = await getIdentityByAddress('mainnet', address.trim());
    if (identity) {
      const updates = {};
      if (notes?.trim()) updates.notes = notes.trim();
      if (TRUST_LEVELS.includes(trust_level)) updates.trustLevel = trust_level;
      if (Object.keys(updates).length) await updateIdentity(identity.id, updates);
    }
    return reply.send({ ok: true, id: identity?.id });
  });

  // Toggle block/unblock
  fastify.post('/api/contacts/block', async (request, reply) => {
    const { id } = request.body || {};
    if (!id) return reply.code(400).send({ ok: false, error: 'id required' });
    const identity = await getIdentityById(id);
    if (!identity) return reply.code(404).send({ ok: false, error: 'not found' });
    const newLevel = identity.trust_level === 'blocked' ? 'normal' : 'blocked';
    await setTrustLevel(id, newLevel);
    // Sync to relation_states
    if (identity.address) {
      sqlite.prepare('UPDATE relation_states SET trust_level = ? WHERE peer_address = ?')
        .run(newLevel, identity.address);
    }
    return reply.send({ ok: true, trust_level: newLevel });
  });

  // Get all tags with counts
  fastify.get('/api/contacts/tags', async (request, reply) => {
    const all = await listIdentities();
    const tagCounts = {};
    all.forEach(i => {
      if (i.tags) i.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    });
    return reply.send(tagCounts);
  });

  // Delete a tag from all identities
  fastify.post('/api/contacts/tags/delete', async (request, reply) => {
    const { tag } = request.body || {};
    if (!tag?.trim()) return reply.code(400).send({ ok: false, error: 'tag required' });
    const target = tag.trim();
    const rows = sqlite.prepare("SELECT id, tags FROM identities WHERE tags LIKE ?").all(`%${target}%`);
    for (const row of rows) {
      const updated = row.tags.split(',').map(t => t.trim()).filter(t => t && t !== target).join(',');
      sqlite.prepare('UPDATE identities SET tags=? WHERE id=?').run(updated || null, row.id);
    }
    return reply.send({ ok: true });
  });

  // Rename a tag across all identities
  fastify.post('/api/contacts/tags/rename', async (request, reply) => {
    const { old_tag, new_tag } = request.body || {};
    if (!old_tag?.trim() || !new_tag?.trim()) return reply.code(400).send({ ok: false, error: 'old_tag and new_tag required' });
    const oldName = old_tag.trim();
    const newName = new_tag.trim().toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fff]/g, '');
    if (!newName || oldName === newName) return reply.send({ ok: false, error: 'no change' });
    const rows = sqlite.prepare("SELECT id, tags FROM identities WHERE tags LIKE ?").all(`%${oldName}%`);
    for (const row of rows) {
      const tags = row.tags.split(',').map(t => t.trim()).filter(Boolean);
      const updated = [...new Set(tags.map(t => t === oldName ? newName : t))].join(',');
      sqlite.prepare('UPDATE identities SET tags=? WHERE id=?').run(updated || null, row.id);
    }
    return reply.send({ ok: true });
  });

  // Page: /contacts
  fastify.get('/contacts', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const relayNodes = listRelayNodes();
    return reply.viewAsync('contacts', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', relayNodes, _page: 'contacts' });
  });

  // Page: /story
  fastify.get('/story', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const relayNodes = listRelayNodes();
    return reply.viewAsync('story', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', relayNodes, _page: 'story' });
  });

  // Page: /graph
  fastify.get('/graph', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const relayNodes = listRelayNodes();
    return reply.viewAsync('graph', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', relayNodes, _page: 'graph' });
  });

  // Legacy dashboard (keep for backward compat)
  fastify.get('/dashboard', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const stats = await getDashboardStats();
    const eventStats = await getEventStats();
    const recentEvents = await listEvents({ limit: 10 });
    return reply.view('dashboard', { stats, eventStats, recentEvents, fmtDate, relativeTime, title: 'Dashboard', t, lang, dir, langs });
  });

  // Find conversation by peer address (for Market → Chat jump)
  // Optional `local` param = our agent's address, to find the right perspective
  fastify.get('/api/conversations/find', async (request, reply) => {
    const { peer, local } = request.query;
    if (!peer) return reply.code(400).send({ error: 'peer address required' });

    let conv;
    if (local) {
      // Find conversation where OUR agent is local and peer is remote
      conv = sqlite.prepare(`
        SELECT c.id FROM conversations c
        JOIN identities li ON c.local_identity_id = li.id
        JOIN identities ri ON c.remote_identity_id = ri.id
        WHERE li.address = ? AND ri.address = ?
        ORDER BY c.updated_at DESC LIMIT 1
      `).get(local, peer);
    }

    // Fallback: any conversation where peer is remote
    if (!conv) {
      conv = sqlite.prepare(`
        SELECT c.id FROM conversations c
        JOIN identities ri ON c.remote_identity_id = ri.id
        WHERE ri.address = ?
        ORDER BY c.updated_at DESC LIMIT 1
      `).get(peer);
    }

    return reply.send({ convId: conv?.id || null, peer });
  });

  // Conversation list
  fastify.get('/conversations', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const { search = '', page = '1', account = '' } = request.query;
    const limit = 20;
    const offset = (parseInt(page) - 1) * limit;
    const relayNodes = listRelayNodes();
    // Get selected account's address for filtering
    let localAddress = null;
    if (account) {
      const node = relayNodes.find(r => r.id === account);
      if (node) localAddress = node.address;
    }
    const conversations = await listConversations({ limit, offset, search, localAddress });
    return reply.view('conversations', { conversations, relayNodes, selectedAccount: account, search, page: parseInt(page), fmtDate, relativeTime, title: 'Conversations', t, lang, dir, langs });
  });

  // Conversation detail
  fastify.get('/conversations/:id', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const conv = await getConversation(request.params.id);
    if (!conv) return reply.code(404).send('Not found');

    const messages = await getMessagesByConversation(conv.id);
    const replies = await getRepliesByConversation(conv.id);
    const txs = await getTxsByConversation(conv.id);

    // Build timeline: merge messages + replies + txs sorted by created_at
    const timeline = [
      ...messages.map(m => ({ ...m, _type: 'message' })),
      ...replies.map(r => ({ ...r, _type: 'reply' })),
      ...txs.map(tx => ({ ...tx, _type: 'tx' })),
    ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const adapterUrl = process.env.ADAPTER_URL || 'http://localhost:3000';

    return reply.view('conversation', { conv, timeline, adapterUrl, fmtDate, relativeTime, title: `Conversation`, t, lang, dir, langs });
  });

  // Manual reply API — also through Mind (identity + skills)
  // Stores both user message and AI reply in DB so timeline shows them.
  fastify.post('/conversations/:id/reply', async (request, reply) => {
    const { message, relayNodeId } = request.body;
    const conv = await getConversation(request.params.id);
    if (!conv) return reply.code(404).send({ error: 'Not found' });
    if (!message?.trim()) return reply.code(400).send({ error: 'Message required' });

    const resolved = resolveRelayNodeId(relayNodeId);
    const now = new Date().toISOString();

    // Store the owner's message in messages table
    const { insertMessage } = await import('../data/state/messages.js');
    const { insertReply } = await import('../data/state/replies.js');
    const { updateConversationTimestamps } = await import('../data/state/conversations.js');
    const { randomUUID } = await import('crypto');

    const ownerMsgId = await insertMessage({
      traceId: `manual-${randomUUID()}`,
      conversationId: conv.id,
      direction: 'outbound',
      senderIdentityId: conv.local_identity_id,
      receiverIdentityId: conv.remote_identity_id,
      messageType: 'text',
      contentText: message.trim(),
      receivedAt: now,
    });

    // Get AI reply through Mind
    const aiReply = await getReply(resolved, conv.remote_address, message.trim());

    // Store AI reply in replies table
    if (aiReply) {
      await insertReply({
        traceId: `manual-reply-${randomUUID()}`,
        conversationId: conv.id,
        messageId: ownerMsgId,
        replyType: 'ai',
        provider: 'mind',
        replyText: aiReply,
        status: 'sent',
      });
    }

    await updateConversationTimestamps(conv.id, { lastMessageAt: now, lastReplyAt: now });

    if (!aiReply) return reply.code(502).send({ error: 'Mind unavailable' });
    return reply.send({ ok: true, reply: aiReply });
  });
}
