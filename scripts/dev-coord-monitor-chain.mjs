#!/usr/bin/env node
// Chain-truth dev-coord monitor — bypass local DB / indexer entirely.
//
// Why: 5/12 + 5/13 实证 indexer 双向漏拉 broadcast (scout PID stale OR scout forward-only-scan).
// 老 dev-coord-poll.mjs 走 /api/chat/messages 依赖本地 DB → silent miss.
//
// 修法: 直接 Kaspa public REST API 查 4 sender (Martin/Bettor/J2/NWT) full-transactions, 解码
// `ciph_msg:1:bcast:<channel>:<content>` payload, emit 每条新 TX. 完全无 indexer 依赖.
//
// Output (stdout, 跟老 monitor compatible):
//   [HH:MM:SS] <SenderName>: <first 160 chars of content>...
//
// Also written to logs/dev-coord-monitor.log for tail -f.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const REST_BASE = 'https://api.kaspa.org';
const POLL_MS = 8_000;        // 8s tick — REST API rate limit 余量
const FETCH_TIMEOUT_MS = 8_000;
const LOOKBACK_MIN = 30;       // 启动时回扫近 30 分钟内 TX, init cursor
const PER_SENDER_LIMIT = 5;    // 每 sender 每 tick 拉最近 5 条 (cap output noise)
const LOG_FILE = process.env.DEV_COORD_LOG
  || (process.env.KANET_ROOT ? `${process.env.KANET_ROOT}/logs/dev-coord-monitor.log`
                              : 'D:/Anthropic/logs/dev-coord-monitor.log');
try { mkdirSync(dirname(LOG_FILE), { recursive: true }); } catch {}

const SENDERS = {
  'Martin(J1)': 'kaspa:qptg465n4jedfujewj3hfgkxtysq40v2jakxp2w6uuvrhf6sajf0kzewvmcmv',
  'Bettor':     'kaspa:qz60muet908mmaea7yfnxlgz5azppmuyxuldl8lqk0snapzmmdahzuhfkdtk8',
  'J2':         'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3',
  'NWT':        'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm',
};

// In-memory seen-set per sender (TX id → emitted). Bound size to avoid leak.
const SEEN_MAX = 200;
const seen = Object.create(null);
for (const name of Object.keys(SENDERS)) seen[name] = new Set();

function pruneSeen(set) {
  if (set.size <= SEEN_MAX) return;
  // Drop oldest half (Set preserves insertion order)
  const arr = [...set];
  const keep = arr.slice(-Math.floor(SEEN_MAX / 2));
  set.clear();
  for (const x of keep) set.add(x);
}

function ts() { return new Date().toISOString().slice(11, 19); }

function emit(summary, fullPayload) {
  process.stdout.write(summary + '\n');
  const toLog = fullPayload ? `${summary}\n${fullPayload}\n--- end ---` : summary;
  try { appendFileSync(LOG_FILE, toLog + '\n'); } catch {}
}

async function fetchSenderTx(addr) {
  const url = `${REST_BASE}/addresses/${encodeURIComponent(addr)}/full-transactions?limit=${PER_SENDER_LIMIT}&resolve_previous_outpoints=no`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const arr = await res.json();
  return Array.isArray(arr) ? arr : [];
}

function decodeBcast(tx) {
  if (!tx?.payload) return null;
  let decoded;
  try { decoded = Buffer.from(tx.payload, 'hex').toString('utf-8'); } catch { return null; }
  const m = decoded.match(/^ciph_msg:1:bcast:([^:]+):(.*)$/s);
  if (!m) return null;
  return { channel: m[1], content: m[2] };
}

// Phase 1: init seen-set — anchor ALL currently-fetched TXes (no emit).
// pollOnce 之后只 emit 真 new TX (即 init 后才上链的).
async function initSeenSet() {
  let totalInit = 0;
  for (const [name, addr] of Object.entries(SENDERS)) {
    try {
      const txs = await fetchSenderTx(addr);
      for (const tx of txs) {
        if (!tx.transaction_id) continue;
        seen[name].add(tx.transaction_id);
        totalInit++;
      }
    } catch (e) {
      emit(`[${ts()}] init ERR for ${name}: ${e.message?.slice(0, 60)}`);
    }
  }
  emit(`[${ts()}] chain-monitor INIT · ${totalInit} TXes anchored (silent) · ${Object.keys(SENDERS).length} senders · tick ${POLL_MS}ms`);
}

async function pollOnce() {
  for (const [name, addr] of Object.entries(SENDERS)) {
    let txs;
    try {
      txs = await fetchSenderTx(addr);
    } catch (e) {
      // Transient REST API failure — log once per minute max
      if (!seen.__lastErrAt || Date.now() - seen.__lastErrAt > 60_000) {
        emit(`[${ts()}] REST ERR ${name}: ${e.message?.slice(0, 60)}`);
        seen.__lastErrAt = Date.now();
      }
      continue;
    }
    for (const tx of txs) {
      const tid = tx.transaction_id;
      if (!tid || seen[name].has(tid)) continue;
      const bcast = decodeBcast(tx);
      if (!bcast || bcast.channel !== 'dev-coord') {
        seen[name].add(tid);
        continue;
      }
      // Filter dev-coord broadcasts only
      const t = tx.block_time ? new Date(tx.block_time).toISOString().slice(11, 19) : ts();
      const head = bcast.content.slice(0, 160).replace(/\n+/g, ' | ');
      emit(`[${t}] ${name}: ${head}${bcast.content.length > 160 ? ' …' : ''}`, bcast.content);
      seen[name].add(tid);
      pruneSeen(seen[name]);
    }
  }
}

// Main loop
emit(`[${ts()}] chain-monitor starting · REST=${REST_BASE} · tick=${POLL_MS}ms · senders=[${Object.keys(SENDERS).join(', ')}]`);
await initSeenSet();
let inFlight = false;
setInterval(async () => {
  if (inFlight) return;
  inFlight = true;
  try { await pollOnce(); } catch (e) {
    emit(`[${ts()}] poll loop ERR: ${e.message?.slice(0, 80)}`);
  } finally { inFlight = false; }
}, POLL_MS);
