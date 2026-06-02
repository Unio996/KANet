// Verify v0.7.1 trio + JS plumbing — compile all 3 .sil with sample ctor + report.
//
// Tests: WinningsPool_v1, PoolSpine_v0.7.1, PoolSide_v0.7.1

import {
  computeWinningsPoolP2SH_v1,
  computeSpineP2SH_v0_7_1,
  computeSideP2SH_v0_7_1,
  getKaspaP2SHPrefix3Hex,
} from '../src/lib/pool-p2sh-v0_7_1.mjs';

const NETWORK = process.argv[2] || 'testnet-12';

const sample = {
  makerPk:    'a1b2c3d4e5f607182930415263748596a7b8c9d0e1f2031425364758697a8b9c',
  brokerPk:   'b1c2d3e4f50617283940516273849506a7b8c9d0e1f2031425364758697a8b9d',
  bettorPk:   'c1d2e3f405162738495061728394a5b6c7d8e9f0011223344556677889aabbcc',
  poolMerkleRoot:     '1111111111111111111111111111111111111111111111111111111111111111',
  marketMetadataHash: '2222222222222222222222222222222222222222222222222222222222222222',
  market_id:          '3333333333333333333333333333333333333333333333333333333333333333',
  marketCovenantId:   '3333333333333333333333333333333333333333333333333333333333333333',
  deadline:           1800000000,
  brokerFeePct:       100,
  oracleFeePct:       100,
  oracleBondAmount:   100000000,
  makerStakeAmount:   10000000000,
  direction:          0,
  outcome:            0,
  yesPool:            10000000000,
  noPool:             5000000000,
};

console.log('v0.7.1 trio compile verify');
console.log('  network:', NETWORK);
console.log('');

console.log('1/4 WinningsPool_v1...');
const wp = await computeWinningsPoolP2SH_v1({
  outcome: sample.outcome,
  yesPool: sample.yesPool,
  noPool: sample.noPool,
  brokerPk: sample.brokerPk,
  marketCovenantId: sample.marketCovenantId,
  network: NETWORK,
});
console.log('  ✓ p2shHash:', wp.p2shHash);
console.log('  ✓ addr:    ', wp.p2shAddr);
console.log('  ✓ redeem:  ', (wp.redeemScript.length / 2), 'B');
console.log('');

console.log('2/4 PoolSpine_v0.7.1...');
const sp = await computeSpineP2SH_v0_7_1({
  makerPk: sample.makerPk,
  brokerPk: sample.brokerPk,
  poolMerkleRoot: sample.poolMerkleRoot,
  deadline: sample.deadline,
  brokerFeePct: sample.brokerFeePct,
  oracleFeePct: sample.oracleFeePct,
  oracleBondAmount: sample.oracleBondAmount,
  makerStakeAmount: sample.makerStakeAmount,
  marketMetadataHash: sample.marketMetadataHash,
  market_id: sample.market_id,
  winningsPoolSpkPrefix3Hex: getKaspaP2SHPrefix3Hex(),
  network: NETWORK,
});
console.log('  ✓ p2shHash:', sp.p2shHash);
console.log('  ✓ addr:    ', sp.p2shAddr);
console.log('  ✓ redeem:  ', (sp.redeemScript.length / 2), 'B');
console.log('');

console.log('3/4 PoolSide_v0.7.1...');
const sd = await computeSideP2SH_v0_7_1({
  bettorPk: sample.bettorPk,
  spineP2shHash: sp.p2shHash,
  marketMetadataHash: sample.marketMetadataHash,
  direction: sample.direction,
  deadline: sample.deadline,
  network: NETWORK,
});
console.log('  ✓ addr:    ', sd.p2shAddr);
console.log('  ✓ redeem:  ', (sd.redeemScript.length / 2), 'B');
console.log('');

console.log('4/4 getKaspaP2SHPrefix3Hex():', getKaspaP2SHPrefix3Hex());
console.log('');
console.log('all 3 compile OK + JS plumbing 接通 — 待 settler/console integration');
