// T-J2-2026-04-29 Phase β RC-03 — real chain CANCEL pre-paid (no money).
//
// 验证 broker 在 quote 阶段 user '取消' 真上链 ack + state='cancelled'.
// 走 real_p2p chain DM (不 sync HTTP) — 真 production user 体验.
//
// 真钱预算: 0 (cancel before any payment).
// gate: NWT broker-v2 5 P0 fix done OR fall back broker-v1 (peer 不在 BROKER_V2_ENABLED_PEERS 时).
// 用 NWT relay (在 scoped peers 列表) → broker-v2 path.

import { relayId, relayAddr } from '../../lib/peers.mjs';

const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_KASIA_ADDR = relayAddr('nwt');
const TRADER_B_KASIA_ADDR = relayAddr('trader-b');
const J2_BSC_RECV = '0x00c41dC0D0d7F4232EFB6ec545F7ad9e031eb62f';

export default {
  id: 'RC_03_cancel_quote_real',
  description: 'Phase β RC-03 — real chain CANCEL pre-paid (BUY quote → user 取消 → state=cancelled)',
  domain: 'broker',
  tags: ['real_chain', 'phase-beta', 'no-money'],
  skip_in_cron: true,
  skip_in_batch: true,
  steps: [
    // T0 — pre-cleanup
    {
      label: 'T0 — pre-cleanup test peer',
      action: 'cleanup_real_artifacts',
      peer_addr: NWT_KASIA_ADDR,
    },

    // T1 — NWT real DM '买 10 KAS' BUY intent
    {
      label: 'T1 — NWT DM BUY intent',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,
      message: `买 10 KAS, BSC, ${J2_BSC_RECV}`,
      poll_timeout_ms: 60_000,
      expect: {
        must: {
          // broker chain DM reply must contain preview elements
          reply_contains_one_of: ['订单画像', '画像', 'preview', '10 KAS', '挂单'],
        },
      },
    },

    // T2 — NWT real DM '取消' cancel intent
    {
      label: 'T2 — NWT DM cancel',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,
      message: '取消',
      poll_timeout_ms: 30_000,
      expect: {
        must: {
          // broker should ack cancel
          reply_contains_one_of: ['取消', '已撤', '不下单了', '已重置', 'cancelled'],
          reply_does_not_contain: ['付款指引', 'kaspa:'],
        },
      },
    },

    // T3 — verify retail_dex_orders state moved away from active
    {
      label: 'T3 — verify state cancelled OR no active draft',
      action: 'query_db',
      sql: `SELECT id, side, state, created_at FROM retail_dex_orders WHERE user_kasia_address = ? ORDER BY created_at DESC LIMIT 1`,
      params: [NWT_KASIA_ADDR],
      // Note: must check via custom assertion later — broker-v2 may delete draft OR set state.
      // Either way, no row in 'aligning'/'awaiting_payment' for this peer = passing.
    },

    // T4 — cleanup
    {
      label: 'T4 — cleanup',
      action: 'cleanup_real_artifacts',
      peer_addr: NWT_KASIA_ADDR,
    },
  ],
};
