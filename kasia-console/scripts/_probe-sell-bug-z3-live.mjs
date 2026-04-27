// NWT — SELL Bug-Z3 真 verify 真 live console (post af2376c44 R19-EXT userContext fix)
// 真 simulate Owner 09:34 真 case: "我要卖 99 KAS, BSC, 0x1417cf...596D"
// 真 expect: broker 真 reply 真 echo user EVM addr 真 OK (R19-EXT 真不 trigger)
// 真 broker = Trader-B (NWT machine, df8cd0f9 / 0a8e9723)

const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const NWT_USER_ADDR = 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm';  // simulate as user
const OWNER_EVM = '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D';

const cases = [
  {
    name: 'Bug-Z3 真原 case',
    message: `我要卖 99 个 kas, BSC, ${OWNER_EVM}`,
  },
  {
    name: 'SELL no chain — broker should ask BSC',
    message: '我想卖 50 KAS',
  },
  {
    name: 'SELL with addr only',
    message: `卖 30 KAS 收款 ${OWNER_EVM}`,
  },
];

console.log('='.repeat(80));
console.log('NWT SELL Bug-Z3 verify (Trader-B, post af2376c44)');
console.log(`  user addr: ${OWNER_EVM}`);
console.log('='.repeat(80));

for (const c of cases) {
  console.log(`\n[${c.name}]`);
  console.log(`  user → broker: ${c.message}`);
  const t0 = Date.now();
  const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      relayNodeId: TRADER_B_ID,
      peer: NWT_USER_ADDR,
      message: c.message,
    }),
  });
  const data = await res.json();
  const ms = Date.now() - t0;
  const replyText = data.reply || data.error || JSON.stringify(data).slice(0, 300);
  console.log(`  broker reply (${ms}ms):`);
  console.log(`    ${replyText.slice(0, 500)}`);
  // verify R19-EXT 真不 trigger (reject text 真不 含 "R19" 真 vague reject)
  const r19Triggered = /R19|内部.*拦截|地址异常/i.test(replyText);
  if (r19Triggered) {
    console.log(`  ❌ FAIL — R19-EXT 真 false positive 真 still trigger`);
  } else {
    // verify user addr 真 in reply (broker echo OK 真 expected)
    const echoesUserAddr = replyText.toLowerCase().includes(OWNER_EVM.toLowerCase());
    const truncatedEcho = replyText.includes(OWNER_EVM.slice(0, 6)) || replyText.includes(OWNER_EVM.slice(-4));
    console.log(`  ✓ R19-EXT 真不 trigger`);
    console.log(`    echoes user addr full: ${echoesUserAddr}, truncated: ${truncatedEcho}`);
  }
  // wait between cases
  await new Promise(r => setTimeout(r, 2000));
}

console.log('\n' + '='.repeat(80));
console.log('NWT SELL Bug-Z3 verify done');
