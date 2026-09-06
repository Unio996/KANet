// events-type-index-v201.mjs — P2-6 6a: events(event_type, created_at DESC) 索引(记账式·boot 内建·不 ANALYZE) + 6b 播种查询单源。
//   (2026-09-06 · 设计 docs/2026-09-06-j2-p2-6-preprune-capture-worker-events-like-scan-design-v0.1.md §3 6a/6b · NWT GREEN-conditional · Bettor 派工 ledger 945)
// 为什么: events 594,985 行(2026-09-06 实核), 索引只有 created/level/trace/agent_addr, **没有 event_type** ⇒ 全仓 7 处
//   `FROM events WHERE event_type = ?` 探测(preprune-capture-worker :68/:83, preprune-capture-monitor stale 去重, spc-daa-index-monitor,
//   mind-manager, bshard-coherence-observability-monitor, migrate)全是 SCAN events。preprune-capture-worker 每 tick ≈936 次 ⇒ ≥13 s 事件循环停顿。
//   本索引让 `event_type = ?` 走 SEARCH(341 行), `event_type = ? AND created_at > …` 同索引前导列 + 范围。595k 行建索引 ~1–2 s, boot 内建可接受。
// 🔴 不 ANALYZE(D 包事故: ENABLE_STAT4 构建 ANALYZE 写 stat1+stat4, 回滚不可靠; 规划器对等值索引本就优先, 不需统计)。
// 任何重建 events 表的迁移都必须带上本索引。

export const EVENTS_TYPE_CREATED_INDEX_NAME = 'idx_events_type_created';
export const EVENTS_TYPE_CREATED_INDEX_DDL = `CREATE INDEX IF NOT EXISTS ${EVENTS_TYPE_CREATED_INDEX_NAME} ON events(event_type, created_at DESC)`;

function _hasIndex(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name);
}

/** 记账式: 在 ⇒ 记账通过; 不在 ⇒ 建(计时日志)。返回 'present' | 'built'。 */
export function ensureEventsTypeCreatedIndexV201(db, { log = console.log, now = Date.now } = {}) {
  if (_hasIndex(db, EVENTS_TYPE_CREATED_INDEX_NAME)) { log(`[migrate] v201: ${EVENTS_TYPE_CREATED_INDEX_NAME} 在, 记账通过`); return 'present'; }
  const t0 = now();
  db.exec(EVENTS_TYPE_CREATED_INDEX_DDL);
  log(`[migrate] v201: ${EVENTS_TYPE_CREATED_INDEX_NAME} 建完 ${now() - t0} ms (P2-6 6a: events(event_type, created_at DESC), 不 ANALYZE)`);
  return 'built';
}

/**
 * 6b 播种查询: 某事件族(如 side_lock_daa_unrecoverable)已记录的 DISTINCT marketId。json_valid 守卫坏 JSON(本表事件都是我们 JSON.stringify 写的)。
 * 与旧 `payload_json LIKE '%"marketId":"X"%'` 的差(新法更严, 2026-09-06 NWT 只读实核: pool_markets 4,050 id / market_shards 1,341 / 341 事件 marketId 含 `_`/`%`/大写者 0 ⇒ 今天逐一等价):
 *   LIKE 对 ASCII 不分大小写、`_`/`%` 是通配 ⇒ 若将来出现含通配符或大小写不同的 id, 旧法会多认、新法精确。测试各造一行断形状。
 * 抛错 ⇒ 调用方必须 fail-closed(跳 tick), 绝不带空集合进循环(空集合 = 全部已放弃盘重进 RPC walk = 08-06 稿病原样重演)。
 */
export const UNRECOVERABLE_SEED_SQL = `SELECT DISTINCT json_extract(payload_json, '$.marketId') AS marketId
  FROM events WHERE event_type = ? AND json_valid(payload_json)`;
export function seedMarkedMarketIds(db, eventType) { return db.prepare(UNRECOVERABLE_SEED_SQL).all(eventType); }
