// mind_changer persona — BUY 10 KAS → 看 preview → 改主意 SELL 3 KAS
// 测 broker 真 reset _pendingFields/_pendingPreview state, fresh 'sell' direction 真 override prev 'buy'

import { relayId, freshTestPeer } from '../../lib/peers.mjs';
import mindChanger from '../../personas/mind_changer.mjs';

const peer = freshTestPeer('mind_changer_' + Date.now());

export default {
  id: 'persona_mind_changer_buy_to_sell',
  description: 'BUY 10 KAS preview → change mind to SELL 3 KAS — broker must reset state cleanly',
  domain: 'broker',
  steps: [
    // turn 1: BUY 10 KAS
    {
      action: 'persona_turn',
      persona: mindChanger,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          reply_does_not_contain: ['卖', 'sell'],
        },
      },
    },
    // turn 2: BSC → BUY preview
    {
      action: 'persona_turn',
      persona: mindChanger,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // 应该出 BUY preview 含 10 KAS
          reply_contains_one_of: ['10 KAS', '订单画像', 'preview'],
        },
      },
    },
    // turn 3: '不要了, 卖 3 KAS, BSC, 0x9405...' — 改主意!
    {
      action: 'persona_turn',
      persona: mindChanger,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // broker 应该出 SELL preview 含 3 KAS, 不能保留旧 BUY 10 KAS
          reply_does_not_contain: ['10 KAS', '买 10', 'buy 10'],
        },
        should: {
          reply_contains_one_of: ['卖', 'sell', '3 KAS'],
        },
      },
    },
  ],
};
