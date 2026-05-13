// UX P0-2 regression: SELL '好' 必识别为 CONFIRM, 跟 BUY 对齐 (J2 自接 Bug-Z13?)
// Pre-fix: SELL Turn 4 '好' → broker 复读 preview, '好' 没被识别为 CONFIRM
// Post-fix: SELL handler CONFIRM_WORDS 加 '好' / '对' / '是' / 'OK' 全套

import sellNewbie from '../../personas/cn_newbie_sell.mjs';
import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('ux-p02-' + Date.now());

export default {
  id: 'ux_p02_sell_confirm_words',
  description: 'P0-2: SELL "好" 必识别为 CONFIRM (跟 BUY 一致)',
  domain: 'broker',
  tags: ['ux', 'regression', 'p0'],
  steps: [
    { action: 'persona_turn', persona: sellNewbie, from_peer: peer, to_relay_id: relayId('trader-b') },
    { action: 'persona_turn', persona: sellNewbie, from_peer: peer, to_relay_id: relayId('trader-b') },
    { action: 'persona_turn', persona: sellNewbie, from_peer: peer, to_relay_id: relayId('trader-b') },
    // T4: '好' CONFIRM SELL — 必须 sync ack, 不能复读 preview
    {
      action: 'persona_turn',
      persona: sellNewbie,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // 不能完整复读 preview
          reply_does_not_contain: ['📋 **卖单画像 (确认前)**'],
        },
        should: {
          reply_contains_one_of: ['收到', '已建', '订单', '确认', 'KAS 给', '请转'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
