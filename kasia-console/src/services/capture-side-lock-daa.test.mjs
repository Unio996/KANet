// capture-side-lock-daa.test.mjs — offline ground-truth test for captureSideLockDaa's block_hash method
// switch (Bettor 2026-07-08 22:04, #b75exc condition ③): patched output must byte-exact match a manual
// RPC getBlock(block_hash).header.daaScore query, using tonight's two REAL uqmp8 bets as fixtures.
import { captureSideLockDaa } from './trade-protocol-filter.js';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

// Ground truth captured 2026-07-08 22:0x via direct RPC getBlock(hash).header.daaScore against TN12 live node
// (kasia-console/src/services/trade-protocol-filter.js.getBlock, same call the patched function now makes).
const REAL_BETS = [
  { label: 'uqmp8 NO (tester-1)', side_lock_tx: '14890ec43e1308a17b92580ef79cd0f0313cc20afe7e4c7bbab77af87ccd5846', side_p2sh: 'kaspatest:pz8antzr3ahsln3fpx6aglqrhxvv4dra4z2a0h6jjvw38klss0y9x40e77sj7', stake_amount: '150000000', expectedDaa: 55371942 },
  { label: 'uqmp8 YES (J2test)', side_lock_tx: 'fd8711d8302cb0dfad41061ef0bdb39b6b695929b5587d804bb7dafa51e1845e', side_p2sh: 'kaspatest:pz8antzr3ahsln3fpx6aglqrhxvv4dra4z2a0h6jjvw38klss0y9x40e77sj7', stake_amount: '150000000', expectedDaa: 55376892 },
];

async function main() {
  for (const b of REAL_BETS) {
    const { daa, reason } = await captureSideLockDaa({ side_p2sh: b.side_p2sh, side_lock_tx: b.side_lock_tx, stake_amount: b.stake_amount, network: 'testnet-12' });
    ok(reason === 'ok', `${b.label}: reason='ok' (got '${reason}')`);
    ok(daa === b.expectedDaa, `${b.label}: daa=${daa} byte-exact == manual RPC ground truth ${b.expectedDaa}`);
  }

  // fail-loud: unknown tx_id (not in kaspa_tx_log) must return null + 'no-block-hash', never guess.
  const { daa: unknownDaa, reason: unknownReason } = await captureSideLockDaa({ side_p2sh: 'kaspatest:fake', side_lock_tx: 'ff'.repeat(32), stake_amount: '1', network: 'testnet-12' });
  ok(unknownDaa === null, `unknown tx: daa=null (got ${unknownDaa})`);
  ok(unknownReason === 'no-block-hash', `unknown tx: reason='no-block-hash' (got '${unknownReason}')`);

  console.log(fails === 0 ? '\n✅✅ ALL PASS — captureSideLockDaa block_hash method verified byte-exact against real chain data' : `\n❌ ${fails} assertions failed`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e.message, e.stack); process.exit(1); });
