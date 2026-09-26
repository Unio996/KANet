// src/ingest.mjs — relay side kasia-console ingest client
// All calls are fire-and-forget: failures are logged but NEVER throw.
// Relay continues normally even if console is unreachable.

const CONSOLE_URL    = process.env.CONSOLE_URL    || "";
const INGEST_SECRET  = process.env.INGEST_SECRET  || "";
const RELAY_NETWORK  = process.env.KASPA_NETWORK  || "mainnet";

// ── Simple backoff: skip calls when Console is unreachable ──────────────────
let _failCount = 0;
let _backoffUntil = 0;
const BACKOFF_THRESHOLD = 5;     // consecutive failures before backing off
const BACKOFF_BASE_MS   = 10000; // 10s initial backoff
const BACKOFF_MAX_MS    = 60000; // 60s max backoff

// 2026-08-29 (J2, broker-money-path 阶段 3; L2 期 1 保守 coverage 设计 fd146fe2 §2-1, NWT GREEN):
//   post() 改为【返回 promise】—— 之前不返回, 调用方根本不知成败 = coverage over-claim 的机械根源。
//   语义不变: 仍 fire-and-forget 友好 (promise 【永不 reject】, 失败 resolve {ok:false}), 既有调用方忽略返回值零影响;
//   需要成败的调用方 (rpc-listener 的 coverage 推进) await 它。backoff 期跳过 ⇒ {ok:false, skipped:true}。
//   非 2xx 也算失败 (之前 .then 不看状态码 ⇒ 4xx/5xx 被当成功 ⇒ 也是 over-claim 源)。
function post(path, body) {
  if (!CONSOLE_URL || !INGEST_SECRET) return Promise.resolve({ ok: false, skipped: true, reason: 'ingest_disabled' });

  const now = Date.now();
  if (_failCount >= BACKOFF_THRESHOLD && now < _backoffUntil) return Promise.resolve({ ok: false, skipped: true, reason: 'backoff' }); // skip silently

  return fetch(`${CONSOLE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (_failCount > 0) {
      console.log(new Date().toISOString(), "[ingest] Console recovered");
      _failCount = 0;
    }
    return { ok: true, status: res.status };
  }).catch(e => {
    _failCount++;
    if (_failCount === BACKOFF_THRESHOLD) {
      const backoff = Math.min(BACKOFF_BASE_MS * Math.pow(2, 0), BACKOFF_MAX_MS);
      _backoffUntil = Date.now() + backoff;
      console.warn(new Date().toISOString(), `[ingest] Console unreachable (${_failCount} failures), backing off ${backoff / 1000}s`);
    } else if (_failCount > BACKOFF_THRESHOLD) {
      const backoff = Math.min(BACKOFF_BASE_MS * Math.pow(2, _failCount - BACKOFF_THRESHOLD), BACKOFF_MAX_MS);
      _backoffUntil = Date.now() + backoff;
    } else {
      console.warn(new Date().toISOString(), "[ingest] warn:", e.message);
    }
    return { ok: false, error: String(e?.message || e) };   // 永不 reject (fire-and-forget 调用方安全); coverage 推进据 ok=false 不推进
  });
}

/** Record an incoming (inbound) or outgoing (outbound) message. */
export function ingestMessage({ traceId, localAddress, remoteAddress, txid, message, direction = "inbound", messageType = "text" }) {
  post("/ingest/message", {
    traceId,
    network: RELAY_NETWORK,
    direction,
    localAddress,
    remoteAddress,
    txid,
    messageType,
    contentText: message,
  });
}

/** Record an AI reply returned for a message. */
export function ingestReply({ traceId, replyText, status = "sent", sentTxid = null }) {
  post("/ingest/reply", {
    traceId,
    replyType: "ai",
    provider: "openclaw",
    replyText,
    status,
    sentTxid,
  });
}

/**
 * Record a handshake — outbound (accept) + event.
 * Inbound handshake is recorded by Scout (avoids triple-write to messages table).
 *
 * 主动握手和被动握手都走同一逻辑：Relay 发 TX 后记 outbound accept。
 * 区别在于触发方式不同（被动=auto-detect，主动=IPC command），但 ingest 结果相同。
 */
export function ingestHandshake({ localAddress, remoteAddress, txid, theirAlias }) {
  const ts = txid || Date.now();
  post("/ingest/message", {
    traceId: `handshake-out:${ts}`,
    network: RELAY_NETWORK,
    direction: "outbound",
    localAddress,
    remoteAddress,
    txid: txid || null,
    messageType: "handshake",
    contentText: "",
    theirAlias: theirAlias || null,
  });
  post("/ingest/event", {
    traceId: `handshake:${ts}`,
    eventScope: "relay",
    eventType: "handshake_accepted",
    source: "relay",
    level: "info",
    summary: `Handshake with: ${remoteAddress}`,
  });
}

/** Record a broadcasted on-chain TX (inbound receipt or outbound send). targetAddress (F5, J2 2026-09-13): 收款地址, 对账器用。 */
export function ingestTx({ traceId, txid, direction = "outbound", amount = null, fee = null, localAddress = null, targetAddress = null }) {
  post("/ingest/tx", {
    traceId,
    network: RELAY_NETWORK,
    direction,
    txid,
    amount,
    fee,
    localAddress,
    targetAddress,
    status: "broadcasted",
  });
}

/**
 * (c) F2 两阶段回执 (J2 2026-09-13): 与 post() 不同, 这个【等】console 2xx 并在失败时 throw —— relay 在广播之前调 phase='prepared'
 * (带确定性 txid + 已签名交易字节), console 没落表就不许广播(fail-closed: NO TX 而不是"发了没人记")。phase='submitted' 广播后调,
 * 失败只 warn(IPC 回执也带 txId, console 侧照样落 submitted)。不走 post() 的 backoff 静默跳过——静默跳过 = 发了没记, 正是要根治的病。
 */
export async function ingestSubmitIntentPhase({ intentKey, phase, txid, txJson = null }, timeoutMs = 5000) {
  if (!CONSOLE_URL || !INGEST_SECRET) throw new Error("intent persistence unavailable: CONSOLE_URL / INGEST_SECRET unset");
  const res = await fetch(`${CONSOLE_URL}/ingest/submit-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body: JSON.stringify({ intentKey, phase, txid, txJson }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).slice(0, 200); } catch {}
    throw new Error(`intent ${phase} not recorded by console: HTTP ${res.status} ${detail}`);
  }
  return true;
}

