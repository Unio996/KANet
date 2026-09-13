import { buildMerkle, proveMerkle, root, hex, le8 } from './merkle.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });

const DEPTH = 10;
const BETTOR_PK = new Array(32).fill(0x22);
const MERKLE_INDEX = 5;
const ZERO32 = new Array(32).fill(0);
const OWN_COV = new Array(32).fill(0xaa); // this covenant instance's own cov_id (continuation outputs)

function p2pkScript(pkBytes) { return '0x' + Buffer.from([0x00, 0x00, 0x20, ...pkBytes, 0xac]).toString('hex'); }

function leafFor(pk, amount) { return [...b2b([...pk, ...le8(amount)])]; }
function buildRootFor(amount, idx = MERKLE_INDEX) {
  const leaves = {}; leaves[idx] = leafFor(BETTOR_PK, amount);
  const levels = buildMerkle(DEPTH, leaves);
  const siblings = proveMerkle(levels, idx, DEPTH);
  return { payoutRoot: root(levels, DEPTH), siblings };
}

// ---------- PayoutShard.sil claim / refund_claim (identical shape, closed=1 vs 2) ----------
function ctorPS({ consolidated_pool, closed, payoutRoot }) {
  return [ hex(ZERO32), hex(ZERO32), consolidated_pool, closed, hex(payoutRoot), ...new Array(17).fill(0) ];
}
function nullifierWords(merkleIndex) {
  const wordIdx = Math.floor(merkleIndex / 63);
  const bitIn = merkleIndex % 63;
  const mask = 1 << bitIn;
  const words = new Array(17).fill(0);
  words[wordIdx] = mask;
  return words;
}
function mkPSVector(fnName, closedVal, name, { consolidated_pool, payout, expect, selfOutPresent, selfOutValue }) {
  const { payoutRoot, siblings } = buildRootFor(payout);
  const outputs = [ { value: payout, p2pk_pubkey: '0x' + Buffer.from(BETTOR_PK).toString('hex') } ];
  if (selfOutPresent) {
    const w = nullifierWords(MERKLE_INDEX);
    outputs.push({
      value: selfOutValue, covenant_id: hex(OWN_COV),
      state: { consolidated_pool: consolidated_pool - payout, closed: closedVal, payoutRoot: hex(payoutRoot),
        w0: w[0], w1: w[1], w2: w[2], w3: w[3], w4: w[4], w5: w[5], w6: w[6], w7: w[7], w8: w[8],
        w9: w[9], w10: w[10], w11: w[11], w12: w[12], w13: w[13], w14: w[14], w15: w[15], w16: w[16] },
    });
  }
  return {
    name, function: fnName,
    constructor_args: ctorPS({ consolidated_pool, closed: closedVal, payoutRoot }),
    args: [1, 0, hex(BETTOR_PK), payout, MERKLE_INDEX, ...siblings.map(hex)],
    expect,
    tx: { active_input_index: 0, inputs: [{ utxo_value: consolidated_pool, covenant_id: hex(OWN_COV) }], outputs },
  };
}

const psClaim = [
  mkPSVector('claim', 1, 'DD-PS-claim-1_pass_exact_no_continuation', { consolidated_pool: 100, payout: 100, expect: 'pass', selfOutPresent: false }),
  mkPSVector('claim', 1, 'DD-PS-claim-2_pass_partial_with_continuation', { consolidated_pool: 100, payout: 40, expect: 'pass', selfOutPresent: true, selfOutValue: 60 }),
  mkPSVector('claim', 1, 'DD-PS-claim-3_fail_partial_continuation_wrong_amount', { consolidated_pool: 100, payout: 40, expect: 'fail', selfOutPresent: true, selfOutValue: 61 }),
  mkPSVector('claim', 1, 'DD-PS-claim-4_fail_partial_missing_continuation', { consolidated_pool: 100, payout: 40, expect: 'fail', selfOutPresent: false }),
];
const psRefund = [
  mkPSVector('refund_claim', 2, 'DD-PS-refund-1_pass_exact_no_continuation', { consolidated_pool: 80, payout: 80, expect: 'pass', selfOutPresent: false }),
  mkPSVector('refund_claim', 2, 'DD-PS-refund-2_pass_partial_with_continuation', { consolidated_pool: 80, payout: 30, expect: 'pass', selfOutPresent: true, selfOutValue: 50 }),
  mkPSVector('refund_claim', 2, 'DD-PS-refund-3_fail_partial_continuation_wrong_amount', { consolidated_pool: 80, payout: 30, expect: 'fail', selfOutPresent: true, selfOutValue: 49 }),
  mkPSVector('refund_claim', 2, 'DD-PS-refund-4_fail_partial_missing_continuation', { consolidated_pool: 80, payout: 30, expect: 'fail', selfOutPresent: false }),
];

