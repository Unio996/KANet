// _j2_closezk_v2_mint_ctor_position_test.mjs — regression guard for the CRITICAL BLOCKING bug NWT caught
//   2026-07-07 15:59: compileCloseZkV2Redeem baked closeZkTmplAnchor into the gateTmplHash ctor slot,
//   silently dropping the real gateTmplHash param (any minted market's zk_close would permanently fail).
//
// General guard (Bettor 15:59): ctor-assembly tests MUST use DISTINCT dummy values per same-typed field —
//   identical placeholder values ("all-zero"/"all-11") make positional swap bugs invisible to any test.
//   This script differentially recompiles with one field swapped at a time and asserts ONLY that field's
//   bytes change in the output (byte-for-byte containment check, not just "didn't throw").
//
// Run: cd kasia-console && node scratch/_j2_closezk_v2_mint_ctor_position_test.mjs

import { compileCloseZkV2Redeem } from '../src/lib/closezk-v2-mint.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const BASE = {
  gateTmplHash: 'aa'.repeat(32),
  betsRootBaked: 'bb'.repeat(32),
  refundRootBaked: 'cc'.repeat(32),
  attestedAtMs: 1783413621808,
  attestedWinner: 1,
  consolidatedPool: 100000000,
};

function assertFieldLandsInOwnSlot(fieldName, newValueHex) {
  const redeemBase = compileCloseZkV2Redeem(BASE);
  const redeemSwapped = compileCloseZkV2Redeem({ ...BASE, [fieldName]: newValueHex });
  const bufBase = Buffer.from(redeemBase, 'hex');
  const bufSwapped = Buffer.from(redeemSwapped, 'hex');
  const oldBuf = Buffer.from(BASE[fieldName], 'hex');
  const newBuf = Buffer.from(newValueHex, 'hex');

  ok(bufBase.includes(oldBuf), `${fieldName}: base redeem contains its own value`);
  ok(!bufBase.includes(newBuf), `${fieldName}: base redeem does NOT contain the swapped-in value`);
  ok(bufSwapped.includes(newBuf), `${fieldName}: swapped redeem contains the new value`);
  ok(!bufSwapped.includes(oldBuf), `${fieldName}: swapped redeem no longer contains the old value`);

  // other two byte32 fields must be untouched by swapping this one.
  for (const other of ['gateTmplHash', 'betsRootBaked', 'refundRootBaked']) {
    if (other === fieldName) continue;
    const otherBuf = Buffer.from(BASE[other], 'hex');
    ok(bufSwapped.includes(otherBuf), `${fieldName} swap: ${other} unaffected (still present unchanged)`);
  }
}

console.log('[test] gateTmplHash positional isolation (the exact bug NWT caught):');
assertFieldLandsInOwnSlot('gateTmplHash', 'dd'.repeat(32));
console.log('[test] betsRootBaked positional isolation:');
assertFieldLandsInOwnSlot('betsRootBaked', 'ee'.repeat(32));
console.log('[test] refundRootBaked positional isolation:');
assertFieldLandsInOwnSlot('refundRootBaked', 'ff'.repeat(32));

console.log(fails === 0 ? '\n✅✅ ALL PASS — ctor field mapping is byte-position-correct (differential test, not just compile-success)' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
