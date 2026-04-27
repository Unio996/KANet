// Verify: Trader-A relay handling DM from Trader-B address → should skip handler
const TRADER_A_ID = 'df8cd0f9-27e7-45c6-bbea-2fa11a1ff1cd';
const TRADER_B_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const NORMAL_USER = 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm';  // NWT

console.log('Test 1: Trader-A receives DM from Trader-B (sibling) → should skip');
const r1 = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    relayNodeId: TRADER_A_ID,
    peer: TRADER_B_ADDR,
    message: '我要买 50 KAS, BSC',
  }),
});
console.log('  result:', JSON.stringify(await r1.json()));

console.log('\nTest 2: Trader-A receives DM from normal user (NWT) → should reply');
const r2 = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    relayNodeId: TRADER_A_ID,
    peer: NORMAL_USER,
    message: '想买 5 KAS',
  }),
});
const d2 = await r2.json();
console.log('  reply:', (d2.reply || '').slice(0, 100));
console.log('  skip_reason:', d2.skip_reason || '-');
