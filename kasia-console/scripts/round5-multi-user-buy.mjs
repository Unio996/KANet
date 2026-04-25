// Round 5 multi-user concurrent BUY 真测 (R5 Service 范式)
//
// 三人 Martin / Sophie / Eric 同时下单 broker, 验:
// 1. broker queue 单线 pump 按 FIFO 处理三笔 (不抢 UTXO 不撞 anti-spam)
// 2. 三人各收报价 / 付款指引 / 完成通知 (broker DM UX 完整)
// 3. 三笔协议层全 completed (3 个 offer 各自 verifier + auto-deliver)
//
// 前置:
// - broker = Trader-B is_service=1 (Service 范式, Mind 全禁)
// - 3 maker offers open (Qwen 25 KAS x3 manually published)

import Database from 'better-sqlite3';
import { transferERC20 } from '../src/services/evm-transfer.js';

const TRADER_B = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const CONSOLE = process.env.KANET_CONSOLE || 'http://localhost:3100';
const QWEN_BNB = '0xACbCC246F230aEA5154307bE946bCB61C93fbAA6';

const USERS = [
  { name: 'Martin', relayId: '3765cc82-5e20-4e61-bb0a-697277287223', kasiaTail: 'jf0kzewvmcmv', qty: 10, payUsdt: 0.34 },
  { name: 'Sophie', relayId: 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf', kasiaTail: 'je4cgx2ktetp', qty: 15, payUsdt: 0.51 },
  { name: 'Eric',   relayId: '6fb00ee9-af18-47f4-99fa-111ee477621d', kasiaTail: 'kzc2tgz4cchh', qty: 20, payUsdt: 0.68 },
];

const db = new Database('./data/console.db', { readonly: true });

async function dm(relayId, msg) {
  const res = await fetch(`${CONSOLE}/api/relay/${relayId}/send-command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ type: 'send_message', target: TRADER_B, message: msg }),
  });
  return res.json();
}

async function getInbound(userTail, sinceIso, contains) {
  const m = db.prepare(`
    SELECT direction, source_txid, content_text, received_at FROM messages
    WHERE direction='inbound' AND received_at > ?
      AND sender_identity_id IN (SELECT id FROM identities WHERE address LIKE '%' || ?)
      AND receiver_identity_id IN (SELECT id FROM identities WHERE address LIKE '%' || ?)
      AND content_text LIKE '%' || ? || '%'
    ORDER BY received_at DESC LIMIT 1
  `).get(sinceIso, 'hy65lxur9c5l', userTail, contains);
  return m;
}

async function waitForDm(userTail, sinceIso, contains, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const m = await getInbound(userTail, sinceIso, contains);
    if (m) return m;
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

(async () => {
  const startIso = new Date(Date.now() - 5000).toISOString();
  console.log(`[r5-multi] start ${startIso}`);
  console.log(`[r5-multi] 3 users concurrent buy: ${USERS.map(u => `${u.name}(${u.qty})`).join(', ')}`);

  // Step 1: 三人同时 DM "买 X KAS"
  console.log('\n[r5-multi] Step 1: 3 users send buy DMs concurrently');
  const buyResults = await Promise.all(USERS.map(async u => {
    const msg = `买 ${u.qty} KAS`;
    const r = await dm(u.relayId, msg);
    console.log(`  ${u.name}: tx=${r.txId?.slice(0,12)}`);
    return { user: u, tx: r.txId };
  }));

  // Step 2: 等三人各自收报价
  console.log('\n[r5-multi] Step 2: wait for 3 quotes (180s timeout each)');
  const quotes = {};
  for (const u of USERS) {
    const q = await waitForDm(u.kasiaTail, startIso, '报价', 180000);
    if (!q) { console.error(`  ${u.name}: NO quote received`); }
    else { console.log(`  ${u.name}: quote received (tx ${q.source_txid?.slice(0,12)})`); }
    quotes[u.name] = q;
  }
  if (Object.values(quotes).some(q => !q)) {
    console.error('[r5-multi] FAIL Step 2: not all quotes received');
    process.exit(2);
  }

  // Step 3: 三人同时确认
  console.log('\n[r5-multi] Step 3: 3 users send confirm DMs concurrently');
  const confirmResults = await Promise.all(USERS.map(async u => {
    const msg = ['确认', '好', '行'][USERS.indexOf(u) % 3];
    const r = await dm(u.relayId, msg);
    console.log(`  ${u.name}: confirm "${msg}" tx=${r.txId?.slice(0,12)}`);
    return r;
  }));

  // Step 4: 等三人各自收付款指引
  console.log('\n[r5-multi] Step 4: wait for 3 pay-instr DMs (180s)');
  const payInstrs = {};
  for (const u of USERS) {
    const p = await waitForDm(u.kasiaTail, startIso, '已接单', 180000);
    if (!p) console.error(`  ${u.name}: NO pay instr`);
    else console.log(`  ${u.name}: pay instr (tx ${p.source_txid?.slice(0,12)})`);
    payInstrs[u.name] = p;
  }

  // Step 5: 三人 BSC 转 USDT 给 Qwen (concurrent)
  console.log('\n[r5-multi] Step 5: 3 users transfer USDT to Qwen BSC concurrently');
  const txs = await Promise.all(USERS.map(async u => {
    const w = db.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' AND is_default=1").get(u.relayId);
    const t = await transferERC20('bnb', w.privkey_encrypted, QWEN_BNB, u.payUsdt);
    console.log(`  ${u.name}: BSC ${u.payUsdt} USDT → Qwen tx=${t.txHash?.slice(0,16)}`);
    return { user: u, txHash: t.txHash };
  }));

  // Step 6: 三人 DM "我付了 tx X (R5 user N)"
  console.log('\n[r5-multi] Step 6: 3 users DM PAID concurrently');
  await Promise.all(txs.map(async (t, idx) => {
    const msg = `我付了 R5${t.user.name} tx ${t.txHash}`;
    const r = await dm(t.user.relayId, msg);
    console.log(`  ${t.user.name}: paid DM tx=${r.txId?.slice(0,12)}`);
  }));

  // Step 7: 等三人完成通知
  console.log('\n[r5-multi] Step 7: wait for 3 completion DMs (300s)');
  const completions = {};
  for (const u of USERS) {
    const c = await waitForDm(u.kasiaTail, startIso, '已到', 300000);
    if (!c) console.error(`  ${u.name}: NO completion`);
    else console.log(`  ${u.name}: ✓ completion (tx ${c.source_txid?.slice(0,12)})`);
    completions[u.name] = c;
  }

  // 报告
  const passQuote = Object.values(quotes).filter(Boolean).length;
  const passPay   = Object.values(payInstrs).filter(Boolean).length;
  const passDone  = Object.values(completions).filter(Boolean).length;
  console.log(`\n[r5-multi] === RESULT ===`);
  console.log(`  quotes:      ${passQuote}/3`);
  console.log(`  pay-instr:   ${passPay}/3`);
  console.log(`  completion:  ${passDone}/3`);
  console.log(`  PASS = ${passQuote === 3 && passPay === 3 && passDone === 3 ? 'YES ✓' : 'NO ❌'}`);
  process.exit(passQuote === 3 && passPay === 3 && passDone === 3 ? 0 : 3);
})().catch(e => { console.error('script err:', e); process.exit(99); });