// refund_claim args differ in name only (payout param is named 'refund' in source but positionally identical);
// arg order for refund_claim per source: (selfOutIdx, refundOutIdx, bettorPk, refund, merkle_index, s0..s9) -- same shape as claim.

// ---------- PayoutShardV2.sil refund_claim (has 4 extra trailing state fields to pass through) ----------
function ctorPSV2({ consolidated_pool, closed, payoutRoot }) {
  return [
    hex(ZERO32), hex(ZERO32), hex(ZERO32),         // poolMerkleRoot, predicate_commit, closeZkTmplAnchor
    consolidated_pool, closed, hex(payoutRoot), ...new Array(17).fill(0),
    -1, 0, hex(ZERO32), hex(ZERO32),                // attestedWinner(-1 sentinel), attestedAtMs, betsRootBaked, refundRootBaked
  ];
}
function mkPSV2RefundVector(name, { consolidated_pool, payout, expect, selfOutPresent, selfOutValue }) {
  const { payoutRoot, siblings } = buildRootFor(payout);
  const outputs = [ { value: payout, p2pk_pubkey: '0x' + Buffer.from(BETTOR_PK).toString('hex') } ];
  if (selfOutPresent) {
    const w = nullifierWords(MERKLE_INDEX);
    outputs.push({
      value: selfOutValue, covenant_id: hex(OWN_COV),
      state: { consolidated_pool: consolidated_pool - payout, closed: 2, payoutRoot: hex(payoutRoot),
        w0: w[0], w1: w[1], w2: w[2], w3: w[3], w4: w[4], w5: w[5], w6: w[6], w7: w[7], w8: w[8],
        w9: w[9], w10: w[10], w11: w[11], w12: w[12], w13: w[13], w14: w[14], w15: w[15], w16: w[16],
        attestedWinner: -1, attestedAtMs: 0, betsRootBaked: hex(ZERO32), refundRootBaked: hex(ZERO32) },
    });
  }
  return {
    name, function: 'refund_claim',
    constructor_args: ctorPSV2({ consolidated_pool, closed: 2, payoutRoot }),
    args: [1, 0, hex(BETTOR_PK), payout, MERKLE_INDEX, ...siblings.map(hex)],
    expect,
    tx: { active_input_index: 0, inputs: [{ utxo_value: consolidated_pool, covenant_id: hex(OWN_COV) }], outputs },
  };
}
const psv2Refund = [
  mkPSV2RefundVector('DD-PSV2-refund-1_pass_exact_no_continuation', { consolidated_pool: 90, payout: 90, expect: 'pass', selfOutPresent: false }),
  mkPSV2RefundVector('DD-PSV2-refund-2_pass_partial_with_continuation', { consolidated_pool: 90, payout: 20, expect: 'pass', selfOutPresent: true, selfOutValue: 70 }),
  mkPSV2RefundVector('DD-PSV2-refund-3_fail_partial_continuation_wrong_amount', { consolidated_pool: 90, payout: 20, expect: 'fail', selfOutPresent: true, selfOutValue: 71 }),
  mkPSV2RefundVector('DD-PSV2-refund-4_fail_partial_missing_continuation', { consolidated_pool: 90, payout: 20, expect: 'fail', selfOutPresent: false }),
];

fs.writeFileSync('scratch/_t1v06_check/PayoutShard.drawdown.test.json', JSON.stringify({ tests: [...psClaim, ...psRefund] }, null, 1));
fs.writeFileSync('scratch/_t1v06_check/PayoutShardV2.drawdown.test.json', JSON.stringify({ tests: psv2Refund }, null, 1));
console.log('wrote PS:', psClaim.length + psRefund.length, 'PSV2:', psv2Refund.length);
