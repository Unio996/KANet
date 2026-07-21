// bshard_single_persona_bet_journey.test.mjs — S2 journey 首条(2026-07-17, KANet-UI tg入口 + J2 settler域)。
// 设计 docs/2026-07-17-simulated-user-traffic-framework-v0.1.md §5 S2 卡。
//
// 单 persona 走真实 TG /bet 对话下注一个已存在的 bshard 市场(tg_place_bet, 身份=persona 自己的
// linked_addr, port 自 tg-bot/test/dm-bet-e2e.mjs 已验证过的真实身份绑定逻辑)。
//
// 🔴 2026-07-21(P2 批2 DoD-8 事故·Bettor #ujjcz7.2 派工,几经订正的最终版本):
// v1: marketId=3mzoh(今晚 K-18 verifying 组调查对象之一)——不合适,已弃用。
// v2: marketId=gxrr4(payout_shards 零行)单笔——J1 抓漏: genesis-mint 分支不碰 gate,单笔验不到东西。
// v3: gxrr4 连下两笔——KANet-UI 执行时炸出真实事故: 原 3 步版本(含下方已移除的
//   settle_journey_market_synthetic)对着 gxrr4 这个真实生产市场无条件写入假 protocol_status=
//   'completed' + 假 settle_evidence(txid 是 randomUUID 拼的,从未广播上链)。诊断+精确修复见
//   docs/2026-07-13-hidden-stuck-funds-terminal-status-sweep-design.md 追记段(2026-07-21)——3处
//   DB 订正已由 KANet-UI 执行、NWT 复核 GREEN,真实 1 KAS 下注完好无损,该卡已核销。
// v4(当前): marketId 换成 ext-pool-v07-1780704532865-7r617(已有 52 笔真实下注,payout_shards 早已
//   存在且状态健康,非本次操作触发,pending_bettors,deadline 未来)——单笔下注即可直接命中
//   ensurePayoutShard 的"已存在行"分支 = non-blocking coherence gate 真实吃到流量。
//
// 🔴 settle_journey_market_synthetic + settler_assert_mybets_consistency 两步本次运行**移除**
// (原 H2 regression 场景,跟 DoD-8 的 gate 验证目标无关)——前者是刚闯出事故的合成结算 action,
// 生产市场防护栏(Bettor #ujutj3 派工②,J2 owner/NWT 审)落地前,不得再对任何真实市场跑它,尤其
// 不能对 7r617 这种有 52 个真实用户的市场跑。等防护栏落地(action 拒绝非自建/沙盒市场)后,H2
// regression 场景再用专属沙盒市场恢复到独立 case,不跟 DoD-8 这类真实下注验证混在一起。
//
// 真花测试网 KAS(小额, stakeKas=1, 同 Bettor 裁定"币充足但不必要不浪费"), 真实链上等待(~2-5min),
// skip_in_batch: true(不进批量自动跑, 手动触发)。
export default {
  id: 'bshard_single_persona_bet_journey',
  description: 'S2 首条旅程 — 真实TG下注(命中 K-18 non-blocking coherence gate 的已存在行分支)',
  domain: 'predictions',
  tags: ['predictions', 'journey', 'real-chain', 's2'],
  skip_in_batch: true,
  steps: [
    {
      action: 'tg_place_bet',
      // DoD-8 本体: 目标市场 payout_shards 行已存在(52 笔既有真实下注,历史健康),ensurePayoutShard
      // 走"已存在行"早返回分支,真正命中 non-blocking coherence gate。
      marketId: 'ext-pool-v07-1780704532865-7r617',
      side: 'YES',
      stakeKas: 1,
      expect: {
        must: {
          // result_field_equals 先断 ok:true(action 内部任何一步 fail() 都会体现为 ok:false+error,
          // 不满足这条会直接给出失败原因, 不用猜); result_has_keys 再确认成功路径该有的字段都在。
          result_field_equals: { ok: true },
          result_has_keys: ['marketId', 'personaAddr', 'sidePsh', 'lockTx', 'merkleIndex'],
        },
      },
    },
  ],
};
