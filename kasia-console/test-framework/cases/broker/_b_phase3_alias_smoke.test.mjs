// (d) B phase 3 smoke — alias 解析层 (Sophie/Eric → freshTestPeer, broker → trader-b relay id)
// J1 30 adversarial probes 用此 schema, phase 3 让现 framework 能跑 probe 风格的 case.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const SOPHIE = freshTestPeer('alias-sophie-' + Date.now());
const ERIC = freshTestPeer('alias-eric-' + Date.now());

export default {
  id: '_b_phase3_alias_smoke',
  description: 'B phase 3 smoke: alias 解析层 (Sophie/Eric/broker)',
  domain: 'broker',
  tags: ['infra', 'b-phase', 'smoke', 'manual-only'],
  skip_in_batch: true,
  aliases: {
    Sophie: { peer: SOPHIE },
    Eric: { peer: ERIC },
    broker: { relay_id: relayId('trader-b') },
  },
  steps: [
    {
      action: 'parallel',
      actions: [
        { action: 'send_message', from_alias: 'Sophie', to_alias: 'broker', message: '买 5 KAS, BSC' },
        { action: 'send_message', from_alias: 'Eric', to_alias: 'broker', message: '卖 3 KAS, BSC' },
      ],
      expect: {
        must: {
          no_state_corruption: {
            peers: [
              { addr: SOPHIE, want_qty: 5, want_direction: 'buy' },
              { addr: ERIC, want_qty: 3, want_direction: 'sell' },
            ],
          },
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: SOPHIE },
    { action: 'cleanup_peer', peer_addr: ERIC },
  ],
};
