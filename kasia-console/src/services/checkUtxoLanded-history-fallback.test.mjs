// checkUtxoLanded-history-fallback.test.mjs — regression guard for the C1 anti-swap false-negative
// (Bettor+NWT+J2 2026-07-08 22:2x, uqmp8 first real batch-A cron run): checkUtxoLanded must fall back
// to kaspa_tx_log (landed-in-history) when txid is omitted and the live unspent check misses a
// since-spent UTXO — mirrors level2-A's already-fixed pattern (readOutpointCreatedAddr).
import { sqlite } from '../db/client.js';
import { buildEnforceCtx } from './bshard-close-voter.js';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

async function main() {
  const voter = { id: '8f104e2d-646d-47cd-81f6-97a16b4f6c01', name: 'J2test', address: 'kaspatest:qr5jea9rqnhptf6sz4g9ekc46uf9euk3mejjnrfz9ghvfj43nhjnx2z9k7s5v' };
  const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get('ext-pool-v07-1783460230858-uqmp8');
  const ctx = buildEnforceCtx(voter, '4a355a772446add9', market);

  // 真实场景 (the exact bug): tester-1's NO-bet PoolSide ticket — landed 2026-07-08 (tx 5da9c391...),
  // then SPENT when absorb consolidated the whole ShardLeaf. Live unspent check alone → false (the bug).
  // With the fix, no-txid calls must fall back to kaspa_tx_log and find it.
  const spentTicketAddr = 'kaspatest:prgjtjd3z080demkkldc8gxxtswfka4y74950pk97vhuakjhwy202wvhv5t6e';
  const resultSpentNoTxid = await ctx.checkUtxoLanded(spentTicketAddr, null);
  ok(resultSpentNoTxid === true, `spent-but-historically-landed ticket, txid omitted: returns true (was false pre-fix — this is the exact uqmp8 bug)`);

  // never-existed address: no live UTXO, no kaspa_tx_log row → must stay false, not silently pass.
  const fakeAddr = 'kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
  const resultFake = await ctx.checkUtxoLanded(fakeAddr, null);
  ok(resultFake === false, `never-existed address, txid omitted: returns false (no false-positive)`);

  // explicit-txid path unaffected: this standalone script has no live in-process relay child
  // (same "Relay not running" limitation as every other driver script tonight) — the explicit-txid
  // branch must therefore THROW (proving it did NOT silently fall back to kaspa_tx_log; if it had,
  // this call would have returned a clean true/false instead of an uncaught relay error).
  let threwOnExplicitTxid = false;
  try { await ctx.checkUtxoLanded(spentTicketAddr, 'ff'.repeat(32)); } catch (e) { threwOnExplicitTxid = /Relay not running/.test(e.message); }
  ok(threwOnExplicitTxid, `real address + explicit txid, no live relay: throws (no historical fallback leak into the txid-precise path)`);

  console.log(fails === 0 ? '\n✅✅ ALL PASS — checkUtxoLanded landed-in-history fallback verified against real chain data' : `\n❌ ${fails} assertions failed`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e.message, e.stack); process.exit(1); });
