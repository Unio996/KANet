// smoke-retail-dex-memory.mjs — T3 记忆蒸馏层 8 case 覆盖
// 真调 Qwen + 真 DB, 不 mock 过度.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __d = path.dirname(fileURLToPath(import.meta.url));
process.env.DB_PATH = path.join(__d, '../kasia-console/data/console.db');

const require = createRequire(path.join(__d, '../kasia-console/package.json'));
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH);

// 预清
function cleanup() {
  try {
    db.pragma('foreign_keys = OFF');
    for (const addr of ['kaspa:qtest-mem-a', 'kaspa:qtest-mem-b']) {
      db.prepare("DELETE FROM retail_dex_user_memory WHERE user_kasia_address=?").run(addr);
      const id = db.prepare('SELECT id FROM identities WHERE address=?').get(addr)?.id;
      if (id) {
        db.prepare("DELETE FROM messages WHERE sender_identity_id=? OR receiver_identity_id=?").run(id, id);
        db.prepare("DELETE FROM conversations WHERE local_identity_id=? OR remote_identity_id=?").run(id, id);
        db.prepare("DELETE FROM identities WHERE id=?").run(id);
      }
    }
    db.pragma('foreign_keys = ON');
  } catch (e) { console.log('cleanup err:', e.message); }
}
cleanup();
process.on('exit', cleanup);

const { distillIfNeeded, getMemory } = await import(
  'file:///' + path.join(__d, '../kasia-console/src/services/retail-dex-memory.js').replace(/\\/g, '/')
);

const { randomUUID } = await import('crypto');

const USER_A = 'kaspa:qtest-mem-a';
const USER_B = 'kaspa:qtest-mem-b';
const broker = db.prepare("SELECT id, address FROM relay_nodes WHERE is_dex_broker=1 LIMIT 1").get();
if (!broker) { console.error('no broker'); process.exit(1); }

// 造 identity + conversation 帮助函数
function setupUser(userAddr, msgCount) {
  const now = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO identities (id, network, address, identity_type, trust_level, is_blocked, discovery_status, confidence_score, interaction_count, created_at, updated_at) VALUES (?, 'mainnet', ?, 'remote', 'normal', 0, 'discovered', 0, 0, ?, ?)").run(randomUUID(), userAddr, now, now);
  const userId = db.prepare("SELECT id FROM identities WHERE address=?").get(userAddr).id;
  const brokerId = db.prepare("SELECT id FROM identities WHERE address=?").get(broker.address).id;

  const convId = randomUUID();
  db.prepare(`INSERT INTO conversations (id, trace_id, network, channel_type, channel_id, local_identity_id, remote_identity_id, title, status, unread_count, created_at, updated_at)
    VALUES (?, ?, 'mainnet', 'dm', NULL, ?, ?, '', 'active', 0, ?, ?)`).run(convId, 'smoke-mem-' + userAddr.slice(-6), brokerId, userId, now, now);

  // 造 N 条对话样本 (交替 inbound/outbound, 有 chain/address 信息)
  const samples = [
    ['inbound', '买 50 KAS'],
    ['outbound', '用哪条链付 USDT? BSC/ETH/TRON/SOL/Polygon'],
    ['inbound', 'BSC'],
    ['outbound', '请发你的 BSC 付款地址'],
    ['inbound', '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D'],
    ['outbound', '50 KAS @ 0.034 USDT/KAS, 付 1.7 USDT 到 Maker'],
    ['inbound', '确认'],
    ['outbound', '已上链, KAS 将直发到你 Kasia'],
    ['inbound', '再买 30 KAS, 老地址老链'],
    ['outbound', '好的, 30 KAS BSC + 0x1417 复用'],
    ['inbound', 'YES'],
    ['outbound', '订单已建'],
  ];

  for (let i = 0; i < Math.min(msgCount, samples.length); i++) {
    const [dir, txt] = samples[i];
    const ts = new Date(Date.now() - (msgCount - i) * 60000).toISOString();
    const senderId = dir === 'inbound' ? userId : brokerId;
    const receiverId = dir === 'inbound' ? brokerId : userId;
    db.prepare(`INSERT INTO messages (id, trace_id, conversation_id, direction, sender_identity_id, receiver_identity_id, message_type, content_text, received_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'text', ?, ?, ?, ?)`)
      .run(randomUUID(), 'smoke-mem-' + i, convId, dir, senderId, receiverId, txt, ts, ts, ts);
  }
  return { convId, userId, brokerId };
}

