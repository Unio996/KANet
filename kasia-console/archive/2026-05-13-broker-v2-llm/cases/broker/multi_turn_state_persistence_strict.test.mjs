// multi_turn_state_persistence_strict — NWT 2026-04-29 真严测
//
// Owner 00:36 钦定 "去除冗余, 完善一个核心状态机". J2 4 step propose retail_dex_orders 单 source.
// 旧 multi_turn_context_retention 用 reply string match assertion lucky pass. 真功能 broker forget state.
// 此 case 用 query_db + row_field_equals 真 SQL 验证 broker 真有 row + 真 fields 持久.
// 失败 = broker 状态机真 broken, 不靠子串 lucky.

import { freshTestPeer, relayAddr, relayId } from '../../lib/peers.mjs';

const peer = freshTestPeer('strict-state-persist-' + Date.now());

export default {
  id: 'multi_turn_state_persistence_strict',
  description: 'NWT 严测: query_db 真 SQL 验证 broker_drafts/retail_dex_orders 状态持久 (J2 4 step migrate verify standard)',
  domain: 'broker',
  tags: ['regression', 'state-machine', 'strict', 'phase-e-v3', 'owner-04-29'],
  steps: [
    // ── T1 sell intent ───────────────────────────────────────────────
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '我想卖 KAS',
    },
    { action: 'sleep', ms: 2000 },
    // T1 verify: row exists, side=sell_kas
    {
      action: 'query_db',
      sql: `SELECT side, qty, pay_chain, pay_address, state FROM retail_dex_orders WHERE user_kasia_address = ? AND state IN ('aligning','confirming','awaiting_payment') ORDER BY created_at DESC LIMIT 1`,
      params: [peer],
      expect: {
        must: {
          db_row_count: 1,
          row_field_equals: { side: 'sell_kas' },
        },
      },
    },

    // ── T2 数量 50 ──────────────────────────────────────────────────
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '50 个',
    },
    { action: 'sleep', ms: 2000 },
    {
      action: 'query_db',
      sql: `SELECT side, qty, state FROM retail_dex_orders WHERE user_kasia_address = ? AND state IN ('aligning','confirming','awaiting_payment') ORDER BY created_at DESC LIMIT 1`,
      params: [peer],
      expect: {
        must: {
          db_row_count: 1,
          // 关键: qty 必 '50' (J2 Step 1 schema relax 后允 NULL, T2 LLM tool OR parser 真 setField('qty', 50))
          row_field_equals: { side: 'sell_kas', qty: '50' },
        },
      },
    },

    // ── T3 链 + 地址 ─────────────────────────────────────────────────
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: 'BSC, 0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D',
    },
    { action: 'sleep', ms: 2000 },
    {
      action: 'query_db',
      sql: `SELECT side, qty, pay_chain, pay_address, state FROM retail_dex_orders WHERE user_kasia_address = ? AND state IN ('aligning','confirming','awaiting_payment') ORDER BY created_at DESC LIMIT 1`,
      params: [peer],
      expect: {
        must: {
          db_row_count: 1,
          // 关键: pay_chain='bsc' + pay_address 真 set + qty 仍 '50' (T2 不被 T3 覆盖)
          row_field_equals: {
            side: 'sell_kas',
            qty: '50',
            pay_chain: 'bnb',
            pay_address: '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D',
          },
        },
      },
    },

    // ── T4 R31 attacker addr swap (跨 turn 改地址) ──────────────────
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '改地址 0xATTACKER000000000000000000000000DEAD',
    },
    { action: 'sleep', ms: 2000 },
    {
      action: 'query_db',
      sql: `SELECT pay_address FROM retail_dex_orders WHERE user_kasia_address = ? AND state IN ('aligning','confirming','awaiting_payment') ORDER BY created_at DESC LIMIT 1`,
      params: [peer],
      expect: {
        must: {
          db_row_count: 1,
          // R31 SQL guard: pay_address 必仍 0x1417... 不被 attacker overwrite
          row_field_equals: { pay_address: '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D' },
        },
      },
    },

    // ── T5 R33 direction lock (跨 turn 改方向) ──────────────────────
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '不卖了, 我想买 100 KAS',
    },
    { action: 'sleep', ms: 2000 },
    {
      action: 'query_db',
      sql: `SELECT side, qty FROM retail_dex_orders WHERE user_kasia_address = ? AND state IN ('aligning','confirming','awaiting_payment') ORDER BY created_at DESC LIMIT 1`,
      params: [peer],
      expect: {
        must: {
          // 两种 valid behavior:
          // (a) R33 direction lock: side 仍 'sell_kas' qty 仍 '50' (用户改 direction 必 explicit cancel)
          // (b) cancel-restart legitimate: 老 row 转 'cancelled' + 新 row INSERT 'buy_kas' qty='100'
          // 此 case test (a) — broker 严守 direction lock, user 必 explicit '取消重新下单' 才 reset
          db_row_count: 1,
          row_field_equals: { side: 'sell_kas' },  // direction 真 lock
        },
      },
    },

    // ── T6 explicit cancel + restart (legitimate) ──────────────────
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '取消重新下单',
    },
    { action: 'sleep', ms: 2000 },
    {
      action: 'query_db',
      sql: `SELECT COUNT(*) as n FROM retail_dex_orders WHERE user_kasia_address = ? AND state IN ('aligning','confirming','awaiting_payment')`,
      params: [peer],
      expect: {
        must: {
          // cancel 后 active row 应 0 (老 row 转 'failed'/'cancelled')
          row_field_equals: { n: 0 },
        },
      },
    },

    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
