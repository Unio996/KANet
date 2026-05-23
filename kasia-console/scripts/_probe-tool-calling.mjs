// Test if broker LLM calls preview_order tool with fresh peer + complete fields
const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
// Use a completely fresh peer address (no prior history)
const FRESH_PEER = 'kaspa:qfresh' + Math.random().toString(36).slice(2, 50);

console.log('Test 1 (fresh peer, complete fields one-shot):');
const t1 = Date.now();
const r1 = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    relayNodeId: TRADER_B_ID,
    peer: FRESH_PEER,
    message: '想买 5 KAS BSC USDT 0x1234567890abcdef1234567890abcdef12345678',
  }),
});
const d1 = await r1.json();
console.log(`  ${Date.now()-t1}ms reply:`, (d1.reply || '').slice(0, 200));

console.log('\nTest 2 (different fresh peer, two-turn — turn 2 should preview):');
const FRESH2 = 'kaspa:qother' + Math.random().toString(36).slice(2, 50);
const t2a = Date.now();
const r2a = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH2, message: '想买 5 KAS' }),
});
const d2a = await r2a.json();
console.log(`  turn 1 (${Date.now()-t2a}ms):`, (d2a.reply || '').slice(0, 150));
const t2b = Date.now();
const r2b = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH2, message: 'BSC, USDT, 0x1234567890abcdef1234567890abcdef12345678' }),
});
const d2b = await r2b.json();
console.log(`  turn 2 (${Date.now()-t2b}ms):`, (d2b.reply || '').slice(0, 200));
