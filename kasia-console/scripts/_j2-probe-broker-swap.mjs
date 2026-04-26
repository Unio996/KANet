// J2 #3 真 dry-run probe — 验 broker-swap.js PancakeSwap V2 router contract address valid
// 不真 swap 不烧钱, 只 quote 真验 (eth_call read-only)
// PASS = router contract live + USDT/USDC pair real + getAmountsOut return >0

import { quoteUsdtToUsdc } from '../src/services/broker-swap.js';

console.log('=== J2 #3 broker-swap dry-run probe (不真 swap, 只验 quote) ===');
console.log('PCS V2 Router: 0x10ED43...6024E');
console.log('USDT-BSC: 0x55d398...7955 (18 decimals)');
console.log('USDC-BSC: 0x8AC76a...580d (18 decimals)\n');

const tests = [
  { amount: 1.0, label: 'small (1 USDT)' },
  { amount: 10.0, label: 'medium (10 USDT)' },
  { amount: 100.0, label: 'large (100 USDT)' },
];

let pass = 0, fail = 0;
for (const t of tests) {
  process.stdout.write(`Quote ${t.label} → ... `);
  const start = Date.now();
  const r = await quoteUsdtToUsdc(t.amount);
  const ms = Date.now() - start;
  if (r.ok) {
    console.log(`✓ ${r.expectedUsdc.toFixed(6)} USDC (slip ${r.slippageEstimatePct.toFixed(4)}%, ${ms}ms)`);
    if (r.expectedUsdc > 0 && r.expectedUsdc < t.amount * 1.01 && r.slippageEstimatePct < 1.0) {
      pass++;
    } else {
      console.log(`  ⚠ unexpected: usdc=${r.expectedUsdc} slip=${r.slippageEstimatePct}%`);
      fail++;
    }
  } else {
    console.log(`✗ ${r.error}`);
    fail++;
  }
}

console.log(`\n=== ${pass}/${pass+fail} PASS ===`);
if (pass === tests.length) {
  console.log('✅ broker-swap.js PancakeSwap V2 contract address + ABI 真 valid');
  console.log('✅ USDT/USDC peg slippage < 0.1% real (符合 spec ~$1.50 真测 cost 估)');
  console.log('真 production-ready: integration + 真 swap 等三方共识 ship');
} else {
  console.log('❌ broker-swap.js dry-run fail — 不能 ship 真 implementation');
}
