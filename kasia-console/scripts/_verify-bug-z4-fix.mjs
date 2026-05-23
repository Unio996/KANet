import { _detectIntent } from '../src/services/broker-llm-agent.js';
const cases = [
  ['我要卖 99 KAS, BSC, 0x1417cf...', 'sell'],
  ['我要买 50 KAS', 'buy'],
  ['我要 5 KAS', 'buy'],
  ['我要换 50 KAS USDT', 'buy'],
  ['我想卖 30 KAS', 'sell'],
  ['想卖 30 KAS', 'sell'],
  ['卖 30 KAS', 'sell'],
  ['I want to sell 50 KAS', 'sell'],
  ['sell 50 KAS', 'sell'],
  ['buy 50 KAS', 'buy'],
  ['I want 50 KAS', 'buy'],
  ['想买 50 USDC', 'buy'],
  ['卖 30 USDC', 'sell'],
  ['吃饭', null],
  ['我要卖 99 个 kas, BSC, 0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D', 'sell'],
];
let pass = 0, fail = 0;
for (const [msg, expected] of cases) {
  const got = _detectIntent(msg);
  const ok = got === expected;
  console.log(`  ${ok ? '✓' : '✗'} _detectIntent('${msg.slice(0,40)}') = ${got} (want ${expected})`);
  if (ok) pass++; else fail++;
}
console.log(`\n${pass}/${pass+fail} PASS`);
process.exit(fail ? 1 : 0);
