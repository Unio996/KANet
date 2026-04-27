// (d) 7a-2 phase γ smoke — last_reply_qty + last_reply_direction.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('7a2-gamma-' + Date.now());

export default {
  id: '_b_phase7a2_gamma_smoke',
  description: '7a-2 phase γ smoke: last_reply_qty + last_reply_direction (probe DSL aliases)',
  domain: 'broker',
  tags: ['infra', '7a-2', 'smoke', 'manual-only'],
  skip_in_batch: true,
  steps: [
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '卖 7 KAS, BSC',
      expect: {
        must: {
          last_reply_direction: 'sell',
          last_reply_qty: 7,
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
    { action: 'cleanup_peer_broker_state', peers: [peer] },
  ],
};
