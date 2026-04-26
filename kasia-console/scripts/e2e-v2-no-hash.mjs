// e2e-v2-no-hash.mjs — v2 真测 Owner 钦定路径
// Sophie 全程: DM 想买 → broker 报价 → 选 BSC → YES → 真转 USDT → 等 60s
// 不发 tx hash, 不告诉 broker 我付了, broker 必须自己 BSC indexer 监听到入账 + 发 KAS.
//
// 等 NWT bsc-incoming-watcher ship 后跑. 现写 ready.

import Database from 'better-sqlite3';
import { transferERC20 } from '../src/services/evm-transfer.js';

const SOPHIE_RELAY_ID = 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf';
const SOPHIE_ADDR = 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp';
const args = process.argv.slice(2);
const brokerArg = args.find(a => a.startsWith('--broker-kasia='));
const qtyArg = args.find(a => a.startsWith('--qty='));
const BROKER_KASIA = brokerArg ? brokerArg.slice(15) : null;
const QTY = qtyArg ? parseFloat(qtyArg.slice(6)) : 5;
if (!BROKER_KASIA) { console.error('需要 --broker-kasia=kaspa:xxx'); process.exit(2); }

const CONSOLE = 'http://localhost:3100';
const db = new Database('./data/console.db', { readonly: true });

async function sendMessage(msg) {
  const data = await fetch(`${CONSOLE}/api/relay/${SOPHIE_RELAY_ID}/send-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ type: 'send_message', target: BROKER_KASIA, message: msg }),
  }).then(r => r.json());
  if (!data.ok || data.error) return { ok: false, error: data.error || 'send_failed' };
  if (!data.txId) return { ok: false, error: 'no txId' };
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const onchain = db.prepare("SELECT 1 FROM kaspa_tx_log WHERE tx_id=?").get(data.txId);
    if (onchain) return { ok: true, txId: data.txId };
  }
  return { ok: false, error: 'tx not in kaspa_tx_log after 12s', txId: data.txId };
}

async function pollBrokerReply(startTs, timeoutMs = 60_000) {
  const tStart = Date.now();
  while (Date.now() - tStart < timeoutMs) {
    const row = db.prepare(`
      SELECT m.content_text, m.created_at FROM messages m
      LEFT JOIN identities si ON si.id = m.sender_identity_id
      LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
      WHERE m.message_type='text' AND si.address=? AND ri.address=? AND m.direction='inbound' AND m.created_at > ?
      ORDER BY m.created_at DESC LIMIT 1
    `).get(BROKER_KASIA, SOPHIE_ADDR, startTs);
    if (row) return { content: row.content_text, latency: Date.now() - tStart };
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

async function pollKasReceived(startTs, timeoutMs = 120_000) {
  // wait for broker → Sophie KAS transfer onchain (broker 真发 KAS 到 Sophie)
  const tStart = Date.now();
  while (Date.now() - tStart < timeoutMs) {
    const row = db.prepare(`
      SELECT tx_id, observed_at FROM kaspa_tx_log
      WHERE to_address = ? AND observed_at > ?
        AND amount > 0
      ORDER BY observed_at DESC LIMIT 1
    `).get(SOPHIE_ADDR, startTs);
    if (row) return { tx_id: row.tx_id, observed_at: row.observed_at };
    await new Promise(r => setTimeout(r, 5000));
  }
  return null;
}

console.log('='.repeat(80));
console.log(`e2e v2: Sophie 真转 USDT → broker 60s 自动发 KAS (不发 tx hash)`);
console.log(`  qty: ${QTY} KAS`);
console.log(`  broker: ${BROKER_KASIA.slice(0, 24)}...`);
console.log('='.repeat(80));

// Step 1: Sophie '想买 X KAS'
console.log(`\n[1] Sophie DM '想买 ${QTY} KAS'`);
let ts = new Date().toISOString();
const r1 = await sendMessage(`想买 ${QTY} KAS`);
if (!r1.ok) { console.error(`fail: ${r1.error}`); process.exit(3); }
const reply1 = await pollBrokerReply(ts, 60_000);
console.log(`  broker reply: ${reply1?.content?.slice(0, 100)}`);

// Step 2: 'BSC'
console.log(`\n[2] Sophie 'BSC'`);
ts = new Date().toISOString();
const r2 = await sendMessage('BSC');
if (!r2.ok) { console.error(`fail: ${r2.error}`); process.exit(3); }
const reply2 = await pollBrokerReply(ts, 60_000);
console.log(`  broker reply: ${reply2?.content?.slice(0, 200)}`);

// Step 3: Extract maker_addr + USDT amount from broker reply
const replyContent = reply2?.content || '';
const makerMatch = replyContent.match(/0x[a-fA-F0-9]{40}/);
const usdtMatch = replyContent.match(/(\d+\.\d+)\s*USDT/i);
if (!makerMatch || !usdtMatch) {
  console.error(`fail: 无法 parse maker_addr / USDT amount from broker reply: "${replyContent}"`);
  process.exit(3);
}
const makerAddr = makerMatch[0];
const usdtAmount = parseFloat(usdtMatch[1]);
console.log(`  parsed: maker=${makerAddr} USDT=${usdtAmount}`);

// Step 4: 'YES' confirm
console.log(`\n[3] Sophie 'YES'`);
ts = new Date().toISOString();
const r3 = await sendMessage('YES');
if (!r3.ok) { console.error(`fail: ${r3.error}`); process.exit(3); }
const reply3 = await pollBrokerReply(ts, 60_000);
console.log(`  broker reply: ${reply3?.content?.slice(0, 100)}`);

// Step 5: Sophie 真转 USDT 到 maker_addr (BSC)
console.log(`\n[4] Sophie evm-transfer 真转 ${usdtAmount} USDT (BSC) → ${makerAddr}`);
const sophieWallet = db.prepare(`
  SELECT privkey_encrypted FROM agent_wallets
  WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1
`).get(SOPHIE_RELAY_ID);
if (!sophieWallet?.privkey_encrypted) { console.error('Sophie no BSC wallet'); process.exit(3); }

const transferStart = new Date().toISOString();
const transferRes = await transferERC20('bnb', sophieWallet.privkey_encrypted, makerAddr, usdtAmount);
if (!transferRes.ok) { console.error(`USDT transfer fail: ${transferRes.error}`); process.exit(3); }
console.log(`  USDT BSC tx: ${transferRes.txHash} (sent ${usdtAmount} USDT)`);

// Step 6: 等 broker 60s 自动发 KAS (BSC indexer 检测到入账 → paid_v1 → cross-chain-verify → deliver KAS)
console.log(`\n[5] 等 broker 60-120s 自动发 KAS (Sophie 不发任何 hash)`);
const kasReceived = await pollKasReceived(transferStart, 120_000);
if (!kasReceived) {
  console.log(`  ✗ FAIL: 120s 内 Sophie 没收到 broker KAS`);
  console.log(`  期望: bsc-incoming-watcher 检测 USDT 入账 broker → 触发 paid_v1 → broker transfer KAS 到 Sophie`);
  process.exit(1);
}
console.log(`  ✓ Sophie 收到 KAS! tx ${kasReceived.tx_id?.slice(0, 16)} @ ${kasReceived.observed_at}`);

console.log('\n' + '='.repeat(80));
console.log('✓ E2E v2 PASS — 全程不发 hash, broker 自动 indexer 检测到 USDT → 自动发 KAS');
console.log('='.repeat(80));
process.exit(0);