let pass = 0, fail = 0;
async function test(name, fn) {
  try {
    const r = await fn();
    if (r === true) { console.log(`  [PASS] ${name}`); pass++; }
    else { console.log(`  [FAIL] ${name}: ${r}`); fail++; }
  } catch (e) { console.log(`  [FAIL] ${name} THROW: ${e.message}`); fail++; }
}

console.log('=== T3 retail-dex-memory smoke ===\n');

// Case 1: 新用户 + 12 条 DM → triggered 且 distilled 非空
setupUser(USER_A, 12);
await test('1. 新用户 12 条 DM → triggered + distilled 非空', async () => {
  const r = await distillIfNeeded(USER_A, broker.address);
  if (!r.triggered) return `expected triggered true, got ${JSON.stringify(r)}`;
  if (!r.distilled?.distilled_summary || r.distilled.distilled_summary.length < 20) return `empty summary`;
  return true;
});

// Case 2: getMemory 返完整画像
await test('2. getMemory 返 distilled_summary + preferred_chain + pay_address', async () => {
  const m = await getMemory(USER_A);
  if (!m) return 'null';
  if (!m.distilled_summary) return 'no summary';
  if (m.preferred_chain !== 'bnb') return `chain normalize fail: got ${m.preferred_chain}`;
  if (m.preferred_pay_address !== '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D') return `addr: ${m.preferred_pay_address}`;
  if (typeof m.message_count_at_distill !== 'number' || m.message_count_at_distill !== 12)
    return `msg_count 应该是 12 (INTEGER), got ${typeof m.message_count_at_distill} ${m.message_count_at_distill}`;
  return true;
});

// Case 3: 第 2 次调 distillIfNeeded (无新 msg) → NOT triggered
await test('3. 无新消息第 2 次调 → 不 trigger (diff < threshold)', async () => {
  const r = await distillIfNeeded(USER_A, broker.address);
  if (r.triggered) return `不该 trigger, got ${JSON.stringify(r)}`;
  if (!r.reason?.includes('diff=')) return `expected diff reason, got ${r.reason}`;
  return true;
});

// Case 4: 新 user 无 memory → getMemory 返 null
await test('4. 无记录用户 → getMemory null', async () => {
  const m = await getMemory('kaspa:qnonexistent-' + Date.now());
  return m === null ? true : `expected null, got ${JSON.stringify(m)}`;
});

// Case 5: 无消息用户调 distill → 不 trigger
await test('5. 无 DM 用户调 distillIfNeeded → reason=no_messages', async () => {
  const r = await distillIfNeeded('kaspa:qempty-' + Date.now(), broker.address);
  return r.triggered === false && r.reason === 'no_messages' ? true : `got ${JSON.stringify(r)}`;
});

// Case 6: 少于 threshold 消息 (5 条) → 第一次也不 trigger
setupUser(USER_B, 5);
await test('6. 用户只 5 条 DM (< 10) → 不 trigger', async () => {
  const r = await distillIfNeeded(USER_B, broker.address);
  return r.triggered === false && r.reason?.includes('diff=5') ? true : `got ${JSON.stringify(r)}`;
});

// Case 7: null userAddr 安全返
await test('7. null userAddr → 不崩', async () => {
  const r = await distillIfNeeded(null, broker.address);
  return r.triggered === false && r.reason === 'no_user_addr' ? true : `got ${JSON.stringify(r)}`;
});

// Case 8: preferred_chain 白名单外的 LLM 输出应被归一或置 null
// (用 case 1 的 distilled 间接验: LLM 可能返 "BSC" 被归一 "bnb")
await test('8. preferred_chain LLM 返 "BSC" → 归一 "bnb"', async () => {
  const m = await getMemory(USER_A);
  return m?.preferred_chain === 'bnb' ? true : `chain: ${m?.preferred_chain}`;
});

console.log(`\n=== ${pass}/${pass+fail} passed ===`);
db.close();
process.exit(fail === 0 ? 0 : 1);
