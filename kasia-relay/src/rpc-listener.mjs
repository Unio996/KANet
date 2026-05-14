/**
 * RPC Listener — subscribes to new blocks via local Kaspa node.
 * Full Kasia protocol support: handshake, comm, payment.
 *
 * Architecture:
 *   - Connect to local Kaspa node via WebSocket RPC
 *   - Subscribe to blockAdded events (DAG: ~10 blocks/sec)
 *   - For each tx: classify → dedup → decrypt → process
 *   - Auto-reconnect with exponential backoff on disconnect
 *
 * Environment: RELAY_MODE=rpc to enable (default: indexer)
 */
import * as kaspa from 'kaspa-wasm';
import { getWallet } from './lib/wallet.mjs';
import { decrypt, isValidKaspaAddress } from './lib/crypto.mjs';
import { deriveAliases } from './lib/alias.mjs';
import { classifyPayload, PREFIX_HEX, PREFIX } from './lib/protocol.mjs';
import { acceptHandshake, sendKaspa, sendMessage } from './chain.mjs';
import { getAIReply } from './ai.mjs';
import { routeMessage } from './router.mjs';
import { loadSeen, saveSeen } from './state.mjs';
import { ingestMessage, ingestReply, ingestTx, ingestHandshake, ingestKaspaTx } from './ingest.mjs';

const { RpcClient, Encoding } = kaspa;
const Resolver = kaspa.Resolver || null;  // npm ^0.13.0 removed Resolver

// ── Config ──────────────────────────────────────────────────────────────────

const CONSOLE_URL   = process.env.CONSOLE_URL || '';
const KASPA_NETWORK = process.env.KASPA_NETWORK || 'mainnet';

const RECONNECT_BASE_MS      = 5000;
const RECONNECT_MAX_MS       = 60000;
const BLOCKLIST_INTERVAL_MS  = 30000;
const CATCHUP_RETRY_INTERVAL_MS = 60000;
let _catchupTimer = null;
const WATCHED_REFRESH_MS     = 60000;    // indexer watched addresses refresh
const SEEN_FLUSH_INTERVAL_MS = 5000;

// Minimum hex length for any Kasia payload (shortest prefix = "ciph_msg:" in hex)
const MIN_PAYLOAD_HEX = PREFIX_HEX.LEGACY.length + 2;

// Message types that are sent TO the recipient's address (need toUs check)
const TO_RECIPIENT_TYPES = new Set(['handshake', 'payment']);

// Message types we actively process (self_stash and legacy are ignored by relay)
const PROCESSABLE_TYPES = new Set(['handshake', 'comm', 'payment']);

// ── State ───────────────────────────────────────────────────────────────────

let _rpc = null;
let _running = false;
let _reconnecting = false;
let _reconnectAttempt = 0;
let _blocklistTimer = null;
let _healthTimer = null;
let _walletRef = null;
// T-J2-2026-05-12 #1 — RPC state observability (UI 健康检测 P0 误导 bug fix)
// 给 console UI 探针真反映 relay child 内部 _rpc state, 替 console daemon 自己 RpcClient 测的 misleading /api/config/rpc-status.
let _currentUrl = null;       // 当前 connect 的 URL (directUrl OR resolver-derived)
let _lastConnectedAt = null;  // 最后一次 connect 成功的 epoch ms
let _lastError = null;        // 最后一次 disconnect / health check / reconnect fail 的 message

/**
 * Shared RpcClient accessor — 任何 transaction/broadcast 路径必须用这个,
 * 不再 new RpcClient. 由 _connect/_scheduleReconnect 统一维护.
 */
export function getSharedRpcClient() {
  if (!_rpc) throw new Error('RpcClient not yet connected — call waitForRpc first');
  return _rpc;
}

export function isRpcConnected() {
  return _rpc !== null;
}

// T-J2-2026-05-12 #1 — RPC state observability getter (consumed by relay.mjs IPC 'get_rpc_state', see #2).
// 返 snapshot, 不 expose RpcClient 本身. lastConnectedAt/lastError 给 UI 显示 "30s 前连上" / 最后一次错原因.
export function getRpcState() {
  return {
    connected: _rpc !== null && !_reconnecting,
    reconnecting: _reconnecting,
    attempt: _reconnectAttempt,
    currentUrl: _currentUrl,
    lastConnectedAt: _lastConnectedAt,
    lastError: _lastError,
  };
}

export async function waitForRpc(timeoutMs = 30000) {
  const start = Date.now();
  while (!isRpcConnected() && (Date.now() - start) < timeoutMs) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (!isRpcConnected()) throw new Error(`Shared RpcClient not ready after ${timeoutMs}ms`);
  return _rpc;
}

let _myAddress = null;
let _myPrivateKeyHex = null;

const _attempted = new Set();
const ATTEMPTED_MAX = 50000;

const _seen = loadSeen();
let _seenDirty = false;
let _seenTimer = null;

let _blocklist = new Set();
let _handshakeAccepted = new Set();  // ESM strict mode requires explicit declaration before any assignment

// ── Embedded Kaspa TX indexer state ──
// Watched addresses that we should persist to kaspa_tx_log on every block observation.
// Refreshed periodically from Console /api/indexer/watched-addresses.
let _watchedAddresses = new Set();
let _watchedRefreshTimer = null;
// Dedup for indexed TXs (prevents re-posting the same TX seen in multiple block notifications)
const _indexedTxs = new Set();
const INDEXED_MAX = 20000;

// ── Logging ─────────────────────────────────────────────────────────────────

