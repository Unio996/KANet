// T-J2-2026-05-05 PZ-BROKER-PHASE-A-FULL RC-06 — real chain BUY chain TX trace cross-table verify (no money).
//
// 验证 broker 跨账号 chain DM e2e 真核心: 跑 1 turn BUY → cross-table SQL verify chain TX hash 一致:
// - messages outbound (NWT) source_txid = NWT 真 chain TX
// - messages inbound (broker reply) source_txid = broker reply chain TX
// - chain_events 双 txid event_type='text' from/to 双向 (1 NWT→Trader-B, 1 Trader-B→NWT)
// - retail_dex_orders 新 row state='aligning' created_at 跟 messages 时序 align
// 真完整 settlement (deliver_tx_hash + EVM pay_tx) defer phase 2.
//
// 真钱预算: ~0.0003 KAS gas (NWT chain DM out + broker chain DM reply) + 0 USDT.
// gate: 跟 r158 实测 broker chain DM e2e PASS 同款 setup. broker session state 提前 cleanup peer.

import { relayId, relayAddr } from '../../lib/peers.mjs';

const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_KASIA_ADDR = relayAddr('nwt');
const TRADER_B_KASIA_ADDR = relayAddr('trader-b');
// 用 ETH chain + 不同 user EVM addr 跟 RC_03/04/05 differentiate (anti-spam dedup 避免 92% similar).
const NWT_USER_BSC = '0x7c8a31D8B6e9a45d5A4F8cE1bA5Cb6e8D2f4A30B';
const BUY_QTY = 1;  // 1 KAS minimal qty

export default {
  id: 'RC_06_chain_tx_trace',
  description: 'Phase 4 PZ-BROKER-PHASE-A-FULL RC-06 — real chain BUY chain TX trace cross-table verify (messages × chain_events × retail_dex_orders)',
  domain: 'broker',
  tags: ['real_chain', 'phase-4', 'chain-trace', 'invariant'],
  // 跟 RC_01-05 同款双 flag 防 cron + batch 真上链.
  skip_in_cron: true,
  skip_in_batch: true,
  steps: [
    // T0 — pre-cleanup
    {
      label: 'T0 — pre-cleanup test peer',
      action: 'cleanup_real_artifacts',
      peer_addr: NWT_KASIA_ADDR,
    },

    // T1 — NWT '取消' reset broker in-memory peer state (KI-3 reconciliation, r158 sediment)
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
          reply_contains_one_of: ['取消', '已撤', '已清', 'cancelled', '没有挂单', '想下新单'],
        },
      },
    },

    // T2 — NWT BUY chain DM (fresh order, 不同 chain + addr 防 anti-spam 92% similar)
    {
      label: 'T2 — NWT chain DM BUY 1 KAS ETH chain',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,
      message: `想买 ${BUY_QTY} KAS, ETH, ${NWT_USER_BSC}`,
      poll_timeout_ms: 60_000,
      expect: {
        must: {
          // broker reply 含订单画像 (跟 r158 同款 production-quality 8 维 reply)
          reply_contains_one_of: ['订单画像', '画像', `${BUY_QTY} KAS`, '单价', '总额'],
        },
      },
    },

    // T3 — verify messages 表 outbound (NWT → Trader-B)
    {
      label: 'T3a — query messages outbound NWT → Trader-B',
      action: 'query_db',
      sql: `SELECT m.source_txid, m.direction, substr(m.content_text,1,80) as content_preview
            FROM messages m
            JOIN identities si ON si.id = m.sender_identity_id
            JOIN identities ri ON ri.id = m.receiver_identity_id
            WHERE si.address = ?
              AND ri.address = ?
              AND m.direction = 'outbound'
              AND m.created_at > datetime('now', '-5 minutes')
            ORDER BY m.created_at DESC LIMIT 2`,
      params: [NWT_KASIA_ADDR, TRADER_B_KASIA_ADDR],
      // expect: 至少 1 row (T2 NWT outbound text)
    },

    // T4 — verify messages 表 inbound (Trader-B → NWT broker reply)
    {
      label: 'T3b — query messages inbound Trader-B → NWT',
      action: 'query_db',
      sql: `SELECT m.source_txid, m.direction, substr(m.content_text,1,80) as content_preview
            FROM messages m
            JOIN identities si ON si.id = m.sender_identity_id
            JOIN identities ri ON ri.id = m.receiver_identity_id
            WHERE si.address = ?
              AND ri.address = ?
              AND m.direction = 'inbound'
              AND m.created_at > datetime('now', '-5 minutes')
            ORDER BY m.created_at DESC LIMIT 2`,
      params: [TRADER_B_KASIA_ADDR, NWT_KASIA_ADDR],
      // expect: 至少 1 row (T2 broker reply inbound)
    },

    // T5 — verify chain_events 表 双 txid event_type='text' (NWT→Trader-B + Trader-B→NWT)
    {
      label: 'T3c — query chain_events text events 双向 trace',
      action: 'query_db',
      sql: `SELECT event_type, from_address, to_address, txid, observed_at
            FROM chain_events
            WHERE event_type = 'text'
              AND ((from_address = ? AND to_address = ?) OR (from_address = ? AND to_address = ?))
              AND observed_at > datetime('now', '-5 minutes')
            ORDER BY observed_at LIMIT 5`,
      params: [NWT_KASIA_ADDR, TRADER_B_KASIA_ADDR, TRADER_B_KASIA_ADDR, NWT_KASIA_ADDR],
      // expect: 2 row (NWT outbound + Trader-B inbound text)
    },

    // T6 — verify retail_dex_orders 新 row state='aligning' (broker session 写入)
    {
      label: 'T3d — query retail_dex_orders 新 row',
      action: 'query_db',
      sql: `SELECT id, side, qty, state, pay_chain, pay_address, created_at, updated_at
            FROM retail_dex_orders
            WHERE user_kasia_address = ?
              AND created_at > datetime('now', '-5 minutes')
            ORDER BY created_at DESC LIMIT 1`,
      params: [NWT_KASIA_ADDR],
      // expect: 1 row, state='aligning', side='buy_kas', qty=BUY_QTY, pay_chain='eth', pay_address=NWT_USER_BSC
    },

    // T7 — cleanup
    {
      label: 'T7 — cleanup test peer',
      action: 'cleanup_real_artifacts',
      peer_addr: NWT_KASIA_ADDR,
    },

    // 跨 table chain TX trace assertion (case author 后置 verify):
    // - T3a messages outbound source_txid 应跟 T3c chain_events NWT→Trader-B txid 同 (跟 sendCommand 真 chain TX 一致)
    // - T3b messages inbound source_txid 应跟 T3c chain_events Trader-B→NWT txid 同 (broker reply chain TX)
    // - T3d retail_dex_orders.created_at 应在 T3a outbound time + T3b inbound time 之间 (broker handler 处理时间)
    // 完整 4 表 align = chain TX 跨 table truth source 一致 — broker 跨账号 e2e production-ready 真核心 invariant.
  ],
};
