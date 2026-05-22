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

        case 'pool_settle_tx': {
          // B2 v0.5 Sub 2d Phase 2c step 2b — pool settle TX submit (= cooperative Path A).
          // Inputs: 1 spine UTXO + N side UTXOs
          // Outputs: broker + N winners + maker_extra? + oracle_bond_returns
          // spineSigs: 3 oracle sigs for spine input (= unanimous entry 0)
          // Side inputs auto-unlock via [selector_0 + side_redeem_push] (= settled_via_spine no sigs)
          const { unlockPoolSpineP2SH } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
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
          });
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, txId: r.txId } });
          }
          return;
        }

        case 'prediction_settle_build_preimage': {
          // Phase 4a Sub 8 step 4 (Bettor r242) — maker_relay builds unsigned TX for Phase 2 DM dispatch.
          // Returns tx_obj that voters use as input to sign_input_for_settle IPC.
          const { buildSettleTxPreimage } = await import('./lib/p2sh.mjs');
          const wallet = getWallet();
          const r = await buildSettleTxPreimage(
            cmd.p2sh_address,
            cmd.required_input_outpoints,
            cmd.outputs,
            wallet.getNetworkId(),
            0n,
            cmd.sig_op_counts || null,  // Phase 3 bug 5: per-input sigOpCount (pool [3×spine,0×side])
          );
          // Serialize BigInt → string for IPC pass-through (Q1 C fallback per r242 note)
          const txObjForIpc = JSON.parse(JSON.stringify(r.txObj, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
          if (cmd.requestId && process.send) {
            process.send({ requestId: cmd.requestId, result: { ok: true, tx_obj: txObjForIpc, input_count: r.inputCount } });
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

