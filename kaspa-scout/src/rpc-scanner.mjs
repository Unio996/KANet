/**
 * RPC Scanner v2 — Observable Mode
 *
 * Subscribes to new blocks via Kaspa node RPC.
 * Passive observation only: detects ALL Kasia protocol activity,
 * extracts addresses, classifies message types, and reports to Console.
 *
 * v2 — every Kasia hit is logged. No silent failures.
 *   - getBlock() supplement for reliable address extraction
 *   - Card/bcast parse failures logged with raw data
 *   - Periodic stats summary
 */
import * as kaspa from 'kaspa-wasm';
import { classifyPayload, PREFIX, PREFIX_HEX, MIN_PAYLOAD_HEX } from './lib/protocol.mjs';
import { tryIndex, updateCheckpoint } from './message-indexer.mjs';

const { RpcClient, Encoding, ScriptPublicKey, Address } = kaspa;
const Resolver = kaspa.Resolver || null;
// addressFromScriptPublicKey removed in npm ^0.13.0 — use Address(spk, prefix) instead
function addressFromScriptPublicKey(spk, networkPrefix) {
  try { return new Address(spk, networkPrefix); } catch { return null; }
}

// ── Config ──────────────────────────────────────────────────────────────────

const KASPA_NETWORK    = process.env.KASPA_NETWORK || 'mainnet';
const CONSOLE_URL      = process.env.CONSOLE_URL || '';
// Discovery data is now a shared KANet resource — no longer tied to a specific relay account.
// SCOUT_RELAY_NODE_ID is kept for backward compat but no longer sent in discovery payloads.
const _RELAY_NODE_ID_UNUSED = process.env.SCOUT_RELAY_NODE_ID || null;

// Local addresses — messages TO these addresses get ingested into Console DB
// so relay catch-up always has complete data (no blind spots when relay was down).
let _localAddresses = new Set();

const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS  = 60000;
const STATS_EVERY       = 1000; // log stats every N blocks
// Heartbeat stall detector — TN12 produces blocks continuously (~10 bps).
// The 'disconnect' event does NOT fire on a silent WS death (half-open TCP / node vanished),
// so an event-driven reconnect alone leaves the scanner frozen forever (root cause of the
// 06:11 receive outage). If no block arrives within BLOCK_STALL_MS, force a reconnect.
const HEARTBEAT_CHECK_MS = 30000;
const BLOCK_STALL_MS     = 90000;

// ── State ───────────────────────────────────────────────────────────────────

let _rpc = null;
let _running = false;
let _reconnecting = false;
let _reconnectAttempt = 0;
let _lastBlockAt = 0;        // heartbeat: timestamp of last block-added event
let _heartbeatTimer = null;  // stall detector for silent WS death
let _reporter = null;        // stashed so the heartbeat can force a reconnect

// DAG dedup: same txId appears in many blocks
const _attempted = new Set();
const ATTEMPTED_MAX = 50000;

// ── Counters ────────────────────────────────────────────────────────────────

const _stats = {
  blocks: 0,
  kasiaHits: 0,
  byType: {},       // { handshake: N, comm: N, bcast: N, ... }
  addrOk: 0,
  addrFail: 0,
  verboseFetch: 0,
  verboseHit: 0,
  verboseMiss: 0,
  cardOk: 0,
  cardFail: 0,
  bcastOk: 0,
  bcastFail: 0,
  reportOk: 0,
  reportFail: 0,
};

// ── Logging ─────────────────────────────────────────────────────────────────

function log(...args) {
  console.log(new Date().toISOString(), '[rpc-scout]', ...args);
}

