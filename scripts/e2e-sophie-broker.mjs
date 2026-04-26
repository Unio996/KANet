// e2e-sophie-broker.mjs — J1 机 Sophie 真发 Kasia DM 给 NWT 机 broker, 全链路验证.
//
// 真链路: Sophie (J1 机) → Kaspa 链 → broker relay (NWT 机) ingest → broker 处理 →
//        broker reply → Kaspa 链 → Sophie (J1 机) ingest → 验证文案.
//
// Owner 命令: 三方 RED 全 GREEN 前先准备脚本, GREEN 后立即跑.
//
// Run: node scripts/e2e-sophie-broker.mjs [--msg="买 50 KAS"] [--broker-kasia=kaspa:xxx]

import Database from 'better-sqlite3';

const SOPHIE_RELAY_ID = 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf';
const SOPHIE_ADDR = 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp';
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';

const args = process.argv.slice(2);
const msgArg = args.find(a => a.startsWith('--msg='));
const brokerArg = args.find(a => a.startsWith('--broker-kasia='));
const userMsg = msgArg ? msgArg.slice(6) : '买 50 KAS';
const BROKER_KASIA = brokerArg ? brokerArg.slice(15) : null;

if (!BROKER_KASIA) {
  console.error('需要 --broker-kasia=kaspa:xxx (broker 的 Kasia 地址, 从 NWT 机 console.db relay_nodes 查)');
  process.exit(2);
}

const CONSOLE = 'http://localhost:3100';

console.log('='.repeat(80));
console.log(`E2E: Sophie → broker 真链路验证`);
console.log(`  Sophie:  ${SOPHIE_ADDR}`);
console.log(`  Broker:  ${BROKER_KASIA}`);
console.log(`  Message: "${userMsg}"`);
console.log(`  msg utf8 bytes: ${Buffer.byteLength(userMsg, 'utf8')}`);
console.log('='.repeat(80));

// Step 1: Sophie 通过 sendCommand 真发 Kasia DM (走链上)
console.log('\n[1/3] Sophie sendCommand send_message → broker (上链)');
const t0 = Date.now();
const sendRes = await fetch(`${CONSOLE}/api/relay/command`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    relayNodeId: SOPHIE_RELAY_ID,
    command: { type: 'send_message', target: BROKER_KASIA, message: userMsg },
  }),
});
const sendData = await sendRes.json();
console.log(`  → ${JSON.stringify(sendData).slice(0, 200)}`);
if (!sendData.ok) {
  console.error('Sophie send failed, abort');
  process.exit(3);
}
const sendTx = sendData.txId || sendData.txid;
console.log(`  TX: ${sendTx}, latency: ${Date.now() - t0}ms`);

// Step 2: 轮询 messages 表等 broker reply 入站 ingest (跨机 ingest, ~30s-2min)
console.log('\n[2/3] 等 broker reply 跨机 ingest (Sophie 收到 inbound from broker)');
const db = new Database('D:/Anthropic/kasia-console/data/console.db', { readonly: true });
const POLL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const startTs = new Date().toISOString();
let brokerReply = null;
const tStart = Date.now();
while (Date.now() - tStart < POLL_TIMEOUT_MS) {
  const row = db.prepare(`
    SELECT m.id, m.content_text, m.created_at
    FROM messages m
    LEFT JOIN identities si ON si.id = m.sender_identity_id
    LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
    WHERE m.message_type='text'
      AND si.address = ?
      AND ri.address = ?
      AND m.direction = 'inbound'
      AND m.created_at > ?
    ORDER BY m.created_at DESC LIMIT 1
  `).get(BROKER_KASIA, SOPHIE_ADDR, startTs);
  if (row) {
    brokerReply = row;
    break;
  }
  process.stdout.write('.');
  await new Promise(r => setTimeout(r, POLL_MS));
}
console.log('');
if (!brokerReply) {
  console.error('TIMEOUT: 5min 内 Sophie 没收到 broker reply. 失败原因可能:');
  console.error('  - broker 在 NWT 机没起 / NWT console down');
  console.error('  - 跨机 ingest 路径 broken');
  console.error('  - broker 处理出错没回 (查 NWT 机 broker.log)');
  process.exit(4);
}
console.log(`✓ broker reply 收到 (latency: ${((Date.now() - tStart)/1000).toFixed(1)}s)`);
console.log(`  content: "${brokerReply.content_text}"`);

// Step 3: 验证 reply 内容
console.log('\n[3/3] 验证 reply 文案');
const reply = brokerReply.content_text || '';
const checks = [
  { name: '不含[LLM]/[DET] 标记 (生产 reply 应该 clean, 测试 marker 不该泄漏)', pass: !/\[LLM\]|\[DET\]/.test(reply) },
  { name: '含 KAS qty (50)', pass: /50/.test(reply) },
  { name: '不问"买还是卖" (deterministic 应该跳过方向问)', pass: !/买还是卖|想买还是卖|买.*还是.*卖/.test(reply) },
  { name: '提到链选项 (BSC/Polygon/SOL/TRON)', pass: /BSC|Polygon|SOL|TRON|链/i.test(reply) },
];
let pass = 0, fail = 0;
for (const c of checks) {
  console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}`);
  if (c.pass) pass++; else fail++;
}
console.log(`\n${pass}/${checks.length} checks pass`);
console.log(fail === 0 ? '✓ E2E PASS — Owner 可以真 Kasia GUI 测了' : '✗ E2E FAIL — 不交 Owner');
process.exit(fail === 0 ? 0 : 1);
