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
    // T-J2-2026-05-11 ABE-close α (NWT #27 spec): assertion 精准化排除 noise。
    // 旧 ['卖', 'sell'] 单 char 误抓 broker 合法 counterparty mention '卖家/seller'。
    // 新 specific phrase — broker cross-direction hallucinate evidence ('方向: 卖' preview header / '卖单' direction misroute / '想卖' NLU 误归 / 'SELL ' label / '卖出 10' direction+qty combo)。
    {
      action: 'persona_turn',
      persona: mindChanger,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          reply_does_not_contain: ['方向: 卖', '卖单', '想卖', '正在卖', 'SELL ', '卖出 10'],
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
    // T-J2-2026-05-11 ABE-close α (NWT #27 spec):
    // (1) reply_does_not_contain phrase 精准化 — catch BUY state 残留 specific evidence
    // (2) should → must 升级 — Owner 钦定 deterministic fix, broker 必 reset state + 出 SELL preview
    {
      action: 'persona_turn',
      persona: mindChanger,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // broker 应该出 SELL preview 含 3 KAS, 不能保留旧 BUY 10 KAS — BUY direction phrase specific
          reply_does_not_contain: ['方向: 买', '10 KAS', 'BUY 10', '买入 10', '想买 10'],
          // SELL preview 必出 specific 证据 (was should warn, 升级 must per NWT #27 deterministic close 条件)
          reply_contains_one_of: ['卖单画像', '卖 200 KAS', 'SELL 200', '200 KAS BSC', 'sell 200'],
        },
      },
    },
  ],
};
