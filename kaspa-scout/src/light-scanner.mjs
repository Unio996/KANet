/**
 * Light Scanner — 降级模式，无本地节点时使用公共 RPC。
 *
 * 能力：收消息、收握手、确认发送的 TX、检测 Agent Card 和广播
 * 不能：全网广播索引、市场数据、鲸鱼监控、他人监控
 *
 * 架构：
 *   同时订阅 blockAdded + utxosChanged
 *   blockAdded → 维护 txId→tx 缓存（含 payload，30s/2000 条上限）
 *   utxosChanged → 触发处理：
 *     1. 查本地 TX 缓存（零网络请求，命中率高）
 *     2. 缓存未命中 → getMempoolEntry（TX 刚广播时有效）
 *     3. mempool 也没有 → 放入 pending 队列，等下一个 blockAdded 补处理
 *   Kasia 协议分类 → Reporter 上报（和 rpc-scanner 同一管道）
 */

import * as kaspa from 'kaspa-wasm';
import { classifyPayload, MIN_PAYLOAD_HEX } from './lib/protocol.mjs';
import { tryIndex, updateCheckpoint } from './message-indexer.mjs';
import { extractAddresses, derivePeers, parseCardPayload, parseBcastPayload } from './rpc-scanner.mjs';
import { resolveRpcUrl as _sharedResolveRpcUrl } from '../../shared/lib/rpc-utils.mjs';

const { RpcClient, Encoding } = kaspa;
const Resolver = kaspa.Resolver || null;

const KASPA_NETWORK = process.env.KASPA_NETWORK || 'mainnet';
const CONSOLE_URL   = process.env.CONSOLE_URL || '';

const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS  = 60000;

// TX 缓存参数：保留最近 30 秒，不超过 2000 条
const TX_CACHE_MAX_SIZE = 2000;
const TX_CACHE_MAX_AGE_MS = 30_000;
const TX_CACHE_CLEANUP_INTERVAL_MS = 5_000;

// ── State ───────────────────────────────────────────────────────────────────

let _rpc = null;
let _running = false;
let _reconnecting = false;
let _reconnectAttempt = 0;
let _localAddresses = new Set();
let _extraAddresses = new Set();  // 额外关注的地址（移动端/用户配置）
let _watchSignals = [];           // 关注的协议信号类型（预留）
let _reporter = null;
let _cleanupTimer = null;

// TX 缓存：txId → { tx, payload, timestamp }
const _txCache = new Map();

// 已处理的 txId 去重
const _processed = new Set();
const PROCESSED_MAX = 5000;

// 待补处理的 txId（缓存和 mempool 都没找到的）
const _pending = new Set();
const PENDING_MAX = 200;

// 统计
const _stats = {
  blocks: 0,
  utxoEvents: 0,
  cacheHits: 0,
  mempoolHits: 0,
  pendingRecovered: 0,
  kasiaHits: 0,
  byType: {},
  reportOk: 0,
  reportFail: 0,
};

// ── Logging ─────────────────────────────────────────────────────────────────

function log(...args) {
  console.log(new Date().toLocaleString(undefined, { hour12: false }), '[light-scout]', ...args);
}

function logStats() {
  const types = Object.entries(_stats.byType)
    .map(([k, v]) => `${k}=${v}`).join(' ') || '(none)';
  log(`== STATS (${_stats.blocks} blocks, ${_stats.utxoEvents} utxo-events) ==`);
  log(`  cache: ${_txCache.size} entries, hits=${_stats.cacheHits}`);
  log(`  mempool-hits=${_stats.mempoolHits}, pending-recovered=${_stats.pendingRecovered}`);
  log(`  kasia: ${_stats.kasiaHits} [${types}]`);
  log(`  report: ok=${_stats.reportOk} fail=${_stats.reportFail}`);
}

// ── RPC URL resolution ──────────────────────────────────────────────────────

async function resolveRpcUrl() { return _sharedResolveRpcUrl(CONSOLE_URL); }

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Start light scanner — subscribe to both blockAdded and utxosChanged.
 *
 * @param {Reporter} reporter — Console Reporter instance
 * @param {string[]} localAddresses — 本地 Agent 地址（必须）
 * @param {object} [opts] — 扩展选项
 * @param {string[]} [opts.extraAddresses] — 额外关注地址（用户配置、移动端广播频道等）
 * @param {string[]} [opts.watchSignals] — 关注的协议信号类型（预留，暂不实现过滤逻辑）
 */
