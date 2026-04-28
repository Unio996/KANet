import { loadSeen, saveSeen } from "./state.mjs";
import { routeMessage } from "./router.mjs";
import { getAIReply } from "./ai.mjs";
import { getConversations, getMessages, sendMessage, acceptHandshake, sendKaspa } from "./chain.mjs";
import { getWallet } from "./lib/wallet.mjs";
import { ingestMessage, ingestReply, ingestTx, ingestHandshake } from "./ingest.mjs";

const RELAY_MODE = process.env.RELAY_MODE || "indexer";
const POLL_MS = parseInt(process.env.POLL_MS || "2000");
const CONSOLE_URL = process.env.CONSOLE_URL || "";
const KASPA_NETWORK = process.env.KASPA_NETWORK || "mainnet";

// ── Chain message guardrails ──
const MAX_MESSAGE_CHARS = 5000;        // hard cap per message — beyond this, truncate
const DAILY_SEND_LIMIT = 200;          // max chain messages per day per relay
let _dailySendCount = 0;
let _dailyResetDate = new Date().toISOString().slice(0, 10);

function checkDailyLimit() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== _dailyResetDate) { _dailySendCount = 0; _dailyResetDate = today; }
  if (_dailySendCount >= DAILY_SEND_LIMIT) return false;
  _dailySendCount++;
  return true;
}

function capMessage(text) {
  if (!text || text.length <= MAX_MESSAGE_CHARS) return text;
  // Truncate at word boundary
  const capped = text.slice(0, MAX_MESSAGE_CHARS).replace(/\s+\S*$/, '') + ' [...]';
  log(`Message capped: ${text.length} → ${capped.length} chars (limit ${MAX_MESSAGE_CHARS})`);
  return capped;
}

let polling = false;
const seen = loadSeen();
const localAddress = getWallet().getAddress();

// ── Relay 层消息去重 + 幻觉行动拦截 ──────────────────────────────────────────
// 防止 Brain 幻觉循环（如 Martin 309 次重复消息事件）
// 两道防线：1. 消息相似度去重  2. 幻觉模式匹配
const _recentOutbound = [];      // { target, message, time }
const DEDUP_WINDOW_MS = 1_800_000;  // 30min 窗口（上层认知修复后这是兜底）
const DEDUP_SIMILARITY = 0.85;   // 85% 相似度阈值

