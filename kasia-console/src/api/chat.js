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
import { checkBudget, recordSpend } from '../services/social-budget.js';

// ── Sub 9.15 (KI-13.6) — broadcast chain-content alignment ──
// kasia-relay/src/relay.mjs:28 capMessage truncates broadcast payloads to MAX_MESSAGE_CHARS=5000
// chars before writing to the Kaspa chain (suffix ' [...]' on overflow). This helper mirrors
// that exact logic so sender-host LOCAL DB rows match chain truth (which receiver hosts decode
// via Scout). Without this alignment, sender's broadcast_messages.content stores pre-cap text,
// diverging from chain — caused 5/14 J1 ↔ Bettor cross-host attribution loop (J1 #178 §1 retract).
const MAX_BROADCAST_CHARS = 5000;
function _computeChainContent(text) {
  if (!text || text.length <= MAX_BROADCAST_CHARS) return text;
  return text.slice(0, MAX_BROADCAST_CHARS).replace(/\s+\S*$/, '') + ' [...]';
}

// ── Coordination-channel firewall (2026-04-24 proactive-spam incident) ──
// dev-coord / kanet-arch / kanet-review / kanet-alert are reserved for
// Opus J1 + Opus J2 + Owner coordination. Agent Mind auto-reply + proactive
// must not broadcast to them. See docs/ANTI-PATTERNS.md (rule: coordination
// channels protected from Agent noise) + docs/spec/2026-04-24-...v2 §8.1.8.
const COORD_CHANNELS = new Set(['dev-coord', 'kanet-arch', 'kanet-review', 'kanet-alert']);
// Whitelist: three Opus CC instances + reserved names. Each machine's Console
// checks against its own relay_nodes.name. Names like 'QClaude' kept for the
// Qwen→CC migration transition so the NWT host doesn't 403-lock itself.
const OPUS_RELAY_NAMES = new Set(['Martin', 'J2', 'J3', 'NWT', 'Opus', 'QClaude', 'Bettor']);

// ── Auto-reply skip rules (T-2026-04-22-02) ──
// Prevents Mind auto-reply cascade / identity-theft / storm on sensitive channels.
// All three helpers used in /api/chat/send and /api/chat/ingest trigger paths.

// 1) Known foreign agents (addresses of J1-machine relays) — cross-machine cascade guard
const KNOWN_FOREIGN_SUFFIXES = [
  'gc5k09mkzc55',
  'je4cgx2ktetp',
  'kzc2tgz4cchh',
  '7z7uwq2wq200',
];
function isKnownForeignAgent(addr) {
  if (!addr) return false;
  return KNOWN_FOREIGN_SUFFIXES.some(s => addr.endsWith(s));
}

// 2) Bot auto-reply content prefix patterns — storm-break rule
const BOT_PREFIX_PATTERNS = [
  /^\[[^\]]+\s+auto\]/,        // [NWT auto], [Opus auto], etc.
  /^\[OPUS[^\]]*\]/,
  /^\[QCLAUDE[^\]]*\]/,
  /^\[DONE\]/,
  /^\[QUESTION\]/,
  /^\[AUDIT[^\]]*\]/,
  /^\[SILENT\]/,
  /^\[→\s*[A-Z]/,              // [→ TARGET] handled by channel-bridge, not Mind
];
function isBotAutoReplyContent(content) {
  if (!content) return false;
  return BOT_PREFIX_PATTERNS.some(re => re.test(content));
}

