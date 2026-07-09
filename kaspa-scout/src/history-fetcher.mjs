/**
 * History Fetcher — 启动时补全停机期间遗漏的链上消息
 *
 * 读取 scout_checkpoint → 查 api.kaspa.org 按地址获取历史 TX → 分类处理：
 *   handshake/card/bcast → 走现有 Reporter 上报
 *   comm → 上报给 /ingest/historical-comm 让 Relay 解密
 *
 * 只在启动时运行一次，完成后更新 checkpoint。
 */

import { createHash } from 'node:crypto';
import { classifyPayload, MIN_PAYLOAD_HEX } from './lib/protocol.mjs';
import { extractAddresses, derivePeers, parseCardPayload, parseBcastPayload } from './rpc-scanner.mjs';

const CONSOLE_URL = process.env.CONSOLE_URL || 'http://localhost:3100';
const INGEST_SECRET = process.env.INGEST_SECRET || '';
const KASPA_API = 'https://api.kaspa.org';
const KASPA_NETWORK = process.env.KASPA_NETWORK || 'mainnet';

const PAGE_SIZE = 50;
const MAX_PAGES = 100; // 安全上限：最多查 5000 条 TX
const REQUEST_DELAY_MS = 300; // 对公共 API 友好

function log(...args) {
  console.log(new Date().toLocaleString(undefined, { hour12: false }), '[history-fetcher]', ...args);
}

/**
 * 运行历史补全 — 启动时调用一次。
 *
 * @param {import('./reporter.mjs').Reporter} reporter
 * @param {string[]} localAddresses — 本地 Agent 地址
 * @returns {{ fetched: number, processed: number, comms: number }}
 */
export async function runHistoryFetch(reporter, localAddresses) {
  if (localAddresses.length === 0) {
    log('no local addresses, skipping');
    return { fetched: 0, processed: 0, comms: 0 };
  }

  // 1. 读取检查点
  const checkpoint = await _getCheckpoint();
  if (!checkpoint.last_block_time) {
    log('no checkpoint (first run), skipping history fetch');
    return { fetched: 0, processed: 0, comms: 0 };
  }

  const sinceTime = new Date(checkpoint.last_block_time).getTime();
  const now = Date.now();
  const gapHours = ((now - sinceTime) / 3600_000).toFixed(1);

  log(`checkpoint: ${checkpoint.last_block_time} (${gapHours}h ago)`);

  if (gapHours < 0.01) {
    log('gap < 1 minute, nothing to fetch');
    return { fetched: 0, processed: 0, comms: 0 };
  }

  // 2. 对每个本地地址查历史 TX
  const stats = { fetched: 0, processed: 0, comms: 0, indexed: 0 };
  const seenTxIds = new Set();

  for (const addr of localAddresses) {
    log(`fetching history for ${addr.slice(0, 30)}...`);
    try {
      const result = await _fetchAndProcess(addr, sinceTime, reporter, seenTxIds);
      stats.fetched += result.fetched;
      stats.processed += result.processed;
      stats.comms += result.comms;
      stats.indexed += result.indexed;
    } catch (err) {
      log(`ERROR for ${addr.slice(0, 20)}...: ${err.message}`);
    }
  }

  // 3. 更新检查点到当前时间
  await _updateCheckpoint(new Date().toISOString());

  log(`done — fetched=${stats.fetched} processed=${stats.processed} comms=${stats.comms} indexed=${stats.indexed}`);
  return stats;
}

// ── 内部 ────────────────────────────────────────────────────────────────────

