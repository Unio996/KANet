// NWT — repeat Owner 09:34 真原 case 5 times 真验 LLM determinism
const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const NWT_USER = 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm';
const msg = '我要卖 99 个 kas, BSC, 0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D';

console.log('Repeat Owner 09:34 真原 case 5 times:');
for (let i = 1; i <= 5; i++) {
  const t0 = Date.now();
  const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: NWT_USER, message: msg }),
  });
  const data = await res.json();
  const reply = data.reply || data.error || '';
  const buyMisclass = /buy|买/.test(reply.toLowerCase()) && !/卖|sell/.test(reply.toLowerCase());
  console.log(`  [${i}] ${Date.now()-t0}ms ${buyMisclass ? '❌ BUY' : '✓ SELL'}: ${reply.slice(0, 200)}`);
  await new Promise(r => setTimeout(r, 1500));
}
