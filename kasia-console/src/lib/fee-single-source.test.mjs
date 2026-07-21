// fee-single-source.test.mjs — P4/D-008 单源 fee-leaf 派生验收(J2 2026-07-09)。
// 设计文档 docs/2026-07-09-fee-single-source-leaf-derivation-design.md §3(Bettor 方向审 GREEN-with-notes 四注
// + NWT 红队)。用 1dv70(5R-2, 真实链上市场)+ pxvml 历史真实输入回放, 断言四侧(propose/enqueue/委员voter/
// deriveSettlementFeeLeaves 本体)独立调用产出 byte-exact, 不做"5R-2 实弹重跑"(已终结不可复弹, 注C改口径)。
import { deriveSettlementFeeLeaves, deriveFeeLeaves, computePariMutuelPayout, settlePayoutRoot } from './pool-shard-settle.mjs';
import { canonicalBetOrder } from './pool-payout-root.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

// ── 真实历史输入: 1dv70(5R-2, 2026-07-09 真实链上市场, txId e7889b45...成交)──
const MARKET_1DV70 = {
  brokerPk: '27858b2f224f025d8b06d7ac1c562bab5d8f91052b49a3ae75328d353c0fc954',
  brokerFeePctBps: 190,   // market.broker_fee_pct 真实值(1.9%)
};
const BETTORS_1DV70 = [
  { pk: 'e92cf4a304ee15a75015505cdb15d7125cf2d1de65298d222a2ec4cab19de533', stake: '150000000', direction: 1, side_lock_daa: 56391115, side_lock_tx: '1440b7fd4f7d3424886484cda96b093184b4d6376761c81f78d30b5da8fb5990' },
  { pk: 'ff18f539190b58077a6bbb5c7d469a506e434dfdcf793fedd375880a46845b0b', stake: '150000000', direction: 0, side_lock_daa: 56391337, side_lock_tx: '253aee2be958c03868b629c645623da6d6d2a5e038be67c429298fdf8b713645' },
];
const POOL_1DV70 = '320000000';   // 链上实额(含 seed), attest 时委员共识值
const WINNING_DIR_1DV70 = 0;      // 真实判定(blockhash_parity, 末字节偶)
const EXPECT_FEE_SOMPI_1DV70 = '6080000';       // 320000000 * 190 / 10000, 真实 claim2 落链值
const EXPECT_GUEST_PAYOUT_ROOT_1DV70 = '31c86567041efa5944bf8d1606624da2d4d37579d89b35fdd85cb1d8a958053b';   // job#8 真实 receipt journal 值

console.log('[test] ① propose 侧调用形状(realConsolidatedPool + market.broker_fee_pct):');
{
  const { feeLeaves, feeSompi } = deriveSettlementFeeLeaves(MARKET_1DV70, POOL_1DV70);
  ok(feeSompi === EXPECT_FEE_SOMPI_1DV70, `feeSompi=${feeSompi} == 真实链上值 ${EXPECT_FEE_SOMPI_1DV70}`);
  ok(feeLeaves.length === 1 && feeLeaves[0].pk === MARKET_1DV70.brokerPk, 'feeLeaves=[broker] 单叶(1dv70 无委员/introducer分成)');
}

console.log('[test] ② enqueue 侧独立调用(同函数, 独立 pool 参数=BigInt形态, 不透传propose字符串):');
{
  const { feeLeaves: feeLeavesEnqueue } = deriveSettlementFeeLeaves(MARKET_1DV70, BigInt(POOL_1DV70));
  const { feeLeaves: feeLeavesPropose } = deriveSettlementFeeLeaves(MARKET_1DV70, POOL_1DV70);
  ok(JSON.stringify(feeLeavesEnqueue) === JSON.stringify(feeLeavesPropose), 'propose(string)/enqueue(BigInt) 两种输入类型产出 byte-exact 相同 feeLeaves(算法确定性, 非输入类型敏感)');
}

