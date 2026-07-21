// bshard_single_persona_bet_journey.test.mjs — S2 journey 首条(2026-07-17, KANet-UI tg入口 + J2 settler域)。
// 设计 docs/2026-07-17-simulated-user-traffic-framework-v0.1.md §5 S2 卡。
//
// 单 persona 走真实 TG /bet 对话下注一个已存在的 bshard 市场(tg_place_bet, 身份=persona 自己的
// linked_addr, port 自 tg-bot/test/dm-bet-e2e.mjs 已验证过的真实身份绑定逻辑), 再由 J2 落码的
// settler 域两个 action 制造 H2 回归场景(同 pk 同方向跨分片多笔赢单)并断言 /mybets 读取路径。
//
// H2(pool.js winner_details 多笔赢单按 pk 错配 bug)已于 7/17 修复并装载(ccea4e9b 读取侧拆分,
// NWT diff GREEN,随 3b7000f 装载——见 ledger ㉒段),known_fail_h2/matches 断言已反转为修复后口径。
//
// 2026-07-21(P2 批2 DoD-8, Bettor #ujjcz7.2 派工): marketId 换成一个干净的、跟今晚 K-18 调查
// 无关的活跃 pending_bettors 市场(原 3mzoh 是今晚 verifying 组"-2614 字节 V2/ZK 家族误判"7条真
// 开放盘之一,不适合再拿来下新注)——ext-pool-v07-1784059111477-gxrr4,目前 payout_shards 零行。
// 🔴 订正(J1 抓漏 #uj…,Bettor #uj0…裁定): non-blocking coherence gate 只挂在 ensurePayoutShard
// 的"已存在行"早返回分支,首笔下注走的是 genesis-mint(创建新行)分支,完全不碰 gate——单笔下注验
// 不到 DoD-8 要验的东西。改法(Bettor 裁定,比换市场更好,一次覆盖两条路径,成本仅 2×1 KAS):
// 同一 persona 在同一市场连下两笔——第 1 笔走 genesis-mint(冷启动创建路径),第 2 笔(下方新增
// step)payout_shards 行已存在,真正命中 non-blocking gate。两笔之间需等第 1 笔的 payout_shards
// 行落定可见(KANet-UI 执行时人工确认)。
//
// 真花测试网 KAS(小额, stakeKas=1, 同 Bettor 裁定"币充足但不必要不浪费"), 真实链上等待(~2-5min),
// skip_in_batch: true(不进批量自动跑, 手动触发)。
export default {
  id: 'bshard_single_persona_bet_journey',
  description: 'S2 首条旅程 — 同市场连下两笔真实TG下注(第1笔genesis-mint冷启动/第2笔命中K-18 coherence gate)→settler H2回归场景→/mybets断言',
  domain: 'predictions',
  tags: ['predictions', 'journey', 'real-chain', 's2'],
  skip_in_batch: true,
  steps: [
    {
      action: 'tg_place_bet',
      // step [1/2]: genesis-mint 冷启动路径(payout_shards 此时零行, ensurePayoutShard 走创建分支,
      // 不碰 gate——这一步只为准备第 2 步的前置条件, 不是 gate 验证本身)。
      marketId: 'ext-pool-v07-1784059111477-gxrr4',
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
      action: 'tg_place_bet',
      // step [2/2](DoD-8 本体): 同 persona 同市场第二笔——此时 payout_shards 行已存在(上一步创建),
      // ensurePayoutShard 走"已存在行"早返回分支,真正命中 non-blocking coherence gate。这才是
      // DoD-8 要验的那条流量,不是第 1 步。
      marketId: 'ext-pool-v07-1784059111477-gxrr4',
      side: 'YES',
      stakeKas: 1,
      expect: {
        must: {
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
          // H2 已修复且已装载(见文件头注释), 反转为修复后口径: 不再诚实标 known-fail, 直接要求
          // matches 为真。
          result_field_equals: { known_fail_h2: false, matches: true },
        },
      },
    },
  ],
};
