import { loadSeen, saveSeen } from "./state.mjs";
import { routeMessage } from "./router.mjs";
import { getAIReply } from "./ai.mjs";
import { getConversations, getMessages, sendMessage, acceptHandshake, sendKaspa } from "./chain.mjs";
import { getWallet } from "./lib/wallet.mjs";
import { isValidKaspaAddress } from "./lib/crypto.mjs";
import { ingestMessage, ingestReply, ingestTx, ingestHandshake } from "./ingest.mjs";

const RELAY_MODE = process.env.RELAY_MODE || "indexer";
const POLL_MS = parseInt(process.env.POLL_MS || "2000");
const CONSOLE_URL = process.env.CONSOLE_URL || "";
const KASPA_NETWORK = process.env.KASPA_NETWORK || "mainnet";

// ── Chain message guardrails ──
const MAX_MESSAGE_CHARS = 5000;        // hard cap per message — beyond this, truncate
// J2-tn 规模测试 (Bettor r538): 200 硬上限在 scale 期被烧光 → settle sign_req 分块广播
// ('daily limit reached (200)' 撞 dvi6w 52-chunk sign_req)。改 env-configurable: 每 settle TX
// (14in/12out ~40KB PSKT) 分 ~50 chunk = ~50 TX, 20-档 ramp ~1000 TX 仅 sign_req, 200/day 远不够。
// 安全护栏保留 (防 Brain 幻觉循环刷链), scale 期由 env 调高; 默认仍 200 (production 保守)。
const DAILY_SEND_LIMIT = parseInt(process.env.DAILY_SEND_LIMIT, 10) || 200;  // max chain messages per day per relay (env-overridable for scale-test)
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
  // KANet-UI r383: pool_oracle_vote_v1 / pool_market_published_v1 / pool_bet_registered_v1
  // 跨 market 同 schema 不同字段 → similarity 85% > DEDUP_SIMILARITY 触发 → vote 永不广播.
  // 同 KI 49 silent-skip 第 6 次 (= 'kanet_' prefix-only 漏覆盖 'pool_').
  if (message.startsWith('{"t":"kanet_') || message.startsWith('{"t":"pool_')) return null;

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
  // T-J1-2026-04-28 R38 step 2: 升级到 validateCommandPayload (typeof spec + graceful coerce, Z23 sediment).
  // 之前 isValidCommandType 只 check type 名 (cover Z21); validateCommandPayload 加 typeof check
  // (cover Z23 broker 传 number 给 amount 触 BigInt crash). 双层防御 + kasToSompi boundary coerce.
  const { COMMAND_TYPES, validateCommandPayload } = await import('./lib/commands.mjs');

  process.on('message', async (cmd) => {
    try {
      // Reject invalid commands loudly (unknown type / missing required field / typeof mismatch).
      const validateResult = validateCommandPayload(cmd);
      if (!validateResult.valid) {
        log(`INVALID COMMAND: ${validateResult.error} (valid types: ${Object.values(COMMAND_TYPES).join(', ')})`);
        if (cmd.requestId && process.send) {
          process.send({ requestId: cmd.requestId, result: { ok: false, error: `invalid command: ${validateResult.error}` } });
        }
        return;
      }
      let draft, sent;
      // T-J2-2026-05-12 (NWT spec 13:06 Fix 2): handshake / send_message target 必先 isValidKaspaAddress
      // (现升级含 secp256k1 曲线 membership), 否则 reject 不进 chain.mjs encrypt path. 防 bad peer
      // (bech32 valid + 曲线 invalid, 来源 test framework 合成 peer OR malicious user) 让 encrypt() throw,
      // 减 5/12 Trader-B 1352 次 disconnect cycle 噪音.
      if ((cmd.type === 'handshake' || cmd.type === 'send_message') && !isValidKaspaAddress(cmd.target)) {
        const reason = `target not valid Kaspa addr (bech32+secp256k1 curve): ${String(cmd.target).slice(0, 40)}`;
        log(`${cmd.type.toUpperCase()} REJECTED → ${reason}`);
        if (cmd.requestId && process.send) {
          process.send({ requestId: cmd.requestId, result: { error: reason, rejected: true } });
        }
        return;  // skip switch + generic completion handler
      }
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
              // Phase D J1-D-4 (NWT 8b848a95 Phase C catch + J2 b10692dd RCA): mempool reject recoverable.
              // RPC 'already spent ... in the mempool' = UTXO selector race window — mark explicit + sleep
              // give mempool time to clear, retry. extracted outpoint from error msg if present, mark via
              // markUtxoSpentByOutpoint so subsequent filterPendingUtxos excludes it.
              const isMempoolReject = /already spent.*?in the mempool|already spent by transaction/i.test(bcastErrMsg);
              if (isMempoolReject && bcastAttempts < BCAST_MAX_ATTEMPTS - 1) {
                // Best-effort outpoint extraction from RPC msg ('output (txid:index) already spent by ...')
                const m = bcastErrMsg.match(/\(([a-f0-9]{64}):?(\d*)\)/i);
                if (m) {
                  const { markUtxoSpentByOutpoint } = await import('./lib/transaction.mjs');
                  markUtxoSpentByOutpoint(m[1], m[2] ? Number(m[2]) : 0);
                }
                bcastAttempts++;
                const sleepMs = bcastAttempts * 5000;  // 5/10/15s exp backoff (mempool eviction window)
                log(`⚠ BROADCAST #${cmd.channel} mempool reject, sleep ${sleepMs}ms before retry (attempt ${bcastAttempts + 1}/${BCAST_MAX_ATTEMPTS})`);
                await new Promise(r => setTimeout(r, sleepMs));
              } else if ((bcastErrMsg.includes('Insufficient funds') || bcastErrMsg.includes('Storage mass')) && bcastAttempts < BCAST_MAX_ATTEMPTS - 1) {
                // Bettor r128 P0: JSON protocol payloads must NOT be truncated — silent
                // corruption breaks consumer parse → handler never fires. Gate by content
                // shape (starts with '{') so this protects all JSON channels (kanet-prediction,
                // exchange, OTC, vote, future protocols) without coupling to channel name.
                if (bcastMsg.trimStart().startsWith('{')) {
                  log(`✘ BROADCAST #${cmd.channel} JSON payload ${bcastMsg.length} chars exceeds storage mass; surfacing error (no truncation per Bettor r128 P0)`);
                  throw bcastErr;
                }
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
          // design-v2 (B): cmd.force = REBALANCE to N medium UTXOs (consolidate dust + split) even when
          // count >= target — for broadcaster-UTXO management feeding parallel chunk broadcast (J2 (A)).
          const splitResult = await splitUtxosRelay(cmd.targetCount || 3, { force: cmd.force === true });
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: splitResult });
          }
          log(`UTXO SPLIT: ${splitResult.split ? splitResult.utxosBefore + '→' + splitResult.utxosAfter : 'skipped'} ${splitResult.reason || ''}`);
          sent = splitResult; // for generic result handler
          break;
        }

        case 'consolidate_utxo': {
          // design-v2 (B) §2 root-fix (Bettor r627): consolidate this relay's fragmented UTXOs N→1 to
          // keep `best` large (self-full broadcast mass ≈ C×feeReserve/best² → large best = low mass =
          // no 880-wall grind-down / committee-comms blackout). Inverse of split_utxo. Relay's own
          // wallet + RPC (no mnemonic leaves). Atomic vs in-flight sign_req (withSendLock) + inputs ⊆
          // relay-own P2PK → disjoint from P2SH-spine settle UTXOs → settle bytes / determinism unchanged.
          const { consolidateUtxosRelay } = await import('./lib/utxo-split.mjs');
          const consResult = await consolidateUtxosRelay({ minFragments: cmd.minFragments });
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: consResult });
          }
          log(`UTXO CONSOLIDATE: ${consResult.consolidated ? consResult.utxosBefore + '→1 (' + consResult.rounds + ' round)' : 'skipped'} ${consResult.reason || ''}`);
          sent = consResult; // for generic result handler
          break;
        }

        case 'get_rpc_state': {
          // T-J2-2026-05-12 #2 — read-only state probe (UI 健康检测 P0, NWT spec sub #2/7).
          // 直接 return 短路 generic handler (避双 reply, 跟 split_utxo pattern 类似但 cleaner).
          const { getRpcState } = await import('./rpc-listener.mjs');
          const snapshot = getRpcState();
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, state: snapshot } });
          }
          return;  // skip generic completion reply
        }

        case 'chain_get_current_daa_score': {
          // ③ committee chainReader (Bettor r170): Console wraps as chainReader.getCurrentDaaScore.
          // Used by fetchEndBlockHashCanonical finality_depth check (F-S1).
          try {
            const { getCurrentDaaScore } = await import('./rpc-listener.mjs');
            const daa = await getCurrentDaaScore();
            if (cmd.requestId && process.send) {
              process.send({ requestId: cmd.requestId, result: { ok: true, daa_score: daa } });
            }
          } catch (e) {
            if (cmd.requestId && process.send) {
              process.send({ requestId: cmd.requestId, result: { ok: false, error: e.message } });
            }
          }
          return;
        }

        case 'chain_get_blocks_from_daa_score': {
          // ③ committee chainReader: returns recent-blocks ring buffer filtered to daaScore >= minDaa.
          // Console wraps as chainReader.getBlocksFromDaaScore; settler-tick finds first endBlock at/above
          // deadline daaScore as VRF seed input for sampleAndStoreCommittee.
          try {
            const minDaa = Number(cmd.min_daa_score);
            if (!Number.isFinite(minDaa) || minDaa < 0) throw new Error('min_daa_score must be non-negative number');
            const { getRecentBlocksAtOrAbove } = await import('./rpc-listener.mjs');
            const blocks = getRecentBlocksAtOrAbove(minDaa);
            if (cmd.requestId && process.send) {
              process.send({ requestId: cmd.requestId, result: { ok: true, blocks } });
            }
          } catch (e) {
            if (cmd.requestId && process.send) {
              process.send({ requestId: cmd.requestId, result: { ok: false, error: e.message } });
            }
          }
          return;
        }

        case 'chain_get_block_at_daa': {
          // J1tn r303 (Bettor 钦定 SPC fix + J2 r327 split): chain-authoritative endBlock at deadlineDaa.
          // Walks kaspad selected-parent-chain via getBlock RPC (NOT ring buffer) — cross-node deterministic.
          // Console wraps as chainReader.getBlockAtDaa; replaces ring buffer minDaa selection for endBlock.
          // Response shape: flatten { ok, hash, daaScore, timestamp_ms, isChainBlock } to match
          // J2-tn r327 relay-chain-reader.getBlockAtDaa wrapper contract (= reads r.hash/r.daaScore directly).
          try {
            const minDaa = Number(cmd.min_daa_score);
            if (!Number.isFinite(minDaa) || minDaa < 0) throw new Error('min_daa_score must be non-negative number');
            const { getBlockAtDaa } = await import('./rpc-listener.mjs');
            const block = await getBlockAtDaa(minDaa);
            if (cmd.requestId && process.send) {
              process.send({ requestId: cmd.requestId, result: { ok: true, hash: block.hash, daaScore: block.daaScore, timestamp_ms: block.timestamp_ms, isChainBlock: block.isChainBlock } });
            }
          } catch (e) {
            if (cmd.requestId && process.send) {
              process.send({ requestId: cmd.requestId, result: { ok: false, error: e.message } });
            }
          }
          return;
        }

        case 'ecdsa_sign': {
          // Phase 4a r234/r235 Sub 6 — ECDSA sign a payload message (= voter daemon signs oracle vote).
          // 用 kaspa-wasm signMessage (= secp256k1 over message hash, returns hex sig).
          // PB-S6-2 安全: privkey 不 leak, sign 后立 forget. 仅 console.log message hash, NOT privkey.
          const { signMessage } = await import('kaspa-wasm');
          const wallet = getWallet();  // = lib/wallet.mjs instance, exists per relay process
          const privKey = wallet.getPrivateKey();
          const message = String(cmd.message || '');
          if (!message) throw new Error('ecdsa_sign: missing cmd.message (string)');
          const signature = signMessage({ message, privateKey: privKey });
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, signature, message_len: message.length } });
          }
          return;
        }

        case 'get_pubkey': {
          // Phase 4a Sub 6 — return relay x-only pubkey (= SS contract oracle ctor param).
          // Read-only, derives from wallet without exposing privkey.
          const kaspa = await import('kaspa-wasm');
          const wallet = getWallet();
          const addr = wallet.getAddress();
          const xpk = kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(addr));
          const xOnlyHex = xpk.toString();
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, x_only_pubkey: xOnlyHex, address: addr } });
          }
          return;
        }

        case 'sign_input_for_settle': {
          // Phase 4a Sub 8 (Bettor r238 Path A two-phase sign) — oracle signs a specific TX input.
          //
          // Maker dispatches Phase 2 DM kanet_oracle_tx_sign_req_v1 含 unsigned TX hex + input index.
          // Oracle voter daemon recv DM → verify own vote outcome + redeem_hash match → 调本 IPC.
          // Returns ECDSA/Schnorr sig over input sighash (= 真 SS contract checkSig 兼).
          //
          // PB-S8-2 安全: privkey 不 leave relay process. Console 仅 pass tx_hex + input_index.
          const { Transaction, createInputSignature, SighashType } = await import('kaspa-wasm');
          const wallet = getWallet();
          if (!cmd.tx_hex || typeof cmd.tx_hex !== 'string') {
            throw new Error('sign_input_for_settle: cmd.tx_hex required (= unsigned TX hex serialization)');
          }
          const inputIndex = parseInt(cmd.input_index, 10);
          if (!Number.isFinite(inputIndex) || inputIndex < 0) {
            throw new Error('sign_input_for_settle: cmd.input_index required (= 0-based)');
          }
          // Phase 4a v0: TX deserialization + sighash via kaspa-wasm.
          // TODO Sub 8.1 testnet 真 e2e 验: TX hex serialization format compatibility, sighash type selection.
          let unsignedTx;
          try {
            // Phase 4a v0 简化: console 直 pass Transaction-shaped object via JSON OR
            // hex full-serialization. kaspa-wasm Transaction constructor expects object spec.
            // 现 设 cmd.tx_obj is the Transaction-spec object.
            const parsed = cmd.tx_obj || JSON.parse(cmd.tx_hex);
            // Rehydrate BigInt fields lost in JSON.stringify roundtrip (= settler.buildSettleTxPreimage stringifies BigInt)
            parsed.lockTime = BigInt(parsed.lockTime || 0);
            parsed.gas = BigInt(parsed.gas || 0);
            if (Array.isArray(parsed.inputs)) {
              parsed.inputs = parsed.inputs.map(i => ({
                ...i,
                sequence: BigInt(i.sequence || 0),
                sigOpCount: Number(i.sigOpCount || 0),
                utxo: i.utxo ? {
                  ...i.utxo,
                  amount: BigInt(i.utxo.amount || 0),
                  blockDaaScore: BigInt(i.utxo.blockDaaScore || 0),
                } : undefined,
              }));
            }
            if (Array.isArray(parsed.outputs)) {
              parsed.outputs = parsed.outputs.map(o => ({
                ...o,
                value: BigInt(o.value || 0),
              }));
            }
            unsignedTx = new Transaction(parsed);
          } catch (e) {
            throw new Error(`sign_input_for_settle: TX deserialize fail: ${e.message}`);
          }
          const signature = createInputSignature(unsignedTx, inputIndex, wallet.getPrivateKey(), SighashType.All);
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, signature, input_index: inputIndex } });
          }
          return;
        }

        case 'prediction_settle_tx': {
          // Phase 4a Sub 8 step 3 (Bettor r242) — settle SS chain TX submit (= branch 0).
          //   Inputs: 2 P2SH UTXOs (maker_stake + taker_stake)
          //   Outputs: 2 (winner P2PK + broker P2PK)
          //   sigsByInput: [[sig1..sig5 for input 0], [sig1..sig5 for input 1]]
          //   winner: 0 (maker won) | 1 (taker won)
          // 复用 p2sh.mjs unlockP2SHMultiSig.
          const { unlockP2SHMultiSig } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
          const redeemScript = new Uint8Array(Buffer.from(cmd.redeem_script_hex, 'hex'));
          const r = await unlockP2SHMultiSig(
            cmd.p2sh_address, redeemScript,
            cmd.required_input_outpoints,  // [{outpointTxid, outpointIndex}, {...}]
            cmd.outputs,                    // [{address, amountSompi}, {...}]
            cmd.sigs_by_input,              // [[5 sigs for input 0], [5 sigs for input 1]]
            cmd.winner,                     // 0|1
            wallet.getNetworkId(),
            0n,
            cmd.tx_obj_preimage || null,    // Sub 8.2 Bug 14: voter's exact tx_obj for byte-identical sighash
          );
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, branch: 0, txId: r.txId } });
          }
          return;
        }

        case 'prediction_settle_consensual_tx': {
          // Oracle v0.3 sub 5d (J2 r43 ship) — settle_consensual SS chain TX submit (= entry 1).
          //   Inputs: 2 P2SH UTXOs (maker_stake + taker_stake)
          //   Outputs: 2 (winner P2PK + broker P2PK, 0 oracle output per NWT sub 4 .sil)
          //   sigsByInput: [[makerSig, takerSig], [makerSig, takerSig]] (= 2 sigs per input)
          //   winner: 0 (maker won) | 1 (taker won)
          //   selectorOpHex: '51' (= OP_1, 2nd entrypoint per .sil source order)
          const { unlockP2SHConsensual } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
          const redeemScript = new Uint8Array(Buffer.from(cmd.redeem_script_hex, 'hex'));
          const r = await unlockP2SHConsensual(
            cmd.p2sh_address, redeemScript,
            cmd.required_input_outpoints,
            cmd.outputs,
            cmd.sigs_by_input,  // [[maker_sig, taker_sig], [maker_sig, taker_sig]]
            cmd.winner,
            wallet.getNetworkId(),
            0n,
            cmd.tx_obj_preimage || null,
          );
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, branch: 1, txId: r.txId } });
          }
          return;
        }

        case 'pool_settle_tx': {
          // B2 v0.5 Sub 2d Phase 2c step 2b — pool settle TX submit (= cooperative Path A).
          // Inputs: 1 spine UTXO + N side UTXOs
          // Outputs: broker + N winners + maker_extra? + oracle_bond_returns
          // spineSigs: 3 oracle sigs for spine input (= unanimous entry 0)
          // Side inputs auto-unlock via [selector_0 + side_redeem_push] (= settled_via_spine no sigs)
          const { unlockPoolSpineP2SH } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
          // J2 r192 Part B v0.6: forward committee_data when present (= cmd.protocol_version='v0.6').
          // Bettor r352: v0.6→v0.7 sweep gap. v0.7 settle_aggregate (PoolSpine_v07.sil entry 0)
          // has the same 4-of-5 validSigs threshold as v0.6 → non-unanimous v0.7 also needs
          // committee_data so isV06EarlyDetect bypasses the v0.5 unanimous-only guard (p2sh.mjs:753).
          // qoyqv 4/5 实证: v0.6-only gate left committee_data=null → unanimous guard rejected settle.
          const committee_data = (cmd.protocol_version === 'v0.6' || cmd.protocol_version === 'v0.7') ? {
            committee_pks: cmd.committee_pks,
            committee_indices: cmd.committee_indices,
            committee_merkle_proofs: cmd.committee_merkle_proofs,
            committee_pk_hash: cmd.committee_pk_hash,
            // Bettor r353: v0.7 settle_aggregate sharding globals (undefined for v0.6 → p2sh skips).
            global_yes_total_sompi: cmd.global_yes_total_sompi,
            global_no_total_sompi: cmd.global_no_total_sompi,
            global_commit_id: cmd.global_commit_id,
          } : null;
          const r = await unlockPoolSpineP2SH({
            spineP2shAddress: cmd.spine_p2sh_address,
            sideP2shAddresses: cmd.side_p2sh_addresses,
            spineRedeemScriptHex: cmd.spine_redeem_script_hex,
            sideRedeemScriptHexes: cmd.side_redeem_script_hexes,
            requiredInputOutpoints: cmd.required_input_outpoints,
            outputs: cmd.outputs,
            spineSigsByInput: cmd.spine_sigs_by_input,
            spineInputCount: cmd.spine_input_count,
            winner: cmd.winner,
            sidesMerkleRootHex: cmd.sides_merkle_root,
            unanimous: cmd.unanimous,
            networkId: wallet.getNetworkId(),
            lockTime: BigInt(cmd.lock_time || 0),
            txObjPreimage: cmd.tx_obj_preimage || null,
            committee_data,
            settleEntrypoint: cmd.settle_entrypoint || 0,  // #31 ④a: 1 = v08 settle_aggregate (entry1); 0 = v05/06/07 / v08 chunk
          });
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, txId: r.txId } });
          }
          return;
        }

        case 'pool_side_refund_cancelled_tx': {
          // DoD C 退款自取 (Bettor r261 钦点) — PoolSide_v06/v07 entry 2 refund_market_cancelled.
          // Bettor single-sig + 1 input + 1 output, inline sign+submit (same pattern as spine
          // refund_maker_unjoined). 7132ddd 第一轮漏 ship 此 handler (Bettor r386 catch), 补齐.
          // Caller (Console claim endpoint) sends lock_time = (deadline + 7200) * 1000 ms post J1
          // 5dd590cd0 grace fix to satisfy SS L260/270 require(tx.time >= (deadline+REFUND_GRACE_SEC)*1000).
          const { unlockPoolSideRefundCancelled } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
          const r = await unlockPoolSideRefundCancelled({
            wallet,
            sideP2shAddress: cmd.side_p2sh_address,
            sideRedeemScriptHex: cmd.side_redeem_script_hex,
            requiredInputOutpoint: cmd.required_input_outpoint,
            output: cmd.output,
            networkId: wallet.getNetworkId(),
            lockTime: BigInt(cmd.lock_time || 0),
            txObjPreimage: cmd.tx_obj_preimage || null,
            // J2-tn r391 (#28 Bettor ③ APPROVE v2): entry_index 透传 — 2 for v06/v07, 3 for legacy v0.5.
            entryIndex: Number.isInteger(cmd.entry_index) ? cmd.entry_index : 2,
          });
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, txId: r.txId } });
          }
          return;
        }

        case 'pool_v07_compute_refund_mass': {
          // G6 批 3 段① Bettor r311 钦定: Console 手搓 UtxoEntry 喂 calculateTransactionMass
          // 多次 WASM panic (unreachable / 'outpoint is not an object' / scriptPublicKey 格式).
          // Relay 端有 well-tested kaspa-wasm UtxoEntry pattern (p2sh.mjs 内 unlockPoolSpineRefundMakerUnjoined
          // 已 ship), 直接 reuse: fetch UTXO + build fake signed TX + calculateTransactionMass + return.
          const { RpcClient, Encoding, Address, Transaction, TransactionOutput,
                  payToAddressScript, calculateTransactionMass } = await import('kaspa-wasm');
          const wallet = getWallet();
          const networkId = wallet.getNetworkId();
          // Reuse relay's connectRpc helper for consistent URL + 15s timeout.
          const { connectRpc, _encodePushDataHex } = await import('./lib/p2sh.mjs').then(m => ({
            connectRpc: async (nid) => {
              const { connectRpc } = await import('./lib/p2sh.mjs');
              return connectRpc ? connectRpc(nid) : null;
            },
            _encodePushDataHex: m._encodePushDataHex,
          })).catch(() => ({}));
          const RPC_TIMEOUT_MS = 15_000;
          const withTimeout = (p, ms, lbl) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms ${lbl}`)), ms))]);
          const rpc = new RpcClient({ url: process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210', encoding: Encoding.Borsh, networkId });
          await withTimeout(rpc.connect(), RPC_TIMEOUT_MS, 'connect');
          let spineUtxo;
          try {
            const { entries } = await withTimeout(rpc.getUtxosByAddresses([cmd.spine_p2sh]), RPC_TIMEOUT_MS, 'getUtxos');
            if (!entries?.length) throw new Error('no spine UTXO');
            const hits = entries.filter(e => e.outpoint.transactionId === cmd.spine_lock_tx);
            if (!hits.length) throw new Error('spine_lock_tx UTXO not found');
            spineUtxo = hits[0];
          } finally {
            try { await rpc.disconnect(); } catch {}
          }

          const redeemBytes = Buffer.from(cmd.spine_redeem_script_hex, 'hex');
          let redeemPushHex;
          if (redeemBytes.length <= 75) redeemPushHex = redeemBytes.length.toString(16).padStart(2,'0') + redeemBytes.toString('hex');
          else if (redeemBytes.length <= 255) redeemPushHex = '4c' + redeemBytes.length.toString(16).padStart(2,'0') + redeemBytes.toString('hex');
          else { const lenLE = Buffer.alloc(2); lenLE.writeUInt16LE(redeemBytes.length); redeemPushHex = '4d' + lenLE.toString('hex') + redeemBytes.toString('hex'); }
          const dummyScriptSigHex = '41' + '00'.repeat(64) + '01' + '52' + redeemPushHex;
          const placeholderValue = BigInt(cmd.maker_stake) - 50000n;
          const outSpk = payToAddressScript(new Address(cmd.maker_address));

          // BUILD using relay-side pattern (= same as p2sh.mjs unlockPoolSpineRefundMakerUnjoined L1110+).
          const fakeTx = new Transaction({
            version: 0,
            inputs: [{
              previousOutpoint: { transactionId: spineUtxo.outpoint.transactionId, index: spineUtxo.outpoint.index },
              signatureScript: dummyScriptSigHex,
              sequence: 0n,
              sigOpCount: 1,
              utxo: spineUtxo,  // pass the WHOLE utxo entry from RPC (relay-tested pattern)
            }],
            outputs: [new TransactionOutput(placeholderValue, outSpk)],
            lockTime: BigInt(cmd.deadline) * 1000n,
            gas: 0n,
            subnetworkId: '0000000000000000000000000000000000000000',
            payload: '',
          });
          const mass = calculateTransactionMass(networkId, fakeTx);
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, mass: String(mass) } });
          }
          return;
        }

        case 'pool_refund_maker_unjoined_tx': {
          // G2-B 二期 (Bettor r263 钦点) — PoolSpine_v06 entry 2 refund_maker_unjoined.
          // Maker single-sig + 1 input + 1 output, inline sign+submit (no DM/chain collection).
          const { unlockPoolSpineRefundMakerUnjoined } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
          const r = await unlockPoolSpineRefundMakerUnjoined({
            wallet,
            spineP2shAddress: cmd.spine_p2sh_address,
            spineRedeemScriptHex: cmd.spine_redeem_script_hex,
            requiredInputOutpoint: cmd.required_input_outpoint,
            output: cmd.output,
            networkId: wallet.getNetworkId(),
            lockTime: BigInt(cmd.lock_time || 0),
            txObjPreimage: cmd.tx_obj_preimage || null,
          });
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, txId: r.txId } });
          }
          return;
        }

        case 'pool_refund_disagreement_tx': {
          // B2 v0.5 area-4 7c — pool refund_disagreement TX submit. Spine-only (4 inputs),
          // 3 (Gap 1B silent burn) or 4 (Gap 1A full) outputs per silentOracleIndex.
          // Each spine input gets 2 oracle sigs (= signing pair derived from silent index).
          const { unlockPoolSpineRefundDisagreement } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
          const r = await unlockPoolSpineRefundDisagreement({
            spineP2shAddress: cmd.spine_p2sh_address,
            spineRedeemScriptHex: cmd.spine_redeem_script_hex,
            requiredInputOutpoints: cmd.required_input_outpoints,
            outputs: cmd.outputs,
            spineSigsByInput: cmd.spine_sigs_by_input,
            silentOracleIndex: cmd.silent_oracle_index,
            signingPair: cmd.signing_pair,
            networkId: wallet.getNetworkId(),
            lockTime: BigInt(cmd.lock_time || 0),
            txObjPreimage: cmd.tx_obj_preimage || null,
          });
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, txId: r.txId } });
          }
          return;
        }

        case 'check_utxo_landed': {
          // B2 v0.5 Phase 3 bug 7 fix — confirm a transfer's UTXO landed in the accepted UTXO set.
          // A mempool-accepted TX can lose a double-spend race (is_accepted=false) → no UTXO.
          const { checkUtxoLanded } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
          const r = await checkUtxoLanded(cmd.address, cmd.txid, wallet.getNetworkId());
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, landed: r.landed } });
          }
          return;
        }

        case 'prediction_settle_build_preimage': {
          // Phase 4a Sub 8 step 4 (Bettor r242) — maker_relay builds unsigned TX for Phase 2 DM dispatch.
          // Returns tx_obj that voters use as input to sign_input_for_settle IPC.
          // 7d bug 10 fix: accept cmd.lock_time (default 0n). refund_disagreement path requires
          // tx.lockTime >= deadline + 300 per SS OP_CHECKLOCKTIMEVERIFY; preimage MUST carry the
          // same lockTime since Kaspa sighash binds tx.lockTime — oracle sigs computed over
          // preimage with lockTime=0 would mismatch a final TX with lockTime=deadline+300.
          const { buildSettleTxPreimage } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
          const r = await buildSettleTxPreimage(
            cmd.p2sh_address,
            cmd.required_input_outpoints,
            cmd.outputs,
            wallet.getNetworkId(),
            BigInt(cmd.lock_time || 0),
            cmd.sig_op_counts || null,  // Phase 3 bug 5: per-input sigOpCount (pool [3×spine,0×side])
          );
          // Serialize BigInt → string for IPC pass-through (Q1 C fallback per r242 note)
          const txObjForIpc = JSON.parse(JSON.stringify(r.txObj, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, tx_obj: txObjForIpc, input_count: r.inputCount } });
          }
          return;
        }

        case 'prediction_settle_consensual_build_preimage': {
          // Oracle v0.3 sub 5b-2 (J2-tn dcde95e) — maker_relay builds settle_consensual unsigned TX.
          // Per NWT sub 4 SS PredictionEscrowUnanimous5 settle_consensual entry:
          //   - sigs: maker + taker (= 2 sig, no oracle 涉)
          //   - outputs.length 2: [winner, broker]
          //   - winner-binding explicit verify (J1 #2 C1 fix)
          // Reuses buildSettleTxPreimage with sigOpCounts=[2,2] (= 2 sig per input from maker+taker).
          // 1V1 escrow 2 inputs (= broadcast_tx + taker_escrow_lock_tx) each locked by same P2SH.
          const { buildSettleTxPreimage } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
          // sigOpCounts: each spine input needs 2 sigs (maker + taker) for settle_consensual checkSig
          // (跟 settle_dispute 5 sig 区别). Caller may override via cmd.sig_op_counts.
          const sigOpCounts = cmd.sig_op_counts || cmd.required_input_outpoints.map(() => 2);
          const r = await buildSettleTxPreimage(
            cmd.p2sh_address,
            cmd.required_input_outpoints,
            cmd.outputs,
            wallet.getNetworkId(),
            BigInt(cmd.lock_time || 0),
            sigOpCounts,
          );
          const txObjForIpc = JSON.parse(JSON.stringify(r.txObj, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
          if (cmd.requestId && process.send) {
            // Pass winner param back so caller can fork sign+submit logic
            process.send({ requestId: cmd.requestId, result: { ok: true, tx_obj: txObjForIpc, input_count: r.inputCount, winner: cmd.winner } });
          }
          return;
        }

        case 'prediction_refund_tx': {
          // Phase 4a Sub 9 — build + sign + submit SS refund TX (= maker single sig).
          //   branch 1 (refund_both): 2 inputs (maker_stake + taker_stake) → 2 outputs (maker + taker refund)
          //   branch 2 (refund_maker_unjoined): 1 input (maker_stake only) → 1 output (maker refund)
          // Bettor r240 spec — reuse p2sh.mjs unlockP2SH (branch 2) + new unlockP2SHDual (branch 1).
          const { unlockP2SH, unlockP2SHDual } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
          const redeemScript = new Uint8Array(Buffer.from(cmd.redeem_script_hex, 'hex'));
          // Sub 8.3 Bug 15: SS contract refund branches require(tx.time >= deadline). Pass lock_time from caller (= deadline_seconds).
          const lockTime = BigInt(cmd.lock_time || 0);
          let result;
          if (cmd.branch === 2) {
            // refund_maker_unjoined: 1 input + 1 output
            const r = await unlockP2SH(wallet, cmd.p2sh_address, redeemScript, 2, cmd.maker_address, lockTime);
            result = { ok: true, branch: 2, txId: r.txId, amount: r.amount?.toString() };
          } else if (cmd.branch === 1) {
            // refund_both: 2 inputs + 2 outputs
            const r = await unlockP2SHDual(
              wallet, cmd.p2sh_address, redeemScript, 1,
              cmd.required_input_outpoints,  // [{outpointTxid, outpointIndex}, ...]
              cmd.outputs,                    // [{address, amountSompi: bigint}, ...]
              lockTime,
            );
            result = { ok: true, branch: 1, txId: r.txId };
          } else {
            throw new Error(`Invalid branch ${cmd.branch}, must be 1 (refund_both) or 2 (refund_maker_unjoined)`);
          }
          if (cmd.requestId && process.send) process.send({ requestId: cmd.requestId, result });
          return;
        }

        case 'stake_unlock_tx': {
          // #17 G1 (J1tn r303) — OracleStake_v1 timeout_unlock self-unstake on chain.
          // Single-entry SS contract → scriptSig = [sigPush][redeemScriptPush] NO selector.
          // Caller pass p2sh_address (= computed from stakerPkX+lockUntilDaa), redeem_script_hex,
          // to_address (= staker P2PK), lock_time (= lockUntilDaa, must <= current daa).
          // 红线 8 fee 范围 [1000, 1e8] enforced by SS, JS picks 0.001 KAS = 100000 sompi.
          const { unlockP2SH_SingleEntry } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
          const redeemScript = new Uint8Array(Buffer.from(cmd.redeem_script_hex, 'hex'));
          const lockTime = BigInt(cmd.lock_time || 0);
          const r = await unlockP2SH_SingleEntry(wallet, cmd.p2sh_address, redeemScript, cmd.to_address, lockTime);
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, txId: r.txId, amount: r.amount?.toString() } });
          }
          return;
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