// 3) Channel-level Mind auto-reply disable list (audit + alert channels stay clean)
const MIND_DISABLED_CHANNELS = new Set([
  'kanet-review',
  'kanet-alert',
]);
function isAutoReplyDisabledForChannel(channelName) {
  return MIND_DISABLED_CHANNELS.has(channelName);
}

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
    let sql, params;

    if (afterTs) {
      // Incremental: get messages after a timestamp (ascending for chronological order)
      sql = `SELECT * FROM broadcast_messages WHERE channel_name = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?`;
      params = [channel, afterTs, limit];
    } else {
      // Initial load: get the LATEST messages (subquery to reverse order)
      sql = `SELECT * FROM (SELECT * FROM broadcast_messages WHERE channel_name = ? ORDER BY created_at DESC LIMIT ?) sub ORDER BY created_at ASC`;
      params = [channel, limit];
    }

    const messages = sqlite.prepare(sql).all(...params);
    return reply.send({ messages, channel });
  });

  // GET /api/chat/channels — list known channels (from channels table)
  // Optional: ?after=ISO — returns new_count (messages after that timestamp) per channel
  fastify.get('/api/chat/channels', async (request, reply) => {
    const { after } = request.query;
    const channels = sqlite.prepare(`
      SELECT c.name as channel_name, c.description,
        COUNT(bm.id) as msg_count,
        MAX(bm.created_at) as last_message_at
      FROM channels c
      LEFT JOIN broadcast_messages bm
        ON bm.channel_name = c.name
        AND bm.status != 'local'
        AND bm.sender_address IS NOT NULL AND bm.sender_address != ''
      GROUP BY c.name
      ORDER BY last_message_at DESC NULLS LAST
    `).all();

    // If ?after provided, count new messages per channel since that time
    if (after) {
      const newCounts = sqlite.prepare(`
        SELECT channel_name, COUNT(*) as new_count
        FROM broadcast_messages
        WHERE created_at > ? AND status != 'local'
          AND sender_address IS NOT NULL AND sender_address != ''
        GROUP BY channel_name
      `).all(after);
      const countMap = new Map(newCounts.map(r => [r.channel_name, r.new_count]));
      for (const ch of channels) {
        ch.new_count = countMap.get(ch.channel_name) || 0;
      }
    }

    return reply.send({ channels });
  });

  // POST /api/chat/channels — create or update a channel
  fastify.post('/api/chat/channels', async (request, reply) => {
    const { name, description } = request.body || {};
    if (!name?.trim()) {
      return reply.code(400).send({ error: 'name is required' });
    }
    const channelName = name.trim();
    const desc = description?.trim?.() || null;
    sqlite.prepare(`
      INSERT OR REPLACE INTO channels (name, description, created_by, created_at)
      VALUES (?, ?, 'owner', datetime('now'))
    `).run(channelName, desc);
    return reply.send({ ok: true, name: channelName });
  });

  // DELETE /api/chat/channels/:name — delete a channel (keeps messages)
  fastify.delete('/api/chat/channels/:name', async (request, reply) => {
    const name = request.params.name;
    sqlite.prepare('DELETE FROM channels WHERE name = ?').run(name);
    return reply.send({ ok: true, name });
  });

  // POST /api/chat/send — send a broadcast message
  fastify.post('/api/chat/send', async (request, reply) => {
    const { relayId, channel, message } = request.body || {};
    if (!relayId || !channel?.trim() || !message?.trim()) {
      return reply.code(400).send({ error: 'relayId, channel, message are required' });
    }

    const relay = getRelayNode(relayId);
    if (!relay) return reply.code(404).send({ error: 'Account not found' });

    // 🔒 Coordination-channel firewall (shared constants COORD_CHANNELS +
    //    OPUS_RELAY_NAMES at top of file; same guard applied in triggerAutoReply)
    if (COORD_CHANNELS.has(channel.trim()) && !OPUS_RELAY_NAMES.has(relay.name)) {
      console.warn(`[chat] coord-channel BLOCKED: ${relay.name} → #${channel.trim()} — "${(message||'').slice(0,60)}"`);
      return reply.code(403).send({
        error: 'coordination_channel_restricted',
        detail: `#${channel.trim()} is reserved for Opus (J1/J2) + Owner coordination; Agent ${relay.name} not permitted`,
        relay: relay.name,
        channel: channel.trim(),
      });
    }

    // 事前预算拦截 (fail-closed): 超限直接 403, 不发广播不花 KAS
    const preCheck = await checkBudget(relayId, 0);
    if (!preCheck.allowed) {
      console.warn(`[chat] budget BLOCKED for ${relay.name}: ${preCheck.reason}`);
      return reply.code(403).send({
        error: 'social_budget_exceeded',
        detail: preCheck.reason,
        spent: preCheck.spent,
        budget: preCheck.budget,
        remaining: preCheck.remaining,
      });
    }

    try {
      const result = await sendCommandAsync(relayId, { type: 'send_broadcast', channel: channel.trim(), message: message.trim() });
      if (!result?.ok) throw new Error(result?.error || 'Broadcast failed');
      result.address = relay.address;

      // Store locally immediately.
      // Sub 9.15 fix: align LOCAL DB with chain truth — kasia-relay's capMessage(5000) truncates
      // payloads > 5000 chars on chain. If we INSERT pre-cap content here, sender host's LOCAL DB
      // diverges from receiver hosts (who scout-decode chain truth). Compute the chain content
      // ourselves using identical logic (matches kasia-relay/src/relay.mjs:28 capMessage).
      // KI-13.6: broadcast_messages LOCAL semantics ≠ chain truth without this alignment.
      const id = randomUUID();
      const now = nowIso();
      const channelName = channel.trim();
      const senderAddress = result.address;
      const fullMessage = message.trim();
      const content = _computeChainContent(fullMessage);
      if (content.length < fullMessage.length) {
        console.warn(`[chat/send] broadcast capped LOCAL→chain ${fullMessage.length} → ${content.length} chars (mirrors relay capMessage cap=${MAX_BROADCAST_CHARS})`);
      }
      sqlite.prepare(`
        INSERT OR IGNORE INTO broadcast_messages (id, channel_name, sender_address, content, tx_hash, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'confirmed', ?)
      `).run(id, channelName, senderAddress, content, result.txId, now);

      // Record spend in social_spend_log
      const feeKas = parseFloat(result.fee || 0);
      if (result.txId && feeKas > 0) {
        recordSpend({ relayId, txId: result.txId, fee: feeKas, channel: channel.trim(), content });
      }

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
      const isProtocolMessage = content.startsWith('{"t":"kanet_');
      const isDevCoord = content.startsWith('[DEV-COORD]');
      const isKnownForeign = isKnownForeignAgent(senderAddress);
      const isBotReply = isBotAutoReplyContent(content);
      const isChannelDisabled = isAutoReplyDisabledForChannel(channelName);
      if (channelName !== 'otc-market'
          && !isOwnAgentSend && !isKnownForeign
          && !isProtocolMessage && !isDevCoord
          && !isBotReply && !isChannelDisabled) {
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
    const { channelName, senderAddress, content, txHash } = request.body || {};
    if (!channelName || !senderAddress || !content || !txHash) {
      return reply.code(400).send({ error: 'channelName, senderAddress, content, txHash required' });
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
    const isProtocolMsg = content.startsWith('{"t":"kanet_');
    const isDevChannel = channelName === 'dev-coord' || channelName === 'kanet-dev';
    const isDevMsg = content.startsWith('[DEV-COORD]');
    const isKnownForeign2 = isKnownForeignAgent(senderAddress);
    const isBotReply2 = isBotAutoReplyContent(content);
    const isChannelDisabled2 = isAutoReplyDisabledForChannel(channelName);
    if (channelName !== 'otc-market'
        && !isOwnAgent && !isKnownForeign2
        && !isProtocolMsg && !isDevChannel && !isDevMsg
        && !isBotReply2 && !isChannelDisabled2) {
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
  // 🔒 Coordination-channel firewall — reject before Mind LLM call, save inference cost
  const relay = sqlite.prepare('SELECT name FROM relay_nodes WHERE id = ?').get(responder.relay_id);
  if (COORD_CHANNELS.has(channelName) && !OPUS_RELAY_NAMES.has(relay?.name)) {
    console.log(`[chat] auto-reply BLOCKED (coord channel): ${relay?.name || 'agent'} → #${channelName}`);
    return;
  }

  // Cooldown check: skip if this agent replied to this channel recently
  const cooldownKey = `${responder.relay_id}:${channelName}`;
  const lastReply = _autoReplyCooldown.get(cooldownKey) || 0;
  if (Date.now() - lastReply < AUTO_REPLY_COOLDOWN_MS) {
    return; // silently skip, no log spam
  }

  const aiReply = await getReply(responder.relay_id, senderAddress, content, channelName);

  if (!aiReply?.trim()) {
    console.log(`[chat] ${relay?.name || 'agent'} produced empty reply, skipping`);
    return;
  }

  console.log(`[chat] ${relay?.name || 'agent'} got reply (${aiReply.length} chars), broadcasting...`);

  // 事前预算拦截 (auto-reply 路径): 超限静默跳过, 不打扰用户
  const autoPreCheck = await checkBudget(responder.relay_id, 0);
  if (!autoPreCheck.allowed) {
    console.warn(`[chat] auto-reply BLOCKED for ${relay?.name || 'agent'}: ${autoPreCheck.reason}`);
    return;
  }

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
        // Dynamic fee should handle most cases; this is a fallback (keep 90%)
        const target = Math.max(20, Math.floor(broadcastText.length * 0.9));
        broadcastText = broadcastText.slice(0, target).replace(/\s+\S*$/, '') + '...';
        attempts++;
        console.log(`[chat] ⚠ Storage mass fallback, retrying with ${broadcastText.length} chars (attempt ${attempts + 1})`);
      } else {
        throw err; // not storage mass, or out of retries
      }
    }
  }

  if (!result) throw new Error('broadcast failed after max retries');
  console.log(`[chat] ${relay?.name || 'agent'} broadcast OK: tx=${result.txId.slice(0, 16)}`);

  // 事后记账 (auto-reply 广播成功后)
  const autoFeeKas = parseFloat(result.fee || 0);
  if (result.txId && autoFeeKas > 0) {
    recordSpend({ relayId: responder.relay_id, txId: result.txId, fee: autoFeeKas, channel: channelName, content: broadcastText });
  }

  // Store locally (use the text that was actually broadcast — post chain cap, Sub 9.15)
  const id = randomUUID();
  const storedContent = _computeChainContent(broadcastText);
  if (storedContent.length < broadcastText.length) {
    console.warn(`[chat/auto-reply] broadcast capped LOCAL→chain ${broadcastText.length} → ${storedContent.length} chars (mirrors relay capMessage cap=${MAX_BROADCAST_CHARS})`);
  }
  sqlite.prepare(`
    INSERT OR IGNORE INTO broadcast_messages (id, channel_name, sender_address, content, tx_hash, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'confirmed', ?)
  `).run(id, channelName, responder.address, storedContent, result.txId, nowIso());
  if (attempts > 0) console.log(`[chat] Broadcast succeeded after ${attempts + 1} attempts (${broadcastText.length} chars; stored ${storedContent.length} post-cap)`);

  // Record spend in social_spend_log
  if (result.txId && autoFeeKas > 0) {
    recordSpend({ relayId: responder.relay_id, txId: result.txId, fee: autoFeeKas, channel: channelName, content: broadcastText });
  }

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
