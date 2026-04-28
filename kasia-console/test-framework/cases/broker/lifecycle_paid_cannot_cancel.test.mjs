// Lifecycle P1: paid 后 cancel 必拒 (broker 真**真 deliver KAS, USDT 已上链)
// J1 probes.mjs lifecycle-paid-cannot-cancel (severity must)
//
// flow: seed _pendingAccepts (paid_tx) → user 'NO' → broker 拒 + 解释
// expected: 含 '已付款' / '已上链' / '无法取消' / 'broker 自动 deliver', 不含 '已取消订单'
//
// 真根因: broker-buy-handler P0-3 cancel handler 已 check paidPicks (J1+J2 合并 8c475ca95).
// 这 case 真**真 verify 真生效.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('lifecycle-paid-cancel-' + Date.now());

export default {
  id: 'lifecycle_paid_cannot_cancel',
  description: 'P1 lifecycle: paid 后 NO 必拒 cancel (broker 真**真 自动 deliver)',
  domain: 'broker',
  tags: ['regression', 'p1', 'lifecycle'],
  steps: [
    // seed _pendingAccepts with paid_tx (NWT (d) lifecycle infra ship c3c0a9ed)
    {
      action: 'seed_pending_accept',
      peer,
      data: {
        offer_id: 'test-paid-' + Date.now(),
        total_kas: 5,
        total_usdt: 0.17,
        pay_chain: 'bnb',
        give_asset: 'KAS',
        picks: [
          { qty_kas: 5, pay_usdt: 0.17, maker_payment_address: '0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe', paid_tx: '0xpaid123abc456' },
        ],
      },
    },
    // user 'NO' → broker 必须拒 cancel
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: 'NO',
      expect: {
        must: {
          // 不能 silent cancel (没 cancel 文案)
          reply_does_not_contain: ['已取消订单', '✓ 已取消'],
          // 应该明确说 paid 不能 cancel
          reply_contains_one_of: ['已付款', '已上链', '无法取消', '自动 deliver', '不能取消'],
        },
      },
    },
    { action: 'cleanup_peer_broker_state', peers: [peer] },
  ],
};
