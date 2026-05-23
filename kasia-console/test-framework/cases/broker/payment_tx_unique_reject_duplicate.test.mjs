// T-J2-2026-05-11 Phase 2 B.3 (NWT #18 ABE audit B): payment_tx UNIQUE 索引 regression check
//
// NWT #18 B finding: exchange_offers.payment_tx UNIQUE 索引已 OK (v61 + v83 hardened),
// 防 TX reuse attack — 同 chain TX hash 不可绑 2 个 offer (taker 用 1 个 USDT TX 试图 settle 2 offer)。
//
// 此 test (B.3): UNIQUE constraint regression check 守 migration 不破。
// 1. INSERT first offer with payment_tx 'tx-hash-X' → success
// 2. INSERT second offer with same payment_tx 'tx-hash-X' → UNIQUE constraint violation
// 3. cleanup

import { randomUUID } from 'node:crypto';

const OFFER_A = `test-unique-a-${Date.now().toString(36).slice(-8)}`;
const OFFER_B = `test-unique-b-${Date.now().toString(36).slice(-8)}`;
const SHARED_TX = (randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')).slice(0, 64);

export default {
  id: 'payment_tx_unique_reject_duplicate',
  description: 'Phase 2 B.3 (NWT #18 ABE): exchange_offers.payment_tx UNIQUE 索引 regression — 同 TX hash 不可绑 2 offer',
  domain: 'broker',
  tags: ['regression', 'unique-constraint', 'phase-2-abe', 'b-3-unique'],
  skip_in_batch: true,
  steps: [
    // T1: INSERT 第一 offer with payment_tx
    {
      action: 'exec_sql',
      sql: `INSERT INTO exchange_offers
        (id, maker, give_asset, give_amount, want_asset, want_amount, protocol_status, market_key, verification, is_fully_observed, payment_tx, created_at, updated_at, broadcast_at, broadcast_tx_id, metadata)
        VALUES (?, 'test-maker-unique-a', 'KAS', '100', 'USDT', '3.5', 'completed', 'KAS-USDT', 'cross_chain_tx', 1, ?, datetime('now'), datetime('now'), datetime('now'), ?, '{}')`,
      params: [OFFER_A, SHARED_TX, (randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')).slice(0, 64)],
    },

    // T2: verify 第一 offer payment_tx 写入
    {
      action: 'query_db',
      sql: `SELECT payment_tx FROM exchange_offers WHERE id = ?`,
      params: [OFFER_A],
      expect: {
        must: {
          db_row_count: 1,
          row_field_equals: { payment_tx: SHARED_TX },
        },
      },
    },

    // T3: INSERT 第二 offer with SAME payment_tx — expect UNIQUE constraint failure
    // exec_sql 返 { ok: false, error: 'UNIQUE constraint failed: ...' } 时, 整 step 假 PASS
    // 因 expect 真 row_count=0 (failed insert 没行写入)
    {
      action: 'exec_sql',
      sql: `INSERT INTO exchange_offers
        (id, maker, give_asset, give_amount, want_asset, want_amount, protocol_status, market_key, verification, is_fully_observed, payment_tx, created_at, updated_at, broadcast_at, broadcast_tx_id, metadata)
        VALUES (?, 'test-maker-unique-b', 'KAS', '50', 'USDT', '1.75', 'completed', 'KAS-USDT', 'cross_chain_tx', 1, ?, datetime('now'), datetime('now'), datetime('now'), ?, '{}')`,
      params: [OFFER_B, SHARED_TX, (randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')).slice(0, 64)],
    },

    // T4: verify OFFER_B 没 inserted (UNIQUE 阻止)
    {
      action: 'query_db',
      sql: `SELECT COUNT(*) AS n FROM exchange_offers WHERE id = ?`,
      params: [OFFER_B],
      expect: {
        must: {
          row_field_equals: { n: 0 },
        },
      },
    },

    // T5: verify OFFER_A 仍存在 + payment_tx 未被覆盖
    {
      action: 'query_db',
      sql: `SELECT payment_tx FROM exchange_offers WHERE id = ?`,
      params: [OFFER_A],
      expect: {
        must: {
          db_row_count: 1,
          row_field_equals: { payment_tx: SHARED_TX },
        },
      },
    },

    // T6: cleanup
    {
      action: 'exec_sql',
      sql: `DELETE FROM exchange_offers WHERE id IN (?, ?)`,
      params: [OFFER_A, OFFER_B],
    },
  ],
};
