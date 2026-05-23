// T-J2-24 R5 smoke: waitForRelay hold pump.
// 验证 queue pump 在 relay up 之前 hold, up 之后 consume.
// 不动真 console (broker-action-queue 已加载在 console process), 这里只验 relay-manager.waitForRelay 直接 API.
import { waitForRelay } from '../src/services/relay-manager.js';

const BROKER_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';

console.log('=== T-J2-24 R5 smoke (waitForRelay) ===\n');

console.log('Test 1: waitForRelay on running relay (should resolve immediately)');
const t1 = Date.now();
try {
  // 这里直接调 console process 的 relay-manager 不会工作 (我跑的是 separate node), 要在 console 内.
  // 改成 timing 测试 — direct standalone process 没 _relays state, waitForRelay 应当 60s 后 throw.
  await waitForRelay(BROKER_ID, 3000);
  console.log(`  ✓ resolved in ${Date.now() - t1}ms (running relay scenario)`);
} catch (e) {
  console.log(`  ⚠ throws ${Date.now() - t1}ms: ${e.message} (expected in standalone process — _relays 是 console-internal state)`);
}

console.log('\nTest 2: waitForRelay timeout');
const t2 = Date.now();
try {
  await waitForRelay('not-existing-relay-id', 1500);
  console.log(`  ✗ unexpected resolve in ${Date.now() - t2}ms`);
} catch (e) {
  console.log(`  ✓ throws after ${Date.now() - t2}ms: "${e.message}"`);
}

console.log('\n=== smoke done ===');
console.log('Note: standalone Node process 看不到 console internal _relays state. 真验证靠 console restart 时 broker-action-queue 行为, 由 NWT 验. 本 smoke 仅证 waitForRelay 函数本体逻辑 + timeout 工作.');
