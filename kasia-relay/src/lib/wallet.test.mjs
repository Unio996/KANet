// r281 (Bettor 5/30) wallet.mjs fromPrivateKey mutation tests (J2 r93 reviewer 要求).
// 不依赖测试框架; 直接 node 执行: `node src/lib/wallet.test.mjs`.
// 0 exit = 全过, 非 0 = 至少 1 case 错.

import { KaspaWallet } from './wallet.mjs';

let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}` + (detail ? ` — ${detail}` : ''));
    failed++;
  }
}

function expectThrow(name, fn, expectedMsgFragment) {
  try {
    fn();
    assert(name, false, 'expected throw, none thrown');
  } catch (e) {
    if (!expectedMsgFragment || e.message.includes(expectedMsgFragment)) {
      assert(name, true);
    } else {
      assert(name, false, `wrong msg: "${e.message}" (want fragment: "${expectedMsgFragment}")`);
    }
  }
}

console.log('[wallet.test] r281 KaspaWallet.fromPrivateKey mutation tests');

// 1. Valid privkey (tg-tester-1 testnet, known address kaspatest:qrymjvc...) — 正路径.
{
  const sk = '26482a23979c2e2cf576f4bbc949641b57a6a937ad8b7c9e183cfd840a25cde3';
  const w = KaspaWallet.fromPrivateKey(sk, 'testnet-12');
  const addr = w.getAddress();
  assert('valid 64hex → KaspaWallet', !!w);
  assert('derives kaspatest: address', addr.startsWith('kaspatest:'), `got: ${addr.slice(0,20)}...`);
  assert('address matches qrymjvc known', addr === 'kaspatest:qrymjvcyruv2jprcnppj6jnzwmr6xgmyyh95fury869l9gu7nw96qxg2fjryt');
}

// 2. Mutations — invalid inputs must throw with clear message.
expectThrow('empty string', () => KaspaWallet.fromPrivateKey('', 'testnet-12'), 'required');
expectThrow('null', () => KaspaWallet.fromPrivateKey(null, 'testnet-12'), 'required');
expectThrow('undefined', () => KaspaWallet.fromPrivateKey(undefined, 'testnet-12'), 'required');
expectThrow('not a string (number)', () => KaspaWallet.fromPrivateKey(12345, 'testnet-12'), 'required');
expectThrow('too short (63 hex)', () => KaspaWallet.fromPrivateKey('a'.repeat(63), 'testnet-12'), '64 hex');
expectThrow('too long (65 hex)', () => KaspaWallet.fromPrivateKey('a'.repeat(65), 'testnet-12'), '64 hex');
expectThrow('non-hex char', () => KaspaWallet.fromPrivateKey('z'.repeat(64), 'testnet-12'), '64 hex');
expectThrow('mixed case ok but bad len', () => KaspaWallet.fromPrivateKey('AbCd', 'testnet-12'), '64 hex');

// 3. 0x prefix tolerated.
{
  const sk = '0x26482a23979c2e2cf576f4bbc949641b57a6a937ad8b7c9e183cfd840a25cde3';
  const w = KaspaWallet.fromPrivateKey(sk, 'testnet-12');
  assert('0x prefix stripped', w.getAddress().startsWith('kaspatest:'));
}

// 4. Network mismatch — same privkey, mainnet vs testnet, addresses differ.
{
  const sk = '26482a23979c2e2cf576f4bbc949641b57a6a937ad8b7c9e183cfd840a25cde3';
  const mainAddr = KaspaWallet.fromPrivateKey(sk, 'mainnet').getAddress();
  const testAddr = KaspaWallet.fromPrivateKey(sk, 'testnet-12').getAddress();
  assert('mainnet prefix', mainAddr.startsWith('kaspa:'));
  assert('testnet prefix', testAddr.startsWith('kaspatest:'));
  assert('different addresses across networks', mainAddr !== testAddr);
}

console.log(failed === 0 ? '[wallet.test] ALL PASS' : `[wallet.test] ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
