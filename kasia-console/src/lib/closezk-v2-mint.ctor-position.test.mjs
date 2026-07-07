// _j2_closezk_v2_mint_ctor_position_test.mjs — regression guard for the CRITICAL BLOCKING bug NWT caught
//   2026-07-07 15:59: compileCloseZkV2Redeem baked closeZkTmplAnchor into the gateTmplHash ctor slot,
//   silently dropping the real gateTmplHash param (any minted market's zk_close would permanently fail).
//
// General guard (Bettor 15:59): ctor-assembly tests MUST use DISTINCT dummy values per same-typed field —
//   identical placeholder values ("all-zero"/"all-11") make positional swap bugs invisible to any test.
//   This script differentially recompiles with one field swapped at a time and asserts ONLY that field's
//   bytes change in the output (byte-for-byte containment check, not just "didn't throw").
//
// Run: cd kasia-console && node src/lib/closezk-v2-mint.ctor-position.test.mjs

import { compileCloseZkV2Redeem } from './closezk-v2-mint.mjs';

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

// ── state-region [1,214) offset guard (Bettor 2026-07-08 20:49, non-blocking hardening after J1's
//    unlockBshardZkClose risk flag): unlockBshardZkClose(kasia-relay/src/lib/p2sh.mjs:2140, written for
//    CloseZkRepro4) splices byte[1..214) as a fixed 213B state region (attestedWinner/closed/payoutRootField/
//    consolidated_pool/w0-16), assumed unchanged for CloseZkV2. Verified byte-exact 2026-07-08 (two
//    independent derives, J2+NWT, converged — COORD-LEDGER 20:48-20:49). This test pins that layout so
//    any future CloseZkV2.sil edit that silently shifts the state region breaks CI, not a live market.
console.log('[test] unlockBshardZkClose byte[1,214) state-region layout (pins the 2026-07-08 verified assumption):');
{
  function i64(n) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; }
  const push8 = Buffer.from([8]), push32 = Buffer.from([32]);
  const zeroWord = Buffer.concat([push8, i64(0)]);
  const attestedWinner = 1, consolidatedPool = 123456789;
  const redeemHex = compileCloseZkV2Redeem({ ...BASE, attestedWinner, consolidatedPool });
  const buf = Buffer.from(redeemHex, 'hex');

  ok(buf[0] === 107, `byte[0] genesis marker == 107 (got ${buf[0]})`);
  const expectedStateBytes = Buffer.concat([
    push8, i64(attestedWinner),
    push8, i64(1),   // compileCloseZkV2Redeem hardcodes init_closed=1 at mint time
    push32, Buffer.alloc(32),   // init_payoutRootField = ZERO32 placeholder pre-zk_close
    push8, i64(consolidatedPool),
    ...Array(17).fill(zeroWord),
  ]);
  ok(expectedStateBytes.length === 213, `reconstructed state region is exactly 213B (got ${expectedStateBytes.length})`);
  ok(expectedStateBytes.equals(buf.slice(1, 1 + 213)), 'byte[1,214) state region byte-exact matches unlockBshardZkClose\'s newStateBytes construction');

  // template zone [214,end) must be invariant across different state values (splice isolation).
  const redeemHex2 = compileCloseZkV2Redeem({ ...BASE, attestedWinner: 0, consolidatedPool: 999999999 });
  const buf2 = Buffer.from(redeemHex2, 'hex');
  ok(buf.slice(214).equals(buf2.slice(214)), 'template zone [214,end) byte-identical across different state values (splice isolation holds)');
  ok(!buf.slice(1, 214).equals(buf2.slice(1, 214)), 'state zone [1,214) correctly differs when state values differ');
}

console.log(fails === 0 ? '\n✅✅ ALL PASS — ctor field mapping is byte-position-correct (differential test, not just compile-success)' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
