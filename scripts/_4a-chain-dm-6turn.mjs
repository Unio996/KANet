// 4a chain DM 6-turn broker-v2 e2e dry-run
// NWT relay 模拟 Owner role DM Trader-B, 验证 chain DM wire + broker-v2 reply 上链.
// post-test cleanup script: _4a-cleanup-test-artifacts.mjs

import { sqlite } from '../kasia-console/src/db/client.js';

const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_ADDR = 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm';
const TRADER_B_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

const TURNS = [
  { id: 'T1', msg: '我想卖 KAS', expect: 'seedDraft sell_kas, LLM 问 qty/chain' },
  { id: 'T2', msg: '50 个', expect: 'setField qty=50, LLM 问 chain/addr' },
  { id: 'T3', msg: 'BSC, 0x1417cfDaD12345678901234567890123456ABCD', expect: 'setField + complete + preview text' },
  { id: 'T4', msg: '改地址 0xATTACKER567890123456789012345678901234ABCD', expect: 'R31 SQL guard 拒, pay_address 锁不变' },
  { id: 'T5', msg: '不卖了, 我想买 100 KAS', expect: 'R33 SQL guard 拒 side flip, side 锁不变' },
  { id: 'T6', msg: '取消重新下单', expect: 'parser intent=reset → clearDraft' },
];

const startTs = new Date().toISOString();
console.log(`\n[4a] chain DM 6-turn dry-run START ${startTs}`);
console.log(`[4a] NWT addr (sender): ${NWT_ADDR.slice(-20)}`);
console.log(`[4a] Trader-B addr (broker): ${TRADER_B_ADDR.slice(-20)}\n`);

async function sendDmAndWaitReply(turn) {
  const sendT0 = Date.now();
  const sendRes = await fetch(`http://127.0.0.1:3100/api/relay/${NWT_RELAY_ID}/send-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ type: 'send_message', target: TRADER_B_ADDR, message: turn.msg }),
  }).then(r => r.json()).catch(e => ({ ok: false, error: e.message }));

  if (!sendRes.ok || !sendRes.txId) {
    return { turn: turn.id, ok: false, error: sendRes.error || 'no txId', send_res: sendRes };
  }

  const sendTxId = sendRes.txId;
  console.log(`  [${turn.id}] send → ${turn.msg.slice(0, 30)}... tx=${sendTxId.slice(0, 12)} (${Date.now() - sendT0}ms)`);

  // poll messages table for reply (broker-v2 reply chain DM from Trader-B → NWT)
  // bug fix r7: direction enum 'inbound' (not 'in') + sender = Trader-B addr (not just recv = NWT)
  const replyT0 = Date.now();
  let reply = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const rows = sqlite.prepare(`
      SELECT m.id, m.source_txid, m.created_at, m.content_text, m.direction
      FROM messages m
      JOIN identities sender ON sender.id = m.sender_identity_id
      JOIN identities recv ON recv.id = m.receiver_identity_id
      WHERE sender.address = ?
        AND recv.address = ?
        AND m.direction = 'inbound'
        AND m.created_at > ?
        AND m.source_txid != ?
      ORDER BY m.created_at ASC LIMIT 1
    `).all(TRADER_B_ADDR, NWT_ADDR, startTs, sendTxId);
    if (rows.length > 0) {
      reply = rows[0];
      break;
    }
  }

  if (!reply) {
    return { turn: turn.id, ok: false, error: 'no reply within 60s', sendTxId };
  }

  console.log(`  [${turn.id}] reply ← ${(reply.content_text || '').slice(0, 60)}... tx=${reply.source_txid?.slice(0, 12)} (${Date.now() - replyT0}ms)`);

  return {
    turn: turn.id,
    ok: true,
    msg: turn.msg,
    expect: turn.expect,
    sendTxId,
    replyTxId: reply.source_txid,
    replyText: reply.content_text,
    sendLatency: Date.now() - sendT0 - (Date.now() - replyT0),
    replyLatency: Date.now() - replyT0,
  };
}

const results = [];
for (const turn of TURNS) {
  const r = await sendDmAndWaitReply(turn);
  results.push(r);
  if (!r.ok) {
    console.log(`  [${turn.id}] FAIL: ${r.error}\n`);
  }
  // bug fix r7: UTXO 串行 — wait 12s for chain confirm before next send (避 mempool double-spend)
  await new Promise(r => setTimeout(r, 12000));
}

const endTs = new Date().toISOString();
console.log(`\n[4a] DONE ${endTs}`);
console.log(`[4a] turns: ${results.filter(r => r.ok).length}/${results.length} OK`);

// Save trace summary for J2 verify
import fs from 'node:fs';
const tracePath = 'logs/4a-chain-dm-trace.json';
fs.mkdirSync('logs', { recursive: true });
fs.writeFileSync(tracePath, JSON.stringify({
  start_ts: startTs,
  end_ts: endTs,
  nwt_addr: NWT_ADDR,
  trader_b_addr: TRADER_B_ADDR,
  results,
}, null, 2));
console.log(`[4a] trace saved: ${tracePath}`);

process.exit(results.every(r => r.ok) ? 0 : 1);