export async function startLightScanner(reporter, localAddresses = [], opts = {}) {
  if (_running) return;
  _running = true;
  _reporter = reporter;
  _localAddresses = new Set(localAddresses);
  _extraAddresses = new Set(opts.extraAddresses || []);
  _watchSignals = opts.watchSignals || [];

  const totalWatch = _localAddresses.size + _extraAddresses.size;
  if (totalWatch === 0) {
    log('WARNING: no addresses to monitor — light scanner idle');
    return;
  }

  log(`starting LIGHT scanner — ${_localAddresses.size} local + ${_extraAddresses.size} extra addresses`);
  if (_watchSignals.length > 0) {
    log(`watch signals: [${_watchSignals.join(', ')}] (reserved, not yet filtered)`);
  }
  log('capabilities: handshake/comm/card/bcast detection for monitored addresses');
  log('disabled: full-block scan, whale alerts, balance tracking');
  await _connect();

  // 定期清理过期 TX 缓存
  _cleanupTimer = setInterval(_cleanupTxCache, TX_CACHE_CLEANUP_INTERVAL_MS);
}

export async function stopLightScanner() {
  _running = false;
  if (_cleanupTimer) { clearInterval(_cleanupTimer); _cleanupTimer = null; }
  logStats();
  if (_rpc) { try { await _rpc.disconnect(); } catch {} _rpc = null; }
  // 清理内部状态（支持多次 start/stop 循环）
  _txCache.clear();
  _processed.clear();
  _pending.clear();
  _localAddresses.clear();
  _extraAddresses.clear();
  _watchSignals = [];
  _reconnecting = false;
  _reconnectAttempt = 0;
  log('stopped');
}

// ── Connection ──────────────────────────────────────────────────────────────

async function _connect() {
  const directUrl = await resolveRpcUrl();

  // light 模式优先公共节点（本地节点不可用才走 light 模式）
  // 但如果环境变量或 Console 配置了 URL，尊重配置
  const rpcOpts = directUrl
    ? { url: directUrl, encoding: Encoding.Borsh, networkId: KASPA_NETWORK }
    : Resolver
      ? { resolver: new Resolver(), encoding: Encoding.Borsh, networkId: KASPA_NETWORK }
      : (() => { throw new Error('No RPC URL configured and Resolver unavailable. Set KASPA_RPC_URL env var.'); })();

  _rpc = new RpcClient(rpcOpts);

  log('connecting to', directUrl || 'public resolver...');
  await _rpc.connect({});
  _reconnectAttempt = 0;

  const { isSynced, serverVersion } = await _rpc.getServerInfo();
  log(`connected — v${serverVersion}, synced=${isSynced}`);

  // 订阅 1: blockAdded — 维护 TX 缓存
  await _rpc.subscribeBlockAdded();
  log('subscribed to blockAdded (TX cache)');

  _rpc.addEventListener('block-added', async (event) => {
    try {
      _handleBlockAdded(event);
    } catch (err) {
      log('ERROR in block handler:', err.message);
    }
  });

  // 订阅 2: utxosChanged — 监控本地 + 额外关注地址
  const addrArray = [..._localAddresses, ..._extraAddresses];
  await _rpc.subscribeUtxosChanged(addrArray);
  log(`subscribed to utxosChanged for ${addrArray.length} addresses (${_localAddresses.size} local + ${_extraAddresses.size} extra)`);

  _rpc.addEventListener('utxos-changed', async (event) => {
    try {
      await _handleUtxoChange(event);
    } catch (err) {
      log('ERROR in utxo handler:', err.message);
    }
  });

  _rpc.addEventListener('disconnect', () => {
    log('DISCONNECTED');
    logStats();
    _scheduleReconnect();
  });

  log('listening (light mode)...');
}

function _scheduleReconnect() {
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
      await _connect();
      log('reconnected');
    } catch (err) {
      log('reconnect failed:', err.message);
      _scheduleReconnect();
    }
  }, delay);
}

// ── Block handler: 维护 TX 缓存 ─────────────────────────────────────────────

