// Probe Qwen tool calling post J2 v1.2 SYSTEM_PROMPT trim (a660061c3)
// Target: complete-fields multi-turn that should trigger preview_order tool
const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const FRESH = 'kaspa:qprobtrim' + Math.random().toString(36).slice(2, 50);

console.log('=== Tool calling probe post v1.2 trim ===');
console.log('peer:', FRESH.slice(-12));

console.log('\n[Turn 1] "想买 5 KAS"');
let t = Date.now();
let r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH, message: '想买 5 KAS' }),
});
let d = await r.json();
console.log(`  ${Date.now()-t}ms reply:`, (d.reply || '<empty>').slice(0, 150));

await new Promise(r => setTimeout(r, 1500));
console.log('\n[Turn 2] "BSC" (chain provided, fields complete for KAS BUY)');
t = Date.now();
r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH, message: 'BSC' }),
});
d = await r.json();
console.log(`  ${Date.now()-t}ms reply:`, (d.reply || '<empty>').slice(0, 300));
console.log(`  >>> Look for "📋 订单画像" (tool called preview_order) vs LLM NLG`);
