// tmp-smoke-t3-opus.mjs — Opus 独立验 T3 (QClaude 没交 smoke 文件)

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __d = path.dirname(fileURLToPath(import.meta.url));
process.env.DB_PATH = path.join(__d, '../kasia-console/data/console.db');

const require = createRequire(path.join(__d, '../kasia-console/package.json'));
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH);

const { distillIfNeeded, getMemory } = await import(
  'file:///' + path.join(__d, '../kasia-console/src/services/retail-dex-memory.js').replace(/\\/g, '/')
);

const USER = 'kaspa:qtest-t3-user';
const BROKER = 'kaspa:qtest-t3-broker';

// 清理
db.prepare("DELETE FROM retail_dex_user_memory WHERE user_kasia_address=?").run(USER);
db.prepare("DELETE FROM identities WHERE address IN (?, ?)").run(USER, BROKER);
db.prepare("DELETE FROM conversations WHERE trace_id LIKE 'test-t3-%'").run();
db.prepare("DELETE FROM messages WHERE trace_id LIKE 'test-t3-%'").run();

process.on('exit', () => {
  try {
    db.prepare("DELETE FROM retail_dex_user_memory WHERE user_kasia_address=?").run(USER);
    db.prepare("DELETE FROM identities WHERE address IN (?, ?)").run(USER, BROKER);
    db.prepare("DELETE FROM conversations WHERE trace_id LIKE 'test-t3-%'").run();
    db.prepare("DELETE FROM messages WHERE trace_id LIKE 'test-t3-%'").run();
  } catch {}
});

const { randomUUID } = await import('crypto');
const now = new Date().toISOString();

// 造 identities
const userIdRow = db.prepare("INSERT INTO identities (id, network, address, identity_type, trust_level, is_blocked, discovery_status, confidence_score, interaction_count, created_at, updated_at) VALUES (?, 'mainnet', ?, 'remote', 'normal', 0, 'discovered', 0, 0, ?, ?)").run(randomUUID(), USER, now, now);
const brokerId = db.prepare("SELECT id FROM relay_nodes WHERE is_dex_broker=1 LIMIT 1").get()?.id;
const brokerAddr = db.prepare("SELECT address FROM relay_nodes WHERE id=?").get(brokerId)?.address;

const userIdentId = db.prepare("SELECT id FROM identities WHERE address=?").get(USER)?.id;
const brokerIdentId = db.prepare("SELECT id FROM identities WHERE address=?").get(brokerAddr)?.id;

// 造 conversation
const convId = randomUUID();
db.prepare(`INSERT INTO conversations (id, trace_id, network, channel_type, channel_id, local_identity_id, remote_identity_id, title, status, unread_count, created_at, updated_at)
  VALUES (?, 'test-t3-conv', 'mainnet', 'dm', NULL, ?, ?, '', 'active', 0, ?, ?)`).run(convId, brokerIdentId, userIdentId, now, now);

// 造 12 条消息模拟对话
const msgs = [
  ['inbound', '买 50 KAS'],
  ['outbound', '请问用哪条链支付 USDT？'],
  ['inbound', 'BSC'],
  ['outbound', '请发你的 BSC 付款地址'],
  ['inbound', '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D'],
  ['outbound', '50 KAS @ 0.034 USDT/KAS, 付 1.7 USDT 到 Maker BSC'],
  ['inbound', 'YES'],
  ['outbound', '已上链, Maker 发 KAS 中'],
  ['inbound', '买 30 KAS'],
  ['outbound', '还用老地址 0x1417 BSC 付款吗?'],
  ['inbound', '是的'],
  ['outbound', '好的, 30 KAS 单已创建'],
];

for (let i = 0; i < msgs.length; i++) {
  const [dir, txt] = msgs[i];
  const ts = new Date(Date.now() - (msgs.length - i) * 60000).toISOString();
  const senderId = dir === 'inbound' ? userIdentId : brokerIdentId;
  const receiverId = dir === 'inbound' ? brokerIdentId : userIdentId;
  db.prepare(`INSERT INTO messages (id, trace_id, conversation_id, direction, sender_identity_id, receiver_identity_id, message_type, content_text, received_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'text', ?, ?, ?, ?)`)
    .run(randomUUID(), 'test-t3-' + i, convId, dir, senderId, receiverId, txt, ts, ts, ts);
}

console.log('=== 造了 12 条假 DM ===');
console.log('Broker:', brokerAddr);
console.log('User:', USER);

console.log('\n=== 第 1 次 distillIfNeeded (应 trigger, 12 >= 10) ===');
const r1 = await distillIfNeeded(USER, brokerAddr);
console.log('result:', JSON.stringify(r1, null, 2));

console.log('\n=== 看 DB 落库 ===');
const mem = await getMemory(USER);
console.log('memory:', JSON.stringify(mem, null, 2));

console.log('\n=== 第 2 次 distillIfNeeded (不该 trigger, 差值 < 10) ===');
const r2 = await distillIfNeeded(USER, brokerAddr);
console.log('result:', JSON.stringify(r2, null, 2));

console.log('\n=== getMemory 不存在用户 ===');
const mem2 = await getMemory('kaspa:qnonexistent');
console.log('null test:', mem2);

db.close();
