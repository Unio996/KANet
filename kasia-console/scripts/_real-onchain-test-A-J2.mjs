// 真上链测试 A — J2 (kasia: c9c37c37) 真 DM Trader-B 5 角度真上链
// 走 /api/relay/:id/send-command type='send_message' 真上链 DM
// 等 broker 真回 (cross-relay 延迟 ~10-30s), verify messages 表真 inbound + outbound

const J2_RELAY = 'c9c37c37-9a8c-484c-9893-20185d97ccf9';
const J2_ADDR = 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3';
const TRADER_B_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

// 改 message 让每条不同, 避 anti-spam 14min similar (>86%) 拦
const cases = [
  { id: 'A1', msg: '想要买 3 个 KAS 测试 ' + Date.now().toString(36).slice(-4), expect_re: '哪个链|chain', wait_ms: 30000 },
  { id: 'A2', msg: 'KAS 现在啥价位 ' + Date.now().toString(36).slice(-4), expect_re: 'KAS|价|USDT', wait_ms: 30000 },
  { id: 'A3', msg: '不要再发了 ' + Date.now().toString(36).slice(-4), expect_re: '不打扰|mute|stop', wait_ms: 30000 },
  { id: 'A4', msg: '已经付款了请处理 ' + Date.now().toString(36).slice(-4), expect_re: 'active|订单|tx|hash|没', wait_ms: 30000 },
  { id: 'A5', msg: '哥们儿在不? ' + Date.now().toString(36).slice(-4), expect_re: '在|帮你|交易|想', wait_ms: 30000 },
];

async function sendDM(msg) {
  const res = await fetch(`http://127.0.0.1:3100/api/relay/${J2_RELAY}/send-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'send_message', target: TRADER_B_ADDR, message: msg }),
  });
  return res.json();
}

// 查 J2 真收到 broker reply (messages 表 inbound from Trader-B)
async function pollReply(sinceTs, timeoutMs) {
  const Db = (await import('better-sqlite3')).default;
  const db = new Db('data/console.db', { readonly: true });
  const tb = db.prepare(`SELECT id FROM identities WHERE display_name='Trader-B'`).get();
  const j2 = db.prepare(`SELECT id FROM identities WHERE address=?`).get(J2_ADDR);
  if (!tb || !j2) { console.warn(`  identity lookup fail: tb=${!!tb} j2=${!!j2}`); db.close(); return null; }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = db.prepare(`
      SELECT content_text, created_at FROM messages
      WHERE sender_identity_id=? AND receiver_identity_id=? AND created_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).get(tb.id, j2.id, sinceTs);
    if (r) { db.close(); return r; }
    await new Promise(r => setTimeout(r, 2000));
  }
  db.close();
  return null;
}

console.log('=== A 真上链测试 J2 → Trader-B (真上链 DM, broker 真回) ===\n');

let pass = 0, fail = 0;
for (const c of cases) {
  console.log(`\n--- ${c.id}: "${c.msg}" ---`);
  const sinceTs = new Date().toISOString();
  const sendStart = Date.now();
  const sendRes = await sendDM(c.msg);
  const sendMs = Date.now() - sendStart;
  if (!sendRes.ok || !sendRes.txId) {
    console.log(`  ✗ send fail: ${sendRes.error || JSON.stringify(sendRes)}`);
    fail++;
    continue;
  }
  console.log(`  ✓ DM 真上链 tx ${sendRes.txId.slice(0,12)}... (${sendMs}ms)`);

  // 等 broker reply 真到达 messages 表 (跨 relay chain 延迟)
  console.log(`  ⏳ 等 broker reply (max ${c.wait_ms/1000}s)...`);
  const reply = await pollReply(sinceTs, c.wait_ms);
  if (!reply) {
    console.log(`  ✗ broker timeout — no reply in ${c.wait_ms/1000}s`);
    fail++;
    continue;
  }
  const text = (reply.content_text || '').replace(/\s+/g, ' ');
  const matched = new RegExp(c.expect_re, 'i').test(text);
  if (matched) {
    pass++;
    console.log(`  ✓ broker reply: "${text.slice(0, 120)}"`);
  } else {
    fail++;
    console.log(`  ✗ broker reply 不匹: "${text.slice(0, 120)}"`);
    console.log(`    expect: /${c.expect_re}/i`);
  }
  // ANTI-PATTERNS R13: J2 普通 agent 没 broker queue, 真发 DM 同 UTXO 5 连发撞双花.
  // 等 30s 让 UTXO 真上链 + mempool clear. 5 case × 30s = 2.5min (慢但稳).
  console.log('  ⏳ UTXO clear 30s...');
  await new Promise(r => setTimeout(r, 30000));
}

console.log(`\n=== A 真上链 ${pass}/5 PASS ===`);
process.exit(fail === 0 ? 0 : 1);
