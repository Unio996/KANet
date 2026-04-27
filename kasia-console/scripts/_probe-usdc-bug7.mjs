// 真 dig Bug 7 — fresh peer 真 trigger USDC e2e step 1-3 (绕 anti-spam fuzzy 14min)
// 真 capture: LLM 真识别 USDC + 真调 finalize_order tool + 真 publish USDC offer + DB verify

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const TRADER_B_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const PEER = 'kaspa:qpr_nwt_usdc_bug7_' + Date.now().toString(36);
const FAKE_BSC_ADDR = '0xCa11C4f2fc4858Ad48aB6F2a18d6f0e8f8Cdf7B5';

const db = new Database('data/console.db');
const broker = db.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(TRADER_B_RELAY_ID);
const brokerIdent = db.prepare(`SELECT id FROM identities WHERE address=?`).get(broker.address);
const now = new Date().toISOString();

const peerId = randomUUID();
db.prepare(`INSERT INTO identities (id, network, address, identity_type, created_at, updated_at, is_blocked, trust_level, discovery_status, interaction_count, probe_attempt_count, successful_contact_count, confidence_score, card_has_ext) VALUES (?, 'kaspa-mainnet', ?, 'kasia_user', ?, ?, 0, 'unknown', 'discovered', 0, 0, 0, 0.5, 0)`).run(peerId, PEER, now, now);
console.log(`fresh peer: ${PEER}\n`);

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

console.log('── turn 1: BUY USDC ──');
const r1 = await dm(`想买 1 USDC`);
console.log(`(${r1.ms}ms): ${r1.reply.slice(0, 250)}\n`);

await new Promise(r => setTimeout(r, 2000));
console.log('── turn 2: BSC chain + addr (LLM 真应调 preview_order) ──');
const r2 = await dm(`BSC, 我地址 ${FAKE_BSC_ADDR}`);
console.log(`(${r2.ms}ms): ${r2.reply.slice(0, 400)}\n`);

await new Promise(r => setTimeout(r, 2000));
console.log('── turn 3: YES (Bug 7 hotfix _pendingPreview 真触发 deterministic finalize) ──');
const r3 = await dm('YES');
console.log(`(${r3.ms}ms): ${r3.reply.slice(0, 400)}\n`);

await new Promise(r => setTimeout(r, 8000));
console.log('── DB 真 verify USDC offer 真 publish ──');
const offers = db.prepare(`
  SELECT id, give_asset, give_amount, want_asset, want_amount, protocol_status, taker, taker_payment_address, payment_tx, created_at
  FROM exchange_offers
  WHERE give_asset='USDC' AND created_at > ?
  ORDER BY created_at DESC LIMIT 5
`).all(now);
console.log(`USDC offers post-trigger: ${offers.length}`);
offers.forEach(o => console.log(`  ${o.id.slice(0,8)} ${o.give_amount} USDC for ${o.want_amount} USDT, status=${o.protocol_status}, taker=${o.taker?.slice(0,30) || 'null'}, taker_pay_addr=${o.taker_payment_address || 'null'}`));

// cleanup peer (offers 留 real audit)
db.prepare(`DELETE FROM messages WHERE sender_identity_id=? OR receiver_identity_id=?`).run(peerId, peerId);
db.prepare(`DELETE FROM identities WHERE id=?`).run(peerId);
console.log('\ncleanup peer done');
