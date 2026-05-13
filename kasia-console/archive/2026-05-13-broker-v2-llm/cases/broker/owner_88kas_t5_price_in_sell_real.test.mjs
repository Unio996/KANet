// Owner T5 follow-up: SELL flow 中 user 问 '价格?' broker 应**正面回应** broker 收购价
// NWT 22:08 audit GAP A: 现 R33 wire 在 SELL flow gate PRICE_QUERY 不发 BUY 引导,
// 但 broker reply EMPTY = 沉默 ≠ Owner 期望 'broker 给我个收购价'.
//
// pre-fix expect: FAIL (broker reply empty 反 gaming)
// post product fix expect: PASS (broker 给 SELL 视角价格 'broker 收购价 X.XXXX USDT/KAS')

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('t5-price-in-sell-' + Date.now());

export default {
  id: 'owner_88kas_t5_price_in_sell_real',
  description: 'Owner T5: SELL flow 中问价 broker 必须正面回 broker 收购价 (反 reply-empty gaming)',
  domain: 'broker',
  tags: ['ux', 'regression', 'p0', 'owner-trace', 'product-gap', 'follow-up'],
  steps: [
    // T1-T2 setup SELL flow
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '我想卖一点kas',
    },
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '卖88个Kas',
    },
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: 'Bsc',
    },
    // T5 价格? — 关键测试点
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '价格?',
      expect: {
        must: {
          // 不能给 BUY 引导 (B2 R33 修了)
          reply_does_not_contain: ['想买告诉我', '例: "买 '],
          // 不能空回 (反 gaming)
          reply_contains_one_of: ['broker 收购价', '收购价', '现价', 'KAS/USDT', 'USDT/KAS'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
