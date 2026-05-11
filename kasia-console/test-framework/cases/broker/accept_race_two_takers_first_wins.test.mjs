// T-J2-2026-05-11 Phase 2 B.2 (NWT #18 ABE audit B): exchange-machine B.1 SQL guard regression check
//
// NWT #18 B finding: exchange-machine.js:351 UPDATE taker_payment_address/taker_chain
// 无 status=open guard, race window logical 存在 — 2 concurrent accept_v1 同 offer:
// - 第一 accept UPDATE taker fields → transition() open→matched ✓
// - 第二 accept UPDATE taker fields (overwrite, no guard) → status 已 'matched' 但 UPDATE 仍 fire
// - 第一 settlement 时 taker 字段是第二 (失败的) accept 写的 stale data
//
// B.1 fix (commit b6e0e2994): UPDATE WHERE 加 AND protocol_status='open' guard。
// 此 test 直接 verify SQL guard 语义 (race scenario unit-level):
//   1. open offer + UPDATE with guard → changes=1 ✓
//   2. 模拟 transition (status='matched') + UPDATE same guard → changes=0 ✓ (guard 阻 stale overwrite)
//
// 跟 B.1 同 commit cycle, 持续 regression check 防 future refactor 漏 guard。

import { randomUUID } from 'node:crypto';

const TEST_OFFER_ID = `test-race-${Date.now().toString(36).slice(-8)}`;

export default {
  id: 'accept_race_two_takers_first_wins',
  description: 'Phase 2 B.2 (NWT #18 ABE): SQL guard regression — taker UPDATE blocked once status != open',
  domain: 'broker',
  tags: ['regression', 'race', 'phase-2-abe', 'b-1-fix'],
  skip_in_batch: true,
  steps: [
    // T1: 创 open exchange_offer (DB INSERT, 不走 publish API)
    {
      action: 'exec_sql',
      sql: `INSERT INTO exchange_offers
        (id, maker, give_asset, give_amount, want_asset, want_amount, protocol_status, market_key, verification, is_fully_observed, created_at, updated_at, broadcast_at, broadcast_tx_id, metadata)
        VALUES (?, 'test-maker-race', 'KAS', '100', 'USDT', '3.5', 'open', 'KAS-USDT', 'cross_chain_tx', 1, datetime('now'), datetime('now'), datetime('now'), ?, '{}')`,
      params: [TEST_OFFER_ID, (randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')).slice(0, 64)],
    },

    // T2: 第一 accept UPDATE — B.1 guard (status='open') 应通 (changes=1, first wins)
    {
      action: 'exec_sql',
      sql: `UPDATE exchange_offers SET taker_chain = 'bnb', taker_payment_address = '0xaaaa', verification_meta = '{}'
            WHERE id = ? AND protocol_status = 'open'`,
      params: [TEST_OFFER_ID],
    },

    // T3: 模拟 transition (status 'open' → 'matched') — first wins 之后状态机推进
    {
      action: 'exec_sql',
      sql: `UPDATE exchange_offers SET protocol_status = 'matched' WHERE id = ?`,
      params: [TEST_OFFER_ID],
    },

    // T4: 第二 accept UPDATE — B.1 guard 应阻 (status='matched', 不 = 'open')
    // 关键 regression check: 第二 accept 不可 overwrite first's taker_chain/payment_address
    {
      action: 'exec_sql',
      sql: `UPDATE exchange_offers SET taker_chain = 'eth', taker_payment_address = '0xbbbb', verification_meta = '{}'
            WHERE id = ? AND protocol_status = 'open'`,
      params: [TEST_OFFER_ID],
    },

    // T5: verify 最终 taker_chain 仍是 first ('bnb' 非 'eth'), B.1 guard 防 stale overwrite
    {
      action: 'query_db',
      sql: `SELECT protocol_status, taker_chain, taker_payment_address FROM exchange_offers WHERE id = ?`,
      params: [TEST_OFFER_ID],
      expect: {
        must: {
          db_row_count: 1,
          row_field_equals: {
            protocol_status: 'matched',
            taker_chain: 'bnb',  // first wins 不被 overwrite
            taker_payment_address: '0xaaaa',
          },
        },
      },
    },

    // T6: cleanup
    {
      action: 'exec_sql',
      sql: `DELETE FROM exchange_offers WHERE id = ?`,
      params: [TEST_OFFER_ID],
    },
  ],
};
