// smoke-chain-balance.mjs — 9-chain balance smoke test
import { getTokenBalance } from '../kasia-console/src/services/chain-balance.js';

// Known addresses for testing (Opus audit: all real known holders)
const TEST_ADDRESSES = {
  // BSC: Binance hot wallet (known USDT holder)
  bnb: { address: '0xF977814e90dA44bFA03b6295A0616a897441aceC', desc: 'Binance BSC hot wallet' },
  // ETH: Binance ETH 2 hot wallet (llamarpc can query)
  eth: { address: '0x28C6c06298d514Db089934071355E5743bf21d60', desc: 'Binance ETH 2 (llamarpc queryable)' },
  // Polygon: Binance hot wallet
  polygon: { address: '0xF977814e90dA44bFA03b6295A0616a897441aceC', desc: 'Binance Polygon hot wallet' },
  // Arbitrum: USDT contract itself
  arbitrum: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', desc: 'ARB USDT contract' },
  // Optimism: USDT contract itself
  optimism: { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', desc: 'OP USDT contract' },
  // Avalanche: USDT contract itself
  avalanche: { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', desc: 'AVAX USDT contract' },
  // Base: no USDT, expect error (known)
  base: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', desc: 'Base USDC contract' },
  // Solana: Binance hot wallet (known SPL holder)
  sol: { address: 'CoREENxT6tfrYE6dNBymwnu5Dy4PfgGn4dXs2Ct9tBJX', desc: 'Binance Solana hot wallet' },
  // TRON: known USDT holder (Binance TRON hot wallet)
  tron: { address: 'T9yDTE4s1ZBVwMP3bA9W7Sj1yZ6iyFtZ1x', desc: 'TRON test addr' },
};

async function testChain(chain, { address, desc }) {
  const result = await getTokenBalance(chain, address);
  // Base has no USDT contract — expected error, count as pass
  const isExpectedBase = chain === 'base' && result.error === 'no_usdt_on_base';
  // Bug #2 fix: strict pass — balance must be a number AND no error
  const pass = result.balance !== undefined && typeof result.balance === 'number' && !result.error || isExpectedBase;
  console.log(`${pass ? '✅' : '❌'} ${chain.padEnd(12)} ${desc.padEnd(35)} balance=${result.balance ?? '?'} error=${result.error || 'none'}`);
  return { chain, pass, ...result };
}

async function testInvalid(chain) {
  const result = await getTokenBalance(chain, '0x000');
  const pass = result.error === 'unsupported_chain';
  console.log(`${pass ? '✅' : '❌'} ${chain.padEnd(12)} unsupported_chain error: ${result.error === 'unsupported_chain' ? 'PASS' : 'FAIL'}`);
  return { chain, pass, ...result };
}

async function main() {
  console.log('\n=== Smoke Test: chain-balance.js ===\n');

  const results = [];

  // 9-chain real queries
  for (const [chain, { address, desc }] of Object.entries(TEST_ADDRESSES)) {
    results.push(await testChain(chain, { address, desc }));
  }

  console.log('');

  // 3 invalid cases
  results.push(await testInvalid('bitcoin'));
  results.push(await testInvalid('cardano'));
  results.push(await testInvalid(''));

  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`\n=== ${passed}/${total} passed ===\n`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
