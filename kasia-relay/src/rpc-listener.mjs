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
import { decrypt } from './lib/crypto.mjs';
import { deriveAliases } from './lib/alias.mjs';
import { classifyPayload, PREFIX_HEX, PREFIX } from './lib/protocol.mjs';
import { acceptHandshake, sendKaspa, sendMessage } from './chain.mjs';
import { getAIReply } from './ai.mjs';
import { routeMessage } from './router.mjs';
import { loadSeen, saveSeen } from './state.mjs';
import { ingestMessage, ingestReply, ingestTx, ingestHandshake } from './ingest.mjs';

const { RpcClient, Encoding } = kaspa;
const Resolver = kaspa.Resolver || null;  // npm ^0.13.0 removed Resolver

// ── Config ──────────────────────────────────────────────────────────────────

const CONSOLE_URL   = process.env.CONSOLE_URL || '';
const KASPA_NETWORK = process.env.KASPA_NETWORK || 'mainnet';

const RECONNECT_BASE_MS      = 5000;
const RECONNECT_MAX_MS       = 60000;
const BLOCKLIST_INTERVAL_MS  = 30000;
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

let _myAddress = null;
let _myPrivateKeyHex = null;

const _attempted = new Set();
const ATTEMPTED_MAX = 50000;

const _seen = loadSeen();
let _seenDirty = false;
let _seenTimer = null;

let _blocklist = new Set();

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

// ── Connection lifecycle ────────────────────────────────────────────────────

export async function startRpcListener() {
  if (_running) return;
  _running = true;

  const wallet = getWallet();
  _myAddress = wallet.getAddress();
  _myPrivateKeyHex = wallet.getPrivateKey().toString();

  _seenTimer = setInterval(flushSeen, SEEN_FLUSH_INTERVAL_MS);

  // Catch up on missed transactions before subscribing to new blocks
  await catchUpHistory();

  await _connect(wallet);
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
        if (!msg.remoteAddress.startsWith('kaspa:')) continue; // Skip invalid addresses
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
  const networkId = wallet.getNetworkId();
  const directUrl = await resolveRpcUrl();

  const rpcOpts = directUrl
    ? { url: directUrl, encoding: Encoding.Borsh, networkId }
    : Resolver
      ? { resolver: new Resolver(), encoding: Encoding.Borsh, networkId }
      : (() => { throw new Error('No RPC URL configured and Resolver unavailable. Set KASPA_RPC_URL env var.'); })();

  _rpc = new RpcClient(rpcOpts);

  log('connecting to', directUrl || 'resolver...');
  await _rpc.connect({});
  _reconnectAttempt = 0;

  const { isSynced } = await _rpc.getServerInfo();
  log(isSynced ? 'node is synced' : 'WARNING: node is not synced');

  await _rpc.subscribeBlockAdded();
  log('subscribed to new blocks');
  log('watching address:', _myAddress.slice(0, 20) + '...' + _myAddress.slice(-8));
  log('protocol support: handshake, comm, payment');

  if (_blocklistTimer) clearInterval(_blocklistTimer);
  await refreshBlocklist();
  _blocklistTimer = setInterval(refreshBlocklist, BLOCKLIST_INTERVAL_MS);

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
    _scheduleReconnect(wallet);
  });

  log('listening...');
}

function _scheduleReconnect(wallet) {
  if (_reconnecting || !_running) return;
  _reconnecting = true;

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
      log('reconnect failed:', err?.message || err);
      _scheduleReconnect(wallet);
    }
  }, delay);
}

export async function stopRpcListener() {
  _running = false;
  if (_blocklistTimer) { clearInterval(_blocklistTimer); _blocklistTimer = null; }
  if (_seenTimer) { clearInterval(_seenTimer); _seenTimer = null; }
  flushSeen();
  if (_rpc) { try { await _rpc.disconnect(); } catch {} _rpc = null; }
  log('stopped');
}

// ── Block processing ────────────────────────────────────────────────────────

async function handleBlock(event) {
  const block = event?.data?.block;
  if (!block) return;

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

    if (_blocklist.has(senderAddress)) {
      log('BLOCKED — handshake ignored');
      markSeen(txId); // Blocked = intentionally ignored, don't retry
      return;
    }

    // DEDUP 1: in-memory check
    if (!_handshakeAccepted) _handshakeAccepted = new Set();
    if (_handshakeAccepted.has(senderAddress)) {
      log('HANDSHAKE already accepted for', senderAddress.slice(-12), '— skipping (memory dedup)');
      markSeen(txId);
      return;
    }
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

    // Register inbound handshake in Console → triggers pending_actions queue
    ingestMessage({
      traceId: `handshake-in:${txId}`, direction: 'inbound',
      localAddress: _myAddress, remoteAddress: senderAddress,
      txid: txId, messageType: 'handshake', contentText: '',
      theirAlias,
    });

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
          log('HANDSHAKE claim failed for', senderAddress.slice(-12), '— already processing, skipping');
          markSeen(txId);
          return;
        }
      } catch (claimErr) {
        // Claim unreachable — fail-safe: proceed (Console might be slow but alive)
        log('HANDSHAKE claim check failed:', claimErr?.message, '— proceeding');
      }
    }

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
  } catch {
    // Decrypt failed — not for us, mark seen to avoid retrying
    markSeen(txId);
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
        body: JSON.stringify({ network: KASPA_NETWORK, address: senderAddress, tags: 'kbeam_user' }),
      }).catch(() => {});
    } catch {}
    return; // Don't reply, don't ingest — save resources
  }

  // 先判断 senderAddress — 没有确定的发送方地址就不 ingest（避免孤立 conversation）
  if (!senderAddress) {
    log('unknown sender — skipping ingest and reply');
    return;
  }

  // 解包 kanet_chat_v1 结构化广播（JSON 包装保护 UTF-8 中文）
  if (plaintext.startsWith('{"t":"kanet_chat_v1"')) {
    try {
      const chatMsg = JSON.parse(plaintext);
      if (chatMsg.t === 'kanet_chat_v1' && chatMsg.text) {
        plaintext = chatMsg.text;
      }
    } catch (_) { /* fallback 原始内容 */ }
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

  // Send with auto-truncate retry (same pattern as chat broadcast)
  let text = replyText;
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
      if ((errMsg.includes('Insufficient funds') || errMsg.includes('Storage mass')) && attempts < MAX_ATTEMPTS - 1) {
        const target = Math.max(20, Math.floor(text.length * 0.6));
        text = text.slice(0, target).replace(/\s+\S*$/, '') + '...';
        attempts++;
        log(`Storage mass exceeded, retrying with ${text.length} chars (attempt ${attempts + 1})`);
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
