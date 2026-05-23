// Owner 22:54 钦定 "不要假的 真刀实枪干 发现问题": 真测 generic asset switch (非 KAS).
// Step 3 NLG + Step 2 SQL parameterize 真 verify with non-KAS — 真发现 bug.

import { buyPreview } from '../src/services/broker-buy-handler.js';
import { getAsset, listAssets } from '../src/services/asset-registry.js';

const PEER = 'kaspa:qpr_generic_test_' + Date.now().toString(36);

console.log('=== J1 asset-registry 真 lookup ===');
console.log('listAssets():', listAssets());
console.log('getAsset(KAS):', JSON.stringify(getAsset('KAS')).slice(0, 200));
console.log('getAsset(USDT):', JSON.stringify(getAsset('USDT')).slice(0, 200));
console.log('getAsset(USDC):', JSON.stringify(getAsset('USDC')).slice(0, 200));
console.log('getAsset(BTC):', JSON.stringify(getAsset('BTC')).slice(0, 200));

console.log('\n=== Step 3 真 generic switch — buyPreview give_asset=USDC ===');

// Try USDC (J1 asset-registry 含 USDT_bnb / USDT_eth / KAS_kaspa, USDC 看是不是 supported)
const r1 = await buyPreview({ user_kasia: PEER, qty: 5, pay_chain: 'bnb', give_asset: 'USDC' });
console.log('buyPreview(give_asset=USDC, qty=5, bnb):');
console.log(JSON.stringify(r1, null, 1).slice(0, 600));

console.log('\n=== Step 3 真 generic switch — buyPreview give_asset=BTC ===');
const r2 = await buyPreview({ user_kasia: PEER + '_2', qty: 1, pay_chain: 'bnb', give_asset: 'BTC' });
console.log('buyPreview(give_asset=BTC, qty=1, bnb):');
console.log(JSON.stringify(r2, null, 1).slice(0, 600));

console.log('\n=== KAS default vs explicit 对比 (Step 1+2+3 backward compat 再 verify) ===');
const rKAS = await buyPreview({ user_kasia: PEER + '_3', qty: 5, pay_chain: 'bnb', give_asset: 'KAS' });
console.log('buyPreview(give_asset=KAS, qty=5, bnb):');
console.log(rKAS.preview_text?.slice(0, 400));
