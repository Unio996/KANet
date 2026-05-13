// Bug-Z9 regression: broker must remember 'sell 4 KAS, BSC, 0x...' across turns
// when user follows up with single-token next msg.
//
// History root: J1 09:21 Eric SELL test stuck on 'BSC' single-token reply 18+min
//               J2 cn_newbie persona caught same multi-turn state loss.
// Fix: J2 d843a16ed deterministic _pendingFields cross-turn state in broker-llm-agent.js.
//
// This case feeds Eric's exact failing pattern through /api/agent/reply (sync only,
// no real chain) and verifies broker doesn't go silent or hallucinate after follow-up.

import { relayAddr, relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('bug-z9-sell-' + Date.now());

export default {
  id: 'multi_turn_sell_state_persists',
  description: 'Bug-Z9 regression: SELL request fields persist across turns (no silent / no hallucinate)',
  domain: 'broker',
  steps: [
    {
      // Turn 1: explicit SELL request
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      // T-J2-2026-05-10 SC3b (triage T3): qty 5→200 KAS — 跟 production T2.10b minPracticalQty=100 align。
      // 本意 Bug-Z9 SELL request fields persist 跨 turn (qty 数字非 sacred)。
      message: '我要卖 200 KAS, BSC 链',
      expect: {
        must: {
          // broker must NOT cross-direction hallucinate
          reply_does_not_contain: ['买 ', 'buy ', '方向: 买'],
        },
        should: {
          reply_response_time_ms_max: 30_000,
          // ideally broker confirms SELL direction
          reply_contains_one_of: ['卖', 'sell', '收款', '收 USDT', '地址'],
        },
      },
    },
    {
      action: 'sleep',
      ms: 1500,
    },
    {
      // Turn 2: follow-up provides ONLY the missing addr
      // Pre Bug-Z9: broker would lose 'sell 5 KAS BSC' context, ask 方向 again or silent
      // Post fix: _pendingFields merges this addr into prior {direction, qty, chain} → preview triggers
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74',
      expect: {
        must: {
          // most important: broker must NOT be silent (Bug-Z9 root)
          reply_contains_one_of: [
            '订单画像', '卖单画像',  // preview generated
            '已确认', '请确认',         // confirmation step
            '收到',                      // ack
          ],
          // and must NOT lose context (ask qty/direction again)
          reply_does_not_contain: ['多少 KAS', '买还是卖', '方向?'],
        },
      },
    },
    {
      action: 'cleanup_peer',
      peer_addr: peer,
    },
  ],
};
