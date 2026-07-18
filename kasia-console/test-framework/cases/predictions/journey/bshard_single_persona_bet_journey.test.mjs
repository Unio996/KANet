// bshard_single_persona_bet_journey.test.mjs — S2 journey 首条(2026-07-17, KANet-UI tg入口 + J2 settler域)。
// 设计 docs/2026-07-17-simulated-user-traffic-framework-v0.1.md §5 S2 卡。
//
// 单 persona 走真实 TG /bet 对话下注一个已存在的 bshard 市场(tg_place_bet, 身份=persona 自己的
// linked_addr, port 自 tg-bot/test/dm-bet-e2e.mjs 已验证过的真实身份绑定逻辑), 再由 J2 落码的
// settler 域两个 action 制造 H2 回归场景(同 pk 同方向跨分片多笔赢单)并断言 /mybets 读取路径。
//
// H2(pool.js winner_details 多笔赢单按 pk 错配 bug)修前, known_fail_h2 预期 true / matches 预期
// false(诚实标 known-fail, 不绿灯造假, 同 §4 诚实边界); H2 落码后这条 expect 需要反转(NWT
// 复核+落码后由 J2/KANet-UI 协同更新本文件)。
//
// 真花测试网 KAS(小额, stakeKas=1, 同 Bettor 裁定"币充足但不必要不浪费"), 真实链上等待(~2-5min),
// skip_in_batch: true(不进批量自动跑, 手动触发)。
export default {
  id: 'bshard_single_persona_bet_journey',
  description: 'S2 首条旅程 — 真实TG下注→settler制造H2场景→/mybets断言(H2修前known-fail)',
  domain: 'predictions',
  tags: ['predictions', 'journey', 'real-chain', 's2'],
  skip_in_batch: true,
  steps: [
    {
      action: 'tg_place_bet',
      marketId: 'ext-pool-v07-1784236336840-3mzoh',
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
    {
      action: 'settle_journey_market_synthetic',
      // marketId/personaAddr 从 ctx.vars 读(tg_place_bet 成功时已写入), 不重复传
      additionalStakeSompi: 50000000,   // 0.5 KAS 的第二笔赢单份额
      expect: {
        must: {
          result_field_equals: { ok: true },
          result_has_keys: ['logicalMarketId', 'secondShardId', 'txId', 'winner_details'],
        },
      },
    },
    {
      action: 'settler_assert_mybets_consistency',
      expect: {
        must: {
          result_has_keys: ['sumPayoutKas', 'expectedTotalKas', 'winRowCount', 'matches', 'known_fail_h2'],
        },
        should: {
          // H2 修前诚实标 known-fail(§4 诚实边界: 不绿灯造假)。H2 落码后把这条升级成
          // must: { result_field_equals: { known_fail_h2: false, matches: true } }。
        },
      },
    },
  ],
};
