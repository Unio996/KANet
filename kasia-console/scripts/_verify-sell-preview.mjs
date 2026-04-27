import { sellPreview } from '../src/services/broker-sell-handler.js';

console.log('=== sellPreview() module-level verify ===');

// Test 1: happy path
const r1 = await sellPreview({
  user_kasia: 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp',
  qty: 5,
  recv_chain: 'bnb',
  recv_address: '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74',
});
console.log('\n[Test 1: happy path]');
console.log('ok:', r1.ok);
if (r1.ok) {
  console.log(r1.preview_text);
  console.log('---4-section check---');
  const checks = {
    trustcard: /🏷|broker|Kasia 注册|累计完成/.test(r1.preview_text),
    price_cmp: /CEX 8 源中价|spread/.test(r1.preview_text),
    safety:    /🛡|安全说明|broker fee 0.1 KAS/.test(r1.preview_text),
    history:   /📊|broker 最近成交|Kaspa explorer/.test(r1.preview_text),
  };
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? '✓' : '✗'} ${k}`);
} else {
  console.log('error:', r1.error, r1.message);
}

// Test 2: dust reject
console.log('\n[Test 2: dust reject]');
const r2 = await sellPreview({
  user_kasia: 'kaspa:test', qty: 0.05, recv_chain: 'bnb', recv_address: '0x' + 'a'.repeat(40)
});
console.log(`  ok=${r2.ok} error=${r2.error} message="${r2.message}"`);

// Test 3: bad EVM addr
console.log('\n[Test 3: invalid EVM addr]');
const r3 = await sellPreview({
  user_kasia: 'kaspa:test', qty: 5, recv_chain: 'bnb', recv_address: '0xdeadbeef'
});
console.log(`  ok=${r3.ok} error=${r3.error} message="${r3.message}"`);

// Test 4: missing fields
console.log('\n[Test 4: missing recv_address]');
const r4 = await sellPreview({ user_kasia: 'kaspa:test', qty: 5, recv_chain: 'bnb' });
console.log(`  ok=${r4.ok} error=${r4.error}`);
