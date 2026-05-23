// multi_turn_context_retention — Owner 04-29 真测撞 5 P0 bug 复刻 framework regression
//
// Owner 钦定 4 铁律 (21:40 broadcast):
// 1. 好用 broker 一定知道用户想要什么 (intent understand)
// 2. R33 拦截不应反馈到用户界面 (internal only)
// 3. broker 应知道之前用户说过什么, 不能忘记 (context retention sticky)
// 4. 对话状态不应中断, 这是系统设计缺陷
//
// 真 production scenario (Owner 21:23-21:31 真测):
//   T1 OWNER: 我想卖一点kas
//   T2 OWNER: 50 个
//   T3 OWNER: Bsc, 0x1417cfDaD...
//   T4 OWNER: Yes, 卖出价格你建议多少?  ← 复合 intent (confirm + question)
//   T5 OWNER: 按市价
//   T6 OWNER: 1
//   T7 OWNER: 我给你说过了, 你不能自己看一下?  ← Owner 火大
//
// Owner 真测撞:
//   - 21:28:09 broker 莫名英文 'Got it, what do you want to sell'
//   - 21:29:57 broker 'R33 内部拦截' 拒 user
//   - 21:30:34 broker '没有找到您之前的活跃订单' state 全丢
//   - broker 反复问已给 fields (50 KAS / BSC / 0x1417...)

import { freshTestPeer, relayAddr, relayId } from '../../lib/peers.mjs';

const peer = freshTestPeer('multi-turn-context-retention-' + Date.now());

export default {
  id: 'multi_turn_context_retention',
  description: 'Owner 04-29 真测复刻: 复合 intent + 中文 only + R33 不外显 + state 不中断 + context 不忘 (Owner 4 铁律)',
  domain: 'broker',
  tags: ['regression', 'production', 'owner-real-test', 'phase-e'],
  steps: [
    // T1: SELL intent
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '我想卖一点kas',
      expect: {
        must: {
          // Owner 铁律 #2: R33 不外显 + 中文铁律: 不切英文
          reply_does_not_contain: ['R33', 'R31', 'R19', '内部拦截', '输出异常', 'Got it', 'what do you want', 'How many'],
          // Owner 铁律 #1: broker 知 user 想卖
          reply_contains_one_of: ['卖', '想卖', 'sell', '卖什么', '多少'],
        },
      },
    },
    { action: 'sleep', ms: 1500 },
    // T2: 数量 200 (T-J2-2026-05-10 SC2b: qty 50→200 align T2.10b minPracticalQty=100)
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '200 个',
      expect: {
        must: {
          reply_contains_one_of: ['200', 'KAS', '链', '地址'],
          reply_does_not_contain: ['R33', '内部拦截', 'Got it', 'what do you'],
        },
      },
    },
    { action: 'sleep', ms: 1500 },
    // T3: 链 + 地址
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: 'Bsc, 0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D',
      expect: {
        must: {
          // Owner 铁律 #3: broker 不忘 context — reply 必含之前给的 fields (200 / BSC / 地址)
          reply_contains_one_of: ['200', '卖单画像', 'preview', 'BSC', '画像'],
          reply_does_not_contain: ['R33', '内部拦截', 'Got it', 'what do you'],
        },
      },
    },
    { action: 'sleep', ms: 1500 },
    // T4: 复合 intent — confirm + question
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: 'Yes, 卖出价格你建议多少?',
      expect: {
        must: {
          // Owner 铁律 #2: R33 不外显
          reply_does_not_contain: ['R33', '内部拦截', '输出异常', '回 NO 取消'],
          // Owner 铁律 #4: state 不中断 — broker 处理 confirm + 答 question (不 reset)
          reply_contains_one_of: ['市价', '不提供', '建议', 'spread', 'preview', '画像', 'YES'],
        },
      },
    },
    { action: 'sleep', ms: 1500 },
    // T5: 按市价
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '按市价',
      expect: {
        must: {
          // Owner 铁律 #3+4: state retention sticky — 不 reset, 不 wipe context
          reply_does_not_contain: ['R33', '内部拦截', '输出异常', '没有找到您之前的活跃订单', '请重新提供'],
          reply_contains_one_of: ['preview', '画像', '200', 'YES', '锁单', '确认'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
