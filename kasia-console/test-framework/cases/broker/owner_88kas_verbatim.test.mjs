// Owner 12:52-12:57 88 KAS SELL 真测 8-turn verbatim port (sacred regression)
// Owner 14:08 钦定: '把测试方式方法方案更上一个台阶' + '反复真实测试通过后才交付'
//
// 每 turn user msg 跟 Owner 真测一字不差。每 turn assertion 检查 broker reply
// 不能 hallucinate 反方向 (B1/B3/B6) / 不能 BUY 引导文案 (B2) / 不能编 fake price (B5).
//
// pre-R33: Owner 真测撞 4-6 个 P0 bug, case expect FAIL
// post-R33 (commit 371e4ca6 wire + b2de4cc7 lint phase 2): expect ALL PASS reproduce
//
// 真测限制: framework synthetic peer 没 in-memory cross-peer state. case 注入
// shallow inject_history 模拟 multi-turn, 真 production state replay 真 NWT (d) v2 #6.

import { relayId, relayAddr, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('owner-88kas-verbatim-' + Date.now());
const TRADER_B_ADDR = relayAddr('trader-b');
const OWNER_ADDR = '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D';

export default {
  id: 'owner_88kas_verbatim',
  description: 'Owner 12:52-12:57 88 KAS SELL 真测 8-turn verbatim port (sacred regression)',
  domain: 'broker',
  tags: ['ux', 'regression', 'p0', 'owner-trace', 'sacred'],
  // T-J2-2026-05-11 ABE-close B.5 (NWT #30 Owner ack): historical reproducer tag
  // 跟 post-Sophie sediment 冲突 (5/9 T2.10b broker-sell-handler minPracticalQty=100 → qty=88 reject)。
  // verbatim 不动 (Owner 真测复刻 sacred), runner 不计入 DoD 主统计, divergence_reason 输出说明。
  // historical: true 跟 known-flaky 不同 — 后者隐藏 alternation, 前者显式 surface 产品演进痕迹。
  historical: true,
  divergence_reason: 'post-Sophie sediment 5/9: broker-sell-handler.js minPracticalQty=100 KAS rejects qty=88 as qty_too_small. Verbatim reproducer preserved for incident history, not active assertion. Production accepts qty>=100 KAS, fixture qty=88 is verbatim from Owner 5/x real test trace.',
  divergence_since: '5/9',
  steps: [
    // T1 — 模糊宣告
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '我想卖一点kas',
      expect: {
        must: {
          // broker 应该问 'what / how much', 不出 BUY preview
          reply_does_not_contain: ['方向: 买', '订单画像\n\n* 方向: 买'],
          reply_contains_one_of: ['卖', '想卖', 'sell', '什么', '多少'],
        },
      },
    },
    // T2 — qty + 中途问价
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '卖88个Kas，目前卖价多少钱',
      expect: {
        must: {
          reply_does_not_contain: ['方向: 买', '买 88', '买 USDT'],
        },
      },
    },
    // T3 — single token chain (Owner 真测撞 B1: 'Bsc' → 买 USDT 5 USDT preview)
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: 'Bsc',
      expect: {
        must: {
          // CRITICAL: broker 不能在 SELL flow 中出 BUY preview (B1 fix R33)
          reply_does_not_contain: ['方向: 买', '买 USDT', '买 USDC', '买 5 USDT', '订单画像\n\n* 方向: 买'],
        },
      },
    },
    // T4 — 怒骂 + 重申方向
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '？？？我有病吗\n我卖kas',
      expect: {
        must: {
          reply_does_not_contain: ['方向: 买', '买 USDT', '买 USDC'],
        },
      },
    },
    // T5 — 中途问价 (Owner 真测撞 B2: SELL flow 中给 BUY 引导文案)
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '价格？',
      expect: {
        must: {
          // broker 不能给 'BUY 引导' (e.g. '想买告诉我数量+链' / '买 50 KAS' 例子) — B2 fix R33
          reply_does_not_contain: ['想买告诉我', '例: "买 ', '买 50 KAS'],
        },
      },
    },
    // T6 — 杂糅 addr+限价+退款条件 (Owner 真测撞 B3: 跨方向 + 忽略 user 条件 → '买 50 KAS')
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: `${OWNER_ADDR}，我想挂单价格设定0.0336。如果10分钟内没人吃单，麻烦帮我把Kas原路返回。`,
      expect: {
        must: {
          // CRITICAL: broker 不能跨方向 + 不能忽略限价指令
          reply_does_not_contain: ['方向: 买', '买 50 KAS', '买 KAS', '买 USDT'],
        },
      },
    },
    // T7 — 怒骂方向 (Owner 真测撞 B4: 反复偏移)
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '我卖Kas，不是买！你分不清楚买卖吗？',
      expect: {
        must: {
          reply_does_not_contain: ['方向: 买', '买 88 KAS', '买 50 KAS', '买 USDT'],
        },
      },
    },
    // T8 — 给 addr → expect SELL preview ✓
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: OWNER_ADDR,
      expect: {
        must: {
          // 应该出 SELL preview 88 KAS
          reply_does_not_contain: ['方向: 买', '买 88 KAS'],
          reply_contains_one_of: ['卖单画像', '方向: 卖', 'SELL preview'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
