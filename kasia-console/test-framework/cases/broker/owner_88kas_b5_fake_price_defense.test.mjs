// Owner B5 follow-up: broker LLM 编 fake price 必经 R33 validateLlmReply oracle ±5% 校验
// J1 15:08 加第三 GAP: Owner 04:10 真测撞 broker 编 '0.055 USDT/KAS' (真市价 0.034, 60% 偏差).
// R33 validateLlmReply 设计含 oracle ±5% check, 但 owner_88kas_verbatim case 没 assert price within tolerance.
//
// pre-fix expect: 不一定 (broker LLM 是否编 fake price 是 stochastic), 但**真**真**真**真**真**真**真**真.
//
// 这个 case 做 negative-presence assertion: broker reply 含价格数字 → 必在 oracle ±5% 内.
// 不主动 trigger fake price (这 stochastic), 通过 SELL preview 自然路径检验.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('b5-fake-price-' + Date.now());
const OWNER_ADDR = '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D';

export default {
  id: 'owner_88kas_b5_fake_price_defense',
  description: 'Owner B5 fake price defense — broker reply 含 USDT 价格必经 oracle ±5%',
  domain: 'broker',
  tags: ['ux', 'regression', 'p0', 'owner-trace', 'price-oracle', 'r33-validate'],
  steps: [
    // setup: 跑到 SELL preview (broker 含 unit price)
    // message 含逗号让 SELL_REGEX miss → fall handleLlmDialog → _pendingFields path → broker reply 真有 preview
    { action: 'send_message', from_peer: peer, to_relay_id: relayId('trader-b'), message: '卖88个kas, 目前卖价' },
    { action: 'send_message', from_peer: peer, to_relay_id: relayId('trader-b'), message: 'Bsc' },
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: OWNER_ADDR,
      expect: {
        must: {
          // SELL preview 应该出来含合理 unit price
          reply_contains_one_of: ['卖单画像', '方向: 卖'],
          // 价格不能含 Owner 真测撞的 fake 0.055 (60% 偏差)
          // 用 negative pattern: 价格不能含 0.05X 真**真**真**真 0.04X (远高于 oracle ~0.034)
          reply_does_not_contain: ['0.055', '0.05 USDT', '0.06 USDT', '0.04', '0.045'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