function logStats() {
  const types = Object.entries(_stats.byType)
    .map(([k, v]) => `${k}=${v}`).join(' ') || '(none)';
  log(`== STATS (${_stats.blocks} blocks) ==`);
  log(`  kasia: ${_stats.kasiaHits} [${types}]`);
  log(`  addr: ok=${_stats.addrOk} fail=${_stats.addrFail} | verbose: ${_stats.verboseHit}/${_stats.verboseFetch} ok`);
  log(`  card: ok=${_stats.cardOk} fail=${_stats.cardFail} | bcast: ok=${_stats.bcastOk} fail=${_stats.bcastFail}`);
  log(`  report: ok=${_stats.reportOk} fail=${_stats.reportFail} | dedup-set: ${_attempted.size}`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function pruneAttempted() {
  if (_attempted.size > ATTEMPTED_MAX) {
    let toDrop = _attempted.size - (ATTEMPTED_MAX / 2);
    for (const id of _attempted) {
      if (toDrop-- <= 0) break;
      _attempted.delete(id);
    }
  }
}

// ── Address resolution ──────────────────────────────────────────────────────

/**
 * Resolve an address from a transaction output.
 * Returns { address, source, reason? }.
 */
function resolveOutputAddress(out) {
  // Fast path: verboseData available (from getBlock RPC)
  const verbose = out?.verboseData?.scriptPublicKeyAddress;
  if (verbose) return { address: verbose, source: 'verbose' };

  // Fallback: derive from scriptPublicKey (block-added events lack verboseData)
  const spk = out?.scriptPublicKey;
  if (!spk) return { address: null, source: 'none', reason: 'no-scriptPublicKey' };

  try {
    const addr = addressFromScriptPublicKey(
      typeof spk === 'string'
        ? new ScriptPublicKey(0, spk)
        : new ScriptPublicKey(spk.version ?? 0, spk.script),
      KASPA_NETWORK,
    );
    if (addr) return { address: addr.toString(), source: 'spk-derive' };
    return { address: null, source: 'spk-derive', reason: 'returned-null' };
  } catch (err) {
    return { address: null, source: 'spk-derive', reason: err.message };
  }
}

/**
 * Extract all unique addresses from a transaction.
 * Returns { inputAddresses, outputAddresses, addrSource, failures[] }.
 */
export function extractAddresses(tx) {
  const inputAddresses = new Set();
  const outputAddresses = new Set();
  const failures = [];
  let addrSource = 'event';

  for (const inp of (tx?.inputs || [])) {
    const addr = inp?.verboseData?.scriptPublicKeyAddress;
    if (addr) inputAddresses.add(addr);
  }

  for (const out of (tx?.outputs || [])) {
    const { address, source, reason } = resolveOutputAddress(out);
    if (address) {
      outputAddresses.add(address);
      if (source === 'verbose') addrSource = 'verbose';
    } else {
      failures.push(reason || 'unknown');
    }
  }

  return {
    inputAddresses: [...inputAddresses],
    outputAddresses: [...outputAddresses],
    addrSource,
    failures,
  };
}

/**
 * Derive sender and receiver from extracted addresses.
 */
export function derivePeers(inputAddresses, outputAddresses, msgType) {
  if (msgType === 'handshake' || msgType === 'payment') {
    const sender = inputAddresses[0] || outputAddresses[1] || outputAddresses[0] || null;
    const receiver = outputAddresses.find(a => a !== sender) || null;
    return { sender, receiver };
  }
  // comm/self_stash/legacy: self-send
  const sender = outputAddresses[0] || inputAddresses[0] || null;
  return { sender, receiver: null };
}

// ── Agent Card parsing ──────────────────────────────────────────────────────

const CARD_MAX_BYTES = 1024;

/**
 * Parse a KANet Agent Card from hex payload.
 * Returns { card, error?, raw? }.
 */
export function parseCardPayload(payloadHex) {
  const bodyHex = payloadHex.slice(PREFIX_HEX.KANET_CARD.length);
  let bodyUtf8;
  try {
    bodyUtf8 = Buffer.from(bodyHex, 'hex').toString('utf-8');
  } catch (err) {
    return { card: null, error: `hex-decode: ${err.message}` };
  }

  if (Buffer.byteLength(bodyUtf8, 'utf-8') > CARD_MAX_BYTES) {
    return { card: null, error: `too-large(${Buffer.byteLength(bodyUtf8, 'utf-8')}b)` };
  }

  let card;
  try {
    card = JSON.parse(bodyUtf8);
  } catch (err) {
    return { card: null, error: `json: ${err.message}`, raw: bodyUtf8.slice(0, 120) };
  }

  if (typeof card.version !== 'number') return { card: null, error: 'missing version', raw: bodyUtf8.slice(0, 120) };
  if (!['public', 'mixed', 'private'].includes(card.mode)) return { card: null, error: `bad mode="${card.mode}"`, raw: bodyUtf8.slice(0, 120) };
  if (typeof card.entity_type !== 'string') return { card: null, error: 'missing entity_type', raw: bodyUtf8.slice(0, 120) };
  if (typeof card.timestamp !== 'number') return { card: null, error: 'missing timestamp', raw: bodyUtf8.slice(0, 120) };

  if ((card.mode === 'public' || card.mode === 'mixed') &&
      (!card.name || !Array.isArray(card.skills))) {
    return { card: null, error: 'public/mixed missing name or skills', raw: bodyUtf8.slice(0, 120) };
  }

  return { card, error: null };
}

/**
 * Parse a broadcast message from hex payload.
 * Returns { bcast, error?, raw? }.
 */
export function parseBcastPayload(payloadHex) {
  const bodyHex = payloadHex.slice(PREFIX_HEX.BCAST.length);
  let bodyUtf8;
  try {
    bodyUtf8 = Buffer.from(bodyHex, 'hex').toString('utf-8');
  } catch (err) {
    return { bcast: null, error: `hex-decode: ${err.message}` };
  }

  const colonIdx = bodyUtf8.indexOf(':');
  if (colonIdx === -1) return { bcast: null, error: 'no channel separator', raw: bodyUtf8.slice(0, 80) };

  const channelName = bodyUtf8.slice(0, colonIdx);
  const message = bodyUtf8.slice(colonIdx + 1);

  if (!channelName) return { bcast: null, error: 'empty channel', raw: bodyUtf8.slice(0, 80) };
  if (!message) return { bcast: null, error: 'empty message', raw: bodyUtf8.slice(0, 80) };

  return { bcast: { channelName, message }, error: null };
}

// ── Verbose block fetch ─────────────────────────────────────────────────────

/**
 * Re-fetch a block with verbose transaction data.
 * Block-added events lack verboseData on outputs; getBlock() provides it.
 * Returns Map<txId, verboseTx> or null.
 */
async function fetchVerboseBlock(blockHash) {
  if (!_rpc || !blockHash) return null;
  _stats.verboseFetch++;
  try {
    const resp = await _rpc.getBlock({ hash: blockHash, includeTransactions: true });
    const vBlock = resp?.block;
    if (!vBlock) {
      _stats.verboseMiss++;
      log(`  VERBOSE-FAIL getBlock returned empty for ${blockHash.slice(0, 16)}...`);
      return null;
    }
    const txMap = new Map();
    const txs = vBlock.transactions || vBlock.body?.transactions || [];
    for (const vtx of txs) {
      const vid = vtx?.verboseData?.transactionId || vtx?.id;
      if (vid) txMap.set(vid, vtx);
    }
    _stats.verboseHit++;
    return txMap;
  } catch (err) {
    _stats.verboseMiss++;
    log(`  VERBOSE-FAIL getBlock(${blockHash.slice(0, 16)}...): ${err.message}`);
    return null;
  }
}

// ── RPC URL resolution (shared with kasia-relay) ────────────────────────────
import { resolveRpcUrl as _sharedResolveRpcUrl } from '../../shared/lib/rpc-utils.mjs';
async function resolveRpcUrl() { return _sharedResolveRpcUrl(CONSOLE_URL); }

// ── Connection lifecycle ────────────────────────────────────────────────────

export async function startRpcScanner(reporter, localAddresses = []) {
  if (_running) return;
  _running = true;
  _localAddresses = new Set(localAddresses);
  log(`starting RPC scanner (observable mode), ${_localAddresses.size} local addresses tracked...`);
  await _connect(reporter);
}

async function _connect(reporter) {
  const directUrl = await resolveRpcUrl();

  const rpcOpts = directUrl
    ? { url: directUrl, encoding: Encoding.Borsh, networkId: KASPA_NETWORK }
    : Resolver
      ? { resolver: new Resolver(), encoding: Encoding.Borsh, networkId: KASPA_NETWORK }
      : (() => { throw new Error('No RPC URL configured and Resolver unavailable. Set KASPA_RPC_URL env var.'); })();

  _rpc = new RpcClient(rpcOpts);

  log('connecting to', directUrl || 'resolver...');
  await _rpc.connect({});
  _reconnectAttempt = 0;

  const { isSynced } = await _rpc.getServerInfo();
  log(isSynced ? 'node is synced' : 'WARNING: node is not synced — detections may be delayed');

  await _rpc.subscribeBlockAdded();
  log('subscribed to new blocks');
  log('scanning ALL Kasia protocol activity (observable mode, every hit logged)');

  _rpc.addEventListener('block-added', async (event) => {
    try {
      await handleBlock(event, reporter);
    } catch (err) {
      log('ERROR in block handler:', err.message, err.stack?.split('\n')[1] || '');
    }
  });

  _rpc.addEventListener('disconnect', () => {
    log('DISCONNECTED from node');
    logStats();
    _scheduleReconnect(reporter);
  });

  // Heartbeat baseline + stall detector (catches silent WS death the disconnect event misses)
  _lastBlockAt = Date.now();
  _reporter = reporter;
  _startHeartbeat();

  log('listening...');
}

function _startHeartbeat() {
  if (_heartbeatTimer) return; // one timer for the scanner's lifetime
  _heartbeatTimer = setInterval(() => {
    if (!_running || _reconnecting) return;
    const silentMs = Date.now() - _lastBlockAt;
    if (silentMs > BLOCK_STALL_MS) {
      log(`STALL: no block in ${Math.round(silentMs / 1000)}s — WS silently dead (disconnect never fired), forcing reconnect`);
      _scheduleReconnect(_reporter);
    }
  }, HEARTBEAT_CHECK_MS);
  if (_heartbeatTimer.unref) _heartbeatTimer.unref();
}

function _scheduleReconnect(reporter) {
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
      await _connect(reporter);
      log('reconnected');
    } catch (err) {
      log('reconnect failed:', err.message);
      _scheduleReconnect(reporter);
    }
  }, delay);
}

