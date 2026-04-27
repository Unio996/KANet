// J1 race-3peer-concurrent-buy — dogfood phase 6 of (d) B (NWT a7f4070fb infra ship)
// Probe original (J1 c310f346 adversarial probes.mjs:128): 3 peers BUY simultaneously, broker
// must keep state isolated (no_state_corruption / each_peer_distinct_offer / no_amount_swap).
//
// Phase 6 真**真**真 dogfood: 验 NWT phase 1-5 全栈生效 (parallel + assertions + alias + cleanup).
// 真有 race condition (broker Map.set TOCTOU / broker-action-queue contention) FAIL 暴露,
// 修法走 R33 c iter (跨 J1+NWT territory).

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const SOPHIE = freshTestPeer('race-sophie-' + Date.now());
const ERIC = freshTestPeer('race-eric-' + Date.now());
const MARTIN = freshTestPeer('race-martin-' + Date.now());

export default {
  id: 'race_3peer_concurrent_buy',
  description: '3 peers BUY simultaneously — broker state isolation under concurrent inbound DM',
  domain: 'broker',
  tags: ['race', 'adversarial', 'p1', 'b-phase-6'],
  skip_in_batch: true,  // race tests manual only, batch run 撞 kasia-rpc backpressure
  aliases: {
    Sophie: { peer: SOPHIE },
    Eric: { peer: ERIC },
    Martin: { peer: MARTIN },
    broker: { relay_id: relayId('trader-b') },
  },
  steps: [
    {
      action: 'parallel',
      actions: [
        { action: 'send_message', from_alias: 'Sophie', to_alias: 'broker', message: '买 5 KAS, BSC' },
        { action: 'send_message', from_alias: 'Eric', to_alias: 'broker', message: '买 3 KAS, BSC' },
        { action: 'send_message', from_alias: 'Martin', to_alias: 'broker', message: '买 10 KAS, BSC' },
      ],
      expect: {
        must: {
          no_state_corruption: {
            peers: [
              { addr: SOPHIE, want_qty: 5, want_direction: 'buy' },
              { addr: ERIC, want_qty: 3, want_direction: 'buy' },
              { addr: MARTIN, want_qty: 10, want_direction: 'buy' },
            ],
          },
          each_peer_distinct_offer: true,
          no_amount_swap: {
            peers: [
              { addr: SOPHIE, own_qty: 5, foreign_qtys: [3, 10] },
              { addr: ERIC, own_qty: 3, foreign_qtys: [5, 10] },
              { addr: MARTIN, own_qty: 10, foreign_qtys: [5, 3] },
            ],
          },
        },
      },
    },
    { action: 'cleanup_peer_broker_state', peers: [SOPHIE, ERIC, MARTIN] },
  ],
};
