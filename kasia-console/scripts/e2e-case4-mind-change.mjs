// e2e-case4-mind-change.mjs — NWT 类 5 改主意 (T-J1-19l 验)
// case 4.1: 卖→买 改主意 (sell pending override 验)
// case 4.2: YES 后 NO 取消 quote
// case 4.3: 改 qty 中途 (买 50 → 中途 买 100)

import Database from 'better-sqlite3';

const SOPHIE_RELAY_ID = 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf';
const SOPHIE_ADDR = 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp';
const args = process.argv.slice(2);
const brokerArg = args.find(a => a.startsWith('--broker-kasia='));
const BROKER_KASIA = brokerArg ? brokerArg.slice(15) : null;
if (!BROKER_KASIA) { console.error('需要 --broker-kasia=kaspa:xxx'); process.exit(2); }

const CONSOLE = 'http://localhost:3100';
const db = new Database('./data/console.db', { readonly: true });

// v2 (UTXO + anti-spam): verify onchain + 加时间戳后缀避 anti-spam 14min similar
async function sendMessage(msg, opts = {}) {
  const tag = opts.noTag ? msg : `${msg} #${Date.now().toString(36).slice(-4)}`;
  const data = await fetch(`${CONSOLE}/api/relay/${SOPHIE_RELAY_ID}/send-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ type: 'send_message', target: BROKER_KASIA, message: tag }),
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

console.log('='.repeat(80));
console.log(`Case 4: 改主意 (T-J1-19l + 取消路径)`);
console.log('='.repeat(80));

await sendMessage('NO');
await new Promise(r => setTimeout(r, 5000));

let pass = 0, fail = 0;

// 4.1: 卖路径中途切买 (T-J1-19l)
console.log('\n[4.1] 卖路径中途切买');
let ts = new Date().toISOString();
await sendMessage('卖 5 KAS');
const r41a = await pollBrokerReply(ts, 30_000);
console.log(`  反馈卖单建立: ${r41a?.content?.slice(0,80)}`);
await new Promise(r => setTimeout(r, 3000));
ts = new Date().toISOString();
await sendMessage('买 50 KAS');  // 改主意切买
const r41b = await pollBrokerReply(ts, 30_000);
console.log(`  改买后反馈: ${r41b?.content?.slice(0,80)}`);
const t41Ok = r41b && (r41b.content.includes('50') || r41b.content.includes('买')) && !r41b.content.includes('地址格式');
console.log(t41Ok ? '  ✓ T4.1 PASS (sell pending 被 override)' : '  ✗ T4.1 FAIL (broker 仍要 BSC 地址 = T-J1-19l 不生效)');
if (t41Ok) pass++; else fail++;

await new Promise(r => setTimeout(r, 3000));
await sendMessage('NO');
await new Promise(r => setTimeout(r, 5000));

// 4.2: YES 后 NO 取消
console.log('\n[4.2] 报价 YES 后 NO 取消');
await sendMessage('买 12 KAS');
await new Promise(r => setTimeout(r, 8000));
ts = new Date().toISOString();
await sendMessage('NO');
const r42 = await pollBrokerReply(ts, 30_000);
console.log(`  NO 反馈: ${r42?.content?.slice(0,80)}`);
const t42Ok = r42 && (r42.content.includes('取消') || r42.content.includes('cancel'));
console.log(t42Ok ? '  ✓ T4.2 PASS' : '  ✗ T4.2 FAIL');
if (t42Ok) pass++; else fail++;

await new Promise(r => setTimeout(r, 5000));

// 4.3: 改 qty 中途
console.log('\n[4.3] 改 qty 中途 (买 30 → 改 买 60)');
await sendMessage('买 30 KAS');
await new Promise(r => setTimeout(r, 8000));
ts = new Date().toISOString();
await sendMessage('买 60 KAS');  // 改 qty
const r43 = await pollBrokerReply(ts, 30_000);
console.log(`  改 qty 反馈: ${r43?.content?.slice(0,80)}`);
const t43Ok = r43 && (r43.content.includes('60') || r43.content.includes('已经') || r43.content.includes('订单'));
console.log(t43Ok ? '  ✓ T4.3 PASS' : '  ✗ T4.3 FAIL');
if (t43Ok) pass++; else fail++;

await new Promise(r => setTimeout(r, 3000));
await sendMessage('NO');

console.log('\n' + '='.repeat(80));
console.log(`Result: ${pass}/${pass+fail} PASS (${(100*pass/(pass+fail)).toFixed(1)}%)`);
console.log('='.repeat(80));
process.exit(fail === 0 ? 0 : 1);