async function _getCheckpoint() {
  try {
    const res = await fetch(`${CONSOLE_URL}/api/discovery/checkpoint?key=_global_`, {
      headers: { 'x-ingest-secret': INGEST_SECRET },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return res.json();
  } catch {}
  return { last_block_time: null };
}

async function _updateCheckpoint(blockTime) {
  try {
    await fetch(`${CONSOLE_URL}/api/discovery/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': INGEST_SECRET },
      body: JSON.stringify({ key: '_global_', last_block_time: blockTime }),
      signal: AbortSignal.timeout(5000),
    });
    log(`checkpoint updated to ${blockTime}`);
  } catch (err) {
    log(`checkpoint update failed: ${err.message}`);
  }
}

/**
 * 获取一个地址从 sinceTime 以来的历史 TX 并处理。
 * API 按 block_time 降序返回，翻页直到 block_time < sinceTime。
 */
async function _fetchAndProcess(address, sinceTime, reporter, seenTxIds) {
  const stats = { fetched: 0, processed: 0, comms: 0, indexed: 0 };
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${KASPA_API}/addresses/${address}/full-transactions?limit=${PAGE_SIZE}&offset=${offset}&resolve_previous_outpoints=no`;

    let txs;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        log(`API ${res.status} for ${address.slice(0, 20)}... offset=${offset}`);
        break;
      }
      txs = await res.json();
    } catch (err) {
      log(`API error: ${err.message}`);
      break;
    }

    if (!Array.isArray(txs) || txs.length === 0) break;
    stats.fetched += txs.length;

    let reachedCheckpoint = false;
    for (const tx of txs) {
      const blockTime = tx.block_time;
      if (blockTime && blockTime <= sinceTime) {
        reachedCheckpoint = true;
        break;
      }

      const txId = tx.transaction_id;
      if (!txId || seenTxIds.has(txId)) continue;
      seenTxIds.add(txId);

      const payloadHex = tx.payload;
      if (!payloadHex || payloadHex.length < MIN_PAYLOAD_HEX) continue;

      const msgType = classifyPayload(payloadHex);
      if (!msgType) continue;

      // 提取地址（API 格式和 kaspa-wasm RPC 格式不同）
      const inputAddresses = [];
      const outputAddresses = [];
      for (const inp of (tx.inputs || [])) {
        if (inp.previous_outpoint_address) inputAddresses.push(inp.previous_outpoint_address);
      }
      for (const out of (tx.outputs || [])) {
        if (out.script_public_key_address) outputAddresses.push(out.script_public_key_address);
      }

      const blockTimeIso = new Date(blockTime).toISOString();
      const blueScore = tx.accepting_block_blue_score || null;

      stats.processed++;
      log(`  [${msgType}] ${txId.slice(0, 16)}... ${blockTimeIso}`);

      const fromAddr = inputAddresses[0] || outputAddresses[0] || 'unknown';

      // 写入消息索引（所有类型统一走 _writeIndex）
      await _writeIndex(txId, address, fromAddr, msgType, payloadHex, blockTimeIso, blueScore);
      stats.indexed++;
      if (msgType === 'comm') stats.comms++;

      // 按类型分发上报（comm 只记录索引，不 ingest — 等正确的链路设计后再接入）
      if (msgType !== 'comm') {

        if (msgType === 'kanet_card') {
          await _processCard(txId, payloadHex, inputAddresses, reporter, blockTimeIso);
        } else if (msgType === 'bcast') {
          await _processBcast(txId, payloadHex, inputAddresses, reporter);
        } else if (msgType === 'handshake') {
          await _processHandshake(txId, inputAddresses, outputAddresses, reporter, address, blockTimeIso);
        } else {
          await _processGeneric(txId, msgType, inputAddresses, outputAddresses, reporter, blockTimeIso);
        }
      }
    }

    if (reachedCheckpoint) {
      log(`  reached checkpoint at offset=${offset}, stopping`);
      break;
    }

    offset += txs.length;
    if (txs.length < PAGE_SIZE) break; // 最后一页

    // 对公共 API 友好
    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
  }

  return stats;
}

// D-010 finding①根修(2026-07-10): 参数从 outputAddresses 改 inputAddresses——publisher/sender 必须
// 是签名者(密码学绑定), 不是广播者自选的 output 字段。本文件源数据(公共索引 API)每个 input 自带
// previous_outpoint_address(见调用点 155-160 行), 不需要额外查询, 纯粹是漏传参数, 非数据不可得。
async function _processCard(txId, payloadHex, inputAddresses, reporter, blockTime) {
  const { card, error } = parseCardPayload(payloadHex);
  const publisher = inputAddresses[0] || null;
  if (card && publisher) {
    try {
      await reporter.reportCards([{ address: publisher, txHash: txId, cardData: card, network: KASPA_NETWORK }]);
    } catch {}
  }
}

async function _processBcast(txId, payloadHex, inputAddresses, reporter) {
  const { bcast } = parseBcastPayload(payloadHex);
  const sender = inputAddresses[0] || null;
  if (bcast && sender) {
    try {
      await reporter.reportBroadcasts([{
        channelName: bcast.channelName, senderAddress: sender,
        content: bcast.message, txHash: txId,
      }]);
    } catch {}
  }
}

async function _processHandshake(txId, inputAddresses, outputAddresses, reporter, localAddress, blockTime) {
  const { sender, receiver } = derivePeers(inputAddresses, outputAddresses, 'handshake');
  const discoveries = [];
  const interactions = [];

  if (sender) {
    discoveries.push({ address: sender, sourceProtocol: 'kasia', txHash: txId, network: KASPA_NETWORK });
    interactions.push({
      addressA: sender, addressB: receiver || sender,
      protocol: 'kasia', txHash: txId, interactionType: 'handshake', occurredAt: blockTime,
    });
  }
  if (receiver) {
    discoveries.push({ address: receiver, sourceProtocol: 'kasia', txHash: txId, network: KASPA_NETWORK });
  }

  if (discoveries.length > 0) {
    try { await reporter.report(discoveries, interactions); } catch {}
  }

  // 如果是发给本地地址的握手 → 写 messages 表
  if (receiver && receiver === localAddress) {
    try {
      await reporter.reportMessages([{
        traceId: txId, network: KASPA_NETWORK, direction: 'inbound',
        localAddress: receiver, remoteAddress: sender, txid: txId,
        messageType: 'handshake', contentText: 'handshake request', timestamp: blockTime,
      }]);
    } catch {}
  }
}

async function _processGeneric(txId, msgType, inputAddresses, outputAddresses, reporter, blockTime) {
  const { sender, receiver } = derivePeers(inputAddresses, outputAddresses, msgType);
  if (!sender) return;
  try {
    await reporter.report(
      [{ address: sender, sourceProtocol: 'kasia', txHash: txId, network: KASPA_NETWORK }],
      [{ addressA: sender, addressB: receiver || sender, protocol: 'kasia',
         txHash: txId, interactionType: msgType, occurredAt: blockTime }],
    );
  } catch {}
}

/**
 * 上报历史 comm TX 给 Console — Relay 会从这个端点拿到并解密。
 */
/**
 * 写入消息索引
 */
async function _writeIndex(txId, forAddress, fromAddress, msgType, payloadHex, blockTime, blueScore) {
  const payloadHash = 'sha256:' + createHash('sha256').update(payloadHex).digest('hex').slice(0, 32);
  try {
    await fetch(`${CONSOLE_URL}/api/discovery/message-index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': INGEST_SECRET },
      body: JSON.stringify({
        entries: [{ txid: txId, for_address: forAddress, from_address: fromAddress,
          payload_type: msgType, payload_hash: payloadHash, block_time: blockTime,
          blue_score: blueScore, indexed_by: 'history-fetcher' }],
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
}
