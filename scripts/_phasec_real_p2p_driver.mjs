// DEPRECATED 5/21 (J2 #637 Group C audit, KI 63 整合):
// Driver for _phasec_real_p2p_path1/path2_sell (already DEPRECATED by NWT N19.159).
// broker-v2 era P2P encrypted DM mode (ii). broker-v3 native real-chain DM via cn_buyer_real / cn_seller_real persona.
// Framework equivalent: test-framework/lib/real-chain-runner.mjs + personas/real-chain/.
//
// _phasec_real_p2p_driver.mjs — Phase C real P2P chain DM driver.
//
// J1 ed759126 Path 4 T1+T2 实施 reference. NWT 14:36 mode (ii) propose.
// 跟 framework runner sync HTTP /api/agent/reply 不同 — 真 P2P encrypted DM TX 上链.
//
// Usage:
//   node _phasec_real_p2p_driver.mjs <fromRelayId> <toAddr> <message...>
//
// Each turn: relay sendCommand send_message → real chain TX → poll messages table for
// inbound from <toAddr> by scout sync. Returns chain TX hash + reply content.
//
// Composable: caller scripts daisy-chain T1→T2→T3→... 真 P2P. Mind autonomous interference
// 真 risk (real kasia identity 触发 Mind reply path), 跟 freshTestPeer 不同 noise.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Resolve better-sqlite3 from kasia-console node_modules (this script lives in scripts/, sibling)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'kasia-console', 'package.json'));
const Database = require('better-sqlite3');

const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';
// T-J2-2026-05-05 cross-platform path fix (NWT r209 钦定 KI-XX 候补 'driver script cross-platform path'):
// 原 hardcode 'D:/Anthropic/...' C 盘节点跑撞 'no such table'. 改 path.join from script location 跨平台 default.
const DB_PATH = process.env.CONSOLE_DB || path.join(__dirname, '..', 'kasia-console', 'data', 'console.db');
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || 30000);
const POLL_INTERVAL_MS = 1500;

async function sendChainDM(fromRelayId, toAddr, message) {
  const res = await fetch(`${CONSOLE_URL}/api/relay/${fromRelayId}/send-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'send_message', target: toAddr, message }),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error(`send-command HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return { txId: body.txId, fee: body.fee, ts: new Date().toISOString() };
}

async function pollReply(fromAddr, toAddr, sinceIso, expectedSourceTxid) {
  const db = new Database(DB_PATH, { readonly: true });
  const start = Date.now();
  // Poll until inbound from `fromAddr` (broker) lands after sinceIso (after our send).
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const rows = db.prepare(`
      SELECT m.id, m.created_at, m.source_txid, substr(m.content_text, 1, 600) as content
      FROM messages m
      LEFT JOIN identities si ON si.id = m.sender_identity_id
      LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
      WHERE m.created_at > ?
        AND m.direction = 'inbound'
        AND si.address = ?
        AND ri.address = ?
      ORDER BY m.created_at DESC LIMIT 10
    `).all(sinceIso, fromAddr, toAddr);
    if (rows.length) {
      db.close();
      return rows.reverse();  // chronological order
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  db.close();
  throw new Error(`pollReply timeout ${POLL_TIMEOUT_MS}ms (no inbound from ${fromAddr.slice(-12)} since ${sinceIso})`);
}

export async function realP2PTurn({ fromRelayId, fromAddr, toAddr, message, label, since, pollTimeoutMs }) {
  const sendStart = since || new Date().toISOString();
  const send = await sendChainDM(fromRelayId, toAddr, message);
  // pollTimeoutMs override per-call (framework runner case-level), else env POLL_TIMEOUT_MS, else default
  const effectiveTimeout = pollTimeoutMs || POLL_TIMEOUT_MS;
  const replies = await pollReplyWithTimeout(toAddr, fromAddr, sendStart, send.txId, effectiveTimeout);
  return {
    label: label || 'turn',
    sent: { txId: send.txId, fee: send.fee, ts: send.ts, message },
    replies: replies.map(r => ({ txId: r.source_txid, ts: r.created_at, content: r.content })),
  };
}

async function pollReplyWithTimeout(fromAddr, toAddr, sinceIso, expectedSourceTxid, timeoutMs) {
  const db = new Database(DB_PATH, { readonly: true });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = db.prepare(`
      SELECT m.id, m.created_at, m.source_txid, substr(m.content_text, 1, 600) as content
      FROM messages m
      LEFT JOIN identities si ON si.id = m.sender_identity_id
      LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
      WHERE m.created_at > ? AND m.direction = 'inbound' AND si.address = ? AND ri.address = ?
      ORDER BY m.created_at DESC LIMIT 10
    `).all(sinceIso, fromAddr, toAddr);
    if (rows.length) { db.close(); return rows.reverse(); }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  db.close();
  throw new Error(`pollReply timeout ${timeoutMs}ms (no inbound from ${fromAddr.slice(-12)} since ${sinceIso})`);
}

// CLI entry — Windows-safe URL compare via pathToFileURL
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [fromRelayId, toAddr, ...msgParts] = process.argv.slice(2);
  if (!fromRelayId || !toAddr || !msgParts.length) {
    console.error('Usage: node _phasec_real_p2p_driver.mjs <fromRelayId> <toAddr> <message...>');
    process.exit(2);
  }
  const message = msgParts.join(' ');
  // Resolve fromAddr from relay_nodes table for poll lookup
  const db = new Database(DB_PATH, { readonly: true });
  const fr = db.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(fromRelayId);
  db.close();
  if (!fr?.address) { console.error(`relay ${fromRelayId} not found`); process.exit(2); }
  realP2PTurn({ fromRelayId, fromAddr: fr.address, toAddr, message, label: 'cli' })
    .then(r => { console.log(JSON.stringify(r, null, 2)); })
    .catch(e => { console.error('ERR:', e.message); process.exit(1); });
}
