// T-J2-2026-04-29 Phase β RC-01 — real chain BUY full journey (skeleton).
//
// Owner 14:30 钦点 "按真人样子上链测试". Phase β 第一 case — full BUY e2e:
// NWT relay DM Trader-B → preview → YES → 真 USDT BSC → "我付了 0xtx" → broker auto deliver KAS.
//
// 真钱预算: ~0.85 USDT BSC + ~0.0003 KAS gas. skip_in_batch=true. manual run only.
//
// 启动条件 (gate):
// 1. NWT broker-v2 5 P0 fix done (fake price / qty retain / R31 / lifecycle_paid / non_custodial)
// 2. BROKER_V2_ENABLED_PEERS 含 NWT addr (NWT relay DM 路 v2 path)
// 3. Trader-B BSC USDT 余额 ≥ 0.85 USDT (deliver maker side)
// 4. NWT relay BSC USDT 余额 ≥ 1.0 USDT (user pay side)
//
// pre-flight verify (smoke before manual run):
// - node scripts/test.mjs --case=test-framework/cases/broker/_phase_alpha_smoke.test.mjs (4 actions wired)
// - verify_broker_v2_active probe NWT addr → active_path='v2'
// - 检 agent_wallets WHERE relay_node_id=NWT.id AND chain='bnb' balance ≥ 1.0

import { relayId, relayAddr } from '../../lib/peers.mjs';

const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_KASIA_ADDR = relayAddr('nwt');
const TRADER_B_KASIA_ADDR = relayAddr('trader-b');
const BUY_QTY_KAS = 25;

export default {
  id: 'RC_01_buy_kas_real_full',
  description: 'Phase β RC-01 — real chain BUY 全流程 e2e (NWT real DM → 真 USDT BSC → broker deliver KAS)',
  domain: 'broker',
  tags: ['real_chain', 'critical', 'phase-beta'],
  // 真上链 + 真钱 + Mind autonomous 干扰. NEVER batch. manual only.
  skip_in_cron: true,
  skip_in_batch: true,
  steps: [
    // T1 — NWT real DM '买 25 KAS, BSC, <NWT BSC addr>'
    {
      label: 'T1 — NWT DM broker BUY intent',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',                 // alias resolves NWT relay
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,  // chain DM by addr
      // TODO: replace placeholder with NWT BSC USDT receive addr (agent_wallets WHERE relay_node_id=NWT.id AND chain='bnb')
      message: `买 ${BUY_QTY_KAS} KAS, BSC, 0x__NWT_BSC_ADDR_TBD__`,
      poll_timeout_ms: 60_000,           // 60s for chain DM round-trip + broker LLM
      expect: {
        must: {
          // broker must reply with preview chain DM
          reply_contains_one_of: ['订单画像', 'preview', 'preview_text', `${BUY_QTY_KAS} KAS`],
          reply_does_not_contain: ['Relay may be syncing', '我刚走神'],
        },
      },
    },

    // T2 — NWT DM 'YES' confirm
    {
      label: 'T2 — NWT DM YES confirm',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,
      message: 'YES',
      poll_timeout_ms: 90_000,           // longer — broker accept_v1 publish + maker accept + payment instruction
      expect: {
        must: {
          // broker must reply with payment instruction (maker BSC addr + USDT amount)
          reply_contains_one_of: ['付款', 'USDT', '付到', '0x'],
          reply_does_not_contain: ['失败', 'Relay may be syncing'],
        },
      },
    },

    // T3 — wait for broker to publish exchange_offer + matched
    {
      label: 'T3 — wait exchange_offer matched',
      action: 'wait_for_offer_status',
      maker: TRADER_B_KASIA_ADDR,        // broker is maker (publishes BUY in user's name → broker books)
      status: 'matched',
      timeout_ms: 60_000,
    },

    // T4 — extract maker payment addr from broker DM (parse from prior reply)
    // (skipped in skeleton — needs custom helper to extract 0x... from messages.content_text)
    // TODO: add 'extract_addr_from_reply' action OR query messages WHERE peer LIKE 'NWT' content LIKE '%0x%'

    // T5 — inject_paid_mock (NWT vote C, T-J2-2026-04-30):
    // 模拟 user 真付 USDT BSC 但不烧钱. broker.verifyPaymentForPeer 用 _scanOverride 返 fake event
    // match pick.take_usdt → broker fires _enqueuePaid → paid_v1 chain DM broadcast.
    // 真 BSC fund 路径留 phase 2 (Owner fund OR phase 2 cutover 真生产).
    {
      label: 'T5 — inject_paid_mock (NWT vote C)',
      action: 'inject_paid_mock',
      events: [
        // amount must match pick.take_usdt (broker dynamic quote at T1) ± 1% tolerance.
        // 25 KAS * 0.034 USDT/KAS ≈ 0.85 USDT. Adjust if T1 broker quote drift.
        { tx_hash: '0xMOCK0000000000000000000000000000000000000000000000000000000000ab', amount: 0.85 },
      ],
    },

    // T6 — NWT DM '我付了 0x<tx hash>' (引用 T5 tx_hash via ctx.steps.t5.result.tx_hash)
    {
      label: 'T6 — NWT DM paid notification with tx hash',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,
      // TODO: dynamic ref ctx.steps[T5].result.tx_hash (runner needs to support templating)
      message: '我付了 0x__T5_TX_HASH_TBD__',
      poll_timeout_ms: 30_000,
      expect: {
        must: {
          reply_contains_one_of: ['查链', '验证', '稍等', '确认'],
        },
      },
    },

    // T7 — wait retail_dex_orders.state='paid'
    {
      label: 'T7 — wait state=paid',
      action: 'wait_for_db_row',
      sql: `SELECT id, side, state FROM retail_dex_orders WHERE user_kasia_address = ? AND state = 'paid' ORDER BY created_at DESC LIMIT 1`,
      params: [NWT_KASIA_ADDR],
      timeout_ms: 90_000,
    },

    // T8 — wait broker delivery_tx (KAS sent to NWT)
    {
      label: 'T8 — wait delivery_tx',
      action: 'wait_for_db_row',
      sql: `SELECT id, deliver_tx_hash FROM retail_dex_orders WHERE user_kasia_address = ? AND deliver_tx_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      params: [NWT_KASIA_ADDR],
      timeout_ms: 120_000,
    },

    // T9 — wait state='completed' + exchange_offer_id linked (RC must verify protocol closure)
    {
      label: 'T9 — wait state=completed + offer linked',
      action: 'wait_for_db_row',
      sql: `SELECT id, state, exchange_offer_id FROM retail_dex_orders WHERE user_kasia_address = ? AND state = 'completed' AND exchange_offer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      params: [NWT_KASIA_ADDR],
      timeout_ms: 60_000,
    },

    // T10 — cleanup
    {
      label: 'T10 — cleanup test artifacts',
      action: 'cleanup_real_artifacts',
      peer_addr: NWT_KASIA_ADDR,
    },
  ],
};
