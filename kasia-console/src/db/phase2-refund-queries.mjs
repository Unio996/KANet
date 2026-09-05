// phase2-refund-queries.mjs — Phase-2 C 包 P2-2: services/pool-market-settler.js legacyRefundBuilderTick sides 扫描的【新查询】(影子用)。
//   (2026-09-05 · 设计 docs/2026-09-05-j2-phase2-slow-sql-design-v0.1.md §P2-2 · Bettor 派工 ledger 905 · Owner "C GO" · NWT 逐谓词对拍)
// 🔴 那条 SELECT 是 P1「验不成 ≠ 可以退款」授权闸(docs/2026-08-04-p1-cannot-verify-is-not-refund-authorization-design.md §10.1): 它选出的行会被拿去发退款。
//   ⇒ 主路的【旧查询原地不动】(settler 内联文本一字节不改, 主路仍走它); 本文件只放新查询, 只在影子里跑, 两边去 LIMIT 按 side_id 集合比, 一周零差异后 Bettor 批切换。
// 新查询 = 同谓词分层: pm.* 谓词进 MATERIALIZED CTE(走 idx_pool_markets_deadline, 每市场解析一次 metadata), pbs.* 谓词留外层(按 market_id 索引点查), ORDER BY/LIMIT 不动。
//   MATERIALIZED 必须写: 不写 SQLite 会把 CTE 展平, 计划与旧一模一样(NWT 抓过)。MATERIALIZED 让计划不依赖统计(D 包不采也成立)。
// 🔴 唯一一处与旧文本不同(NWT 请重点审): 旧 `pbs.refund_attempted_at < datetime('now', '-1 hour')` 在新文件里被 lint R-SQL-TIME-STRINGCMP 挡(baseline 只准降不准增);
//   lint 建议的 julianday() 形【不等价】——活库实核(2026-09-05 readonly): 该列 2,278 非空 = 2,273 空格形 + 0 T 形 + 5 行【整数 epoch】;
//   整数 vs TEXT 在 SQLite 里整数恒小 ⇒ 旧法把这 5 行判"早于截止"(候选), julianday(整数)=巨大儒略日 ⇒ 判"晚于"(排除), 结果翻转。
//   ⇒ 新查询改为【参数绑定】(lint 认可的合法形): `pbs.refund_attempted_at < ?`, 参数 = 同一连接上 SELECT datetime('now', '-1 hour') 的 TEXT 值。
//   TEXT 参数 vs 列的比较规则与 TEXT 表达式 datetime() 完全相同(空格形字符串比较 / NULL ⇒ NULL / 整数恒小) ⇒ 三种存值形逐一等价(测试 V1/V7 各造一行)。
//   代价: 截止时刻取自参数求值那一刻, 与旧法在 SQL 内求值差 <1 ms(只影响影子, 不影响主路)。
// 绑定顺序: ...unfixableIds, nowSec, cutoffText, [limit]。

/** 新查询(P2-2 修法)。limit=false 时去掉 LIMIT ?(影子用) */
export function materializedRefundSidesSql(unfixablePlaceholders, authIn, { limit = true } = {}) {
  return `
      WITH m AS MATERIALIZED (
        SELECT pm.id, pm.deadline, pm.protocol_version
        FROM pool_markets pm
        WHERE (
                (pm.protocol_version IS NULL OR pm.protocol_version = 'v0.5')
                OR pm.id IN (${unfixablePlaceholders})
                OR (
                  pm.protocol_status IN ('cancelled', 'refunded')
                  AND pm.protocol_version IN ('v0.6', 'v0.7')
                )
              )
          AND pm.deadline <= ?
          AND json_valid(pm.metadata)
          AND json_extract(pm.metadata, '$.refund_authorization') IN (${authIn})
      )
      SELECT pbs.id AS side_id, pbs.market_id, pbs.bettor_pk, pbs.side_p2sh, pbs.side_lock_tx,
             pbs.side_redeem_script_hex, pbs.stake_amount, m.deadline, m.protocol_version
      FROM m
      JOIN pool_bettor_sides pbs ON pbs.market_id = m.id
      WHERE pbs.side_lock_tx IS NOT NULL
        AND pbs.claim_txid IS NULL
        AND (pbs.refund_attempted_at IS NULL OR pbs.refund_attempted_at < ?)
      ORDER BY pbs.stake_amount ASC
      ${limit ? 'LIMIT ?' : ''}
    `;
}

/** 截止时间 TEXT(与旧法 SQL 内 datetime('now', '-1 hour') 同一函数同一连接求值, 空格形) */
export function refundCutoffText(db) { return db.prepare("SELECT datetime('now', '-1 hour') AS v").get().v; }

export function unfixablePlaceholdersOf(unfixableIds) { return unfixableIds.length ? unfixableIds.map(() => '?').join(',') : "''"; }

/** 影子用: 新查询去 LIMIT 取 side_id 列表 */
export function refundSidesIdsMaterialized(db, unfixableIds, authIn, nowSec) {
  return db.prepare(materializedRefundSidesSql(unfixablePlaceholdersOf(unfixableIds), authIn, { limit: false }))
    .all(...unfixableIds, nowSec, refundCutoffText(db)).map((r) => r.side_id);
}
