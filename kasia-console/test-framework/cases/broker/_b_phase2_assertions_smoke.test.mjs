// (d) B phase 2 smoke — verify state assertions on parallel result.
// 真测最小验: parallel 跑 2 peer → no_state_corruption + each_peer_distinct_offer + no_amount_swap + no_address_swap 都跑.
// expect PASS (架构隔离 OK), 真有 cross-peer leak 才 FAIL.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peerA = freshTestPeer('b2-smoke-A-' + Date.now());
const peerB = freshTestPeer('b2-smoke-B-' + Date.now());
const ADDR_A = '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74';
const ADDR_B = '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D';

export default {
  id: '_b_phase2_assertions_smoke',
  description: 'B phase 2 smoke: state assertions on parallel result (cross-peer isolation)',
  domain: 'broker',
  tags: ['infra', 'b-phase', 'smoke', 'manual-only'],
  skip_in_batch: true,
  steps: [
    {
      action: 'parallel',
      actions: [
        { action: 'send_message', from_peer: peerA, to_relay_id: relayId('trader-b'), message: '卖 5 KAS, BSC, ' + ADDR_A },
        { action: 'send_message', from_peer: peerB, to_relay_id: relayId('trader-b'), message: '买 3 KAS, BSC' },
      ],
      expect: {
        must: {
          no_state_corruption: {
            peers: [
              { addr: peerA, want_qty: 5, want_direction: 'sell' },
              { addr: peerB, want_qty: 3, want_direction: 'buy' },
            ],
          },
          each_peer_distinct_offer: true,
          no_amount_swap: {
            peers: [
              { addr: peerA, own_qty: 5, foreign_qtys: [3] },
              { addr: peerB, own_qty: 3, foreign_qtys: [5] },
            ],
          },
          no_address_swap: {
            peers: [
              { addr: peerA, foreign_addrs: [ADDR_B] },
              { addr: peerB, foreign_addrs: [ADDR_A] },
            ],
          },
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peerA },
    { action: 'cleanup_peer', peer_addr: peerB },
  ],
};
