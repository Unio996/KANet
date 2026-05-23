// (d) B phase 4+5 smoke — cleanup_peer_broker_state action + handler _testClear* exports.
// 真测最小验: 跑 SELL flow 留 state, 然后 cleanup_peer_broker_state 清, 再跑同 peer SELL 应 fresh.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('b45-cleanup-' + Date.now());

export default {
  id: '_b_phase4_5_cleanup_smoke',
  description: 'B phase 4+5 smoke: cleanup_peer_broker_state clears all per-peer Maps',
  domain: 'broker',
  tags: ['infra', 'b-phase', 'smoke', 'manual-only'],
  skip_in_batch: true,
  steps: [
    // T1: peer SELL 起 — broker setConvoStateLock + _pending set
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '卖 5 KAS, BSC',
      expect: {
        must: { reply_does_not_contain: ['方向: 买'] },
      },
    },
    // T2: cleanup_peer_broker_state — 应清所有 Map state
    {
      action: 'cleanup_peer_broker_state',
      peers: [peer],
    },
    // T3: 同 peer 发 BUY (反方向) — 应该 PASS, 因为 cleanup 清了 SELL state
    // 如 cleanup 漏清 _convoState, R33 会拦 BUY (direction immutable). 真生效 = 这步成功走 BUY.
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '买 3 KAS, BSC',
      expect: {
        must: {
          // BUY 应该走通, 不被 stale SELL state 拦
          reply_does_not_contain: ['cancel order first', '取消订单先', '已锁定 SELL'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
    { action: 'cleanup_peer_broker_state', peers: [peer] },
  ],
};
