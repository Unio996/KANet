// UX P0-3 regression: 用户 confirm 后 NO 必能取消 (J1 98534255 fix)
// Pre-fix: '好' 后建订单 → 'NO' 被 _pendingAccepts 已建状态拦截 → 'active 订单先完成或等 30min 过期'
// Post-fix: 'NO' 应清除 _pendingAccepts + 取消订单

import cnNewbie from '../../personas/cn_newbie.mjs';
import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('ux-p03-' + Date.now());

export default {
  id: 'ux_p03_cancel_after_confirm',
  description: 'P0-3: confirm 后 user 想取消 (NO/算了) 必能取消, 不被 active order 拦',
  domain: 'broker',
  tags: ['ux', 'regression', 'p0'],
  steps: [
    { action: 'persona_turn', persona: cnNewbie, from_peer: peer, to_relay_id: relayId('trader-b') },
    { action: 'persona_turn', persona: cnNewbie, from_peer: peer, to_relay_id: relayId('trader-b') },
    { action: 'persona_turn', persona: cnNewbie, from_peer: peer, to_relay_id: relayId('trader-b') },
    // T4: 好 = confirm
    { action: 'persona_turn', persona: cnNewbie, from_peer: peer, to_relay_id: relayId('trader-b') },
    // T5: 用户改主意取消 (绕过 persona, 直接 send)
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '算了 NO',
      expect: {
        must: {
          // 必须明确表示已取消, 不能拒
          reply_does_not_contain: ['先完成或等', '30min 过期', '已有.*active'],
          reply_contains_one_of: ['已取消', '取消成功', '已撤回', 'cancelled', 'cancel'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
