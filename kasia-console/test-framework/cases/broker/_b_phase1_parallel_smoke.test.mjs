// (d) B phase 1 smoke — verify parallel action works (concurrent 2 peers, both get reply).
// 真测最小验: parallel infra OK, 2 peer 同时打 broker 都拿 reply, 不串.
// 不深测 race condition (留 phase 2 加 state assertions). skip_in_batch (only 手动).

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peerA = freshTestPeer('b1-smoke-A-' + Date.now());
const peerB = freshTestPeer('b1-smoke-B-' + Date.now());

export default {
  id: '_b_phase1_parallel_smoke',
  description: 'B phase 1 smoke: parallel action 2-peer concurrent send works',
  domain: 'broker',
  tags: ['infra', 'b-phase', 'smoke', 'manual-only'],
  skip_in_batch: true,  // manual smoke only, batch run skip
  steps: [
    {
      action: 'parallel',
      actions: [
        { action: 'send_message', from_peer: peerA, to_relay_id: relayId('trader-b'), message: '买 5 KAS, BSC' },
        { action: 'send_message', from_peer: peerB, to_relay_id: relayId('trader-b'), message: '卖 3 KAS, BSC' },
      ],
    },
    { action: 'cleanup_peer', peer_addr: peerA },
    { action: 'cleanup_peer', peer_addr: peerB },
  ],
};
