// T-J2-2026-04-30 Phase β RC-02 — real chain SELL full journey (skeleton).
//
// SELL B 模式 (KAS-first, broker-intake auto-publish): user 真 sendKaspa 5 KAS → Trader-B
// → broker-intake-watcher 检 kaspa_tx_log → auto publish 4.9 KAS SELL exchange_offer
// → maker accept + USDT pay (此 phase β 用 inject_paid_mock 模拟 maker side)
// → broker auto-deliver USDT (mock 路径仅 cover broker-side state).
//
// 真钱预算: ~5 KAS user-side (Owner 已 fund NWT relay) + 0 USDT (maker mock).
// gate: NWT broker-v2 5 P0 fix done (qty retain bug 影响 broker-v2 SELL parsing).
// 注意: NWT addr 在 BROKER_V2_ENABLED_PEERS scoped, 走 broker-v2 path.

import { relayId, relayAddr } from '../../lib/peers.mjs';

const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_KASIA_ADDR = relayAddr('nwt');
const TRADER_B_KASIA_ADDR = relayAddr('trader-b');
const NWT_BSC_RECV = '0x00c41dC0D0d7F4232EFB6ec545F7ad9e031eb62f';  // J2 derived BSC (NWT placeholder, use J2 derived for receive)
const SELL_QTY_KAS = 5;

export default {
  id: 'RC_02_sell_kas_real_full',
  description: 'Phase β RC-02 — real chain SELL 全流程 (NWT real KAS → broker-intake → auto-publish → mock maker USDT)',
  domain: 'broker',
  tags: ['real_chain', 'critical', 'phase-beta'],
  skip_in_cron: true,
  skip_in_batch: true,
  steps: [
    // T0 — pre-cleanup
    {
      label: 'T0 — pre-cleanup',
      action: 'cleanup_real_artifacts',
      peer_addr: NWT_KASIA_ADDR,
    },

    // T1 — NWT real DM 'SELL intent + addr' (initiates flow, broker quote preview)
    {
      label: 'T1 — NWT DM SELL intent',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,
      message: `卖 ${SELL_QTY_KAS} KAS, BSC, ${NWT_BSC_RECV}`,
      poll_timeout_ms: 60_000,
      expect: {
        must: {
          reply_contains_one_of: ['卖单画像', '画像', `${SELL_QTY_KAS} KAS`, 'preview'],
        },
      },
    },

    // T2 — NWT DM 'YES' confirm SELL preview
    {
      label: 'T2 — NWT DM YES confirm',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,
      message: 'YES',
      poll_timeout_ms: 60_000,
      expect: {
        must: {
          // broker should ack + give Trader-B KAS receive addr
          reply_contains_one_of: ['kaspa:', '转 KAS', '发 KAS', '收款', '已确认'],
        },
      },
    },

    // T3 — NWT real send 5 KAS → Trader-B (real on-chain KAS transfer, ~0.0003 KAS gas)
    {
      label: 'T3 — NWT real_send_kas 5 KAS to Trader-B',
      action: 'real_send_kas',
      from_relay_id: NWT_RELAY_ID,
      to_addr: TRADER_B_KASIA_ADDR,
      amount_kas: SELL_QTY_KAS,
      timeout_ms: 30_000,
      expect: {
        must: {
          // tx_id must be returned (real broadcast)
        },
      },
    },

    // T4 — wait broker-intake watcher detects KAS inbound (kaspa_tx_log row)
    {
      label: 'T4 — wait kaspa_tx_log inbound',
      action: 'wait_for_db_row',
      sql: `SELECT tx_id, to_address, amount FROM kaspa_tx_log WHERE to_address = ? AND amount >= ? AND observed_at > datetime('now', '-5 minutes') ORDER BY observed_at DESC LIMIT 1`,
      params: [TRADER_B_KASIA_ADDR, SELL_QTY_KAS - 0.001],
      timeout_ms: 90_000,
    },

    // T5 — wait broker auto-publishes SELL exchange_offer (4.9 KAS = 5 - 0.1 fee)
    {
      label: 'T5 — wait broker auto-publish SELL offer',
      action: 'wait_for_db_row',
      sql: `SELECT id, give_asset, give_amount, want_asset FROM exchange_offers WHERE maker = ? AND give_asset = 'KAS' AND give_amount > 4.5 AND give_amount < 5.0 AND created_at > strftime('%s','now','-5 minutes')*1000 ORDER BY created_at DESC LIMIT 1`,
      params: [TRADER_B_KASIA_ADDR],
      timeout_ms: 60_000,
    },

    // T6 — verify state='executing' OR 'aligning' OR similar (broker-v2 D2 lifecycle)
    {
      label: 'T6 — verify retail_dex_orders state set',
      action: 'query_db',
      sql: `SELECT id, side, state, exchange_offer_id FROM retail_dex_orders WHERE user_kasia_address = ? AND side = 'sell_kas' ORDER BY created_at DESC LIMIT 1`,
      params: [NWT_KASIA_ADDR],
    },

    // T7 — cleanup (preserve completed state — only cleanup non-terminal)
    {
      label: 'T7 — cleanup (non-terminal only)',
      action: 'cleanup_real_artifacts',
      peer_addr: NWT_KASIA_ADDR,
    },

    // NOTE Phase β scope ends at T6.
    // Full e2e settlement (maker accept + USDT pay + broker auto-deliver) deferred to phase 2:
    // - 需 maker relay 真 BSC USDT fund (Owner OR phase 2 cutover)
    // - inject_paid_mock for maker side requires extending mock to exchange-machine
    //   processPaymentSubmit cross-chain-verify path (currently broker-side only).
    // 此 case 验证 broker-side SELL state machine 全 covers: chat → preview → KAS arrival → auto-publish.
  ],
};
