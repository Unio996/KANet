// J2 #3 23:26 求 NWT 真测 — 现 SYSTEM_PROMPT KAS-only 文案, LLM 真识别 'buy USDC' 不?
// LLM 真 fall to tool call: tool args 含 give_asset='USDC' 还是 default 'KAS'?

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const TRADER_B_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const PEER = 'kaspa:qpr_nwt_usdc_test_' + Date.now().toString(36);

const db = new Database('data/console.db');
const broker = db.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(TRADER_B_RELAY_ID);
const brokerIdent = db.prepare(`SELECT id FROM identities WHERE address=?`).get(broker.address);
const now = new Date().toISOString();

// seed peer identity (无 history, fresh peer)
const peerId = randomUUID();
db.prepare(`
  INSERT INTO identities (id, network, address, identity_type, created_at, updated_at, is_blocked, trust_level, discovery_status, interaction_count, probe_attempt_count, successful_contact_count, confidence_score, card_has_ext)
  VALUES (?, 'kaspa-mainnet', ?, 'kasia_user', ?, ?, 0, 'unknown', 'discovered', 0, 0, 0, 0.5, 0)
`).run(peerId, PEER, now, now);

console.log('=== 真测 LLM behavior with current SYSTEM_PROMPT (KAS-only 文案) ===\n');

async function dm(msg) {
  const t0 = Date.now();
  const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ relayNodeId: TRADER_B_RELAY_ID, peer: PEER, message: msg }),
  });
  const dt = Date.now() - t0;
  const data = await res.json().catch(() => ({}));
  return { reply: data.reply || '', ms: dt };
}

console.log('Test 1: user 真 DM "想买 1 USDC, BSC" — broker LLM 是不是识别 USDC?');
const r1 = await dm('想买 1 USDC, BSC');
console.log(`(${r1.ms}ms) reply: ${r1.reply.slice(0, 300)}`);

console.log('\nTest 2: 看是不是真 publish USDC offer (DB 实证)');
await new Promise(r => setTimeout(r, 5000));
const recentOffers = db.prepare(`
  SELECT id, give_asset, give_amount, want_asset, want_amount, maker, created_at
  FROM exchange_offers
  WHERE created_at > ? AND maker = ?
  ORDER BY created_at DESC LIMIT 3
`).all(now, broker.address);
console.log(`recent offers (broker maker, post seed):`);
recentOffers.forEach(o => console.log(`  ${o.id.slice(0,8)} ${o.give_amount} ${o.give_asset} for ${o.want_amount} ${o.want_asset}`));

// cleanup
db.prepare(`DELETE FROM messages WHERE sender_identity_id=? OR receiver_identity_id=?`).run(peerId, peerId);
db.prepare(`DELETE FROM identities WHERE id=?`).run(peerId);
console.log('\ncleanup peer identity done');