/**
 * covenant_broadcast 两阶段回执 (J2 2026-09-14, 设计 §9.5, ledger 1366) —— 与 ingestSubmitIntentPhase
 * 同款语义(等 2xx, 失败 throw, 不走 post() 的静默 backoff), 但打的是独立端点/独立表(proto_bet_intents,
 * 不是 submit_intents), 且必须带 relay_id(= process.env.RELAY_NODE_ID, 这个 relay 自己的身份)——
 * console 侧会核对它是否等于 PROTO_RELAY_ID, 不等则 403(生产 relay 永远打不进这张表)。
 */
export async function ingestProtoBetIntentPhase({ intentKey, phase, txid, txJson = null }, timeoutMs = 5000) {
  if (!CONSOLE_URL || !INGEST_SECRET) throw new Error("proto bet intent persistence unavailable: CONSOLE_URL / INGEST_SECRET unset");
  const relay_id = process.env.RELAY_NODE_ID || "";
  const res = await fetch(`${CONSOLE_URL}/ingest/proto-bet-intent-phase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body: JSON.stringify({ relay_id, intentKey, phase, txid, txJson }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).slice(0, 200); } catch {}
    throw new Error(`proto bet intent ${phase} not recorded by console: HTTP ${res.status} ${detail}`);
  }
  return true;
}

/**
 * Report a Kaspa TX observed in a block to the embedded indexer.
 * Relay pre-filters TXs against watched addresses; Console writes to kaspa_tx_log.
 * Phase 1 stress test S10B drove this — RPC UTXO verification is fragile after spend.
 */
export function ingestKaspaTx({ txId, blockHash, blockTime, fromAddress, toAddress, amount, outputs }) {
  return post("/ingest/kaspa-tx", {
    txId,
    blockHash: blockHash || null,
    blockTime: blockTime || null,
    fromAddress: fromAddress || null,
    toAddress,
    amount,
    outputs: outputs || null,
    network: RELAY_NETWORK,
  });
}

/**
 * Record a finality-safe SPC (selected-parent-chain) block into the persistent
 * daaScore→hash index (docs/2026-07-08-backward-walk-daa-index-design.md §2.2).
 * Caller (rpc-listener.mjs) only invokes this for blocks past FINALITY_DEPTH,
 * so reorg cannot invalidate the (daaScore, blockHash) binding once written.
 */
export function ingestSpcDaaBlock({ daaScore, blockHash, timestampMs }) {
  post("/ingest/spc-daa-block", {
    daaScore,
    blockHash,
    timestampMs,
    network: RELAY_NETWORK,
  });
}

/**
 * 2026-08-29 (J2, L2 期 1 保守 coverage, 设计 fd146fe2 §2): 推进 kaspa_tx_log_coverage 账。
 * 🔴 调用方 (rpc-listener) 只在【该 finality-safe 块全部命中 tx 的 ingestKaspaTx 都 ok】后才调 —— 推进是唯一写法, 掉帖 = 不推进 = 洞。
 * 本 POST 自身失败也 = 洞 (方向安全)。indexer 标识 = 'relay:<RELAY_NODE_ID>' (relay-manager 下发), 缺则 'relay:unknown'。
 */
export function ingestCoverageAdvance({ daaScore, addresses }) {
  return post("/ingest/coverage-advance", {
    daaScore,
    addresses,
    indexer: `relay:${process.env.RELAY_NODE_ID || "unknown"}`,
    network: RELAY_NETWORK,
  });
}

/**
 * Periodic tip heartbeat so Console can detect a stalled spc_daa_index writer
 * (docs/2026-07-08-backward-walk-daa-index-design.md §2.2 note①/④) without
 * Console ever touching kaspad RPC directly (Relay = sole on-chain egress).
 */
export function ingestSpcTipHeartbeat({ daaScore }) {
  post("/ingest/spc-tip-heartbeat", {
    daaScore,
    network: RELAY_NETWORK,
  });
}
