// J2 retest 5/6 在 d2065558 (含 T-J1-19a dust gate)
// 不调 _enqueueAccept (因为应该早 return ok=false), 但 import finalizeBuy 直接 call
import { finalizeBuy } from '../src/services/broker-buy-handler.js';

const cases = [
  { tag: '5a 0.05 KAS', qty: 0.05, expect: 'reject (dust)' },
  { tag: '5b 0.99 KAS', qty: 0.99, expect: 'reject (< 1)' },
  { tag: '5c 1.0 KAS (boundary OK)', qty: 1.0, expect: 'accept' },
  { tag: '6  10000 KAS', qty: 10000, expect: 'reject (limit 5000)' },
];

const userKasia = 'kaspa:qpregression_test_user_j2_5_6';
for (const c of cases) {
  try {
    const r = await finalizeBuy({ user_kasia: userKasia, qty: c.qty, pay_chain: 'bnb' });
    const ok = r.ok ? '✓ ACCEPT' : '✗ REJECT';
    console.log(`[${c.tag}] expect=${c.expect}  got=${ok}  reason=${r.error || r.offer_id?.slice(0,8)}`);
  } catch (e) {
    console.log(`[${c.tag}] EXC: ${e.message}`);
  }
}
process.exit(0);
