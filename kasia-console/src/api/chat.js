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
  'J1tn-Alice', 'J1tn-Bob', 'J1tn-Carol', 'J1tn-Dave']);  // Bettor r191 + r479 实名补全; KANet-UI r-j1fix: 300e10de 漏 J1 (我自补). J1 #41 实证他真 relay 名是 J1tn-Alice/Bob/Carol/Dave (committee oracle relay, 也是他频道 poster), exact match 不中裸 'J1tn' → 补 4 个委员实名 (J1 各形式仍留兼容)。

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

  // GET /api/public/channel/:name/messages — public message API (= task md §3.1)
  // Hard filter visibility='public' (= Track A internal 默认不泄露 per §3.4)
  fastify.get('/api/public/channel/:name/messages', async (request, reply) => {
    const { name } = request.params;
    const { since, until, tag, query, limit: rawLimit } = request.query;
    if (!/^[a-z0-9-]{1,40}$/.test(name)) return reply.code(400).send({ error: 'invalid channel name' });
    const limit = Math.min(parseInt(rawLimit) || 50, 200);

    let sql = `SELECT id, sender_address, content as message_text, tx_hash as txid, created_at as timestamp
               FROM broadcast_messages
               WHERE channel_name = ? AND visibility = 'public' AND status != 'local'`;
    const params = [name];
    if (since) { sql += ' AND created_at > ?'; params.push(since); }
    if (until) { sql += ' AND created_at < ?'; params.push(until); }
    if (tag)   { sql += ' AND content LIKE ?'; params.push('%#' + tag + '%'); }
    if (query) { sql += ' AND content LIKE ?'; params.push('%' + query + '%'); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const messages = sqlite.prepare(sql).all(...params);
    reply.header('X-KANet-Disclaimer', 'testnet-only-no-investment-advice');
    return reply.send({ messages, channel: name });
  });

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
    const { wallet_address } = request.body || {};
    const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
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
    const isTrustedProxy = !!request.headers['x-ingest-secret'];  // bot 带, 公网浏览器不带
    if (!isTrustedProxy) {
      // Check IP rate limit (= 24h 3 次, 公网网页 faucet only)
      const ipCount = sqlite.prepare('SELECT COUNT(*) AS cnt FROM faucet_grants WHERE ip_address = ? AND granted_at > ?').get(ip, day).cnt;
      if (ipCount >= 3) return reply.code(429).send({ error: 'IP rate limit (= 24h 3 次 limit, current ' + ipCount + ', 公网网页 faucet)' });
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
    try {
      const { sendCommandAsync } = await import('../services/relay-manager.js');
      const result = await sendCommandAsync(FAUCET_RELAY_ID, {
        type: 'transfer',
        target: wallet_address,
        amount: FAUCET_AMOUNT_KAS.toFixed(8),  // KI-30: sompi 8 decimal max
      });
      const txid = result?.txId || null;
      if (!txid) {
        return reply.code(503).send({ error: 'faucet transfer 未上链 (= relay 返回无 txId, 可能余额不足 OR relay down)' });
      }
      sqlite.prepare(`INSERT INTO faucet_grants (ip_address, wallet_address, granted_at, amount_sompi, txid, status)
                      VALUES (?, ?, ?, ?, ?, 'sent')`)
        .run(ip, wallet_address, Math.floor(Date.now() / 1000), Math.round(FAUCET_AMOUNT_KAS * 1e8), txid);
      return reply.send({ ok: true, txid, amount: `${FAUCET_AMOUNT_KAS} testnet KAS` });
    } catch (err) {
      return reply.code(500).send({ error: `faucet transfer fail: ${err.message}` });
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
