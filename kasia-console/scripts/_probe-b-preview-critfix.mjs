// NWT 接位 #2 — verify J2 09ab89e97 critfix (LLM 编 fake 地址灾难修)
//
// 真路径: /api/agent/reply 多轮 (同 peer 保 history) → step 3 触 preview_order tool → preview_text 一字不改.
//
// 通过条件 (4 条铁律, 任一 fail = critfix 没真生效):
//   1. 最终 reply 含真 maker_addr 0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe
//   2. 最终 reply NOT 含 fake placeholder 0x1234567890 (无论字面或缩短)
//   3. 最终 reply 含真 user_kasia kaspa:qr7km875... (Sophie peer 自己地址)
//   4. 最终 reply 含 preview_text 锚点 '📋' (LLM 没 strip emoji 重排)

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';

// Sophie 真 peer (从 channel scan c142f5d7 J1 audit) — kasia addr 后缀已知
// 但为不污染 Sophie 真 history, 用 fake peer with predictable suffix.
// fake peer 走 conversations.js 同样 DB history loader, broker LLM 同样路径.
const PEER = 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqfaketestnwt9999';

const REAL_BROKER_BSC = '0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe';
const FAKE_PLACEHOLDER = '0x1234567890';
const PREVIEW_ANCHOR = '📋';

async function send(message, label) {
  const t0 = Date.now();
  const res = await fetch(`${CONSOLE_URL}/api/agent/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ relayNodeId: BROKER_RELAY_ID, peer: PEER, message }),
  });
  const dt = Date.now() - t0;
  const data = await res.json().catch(() => ({}));
  const reply = data.reply ?? data.error ?? '';
  console.log(`\n── ${label} (${dt}ms) ──`);
  console.log(`> peer: ${message}`);
  console.log(`< broker: ${reply}`);
  return reply;
}

console.log(`Probing ${CONSOLE_URL} broker (relay ${BROKER_RELAY_ID.slice(0, 8)})`);
console.log(`Peer: ${PEER}\n`);

// turn 1: 买意图
await send('想买 5 KAS', 'turn 1: BUY intent');

// turn 2: 选链 (LLM 应 step 3 → preview_order tool → preview_text)
const reply2 = await send('BSC', 'turn 2: chain → expect PREVIEW');

console.log('\n=== critfix 验证 ===');
const c1 = reply2.includes(REAL_BROKER_BSC);
const c2 = !reply2.includes(FAKE_PLACEHOLDER);
const c3 = reply2.includes('kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqfaketestnwt9999');
const c4 = reply2.includes(PREVIEW_ANCHOR);

console.log(`[${c1 ? '✓' : '✗'}] 真 maker_addr 0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe in reply`);
console.log(`[${c2 ? '✓' : '✗'}] NOT contains fake 0x1234567890`);
console.log(`[${c3 ? '✓' : '✗'}] 真 user_kasia (peer 自己地址) in reply`);
console.log(`[${c4 ? '✓' : '✗'}] preview_text anchor '📋' present (LLM 没 strip)`);

const allPass = c1 && c2 && c3 && c4;
console.log(`\n=== ${allPass ? '🎉 CRITFIX 真生效' : '🚨 CRITFIX 未真生效, escalate'} ===`);
process.exit(allPass ? 0 : 1);
