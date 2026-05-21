#!/usr/bin/env node
// DEPRECATED 5/21 (Owner ack option 3, KI 63 整合 Group B):
// HTTP-mock /api/agent/reply pattern. 真链等价 framework cases:
//   - NWT N19.162 自接 sell_cancel_full_dm_e2e.test.mjs mirror (SELL real-chain Tier 4)
// "BUY-then-SELL same-user 跨 direction" scenario 排日 backlog (docs/BACKLOG.md KI-63-backlog-1).
// DO NOT execute — kept for historical reference.
//
// CA-01 Step B: J2 SELL 5 KAS BSC@0.030 — escrow + real KAS prepay
const BROKER_RELAY = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const J2_KASIA = 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3';
const J2_BSC = '0x00c41dC0D0d7F4232EFB6ec545F7ad9e031eb62f';

async function dm(message) {
  const salt = `#ca01-b-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
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
  console.log('--- CA-01 Step B: J2 SELL 5 KAS BSC@0.030 ---\n');

  // J2 still in WAIT_PREPAY for Step A escrow. 'back' → cancel/clear current flow → menu.
  console.log('1. back to menu');
  console.log('   reply:', (await dm('back')).slice(0, 100), '...\n');
  await sleep(500);

  console.log('2. SELL (2)');
  console.log('   reply:', (await dm('2')).slice(0, 100), '...\n');
  await sleep(500);

  console.log('3. BSC chain (1)');
  console.log('   reply:', (await dm('1')).slice(0, 100), '...\n');
  await sleep(500);

  console.log('4. qty 5 KAS');
  console.log('   reply:', (await dm('5')).slice(0, 200), '...\n');
  await sleep(500);

  console.log('5. J2 BSC addr (USDT recv)');
  console.log('   reply:', (await dm(J2_BSC)).slice(0, 200), '...\n');
  await sleep(500);

  console.log('6. price 0.030 USDT/KAS');
  console.log('   reply:', (await dm('0.030')).slice(0, 300), '...\n');
  await sleep(500);

  console.log('7. confirm YES → triggerQuote');
  const final = await dm('YES');
  console.log('   reply:', final, '\n');
}

main().catch(e => { console.error('err:', e.message); process.exit(1); });
