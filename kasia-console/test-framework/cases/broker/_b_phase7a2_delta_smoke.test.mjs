// (d) 7a-2 phase δ smoke — offer_published / no_offer_published.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('7a2-delta-' + Date.now());

export default {
  id: '_b_phase7a2_delta_smoke',
  description: '7a-2 phase δ smoke: no_offer_published (just intent, no full flow → 0 offers expected)',
  domain: 'broker',
  tags: ['infra', '7a-2', 'smoke', 'manual-only'],
  skip_in_batch: true,
  steps: [
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '想买 5 KAS, BSC',  // intent only, no addr → no preview/finalize → no offer
      expect: {
        must: {
          // no full flow completed → exchange_offers should be 0 since test start
          no_offer_published: true,
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
    { action: 'cleanup_peer_broker_state', peers: [peer] },
  ],
};
