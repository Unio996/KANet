/**
 * Message Indexer — 为认识的地址记录链上消息索引
 *
 * 设计文档：docs/kanet-cooperative-index.md
 *
 * Scout 扫链时调用 tryIndex(txId, tx, payloadHex, msgType, addresses, blockTime, blueScore)
 * 如果 from_address 或 to_address 在已知地址列表里 → 写入 Console kanet_message_index 表
 *
 * 已知地址列表从 Console /api/discovery/known-addresses 加载，每 5 分钟刷新。
 * payload 不存明文，存 sha256 hash（隐私保护）。
 */

import { createHash } from 'node:crypto';

const CONSOLE_URL = process.env.CONSOLE_URL || 'http://localhost:3100';
const INGEST_SECRET = process.env.INGEST_SECRET || '';
const REFRESH_INTERVAL_MS = 5 * 60_000; // 5 分钟刷新已知地址

let _knownAddresses = new Set();
let _refreshTimer = null;
let _running = false;

// 批量写入缓冲
const _buffer = [];
const BUFFER_FLUSH_SIZE = 20;
const BUFFER_FLUSH_INTERVAL_MS = 10_000; // 10s
let _flushTimer = null;

// 检查点：记录最后处理的块时间
let _lastBlockTime = null;
let _lastBlueScore = null;
let _checkpointDirty = false;
const CHECKPOINT_FLUSH_INTERVAL_MS = 30_000; // 30s 写一次检查点
let _checkpointTimer = null;

// 统计
const _stats = { checked: 0, indexed: 0, flushed: 0, flushFail: 0, checkpointWrites: 0 };

function log(...args) {
  console.log(new Date().toLocaleString(undefined, { hour12: false }), '[msg-indexer]', ...args);
}

// ── 公开 API ────────────────────────────────────────────────────────────────

/**
 * 启动消息索引器 — 加载已知地址 + 启动定时刷新
 */
/**
 * 启动消息索引器 — 加载已知地址 + 读取检查点 + 启动定时刷新
 * @returns {{ lastBlockTime: string|null, lastBlueScore: number|null }} 检查点信息（供 history-fetcher 用）
 */
export async function startMessageIndexer() {
  if (_running) return { lastBlockTime: null, lastBlueScore: null };
  _running = true;

  await _refreshKnownAddresses();
  await _loadCheckpoint();

  _refreshTimer = setInterval(_refreshKnownAddresses, REFRESH_INTERVAL_MS);
  _flushTimer = setInterval(_flushBuffer, BUFFER_FLUSH_INTERVAL_MS);
  _checkpointTimer = setInterval(_flushCheckpoint, CHECKPOINT_FLUSH_INTERVAL_MS);

  log(`started — ${_knownAddresses.size} known addresses, checkpoint: ${_lastBlockTime || '(none)'}`);
  return { lastBlockTime: _lastBlockTime, lastBlueScore: _lastBlueScore };
}

export function stopMessageIndexer() {
  _running = false;
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null; }
  if (_checkpointTimer) { clearInterval(_checkpointTimer); _checkpointTimer = null; }
  // 最后一次 flush
  if (_buffer.length > 0) _flushBuffer();
  if (_checkpointDirty) _flushCheckpoint();
  log(`stopped — stats: checked=${_stats.checked} indexed=${_stats.indexed} flushed=${_stats.flushed} fail=${_stats.flushFail}`);
}

/**
 * 检查一笔 TX 是否涉及认识的地址，如果是则加入写入缓冲。
 *
 * @param {string} txId — 链上 TX ID（用作 kanet_message_index.id）
 * @param {string} payloadHex — TX payload hex
 * @param {string} msgType — Kasia 消息类型（handshake/comm/bcast/card/...）
 * @param {string[]} inputAddresses — TX 输入地址
 * @param {string[]} outputAddresses — TX 输出地址
 * @param {string} blockTime — ISO8601 块时间
 * @param {number|null} blueScore — 块 blue score
 */
export function tryIndex(txId, payloadHex, msgType, inputAddresses, outputAddresses, blockTime, blueScore) {
  if (!_running || _knownAddresses.size === 0) return;
  _stats.checked++;

  const fromAddr = inputAddresses[0] || outputAddresses[0] || 'unknown';
  const payloadHash = payloadHex ? 'sha256:' + createHash('sha256').update(payloadHex).digest('hex').slice(0, 32) : null;
  const replyTo = _extractReplyTo(payloadHex);

  // 为每个匹配的认识地址写一条索引
  // UNIQUE(txid, for_address) 保证不重复，同一 TX 可以为多个地址各写一条
  const allAddrs = new Set([...inputAddresses, ...outputAddresses]);
  for (const addr of allAddrs) {
    if (!_knownAddresses.has(addr)) continue;

    _buffer.push({
      txid: txId,
      for_address: addr,
      from_address: fromAddr,
      payload_type: msgType,
      payload_hash: payloadHash,
      block_time: blockTime,
      blue_score: blueScore,
      indexed_by: 'local',
      reply_to: replyTo,
    });
    _stats.indexed++;
  }

  if (_buffer.length >= BUFFER_FLUSH_SIZE) {
    _flushBuffer();
  }
}

