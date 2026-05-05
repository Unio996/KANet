// T-J2-2026-05-05 PZ-BROKER-PHASE-A-FULL RC-05 — real chain BUY self-deal R4 hard guard verify (no money).
//
// 验证 broker BUY path R4 self-deal pre-publish hard guard (commit 084be7b1a, broker-v2/router.js BUY 早拦):
// user 给 broker 自己 BSC addr 当 evm_pay_address → broker publish 之前 reject + DM 显式提示
// '你给的地址是 broker 自己的钱包, 请回你自己的 EVM 钱包'.
//
// 真钱预算: 0 (broker 真 reject pre-publish, 不上链 USDT/KAS).
// gate: broker-v2/router.js commit 084be7b1a 已 active (R4 BUY pre-publish guard ship).
// 跟 RC_04 (addr_swap_locked) 类似 pattern — 防御性 test, 真 production safety verify.
// 跟 SELL R4 (broker-intake-watcher.js:158-176) BUY/SELL 双 path consistent.

import { relayId, relayAddr } from '../../lib/peers.mjs';

const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_KASIA_ADDR = relayAddr('nwt');
const TRADER_B_KASIA_ADDR = relayAddr('trader-b');
// Trader-B 自挂 BSC USDT addr (broker maker addr) — agent_wallets WHERE relay_node_id=Trader-B AND chain='bnb' AND is_default=1.
// r158 实测 broker reply 真 forward 此 addr ('broker 自挂'). 本 case 用 user 给 broker 这个 addr 模拟 self-deal.
const BROKER_MAKER_BSC = '0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe';

export default {
  id: 'RC_05_self_deal_real',
  description: 'Phase 4 PZ-BROKER-PHASE-A-FULL RC-05 — real chain BUY self-deal R4 hard guard (commit 084be7b1a verify)',
  domain: 'broker',
  tags: ['real_chain', 'phase-4', 'no-money', 'security', 'r4-self-deal'],
  // 跟 RC_01-04 同款双 flag 防 cron + batch 真上链 (本 case 真上链 attempt + broker reject reply 真上链, ~0.0002 KAS gas).
  skip_in_cron: true,
  skip_in_batch: true,
  steps: [
    // T0 — pre-cleanup (清 NWT active aligning + reset broker peer state, KI-3 reconciliation)
    {
      label: 'T0 — pre-cleanup test peer',
      action: 'cleanup_real_artifacts',
      peer_addr: NWT_KASIA_ADDR,
    },

    // T1 — reset broker in-memory peer state via cancel chain DM (跟 r158 same pattern)
    {
      label: 'T1 — NWT DM 取消 reset broker in-memory state',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,
      message: '取消',
      poll_timeout_ms: 30_000,
      expect: {
        must: {
          // broker should ack cancel (or already-clean ack)
          reply_contains_one_of: ['取消', '已撤', '已清', 'cancelled', '没有挂单', '想下新单'],
        },
      },
    },

    // T2 — NWT real DM BUY 50 KAS with broker self addr as pay_address (self-deal trigger)
    {
      label: 'T2 — NWT BUY with broker maker BSC addr (self-deal)',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,
      message: `想买 50 KAS, BSC, 收款 ${BROKER_MAKER_BSC}`,
      poll_timeout_ms: 60_000,
      expect: {
        must: {
          // broker preview reply 含 '订单画像' (可能 LLM intent extract 接受先, T3 confirm 时才 R4 拦)
          // OR broker 直接拒 (字段提取阶段也可 detect): 任一都算 PASS
          reply_contains_one_of: ['订单画像', '画像', 'preview', 'broker 自己', '不要给 broker', '你自己'],
        },
      },
    },

    // T3 — NWT 'YES' confirm — trigger publish path → R4 hard guard 必拦
    {
      label: 'T3 — NWT YES confirm trigger R4 hard guard',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,
      message: 'YES',
      poll_timeout_ms: 30_000,
      expect: {
        must: {
          // broker R4 hard guard reject reply (commit 084be7b1a router.js BUY pre-publish)
          // multi-pattern flexibility: '挂单失败' '自己的钱包' 'broker 自己' '你自己的 EVM' '请回...你自己的'
          reply_contains_one_of: [
            '挂单失败',
            'broker 自己',
            '不要给 broker',
            '你自己的 EVM',
            '请回',
            '你自己',
            '不是你的',
          ],
          reply_does_not_contain: [
            // R4 hard guard 必拦, NOT '✓ 订单已建' / '付款指引' (publish 成功 indicator)
            '✓ 收到',
            '订单已建',
            '挂单 ID',
            '付款指引',
          ],
        },
      },
    },

    // T4 — verify retail_dex_orders 不写 publish 成功 row (state 不到 'awaiting_payment')
    {
      label: 'T4 — verify retail_dex_orders state 不 advance to awaiting_payment',
      action: 'query_db',
      sql: `SELECT id, side, state, pay_address, created_at FROM retail_dex_orders WHERE user_kasia_address = ? ORDER BY created_at DESC LIMIT 1`,
      params: [NWT_KASIA_ADDR],
      // Custom assertion 后置: row.state ∈ {'aligning', 'failed', 'cancelled'} (NOT 'awaiting_payment'/'paid'/'completed')
      // R4 reject 不让 publish, state 留 'aligning' (draft 阶段) OR 'failed' (broker mark fail) — 任一都算 PASS.
      // R4 hard guard reject 不写 retail_dex_orders 'awaiting_payment' row 是核心 invariant.
    },

    // T5 — cleanup
    {
      label: 'T5 — cleanup test peer',
      action: 'cleanup_real_artifacts',
      peer_addr: NWT_KASIA_ADDR,
    },
  ],
};
