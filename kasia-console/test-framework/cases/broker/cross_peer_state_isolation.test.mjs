// 路 A: cross-peer state Map keyed isolation (sequential 交错验证)
// Owner 16:50 提醒: 早期撞过 LLM 跨 peer 串话, kasia 地址做 state key 锁身份是 KANet 天然机制.
// NWT 22:12 309f7ce2 ack A+B 拆法, A 先 ship.
//
// 测什么:
//   架构上 broker 状态 Map 真 keyed by peer address (R33 _convoState / _pendingFields / _pendingPreview / _pendingAccepts)
//   两 peer 交错 DM, 各自 state 独立, broker reply 不串 (A 收到 SELL preview 不含 B 的 BUY 信号, 反之亦然)
//
// 测不了什么 (留路 B):
//   真并发 (Promise.all) Map.set/get race condition
//   broker-action-queue concurrent 抢锁
//   setConvoStateLock TOCTOU
//
// 失败暴露 bug 类:
//   "broker 某个 cache 漏了 peer key" (e.g. 某 Map 用 latest peer 当 key 而不是 per-peer)
//   "broker reply 真**真**真 mix 两 peer 的 fields" (A 收到 B 的 qty / addr / direction)

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peerA = freshTestPeer('cross-peer-A-' + Date.now());
const peerB = freshTestPeer('cross-peer-B-' + Date.now());
const ADDR_A = '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74';

export default {
  id: 'cross_peer_state_isolation',
  description: '两 peer 交错 DM, broker state Map 严格 keyed by address, reply 不串',
  domain: 'broker',
  tags: ['regression', 'p0', 'cross-peer', 'state-isolation', 'owner-reminder'],
  steps: [
    // T1: peer A 起 SELL flow → broker 应该锁 _convoState[A] direction='sell'
    {
      action: 'send_message',
      from_peer: peerA,
      to_relay_id: relayId('trader-b'),
      message: '卖 5 KAS, BSC',
      expect: {
        must: {
          // A 应该走 SELL flow
          reply_does_not_contain: ['方向: 买', '买 KAS', '买 5 KAS'],
        },
      },
    },
    // T2: peer B 起 BUY flow → broker 应该锁 _convoState[B] direction='buy', 不应碰 _convoState[A]
    {
      action: 'send_message',
      from_peer: peerB,
      to_relay_id: relayId('trader-b'),
      message: '想买 3 KAS, BSC',
      expect: {
        must: {
          // B 应该走 BUY flow, 不能串 A 的 SELL signals (qty=5 / direction=sell)
          reply_does_not_contain: ['方向: 卖', '卖 KAS', '5 KAS', '卖 3 KAS'],
        },
      },
    },
    // T3: peer A 接续给 EVM addr → broker 从 _convoState[A] 拿 SELL 上下文出 SELL preview
    // 关键: 不能从 _convoState[B] 拉 BUY 上下文 (B 没给 addr, 但 B 在 BUY KAS flow)
    {
      action: 'send_message',
      from_peer: peerA,
      to_relay_id: relayId('trader-b'),
      message: ADDR_A,
      expect: {
        must: {
          // A 自己 SELL preview, 不串 B 的 BUY 3 KAS
          reply_does_not_contain: ['方向: 买', '买 3 KAS', '买 KAS'],
        },
        should: {
          // 出来的应该是 A 的 SELL preview
          reply_contains_one_of: ['卖单画像', '方向: 卖', '5 KAS'],
        },
      },
    },
    // T4: peer B 给数量补全 → broker 应该出 B 的 BUY preview, 不串 A 的 SELL/0x...
    // NWT 22:17 audit GAP: 加固 assertion 抓 same-peer direction hallucinate (Bug-Z13 候选)
    {
      action: 'send_message',
      from_peer: peerB,
      to_relay_id: relayId('trader-b'),
      message: '3 KAS BSC',
      expect: {
        must: {
          // 不能串 A 的 SELL signals or A 的 EVM addr (cross-peer)
          // 不能 B 自己 hallucinate 反方向 (same-peer Bug-Z13, R33 b iter5b 修透)
          // NWT 363b53b7 audit: 删 '卖 5 KAS' (broker fallback hint 字面会撞 false pos),
          // 留 '卖 3 KAS' (peer B own qty 反方向 = 真 hallucinate signal)
          reply_does_not_contain: [
            '方向: 卖', '0x94053e04', ADDR_A,
            '卖 3 KAS', '你想卖',  // same-peer: peer B 是 BUY flow, broker 任何 SELL 引导 = hallucinate
          ],
          // 强制 BUY direction reflection
          reply_contains_one_of: ['买', 'BUY', '想买', '付 USDT', 'pay USDT'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peerA },
    { action: 'cleanup_peer', peer_addr: peerB },
  ],
};
