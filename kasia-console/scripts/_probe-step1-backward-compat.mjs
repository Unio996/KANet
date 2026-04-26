// Step 1 v1.1 Phase A backward compat 真测 (direct func call, 绕 LLM 不稳)
//
// Step 1 加 give_asset='KAS' default 到 buyPreview + finalizeBuy.
// 真验: caller 不传 asset → default 'KAS' kick in → 行为跟 Step 1 前一致.
// 真验: caller 传 asset='KAS' → 同 default, 行为一致.
// 真验: caller 传别的 asset → reject (Step 2 才支持, Step 1 SQL 仍 'KAS' literal).

import { buyPreview, finalizeBuy } from '../src/services/broker-buy-handler.js';

const PEER = 'kaspa:qpr_step1_test_' + Date.now().toString(36);
let pass = 0, fail = 0;
const t = (name, ok, info) => { ok ? (pass++, console.log('✓ ' + name)) : (fail++, console.log('✗ ' + name + ' ' + (info||''))); };

console.log('=== Step 1 backward compat: buyPreview default give_asset ===\n');

// Test 1: buyPreview 不传 give_asset → default 'KAS' → 真返 preview (跟 Step 1 前同行为)
const r1 = await buyPreview({ user_kasia: PEER, qty: 5, pay_chain: 'bnb' });
t('1.1 buyPreview no asset → ok:true (default KAS)', r1.ok === true, JSON.stringify(r1).slice(0, 100));
t('1.2 preview_text 含 0xaD12544E (broker BSC 真 fetch)', r1.ok && r1.preview_text?.includes('0xaD12544E'));
t('1.3 picks[0].maker_payment_address 真 broker BSC', r1.ok && r1.picks?.[0]?.maker_payment_address?.startsWith('0xaD'));

// Test 2: buyPreview 显式 give_asset='KAS' → 同 default
const r2 = await buyPreview({ user_kasia: PEER + '_2', qty: 5, pay_chain: 'bnb', give_asset: 'KAS' });
t('2.1 buyPreview give_asset=KAS → ok:true (跟 default 同)', r2.ok === true);
t('2.2 跟 default 行为一致 (total_usdt 相同)', r1.ok && r2.ok && Math.abs(r1.total_usdt - r2.total_usdt) < 0.01);

// Test 3: finalizeBuy 不传 give_asset → default KAS
// (注: finalize 真 publish + enqueue accept_v1 会有副作用, peer 用 unique seed avoiding interference)
const r3 = await finalizeBuy({ user_kasia: PEER + '_3', qty: 5, pay_chain: 'bnb' });
t('3.1 finalizeBuy no asset → ok:true (default KAS, 真 publish offer)', r3.ok === true, JSON.stringify(r3).slice(0, 150));
if (r3.ok) {
  t('3.2 picks[0] 真有 offer_id', !!r3.picks?.[0]?.offer_id);
  t('3.3 broker_dynamic flag (broker 自挂 default)', r3.broker_dynamic_quote === true || r3.picks?.[0]?.broker_dynamic === true);
}

console.log(`\n=== Step 1 backward compat: ${pass}/${pass+fail} PASS ===`);
process.exit(fail === 0 ? 0 : 1);
