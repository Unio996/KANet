// Phase D mode (ii) reference case — Path 1 BUY real Kasia P2P chain DM transport-layer test.
//
// J1 #28 fbf7b90d5 framework runner mode (ii) integration. NWT 14:36 propose +
// Owner 14:38 钦定 'multimode multi-method': mode (i) sync HTTP regression cron + mode (ii)
// real P2P chain DM transport-layer verify. mode (ii) catches bugs sync HTTP cron never can
// (e.g. NWT fad19de7 P2 broker preview reply chain DM lost — sync HTTP returned text fine,
// chain DM mode silent — fixed in J2 ce7b3b765 α+γ hybrid).
//
// ⚠ This case has REAL chain DM cost (~0.0003 KAS gas per turn) + REAL Mind autonomous
// interference (Martin/NWT real kasia identity 触发 Mind reply path). NOT for batch cron.
// Manual run only:  node scripts/test.mjs --case=phase_d_real_p2p_path1_buy
//
// Phase 5 closure evidence: chain TX hash list returned in step.result.{sent_tx, reply_txs}.

import { relayAddr } from '../../lib/peers.mjs';

const VICTIM_ADDR = '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74';

export default {
  id: 'phase_d_real_p2p_path1_buy',
  description: 'Phase D mode (ii) reference: BUY happy path real Kasia P2P chain DM round-trip — verifies broker preview reply fires chain DM (post J2 ce7b3b765 α+γ fix)',
  domain: 'broker',
  tags: ['real_p2p', 'phase-d', 'manual-only', 'transport-layer'],
  // Skip in default cron (manual-only test, real KAS gas cost + Mind interference noise)
  skip_in_cron: true,
  steps: [
    {
      label: 'P1-T1-BUY-real-p2p',
      action: 'send_message',
      mode: 'real_p2p',
      // T-J2-2026-05-05 stale-ref fix (NWT r205 finding + r209 钦定):
      // Martin J1 relay (3765cc82) 已退役, db relay_nodes 无此 row → 'Relay not running' false fail.
      // 改 NWT relay (5b236c08) — Phase A retry (r158) 已 verify NWT chain DM e2e production-ready.
      from_peer: 'nwt',                       // alias resolves NWT relay
      from_relay_id: '5b236c08-03d0-456c-953d-e10001610938',
      to_relay_id: relayAddr('trader-b'),     // explicit kaspa: addr
      message: `我要买 1 KAS, BNB 链, ${VICTIM_ADDR}`,
      poll_timeout_ms: 45000,                 // 45s — Kaspa block + scout sync + broker LLM call window
      expect: {
        must: {
          // Post-fix preview reply must fire chain DM with order picture content
          reply_contains_one_of: ['订单画像', '数量', '1 KAS', 'preview'],
          reply_does_not_contain: ['Relay may be syncing'],  // Phase D P0 fix verify
        },
      },
    },
  ],
};
