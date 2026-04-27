// J2 #3 真测 Bug 6 真 fix verify — 真 call _aggregateWithFallback(USDC) 真 publish USDC offer
// 不调 _enqueueAccept (不卡 broker), 真 query exchange_offers verify give_asset='USDC'
// cleanup: cancel offer 真 release fund-lock (broker_dynamic_quote 不锁 KAS, 但保险)

import Db from 'better-sqlite3';
import { _aggregateWithFallback } from '../src/services/broker-buy-handler.js';

const db = new Db('data/console.db', { readonly: false });

console.log('=== J2 #3 真测 Bug 6 真 fix — finalizeBuy(USDC) 真 publish 真 verify ===\n');

console.log('真调 _aggregateWithFallback(qty=0.5, payChain=bnb, give_asset=USDC)...');
const start = Date.now();
const result = await _aggregateWithFallback(0.5, 'bnb', 'USDC');
const ms = Date.now() - start;
console.log(`result (${ms}ms):`, JSON.stringify(result));

if (!result.ok || !result.picks?.length) {
  console.error('❌ _aggregateWithFallback fail');
  process.exit(1);
}

const offerId = result.picks[0].id;
console.log(`\n>>> 真 query exchange_offers WHERE id=${offerId.slice(0,8)} <<<`);
const offer = db.prepare('SELECT id, maker, give_asset, give_amount, give_chain, want_asset, want_amount, protocol_status, broadcast_at FROM exchange_offers WHERE id=?').get(offerId);
console.log(JSON.stringify(offer, null, 2));

if (offer?.give_asset === 'USDC') {
  console.log('\n✅ Bug 6 真 fix 真生效 — broker 真 publish offer give_asset=USDC');
  console.log(`   give: ${offer.give_amount} ${offer.give_asset} (chain ${offer.give_chain})`);
  console.log(`   want: ${offer.want_amount} ${offer.want_asset}`);
} else {
  console.log(`\n❌ Bug 6 真未修 — give_asset=${offer?.give_asset} (期望 'USDC')`);
}

// Cleanup: cancel offer (broker maker, 真 release if any lock)
console.log('\n--- cleanup: cancel test offer (真 release) ---');
db.prepare(`UPDATE exchange_offers SET protocol_status='cancelled', updated_at=? WHERE id=?`).run(new Date().toISOString(), offerId);
console.log(`✓ offer ${offerId.slice(0,8)} cancelled (test cleanup)`);

db.close();