function _handleBlockAdded(event) {
  const block = event?.data?.block;
  if (!block) return;

  _stats.blocks++;
  const now = Date.now();
  const transactions = block.transactions || block.body?.transactions || [];

  for (const tx of transactions) {
    const txId = tx?.verboseData?.transactionId || tx?.id;
    if (!txId) continue;

    const payloadHex = tx?.payload;
    // 只缓存有 payload 的 TX（非 coinbase 且可能是 Kasia 消息）
    if (payloadHex && payloadHex.length >= MIN_PAYLOAD_HEX) {
      _txCache.set(txId, { tx, payload: payloadHex, timestamp: now });
    }

    // 检查 pending 队列：之前 mempool 没找到的 TX 现在出块了
    if (_pending.has(txId) && payloadHex) {
      _pending.delete(txId);
      _stats.pendingRecovered++;
      // 直接处理
      _processTxPayload(txId, tx, payloadHex, 'pending-recovery');
    }

    // ── 全块广播扫描：捕获外部 Agent 的 broadcast ────────────────────
    // utxosChanged 只触发本地地址相关 TX，外部 Agent 的 self-send broadcast
    // 永远不会触发。这里主动扫每个块的所有 TX，发现 bcast 直接上报。
    // 去重：_processed 集合保证同一 TX 不会被 utxosChanged 重复处理。
    if (payloadHex && payloadHex.length >= MIN_PAYLOAD_HEX && !_processed.has(txId)) {
      const msgType = classifyPayload(payloadHex);
      if (msgType === 'bcast') {
        _processed.add(txId);
        const { bcast, error } = parseBcastPayload(payloadHex);
        const { outputAddresses } = extractAddresses(tx);
        const sender = outputAddresses[0] || null;
        if (bcast && sender) {
          _stats.kasiaHits++;
          _stats.byType['bcast'] = (_stats.byType['bcast'] || 0) + 1;
          _reporter.reportBroadcasts([{
            channelName: bcast.channelName,
            senderAddress: sender,
            content: bcast.message,
            txHash: txId,
          }]).then(r => { if (r.reported > 0) _stats.reportOk++; })
            .catch(() => { _stats.reportFail++; });
          log(`  bcast(block-scan): #${bcast.channelName} from=${sender.slice(-8)} "${bcast.message.slice(0, 60)}..."`);
        }
      }
    }
  }

  // 如果缓存超限，立即清理
  if (_txCache.size > TX_CACHE_MAX_SIZE) {
    _cleanupTxCache();
  }

  // 更新检查点（用块时间戳）
  const blockTs = Number(block.header?.timestamp || 0);
  if (blockTs > 0) {
    updateCheckpoint(new Date(blockTs).toISOString(), null);
  }

  // 定期日志
  if (_stats.blocks <= 3 || _stats.blocks % 500 === 0) {
    logStats();
  }
}

// ── UTXO change handler: 检测和处理 TX ──────────────────────────────────────

async function _handleUtxoChange(event) {
  const data = event?.data;
  if (!data) return;
  _stats.utxoEvents++;

  // 收集所有涉及的 txId（去重）
  const txIds = new Set();
  const added = data.added || [];
  const removed = data.removed || [];

  for (const entry of added) {
    const txId = entry?.outpoint?.transactionId;
    if (txId && !_processed.has(txId)) txIds.add(txId);
  }
  for (const entry of removed) {
    const txId = entry?.outpoint?.transactionId;
    if (txId && !_processed.has(txId)) txIds.add(txId);
  }

  for (const txId of txIds) {
    await _resolveTxAndProcess(txId);
  }

  // 去重集合清理
  if (_processed.size > PROCESSED_MAX) {
    const arr = [..._processed];
    arr.splice(0, arr.length - PROCESSED_MAX / 2);
    _processed.clear();
    arr.forEach(id => _processed.add(id));
  }
}

/**
 * 三级 TX payload 获取：缓存 → mempool → pending 队列
 */
async function _resolveTxAndProcess(txId) {
  _processed.add(txId);

  // 级别 1: 本地 TX 缓存（零网络请求）
  const cached = _txCache.get(txId);
  if (cached) {
    _stats.cacheHits++;
    _processTxPayload(txId, cached.tx, cached.payload, 'cache');
    return;
  }

  // 级别 2: getMempoolEntry（TX 刚广播还在 mempool 时有效）
  if (_rpc) {
    try {
      const entry = await _rpc.getMempoolEntry({
        transactionId: txId,
        includeOrphanPool: true,
        filterTransactionPool: false,
      });
      const tx = entry?.transaction;
      const payload = tx?.payload;
      if (payload && payload.length >= MIN_PAYLOAD_HEX) {
        _stats.mempoolHits++;
        _processTxPayload(txId, tx, payload, 'mempool');
        return;
      }
      // TX 在 mempool 但没有 Kasia payload — 普通转账，不需要处理
      if (tx) return;
    } catch {
      // TX 不在 mempool — 已确认或不存在
    }
  }

  // 级别 3: 放入 pending 队列，等下一个 blockAdded 带出来
  if (_pending.size < PENDING_MAX) {
    _pending.add(txId);
  }
}

// ── TX 分类和上报（核心逻辑，和 rpc-scanner handleBlock 对齐）──────────────

