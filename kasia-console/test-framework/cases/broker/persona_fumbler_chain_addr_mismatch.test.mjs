// fumbler persona — EVM 地址 (0x...) 给 SOL 链, 测 broker 真验 chain ↔ addr 配
// 真 broker 应该拒绝 ('SOL 地址应是 base58 不是 0x...'), 不能编 preview 把错配当对

import { relayId, freshTestPeer } from '../../lib/peers.mjs';
import fumbler from '../../personas/fumbler.mjs';

const peer = freshTestPeer('fumbler_' + Date.now());

export default {
  id: 'persona_fumbler_chain_addr_mismatch',
  description: 'fumbler gives EVM 0x addr on SOL chain — broker must reject with clear error, not generate preview',
  domain: 'broker',
  steps: [
    // turn 1: '卖 5 KAS, SOL 链收 USDT, 地址 0x9405...'
    {
      action: 'persona_turn',
      persona: fumbler,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // critical: broker 真不能出 preview 含 0x 地址 + SOL 链 (真灾难 — user 转钱到错链/错地址)
          // 真 broker 应该指出格式错 (含'格式不对'/'invalid'/'地址错'/'SOL 地址')
          reply_does_not_contain: ['订单画像', '卖单画像', 'YES'],
        },
      },
    },
  ],
};
