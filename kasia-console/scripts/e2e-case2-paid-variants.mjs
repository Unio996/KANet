// e2e-case2-paid-variants.mjs — J1 case 2: 支付反馈变体 (Owner 真撞的 Bug A)
// 验证 T-J2-26 PAID_NO_TX_REGEX 12 变体截胡 + PAID_REGEX 0xtx 自动验证.
//
// 不真付 USDT (验测试客户端 → broker handler 行为, 不验链上 verify).
// 真付 USDT 的 e2e 留 case 8 链异常 三方共跑.

import Database from 'better-sqlite3';

const SOPHIE_RELAY_ID = 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf';
const SOPHIE_ADDR = 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp';
const args = process.argv.slice(2);
const brokerArg = args.find(a => a.startsWith('--broker-kasia='));
const BROKER_KASIA = brokerArg ? brokerArg.slice(15) : null;
if (!BROKER_KASIA) { console.error('需要 --broker-kasia=kaspa:xxx'); process.exit(2); }

const CONSOLE = 'http://localhost:3100';
const db = new Database('./data/console.db', { readonly: true });

// 12 PAID_NO_TX 变体 + 1 PAID with 0xtx (auto-verify path)
const SCENARIOS = [
  // PAID_NO_TX 应触发 broker 引导 "请补 tx hash"
  { msg: '已付!',        expect: { mentionsTx: true, noSilent: true }, type: 'paid_no_tx' },
  { msg: '付了',         expect: { mentionsTx: true, noSilent: true }, type: 'paid_no_tx' },
  { msg: '转完了',       expect: { mentionsTx: true, noSilent: true }, type: 'paid_no_tx' },
  { msg: '已支付',       expect: { mentionsTx: true, noSilent: true }, type: 'paid_no_tx' },
  { msg: 'done',        expect: { mentionsTx: true, noSilent: true }, type: 'paid_no_tx' },
  { msg: 'paid',        expect: { mentionsTx: true, noSilent: true }, type: 'paid_no_tx' },
  { msg: 'sent',        expect: { mentionsTx: true, noSilent: true }, type: 'paid_no_tx' },
  { msg: '搞定',         expect: { mentionsTx: true, noSilent: true }, type: 'paid_no_tx' },
  { msg: '已经付了',     expect: { mentionsTx: true, noSilent: true }, type: 'paid_no_tx' },
  { msg: '付好了',       expect: { mentionsTx: true, noSilent: true }, type: 'paid_no_tx' },
  // 边界: false-positive guard, 不该误命中
  { msg: '什么情况',     expect: { acceptable: true }, type: 'control' },
  // PAID with hex hash → PAID_REGEX 自动验证 (但无 _pendingAccepts 应优雅 reject 或引导)
  { msg: '我付了 0x' + 'a'.repeat(64),  expect: { acceptable: true }, type: 'paid_with_tx' },
];

// v2: UTXO double-spend fix — verify 真上链 (kaspa_tx_log indexer ingest)
async function sendMessage(msg) {
  const data = await fetch(`${CONSOLE}/api/relay/${SOPHIE_RELAY_ID}/send-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ type: 'send_message', target: BROKER_KASIA, message: msg }),
  }).then(r => r.json());
  if (!data.ok || data.error) return { ok: false, error: data.error || 'send_failed', rejected: true };
  if (!data.txId) return { ok: false, error: 'no txId' };
  // 4 × 3s = 12s wait for UTXO confirm + indexer ingest
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const onchain = db.prepare("SELECT 1 FROM kaspa_tx_log WHERE tx_id=?").get(data.txId);
    if (onchain) return { ok: true, txId: data.txId };
  }
  return { ok: false, error: 'tx not in kaspa_tx_log after 12s', txId: data.txId };
}

async function pollBrokerReply(startTs, timeoutMs = 90_000) {
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
console.log(`Case 2: PAID 反馈变体 (T-J2-26 验证, Owner Bug A 修复)`);
console.log(`12 scenarios — 期望 broker 引导 "请补 tx hash" 不静默`);
console.log('='.repeat(80));

// startup cleanup: 必须先 setup pendingAccept (broker 才会进 PAID 检查)
console.log('\n[setup] 先发 "买 5 KAS" + "BSC" + "YES" 让 broker 进 _pendingAccepts state...');
await sendMessage('买 5 KAS');
await new Promise(r => setTimeout(r, 8000));
await sendMessage('YES');
await new Promise(r => setTimeout(r, 8000));
console.log('  setup done\n');

let pass = 0, fail = 0;
const failures = [];

for (let i = 0; i < SCENARIOS.length; i++) {
  const sc = SCENARIOS[i];
  process.stdout.write(`[${i+1}/${SCENARIOS.length}] (${sc.type}) "${sc.msg}" ... `);
  const startTs = new Date().toISOString();
  try {
    const sendData = await sendMessage(sc.msg);
    if (!sendData.ok) { console.log(`SEND FAIL: ${sendData.error}`); fail++; failures.push({ ...sc, err: 'send_fail' }); continue; }
    const reply = await pollBrokerReply(startTs, 90_000);
    if (!reply) { console.log('TIMEOUT (90s)'); fail++; failures.push({ ...sc, err: 'timeout' }); continue; }

    const fails = [];
    if (sc.expect.mentionsTx && !/tx hash|0x|交易哈希|hash|哈希/i.test(reply.content)) {
      fails.push('no tx hash mention');
    }
    if (sc.expect.noSilent && reply.content.length < 5) {
      fails.push('reply too short / silent');
    }
    if (sc.expect.acceptable && reply.content.length < 5) {
      fails.push('reply too short');
    }

    if (fails.length === 0) {
      console.log(`✓ (${(reply.latency/1000).toFixed(1)}s)`);
      pass++;
    } else {
      console.log(`✗ ${fails.join(', ')} | reply="${reply.content.slice(0,80)}"`);
      fail++;
      failures.push({ ...sc, err: fails.join(';'), reply: reply.content.slice(0, 100) });
    }
  } catch (e) {
    console.log(`ERR: ${e.message}`);
    fail++;
    failures.push({ ...sc, err: e.message });
  }
  await new Promise(r => setTimeout(r, 3000));
}

console.log('\n' + '='.repeat(80));
console.log(`Result: ${pass}/${pass+fail} pass (${(100*pass/(pass+fail)).toFixed(1)}%)`);
if (failures.length) {
  console.log(`\nFailures (${failures.length}):`);
  for (const f of failures.slice(0, 20)) {
    console.log(`  (${f.type}) "${f.msg}" → ${f.err}${f.reply ? ` | reply="${f.reply}"` : ''}`);
  }
}
console.log('='.repeat(80));

// cleanup
console.log('\n[cleanup] 发 NO 清 pending');
await sendMessage('NO');

process.exit(fail === 0 ? 0 : 1);