function _processTxPayload(txId, tx, payloadHex, source) {
  const msgType = classifyPayload(payloadHex);
  if (!msgType) return; // 不是 Kasia 协议消息

  _stats.kasiaHits++;
  _stats.byType[msgType] = (_stats.byType[msgType] || 0) + 1;

  const { outputAddresses, inputAddresses, addrSource, failures } = extractAddresses(tx);
  const hasAddr = outputAddresses.length > 0 || inputAddresses.length > 0;

  const blockTime = new Date().toISOString();

  log(`[${msgType}] tx=${txId.slice(0, 16)}... src=${source} addrs=${outputAddresses.length}out/${inputAddresses.length}in (${addrSource})`);

  // ── 消息索引：为认识的地址记录链上 TX ──────────────────────────────
  if (hasAddr) {
    tryIndex(txId, payloadHex, msgType, inputAddresses, outputAddresses, blockTime, null);
  }

  // ── KANet Agent Card ──────────────────────────────────────────────────
  if (msgType === 'kanet_card') {
    const { card, error } = parseCardPayload(payloadHex);
    const publisher = outputAddresses[0] || null;
    if (card && publisher) {
      _reporter.reportCards([{
        address: publisher,
        txHash: txId,
        cardData: card,
        network: KASPA_NETWORK,
      }]).then(r => { if (r.reported > 0) _stats.reportOk++; })
        .catch(() => { _stats.reportFail++; });
      log(`  card: name="${card.name || '(private)'}" mode=${card.mode}`);
    } else {
      log(`  card FAIL: ${error || 'no-publisher'}`);
    }
    return;
  }

  // ── Broadcast ─────────────────────────────────────────────────────────
  if (msgType === 'bcast') {
    const { bcast, error } = parseBcastPayload(payloadHex);
    const sender = outputAddresses[0] || null;
    if (bcast && sender) {
      _reporter.reportBroadcasts([{
        channelName: bcast.channelName,
        senderAddress: sender,
        content: bcast.message,
        txHash: txId,
      }]).then(r => { if (r.reported > 0) _stats.reportOk++; })
        .catch(() => { _stats.reportFail++; });
      log(`  bcast: #${bcast.channelName} "${bcast.message.slice(0, 60)}..."`);
    } else {
      log(`  bcast FAIL: ${error || 'no-sender'}`);
    }
    return;
  }

  // ── Kasia 协议消息（handshake/comm/payment/self_stash/legacy）────────
  if (!hasAddr) {
    log(`  ADDR-FAIL: no addresses, failures=[${failures.join(',')}]`);
    return;
  }

  const { sender, receiver } = derivePeers(inputAddresses, outputAddresses, msgType);

  // 上报发现
  const discoveries = [];
  const interactions = [];
  const messageReports = [];

  if (sender) {
    discoveries.push({
      address: sender,
      sourceProtocol: 'kasia',
      txHash: txId,
      network: KASPA_NETWORK,
    });
  }
  if (receiver) {
    discoveries.push({
      address: receiver,
      sourceProtocol: 'kasia',
      txHash: txId,
      network: KASPA_NETWORK,
    });
  }

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

  // 本地地址收到的 handshake → 写入 Console DB（Relay catch-up 用）
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

  // 上报
  if (discoveries.length > 0 || interactions.length > 0) {
    _reporter.report(discoveries, interactions)
      .then(() => { _stats.reportOk++; })
      .catch(() => { _stats.reportFail++; });
  }
  if (messageReports.length > 0) {
    _reporter.reportMessages(messageReports)
      .then(() => { _stats.reportOk++; })
      .catch(() => { _stats.reportFail++; });
  }

  if (receiver) {
    log(`  → from=${sender?.slice(0, 30)} to=${receiver?.slice(0, 30)} (${addrSource})`);
  } else {
    log(`  → addr=${sender?.slice(0, 30)} (self) (${addrSource})`);
  }
}

// ── TX 缓存清理 ─────────────────────────────────────────────────────────────

function _cleanupTxCache() {
  const now = Date.now();
  const cutoff = now - TX_CACHE_MAX_AGE_MS;

  // 按时间清理
  for (const [txId, entry] of _txCache) {
    if (entry.timestamp < cutoff) {
      _txCache.delete(txId);
    }
  }

  // 如果还超限，按最早插入顺序删（Map 保持插入顺序）
  if (_txCache.size > TX_CACHE_MAX_SIZE) {
    let toDrop = _txCache.size - TX_CACHE_MAX_SIZE;
    for (const key of _txCache.keys()) {
      if (toDrop-- <= 0) break;
      _txCache.delete(key);
    }
  }

  // pending 队列也清理超时的（30s 还没匹配到就放弃）
  // pending 没有时间戳，用简单的大小限制
  if (_pending.size > PENDING_MAX) {
    const arr = [..._pending];
    arr.splice(0, arr.length - PENDING_MAX / 2);
    _pending.clear();
    arr.forEach(id => _pending.add(id));
  }
}
