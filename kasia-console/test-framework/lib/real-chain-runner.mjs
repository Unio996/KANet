// Real-chain test runner library (NWT N19.33 framework sediment, 5/19 Owner 钦定)
//
// Extract from MVP scripts (_nwt_realchain_*.mjs, _nwt_option_b_fire.mjs scattered 9 files).
// Provides:
//   - sendDm(relayId, peerKasia, msg) — real Kasia DM via /api/relay/{id}/send-command
//   - waitForReply(senderId, receiverId, afterIso, timeoutMs) — poll messages table
//   - dmRoundTrip(relayId, peerKasia, msg, ...) — combined send + wait reply
//   - parseQuote(text) — extract "精确 X.XX USDT" + "0x... addr" from broker quote
//   - transferEvmUsdt(privkeyEnc, chain, amount, recipient) — real-chain ERC20 transfer
//   - pollOfferStatus(offerId, timeoutMs) — poll until terminal status
//   - pollChainEvents(sinceIso, eventTypes, timeoutMs) — wait until events appear
//   - publishOffer(opts) — direct POST /api/exchange/publish (Option B path)
//   - getRelayBalance(relayId) — KAS balance for fund-lock pre-check
//
// Differs from first framework (test-framework/lib/runner.mjs):
//   - First framework: sync /api/agent/reply (no chain)
//   - This framework: real Kasia DM (chain broadcast TX) + real EVM transfer + real settlement
//
// Anti-patterns enforced (KI sediment):
//   - KI 19: distinct qty per round (broker amount tolerance 0.5% → distinct > 1%)
//   - Bug AW race: minimum 60s gap between rounds (wait escrow terminal)
//   - feedback_realchain_test_use_node_fetch_not_bash_curl_5_17: Node fetch with utf-8

import Database from 'better-sqlite3';
import { ethers } from 'ethers';
import { decrypt } from '../../src/services/crypto.js';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';
const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';

export const ASSETS = {
  USDT_BSC: '0x55d398326f99059fF775485246999027B3197955',
  USDT_POLYGON: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
};

export const RPC = {
  bnb: 'https://bsc-dataseed1.binance.org',
  polygon: 'https://polygon-rpc.com',
};

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getReadDb() {
  return new Database(DB_PATH, { readonly: true });
}

// ── Identity / relay lookup ──────────────────────────────────────

let _identityCache = {};
export function getIdentityId(kasiaAddr) {
  if (_identityCache[kasiaAddr]) return _identityCache[kasiaAddr];
  const db = getReadDb();
  const r = db.prepare("SELECT id FROM identities WHERE address=?").get(kasiaAddr);
  db.close();
  if (r) _identityCache[kasiaAddr] = r.id;
  return r?.id;
}

export function getRelayInfo(relayName) {
  const db = getReadDb();
  const r = db.prepare("SELECT id, address FROM relay_nodes WHERE name=?").get(relayName);
  db.close();
  return r;
}