function log(...args) {
  console.log(new Date().toISOString(), '[rpc]', ...args);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function markSeen(txId) {
  _seen.add(txId);
  _seenDirty = true;
}

function flushSeen() {
  if (!_seenDirty) return;
  _seenDirty = false;
  saveSeen(_seen);
}

function pruneAttempted() {
  if (_attempted.size > ATTEMPTED_MAX) {
    let toDrop = _attempted.size - (ATTEMPTED_MAX / 2);
    for (const id of _attempted) {
      if (toDrop-- <= 0) break;
      _attempted.delete(id);
    }
  }
}

function isToUs(tx) {
  // 漏洞 #9 fix (2026-05-04): 排除自己发的 outbound TX。
  // 旧逻辑: 只看 outputs 含 _myAddress → 自己发握手时找零 output 含自己 → isToUs=true →
  // processHandshake → decrypt 失败 (payload 加密给 peer pubkey, 自己 privkey 解不开) →
  // throw "Unsupported state or unable to authenticate data"。
  // 真 e2e (5/4 J2→Trader-M TX 3f342dee) 漏洞 #3 telemetry 暴露此 bug, events 表 3 行 throw 留痕。
  // 修法: inputs 含 _myAddress = 我们是 sender, 直接 return false 不 process 自己 outbound。
  // 真握手主路径不影响: peer 那边 inputs 不含 _myAddress (sender 是另一方), outputs 含自己 → 仍 return true。
  const inputs = tx?.inputs || [];
  for (const inp of inputs) {
    if (inp?.verboseData?.scriptPublicKeyAddress === _myAddress) return false;
  }
  const outputs = tx?.outputs || [];
  for (const out of outputs) {
    if (out?.verboseData?.scriptPublicKeyAddress === _myAddress) return true;
  }
  return false;
}

function extractSender(tx) {
  const inputs = tx?.inputs || [];
  for (const inp of inputs) {
    const addr = inp?.verboseData?.scriptPublicKeyAddress;
    if (addr && addr !== _myAddress) return addr;
  }
  const outputs = tx?.outputs || [];
  for (const out of outputs) {
    const addr = out?.verboseData?.scriptPublicKeyAddress;
    if (addr && addr !== _myAddress) return addr;
  }
  return null;
}

// Shared RPC utility — extracted to eliminate Relay/Scout duplication
import { resolveRpcUrl as _sharedResolveRpcUrl } from '../../shared/lib/rpc-utils.mjs';
async function resolveRpcUrl() { return _sharedResolveRpcUrl(CONSOLE_URL); }

async function refreshBlocklist() {
  if (!CONSOLE_URL) return;
  try {
    const res = await fetch(
      `${CONSOLE_URL}/api/identity/blocklist?network=${KASPA_NETWORK}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (res.ok) _blocklist = new Set(await res.json());
  } catch {}
}

async function refreshWatchedAddresses() {
  if (!CONSOLE_URL) return;
  try {
    const res = await fetch(
      `${CONSOLE_URL}/api/indexer/watched-addresses?network=${KASPA_NETWORK}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data = await res.json();
      _watchedAddresses = new Set(data.addresses || []);
      // Always watch our own address too (defense in depth)
      if (_myAddress) _watchedAddresses.add(_myAddress);
    }
  } catch {}
}

// Parse TX outputs, index any that send to a watched address.
// Runs BEFORE protocol filter so it's independent of Kasia protocol handling.
function indexBlockTxs(block) {
  if (_watchedAddresses.size === 0) return;

  const blockHash = block?.verboseData?.hash || block?.header?.hash || null;
  const blockTime = block?.header?.timestamp
    ? Math.floor(Number(block.header.timestamp) / 1000)  // ms → s
    : Math.floor(Date.now() / 1000);

  const txs = block.transactions || block.body?.transactions || [];
  for (const tx of txs) {
    const txId = tx?.verboseData?.transactionId || tx?.id;
    if (!txId) continue;

    // Dedup: skip if we've already reported this TX
    if (_indexedTxs.has(txId)) continue;

    const outputs = tx?.outputs || [];
    if (outputs.length === 0) continue;

    // Find outputs to watched addresses
    let matchedRecipient = null;
    let matchedAmountSompi = 0;
    const outputSummary = [];

    for (const out of outputs) {
      const addr = out?.verboseData?.scriptPublicKeyAddress;
      const amountSompi = parseInt(out?.value || '0', 10);
      if (addr) {
        outputSummary.push({ address: addr, amount_sompi: amountSompi });
      }
      if (addr && _watchedAddresses.has(addr)) {
        // Sum all outputs to same watched recipient (some TXs split outputs)
        if (!matchedRecipient) matchedRecipient = addr;
        if (addr === matchedRecipient) matchedAmountSompi += amountSompi;
      }
    }

    if (!matchedRecipient) continue;  // No watched address in outputs → skip

    // Extract best-effort sender from first input
    let fromAddress = null;
    const inputs = tx?.inputs || [];
    for (const inp of inputs) {
      const addr = inp?.verboseData?.scriptPublicKeyAddress;
      if (addr) { fromAddress = addr; break; }
    }

    const amountKas = matchedAmountSompi / 1e8;

    // Fire and forget — ingest.mjs handles backoff on Console failures
    ingestKaspaTx({
      txId,
      blockHash,
      blockTime,
      fromAddress,
      toAddress: matchedRecipient,
      amount: amountKas,
      outputs: outputSummary,
    });

    // Mark indexed so we don't re-report
    _indexedTxs.add(txId);
    if (_indexedTxs.size > INDEXED_MAX) {
      // Drop oldest half (simple eviction)
      let toDrop = _indexedTxs.size - (INDEXED_MAX / 2);
      for (const id of _indexedTxs) {
        if (toDrop-- <= 0) break;
        _indexedTxs.delete(id);
      }
    }
  }
}

// ── Connection lifecycle ────────────────────────────────────────────────────

export async function startRpcListener() {
  if (_running) return;
  _running = true;

  const wallet = getWallet();
  _myAddress = wallet.getAddress();
  _myPrivateKeyHex = wallet.getPrivateKey().toString();

  _seenTimer = setInterval(flushSeen, SEEN_FLUSH_INTERVAL_MS);

  // ── 启动顺序 (2026-04-23 修): 原 catchUpHistory 在 _connect 之前调, 但它内部
  // 通过 sendKaspa 需要 getSharedRpcClient(), 结果 _rpc 是 null, 所有 pending
  // handshake_accept 首次尝试都失败 (Shared RpcClient not ready after 30000ms).
  // 因为 catchUpHistory 只在启动时跑一次, 失败的 pending_action 永远卡死 pending.
  // 修: 先 _connect 建立 RPC, 再 catchUpHistory, 然后加周期性 retry 兜底. ──
  await _connect(wallet);

  // Catch up on missed pending_actions after RPC is ready
  await catchUpHistory();

  // Periodic retry: pending_actions 若失败 (如 RPC 抖动) 每 60s 再试,
  // 直到 retry_count 达 max_retries (默认 3) 才终态 expired
  if (_catchupTimer) clearInterval(_catchupTimer);
  _catchupTimer = setInterval(() => {
    catchUpHistory().catch(err => log('periodic catch-up err:', err?.message || err));
  }, CATCHUP_RETRY_INTERVAL_MS);
}

/**
 * Catch up on missed work by querying Console DB (via HTTP API).
 * Two queries:
 *   1. Pending handshakes — received but never accepted
 *   2. Unreplied messages — received but no AI reply sent
 * No external API dependency — all data from our own DB.
 */
async function catchUpHistory() {
  if (!CONSOLE_URL) { log('catch-up: no CONSOLE_URL, skipping'); return; }

  log('catching up from Console DB...');
  let handshakeCount = 0, messageCount = 0;

  // 1. Pending handshakes — consume from pending_actions queue
  try {
    const hsParams = new URLSearchParams({ network: KASPA_NETWORK });
    if (_myAddress) hsParams.set('address', _myAddress);
    const res = await fetch(
      `${CONSOLE_URL}/ingest/pending-handshakes?${hsParams}`,
      { headers: { 'x-ingest-secret': process.env.INGEST_SECRET || '' }, signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const { handshakes } = await res.json();
      for (const hs of handshakes) {
        if (!hs.remoteAddress || _blocklist.has(hs.remoteAddress)) continue;

        // Optimistic lock: claim via Console API (GET with claim=true atomically sets status='executing')
        // If no id, it's from old code path — skip (shouldn't happen after migration)
        if (!hs.id) { log('catch-up: skipping handshake without id'); continue; }

        try {
          const claimRes = await fetch(
            `${CONSOLE_URL}/ingest/pending-handshakes?claim=${hs.id}`,
            { headers: { 'x-ingest-secret': process.env.INGEST_SECRET || '' }, signal: AbortSignal.timeout(3000) },
          );
          const claimData = await claimRes.json();
          if (!claimData.claimed) {
            log('catch-up: handshake', hs.id.slice(0, 8), 'already claimed — skipping');
            continue;
          }
        } catch {
          log('catch-up: claim failed for', hs.id.slice(0, 8), '— skipping');
          continue;
        }

        try {
          log('catch-up: accepting handshake from', hs.remoteAddress.slice(-12));
          const draft = await acceptHandshake({ address: hs.remoteAddress });
          if (draft?.payload) {
            const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
            log('catch-up: HANDSHAKE ACCEPTED TX:', sent?.txId || sent, 'fee:', sent?.fee);
            ingestTx({ traceId: hs.traceId, txid: sent?.txId, direction: 'outbound', amount: '0.2', fee: sent?.fee, localAddress: _myAddress });
            ingestHandshake({ localAddress: _myAddress, remoteAddress: hs.remoteAddress, txid: sent?.txId, theirAlias: hs.theirAlias || null });
            if (hs.txid) markSeen(hs.txid);
            handshakeCount++;
            // completePendingAction happens on Console side when ingestHandshake(outbound) arrives
          }
        } catch (err) {
          log('catch-up: handshake accept failed:', err?.message || err);
          // Report failure to Console via ingest event
          try {
            await fetch(`${CONSOLE_URL}/ingest/event`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET || '' },
              body: JSON.stringify({ traceId: `catchup-fail:${hs.id}`, eventScope: 'relay', eventType: 'catchup_handshake_failed', source: 'relay', summary: err?.message || 'unknown error' }),
              signal: AbortSignal.timeout(3000),
            });
          } catch {}
        }
      }
    }
  } catch (err) {
    log('catch-up: handshake query failed:', err?.message || err);
  }

  // 2. Unreplied messages — generate AI reply and send
  try {
    const res = await fetch(
      `${CONSOLE_URL}/ingest/unreplied-messages?network=${KASPA_NETWORK}&limit=20`,
      { headers: { 'x-ingest-secret': process.env.INGEST_SECRET || '' }, signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const { messages } = await res.json();
      for (const msg of messages) {
        if (!msg.remoteAddress || !msg.message || _blocklist.has(msg.remoteAddress)) continue;
        // Strict bech32 check — the old startsWith('kaspa:') guard let test
        // fixtures like `kaspa:qqtrustedintro<ts>aaa` through, which then
        // crashed encrypt() and burned brain inference + RPC every restart.
        if (!isValidKaspaAddress(msg.remoteAddress)) {
          log(`catch-up: skip invalid kaspa address ${msg.remoteAddress.slice(0, 30)}…`);
          if (msg.txid) markSeen(msg.txid); // permanent skip, do not poll again
          continue;
        }
        try {
          // Skip if already processed (prevents replay after restart)
          if (msg.txid && _seen.has(msg.txid)) {
            log('catch-up: already seen', msg.txid.slice(0, 12));
            continue;
          }
          log('catch-up: replying to', msg.remoteAddress.slice(-12), msg.message.slice(0, 40));
          await replyToMessage(msg.traceId || msg.txid, msg.remoteAddress, msg.message);
          if (msg.txid) markSeen(msg.txid);
          messageCount++;
        } catch (err) {
          log('catch-up: reply failed:', err?.message || err);
          // Mark as seen even on failure to prevent infinite retry loop
          if (msg.txid) markSeen(msg.txid);
        }
      }
    }
  } catch (err) {
    log('catch-up: message query failed:', err?.message || err);
  }

  // 3. Historical comm messages — 从 kanet_message_index 取未处理的历史 comm TX
  //    按 txid 从链上取 payload → 调 processComm（和实时完全相同的路径）
  let commCount = 0;
  try {
    const res = await fetch(
      `${CONSOLE_URL}/api/discovery/message-index?type=comm&unprocessed=true`,
      { headers: { 'x-ingest-secret': process.env.INGEST_SECRET || '' }, signal: AbortSignal.timeout(10000) },
    );
    if (res.ok) {
      const pendingComms = await res.json();
      if (pendingComms.length > 0) {
        log(`catch-up: ${pendingComms.length} pending historical comm TX`);
      }
      for (const record of pendingComms) {
        try {
          // 从链上按 txid 取完整 TX（链是真相源）
          const txRes = await fetch(
            `https://api.kaspa.org/transactions/${record.txid}`,
            { signal: AbortSignal.timeout(10000) },
          );
          if (!txRes.ok) {
            log(`catch-up comm: API ${txRes.status} for ${record.txid.slice(0, 16)}, skipping`);
            continue;
          }
          const txData = await txRes.json();
          if (!txData?.payload) {
            log(`catch-up comm: no payload for ${record.txid.slice(0, 16)}, skipping`);
            continue;
          }

          // 走和实时完全相同的路径：processComm(txId, payloadHex, null)
          // senderAddress 传 null — processComm 内部用 findAddressByAlias 查 relation_states
          await processComm(record.txid, txData.payload, null);

          // 标记已处理（幂等保护）
          await fetch(
            `${CONSOLE_URL}/api/discovery/message-index/${record.txid}/processed`,
            { method: 'POST', headers: { 'x-ingest-secret': process.env.INGEST_SECRET || '' }, signal: AbortSignal.timeout(5000) },
          ).catch(() => {});

          commCount++;
        } catch (err) {
          log(`catch-up comm: error ${record.txid.slice(0, 16)}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    log('catch-up: historical comm query failed:', err?.message || err);
  }

  log(`catch-up done: ${handshakeCount} handshakes accepted, ${messageCount} messages replied, ${commCount} historical comms processed`);
}

async function _connect(wallet) {
  _walletRef = wallet;
  const networkId = wallet.getNetworkId();
  const directUrl = await resolveRpcUrl();

  const rpcOpts = directUrl
    ? { url: directUrl, encoding: Encoding.Borsh, networkId }
    : Resolver
      ? { resolver: new Resolver(), encoding: Encoding.Borsh, networkId }
      : (() => { throw new Error('No RPC URL configured and Resolver unavailable. Set KASPA_RPC_URL env var.'); })();

  _rpc = new RpcClient(rpcOpts);
  _currentUrl = directUrl || '(resolver)';  // T-J2-2026-05-12 #1 — track URL for getRpcState()

  log('connecting to', directUrl || 'resolver...');
  await _rpc.connect({});
  _reconnectAttempt = 0;
  _lastConnectedAt = Date.now();  // T-J2-2026-05-12 #1
  _lastError = null;              // T-J2-2026-05-12 #1 — clear on success

  const { isSynced } = await _rpc.getServerInfo();
  log(isSynced ? 'node is synced' : 'WARNING: node is not synced');

  await _rpc.subscribeBlockAdded();
  log('subscribed to new blocks');
  log('watching address:', _myAddress.slice(0, 20) + '...' + _myAddress.slice(-8));
  log('protocol support: handshake, comm, payment');

  if (_blocklistTimer) clearInterval(_blocklistTimer);
  await refreshBlocklist();
  _blocklistTimer = setInterval(refreshBlocklist, BLOCKLIST_INTERVAL_MS);

  // Embedded indexer: refresh watched addresses
  await refreshWatchedAddresses();
  _watchedRefreshTimer = setInterval(refreshWatchedAddresses, WATCHED_REFRESH_MS);
  log(`indexer: watching ${_watchedAddresses.size} addresses`);

  let blockCount = 0;
  _rpc.addEventListener('block-added', async (event) => {
    blockCount++;
    if (blockCount <= 3 || blockCount % 1000 === 0) {
      log(`block #${blockCount} (attempted: ${_attempted.size})`);
    }
    try {
      await handleBlock(event);
    } catch (err) {
      log('ERROR in block handler:', err?.message || err);
    }
  });

  _rpc.addEventListener('disconnect', () => {
    log('DISCONNECTED from node');
    _lastError = 'disconnect event';  // T-J2-2026-05-12 #1
    _scheduleReconnect(wallet);
  });

  // Health check: 每 30s ping getServerInfo, 失败立刻 reconnect (补 SDK 不 emit disconnect 的漏洞)
  if (_healthTimer) clearInterval(_healthTimer);
  _healthTimer = setInterval(async () => {
    try {
      await _rpc.getServerInfo();
    } catch (err) {
      const msg = err?.message || String(err);
      log('health check failed:', msg, '— triggering reconnect');
      _lastError = `health check: ${msg}`;  // T-J2-2026-05-12 #1
      _scheduleReconnect(wallet);
    }
  }, 30_000);

  log('listening...');
}

function _scheduleReconnect(wallet) {
  if (_reconnecting || !_running) return;
  _reconnecting = true;
  if (_healthTimer) { clearInterval(_healthTimer); _healthTimer = null; }

  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, _reconnectAttempt),
    RECONNECT_MAX_MS,
  );
  _reconnectAttempt++;
  log(`reconnecting in ${delay / 1000}s (attempt #${_reconnectAttempt})...`);

  setTimeout(async () => {
    _reconnecting = false;
    try {
      if (_rpc) { try { await _rpc.disconnect(); } catch {} }
      _rpc = null;
      await _connect(wallet);
      log('reconnected');
    } catch (err) {
      const msg = err?.message || String(err);
      log('reconnect failed:', msg);
      _lastError = `reconnect: ${msg}`;  // T-J2-2026-05-12 #1
      _scheduleReconnect(wallet);
    }
  }, delay);
}

export async function stopRpcListener() {
  _running = false;
  if (_blocklistTimer) { clearInterval(_blocklistTimer); _blocklistTimer = null; }
  if (_watchedRefreshTimer) { clearInterval(_watchedRefreshTimer); _watchedRefreshTimer = null; }
  if (_seenTimer) { clearInterval(_seenTimer); _seenTimer = null; }
  if (_catchupTimer) { clearInterval(_catchupTimer); _catchupTimer = null; }
  flushSeen();
  if (_rpc) { try { await _rpc.disconnect(); } catch {} _rpc = null; }
  log('stopped');
}

// ── Block processing ────────────────────────────────────────────────────────

async function handleBlock(event) {
  const block = event?.data?.block;
  if (!block) return;

  // Embedded Kaspa TX indexer: record watched-address TXs BEFORE protocol filtering.
  // This is independent of protocol payload — we want to track all value transfers
  // to/from our Agents for later verification, not just Kasia messages.
  try {
    indexBlockTxs(block);
  } catch (err) {
    log('ERROR in indexBlockTxs:', err?.message || err);
  }

  const transactions = block.transactions || block.body?.transactions || [];

  for (const tx of transactions) {
    const txId = tx?.verboseData?.transactionId || tx?.id;
    if (!txId) continue;

    if (_attempted.has(txId) || _seen.has(txId)) continue;

    const payloadHex = tx?.payload;
    if (!payloadHex || payloadHex.length < MIN_PAYLOAD_HEX) continue;

    // Classify by hex prefix — no conversion needed
    const msgType = classifyPayload(payloadHex);
    if (!msgType || !PROCESSABLE_TYPES.has(msgType)) continue;

    // Mark attempted before processing (DAG dedup)
    _attempted.add(txId);

    // For messages sent TO recipient (handshake, payment): verify toUs
    if (TO_RECIPIENT_TYPES.has(msgType) && !isToUs(tx)) continue;

    const senderAddress = extractSender(tx);

    switch (msgType) {
      case 'handshake': await processHandshake(txId, payloadHex, senderAddress); break;
      case 'comm':      await processComm(txId, payloadHex, senderAddress); break;
      case 'payment':   await processPayment(txId, payloadHex, senderAddress, tx); break;
    }
  }

  pruneAttempted();
}

// ── Handshake ───────────────────────────────────────────────────────────────

async function processHandshake(txId, payloadHex, senderAddress) {
  try {
    const encryptedHex = payloadHex.slice(PREFIX_HEX.HANDSHAKE.length);
    const decrypted = await decrypt(Buffer.from(encryptedHex, 'hex'), _myPrivateKeyHex);
    const parsed = JSON.parse(decrypted);

    // Don't markSeen yet — only after accept is confirmed sent
    log('HANDSHAKE from', senderAddress?.slice(-12) || 'unknown', '— alias:', parsed.alias);
    const theirAlias = parsed.alias || null;

    if (!senderAddress) {
      log('HANDSHAKE: no sender address — will retry on next startup');
      return; // Don't mark seen: catch-up will retry
    }

    // Record the inbound handshake TX (observation only — no status advancement)
    ingestTx({ traceId: txId, txid: txId, direction: 'inbound', localAddress: _myAddress });
    log('HANDSHAKE step 1 ingestTx ok');

    if (_blocklist.has(senderAddress)) {
      log('BLOCKED — handshake ignored');
      markSeen(txId); // Blocked = intentionally ignored, don't retry
      return;
    }

    // DEDUP 1: in-memory check
    if (_handshakeAccepted.has(senderAddress)) {
      log('HANDSHAKE already accepted for', senderAddress.slice(-12), '— skipping (memory dedup)');
      markSeen(txId);
      return;
    }
    log('HANDSHAKE step 2 dedup-1 in-memory pass');
    // DEDUP 2: check Console relation_states (persists across restarts)
    if (CONSOLE_URL) {
      try {
        const rs = await fetch(`${CONSOLE_URL}/api/relation/status?local=${encodeURIComponent(_myAddress)}&peer=${encodeURIComponent(senderAddress)}`).then(r => r.json());
        if (rs.status === 'accepted' || rs.status === 'active' || rs.status === 'confirmed') {
          log('HANDSHAKE already', rs.status, 'for', senderAddress.slice(-12), '— skipping (DB dedup)');
          _handshakeAccepted.add(senderAddress);
          markSeen(txId);
          return;
        }
      } catch {}
    }
    log('HANDSHAKE step 3 dedup-2 db pass');

    // Register inbound handshake in Console → triggers pending_actions queue
    ingestMessage({
      traceId: `handshake-in:${txId}`, direction: 'inbound',
      localAddress: _myAddress, remoteAddress: senderAddress,
      txid: txId, messageType: 'handshake', contentText: '',
      theirAlias,
    });
    log('HANDSHAKE step 4 ingestMessage ok');

    // Atomic create + claim: write pending_action and lock it before spending KAS
    // If claim fails, catch-up already took this one — skip sendKaspa
    if (CONSOLE_URL) {
      try {
        const params = new URLSearchParams({
          create_and_claim: '1',
          local_address: _myAddress,
          target_address: senderAddress,
          trigger_txid: txId,
        });
        const claimRes = await fetch(
          `${CONSOLE_URL}/ingest/pending-handshakes?${params}`,
          { headers: { 'x-ingest-secret': process.env.INGEST_SECRET || '' }, signal: AbortSignal.timeout(3000) },
        );
        const claimData = await claimRes.json();
        if (!claimData.claimed) {
          // 漏洞 #6 fix (2026-05-04): 不 markSeen — 让 catch-up 真有 retry 能力。
          // 旧逻辑: claim fail → markSeen → 如果其他 worker 之后也 fail (如 sendKaspa throw),
          // 这笔握手永久死, pending_action 终态 expired 也不会重新唤醒本路径。
          // step 2/3 (memory + DB dedup) 已防真重复 accept, markSeen 是冗余的。
          log('HANDSHAKE claim failed for', senderAddress.slice(-12), '— already processing, will recheck next cycle');
          return;
        }
      } catch (claimErr) {
        // Claim unreachable — fail-safe: proceed (Console might be slow but alive)
        log('HANDSHAKE claim check failed:', claimErr?.message, '— proceeding');
      }
    }
    log('HANDSHAKE step 5 claim ok');

    log('auto-accepting handshake...');
    const draft = await acceptHandshake({ address: senderAddress });
    if (draft?.payload) {
      const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
      log('HANDSHAKE ACCEPTED TX:', sent?.txId || sent, 'fee:', sent?.fee);
      ingestTx({ traceId: txId, txid: sent?.txId, direction: 'outbound', amount: '0.2', fee: sent?.fee, localAddress: _myAddress });
      // Record accept AFTER sendKaspa succeeds, with the REAL outbound txid
      ingestHandshake({ localAddress: _myAddress, remoteAddress: senderAddress, txid: sent?.txId, theirAlias });
      _handshakeAccepted.add(senderAddress);
      markSeen(txId); // Accept sent successfully — safe to mark as done

      // Auto-greet: handshake accepted → send a brief hello via Mind
      try {
        const greeting = await getAIReply(senderAddress, '[SYSTEM: You just accepted a handshake from this address. Send a brief, friendly greeting to introduce yourself.]', txId);
        if (greeting?.trim()) {
          const gDraft = await sendMessage({ address: senderAddress, message: greeting });
          if (gDraft?.payload) {
            const gSent = await sendKaspa({ to: gDraft.to, amount: gDraft.amount, payload: gDraft.payload });
            log('GREETING SENT:', gSent?.txId || gSent);
            ingestTx({ traceId: txId + '-greet', txid: gSent?.txId, direction: 'outbound', fee: gSent?.fee, localAddress: _myAddress });
          }
        }
      } catch (err) {
        log('Greeting failed:', err?.message || err);
      }
    } else {
      log('HANDSHAKE: accept draft failed — will retry on next startup');
    }
  } catch (err) {
    // T1-bugfix-handshake Step 1: log err.message (was silent swallow per NWT r124 architect verdict)
    log(`HANDSHAKE processing failed for ${senderAddress?.slice(-12) || 'unknown'}: ${err?.message || err}`);
    // 漏洞 #3 fix (2026-05-04): outer catch 同步上报到 Console events 表, 让系统级追踪可见。
    // 否则只能挖 Relay log 文件, 系统层完全无痕迹。 catch-up retry 机制不变。
    if (CONSOLE_URL) {
      fetch(`${CONSOLE_URL}/ingest/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET || '' },
        body: JSON.stringify({
          traceId: `handshake-fail:${txId}`,
          eventScope: 'relay',
          eventType: 'handshake_processing_failed',
          source: 'relay',
          level: 'error',
          summary: `processHandshake throw txId=${txId.slice(0,12)} sender=${senderAddress?.slice(-12) || 'unknown'}: ${err?.message || err}`,
          agentAddress: _myAddress,
        }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    }
    // T1-bugfix-handshake Step 3 (iii) design fix per NWT r130: NOT markSeen on silent throw — catch-up retries next cycle.
    // Risk mitigation: if throw is deterministic, infinite retry — revert + add retry-counter cap if observed.
  }
}

// ── Comm message ────────────────────────────────────────────────────────────

async function processComm(txId, payloadHex, senderAddress) {
  let payloadUtf8;
  try { payloadUtf8 = Buffer.from(payloadHex, 'hex').toString('utf-8'); }
  catch { return; }

  const colonPos = payloadUtf8.indexOf(':', PREFIX.COMM.length);
  if (colonPos === -1) return;

  const alias = payloadUtf8.slice(PREFIX.COMM.length, colonPos);
  const encodedContent = payloadUtf8.slice(colonPos + 1);
  if (!alias || !encodedContent) return;

  // Decrypt — if it fails, this message is not for us (comm is self-send,
  // so ALL comm messages on chain pass through here; only ours will decrypt).
  let plaintext;
  try {
    plaintext = await decrypt(Buffer.from(encodedContent, 'base64'), _myPrivateKeyHex);
  } catch {
    // Normal: this comm was encrypted for someone else, not us. Skip silently.
    return;
  }

  markSeen(txId);

  if (!senderAddress) senderAddress = await findAddressByAlias(alias);

  log('RX', txId.slice(0, 16) + '...', plaintext.slice(0, 60));
  log('from:', senderAddress?.slice(-12) || 'unknown');

  // Skip self-send: comm TX is self-send by protocol, so extractSender often
  // returns our own address. If sender = self, this is our OWN outbound reply
  // being detected — DO NOT reply to it (prevents infinite loop).
  // Also skip when sender unknown + content is broadcast — extractSender fails on
  // self-send comm, but successful decryption + bcast: prefix means it's ours.
  if (senderAddress === _myAddress || (!senderAddress && plaintext?.startsWith('bcast:'))) {
    log('SELF-SEND comm detected — skipping (not a real inbound message)');
    return;
  }

  if (senderAddress && _blocklist.has(senderAddress)) {
    log('BLOCKED:', senderAddress, '— dropping');
    return;
  }

  // Detect KBeam-style double encryption: Kasia layer decrypted OK,
  // but content is KBeam's application-layer cipher ({"ct":"...","kid":"kbeam_..."}).
  // We can't read the actual text, but we know it's a real message for us.
  if (plaintext.startsWith('{"ct"') || plaintext.startsWith('{"iv"')) {
    log('KBeam user detected:', senderAddress?.slice(-12), '— tagging and skipping');
    // Tag as kbeam_user so we never waste handshakes on them
    try {
      fetch(`${process.env.CONSOLE_URL || 'http://localhost:3100'}/api/identity/annotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET || '' },
        body: JSON.stringify({ network: 'mainnet', address: senderAddress, tags: 'kbeam_user' }),
      }).catch(() => {});
    } catch {}
    return; // Don't reply, don't ingest — save resources
  }

  // 先判断 senderAddress — 没有确定的发送方地址就不 ingest（避免孤立 conversation）
  if (!senderAddress) {
    log('unknown sender — skipping ingest and reply');
    return;
  }

  // senderAddress 确认有效后，才 ingest
  const _msgType = plaintext && /^\s*\{/.test(plaintext) && plaintext.includes('"query_card"') ? 'query_card' : 'text';
  ingestMessage({
    traceId: txId, localAddress: _myAddress,
    remoteAddress: senderAddress, txid: txId, message: plaintext, messageType: _msgType,
  });
  ingestTx({ traceId: txId, txid: txId, direction: 'inbound', localAddress: _myAddress });

  await replyToMessage(txId, senderAddress, plaintext);
}

