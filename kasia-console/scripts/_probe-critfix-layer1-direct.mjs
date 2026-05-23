// NWT 接位 #2 — Layer 1 functional verify (直接调 buyPreview, 不走 LLM, 不走 history)
// 验: preview_text 真包含 真 maker_addr + 真 user_kasia, 无 fake placeholder.

import { buyPreview } from '../src/services/broker-buy-handler.js';

const TEST_USER_KASIA = 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqnwttest1234';

console.log('=== Layer 1 Critfix: buyPreview() 直接调 ===\n');

const r = await buyPreview({ user_kasia: TEST_USER_KASIA, qty: 5, pay_chain: 'bnb' });

console.log('ok:', r.ok);
if (!r.ok) {
  console.log('error:', r.error);
  process.exit(1);
}

console.log('direction:', r.direction);
console.log('qty:', r.qty);
console.log('total_usdt:', r.total_usdt);
console.log('n_payments:', r.n_payments);
console.log('picks:', JSON.stringify(r.picks, null, 2));
console.log('\npreview_text:');
console.log('---');
console.log(r.preview_text);
console.log('---\n');

// === Critfix assertions ===
const REAL_BROKER_BSC_PATTERN = /0x[aA][dD]12544[eE]/;
const FAKE_PLACEHOLDER = '0x1234567890';
const PREVIEW_ANCHOR = '📋';

const c1 = REAL_BROKER_BSC_PATTERN.test(r.preview_text);
const c2 = !r.preview_text.includes(FAKE_PLACEHOLDER);
const c3 = r.preview_text.includes(TEST_USER_KASIA);
const c4 = r.preview_text.includes(PREVIEW_ANCHOR);
const c5 = r.picks.some(p => /0x[aA][dD]12544[eE]/.test(p.maker_payment_address));

console.log('=== Critfix 验证 ===');
console.log(`[${c1 ? '✓' : '✗'}] preview_text 含真 broker BSC 0xaD12544E... (DB fetched)`);
console.log(`[${c2 ? '✓' : '✗'}] preview_text NOT contains fake 0x1234567890`);
console.log(`[${c3 ? '✓' : '✗'}] preview_text 含真 user_kasia (caller args)`);
console.log(`[${c4 ? '✓' : '✗'}] preview_text 含 📋 anchor`);
console.log(`[${c5 ? '✓' : '✗'}] picks[].maker_payment_address 含真 0xaD12544E...`);

const allPass = c1 && c2 && c3 && c4 && c5;
console.log(`\n=== ${allPass ? '🎉 LAYER 1 CRITFIX 真生效' : '🚨 LAYER 1 critfix 未生效'} ===`);
process.exit(allPass ? 0 : 1);
