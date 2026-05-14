// Lifecycle P1: state TTL 30min 后 fresh order 真接受
// J1 probes.mjs lifecycle-state-expire-boundary (severity should)
//
// flow: 买 5 KAS, BSC → broker preview → mock_state_ttl_advance (跳 31min) → 买 3 KAS, BSC → broker fresh accept qty=3
// expected: last reply qty=3 (不是 5), 不含 'already active'
//
// NWT (d) lifecycle infra ship c3c0a9ed: mock_state_ttl_advance action 真**真 fast-forward.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('lifecycle-expire-' + Date.now());

export default {
  id: 'lifecycle_state_expire_boundary',
  description: 'P1 lifecycle: 30min TTL 后 fresh order 真接受',
  domain: 'broker',
  tags: ['regression', 'p1', 'lifecycle'],
  steps: [
    // T1: BUY 5 KAS → broker lock state
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '买 5 KAS, BSC',
    },
    // mock 31min 真**真**真 state expire
    {
      action: 'mock_state_ttl_advance',
      peer,
    },
    // T2: 真**真**真 BUY 3 KAS → broker 真**真**真 accept (state expired)
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '买 3 KAS, BSC',
      expect: {
        must: {
          // 不能 stale BUY 5 残留 (state 真**真 expire)
          reply_does_not_contain: ['买 5 KAS', 'already active', '已有 active', '已锁定'],
          // 应该 fresh BUY 3 preview OR collect new
          reply_contains_one_of: ['3 KAS', '买 3', 'fresh'],
        },
      },
    },
    { action: 'cleanup_peer_broker_state', peers: [peer] },
  ],
};
