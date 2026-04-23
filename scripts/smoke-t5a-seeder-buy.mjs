// smoke-t5a-seeder-buy.mjs — TASK 5a: Seeder BUY + deposit watcher
// Run: node scripts/smoke-t5a-seeder-buy.mjs

const { readFileSync } = await import('fs');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  PASS: ${label}`); passed++; }
  else { console.log(`  FAIL: ${label}`); failed++; }
}

function assertEq(a, b, label) {
  assert(String(a) === String(b), `${label}: expected "${String(b)}", got "${String(a)}"`);
}

// ── Case 1: buy_disabled 已删除 ──

console.log('--- Case 1: buy_disabled 已删除 ---');
const seederSrc = readFileSync('C:/KANet/kasia-console/src/services/market-seeder.js', 'utf-8');
assert(!seederSrc.includes('buy_disabled_until'), 'buy_disabled_until 不存在');
assert(!seederSrc.includes('BUY side temporarily disabled'), 'BUY side temporarily disabled 不存在');

// ── Case 2: market-seeder.js 结构 ──

console.log('\n--- Case 2: market-seeder.js 结构 ---');
assert(seederSrc.includes('startSeederDepositWatcher'), 'export startSeederDepositWatcher');
assert(seederSrc.includes('stopSeederDepositWatcher'), 'export stopSeederDepositWatcher');
assert(seederSrc.includes('depositWatcherTick'), 'depositWatcherTick function');
assert(seederSrc.includes('awaiting_deposit'), 'awaiting_deposit state');
assert(seederSrc.includes('deposited'), 'deposited state');
assert(seederSrc.includes('getTokenBalance'), 'imports getTokenBalance');

// ── Case 3: retail-dex.js _triggerBuyPublication ──

console.log('\n--- Case 3: retail-dex.js _triggerBuyPublication ---');
const dexSrc = readFileSync('C:/KANet/kasia-console/src/services/retail-dex.js', 'utf-8');
assert(dexSrc.includes('async function _triggerBuyPublication'), '_triggerBuyPublication function exists');
assert(dexSrc.includes('retail_dex_buy_publications'), 'inserts into retail_dex_buy_publications');
assert(dexSrc.includes("awaiting_deposit"), 'state = awaiting_deposit');
assert(dexSrc.includes('seeder_bsc_addr_missing'), 'seeder_bsc_addr_missing error');
assert(dexSrc.includes('_triggerBuyPublication'), '_triggerBuyPublication called');

// ── Case 4: index.js 接入 startSeederDepositWatcher ──

console.log('\n--- Case 4: index.js 接入 ---');
const indexSrc = readFileSync('C:/KANet/kasia-console/src/index.js', 'utf-8');
assert(indexSrc.includes('startSeederDepositWatcher'), 'import startSeederDepositWatcher');
assert(indexSrc.includes('startSeederDepositWatcher()'), 'calls startSeederDepositWatcher()');

// ── Case 5: 禁入依赖检查 ──

console.log('\n--- Case 5: 禁入依赖检查 ---');
const noMind = !seederSrc.includes('agent-mind') && !seederSrc.includes('mind-manager');
assert(noMind, 'market-seeder.js 不依赖 agent-mind/mind-manager');
const noAdapter = !dexSrc.includes('adapter');
assert(noAdapter, 'retail-dex.js 不依赖 adapter');

// ── Summary ──

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