// ── Payment ─────────────────────────────────────────────────────────────────

async function processPayment(txId, payloadHex, senderAddress, tx) {
  // Payment format varies by client:
  //   A) Full hex: prefix hex + encrypted hex (like handshake)
  //   B) UTF-8+base64: "ciph_msg:1:payment:{base64_encrypted}"
  // Try hex first (more common from mobile clients), then base64 fallback

  const encryptedHex = payloadHex.slice(PREFIX_HEX.PAYMENT.length);
  if (!encryptedHex) return;

  let decrypted;

  // Strategy A: treat remaining payload as raw hex-encoded encrypted bytes
  try {
    decrypted = await decrypt(Buffer.from(encryptedHex, 'hex'), _myPrivateKeyHex);
  } catch {
    // Strategy B: decode full payload as utf8, then base64
    try {
      const payloadUtf8 = Buffer.from(payloadHex, 'hex').toString('utf-8');
      const b64Content = payloadUtf8.slice(PREFIX.PAYMENT.length);
      if (!b64Content) return;
      decrypted = await decrypt(Buffer.from(b64Content, 'base64'), _myPrivateKeyHex);
    } catch { return; }
  }

  // Parse payment JSON
  let payment;
  try { payment = JSON.parse(decrypted); }
  catch { payment = { message: decrypted }; }

  markSeen(txId);

  // Calculate received amount from outputs to our address
  // kaspa-wasm returns amount as BigInt directly or as a numeric value
  let receivedSompi = 0n;
  const outputs = tx?.outputs || [];
  for (const out of outputs) {
    if (out?.verboseData?.scriptPublicKeyAddress === _myAddress) {
      const amt = out.amount ?? out.value ?? 0;
      try { receivedSompi += BigInt(amt); } catch { /* skip */ }
    }
  }
  const receivedKas = Number(receivedSompi) / 1e8;

  const msg = payment.message || '';
  log('PAYMENT from', senderAddress?.slice(-12) || 'unknown',
    `— ${receivedKas} KAS`, msg ? `msg: "${msg.slice(0, 60)}"` : '(no message)');

  if (senderAddress && _blocklist.has(senderAddress)) {
    log('BLOCKED — payment ignored');
    return;
  }

  // Ingest as a payment message
  const paymentText = msg
    ? `[Payment: ${receivedKas} KAS] ${msg}`
    : `[Payment: ${receivedKas} KAS]`;

  if (!senderAddress) {
    log('payment: unknown sender (verboseData missing) — skipping ingest');
    return;
  }

  ingestMessage({
    traceId: txId, localAddress: _myAddress,
    remoteAddress: senderAddress, txid: txId, message: paymentText,
  });
  ingestTx({ traceId: txId, txid: txId, direction: 'inbound', localAddress: _myAddress });

  // Reply acknowledging payment
  await replyToMessage(txId, senderAddress, paymentText);
}

