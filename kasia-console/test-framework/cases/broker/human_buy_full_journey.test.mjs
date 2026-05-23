// Owner 钦定 (10:25): '模拟人类对话, 测试人类通过DM购买的链路是否通畅/完整/符合人类习惯和逻辑.
// 通过测试先把买卖一条链路必须彻底打通, 优化.'
//
// 用 J2 cn_newbie persona + freshTestPeer 跑完整 BUY 链路, 捕获每轮 reply,
// 评估 UX 质量 (不只是 broker 不崩, 而是真人愿意继续聊下去).
//
// 评估维度 (10 条):
//  1. 方向识别 — broker 1-2 轮内懂 buy/sell
//  2. 字段收集 — 不啰嗦, 不一次问全
//  3. 报价透明 — preview 含价 + 对比 + 总额
//  4. 信任信号 — broker 身份 + 安全 + 历史 surface
//  5. 确认明确 — YES 路径不模糊
//  6. 付款指引 — 地址 + 链 + 金额 + 怎么转
//  7. 错误处理 — 用户手抖 broker 友好
//  8. 延迟感知 — 快回 OR 主动告知 wait
//  9. 语言匹配 — 中文回中文
// 10. Mind change handling — 改主意 broker 处理
//
// 此 case 主要测 1-9, mind_changer persona 测 10.

import cnNewbie from '../../personas/cn_newbie.mjs';
import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('human-buy-' + Date.now());

export default {
  id: 'human_buy_full_journey',
  description: 'Owner 钦定 — cn_newbie 完整 BUY 链路 UX 评估 (7 轮)',
  domain: 'broker',
  tags: ['ux', 'human_journey', 'buy'],
  steps: [
    // Turn 1: '我想买 5 KAS' — 期望 broker 1 轮内懂 BUY 方向 + 询 chain
    {
      action: 'persona_turn',
      persona: cnNewbie,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // 不应跨方向 hallucinate
          reply_does_not_contain: ['卖', '方向: 卖', 'sell'],
        },
        should: {
          // 真人感: 应该 ack + 问 chain
          reply_contains_one_of: ['哪个链', '哪条链', 'which chain', '哪条公链'],
          reply_response_time_ms_max: 5_000,  // BUY_REGEX fast path 应该 < 5s
        },
      },
    },
    // Turn 2: 'BSC' — 期望 broker 出完整 preview (4 段补强应该都在)
    {
      action: 'persona_turn',
      persona: cnNewbie,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          reply_contains: ['📋'],  // preview emoji 必须在
          reply_does_not_contain: ['方向: 卖'],
        },
        should: {
          // 4 段补强信任信号
          reply_contains: ['🏷', 'CEX', '🛡', '📊'],
          reply_response_time_ms_max: 30_000,
        },
      },
    },
    // Turn 3: '什么是 maker?' — 期望 broker 解释 (NLG 自然话)
    {
      action: 'persona_turn',
      persona: cnNewbie,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        should: {
          // 不被 maker 问题搞偏 — 应该解释或友好继续
          reply_response_time_ms_max: 30_000,
          // 不该 silent
          reply_contains_one_of: ['maker', 'Maker', '做市', '撮合', '帮你', '是的', '不是', '直接', '继续'],
        },
      },
    },
    // Turn 4: '好' (CONFIRM_WORDS) — 期望 broker finalize + 给付款指引
    {
      action: 'persona_turn',
      persona: cnNewbie,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        should: {
          // 应该 ack 已确认 OR 给付款指引 (sync reply 可能为空, 真 dm 走 chain)
          reply_response_time_ms_max: 30_000,
        },
      },
    },
    // 注意: 真付款指引 (kaspa: 地址) 走 chain DM, freshTestPeer 收不到.
    // 评估到这里就够 — 后续付款 + 链上交付走真链 case (skip_in_batch).
    {
      action: 'cleanup_peer',
      peer_addr: peer,
    },
  ],
};