// 幻觉行动正则模式（中英文）
const HALLUCINATION_PATTERNS = [
  /收到.*AI\s*暂不可用/,
  /我(正在|去|将)(抓取|执行|获取|查询)/,
  /按默认参数/,
  /预计\s*\d+.*分钟/,
  /I('m| am) (now |currently )?(fetching|executing|retrieving)/i,
  /using default param/i,
];

function _wordSimilarity(a, b) {
  if (!a || !b) return 0;
  // 混合分词：空格 + 标点 + 中文逐字拆分（中文没有天然词界）
  const tokenize = s => {
    const tokens = [];
    for (const part of s.toLowerCase().split(/[\s,，.。!！?？;；:：、]+/).filter(Boolean)) {
      // 英文/数字整词保留，中文逐字+bigram
      if (/^[a-z0-9%$@#]+$/i.test(part)) {
        tokens.push(part);
      } else {
        // 中文逐字 + bigram
        for (let i = 0; i < part.length; i++) {
          tokens.push(part[i]);
          if (i + 1 < part.length) tokens.push(part[i] + part[i + 1]);
        }
      }
    }
    return new Set(tokens);
  };
  const wa = tokenize(a);
  const wb = tokenize(b);
  const overlap = [...wa].filter(w => wb.has(w)).length;
  return overlap / Math.max(wa.size, wb.size, 1);
}

/**
 * 检查消息是否应该被拦截。
 * @returns {string|null} — 拦截原因，null = 放行
 */
function shouldBlockOutbound(target, message) {
  if (!message || typeof message !== 'string') return null;

  // R5 T-J2-16: Service 模式 relay (broker) 跳 anti-spam dedup. broker DM 内容
  // deterministic 协议文案 (报价/付款指引/完成通知), 跨 session 高度相似但都是
  // 必发消息. anti-spam 防 LLM 幻觉是设计前提, broker Service 不挂 LLM, 不需此防线.
  if (process.env.IS_SERVICE === '1') return null;

  // 协议消息不走去重拦截 — 协议重试是有意为之，不是垃圾消息
  // 陷阱 #45: shouldBlockOutbound 拦截了协议消息重试，导致 paid 广播永远上不了链
  if (message.startsWith('{"t":"kanet_')) return null;

  // 防线 1: 幻觉模式匹配
  const hallMatch = HALLUCINATION_PATTERNS.find(p => p.test(message));
  if (hallMatch) {
    return `hallucination: matches pattern ${hallMatch.source.slice(0, 30)}`;
  }

  // 防线 2: 同 target 60s 内相似消息去重
  const now = Date.now();
  // 清理过期记录
  while (_recentOutbound.length > 0 && now - _recentOutbound[0].time > DEDUP_WINDOW_MS) {
    _recentOutbound.shift();
  }

  for (const prev of _recentOutbound) {
    if (prev.target !== target) continue;
    const sim = _wordSimilarity(prev.message, message);
    if (sim >= DEDUP_SIMILARITY) {
      return `duplicate: ${Math.round(sim * 100)}% similar to message sent ${Math.round((now - prev.time) / 1000)}s ago`;
    }
  }

  // 放行 → 记录
  _recentOutbound.push({ target, message, time: now });
  // 限制记录数
  if (_recentOutbound.length > 200) _recentOutbound.shift();

  return null;
}

// Blocklist cache — refreshed every poll cycle
let blocklist = new Set();
async function refreshBlocklist() {
  if (!CONSOLE_URL) return;
  try {
    const res = await fetch(`${CONSOLE_URL}/api/identity/blocklist?network=${KASPA_NETWORK}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const list = await res.json();
      blocklist = new Set(list);
    }
  } catch {}
}

function log(...args) {
  console.log(new Date().toLocaleString(undefined, { hour12: false }), ...args);
}

async function handleActiveConversation(peer) {
  const msgs = await getMessages({ address: peer });

  if (!Array.isArray(msgs)) return;

  for (const msg of msgs) {
    if (!msg.txId || seen.has(msg.txId)) continue;

    log("RX", msg.txId, msg.message);
    const _rxMsgType = msg.message && /^\s*\{/.test(msg.message) && msg.message.includes('"query_card"') ? 'query_card' : 'text';
    ingestMessage({ traceId: msg.txId, localAddress, remoteAddress: peer, txid: msg.txId, message: msg.message, messageType: _rxMsgType });
    ingestTx({ traceId: msg.txId, txid: msg.txId, direction: "inbound", localAddress });

    const { agent } = routeMessage(msg.message);
    log("ROUTE →", agent);

    let replyText;
    try {
      replyText = await getAIReply(peer, msg.message, msg.txId);
    } catch (e) {
      log("AI ERROR:", e.message);
    }
    if (!replyText) {
      log("No reply for", peer.slice(-12), "— silent");
      continue;
    }
    log("AI →", replyText.slice(0, 80));

    // Guardrails: daily limit + max length
    if (!checkDailyLimit()) {
      log(`⚠ Daily send limit reached (${DAILY_SEND_LIMIT}), skipping reply`);
      seen.add(msg.txId); saveSeen(seen);
      continue;
    }
    let text = capMessage(replyText);
    let attempts = 0;
    const MAX_ATTEMPTS = 4;
    let sendOk = false;

    while (attempts < MAX_ATTEMPTS) {
      try {
        const draft = await sendMessage({ address: peer, message: text });
        if (!draft?.payload) { log("Draft failed:", draft); break; }
        const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
        log("TX SENT:", sent?.txId || sent);
        ingestTx({ traceId: msg.txId, txid: sent?.txId, direction: "outbound", amount: '0', fee: sent?.fee, localAddress });
        const _txMsgType = text && /^\s*\{/.test(text) && text.includes('"query_card"') ? 'query_card' : 'text';
        ingestMessage({
          traceId: `reply-out:${sent?.txId || msg.txId}`,
          direction: 'outbound',
          localAddress: localAddress,
          remoteAddress: peer,
          txid: sent?.txId,
          message: text,
          messageType: _txMsgType,
        });
        ingestReply({ traceId: msg.txId, replyText, sentTxid: sent?.txId || null });
        if (attempts > 0) log(`Reply sent after ${attempts + 1} attempts (${text.length} chars)`);
        sendOk = true;
        break;
      } catch (err) {
        const errMsg = err?.message || err?.toString?.() || '';
        if ((errMsg.includes('Insufficient funds') || errMsg.includes('Storage mass')) && attempts < MAX_ATTEMPTS - 1) {
          // Dynamic fee should prevent this. If we still hit it, trim conservatively (90% keep)
          const target = Math.max(20, Math.floor(text.length * 0.9));
          text = text.slice(0, target).replace(/\s+\S*$/, '') + '...';
          attempts++;
          log(`⚠ Storage mass fallback (dynamic fee underestimated), retrying with ${text.length} chars (attempt ${attempts + 1}/${MAX_ATTEMPTS})`);
        } else {
          log("Reply send failed:", errMsg);
          break;
        }
      }
    }

    // Mark as seen regardless of send success
    seen.add(msg.txId);
    saveSeen(seen);
  }
}

const _acceptedPeers = new Set(); // dedup: only accept handshake from each address once

async function doAcceptHandshake(peer) {
  // DEDUP 1: in-memory check
  if (_acceptedPeers.has(peer)) {
    log("HANDSHAKE from", peer.slice(-12), "→ already accepted (memory), skipping");
    return;
  }
  // DEDUP 2: check Console relation_states (persists across restarts)
  if (CONSOLE_URL) {
    try {
      const rs = await fetch(`${CONSOLE_URL}/api/relation/status?local=${encodeURIComponent(localAddress)}&peer=${encodeURIComponent(peer)}`).then(r => r.json());
      if (rs.status === 'accepted' || rs.status === 'active' || rs.status === 'confirmed') {
        log("HANDSHAKE from", peer.slice(-12), "→ already", rs.status, "in DB, skipping");
        _acceptedPeers.add(peer);
        return;
      }
    } catch {}
  }
  log("HANDSHAKE from", peer, "→ accepting...");
  try {
    const draft = await acceptHandshake({ address: peer });
    if (!draft?.payload) { log("Accept draft failed:", draft); return; }
    const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
    log("HANDSHAKE ACCEPTED TX:", sent?.txId || sent);
    _acceptedPeers.add(peer);
    ingestHandshake({ localAddress, remoteAddress: peer, txid: sent?.txId });
    ingestTx({ traceId: `handshake:${sent?.txId || Date.now()}`, txid: sent?.txId, direction: "outbound", amount: '0.2', fee: sent?.fee, localAddress });
  } catch (e) {
    log("HANDSHAKE ACCEPT ERROR:", e?.message || e);
  }
}

async function poll() {
  if (polling) { log("SKIP poll: previous still running"); return; }
  polling = true;
  try {
    await refreshBlocklist();
    const convs = await getConversations();
    log("TICK, conv count:", convs.length);

    for (const conv of convs) {
      // Skip blocked addresses
      if (blocklist.has(conv.contactAddress)) {
        log("BLOCKED:", conv.contactAddress, "— skipping");
        continue;
      }

      log("CONV:", conv.contactAddress, conv.status);

      if (conv.status === "pending_incoming") {
        await doAcceptHandshake(conv.contactAddress);
      } else if (conv.status === "active") {
        await handleActiveConversation(conv.contactAddress);
      }
    }
  } catch (e) {
    log("ERROR:", e.message || e);
  } finally {
    polling = false;
  }
}

// --- Start ---

if (RELAY_MODE === "rpc") {
  log("Kasia Relay started (RPC mode — local node subscription).");
  const { startRpcListener } = await import("./rpc-listener.mjs");
  startRpcListener().catch(err => {
    log("RPC listener failed:", err.message);
    log("Falling back to indexer mode...");
    setInterval(poll, POLL_MS);
  });
} else {
  log("Kasia Relay started (indexer mode).");
  setInterval(poll, POLL_MS);
}

/*
 * ── Console → Relay command channel (IPC) ────────────────────────────────────
 *
 * Architecture:
 *   Console → Relay: IPC child.send() — commands (handshake, message, card, etc.)
 *   Relay → Console: HTTP ingest API — reports (tx records, handshake records)
 *
 * Relay is the ONLY component that touches the chain.
 * Console is the neural center that passes signals.
 * Mind decides, Console transmits, Relay executes.
 */
if (process.send) {
  const { initiateHandshake, publishCard } = await import('./chain.mjs');
  // R-NWT-2026-04-28 Layer 5: validate cmd.type against shared enum (Z21 silent-fall-through fix).
  const { COMMAND_TYPES, isValidCommandType } = await import('./lib/commands.mjs');

  process.on('message', async (cmd) => {
    try {
      // Reject unknown command types loudly instead of silent fall-through.
      if (!isValidCommandType(cmd.type)) {
        log(`UNKNOWN COMMAND TYPE: ${cmd.type} (valid: ${Object.values(COMMAND_TYPES).join(', ')})`);
        if (cmd.requestId && process.send) {
          process.send({ requestId: cmd.requestId, result: { ok: false, error: `unknown command type: ${cmd.type}` } });
        }
        return;
      }
      let draft, sent;
      switch (cmd.type) {
        case 'handshake':
          draft = await initiateHandshake({ address: cmd.target });
          sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
          ingestHandshake({ localAddress, remoteAddress: cmd.target, txid: sent?.txId });
          ingestTx({ traceId: `handshake-init:${sent?.txId}`, txid: sent?.txId, direction: 'outbound', amount: '0.2', fee: sent?.fee, localAddress });
          log(`HANDSHAKE → ${cmd.target?.slice(-12)} TX: ${sent?.txId || '?'} fee: ${sent?.fee || '?'}`);
          break;

        case 'send_message': {
          const blockReason = shouldBlockOutbound(cmd.target, cmd.message);
          if (blockReason) {
            log(`MESSAGE BLOCKED → ${cmd.target?.slice(-12)}: ${blockReason}`);
            if (cmd.requestId && process.send) {
              process.send({ requestId: cmd.requestId, result: { error: `blocked: ${blockReason}`, blocked: true } });
            }
            break;
          }
          // Guardrails: daily limit + max length (对齐 send_broadcast / handleActiveConversation)
          if (!checkDailyLimit()) {
            log(`⚠ Daily send limit reached (${DAILY_SEND_LIMIT}), skipping message`);
            if (cmd.requestId && process.send) process.send({ requestId: cmd.requestId, result: { error: `daily limit reached (${DAILY_SEND_LIMIT})` } });
            break;
          }
          const cappedMsg = capMessage(cmd.message);
          draft = await sendMessage({ address: cmd.target, message: cappedMsg });
          sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
          ingestTx({ traceId: sent?.txId, txid: sent?.txId, direction: 'outbound', amount: '0', fee: sent?.fee, localAddress });
          ingestMessage({
            traceId: `msg-out:${sent?.txId || Date.now()}`,
            direction: 'outbound',
            localAddress: localAddress,
            remoteAddress: cmd.target,
            txid: sent?.txId,
            message: cappedMsg || '',
          });
          log(`MESSAGE → ${cmd.target?.slice(-12)} TX: ${sent?.txId || '?'} fee: ${sent?.fee || '?'}`);
          break;
        }

        case 'publish_card':
          draft = await publishCard(cmd.params);
          sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
          ingestTx({ traceId: sent?.txId, txid: sent?.txId, direction: 'outbound', amount: '0', fee: sent?.fee, localAddress });
          log(`CARD published TX: ${sent?.txId || '?'} fee: ${sent?.fee || '?'}`);
          break;

        case 'send_broadcast': {
          const bcastBlockReason = shouldBlockOutbound(`bcast:${cmd.channel}`, cmd.message);
          if (bcastBlockReason) {
            log(`BROADCAST BLOCKED #${cmd.channel}: ${bcastBlockReason}`);
            if (cmd.requestId && process.send) {
              process.send({ requestId: cmd.requestId, result: { error: `blocked: ${bcastBlockReason}`, blocked: true } });
            }
            break;
          }
          // Guardrails: daily limit + max length
          if (!checkDailyLimit()) {
            log(`⚠ Daily send limit reached (${DAILY_SEND_LIMIT}), skipping broadcast`);
            if (cmd.requestId && process.send) process.send({ requestId: cmd.requestId, result: { error: `daily limit reached (${DAILY_SEND_LIMIT})` } });
            break;
          }
          const { encodeBcastPayload } = await import('./lib/protocol.mjs');
          let bcastMsg = capMessage(cmd.message);
          let bcastAttempts = 0;
          const BCAST_MAX_ATTEMPTS = 4;
          while (bcastAttempts < BCAST_MAX_ATTEMPTS) {
            try {
              const bcastPayloadHex = encodeBcastPayload(cmd.channel, bcastMsg);
              sent = await sendKaspa({ to: localAddress, amount: 'self-full', payload: bcastPayloadHex });
              ingestTx({ traceId: sent?.txId, txid: sent?.txId, direction: 'outbound', amount: '0', fee: sent?.fee, localAddress });
              if (bcastAttempts > 0) log(`BROADCAST #${cmd.channel} sent after ${bcastAttempts + 1} attempts (${bcastMsg.length} chars)`);
              else log(`BROADCAST #${cmd.channel} TX: ${sent?.txId || '?'} fee: ${sent?.fee || '?'}`);
              break;
            } catch (bcastErr) {
              const bcastErrMsg = bcastErr?.message || bcastErr?.toString?.() || '';
              if ((bcastErrMsg.includes('Insufficient funds') || bcastErrMsg.includes('Storage mass')) && bcastAttempts < BCAST_MAX_ATTEMPTS - 1) {
                const target = Math.max(20, Math.floor(bcastMsg.length * 0.9));
                bcastMsg = bcastMsg.slice(0, target).replace(/\s+\S*$/, '') + '...';
                bcastAttempts++;
                log(`⚠ BROADCAST #${cmd.channel} storage mass fallback, retrying with ${bcastMsg.length} chars (attempt ${bcastAttempts + 1})`);
              } else {
                log(`BROADCAST #${cmd.channel} send failed: ${bcastErrMsg}`);
                throw bcastErr;
              }
            }
          }
          break;
        }

        case 'transfer':
          sent = await sendKaspa({ to: cmd.target, amount: cmd.amount });
          ingestTx({ traceId: sent?.txId, txid: sent?.txId, direction: 'outbound', amount: cmd.amount, fee: sent?.fee, localAddress });
          log(`TRANSFER ${cmd.amount} → ${cmd.target?.slice(-12)} TX: ${sent?.txId || '?'} fee: ${sent?.fee || '?'}`);
          break;

        case 'split_utxo': {
          // Split UTXOs for concurrent transaction support.
          // Uses Relay's own wallet + RPC — no mnemonic leaves the process.
          const { splitUtxosRelay } = await import('./lib/utxo-split.mjs');
          const splitResult = await splitUtxosRelay(cmd.targetCount || 3);
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: splitResult });
          }
          log(`UTXO SPLIT: ${splitResult.split ? splitResult.utxosBefore + '→' + splitResult.utxosAfter : 'skipped'} ${splitResult.reason || ''}`);
          sent = splitResult; // for generic result handler
          break;
        }
      }
      // 如果有 requestId，回传执行结果给 Console
      if (cmd.requestId && process.send) {
        process.send({ requestId: cmd.requestId, result: { txId: sent?.txId, fee: sent?.fee, ok: !!sent?.txId } });
      }
    } catch (err) {
      log(`command ${cmd.type} failed: ${err?.message || err?.toString?.() || JSON.stringify(err)}`);
      if (cmd.requestId && process.send) {
        process.send({ requestId: cmd.requestId, result: { error: err?.message || String(err) } });
      }
    }
  });
}