// ── Shared reply logic ──────────────────────────────────────────────────────

async function replyToMessage(txId, senderAddress, messageText) {
  // Defense in depth: every send path eventually calls encrypt() which throws
  // hard on non-bech32 addresses. Validate once at the entry so any caller
  // (catch-up loop, processComm, processPayment, future ones) is protected.
  if (!isValidKaspaAddress(senderAddress)) {
    log(`replyToMessage: skip invalid kaspa address ${(senderAddress || '').slice(0, 30)}…`);
    return;
  }
  const { agent } = routeMessage(messageText);
  log('ROUTE →', agent);

  let replyText;
  try {
    replyText = await getAIReply(senderAddress, messageText, txId);
  } catch (e) {
    log('AI ERROR:', e.message);
  }
  if (!replyText) {
    log('No reply for', senderAddress.slice(-12), '— silent');
    return;
  }
  log('AI →', replyText.slice(0, 80));

  // Guardrail: cap message length (fee + sanity)
  let text = replyText;
  if (text.length > 5000) {
    text = text.slice(0, 5000).replace(/\s+\S*$/, '') + ' [...]';
    log(`Message capped: ${replyText.length} → ${text.length} chars`);
  }
  let attempts = 0;
  const MAX_ATTEMPTS = 4;

  while (attempts < MAX_ATTEMPTS) {
    try {
      const draft = await sendMessage({ address: senderAddress, message: text });
      if (!draft?.payload) {
        log('Draft failed:', draft);
        return;
      }
      const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
      log('TX SENT:', sent?.txId || sent, 'fee:', sent?.fee);
      ingestTx({ traceId: txId, txid: sent?.txId, direction: 'outbound', fee: sent?.fee, localAddress: _myAddress });
      const _replyMsgType = text && /^\s*\{/.test(text) && text.includes('"query_card"') ? 'query_card' : 'text';
      ingestMessage({
        traceId: `reply-out:${sent?.txId || txId}`,
        direction: 'outbound',
        localAddress: _myAddress,
        remoteAddress: senderAddress,
        txid: sent?.txId,
        message: text,
        messageType: _replyMsgType,
      });
      ingestReply({ traceId: txId, replyText, sentTxid: sent?.txId || null });
      if (attempts > 0) log(`Reply sent after ${attempts + 1} attempts (${text.length} chars)`);
      return;
    } catch (err) {
      const errMsg = err?.message || err?.toString?.() || '';
      // Bug A 5/14 RCA — UTXO race recovery on reply path (mirror relay.mjs:428 send_broadcast).
      // Owner 8:51 实测 BSC menu: broker-v3 publish 广播 + reply DM 3 ms apart 撞同 UTXO →
      // RPC reject 'already spent ... in the mempool' → 旧 catch 不识别 → 静默 'Reply send failed'
      // → user 0 reply. 配合 transaction.mjs _utxoKey RCA fix, 此 catch 是 belt-and-suspenders.
      const isMempoolReject = /already spent.*?in the mempool|already spent by transaction/i.test(errMsg);
      if (isMempoolReject && attempts < MAX_ATTEMPTS - 1) {
        const m = errMsg.match(/\(([a-f0-9]{64}):?(\d*)\)/i);
        if (m) {
          const { markUtxoSpentByOutpoint } = await import('./lib/transaction.mjs');
          markUtxoSpentByOutpoint(m[1], m[2] ? Number(m[2]) : 0);
        }
        attempts++;
        const sleepMs = attempts * 2000;  // 2/4/6s backoff (短于 bcast — reply 时效敏感)
        log(`⚠ Reply mempool reject, sleep ${sleepMs}ms before retry (attempt ${attempts + 1}/${MAX_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, sleepMs));
      } else if ((errMsg.includes('Insufficient funds') || errMsg.includes('Storage mass')) && attempts < MAX_ATTEMPTS - 1) {
        const target = Math.max(20, Math.floor(text.length * 0.9));
        text = text.slice(0, target).replace(/\s+\S*$/, '') + '...';
        attempts++;
        log(`⚠ Storage mass fallback, retrying with ${text.length} chars (attempt ${attempts + 1}/${MAX_ATTEMPTS})`);
      } else {
        log('Reply send failed:', errMsg);
        return;
      }
    }
  }
}

// ── Alias lookup ────────────────────────────────────────────────────────────

async function findAddressByAlias(alias) {
  if (!alias || !CONSOLE_URL) return null;
  try {
    // 直接查 relation_states.their_alias（握手时存入，跨钱包兼容）
    const res = await fetch(
      `${CONSOLE_URL}/api/discovery/alias-lookup?alias=${encodeURIComponent(alias)}&localAddress=${encodeURIComponent(_myAddress)}`,
      { headers: { 'x-ingest-secret': process.env.INGEST_SECRET || '' }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.peerAddress || null;
  } catch {}
  return null;
}

/**
 * 外部触发 reconnect — 供 transaction.mjs 在 WS 错误时调用.
 * 幂等: 正在 reconnecting 会 no-op.
 */
export function triggerReconnect(reason = 'external') {
  log('external reconnect trigger:', reason);
  if (_walletRef) _scheduleReconnect(_walletRef);
}
