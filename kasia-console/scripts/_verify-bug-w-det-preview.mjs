// Verify NWT Bug-W deterministic preview path
const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const FRESH_PEER_W = 'kaspa:qbugw' + Math.random().toString(36).slice(2, 50);

console.log('=== Bug-W det-preview verify ===');
console.log('peer:', FRESH_PEER_W.slice(-12));

// Turn 1: classic BUY request (deterministic NLG asks for chain)
console.log('\n[Turn 1] simulate user "想买 2 KAS"');
let t = Date.now();
let r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH_PEER_W, message: '想买 2 KAS' }),
});
let d = await r.json();
console.log(`  ${Date.now()-t}ms reply:`, (d.reply || '<empty>').slice(0, 200));

// Turn 2: provide chain (BSC) — this is where det-preview should trigger
await new Promise(r => setTimeout(r, 1500));
console.log('\n[Turn 2] simulate user "BSC" (chain alone)');
t = Date.now();
r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH_PEER_W, message: 'BSC' }),
});
d = await r.json();
console.log(`  ${Date.now()-t}ms reply:`, (d.reply || '<empty>').slice(0, 200));

// Turn 3: simulate Eric pattern - addr only after broker asked for chain+addr
const FRESH_PEER_W2 = 'kaspa:qbugw2' + Math.random().toString(36).slice(2, 50);
console.log('\n--- Sub-test: Eric exact pattern ---');
console.log('[T1] "想买 2 KAS, BSC"');
t = Date.now();
r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH_PEER_W2, message: '想买 2 KAS, BSC' }),
});
d = await r.json();
console.log(`  ${Date.now()-t}ms reply:`, (d.reply || '<empty>').slice(0, 250));

await new Promise(r => setTimeout(r, 1500));
console.log('\n[T2] "USDT, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74"');
t = Date.now();
r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH_PEER_W2, message: 'USDT, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74' }),
});
d = await r.json();
console.log(`  ${Date.now()-t}ms reply:`, (d.reply || '<empty>').slice(0, 400));
console.log(`  >>> Should contain "📋 订单画像" if det-preview triggered correctly`);
