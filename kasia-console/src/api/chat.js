import { sqlite } from '../db/client.js';
import { getRelayNode, listRelayNodes } from '../data/settings/relay-nodes.js';
import { sendCommandAsync } from '../services/relay-manager.js';
import { verifyIngestRequest, isValidIngestSecret } from '../services/ingest-auth.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import { randomUUID, createHash } from 'crypto';
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
// Bettor r479 (Owner 2026-06-10 钦定): dev-coord-testnet 加入 —— 当前活跃的协作主频道,
// 之前漏在集合外 → 自治 Mind agent (AutoBetter/maker/tester/pred-*) 自动回复 + 编造 echo
// 污染开发频道 (J1 #3 同步证实其 J1tn-*/pred-* 也在 echo)。开发频道只许 Claude Code 开发
// agent (Bettor/J2/KANet-UI/NWT + J1 远端) 协作, 自治 Mind 一律回避。
const COORD_CHANNELS = new Set(['dev-coord', 'dev-coord-testnet', 'kanet-arch', 'kanet-review', 'kanet-alert']);
// Whitelist: Claude Code 开发 agent relay 实名 (本机 relay_nodes.name 带 -tn 后缀)。
// Bettor r479: 补全实名 (旧版只有裸名 'Bettor'/'J2'/'NWT' 不匹配实际 'Bettor-tn'/'J2-tn'/...,
// 不补会把开发 agent 自己 403-锁出协作频道)。裸名保留兼容其他机器 / Qwen→CC 迁移过渡。
const OPUS_RELAY_NAMES = new Set(['Martin', 'J2', 'J3', 'NWT', 'Opus', 'Qclaude', 'Bettor',
  'Bettor-tn', 'J2-tn', 'KANet-UI-tn', 'NWT-tn',
  'J1', 'J1-tn', 'J1tn',
  'J1tn-Alice', 'J1tn-Bob', 'J1tn-Carol', 'J1tn-Dave',
  'new-user-tn']);  // Bettor r191 + r479 实名补全; KANet-UI r-j1fix: 300e10de 漏 J1 (我自补). J1 #41 实证他真 relay 名是 J1tn-Alice/Bob/Carol/Dave (committee oracle relay, 也是他频道 poster), exact match 不中裸 'J1tn' → 补 4 个委员实名 (J1 各形式仍留兼容)。