console.log('[test] ③ 委员 voter 侧独立调用(psConsolidatedPool 链锚现读模拟, 同函数不同调用点):');
{
  // 模拟 _readPsConsolidatedPool 现读产物(BigInt, 同 enforceCloseAttestV2 内部实际类型)
  const psConsolidatedPoolSimulated = BigInt(POOL_1DV70);
  const { feeLeaves: feeLeavesVoter } = deriveSettlementFeeLeaves({ brokerPk: MARKET_1DV70.brokerPk, brokerFeePctBps: MARKET_1DV70.brokerFeePctBps }, psConsolidatedPoolSimulated);
  ok(feeLeavesVoter[0].amount === EXPECT_FEE_SOMPI_1DV70, `委员侧独立调用 amount=${feeLeavesVoter[0].amount} == propose侧 ${EXPECT_FEE_SOMPI_1DV70}(三侧算法同源, 值源各自独立)`);
}

console.log('[test] ④ 端到端: canonicalBetOrder + computePariMutuelPayout + settlePayoutRoot 全链回放, root == 真实 job#8 guestPayoutRoot:');
{
  const ordered = canonicalBetOrder(BETTORS_1DV70);
  const { feeLeaves } = deriveSettlementFeeLeaves(MARKET_1DV70, POOL_1DV70);
  const pm = computePariMutuelPayout({ bettors: ordered, winningDirection: WINNING_DIR_1DV70, poolTotalSompi: POOL_1DV70, feeLeaves });
  ok(!pm.degenerate, 'non-degenerate(有赢家)');
  const root = settlePayoutRoot(pm.payoutLeaves).toString('hex');
  ok(root === EXPECT_GUEST_PAYOUT_ROOT_1DV70, `回放 root=${root.slice(0, 16)}… == 真实链上 guestPayoutRoot ${EXPECT_GUEST_PAYOUT_ROOT_1DV70.slice(0, 16)}…(D-008 口径跟 guest circuit 实际产出一致, 非纸面推导)`);
  const sumLeaves = pm.payoutLeaves.reduce((s, l) => s + BigInt(l.amount), 0n);
  ok(sumLeaves === BigInt(POOL_1DV70), `Σ(payoutLeaves)=${sumLeaves} == consolidatedPool ${POOL_1DV70}(精确清零, 同 enqueueZkProveJob BLOCKING 校验口径)`);
}

console.log('[test] ⑤ V1 旁路隔离: deriveFeeLeaves(V1 专属)与 deriveSettlementFeeLeaves(V2)口径不同, 不能互换:');
{
  // V1 口径(FEE_CONFIG 协议常量+Σ注无seed) vs V2(市场级broker_fee_pct+consolidatedPool含seed) 刻意用同池验证产出不同
  const poolSompiNoSeed = (BigInt(BETTORS_1DV70[0].stake) + BigInt(BETTORS_1DV70[1].stake)).toString();   // 300000000, 漏 seed
  const { feeLeaves: v1Leaves } = deriveFeeLeaves({ poolSompi: poolSompiNoSeed, feeConfig: { brokerBps: 160, oracleBps: 100, introBps: 20, nodeBps: 20 }, brokerPk: MARKET_1DV70.brokerPk, committeePks: [] });
  const { feeLeaves: v2Leaves } = deriveSettlementFeeLeaves(MARKET_1DV70, POOL_1DV70);
  ok(v1Leaves[0].amount !== v2Leaves[0].amount, `V1 口径(FEE_CONFIG 160bps/漏seed池)amount=${v1Leaves[0].amount} != V2口径(D-008 190bps/含seed池)amount=${v2Leaves[0].amount}——两函数刻意不同源, 混用会立刻在数值上暴露(7/8门②同族坑的直接反证)`);
}

console.log('[test] ⑥ fail-loud guard: consolidatedPoolSompi<=0 拒绝派生:');
{
  let threw = false;
  try { deriveSettlementFeeLeaves(MARKET_1DV70, '0'); } catch (e) { threw = /必须\s*>0/.test(e.message); }
  ok(threw, 'pool=0 时 throw(caller 链读值可疑, 不静默派生假 leaves)');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — deriveSettlementFeeLeaves 单源函数四侧独立调用 byte-exact, 回放真实 1dv70 数据命中 guest circuit 实际 payoutRoot, V1/V2 口径隔离验证'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
