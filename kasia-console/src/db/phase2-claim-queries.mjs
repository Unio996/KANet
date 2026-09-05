// phase2-claim-queries.mjs — Phase-2 C 包 P2-4: services/bettor-refund-claim-auto.mjs claimAutoDispatcherTick 的候选 SQL 单源。
//   (2026-09-05 · 设计 docs/2026-09-05-j2-phase2-slow-sql-design-v0.1.md §P2-4 · Bettor 派工 ledger 905 · Owner "C GO")
// 🔴 钱路(自动退款 claim 的候选)。主路仍走 LEGACY_CLAIM_SIDES_SQL; REVERSED_CLAIM_SIDES_SQL 只在影子里跑, 按 side id 集合比, 一周零差异后 Bettor 批切换。
// 旧法: sides(33,859 行 side_lock_tx 索引驱动) × 每行 EXISTS 对 124 条 bettor_refund_available 事件做 2 个 LIKE ⇒ ≈4.2M 次 LIKE/tick(p50 4.1 s, max 15 s)。
// 新法: 反转驱动——先从 124 条事件 json_extract 出 DISTINCT (market_id, bettor_pk), 再按 idx_pool_sides_market_bettor 点查 sides。
// 已知语义差(设计 v0.2 两条, 都是"新法更严"):
//   差 1: 坏 JSON 但含子串的事件——旧 LIKE 认, 新法 json_valid 守卫不认(事件全是我们自己 JSON.stringify 写的; 活库 124/124 valid)。
//   差 2: LIKE 对 ASCII 不分大小写, `=` 精确——事件与 side 行大小写不同时旧认新不认。C3 前置(§4c, 2026-09-05 副本重跑)= 0 对。
//   两条差都会被影子 LOUD 出来(onlyLegacy 非空), 这正是影子的用处; 测试把两类各造一行, 断言差异形状而不是假装相等。
// 写入方 4 处(pool-market-settler.js :682/:790/:2163/:2437)payload 都是 JSON.stringify({ market_id, bettor_pk, … }) ⇒ json_extract 等值 ⇔ 原 LIKE 子串。

/** 旧查询(逐字, 从 claim-auto 搬来) */
export const LEGACY_CLAIM_SIDES_SQL = `
      SELECT s.id, s.market_id, s.bettor_pk, s.side_p2sh, s.side_lock_tx, s.side_redeem_script_hex,
             s.stake_amount, s.direction, m.deadline, m.protocol_status
      FROM pool_bettor_sides s
      JOIN pool_markets m ON m.id = s.market_id
      WHERE s.claim_txid IS NULL
        AND s.side_lock_tx IS NOT NULL
        AND s.side_redeem_script_hex IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM chain_events ce
          WHERE ce.event_type = 'bettor_refund_available'
            AND ce.payload LIKE '%"market_id":"' || s.market_id || '"%'
            AND ce.payload LIKE '%"bettor_pk":"' || s.bettor_pk || '"%'
        )
    `;

/** 新查询(P2-4 修法): 反转驱动 + json_extract + `=` */
export const REVERSED_CLAIM_SIDES_SQL = `
      WITH ra AS (
        SELECT DISTINCT json_extract(payload, '$.market_id') AS market_id, json_extract(payload, '$.bettor_pk') AS bettor_pk
        FROM chain_events
        WHERE event_type = 'bettor_refund_available' AND json_valid(payload)
      )
      SELECT s.id, s.market_id, s.bettor_pk, s.side_p2sh, s.side_lock_tx, s.side_redeem_script_hex,
             s.stake_amount, s.direction, m.deadline, m.protocol_status
      FROM ra
      JOIN pool_bettor_sides s ON s.market_id = ra.market_id AND s.bettor_pk = ra.bettor_pk
      JOIN pool_markets m ON m.id = s.market_id
      WHERE s.claim_txid IS NULL
        AND s.side_lock_tx IS NOT NULL
        AND s.side_redeem_script_hex IS NOT NULL
    `;

export function claimSidesLegacy(db) { return db.prepare(LEGACY_CLAIM_SIDES_SQL).all(); }
export function claimSidesReversed(db) { return db.prepare(REVERSED_CLAIM_SIDES_SQL).all(); }