export async function getRelayBalance(relayId) {
  try {
    const r = await fetch(`${CONSOLE_URL}/api/relay/${relayId}/balance`, {
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    return parseFloat(j.balance || 0);
  } catch (e) {
    return null;
  }
}

// ── DM round-trip (real Kasia chain) ─────────────────────────────

export async function sendDm(relayId, targetKasia, message) {
  const r = await fetch(`${CONSOLE_URL}/api/relay/${relayId}/send-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ type: 'send_message', target: targetKasia, message }),
  });
  const j = await r.json();
  if (j.blocked) throw new Error(`SEND_BLOCKED: ${j.error}`);
  if (!j.ok || !j.txId) throw new Error(`SEND_FAIL: ${JSON.stringify(j).slice(0, 200)}`);
  return { txId: j.txId, fee: j.fee };
}

export async function waitForReply(senderKasia, receiverKasia, afterIso, opts = {}) {
  const { timeoutMs = 45000, pollMs = 2000 } = opts;
  const senderId = getIdentityId(senderKasia);
  const receiverId = getIdentityId(receiverKasia);
  if (!senderId || !receiverId) throw new Error('identity not found');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const db = getReadDb();
    const m = db.prepare(`
      SELECT source_txid, content_text, created_at
      FROM messages
      WHERE sender_identity_id=? AND receiver_identity_id=? AND created_at>?
      ORDER BY created_at ASC LIMIT 1
    `).get(senderId, receiverId, afterIso);
    db.close();
    if (m) return m;
    await sleep(pollMs);
  }
  return null;
}

export async function dmRoundTrip(relayId, userKasia, brokerKasia, message, opts = {}) {
  const t0 = new Date().toISOString();
  const sent = await sendDm(relayId, brokerKasia, message);
  const reply = await waitForReply(brokerKasia, userKasia, t0, opts);
  return { sendTxId: sent.txId, fee: sent.fee, reply };
}

// ── Quote parsing ────────────────────────────────────────────────

export function parseQuote(text) {
  if (!text) return null;
  const amtMatch = text.match(/精确\s*([\d.]+)\s*USDT/);
  const addrMatch = text.match(/(0x[a-fA-F0-9]{40})/);
  if (!amtMatch || !addrMatch) return null;
  return { amount: amtMatch[1], address: addrMatch[1] };
}

// ── EVM USDT transfer (real chain) ───────────────────────────────

export async function transferEvmUsdt(relayName, chain, amountHuman, recipient) {
  const db = getReadDb();
  const w = db.prepare(`
    SELECT privkey_encrypted FROM agent_wallets
    WHERE relay_node_id IN (SELECT id FROM relay_nodes WHERE name=?)
      AND chain=? AND is_default=1
  `).get(relayName, chain);
  db.close();
  if (!w?.privkey_encrypted) throw new Error(`no privkey for ${relayName} ${chain}`);

  const rpcUrl = RPC[chain];
  const tokenAddr = chain === 'bnb' ? ASSETS.USDT_BSC : ASSETS.USDT_POLYGON;
  if (!rpcUrl || !tokenAddr) throw new Error(`unsupported chain ${chain}`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(decrypt(w.privkey_encrypted), provider);
  const usdt = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
  const decimals = chain === 'bnb' ? 18 : 6;
  const wei = ethers.parseUnits(amountHuman, decimals);
  const tx = await usdt.transfer(recipient, wei);
  await tx.wait();
  return tx.hash;
}

// ── Offer publish (Option B path — direct /api/exchange/publish) ─

export async function publishOffer(opts) {
  const {
    relayId,
    give_asset, give_amount, give_chain,
    want_asset, want_amount, want_chain,
    accepted_chains, expected_asset, receive_chain,
    expires_minutes = 30,
    verification = 'cross_chain_tx',
  } = opts;
  const body = {
    relayNodeId: relayId,
    give_asset, give_amount, give_chain,
    want_asset, want_amount, want_chain,
    verification,
    verification_meta: { accepted_chains, expected_asset, receive_chain },
    expires_minutes,
  };
  const r = await fetch(`${CONSOLE_URL}/api/exchange/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ── Offer status polling ─────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'expired', 'refunded', 'timed_out']);

export async function pollOfferStatus(offerId, opts = {}) {
  const { timeoutMs = 10 * 60 * 1000, pollMs = 5000 } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const db = getReadDb();
    const o = db.prepare(`
      SELECT id, protocol_status, taker, completed_at, payment_tx, delivery_tx, broadcast_tx_id
      FROM exchange_offers WHERE id=?
    `).get(offerId);
    db.close();
    if (o && TERMINAL_STATUSES.has(o.protocol_status)) return o;
    await sleep(pollMs);
  }
  return null;
}

// ── Chain events ─────────────────────────────────────────────────

export function getChainEvents(sinceIso, eventTypePatterns) {
  const db = getReadDb();
  const patterns = Array.isArray(eventTypePatterns) ? eventTypePatterns : [eventTypePatterns];
  const where = patterns.map(() => 'event_type LIKE ?').join(' OR ');
  const rows = db.prepare(`
    SELECT event_type, txid, from_address, to_address, payload, observed_at
    FROM chain_events
    WHERE observed_at > ? AND (${where})
    ORDER BY observed_at DESC LIMIT 50
  `).all(sinceIso, ...patterns);
  db.close();
  return rows;
}

export async function pollChainEvents(sinceIso, eventTypes, opts = {}) {
  const { timeoutMs = 5 * 60 * 1000, pollMs = 8000, untilFound } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = getChainEvents(sinceIso, eventTypes);
    if (untilFound) {
      const match = events.find(e => untilFound(e));
      if (match) return { events, match };
    } else if (events.length) {
      return { events };
    }
    await sleep(pollMs);
  }
  return { events: getChainEvents(sinceIso, eventTypes) };
}

// ── DM-driven broker buy flow (NWT BUY KAS via broker) ───────────

export async function brokerBuyFlow(relayId, userKasia, brokerKasia, opts) {
  const { qty, chain = 'BSC', userEvmAddr, dmTimeoutMs = 45000 } = opts;
  if (!qty || qty < 1) throw new Error(`qty must be >= 1 (broker min), got ${qty}`);

  // 6-step DM with smart quote detection
  const steps = [
    ['back', 'reset'],
    ['1', 'BUY'],
    [chain === 'BSC' ? '1' : chain === 'ETH' ? '2' : '3', `chain=${chain}`],
    [String(qty), `qty=${qty}`],
    [userEvmAddr, 'addr'],
    ['1', 'mid'],
    ['1', 'confirm-1'],
    ['1', 'confirm-2'],
  ];

  for (const [msg, label] of steps) {
    const { reply } = await dmRoundTrip(relayId, userKasia, brokerKasia, msg, { timeoutMs: dmTimeoutMs });
    if (!reply) return { ok: false, error: `step ${label} timeout` };
    const quote = parseQuote(reply.content_text);
    if (quote) {
      return { ok: true, quote, reply };
    }
    await sleep(2500);
  }
  return { ok: false, error: 'no quote captured after 8 steps' };
}
