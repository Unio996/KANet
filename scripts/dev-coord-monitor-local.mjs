#!/usr/bin/env node
// Chain-truth dev-coord monitor — LOCAL kaspad block-added subscription.
//
// Owner 5/13 钦定: "有本地节点(局域网有节点)就尽量用本地节点 — 减 Kaspa 公网负担".
//
// 跟老 dev-coord-monitor-chain.mjs (api.kaspa.org) 同款 chain-truth 哲学, 但实现路径换:
//   - 直接连本机 kaspad WebSocket RPC (ws://127.0.0.1:17110 经 ws-proxy → LAN 192.168.1.109)
//   - subscribeBlockAdded 实时 stream block
//   - 每 block 扫 transactions, decode payload, filter sender ∈ 4 set + channel='dev-coord'
//   - 0 公网 API 依赖, 0 indexer DB 依赖, 真 chain-truth
//
// Output 兼容老 monitor: [HH:MM:SS] <Name>: <content head>
// Log file: logs/dev-coord-monitor.log (tail -f 兼容).

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

// kaspa-wasm 用 .js + .wasm, ESM dynamic import 需经 require alias
const require = createRequire(import.meta.url);
const kaspa = require('../shared/vendor/kaspa-wasm/kaspa.js');
const { RpcClient, Encoding } = kaspa;

const SENDERS = {
  'Martin(J1)': 'kaspa:qptg465n4jedfujewj3hfgkxtysq40v2jakxp2w6uuvrhf6sajf0kzewvmcmv',
  'Bettor':     'kaspa:qz60muet908mmaea7yfnxlgz5azppmuyxuldl8lqk0snapzmmdahzuhfkdtk8',
  'J2':         'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3',
  'NWT':        'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm',
};
const ADDR_TO_NAME = Object.fromEntries(Object.entries(SENDERS).map(([k, v]) => [v, k]));

const RPC_URL = process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17110';
const NETWORK_ID = process.env.KASPA_NETWORK || 'mainnet';
const LOG_FILE = process.env.DEV_COORD_LOG
  || (process.env.KANET_ROOT ? `${process.env.KANET_ROOT}/logs/dev-coord-monitor.log`
                              : 'D:/Anthropic/logs/dev-coord-monitor.log');
try { mkdirSync(dirname(LOG_FILE), { recursive: true }); } catch {}

const SEEN_MAX = 500;
const seen = new Set();

function ts() { return new Date().toISOString().slice(11, 19); }

function emit(summary, fullPayload) {
  process.stdout.write(summary + '\n');
  const toLog = fullPayload ? `${summary}\n${fullPayload}\n--- end ---` : summary;
  try { appendFileSync(LOG_FILE, toLog + '\n'); } catch {}
}

function pruneSeen() {
  if (seen.size <= SEEN_MAX) return;
  const arr = [...seen].slice(-Math.floor(SEEN_MAX / 2));
  seen.clear();
  for (const x of arr) seen.add(x);
}

function extractOutputAddress(tx) {
  // Try several shapes (kaspa-wasm RpcClient response varies by version)
  const out0 = tx?.outputs?.[0];
  if (!out0) return null;
  return out0.verboseData?.scriptPublicKeyAddress
      || out0.verboseData?.address
      || out0.scriptPublicKey?.scriptPublicKey  // hex fallback
      || null;
}

let rpc = null;
let reconnectTimer = null;

async function connect() {
  try {
    rpc = new RpcClient({ url: RPC_URL, encoding: Encoding.Borsh, networkId: NETWORK_ID });
    await rpc.connect({});
    emit(`[${ts()}] local-monitor CONNECTED ${RPC_URL} (network=${NETWORK_ID})`);
    const info = await rpc.getServerInfo();
    emit(`[${ts()}] node synced=${info.isSynced} serverVersion=${info.serverVersion} daaScore=${info.virtualDaaScore || '?'}`);

    await rpc.subscribeBlockAdded();
    emit(`[${ts()}] subscribed block-added · watching ${Object.keys(SENDERS).length} senders for dev-coord broadcasts`);

    rpc.addEventListener('block-added', (event) => {
      try { handleBlock(event); } catch (err) { emit(`[${ts()}] block handler ERR: ${err?.message?.slice(0, 80)}`); }
    });

    rpc.addEventListener('disconnect', () => {
      emit(`[${ts()}] DISCONNECTED — reconnect in 5s`);
      scheduleReconnect();
    });
  } catch (err) {
    emit(`[${ts()}] connect FAIL: ${err?.message?.slice(0, 120)}`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try { if (rpc) await rpc.disconnect(); } catch {}
    rpc = null;
    connect();
  }, 5000);
}

function handleBlock(event) {
  const block = event?.data?.block;
  if (!block) return;
  const transactions = block.transactions || block.body?.transactions || [];
  for (const tx of transactions) {
    const txId = tx?.verboseData?.transactionId || tx?.id;
    if (!txId || seen.has(txId)) continue;
    const payloadHex = tx?.payload;
    if (!payloadHex || payloadHex.length < 20) continue;

    let decoded;
    try { decoded = Buffer.from(payloadHex, 'hex').toString('utf-8'); } catch { continue; }
    const m = decoded.match(/^ciph_msg:1:bcast:dev-coord:(.*)$/s);
    if (!m) continue;

    const outAddr = extractOutputAddress(tx);
    const name = outAddr && ADDR_TO_NAME[outAddr];
    if (!name) {
      // Not one of our tracked senders — skip silently (still mark seen)
      seen.add(txId);
      continue;
    }

    const blockMs = block.header?.timestamp ? Number(block.header.timestamp) : Date.now();
    const blockTs = new Date(blockMs).toISOString().slice(11, 19);
    const head = m[1].slice(0, 160).replace(/\n+/g, ' | ');
    emit(`[${blockTs}] ${name}: ${head}${m[1].length > 160 ? ' …' : ''}`, m[1]);
    seen.add(txId);
    pruneSeen();
  }
}

emit(`[${ts()}] local-monitor starting · RPC=${RPC_URL} · ${Object.keys(SENDERS).length} senders`);
connect();
