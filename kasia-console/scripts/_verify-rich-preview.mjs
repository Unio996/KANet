// Verify enriched preview text shows 4 sections (trustcard, price compare, safety, history)
import { buyPreview } from '../src/services/broker-buy-handler.js';

const fakeUser = 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp';

console.log('=== Enriched preview text test ===');
const r = await buyPreview({ user_kasia: fakeUser, qty: 5, pay_chain: 'bnb', give_asset: 'KAS', receive_address: null });
if (!r.ok) {
  console.log('preview failed:', r);
  process.exit(1);
}
console.log(r.preview_text);
console.log('---');
const checks = {
  trustcard: /🏷|broker|Kasia 注册|累计完成/.test(r.preview_text),
  price_cmp: /CEX 8 源中价|spread/.test(r.preview_text),
  safety:    /🛡|安全说明|broker 不托管/.test(r.preview_text),
  history:   /📊|broker 最近成交|Kaspa explorer/.test(r.preview_text),
};
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? '✓' : '✗'} ${k}`);
