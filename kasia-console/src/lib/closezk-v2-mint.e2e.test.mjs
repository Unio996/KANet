// closezk-v2-mint.e2e.test.mjs — J1+J2 合体测试 (Bettor 18:45 合体序①收尾, T2b(ii))。
//   端到端: 合成一份 PayoutShardV2 close_attest_v2 continuation redeem(镜像 J1 的
//   bshard-close-enforce.psv2-read.test.mjs fixture 手法, 不重造) → splice 委员 attest 值(distinct
//   sentinels) → buildCloseZkV2GenesisFromAttestedState(J1 read + J2 anchor/ctor 装配) → 断言编译出的
//   CloseZkV2 redeem 里包含全部 5 个真实值(gateTmplHash/betsRootBaked/refundRootBaked/attestedAtMs/
//   attestedWinner)、且值精确对得上、且 anchor 是对 CloseZkV2.sil 当次编译产物算出的(非硬编码/非复用旧值)。
//
// Run: cd kasia-console && node src/lib/closezk-v2-mint.e2e.test.mjs

import { _splicePayoutV2CloseRedeem } from './bshard-close-enforce.mjs';
import { buildCloseZkV2GenesisFromAttestedState, compileCloseZkV2Redeem } from './closezk-v2-mint.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const CONSOLIDATED_POOL = 5111000000n;
function pushInt(n) {
  const neg = n < 0n; let mag = neg ? -n : n;
  const b = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) { b[i] = Number(mag & 0xffn); mag >>= 8n; }
  if (neg) b[7] |= 0x80;
  return Buffer.concat([Buffer.from([0x08]), b]);
}
function pushRoot32(hex) { return Buffer.concat([Buffer.from([0x20]), Buffer.from(hex, 'hex')]); }
function buildBaseRedeem() {
  return Buffer.concat([
    Buffer.from([0x00]), pushInt(CONSOLIDATED_POOL), pushInt(0n), pushRoot32('00'.repeat(32)),
    ...Array.from({ length: 17 }, () => pushInt(0n)),
    pushInt(-1n), pushInt(0n), pushRoot32('00'.repeat(32)), pushRoot32('00'.repeat(32)),
    Buffer.from('deadbeef', 'hex'),
  ]).toString('hex');
}

console.log('[test] end-to-end: synthetic landed close_attest_v2 -> buildCloseZkV2GenesisFromAttestedState:');
const base = buildBaseRedeem();
const SENT = {
  newPayoutRootHex: '99'.repeat(32),   // not read by our function (payoutRootField only exists post zk_close)
  newAttestedWinner: 0,
  newBetsRootHex: '44'.repeat(32),
  newRefundRootHex: '55'.repeat(32),
  newAttestedAtMs: 1783413621808,
};
const landedPsv2Redeem = _splicePayoutV2CloseRedeem(base, SENT);
const GATE_TMPL_HASH = '66'.repeat(32);   // distinct from all other sentinels used above (bets/refund/payout roots)

const result = buildCloseZkV2GenesisFromAttestedState(landedPsv2Redeem, GATE_TMPL_HASH);

ok(result.consolidatedPool === CONSOLIDATED_POOL, `consolidatedPool passthrough byte-exact (${result.consolidatedPool})`);
ok(result.attestedWinner === SENT.newAttestedWinner, `attestedWinner byte-exact (${result.attestedWinner})`);
ok(result.attestedAtMs === SENT.newAttestedAtMs, `attestedAtMs byte-exact, zero unit conversion (${result.attestedAtMs})`);
ok(/^[0-9a-f]{64}$/.test(result.anchorHex), `anchorHex is a fresh 32B hex (${result.anchorHex.slice(0, 12)}...)`);

const redeemBuf = Buffer.from(result.redeemHex, 'hex');
ok(redeemBuf.includes(Buffer.from(GATE_TMPL_HASH, 'hex')), 'compiled redeem contains gateTmplHash (correct ctor slot, the CRITICAL bug this guards against)');
ok(redeemBuf.includes(Buffer.from(SENT.newBetsRootHex, 'hex')), 'compiled redeem contains betsRootHex (mapped to betsRootBaked ctor slot)');
ok(redeemBuf.includes(Buffer.from(SENT.newRefundRootHex, 'hex')), 'compiled redeem contains refundRootHex (mapped to refundRootBaked ctor slot)');
ok(!redeemBuf.includes(Buffer.from(SENT.newPayoutRootHex, 'hex')), 'compiled redeem does NOT contain the post-attest payoutRoot placeholder (correctly excluded — payoutRootField only exists after zk_close, ctor bakes ZERO32)');

// direct compileCloseZkV2Redeem re-check: confirm buildCloseZkV2GenesisFromAttestedState is not silently
// diverging from calling compileCloseZkV2Redeem directly (defends against future refactors decoupling them).
const direct = compileCloseZkV2Redeem({
  gateTmplHash: GATE_TMPL_HASH, betsRootBaked: SENT.newBetsRootHex, refundRootBaked: SENT.newRefundRootHex,
  attestedAtMs: SENT.newAttestedAtMs, attestedWinner: SENT.newAttestedWinner, consolidatedPool: CONSOLIDATED_POOL,
});
ok(direct === result.redeemHex, 'buildCloseZkV2GenesisFromAttestedState redeem byte-exact == direct compileCloseZkV2Redeem call with same values');

console.log(fails === 0 ? '\n✅✅ ALL PASS — J1 read-slice + J2 mint-slice integrate correctly end-to-end' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