/**
 * 更新扫描检查点 — 每处理完一个块调用一次。
 * 不立即写 DB，只标脏，由定时器 30s 写一次。
 *
 * @param {string} blockTime — ISO8601 块时间
 * @param {number|null} blueScore — 块 blue score
 */
export function updateCheckpoint(blockTime, blueScore) {
  if (!_running) { return; }
  if (!blockTime) { return; }
  // 只前进不后退
  if (_lastBlockTime && blockTime <= _lastBlockTime) return;
  _lastBlockTime = blockTime;
  _lastBlueScore = blueScore;
  _checkpointDirty = true;
}

/**
 * 获取当前检查点信息（供 history-fetcher 查询用）
 */
export function getCheckpoint() {
  return { lastBlockTime: _lastBlockTime, lastBlueScore: _lastBlueScore };
}

// ── 内部 ────────────────────────────────────────────────────────────────────

async function _loadCheckpoint() {
  try {
    const res = await fetch(`${CONSOLE_URL}/api/discovery/checkpoint?key=_global_`, {
      headers: { 'x-ingest-secret': INGEST_SECRET },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.last_block_time) {
        _lastBlockTime = data.last_block_time;
        _lastBlueScore = data.last_blue_score;
        log(`checkpoint loaded: ${_lastBlockTime} (blue_score: ${_lastBlueScore || 'n/a'})`);
      } else {
        log('checkpoint: no previous checkpoint (first run)');
      }
    }
  } catch (err) {
    log(`checkpoint load error: ${err.message}`);
  }
}

async function _flushCheckpoint() {
  if (!_checkpointDirty || !_lastBlockTime) return;
  try {
    const res = await fetch(`${CONSOLE_URL}/api/discovery/checkpoint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': INGEST_SECRET,
      },
      body: JSON.stringify({
        key: '_global_',
        last_block_time: _lastBlockTime,
        last_blue_score: _lastBlueScore,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      _checkpointDirty = false;
      _stats.checkpointWrites++;
    }
  } catch (err) {
    log(`checkpoint flush error: ${err.message}`);
  }
}

async function _refreshKnownAddresses() {
  try {
    const res = await fetch(`${CONSOLE_URL}/api/discovery/known-addresses`, {
      headers: { 'x-ingest-secret': INGEST_SECRET },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log(`refresh failed: HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    const newSet = new Set(data.addresses || []);
    if (newSet.size !== _knownAddresses.size) {
      log(`known addresses updated: ${_knownAddresses.size} → ${newSet.size}`);
    }
    _knownAddresses = newSet;
  } catch (err) {
    log(`refresh error: ${err.message}`);
  }
}

async function _flushBuffer() {
  if (_buffer.length === 0) return;

  const entries = _buffer.splice(0, _buffer.length);
  try {
    const res = await fetch(`${CONSOLE_URL}/api/discovery/message-index`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': INGEST_SECRET,
      },
      body: JSON.stringify({ entries }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      _stats.flushed += data.inserted || 0;
    } else {
      _stats.flushFail++;
      log(`flush failed: HTTP ${res.status}`);
    }
  } catch (err) {
    _stats.flushFail++;
    log(`flush error: ${err.message}`);
    // 失败的条目放回缓冲（前面插入，保持顺序）
    _buffer.unshift(...entries);
  }
}

// kanet:v1:msg: 格式解析 — 提取 reply_to 引用 ID
// 格式: kanet:v1:msg:<type>:<message_id>:<reply_to>:<encoding>:<body>
const KANET_MSG_PREFIX_HEX = Buffer.from('kanet:v1:msg:').toString('hex');

function _extractReplyTo(payloadHex) {
  if (!payloadHex || !payloadHex.startsWith(KANET_MSG_PREFIX_HEX)) return null;
  try {
    const text = Buffer.from(payloadHex, 'hex').toString('utf8');
    const parts = text.split(':');
    // parts: [kanet, v1, msg, <type>, <message_id>, <reply_to>, <encoding>, <body...>]
    //         0      1   2    3       4              5           6           7+
    const replyTo = parts[5];
    return replyTo && replyTo !== '0' ? replyTo : null;
  } catch {
    return null;
  }
}