// owner-in-dev-channel (2026-06-21, Owner 钦定): a relay whose ADDRESS is classified trust_level='owner'
// (identities table) may post to COORD_CHANNELS even though its name is not in OPUS_RELAY_NAMES. Identity
// anchors on the address (Owner: "地址是最底层最内核身份标签"), NOT relay config. One firewall change here
// unblocks BOTH owner touchpoints (web /chat send + telegram bridge), since both post via /api/chat/send.
// Conservative: only the send-endpoint allow-path widens; the agent firewalls (triggerAutoReply L~680,
// action-executor) stay closed — owner is a human voice, never an auto-reply agent (ANTI-PATTERNS firewall rule).
function isOwnerAddress(address) {
  if (!address) return false;
  try {
    const row = sqlite.prepare("SELECT trust_level FROM identities WHERE address = ?").get(address);
    return row?.trust_level === 'owner';
  } catch { return false; }
}

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
// KANet-UI r-mindfw (J1 #39): dev 协调频道必掐 Mind auto-reply — 配套 0bd410ad(OPUS 白名单放行 J1tn
// 等 mind relay【手动】发协调消息), 但不掐 auto-reply → Alice/mind relay 的自治 auto-reply 仍漏过又灌频道
// (= r479 防火墙 'COORD 频道只许人类 agent 手动协调' 初衷的另一半)。两个一起焊: 手动通 + auto-reply 掐。
const MIND_DISABLED_CHANNELS = new Set([
  'kanet-review',
  'kanet-alert',
  'dev-coord',
  'dev-coord-testnet',
  'kanet-arch',
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

  // GET /api/chat/owner-voice — resolve the relay whose ADDRESS is classified trust_level='owner'
  // (the Owner's dev-coord "voice"). owner-in-dev-channel Step3: the telegram bridge posts the Owner's
  // DM via this relay — NO custom OWNER_RELAY_ID; identity anchors on the owner-classified address
  // (Owner: "地址是最底层最内核身份标签"), the same anchor the L195 firewall OR-clause uses. Returns
  // { ok, ownerVoice: {id,name,address} | null }. null = no address classified 'owner' yet (bridge no-ops).
  fastify.get('/api/chat/owner-voice', async (request, reply) => {
    const row = sqlite.prepare(`
      SELECT r.id, r.name, r.address FROM relay_nodes r
      JOIN identities i ON i.address = r.address
      WHERE i.trust_level = 'owner'
      ORDER BY r.created_at ASC LIMIT 1
    `).get();
    return reply.send({ ok: true, ownerVoice: row || null });
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
    //    OPUS_RELAY_NAMES at top of file; same guard applied in triggerAutoReply).
    //    owner-in-dev-channel: an address classified trust_level='owner' is also permitted (isOwnerAddress).
    if (COORD_CHANNELS.has(channel.trim()) && !OPUS_RELAY_NAMES.has(relay.name) && !isOwnerAddress(relay.address)) {
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
      const result = await sendCommandAsync(relayId, { type: 'send_broadcast', channel: channel.trim(), message: message.trim() }, undefined, 'legacy-unmigrated');
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
      // J1 #60 (log 实证 77× reactive on {): 放宽 kanet_ → 任何 {"t":" JSON 信封 = 机器协议(pool_oracle_vote/chunk/kanet_*), 不喂 mind reactive LLM (砍 :8000 reactive spike, scale ramp 前置). 需 upstream 双节点.
      const isProtocolMessage = content.startsWith('{"t":"');
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
    const isProtocolMsg = content.startsWith('{"t":"');  // J1 #60: 同上, pool_* 协议消息也跳 mind reactive (砍 :8000 spike)
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

  // ──────────────────────────────────────────────────────────────────────
  // KANet Dev Channel Tier 1 (kanet-dev-channel-tier1-task.md §3.1 §3.2 §3.3)
  // Owner 5/27 钦定 NWT 主搞 + UI 配合, Editorial 风格 baseline.
  // 只读公开 URL + onboarding + faucet + Track A/B 隔离 (visibility filter).
  // ──────────────────────────────────────────────────────────────────────

  // GET /welcome-dev — onboarding page (= task md §3.2)
  fastify.get('/welcome-dev', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    return reply.viewAsync('welcome-dev', { lang });
  });

  // GET /faucet — testnet KAS faucet page (= Tier 1 spec §5 第 4 URL, 2026-05-28 KANet-UI fill)
  fastify.get('/faucet', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const faucetEnabled = !!process.env.FAUCET_RELAY_ID;
    const amountKas = parseFloat(process.env.FAUCET_AMOUNT_KAS || '10000');
    reply.header('X-KANet-Disclaimer', 'testnet-only-no-investment-advice');
    return reply.viewAsync('faucet', { lang, faucetEnabled, amountKas });
  });

  // ── Summary System L2 — digest viewer UI (= Owner 2026-05-28 钦定 选 A) ──
  // digest MD files live in D:/KANet-Knowledge-Base/digests/, browser 无入口 → 加 viewer.
  const DIGEST_DIR = process.env.KANET_DIGEST_DIR || 'D:/KANet-Knowledge-Base/digests';
  const DIGEST_NAME_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}\.md$/;  // YYYY-MM-DD-HHMM.md, 防 path traversal

  // GET /dashboard/digest — digest viewer page
  fastify.get('/dashboard/digest', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    return reply.viewAsync('digest-viewer', { lang });
  });

  // GET /api/dashboard/digests — list digest files (newest first)
  fastify.get('/api/dashboard/digests', async (request, reply) => {
    const fs = await import('node:fs');
    if (!fs.existsSync(DIGEST_DIR)) return reply.send({ files: [] });
    const files = fs.readdirSync(DIGEST_DIR)
      .filter(f => DIGEST_NAME_RE.test(f))
      .map(f => {
        const st = fs.statSync(`${DIGEST_DIR}/${f}`);
        return { name: f, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return reply.send({ files });
  });

  // GET /api/dashboard/digest/:name — single digest MD content
  fastify.get('/api/dashboard/digest/:name', async (request, reply) => {
    const { name } = request.params;
    if (!DIGEST_NAME_RE.test(name)) return reply.code(400).send({ error: 'invalid digest filename' });
    const fs = await import('node:fs');
    const fp = `${DIGEST_DIR}/${name}`;
    if (!fs.existsSync(fp)) return reply.code(404).send({ error: 'digest not found' });
    return reply.send({ name, content: fs.readFileSync(fp, 'utf-8') });
  });

  // POST /api/dashboard/digest/generate — trigger fresh digest (= run digest-daily.mjs)
  fastify.post('/api/dashboard/digest/generate', async (request, reply) => {
    const { hours } = request.body || {};
    const h = Math.max(1, Math.min(48, parseInt(hours, 10) || 12));
    try {
      const { execFile } = await import('node:child_process');
      const KANET_ROOT = process.env.KANET_ROOT || 'D:/kanet-tn12';
      const result = await new Promise((resolve, reject) => {
        execFile('node', [`${KANET_ROOT}/scripts/digest-daily.mjs`, '--hours', String(h)],
          { timeout: 30000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout);
          });
      });
      // Parse output for written filename
      const m = result.match(/wrote\s+\S+[\\/]([0-9-]+\.md)/);
      return reply.send({ ok: true, file: m ? m[1] : null, output: result.trim().split('\n').slice(-1)[0] });
    } catch (e) {
      return reply.code(500).send({ error: `digest generate fail: ${e.message}` });
    }
  });

  // GET /public/channel/:name — public read-only channel browser (= task md §3.1)
  // Renders 公开 messages only (visibility='public'). Track A 默认 internal 不泄露.
  const PUBLIC_CHANNELS = ['kanet-spec', 'kanet-bugs', 'kanet-showcase', 'kanet-marketplace', 'kanet-forks', 'kanet-general'];
  fastify.get('/public/channel/:name', async (request, reply) => {
    const { name } = request.params;
    if (!/^[a-z0-9-]{1,40}$/.test(name)) return reply.code(400).type('text/plain').send('invalid channel name');
    const lang = parseLang(request.headers.cookie);
    reply.header('X-KANet-Disclaimer', 'testnet-only-no-investment-advice');
    return reply.viewAsync('public-channel', { channelName: name, channels: PUBLIC_CHANNELS, lang });
  });

  // 🔴 2026-07-26 NWT: 这条 handler 已搬进 registerPublicChannelReadRoute(见文件末)。
  //    搬的理由: 对外网关实例要【只注册这一条】, 而 registerChatRoutes 里有 20 条 ——
  //    直接调它会把 /api/chat/send 等 19 条一并暴露到外网(NWT 07:23 实测)。
  //    🔴 而这里是【调用】不是【复制】: 全仓该路由的注册点必须始终只有 1 处, 否则两份实现会漂移。
  await registerPublicChannelReadRoute(fastify);

  // GET /api/prediction-agent/stats — DM session stats for Agent tab UI wire
  // Per Bettor r100 R2 + sub-2c (KANet-UI):
  // - Active DM sessions (= prediction_dm_session 非 IDLE state count)
  // - Completed settles (= exchange_offers protocol_status='completed' for this maker_relay_id)
  // - WAITING_TAKER (= exchange_offers protocol_status='pending_taker' for this maker_relay_id)
  fastify.get('/api/prediction-agent/stats', async (request, reply) => {
    const { relay_id } = request.query;
    try {
      // Active DM sessions: any session whose last_action != IDLE updated within 24h
      const active = sqlite.prepare(`
        SELECT COUNT(*) AS n FROM prediction_dm_session
        WHERE last_action IS NOT NULL
          AND last_action NOT LIKE '%IDLE%'
          AND datetime(updated_at) > datetime('now', '-24 hours')
      `).get().n;

      let completed = 0;
      let waitingTaker = 0;
      if (relay_id) {
        completed = sqlite.prepare(`
          SELECT COUNT(*) AS n FROM exchange_offers
          WHERE maker_relay_id = ? AND protocol_status = 'completed'
        `).get(relay_id).n;
        waitingTaker = sqlite.prepare(`
          SELECT COUNT(*) AS n FROM exchange_offers
          WHERE maker_relay_id = ? AND protocol_status = 'pending_taker'
        `).get(relay_id).n;
      } else {
        completed = sqlite.prepare(`SELECT COUNT(*) AS n FROM exchange_offers WHERE protocol_status = 'completed'`).get().n;
        waitingTaker = sqlite.prepare(`SELECT COUNT(*) AS n FROM exchange_offers WHERE protocol_status = 'pending_taker'`).get().n;
      }

      return reply.send({ ok: true, active, completed, waiting_taker: waitingTaker });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // POST /api/faucet/request — auto faucet (= task md §3.3)
  // Rate limit: same IP 24h ≤ 3 req, same wallet 永久 ≤ 1 req
  // Owner 充值 dedicated faucet wallet 后启用. Tier 1 阶段 wallet 未配置则 503.
  fastify.post('/api/faucet/request', async (request, reply) => {
    const { wallet_address, tz_offset, screen_res } = request.body || {};
    // G4 harden (2026-07-04, 世界杯上线门): 别直接读 x-forwarded-for 头当 IP 兜底 — 那是客户端可任意
    // 伪造的值(每次请求换一个假 IP 就绕过下面的 24h≤3 per-IP 限制)。fastify 的 trustProxy:'127.0.0.1'
    // (index.js) 已经安全地把该头解析进 request.ip(只在真正的本地反代那一跳才信, 否则回落原始 socket
    // 地址) — request.ip 正常情况下永远非空, 不该再有第二条不受信任的兜底路径。
    const ip = request.ip || 'unknown';
    if (!wallet_address || !/^kaspatest:[a-z0-9]+$/.test(wallet_address)) {
      return reply.code(400).send({ error: 'wallet_address invalid, must be kaspatest:...' });
    }
    // Check wallet rate limit (= 永久 1 次)
    const walletRow = sqlite.prepare('SELECT id FROM faucet_grants WHERE wallet_address = ?').get(wallet_address);
    if (walletRow) return reply.code(429).send({ error: 'wallet already granted (= 永久 1 次 limit)' });
    const day = Math.floor(Date.now() / 1000) - 86400;
    // Bettor 根治 2026-06-23 (Owner 真机撞 per-IP 缺陷): bot 代理 faucet 时 request.ip 恒 = 127.0.0.1
    //   (bot→console localhost), per-IP「24h≤3」把全体 TG 用户绑成一个 IP 共享 3 次 → 第 4 个用户被挡 →
    //   Owner 钦定零门槛玩 broken。per-IP 对 bot 路径既无效(Sybil 开多 TG 账号仍同 bot IP)又有害(挤掉诚实用户)。
    //   修: 可信内部代理(带 x-ingest-secret = bot console-api.mjs 已带; 公网网页不带) 豁免 per-IP; Sybil 防护
    //   对 bot 路径靠 per-wallet 永久 once(托管钱包幂等 = 每 TG 用户一地址一次) + 全局日帽。per-IP 仅对公网网页 faucet 保留。
    const isTrustedProxy = await isValidIngestSecret(request);  // 验值(timingSafeEqual), 非仅验存在
    // G4 lightweight fingerprint (2026-07-04, Bettor 钦定): 测试网币零价值, 目标"防随手换IP多领"非
    // "防专业女巫"——不装重型设备指纹库, 就 user-agent+accept-language(服务端已有的 header)+客户端传的
    // 时区偏移+屏幕分辨率拼一个 hash, 当第二把钥匙同样 24h≤3(跟 per-IP 平行, 独立判定, 任一超限即拒)。
    // bot 代理路径(trusted proxy)不发这两个浏览器字段, fingerprintHash 会退化成只含 UA+lang 的弱 hash——
    // 但 trusted proxy 路径本就跳过下面的限速判断(靠 per-wallet+全局帽), 不受影响。
    let fingerprintHash = null;
    if (!isTrustedProxy) {
      const fpRaw = [
        request.headers['user-agent'] || '',
        request.headers['accept-language'] || '',
        tz_offset ?? '',
        screen_res || '',
      ].join('|');
      fingerprintHash = createHash('sha256').update(fpRaw).digest('hex');
      // Check IP rate limit (= 24h 3 次, 公网网页 faucet only)
      const ipCount = sqlite.prepare('SELECT COUNT(*) AS cnt FROM faucet_grants WHERE ip_address = ? AND granted_at > ?').get(ip, day).cnt;
      if (ipCount >= 3) return reply.code(429).send({ error: 'IP rate limit (= 24h 3 次 limit, current ' + ipCount + ', 公网网页 faucet)' });
      const fpCount = sqlite.prepare('SELECT COUNT(*) AS cnt FROM faucet_grants WHERE fingerprint_hash = ? AND granted_at > ?').get(fingerprintHash, day).cnt;
      if (fpCount >= 3) return reply.code(429).send({ error: 'device rate limit (= 24h 3 次 limit, current ' + fpCount + ', 公网网页 faucet)' });
    }
    // KANet-UI 2026-06-23 (Bettor⑥ anti-Sybil·托管钱包零门槛后 faucet 额度抬到 10k → 必加全局日帽,
    //   否则一人多 TG 账号刷干 faucet relay)。全局 24h 笔数帽 = 已有 per-IP/per-wallet 之上的总闸,
    //   env FAUCET_GLOBAL_DAILY_CAP 可调 (默认 50 笔/日 = 上限 ~500k testnet KAS/日, 实由 relay 余额封顶)。
    const GLOBAL_DAILY_CAP = parseInt(process.env.FAUCET_GLOBAL_DAILY_CAP || '50', 10);
    const globalCount = sqlite.prepare('SELECT COUNT(*) AS cnt FROM faucet_grants WHERE granted_at > ?').get(day).cnt;
    if (globalCount >= GLOBAL_DAILY_CAP) {
      return reply.code(429).send({ error: 'faucet 全局日帽已满 (= 24h ' + GLOBAL_DAILY_CAP + ' 笔上限, 防 Sybil 刷干, 明日再试)' });
    }

    // 2026-05-28 KANet-UI wire (= Tier 1 缺件 fill, 全力推动):
    // env FAUCET_RELAY_ID 配置后启用 (= Owner spawn FaucetRelay-tn 独立 relay + 充值后设 env).
    // 未设 → 503 graceful (= 不破坏现有).
    // grant amount: 5 KAS (= 500_000_000 sompi). 原 stub 100000_00000000n = 100k KAS 是 bug (= spec §NWT-2 本意小额,
    //   但 1M sompi=0.01 KAS post-fee-bump 不够 1 帖, 5 KAS = ~250-1000 帖 合理 dev faucet 额度).
    const FAUCET_RELAY_ID = process.env.FAUCET_RELAY_ID;
    // KANet-UI 2026-06-23: Owner 钦定零门槛玩 = 生成钱包→faucet 10k→/bet, 额度 5→10000 (env 可调)。
    const FAUCET_AMOUNT_KAS = parseFloat(process.env.FAUCET_AMOUNT_KAS || '10000');
    if (!FAUCET_RELAY_ID) {
      return reply.code(503).send({
        error: 'Faucet pending config (= FAUCET_RELAY_ID env 未设, Owner spawn FaucetRelay-tn + 充值后启用).',
        planned_amount: `${FAUCET_AMOUNT_KAS} testnet KAS`,
      });
    }
    // 🔴 原子预留 (J2 2026-07-29 · 起因: Codex 对该端点写入顺序的 review)
    //
    //   不变量:【预留必须发生在不可逆动作之前】。
    //   表上那条 `wallet_address TEXT NOT NULL UNIQUE` 是这里唯一的并发闸 ——
    //   它只有在【转账之前】就被触发,才能在冲突时保证"还没花钱";
    //   放在转账之后, 它就只能记录既成事实。⇒ 先 INSERT 'pending' 占位, 再转账。
    //
    //   🔵 本次不新增机制: UNIQUE 与 status CHECK ('pending'/'sent'/'failed') 建表时就有,
    //     只是 'pending'/'failed' 此前从未被写过(2026-07-29 实测: 全表 82/82 行为 'sent')。
    //     ⇒ 无需 migration。同族先例见 migrate.js 的四条 partial UNIQUE INDEX
    //       (idx_mm_orders_payment_txhash_unique 等), 均以唯一约束承担同类并发保证。
    //
    //   🔴 而"结果未知"一律留在 'pending' —— 见下方两处 catch 点的说明。
    let grantId;
    try {
      grantId = sqlite.prepare(`INSERT INTO faucet_grants (ip_address, wallet_address, granted_at, amount_sompi, txid, status, fingerprint_hash)
                                VALUES (?, ?, ?, ?, NULL, 'pending', ?)`)
        .run(ip, wallet_address, Math.floor(Date.now() / 1000), Math.round(FAUCET_AMOUNT_KAS * 1e8), fingerprintHash).lastInsertRowid;
    } catch (e) {
      // 唯一约束命中 = 该钱包已有一行(已发放 / 或另一个请求已占位)。
      // 🔵 关键: 走到这里时【尚未动用任何资金】—— 这正是把预留放在转账之前换来的性质。
      if (String(e?.code || '').startsWith('SQLITE_CONSTRAINT')) {
        return reply.code(429).send({ error: 'wallet already granted or request in flight (= 永久 1 次 limit)' });
      }
      throw e;
    }

    try {
      const { sendCommandAsync } = await import('../services/relay-manager.js');
      const result = await sendCommandAsync(FAUCET_RELAY_ID, {
        type: 'transfer',
        target: wallet_address,
        amount: FAUCET_AMOUNT_KAS.toFixed(8),  // KI-30: sompi 8 decimal max
      }, undefined, 'internal');
      const txid = result?.txId || null;
      if (!txid) {
        // 🔴 拿不到 txid = 【结果未知】, 不等于"确定没发出去"。
        //   relay 当前在失败路径上只回一个自由文本 error + phase 字段, 而 phase 的语义是
        //   "是否到达执行层", 不是"是否已提交"(2026-07-29 实读 relay.mjs 确认)——
        //   ⇒ 没有任何结构化信号能把"未提交"与"已提交但响应丢失"分开。
        // 🔴 因此这一行【保持 'pending' 不动】: 它既记录"可能已付", 又继续占住唯一约束。
        //   不许在此处写 'failed' —— 那等于把一个未知断言成"没付", 并放行再次发放。
        // 🟡 代价(已知并接受): 若实际未付, 该钱包在人工处置前领不到。
        //   处置流程见 docs/2026-07-29-faucet-stuck-pending-operator.md。
        return reply.code(503).send({
          error: 'faucet transfer 结果未知 (= relay 未返回 txId; 本次已记为 pending, 不会重复发放)',
          grant_id: grantId,
        });
      }
      sqlite.prepare("UPDATE faucet_grants SET status = 'sent', txid = ? WHERE id = ?").run(txid, grantId);
      return reply.send({ ok: true, txid, amount: `${FAUCET_AMOUNT_KAS} testnet KAS` });
    } catch (err) {
      // 🔴 同上: 异常可能发生在提交之后 ⇒ 结果未知 ⇒ 保持 'pending', 不回滚该行。
      return reply.code(500).send({
        error: `faucet transfer fail (结果未知, 本次已记为 pending): ${err.message}`,
        grant_id: grantId,
      });
    }
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
      result = await sendCommandAsync(responder.relay_id, { type: 'send_broadcast', channel: channelName, message: broadcastText }, undefined, 'legacy-unmigrated');
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


/**
 * 公开频道只读接口 —— 【唯一】注册点。
 *
 * 🔴 它被两个 Fastify 实例各注册一次, 而实现只有这一份:
 *    · 控制面(现有 console, 绑 127.0.0.1) —— 经 registerChatRoutes 调用
 *    · 对外网关(external-gateway.mjs, 绑对外)  —— 只调用它, 不调 registerChatRoutes
 * 🔴 绝不允许在别处再写一份同能力的 handler —— 那是双权威源, 会漂移(J2 07:21 自陈)。
 */
export async function registerPublicChannelReadRoute(fastify) {
  // GET /api/public/channel/:name/messages — public message API (= task md §3.1)
  // Hard filter visibility='public' (= Track A internal 默认不泄露 per §3.4)
  //
  // 🔴 2026-07-26 J2 (Bettor 05:18/05:19 派工, 判据逐字:「外部集成方写错任何一样东西时,
  //    能不能【从响应本身】看出来」)。这是外部程序【唯一】能调的入口, 而它此前对任何错误
  //    输入都回 200 —— 集成方看不出自己写错了。实测(逐次数了返回条数, 非估算):
  //      limit=abc → 50   · limit=0 → 50    (非法值静默退回默认)
  //      limit=201 → 200  · limit=99999 → 200 (静默截断, 响应里无任何标记)
  //      limit=-5  → 535  (Math.min 只压上界不压下界 ⇒ 负数进 SQL ⇒ 返回全部)
  //      频道名打错 → 200 + 空数组 (与"公开频道但暂无消息"无法区分)
  //    ⇒ 本次只动这一个 handler。同写法在 bettor.js 等处还有十余处, 【不动】(Owner 05:11 令)。
  fastify.get('/api/public/channel/:name/messages', async (request, reply) => {
    const { name } = request.params;
    const { since, until, until_id: untilId, tag, query, limit: rawLimit } = request.query;
    // 🔴 免责头提前设 —— 否则下面的 400/404 分支不带它, 而错误响应同样是对外响应
    reply.header('X-KANet-Disclaimer', 'testnet-only-no-investment-advice');

    const PUBLIC_MAX_LIMIT = 200;
    const PUBLIC_DEFAULT_LIMIT = 50;

    if (!/^[a-z0-9-]{1,40}$/.test(name)) {
      return reply.code(400).send({ error: 'invalid_channel_name', hint: 'a-z 0-9 与连字符, 1-40 字符', got: String(name) });
    }

    // 🔴 limit 契约: 非法值【报错】, 不静默改成别的数字。
    let limit = PUBLIC_DEFAULT_LIMIT;
    let limitClamped = false;
    if (rawLimit !== undefined && rawLimit !== '') {
      if (!/^\d+$/.test(String(rawLimit))) {
        // 负数走这里(有 '-' 不匹配 \d+) ⇒ 下界问题被【拒绝】而不是被夹紧, 调用方能看见
        return reply.code(400).send({ error: 'invalid_limit', hint: `非负整数, 1..${PUBLIC_MAX_LIMIT}`, got: String(rawLimit) });
      }
      const n = Number(rawLimit);
      if (n < 1) return reply.code(400).send({ error: 'invalid_limit', hint: `最小 1, 最大 ${PUBLIC_MAX_LIMIT}`, got: String(rawLimit) });
      if (n > PUBLIC_MAX_LIMIT) { limit = PUBLIC_MAX_LIMIT; limitClamped = true; } else { limit = n; }
    }

    let sql = `SELECT id, sender_address, content as message_text, tx_hash as txid, created_at as timestamp
               FROM broadcast_messages
               WHERE channel_name = ? AND visibility = 'public' AND status != 'local'`;
    const params = [name];
    if (since) { sql += ' AND created_at > ?'; params.push(since); }
    // 🔴🔴 复合游标 (Bettor 05:36 判必修)。单靠 created_at 的严格 `<` 会【静默漏行】:
    //    同一毫秒的多条里, 只要有一条落在页尾, 其余同值行下一页就再也拿不到 ——
    //    而集成方【没有任何信号】。那正是本次修法要消灭的那个病本身。
    // 【实跑核】全表存在同 created_at 的行(最多 4 行同毫秒); 公开面此刻恰好 0 撞。
    //    ⇒ 也就是说它现在不发作, 是因为公开面【碰巧】还没有同毫秒的行 —— 那不是一道保证。
    // 【实跑核】id 是 TEXT PRIMARY KEY 且非空处唯一(127733/127748), 而【有 15 行 id 为 NULL】
    //    (SQLite 的 TEXT PK 允许 NULL)。那 15 行当前全是 internal, 公开面为 0。
    //    ⇒ 同样是"碰巧" ⇒ 游标必须 NULL 安全, 不能假设 id 一定有值。
    //    ⇒ 用 COALESCE(id,'') 作为次序键: 空串小于任何 uuid, 于是 NULL-id 行在同毫秒内排最后,
    //      且比较是【全序】—— 不会跳, 也不会重。
    // 🔴 守卫只区分【有没有传这个参数】, 不看它是不是空串 (NWT 05:41):
    //    页尾正好是 id=NULL 那行时, 游标值【就是】空串 —— 把空串排除掉, 等于把复合游标
    //    唯一为之而建的那个输入排除掉。undefined(没传) 与 '' (传了空串) 必须分开。
    if (until && untilId !== undefined && untilId !== null) {
      sql += " AND (created_at < ? OR (created_at = ? AND COALESCE(id,'') < ?))";
      params.push(until, until, String(untilId));
    } else if (until) {
      // 向后兼容: 老调用方只传 until。此路径仍是严格 `<`, 同毫秒行会被跳 —— 而它是【旧行为】,
      // 不是新引入的。新调用方按响应里的 next_until + next_until_id 成对回传即可避开。
      sql += ' AND created_at < ?';
      params.push(until);
    }
    if (tag)   { sql += ' AND content LIKE ?'; params.push('%#' + tag + '%'); }
    if (query) { sql += ' AND content LIKE ?'; params.push('%' + query + '%'); }
    sql += " ORDER BY created_at DESC, COALESCE(id,'') DESC LIMIT ?";
    // 🔴 多取一行来判断"还有没有" —— 这样 has_more 是【实际探到的】, 不是从 length==limit 猜的
    params.push(limit + 1);

    const rows = sqlite.prepare(sql).all(...params);
    const hasMore = rows.length > limit;
    const messages = hasMore ? rows.slice(0, limit) : rows;

    // 🔴 404 的判据是【是不是公开频道】, 不是【频道存不存在】(Bettor 05:19 裁)。
    //    ⇒ 内部频道(如 dev-coord-testnet)与一个拼错的名字拿到【同一个 404】, 泄露量为零。
    //    ⚠️ 绝不去查 channels 表 —— 那才会泄露内部频道的存在。
    //    🔴 且这一判必须【忽略 since/until/tag/query】: 过滤器筛出 0 条 ≠ 频道不存在,
    //       否则一次搜不到就报 404, 那是把两种情况又混成一种。
    if (messages.length === 0) {
      const anyPublic = sqlite.prepare(
        `SELECT 1 FROM broadcast_messages
          WHERE channel_name = ? AND visibility = 'public' AND status != 'local' LIMIT 1`,
      ).get(name);
      if (!anyPublic) {
        return reply.code(404).send({
          error: 'channel_not_found_or_not_public',
          hint: '该名字下没有任何公开消息 —— 可能是名字写错了, 也可能它不是公开频道',
          channel: name,
        });
      }
    }

    // 🔴🔴 游标 (NWT 05:27 红队第七种错法, Bettor 05:28 判"必须修才能上"):
    //    只给 has_more=true 而不给游标 ⇒ 集成方照直觉用 since 翻页 ⇒
    //    SQL 是 created_at > since 且 ORDER BY created_at DESC ⇒ 拿回【同样那一批】,
    //    has_more 仍为 true ⇒ 无限循环: 每次 200 OK · 每次相同数据 · 零错误信号。
    //    ⇒ 正好落在本次要满足的那条判据的反面: 他做错了, 而响应告诉不了他。
    // ⚠️ 方向: 排序是 DESC ⇒ 该给的是 `until` 侧游标, 不是 `since` 侧。给错方向 = 病换个地方复发。
    // ⚠️ 两条路径的保证【不同】(NWT 05:41 指出上一版注释已过期):
    //    · 复合路径(until + until_id 成对) ⇒ 全序比较 ⇒ 同毫秒行【不漏不重】
    //    · 兼容路径(只传 until) ⇒ 仍是严格 `<` ⇒ 同毫秒行会被跳过 —— 那是【旧行为】, 非本次引入
    // 🟡 已知残缺(NWT 提, Bettor 未派 ⇒ 本版不做, 记在这里不让它消失):
    //    只传 until 的调用方【静默走有损路径】, 响应里没有任何提示 ——
    //    严格说它违反本次那条唯一判据(集成方看不出自己在有损路径上)。
    const lastRow = messages.length > 0 ? messages[messages.length - 1] : null;
    const nextUntil = hasMore && lastRow ? lastRow.timestamp : null;
    // 🔴 与 next_until 【成对】使用。单传 next_until 会退回旧的严格 `<` 路径 ⇒ 同毫秒行被静默跳过。
    const nextUntilId = hasMore && lastRow ? (lastRow.id ?? '') : null;

    return reply.send({
      messages,
      channel: name,
      limit_applied: limit,            // 🔴 真正生效的值, 不让调用方猜
      max_limit: PUBLIC_MAX_LIMIT,     // 🔴 上限写在响应里, 不要求对方去读文档
      limit_clamped: limitClamped,     // 🔴 你要的比上限大 ⇒ 明说被压过
      has_more: hasMore,               // 🔴 你只拿到一个窗口 ⇒ 明说后面还有
      next_until: nextUntil,           // 🔴 翻下一页把它原样传回 ?until= ; has_more=false 时为 null
      next_until_id: nextUntilId,      // 🔴 必须与 next_until 【成对】回传 ?until_id= , 否则同毫秒行会被跳
    });
  });
}