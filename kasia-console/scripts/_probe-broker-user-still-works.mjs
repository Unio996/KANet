// Verify normal user DM to broker still works post fix (fix only blocks sibling broker)
const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const NWT = 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm';

console.log('Test: NWT (non-broker peer) → Trader-B with normal SELL');
const r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: NWT, message: '我要卖 5 KAS' }),
});
const d = await r.json();
console.log(' reply:', (d.reply || '').slice(0, 150));
console.log(' skip_reason:', d.skip_reason || '-');
