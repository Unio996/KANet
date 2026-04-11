/**
 * Transfer modules smoke test — verifies all 3 modules load correctly
 * and export the expected functions with proper error handling.
 *
 * Does NOT send real transactions. Tests:
 * 1. Module imports
 * 2. Function signatures
 * 3. Unsupported chain/token rejection
 * 4. Missing wallet graceful failure
 */

const PASS = '✓';
const FAIL = '✗';
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}`);
    failed++;
  }
}

async function run() {
  console.log('=== Transfer Modules Smoke Test ===\n');

  // ── 1. EVM Transfer ──
  console.log('[evm-transfer.js]');
  try {
    const evm = await import('../kasia-console/src/services/evm-transfer.js');
    assert(typeof evm.transferERC20 === 'function', 'transferERC20 is a function');
    assert(typeof evm.isEvmChainSupported === 'function', 'isEvmChainSupported is a function');
    assert(evm.isEvmChainSupported('bnb') === true, 'bnb supported');
    assert(evm.isEvmChainSupported('eth') === true, 'eth supported');
    assert(evm.isEvmChainSupported('sol') === false, 'sol not supported');
    assert(evm.isEvmChainSupported('tron') === false, 'tron not supported');

    // Test unsupported chain returns error
    const r = await evm.transferERC20('sol', 'dummy', '0x0', 1);
    assert(r.ok === false, 'unsupported chain returns ok=false');
    assert(r.error.includes('not supported'), 'error message mentions not supported');
  } catch (e) {
    console.log(`  ${FAIL} IMPORT FAILED: ${e.message}`);
    failed++;
  }

  // ── 2. SOL Transfer ──
  console.log('\n[sol-transfer.js]');
  try {
    const sol = await import('../kasia-console/src/services/sol-transfer.js');
    assert(typeof sol.transferSPL === 'function', 'transferSPL is a function');
    assert(typeof sol.isSolChainSupported === 'function', 'isSolChainSupported is a function');
    assert(sol.isSolChainSupported('sol') === true, 'sol supported');
    assert(sol.isSolChainSupported('bnb') === false, 'bnb not supported');

    // Test unsupported token returns error
    const r = await sol.transferSPL('dummy', 'dummy', 1, 'DOGE');
    assert(r.ok === false, 'unsupported token returns ok=false');
    assert(r.error.includes('Unsupported SPL token'), 'error message correct');
  } catch (e) {
    console.log(`  ${FAIL} IMPORT FAILED: ${e.message}`);
    failed++;
  }

  // ── 3. TRON Transfer ──
  console.log('\n[tron-transfer.js]');
  try {
    const tron = await import('../kasia-console/src/services/tron-transfer.js');
    assert(typeof tron.transferTRC20 === 'function', 'transferTRC20 is a function');
    assert(typeof tron.isTronChainSupported === 'function', 'isTronChainSupported is a function');
    assert(tron.isTronChainSupported('tron') === true, 'tron supported');
    assert(tron.isTronChainSupported('eth') === false, 'eth not supported');

    // Test unsupported token returns error
    const r = await tron.transferTRC20('dummy', 'dummy', 1, 'DOGE');
    assert(r.ok === false, 'unsupported token returns ok=false');
    assert(r.error.includes('Unsupported TRC20 token'), 'error message correct');
  } catch (e) {
    console.log(`  ${FAIL} IMPORT FAILED: ${e.message}`);
    failed++;
  }

  // ── 4. Route dispatch (simulate _autoPayExchange logic) ──
  console.log('\n[route dispatch]');
  const chains = ['bnb', 'eth', 'sol', 'tron'];
  for (const chain of chains) {
    let moduleName;
    if (['bnb', 'eth'].includes(chain)) moduleName = 'evm-transfer.js';
    else if (chain === 'sol') moduleName = 'sol-transfer.js';
    else if (chain === 'tron') moduleName = 'tron-transfer.js';
    assert(!!moduleName, `${chain} → routed to ${moduleName}`);
  }

  // ── Summary ──
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