export async function stopRpcScanner() {
  _running = false;
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  logStats();
  if (_rpc) { try { await _rpc.disconnect(); } catch {} _rpc = null; }
  log('stopped');
}

// ── Block processing ────────────────────────────────────────────────────────

async function handleBlock(event, reporter) {
  const block = event?.data?.block;
  if (!block) return;

  _lastBlockAt = Date.now(); // heartbeat — proves the WS is alive
  _stats.blocks++;
  const blockHash = block?.verboseData?.hash || null;
  const blockTs = Number(block.header?.timestamp || 0);
  const blockTime = blockTs ? new Date(blockTs).toISOString() : new Date().toISOString();
  const transactions = block.transactions || block.body?.transactions || [];

  // ── Phase 1: Quick scan for Kasia prefix ──────────────────────────────

  const kasiaHits = [];
  for (const tx of transactions) {
    const txId = tx?.verboseData?.transactionId || tx?.id;
    if (!txId) continue;
    if (_attempted.has(txId)) continue;

    const payloadHex = tx?.payload;
    if (!payloadHex || payloadHex.length < MIN_PAYLOAD_HEX) continue;

    const msgType = classifyPayload(payloadHex);
    if (!msgType) continue;

    _attempted.add(txId);
    _stats.kasiaHits++;
    _stats.byType[msgType] = (_stats.byType[msgType] || 0) + 1;
    kasiaHits.push({ tx, txId, msgType, payloadHex });
  }

  // ── Phase 1b: Large transfer detection (any address, not just watchlist) ──
  const LARGE_TX_THRESHOLD = Number(process.env.LARGE_TX_THRESHOLD_SOMPI || 500_000_00000000); // 500K KAS (aligned with whale-alert.mjs)
  for (const tx of transactions) {
    const txId = tx?.verboseData?.transactionId || tx?.id;
    if (!txId) continue;
    const outputs = tx?.outputs || [];
    for (const out of outputs) {
      const amount = Number(out?.value || out?.amount || 0);
      if (amount >= LARGE_TX_THRESHOLD) {
        const kas = amount / 100_000_000;
        // Extract recipient address from scriptPublicKey if possible
        let toAddr = null;
        try {
          if (out.verboseData?.scriptPublicKeyAddress) {
            toAddr = out.verboseData.scriptPublicKeyAddress;
          }
        } catch {}
        log(`LARGE TX: ${kas.toLocaleString()} KAS → ${toAddr?.slice(0, 30) || 'unknown'}... (tx:${txId.slice(0, 12)})`);
        // Report as whale alert
        reporter._post('/api/chain/whale-alert', {
          address: toAddr || 'unknown',
          label: toAddr ? toAddr.slice(-12) : 'unknown',
          tag: 'large_tx',
          direction: 'TRANSFER',
          amountKas: kas,
          prevBalanceKas: null,
          newBalanceKas: null,
          txId: txId,
          timestamp: blockTime,
        }).catch(() => {});
      }
    }
  }

  // Periodic stats
  if (_stats.blocks <= 3 || _stats.blocks % STATS_EVERY === 0) {
    logStats();
  }

  if (kasiaHits.length === 0) {
    pruneAttempted();
    updateCheckpoint(blockTime, null);
    return;
  }

  // ── Phase 2: Fetch verbose block for reliable addresses ───────────────

  let verboseTxMap = null;
  if (blockHash) {
    verboseTxMap = await fetchVerboseBlock(blockHash);
  } else {
    log(`  WARN block #${_stats.blocks} has no hash — cannot supplement addresses`);
  }

  // ── Phase 3: Process each Kasia hit (every one logged) ────────────────

  const discoveries = [];
  const interactions = [];
  const cardReports = [];
  const bcastReports = [];
  const messageReports = [];

  for (const { tx, txId, msgType, payloadHex } of kasiaHits) {
    // Use verbose tx if available, else fall back to event tx
    const effectiveTx = verboseTxMap?.get(txId) || tx;
    const usedVerbose = verboseTxMap?.has(txId) || false;
    const { outputAddresses, inputAddresses, addrSource, failures } =
      extractAddresses(effectiveTx);
    const hasAddr = outputAddresses.length > 0 || inputAddresses.length > 0;

    // ── 消息索引：为认识的地址记录链上 TX ──────────────────────────────
    if (hasAddr) {
      tryIndex(txId, payloadHex, msgType, inputAddresses, outputAddresses, blockTime, null);
    }

    // ── KANet Agent Card ──────────────────────────────────────────────
    if (msgType === 'kanet_card') {
      const { card, error, raw } = parseCardPayload(payloadHex);
      const publisher = outputAddresses[0] || null;

      if (card && publisher) {
        _stats.cardOk++;
        cardReports.push({
          address: publisher,
          txHash: txId,
          cardData: card,
          network: KASPA_NETWORK,
          // relayNodeId removed — discovery is shared KANet resource
        });
        log(`[kanet_card] tx=${txId.slice(0, 16)}... addr=${publisher} name="${card.name || '(private)'}" mode=${card.mode} skills=[${card.skills?.join(',') || ''}] (${addrSource})`);
      } else {
        _stats.cardFail++;
        log(`[kanet_card] FAIL tx=${txId.slice(0, 16)}... addr=${publisher || 'NONE'} parse=${error || 'no-publisher'} verbose=${usedVerbose} addr-failures=[${failures.join(',')}]${raw ? ` raw="${raw}"` : ''}`);
      }
      continue;
    }

    // ── Broadcast message ─────────────────────────────────────────────
    if (msgType === 'bcast') {
      const { bcast, error, raw } = parseBcastPayload(payloadHex);
      const sender = outputAddresses[0] || null;

      if (bcast && sender) {
        _stats.bcastOk++;
        bcastReports.push({
          channelName: bcast.channelName,
          senderAddress: sender,
          content: bcast.message,
          txHash: txId,
        });
        log(`[bcast] tx=${txId.slice(0, 16)}... addr=${sender} #${bcast.channelName} "${bcast.message.slice(0, 80)}${bcast.message.length > 80 ? '...' : ''}" (${addrSource})`);
      } else {
        _stats.bcastFail++;
        log(`[bcast] FAIL tx=${txId.slice(0, 16)}... addr=${sender || 'NONE'} parse=${error || 'no-sender'} verbose=${usedVerbose} addr-failures=[${failures.join(',')}]${raw ? ` raw="${raw}"` : ''}`);
      }
      continue;
    }

    // ── Kasia protocol messages (handshake/comm/payment/self_stash/legacy)

    if (!hasAddr) {
      _stats.addrFail++;
      log(`[${msgType}] ADDR-FAIL tx=${txId.slice(0, 16)}... verbose=${usedVerbose} failures=[${failures.join(',')}] payload(${payloadHex.length})=${payloadHex.slice(0, 80)}...`);
      continue;
    }
    _stats.addrOk++;

    const { sender, receiver } = derivePeers(inputAddresses, outputAddresses, msgType);

    // Log every hit — who is doing what
    if (receiver) {
      log(`[${msgType}] tx=${txId.slice(0, 16)}... from=${sender} to=${receiver} (${addrSource})`);
    } else {
      log(`[${msgType}] tx=${txId.slice(0, 16)}... addr=${sender} (self) (${addrSource})`);
    }

    // Register sender as discovered address (shared KANet resource, no relayNodeId)
    if (sender) {
      discoveries.push({
        address: sender,
        sourceProtocol: 'kasia',
        txHash: txId,
        network: KASPA_NETWORK,
      });
    }

    // Register receiver (handshake/payment only)
    if (receiver) {
      discoveries.push({
        address: receiver,
        sourceProtocol: 'kasia',
        txHash: txId,
        network: KASPA_NETWORK,
      });
    }

    // Record activity — what this address is doing right now
    if (sender) {
      interactions.push({
        addressA: sender,
        addressB: receiver || sender,
        protocol: 'kasia',
        txHash: txId,
        interactionType: msgType,
        occurredAt: blockTime,
      });
    }

    // If receiver is one of our local addresses, ingest handshakes into Console DB
    // so relay catch-up can find them. Comm messages are handled by Relay directly
    // (Scout cannot decrypt them), so we only record the interaction, not the message.
    if (receiver && _localAddresses.has(receiver) && msgType === 'handshake') {
      messageReports.push({
        traceId: txId,
        network: KASPA_NETWORK,
        direction: 'inbound',
        localAddress: receiver,
        remoteAddress: sender,
        txid: txId,
        messageType: 'handshake',
        contentText: 'handshake request',
        timestamp: blockTime,
      });
    }
    // Note: comm messages are NOT ingested by Scout. Relay is the only authority
    // for decrypting and replying to comm messages. Scout only records the
    // interaction fact (addressA↔addressB) via discovery/interaction above.
  }

  pruneAttempted();

  // ── Report to Console ─────────────────────────────────────────────────

  if (discoveries.length > 0 || interactions.length > 0) {
    try {
      const result = await reporter.report(discoveries, interactions);
      _stats.reportOk++;
      log(`REPORT disc=${result.registered} new, interactions=${result.interactions} recorded, err=${result.errors}`);
    } catch (err) {
      _stats.reportFail++;
      log(`REPORT FAIL: ${err.message}`);
    }
  }

  if (cardReports.length > 0) {
    try {
      const results = await reporter.reportCards(cardReports);
      _stats.reportOk++;
      log(`REPORT cards=${results.reported} ok, err=${results.errors}`);
    } catch (err) {
      _stats.reportFail++;
      log(`REPORT cards FAIL: ${err.message}`);
    }
  }

  if (bcastReports.length > 0) {
    try {
      const results = await reporter.reportBroadcasts(bcastReports);
      _stats.reportOk++;
      log(`REPORT bcast=${results.reported} ok, err=${results.errors}`);
    } catch (err) {
      _stats.reportFail++;
      log(`REPORT bcast FAIL: ${err.message}`);
    }
  }

  // Report messages destined for local addresses (handshake/comm)
  if (messageReports.length > 0) {
    try {
      const results = await reporter.reportMessages(messageReports);
      log(`REPORT messages=${results.reported} new, ${results.duplicates} dedup, err=${results.errors}`);
    } catch (err) {
      log(`REPORT messages FAIL: ${err.message}`);
    }
  }

  // ── 更新扫描检查点 ───────────────────────────────────────────────────
  updateCheckpoint(blockTime, null);
}
