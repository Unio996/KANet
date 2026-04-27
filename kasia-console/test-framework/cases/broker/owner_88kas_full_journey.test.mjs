// Owner 12:52-12:57 88 KAS SELL 真测 trace 完整回归
// Pre-R33 expect FAIL (broker 反方向 hallucinate). Post-R33 expect PASS.
//
// 4 个具体 bug 验证点, 任一撞墙 case fail:
//   B1 (T3 'Bsc' single token): broker 不能出 '买 .* USDT/USDC' 反方向 preview
//   B2 (T5 price query in SELL flow): broker 不能给 BUY 引导文案
//   B3 (T6 mixed addr+limit price+refund): broker 不能跨方向 + 不能忽略 user 条件
//   B4 (整体): broker 不能反复偏移到 BUY, 必须 sticky SELL

import { relayId, relayAddr, freshTestPeer } from '../../lib/peers.mjs';
import cnRealHuman from '../../personas/cn_real_human.mjs';

const peer = freshTestPeer('owner-88kas-' + Date.now());

export default {
  id: 'owner_88kas_full_journey',
  description: 'Owner 12:52-12:57 88 KAS SELL trace 全程: 杂糅/单token链/限价指令/三连纠错',
  domain: 'broker',
  tags: ['ux', 'regression', 'p0', 'owner-trace'],
  // 注入 Owner 真测真有的 long session history — 不注入 fresh peer 不复现 (false positive)
  // Owner 12:52 之前的 session 含: 04:44 BUY 1 USDC dispute, 01:23 BUY 40 KAS preview,
  // 02:32 SELL 99 KAS 反复偏移 — broker LLM 看这 history 倾向 fall BUY hallucinate
  setup: {
    actions: [
      {
        action: 'inject_history',
        peer_addr: peer,
        relay_addr: relayAddr('trader-b'),
        messages: [
          // 模拟 Owner 早期 session: BUY USDC dispute + BUY 40 KAS 完成 + SELL 99 反复
          { direction: 'inbound',  text: '想买 1 USDC, BSC, 0x0938415CFaA63DAF581366e7cB999bd591AB0C0E' },
          { direction: 'outbound', text: '📋 订单画像 (确认前)\n* 方向: 买 USDC\n* 数量: 1 USDC\n* 付款链: BNB (USDT)' },
          { direction: 'inbound',  text: 'YES' },
          { direction: 'outbound', text: '⚠️ 订单争议中, broker 已通知 Owner 人工处理.' },
          { direction: 'inbound',  text: '买kas' },
          { direction: 'outbound', text: '好的, 买 KAS. 数量多少? 哪个链?' },
          { direction: 'inbound',  text: '40个, BSC, 0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D' },
          { direction: 'outbound', text: '📋 订单画像 (确认前)\n* 方向: 买 KAS\n* 数量: 40 KAS\n* 付款链: BNB (USDT)' },
        ],
      },
    ],
  },
  steps: [
    // T1: '我想卖一点kas' → broker 应该问'想卖什么/多少'
    {
      action: 'persona_turn',
      persona: cnRealHuman,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // broker 不能在 SELL 上下文出 BUY 引导
          reply_does_not_contain: ['方向: 买', '买 USDT', '买 USDC'],
        },
      },
    },
    // T2: '卖88个Kas, 目前卖价多少钱' → broker 应该接受 SELL + 问链 (可不回答价格 — 价格属次级 issue)
    {
      action: 'persona_turn',
      persona: cnRealHuman,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          reply_does_not_contain: ['方向: 买', '买 USDT', '买 USDC', '买 88'],
        },
      },
    },
    // T3: 'Bsc' single token → 关键测试点 B1
    // pre-R33 broker 撞: 出 '订单画像 买 USDT 5 USDT' (Owner 真测真撞)
    // post-R33 broker 应该: 锁定 SELL state, 反问 user EVM 收款地址
    {
      action: 'persona_turn',
      persona: cnRealHuman,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // critical: 不能出反方向 BUY preview
          reply_does_not_contain: ['方向: 买', '买 USDT', '买 USDC', '订单画像\n\n* 方向: 买'],
        },
      },
    },
    // T4: persona 看 T3 reply 决定走 angry path 或 normal path
    // angry path: persona 发 '???我有病吗 / 我卖kas'
    // normal path: persona 发 '价格?'
    {
      action: 'persona_turn',
      persona: cnRealHuman,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          reply_does_not_contain: ['方向: 买', '买 USDT', '买 USDC'],
        },
      },
    },
    // T5: '价格?' (中途问价) → 关键测试点 B2
    // pre-R33: broker '想买告诉我数量+链' (BUY 引导文案 in SELL flow)
    // post-R33: broker 给 SELL 视角的价格 ('broker 收购价 0.0334 USDT/KAS')
    {
      action: 'persona_turn',
      persona: cnRealHuman,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // 不能给 BUY 引导文案 (现在是 SELL flow)
          reply_does_not_contain: ['想买告诉我', '买 KAS 告诉我'],
        },
      },
    },
    // T6: 杂糅 - addr+挂单价+退款条件 → 关键测试点 B3
    // pre-R33: broker 出 '订单画像 买 50 KAS' (跨方向 + 完全忽略条件)
    // post-R33: broker 应该出 SELL 88 KAS preview 含 user 条件 (限价 / 退款)
    {
      action: 'persona_turn',
      persona: cnRealHuman,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // 不能跨方向
          reply_does_not_contain: ['方向: 买', '买 50 KAS', '买 KAS', '买 USDT'],
        },
      },
    },
    // T7-T8: 兜底 — persona 给最终 addr, broker 应该出 SELL 88 KAS preview
    {
      action: 'persona_turn',
      persona: cnRealHuman,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          reply_does_not_contain: ['方向: 买', '买 88 KAS', '买 50 KAS'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
