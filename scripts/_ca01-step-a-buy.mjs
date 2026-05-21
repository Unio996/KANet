#!/usr/bin/env node
// DEPRECATED 5/21 (Owner ack option 3, KI 63 整合 Group B):
// HTTP-mock /api/agent/reply pattern. 真链等价 framework cases:
//   - test-framework/cases/dm-flow/buy_cancel_full_dm_e2e.test.mjs (BUY real-chain Tier 4)
//   - test-framework/cases/multi-agent/stress_5_buyers_concurrent.test.mjs (multi-buyer real-chain)
// "BUY-then-SELL same-user 跨 direction" scenario 排日 backlog (docs/BACKLOG.md KI-63-backlog-1).
// DO NOT execute — kept for historical reference.
//
// CA-01 Step A: J2 (c9c37c37) BUY 5 KAS BSC @ 0.045 USDT/KAS — escrow + real prepay
// per NWT 14:09/14:12 ack + Owner 13:48 全自动.

const BROKER_RELAY = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const J2_KASIA = 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3';

async function dm(message) {
  // R34 P1 race anti-spam: 5s 内同 peer 同 message dedup. 加 unique salt 防 skip.
  // State machine L82 head extracts leading token, accepts trailing suffix.
  const salt = `#ca01-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: BROKER_RELAY, peer: J2_KASIA, message: `${message} ${salt}` }),
  });
  const j = await r.json();
  return j.reply || '';
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('--- CA-01 Step A: J2 BUY 5 KAS BSC @ 0.045 ---\n');

  console.log('1. reset menu (back)');
  console.log('   reply:', (await dm('back')).slice(0, 100), '...\n');
  await sleep(500);

  console.log('2. select BUY (1)');
  console.log('   reply:', (await dm('1')).slice(0, 100), '...\n');
  await sleep(500);

  console.log('3. select BSC chain (1)');
  console.log('   reply:', (await dm('1')).slice(0, 100), '...\n');
  await sleep(500);

  console.log('4. qty 5 KAS');
  console.log('   reply:', (await dm('5')).slice(0, 200), '...\n');
  await sleep(500);

  console.log('5. price 0.045 USDT/KAS');
  console.log('   reply:', (await dm('0.045')).slice(0, 300), '...\n');
  await sleep(500);

  console.log('6. confirm YES → triggerQuote');
  const final = await dm('YES');
  console.log('   reply:', final, '\n');

  console.log('--- post-quote: parse broker quote amount + addr ---');
  // Final reply should contain quote amount + broker BSC addr.
  // Parse for prepay instructions.
  const amtMatch = final.match(/([\d.]+)\s*USDT/i);
  const addrMatch = final.match(/0x[a-fA-F0-9]{40}/);
  console.log('quote amount detected:', amtMatch?.[1]);
  console.log('broker addr detected:', addrMatch?.[0]);
}

main().catch(e => { console.error('err:', e.message); process.exit(1); });
