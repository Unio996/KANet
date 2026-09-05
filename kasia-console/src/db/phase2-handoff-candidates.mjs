// phase2-handoff-candidates.mjs — Phase-2 B 包 P2-3 (2026-09-05, 设计 docs/2026-09-05-j2-phase2-slow-sql-design-v0.1.md §P2-3 · Bettor 派工 894):
//   lib/zk-autonomy-ticks.mjs _scanHandoffCandidates 每 30 s 把 722 份 pool_markets.metadata(≈5 MB)搬到 JS 再逐行 JSON.parse, 只为跳过"已有 zk_continuation"的行。
//   改法: SQL 侧完成这一步(不取 metadata 血), 候选(通常 0–几个)再按 id 单取 metadata 供下游 meta.zk_handoff_pending / meta.zk_handoff_last_attempt_at。
// 🔴 与旧 JS 逐字等价(不是 v0.2 设计文里的简写 `json_valid AND … IS NULL`, 那会漏下面 4 类):
//   旧 JS: `meta = JSON.parse(row.metadata || '{}')`(坏 JSON ⇒ continue) ; `if (meta.zk_continuation) continue` (JS 假值不跳)
//   ⇒ 候选 ⇔ metadata IS NULL ∨ metadata = '' ∨ (json_valid ∧ zk_continuation 缺失/null/false/0/'')
//   SQL: json_extract 对 缺失/null ⇒ NULL, false ⇒ 0, 0 ⇒ 0, '' ⇒ '', 对象 ⇒ '{…}' 文本, true ⇒ 1, '0' ⇒ '0'(文本≠整数 0, 与 JS '0' 真值一致)
//   ⇒ `COALESCE(json_extract(metadata,'$.zk_continuation'), 0) IN (0, '')`。测试八类行逐一对拍。
// 影子比对(一周后单独一笔删): 旧查询(含 metadata)每 PHASE2_SHADOW_EVERY 次再算一次, 集合不等 ⇒ LOUD + events 行(在 tick 文件里做)。

export const HANDOFF_CANDIDATE_PREDICATE = "(pm.metadata IS NULL OR pm.metadata = '' OR (json_valid(pm.metadata) AND COALESCE(json_extract(pm.metadata, '$.zk_continuation'), 0) IN (0, '')))";
// 🔴 CROSS JOIN 钉外层 = payout_shards(722): 普通 JOIN 时规划器(无 sqlite_stat1)选 SCAN pool_markets(4,050 行·27.6 MB 全过 json_valid)+ ps 主键点查——
//   等于把 P2-1 刚治掉的全扫换个名字留下; CROSS JOIN 在 SQLite 是"按写的顺序做外层"的显式指令 ⇒ SCAN ps + pm 主键点查, 谓词只对 722 行的 metadata 求值(与旧路同形, 少搬 5 MB)。测试 V5 断言计划形。
export const HANDOFF_CANDIDATE_ROWS_SQL = `SELECT pm.id AS marketId, ps.payout_redeem_hex AS redeemHex
  FROM payout_shards ps CROSS JOIN pool_markets pm ON pm.id = ps.logical_market_id
  WHERE ${HANDOFF_CANDIDATE_PREDICATE}`;
/** 旧查询(影子比对用; 含 metadata 血) */
export const HANDOFF_LEGACY_ROWS_SQL = `SELECT pm.id AS marketId, ps.payout_redeem_hex AS redeemHex, pm.metadata AS metadata
  FROM payout_shards ps JOIN pool_markets pm ON pm.id = ps.logical_market_id`;

export function handoffCandidateRows(db) { return db.prepare(HANDOFF_CANDIDATE_ROWS_SQL).all(); }
export function handoffLegacyRows(db) { return db.prepare(HANDOFF_LEGACY_ROWS_SQL).all(); }

/** 与旧 JS 同语义的解析: 坏 JSON ⇒ null(调用方跳过); NULL/'' ⇒ {} */
export function parseMetaLegacy(metadata) {
  try { return JSON.parse(metadata || '{}'); } catch { return null; }
}
/** 按 id 单取 metadata 并按旧语义解析; 行不存在 ⇒ null */
export function marketMetaById(db, marketId) {
  const row = db.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
  if (!row) return null;
  return parseMetaLegacy(row.metadata);
}
