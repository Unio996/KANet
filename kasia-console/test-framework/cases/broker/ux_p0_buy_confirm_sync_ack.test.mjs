// UX P0-4 regression: BUY CONFIRM 后 sync 必有 ack (J1 98534255 fix)
// Pre-fix: 用户 '好' → broker sync 0 字节 → 用户疑神疑鬼又发别的话 → 触发 CANCEL bug
// Post-fix: '好' → broker sync 立即 '✓ 收到, 订单已建 #xxx, 付款指引马上发你'

import cnNewbie from '../../personas/cn_newbie.mjs';
import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('ux-p04-' + Date.now());

export default {
  id: 'ux_p04_buy_confirm_sync_ack',
  description: 'P0-4: BUY CONFIRM "好" 必有 sync ack (不能空回让用户疑神疑鬼)',
  domain: 'broker',
  tags: ['ux', 'regression', 'p0'],
  steps: [
    // T1: 想买 5 KAS
    { action: 'persona_turn', persona: cnNewbie, from_peer: peer, to_relay_id: relayId('trader-b') },
    // T2: BSC → preview
    { action: 'persona_turn', persona: cnNewbie, from_peer: peer, to_relay_id: relayId('trader-b') },
    // T3: 问 maker
    { action: 'persona_turn', persona: cnNewbie, from_peer: peer, to_relay_id: relayId('trader-b') },
    // T4: '好' CONFIRM — 必须 sync ack
    {
      action: 'persona_turn',
      persona: cnNewbie,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // sync reply 不能空 (P0-4 核心)
          reply_contains_one_of: ['收到', '已建', '订单', '确认', '付款', '马上'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
