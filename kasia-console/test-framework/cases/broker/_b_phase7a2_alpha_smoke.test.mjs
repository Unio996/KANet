// (d) 7a-2 phase α smoke — direction_must_match + asset_must_match assertions.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('7a2-alpha-' + Date.now());

export default {
  id: '_b_phase7a2_alpha_smoke',
  description: '7a-2 phase α smoke: direction_must_match + asset_must_match parse last reply',
  domain: 'broker',
  tags: ['infra', '7a-2', 'smoke', 'manual-only'],
  skip_in_batch: true,
  steps: [
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '卖 5 KAS, BSC',
      expect: {
        must: {
          // T1 reply expected: 'Got it, sell 5 KAS, BNB. Your EVM wallet address (0x... 42 chars)?'
          direction_must_match: 'sell',
          asset_must_match: 'KAS',
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
    { action: 'cleanup_peer_broker_state', peers: [peer] },
  ],
};
