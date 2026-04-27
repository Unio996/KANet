// Bug-Z6 regression case (J1 09:08 真测撞 + NWT d44a29691 fix + Bug-Z7 615945e69 fix).
// 真 simulates Eric SELL flow with stale BUY history → broker must NOT cross-asset hallucinate.

import { relayAddr, relayId } from '../../lib/peers.mjs';

const ericSim = `kaspa:qbugz6sim${Math.random().toString(36).slice(2, 50)}`;

export default {
  id: 'sell_kas_no_buy_hallucinate',
  description: 'SELL request with stale BUY history must not become BUY (Bug-Z6)',
  domain: 'broker',
  setup: {
    actions: [
      {
        action: 'inject_history',
        peer_addr: ericSim,
        relay_addr: relayAddr('trader-b'),
        messages: [
          { direction: 'inbound', text: '想买 1 USDC, BSC' },
          { direction: 'outbound', text: '好的, 买 1 USDC. 用哪个链 付 USDT?' },
        ],
      },
    ],
  },
  steps: [
    {
      action: 'send_message',
      from_peer: ericSim,
      to_relay_id: relayId('trader-b'),
      message: '卖 5 KAS, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74',
      expect: {
        must: {
          // Must NOT generate BUY USDC preview from stale history (Bug-Z6 regression)
          reply_does_not_contain: ['买 1 USDC', '买 USDC', '方向: 买', 'buy 1 USDC', 'buy USDC'],
        },
        should: {
          // Soft target — broker reply within 30s (LLM is slow today, but improving)
          reply_response_time_ms_max: 30_000,
        },
      },
    },
  ],
};
