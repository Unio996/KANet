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

function post(path, body) {
  if (!CONSOLE_URL || !INGEST_SECRET) return;

  const now = Date.now();
  if (_failCount >= BACKOFF_THRESHOLD && now < _backoffUntil) return; // skip silently

  fetch(`${CONSOLE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  }).then(() => {
    if (_failCount > 0) {
      console.log(new Date().toISOString(), "[ingest] Console recovered");
      _failCount = 0;
    }
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

/** Record a broadcasted on-chain TX (inbound receipt or outbound send). */
export function ingestTx({ traceId, txid, direction = "outbound", amount = null, fee = null, localAddress = null }) {
  post("/ingest/tx", {
    traceId,
    network: RELAY_NETWORK,
    direction,
    txid,
    amount,
    fee,
    localAddress,
    status: "broadcasted",
  });
}
