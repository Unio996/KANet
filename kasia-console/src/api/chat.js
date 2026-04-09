import { sqlite } from '../db/client.js';
import { getRelayNode, listRelayNodes } from '../data/settings/relay-nodes.js';
import { sendCommandAsync } from '../services/relay-manager.js';
import { verifyIngestRequest } from '../services/ingest-auth.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import { randomUUID } from 'crypto';
import { nowIso } from '../lib/time.js';
import { getReply } from '../services/mind-manager.js';
import { onBroadcastWritten } from '../services/trade-protocol-filter.js';
import { recordChainEvent } from '../services/chain-event.js';

export async function registerChatRoutes(fastify) {

  // GET /chat — Live Chat page
  fastify.get('/chat', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const relays = listRelayNodes();
    return reply.viewAsync('chat-v3', { title: 'Live Chat', t, lang, dir, langs, relays, _page: 'chat' });
  });

  // GET /api/chat/messages — poll for messages in a channel
  fastify.get('/api/chat/messages', async (request, reply) => {
    const { channel, after, since, limit: rawLimit } = request.query;
    // Compat: market-maker client sends 'since', normalize to 'after'
    const afterTs = after || since;
    if (!channel) return reply.code(400).send({ error: 'channel is required' });

    const limit = Math.min(parseInt(rawLimit) || 50, 200);
    let sql = `SELECT * FROM broadcast_messages WHERE channel_name = ?`;
    const params = [channel];

    if (afterTs) {
      sql += ' AND created_at > ?';
      params.push(afterTs);
    }

    sql += ' ORDER BY created_at ASC LIMIT ?';
    params.push(limit);

    const messages = sqlite.prepare(sql).all(...params);
    return reply.send({ messages, channel });
  });

  // GET /api/chat/channels — list known channels
  fastify.get('/api/chat/channels', async (request, reply) => {
    const channels = sqlite.prepare(`
      SELECT channel_name, COUNT(*) as msg_count,
        MAX(created_at) as last_message_at
      FROM broadcast_messages
      WHERE channel_name NOT GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-*'
        AND sender_address IS NOT NULL AND sender_address != ''
      GROUP BY channel_name
      ORDER BY last_message_at DESC
    `).all();
    return reply.send({ channels });
  });

  // POST /api/chat/send — send a broadcast message
  fastify.post('/api/chat/send', async (request, reply) => {
    const { relayId, channel, message } = request.body || {};
    if (!relayId || !channel?.trim() || !message?.trim()) {
      return reply.code(400).send({ error: 'relayId, channel, message are required' });
    }

    const relay = getRelayNode(relayId);
    if (!relay) return reply.code(404).send({ error: 'Account not found' });

    try {
      // 链上 payload 包成结构化 JSON，保证 UTF-8 中文安全（ASCII-safe via JSON.stringify）
      const chainPayload = JSON.stringify({ t: 'kanet_chat_v1', ch: channel.trim(), text: message.trim() });
      const result = await sendCommandAsync(relayId, { type: 'send_broadcast', channel: channel.trim(), message: chainPayload });
      if (!result?.ok) throw new Error(result?.error || 'Broadcast failed');
      result.address = relay.address;

      // Store locally immediately
      const id = randomUUID();
      const now = nowIso();
      const channelName = channel.trim();
      const senderAddress = result.address;
      const content = message.trim();
      sqlite.prepare(`
        INSERT OR IGNORE INTO broadcast_messages (id, channel_name, sender_address, content, tx_hash, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'confirmed', ?)
      `).run(id, channelName, senderAddress, content, result.txId, now);

      // ── Trade protocol filter (new pipeline, does not replace Chat) ──
      try {
        await onBroadcastWritten({ tx_hash: result.txId, content, sender_address: senderAddress, channel_name: channelName, created_at: now });
      } catch (err) {
        console.error('[trade-filter] Error in send path:', err.message);
      }

      // Trigger discussion relay — other agents respond
      // SKIP: otc-market channel (structured orders only)
      // SKIP: messages from our own agents (prevents echo chamber — Agent A broadcasts, Agent B/C/D echo "thanks!")
      const isOwnAgentSend = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(senderAddress);
      // Owner 消息 = sender 是本地 relay 地址 → 只让一个 Agent 回复（不抢答）
      const isOwnerMessage = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(senderAddress);
      if (channelName !== 'otc-market' && !isOwnAgentSend) {
        const responders = sqlite.prepare(`
          SELECT r.id as relay_id, r.address, r.network, a.http_port
          FROM relay_nodes r
          JOIN adapter_nodes a ON a.id = r.adapter_node_id
          WHERE r.address IS NOT NULL AND r.mnemonic_encrypted IS NOT NULL
            AND r.address != ?
        `).all(senderAddress);

        // Owner 发的消息只让第一个 Agent 回复，外部消息所有 Agent 轮流回复
        const activeResponders = isOwnerMessage ? responders.slice(0, 1) : responders;

        for (let i = 0; i < activeResponders.length; i++) {
          const responder = activeResponders[i];
          const delay = i * 10000;
          setTimeout(() => {
            console.log(`[chat] triggering reply from ${responder.address?.slice(-8)} (delay=${delay}ms)`);
            triggerAutoReply(responder, channelName, senderAddress, content).catch(err => {
              console.error(`[chat] auto-reply FAILED (${responder.address?.slice(-8)}): ${err?.message || err}`);
            });
          }, delay);
        }
      }

      return reply.send({ ok: true, txId: result.txId, fee: result.fee });
    } catch (err) {
      console.error('[chat] send error:', err.message);
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/chat/local — local chat (free, instant, no on-chain TX)
  // Owner talks to Agent directly through Mind. Agent responds instantly.
  // relayId='__all__' → group chat: all agents reply in sequence.
  fastify.post('/api/chat/local', async (request, reply) => {
    const { relayId, channel, message } = request.body || {};
    if (!relayId || !channel?.trim() || !message?.trim()) {
      return reply.code(400).send({ error: 'relayId, channel, message are required' });
    }

    const channelName = channel.trim();
    const content = message.trim();
    const now = nowIso();
    const isGroup = relayId === '__all__';

    // Resolve target relay(s)
    const relays = isGroup
      ? listRelayNodes()
      : [getRelayNode(relayId)].filter(Boolean);

    if (relays.length === 0) {
      return reply.code(404).send({ error: 'Account not found' });
    }

    // Store owner message (use first relay id as owner tag, or '__all__')
    const ownerId = randomUUID();
    sqlite.prepare(`
      INSERT INTO broadcast_messages (id, channel_name, sender_address, content, tx_hash, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'local', ?)
    `).run(ownerId, channelName, 'owner:' + relayId, content, 'local-' + ownerId, now);

    // Get AI replies from all agents in parallel (Martin's suggestion: Promise.all + index ordering)
    const replyResults = await Promise.all(
      relays.map(async (relay) => {
        try {
          const aiReply = await getReply(relay.id, 'owner:' + relay.id, content, channelName);
          return { relay, aiReply: aiReply?.trim() || null };
        } catch (err) {
          console.error(`[chat] local reply error (${relay.name}):`, err.message);
          return { relay, aiReply: null };
        }
      })
    );

    // Store replies in order and collect results
    const replies = [];
    for (const { relay, aiReply } of replyResults) {
      if (aiReply) {
        const replyId = randomUUID();
        const replyNow = nowIso();
        sqlite.prepare(`
          INSERT INTO broadcast_messages (id, channel_name, sender_address, content, tx_hash, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'local', ?)
        `).run(replyId, channelName, relay.address, aiReply, 'local-' + replyId, replyNow);
        replies.push({ agent: relay.name, reply: aiReply });
      }
    }

    return reply.send({
      ok: true,
      reply: isGroup
        ? replies.map(r => r.reply).join('\n') || null
        : replies[0]?.reply || null,
    });
  });

  // POST /api/chat/ingest — Scout reports a broadcast message (requires auth)
  fastify.post('/api/chat/ingest', { preHandler: [async (req, rep) => { await verifyIngestRequest(req, rep); }] }, async (request, reply) => {
    let { channelName, senderAddress, content, txHash } = request.body || {};
    if (!channelName || !senderAddress || !content || !txHash) {
      return reply.code(400).send({ error: 'channelName, senderAddress, content, txHash required' });
    }

    // 解包 kanet_chat_v1 结构化广播 → 存原始文本到 DB
    if (content.startsWith('{"t":"kanet_chat_v1"')) {
      try {
        const parsed = JSON.parse(content);
        if (parsed.t === 'kanet_chat_v1' && parsed.text) content = parsed.text;
      } catch (_) { /* fallback 原始 content */ }
    }

    // Dedup by tx_hash
    const existing = sqlite.prepare('SELECT id FROM broadcast_messages WHERE tx_hash = ?').get(txHash);
    if (existing) return reply.send({ ok: true, duplicate: true });

    const id = randomUUID();
    const now = nowIso();
    sqlite.prepare(`
      INSERT INTO broadcast_messages (id, channel_name, sender_address, content, tx_hash, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'confirmed', ?)
    `).run(id, channelName, senderAddress, content, txHash, now);

    // ── Trade protocol filter (new pipeline, does not replace Chat) ──
    try {
      await onBroadcastWritten({ tx_hash: txHash, content, sender_address: senderAddress, channel_name: channelName, created_at: now });
    } catch (err) {
      console.error('[trade-filter] Error in ingest path:', err.message);
    }

    // ── Auto-reply: let agents respond to EXTERNAL messages only ──
    // Skip: otc-market channel, AND skip if sender is one of our own agents (prevents storm)
    const isOwnAgent = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(senderAddress);
    if (channelName !== 'otc-market' && !isOwnAgent) {
    const responders = sqlite.prepare(`
      SELECT r.id as relay_id, r.address, r.network, a.http_port
      FROM relay_nodes r
      JOIN adapter_nodes a ON a.id = r.adapter_node_id
      WHERE r.address IS NOT NULL AND r.mnemonic_encrypted IS NOT NULL
        AND r.address != ?
    `).all(senderAddress);

    for (let i = 0; i < responders.length; i++) {
      const responder = responders[i];
      const delay = i * 10000; // 10s stagger — enough for UTXO to settle
      setTimeout(() => {
        console.log(`[chat] triggering reply from ${responder.address?.slice(-8)} (delay=${delay}ms)`);
        triggerAutoReply(responder, channelName, senderAddress, content).catch(err => {
          const msg = err?.message || err?.toString?.() || JSON.stringify(err) || 'unknown';
          console.error(`[chat] auto-reply FAILED (${responder.address?.slice(-8)}): ${msg}`);
        });
      }, delay);
    }
    } // end otc-market skip

    return reply.send({ ok: true, id, duplicate: false });
  });

  // ── Conversational Ops: confirm execute action ──
  fastify.post('/api/chat/confirm', async (request, reply) => {
    const { relayNodeId, token } = request.body || {};
    if (!relayNodeId || !token) return reply.code(400).send({ error: 'Missing relayNodeId or token' });

    try {
      const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
      const { consumeConfirmToken } = await import(`file:///${KANET_ROOT}/agent-mind/src/confirm-store.mjs`);
      const entry = consumeConfirmToken(token, relayNodeId);
      if (!entry) return reply.send({ error: 'Token expired or invalid' });

      const ACTION_MAP = {
        send_kas: 'SEND_KAS',
        publish_order: 'CREATE_MM_ORDER',
        cancel_order: 'CANCEL_ORDER',
      };

      const actionType = ACTION_MAP[entry.intent];
      if (!actionType) return reply.send({ error: `Unknown execute intent: ${entry.intent}` });

      const actionMsg = `[ACTION:${actionType} ${Object.entries(entry.params).map(([k,v]) => `${k}=${v}`).join(' ')}]`;
      const result = await getReply(relayNodeId, 'owner:confirm', actionMsg);
      return reply.send({ ok: true, result: result || 'Action executed' });
    } catch (err) {
      return reply.send({ error: err.message });
    }
  });
}

/**
 * Get AI reply through Mind manager, then broadcast it back to the channel.
 * If discussion mode: after broadcasting, trigger other agents to respond (up to maxRounds).
 *
 * @param {object} responder - relay node info
 * @param {string} channelName - broadcast channel
 * @param {string} senderAddress - who sent the original message
 * @param {string} content - message content
 * @param {number} [round=0] - current discussion round (0 = first response, limits cascading)
 */
const MAX_DISCUSSION_ROUNDS = 0; // 0 = no cascade. Agents respond to original only, not to each other's replies.

// Per-agent cooldown: prevent the same agent from auto-replying more than once per 60s per channel
const _autoReplyCooldown = new Map(); // key: `${relayId}:${channel}` → lastReplyTime
const AUTO_REPLY_COOLDOWN_MS = 60_000; // 60 seconds

async function triggerAutoReply(responder, channelName, senderAddress, content, round = 0) {
  // Cooldown check: skip if this agent replied to this channel recently
  const cooldownKey = `${responder.relay_id}:${channelName}`;
  const lastReply = _autoReplyCooldown.get(cooldownKey) || 0;
  if (Date.now() - lastReply < AUTO_REPLY_COOLDOWN_MS) {
    return; // silently skip, no log spam
  }

  const relay = sqlite.prepare('SELECT name FROM relay_nodes WHERE id = ?').get(responder.relay_id);

  const aiReply = await getReply(responder.relay_id, senderAddress, content, channelName);

  if (!aiReply?.trim()) {
    console.log(`[chat] ${relay?.name || 'agent'} produced empty reply, skipping`);
    return;
  }

  console.log(`[chat] ${relay?.name || 'agent'} got reply (${aiReply.length} chars), broadcasting...`);

  // Record cooldown
  _autoReplyCooldown.set(cooldownKey, Date.now());

  // Broadcast the reply via Relay IPC
  let broadcastText = aiReply.trim();
  let result;
  let attempts = 0;
  const MAX_ATTEMPTS = 4;

  while (attempts < MAX_ATTEMPTS) {
    try {
      result = await sendCommandAsync(responder.relay_id, { type: 'send_broadcast', channel: channelName, message: broadcastText });
      if (!result?.ok) throw new Error(result?.error || 'Broadcast failed');
      result.address = responder.address;
      break; // success
    } catch (err) {
      const errMsg = err?.message || err?.toString?.() || '';
      if (errMsg.includes('Storage mass') && attempts < MAX_ATTEMPTS - 1) {
        // Shrink by ~40% each retry
        const target = Math.max(20, Math.floor(broadcastText.length * 0.6));
        broadcastText = broadcastText.slice(0, target).replace(/\s+\S*$/, '') + '...';
        attempts++;
        console.log(`[chat] Storage mass exceeded, retrying with ${broadcastText.length} chars (attempt ${attempts + 1})`);
      } else {
        throw err; // not storage mass, or out of retries
      }
    }
  }

  if (!result) throw new Error('broadcast failed after max retries');
  console.log(`[chat] ${relay?.name || 'agent'} broadcast OK: tx=${result.txId.slice(0, 16)}`);

  // Store locally (use the text that was actually broadcast)
  const id = randomUUID();
  sqlite.prepare(`
    INSERT OR IGNORE INTO broadcast_messages (id, channel_name, sender_address, content, tx_hash, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'confirmed', ?)
  `).run(id, channelName, responder.address, broadcastText, result.txId, nowIso());
  if (attempts > 0) console.log(`[chat] Broadcast succeeded after ${attempts + 1} attempts (${broadcastText.length} chars)`);

  // replies.sent_txid hack 已删除（2026-04-06）— chain_events 是真相源

  // ── Bug2 fix: Agent 外发写入 chain_events ──
  if (result.txId && responder.address) {
    recordChainEvent({
      txid: result.txId,
      eventType: 'comm_sent',
      fromAddress: responder.address,
      toAddress: null,
      observedBy: 'console',
      payload: JSON.stringify({ channel: channelName, length: broadcastText.length }),
    });
  }

  console.log(`[chat] ${relay?.name || 'agent'} reply stored in DB`);

  // ── Discussion cascade: trigger other agents to respond to THIS reply ──
  if (round < MAX_DISCUSSION_ROUNDS) {
    const nextRound = round + 1;
    const otherAgents = sqlite.prepare(`
      SELECT r.id as relay_id, r.address, r.network, a.http_port
      FROM relay_nodes r
      JOIN adapter_nodes a ON a.id = r.adapter_node_id
      WHERE r.address IS NOT NULL AND r.mnemonic_encrypted IS NOT NULL
        AND r.address != ?
    `).all(responder.address);

    // Only trigger ONE other agent per round (round-robin by round number)
    if (otherAgents.length > 0) {
      const pick = otherAgents[nextRound % otherAgents.length];
      const pickRelay = sqlite.prepare('SELECT name FROM relay_nodes WHERE id = ?').get(pick.relay_id);
      const cascadeDelay = 15000; // 15s wait for UTXO settlement
      console.log(`[chat] Discussion round ${nextRound}: ${pickRelay?.name} will respond to ${relay?.name} in ${cascadeDelay / 1000}s`);
      setTimeout(() => {
        triggerAutoReply(pick, channelName, senderAddress, broadcastText, nextRound).catch(err => {
          const msg = err?.message || err?.toString?.() || JSON.stringify(err) || 'unknown';
          console.error(`[chat] Discussion cascade FAILED (${pick.address?.slice(-8)}): ${msg}`);
        });
      }, cascadeDelay);
    }
  }
}
