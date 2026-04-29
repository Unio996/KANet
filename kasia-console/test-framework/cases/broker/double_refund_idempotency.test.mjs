// double_refund_idempotency — Owner 02:30 钦定 "用真人方式测试"
// 真核心: 真 reproduce broker 同一 offer 两次 87.9 KAS chain TX (4/28 06:20 + 4/29 02:09 真**真 175.8 KAS chain spend, 资产流失 87.8 KAS)
//
// scenario:
//   T0 user paid 88 KAS to broker (simulated by direct INSERT exchange_offer + retail_dex_orders state='awaiting_payment')
//   T1 broker timeout sweep refund 87.9 KAS chain TX #1 (markOrderRefunded fire OK)
//   T2 cron sweep again — 必**真**真 SKIP (refund_tx_hash already set OR exchange_offer.protocol_status='cancelled')
//   T3 user new conversation cancel — 必**真 NOT** trigger refund chain TX (offer already refunded)
//
// success: chain TX 仅**1 次** fire 真同一 offer. retail_dex_orders.refund_tx_hash backfill OK. exchange_offers.protocol_status transition 'cancelled' (terminal).

import { freshTestPeer, relayAddr, relayId } from '../../lib/peers.mjs';
import { randomUUID } from 'node:crypto';

const peer = freshTestPeer('double-refund-' + Date.now());

export default {
  id: 'double_refund_idempotency',
  description: 'Owner 02:18 真测撞: broker 同一 offer 两次 87.9 KAS chain TX (175.8 KAS 流失). 真 reproduce + verify idempotency fix',
  domain: 'broker',
  tags: ['regression', 'idempotency', 'asset-loss', 'p0', 'owner-04-29'],
  steps: [
    // J1 #80 catch: inject sendKas mock 真 fake peer Phase 2 unreachable, mock fake 64-hex txId
    // J1 #86 vote A1' fail-closed: peer_addr param required (production protection)
    { action: 'inject_send_kas_mock', peer_addr: peer },

    // ── T0 setup: simulate user paid 88 KAS, broker published expired offer ──
    {
      action: 'setup_simulate_paid_offer',
      peer_addr: peer,
      offer_id: 'test-' + randomUUID().slice(0, 8),
      qty_kas: 88,
      give_amount: 87.9,  // post-fee
      // mark exchange_offers state='expired' + retail_dex_orders state='awaiting_payment' + refund_tx_hash NULL
    },

    // ── T1 trigger first refund (cron timeout sweep simulated by manual call) ──
    {
      action: 'trigger_refund_sweep',
      peer_addr: peer,
    },
    { action: 'sleep', ms: 5000 },
    {
      action: 'query_db',
      sql: `SELECT refund_tx_hash, state FROM retail_dex_orders WHERE user_kasia_address = ? ORDER BY created_at DESC LIMIT 1`,
      params: [peer],
      expect: {
        must: {
          db_row_count: 1,
          // 真 critical: refund_tx_hash 真**真 set + state transition 'refunded' (idempotency invariant)
          row_field_present: ['refund_tx_hash'],
          row_field_in: { state: ['refunded', 'completed'] },
        },
      },
    },

    // ── T2 trigger refund sweep AGAIN (would fire 2nd chain TX if idempotency missing) ──
    {
      action: 'trigger_refund_sweep',
      peer_addr: peer,
    },
    { action: 'sleep', ms: 5000 },
    {
      // chain TX count for this peer should still = 1, not 2
      action: 'query_db',
      sql: `SELECT COUNT(*) AS n FROM chain_events WHERE event_type = 'broker_kas_refunded' AND payload LIKE ?`,
      params: [`%${peer}%`],
      expect: {
        must: {
          row_field_equals: { n: 1 },  // 仅 1 chain TX, 不**真**真 2 = idempotency 真 fix
        },
      },
    },

    // ── T3 user new conversation cancel — should NOT trigger refund chain TX ──
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: 'cancel',
    },
    { action: 'sleep', ms: 3000 },
    {
      action: 'query_db',
      sql: `SELECT COUNT(*) AS n FROM chain_events WHERE event_type = 'broker_kas_refunded' AND payload LIKE ?`,
      params: [`%${peer}%`],
      expect: {
        must: {
          row_field_equals: { n: 1 },  // 仍 1, T3 cancel 不**真 trigger 真 already-refunded offer**
        },
      },
    },

    { action: 'reset_send_kas_mock' },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
