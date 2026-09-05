// phase2-indexes-v200.mjs — Phase-2 A 包 (2026-09-05, 设计 docs/2026-09-05-j2-phase2-slow-sql-design-v0.1.md v0.2.1 NWT GREEN · Bettor 派工 ledger 894):
//   P2-5  idx_pool_sides_bettor_created ON pool_bettor_sides(bettor_pk, created_at DESC)   — my-positions(api/pool.js:3300/:3402) 去全扫+TEMP B-TREE
//   P2-1  idx_pool_markets_zk_ready: 守卫式表达式部分索引(A′) —— _scanZkAutonomyCandidates(lib/zk-autonomy-ticks.mjs) 从 LIKE 全扫 27.6 MB 找 6 行 → 索引查找
// 🔴 NWT C1 表达式单源: 索引 DDL 与查询都从本文件拼, 禁止两处手打(表达式差一个空格以外的字符就不走索引)。
// 🔴 NWT C2 查询用字面量 = 'ready'(不用绑定参数): 部分索引可用性靠"查询谓词蕴含索引谓词", 字面量才是契约。
// 与 v199 不同: 两个索引对 4,050 / 36k 行量级建索引 ≤3 s, 可 boot 内建(IF NOT EXISTS + sqlite_master 记账日志); 不需停机窗。
// 坏 JSON: CASE WHEN json_valid THEN … END 在表达式里守卫 ⇒ 坏 JSON 行索引值为 NULL, INSERT/UPDATE 不抛(内存库实证, J2/NWT 各一次)。
// 备注: 任何重建 pool_markets / pool_bettor_sides 表的迁移都必须带上这两个索引(否则静默退化回全扫, v3-A sql.* 行会抓回来)。

export const ZK_READY_EXPR = "(CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.zk_continuation.proving.status') END)";
export const ZK_READY_INDEX_NAME = 'idx_pool_markets_zk_ready';
export const ZK_READY_INDEX_DDL = `CREATE INDEX IF NOT EXISTS ${ZK_READY_INDEX_NAME} ON pool_markets(${ZK_READY_EXPR}) WHERE ${ZK_READY_EXPR} = 'ready'`;
/** P2-1 新查询(字面量 'ready', C2); 返回 {id, metadata} 行, JS 端仍按 exhausted/outpoint/redeemHex 再筛(语义不变) */
export const ZK_READY_ROWS_SQL = `SELECT id, metadata FROM pool_markets WHERE ${ZK_READY_EXPR} = 'ready'`;
/** 旧查询(影子比对一周用, 之后单独一笔删) */
export const ZK_LEGACY_LIKE_ROWS_SQL = `SELECT id, metadata FROM pool_markets WHERE metadata LIKE '%zk_continuation%'`;

export const SIDES_BETTOR_CREATED_INDEX_NAME = 'idx_pool_sides_bettor_created';
export const SIDES_BETTOR_CREATED_INDEX_DDL = `CREATE INDEX IF NOT EXISTS ${SIDES_BETTOR_CREATED_INDEX_NAME} ON pool_bettor_sides(bettor_pk, created_at DESC)`;

function _hasIndex(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name);
}

/**
 * ensurePhase2IndexesV200(db, {log, now}) — 幂等; 每个索引: 在 ⇒ 记账; 不在 ⇒ 建(计时)。返回 {[name]: 'present'|'built'}。
 * boot 内建可接受(≤3 s); 不像 v199 那样拒建。
 */
export function ensurePhase2IndexesV200(db, { log = console.log, now = Date.now } = {}) {
  const out = {};
  for (const [name, ddl] of [[SIDES_BETTOR_CREATED_INDEX_NAME, SIDES_BETTOR_CREATED_INDEX_DDL], [ZK_READY_INDEX_NAME, ZK_READY_INDEX_DDL]]) {
    if (_hasIndex(db, name)) { log(`[migrate] v200: ${name} 在, 记账通过`); out[name] = 'present'; continue; }
    const t0 = now();
    db.exec(ddl);
    log(`[migrate] v200: ${name} 建完 ${now() - t0} ms (Phase-2 A 包: P2-5 / P2-1 A′)`);
    out[name] = 'built';
  }
  return out;
}

/**
 * zkReadyCandidateRows(db) / zkLegacyLikeRows(db) — 供 _scanZkAutonomyCandidates 与影子比对调用; 都只返回 {id, metadata} 行。
 */
export function zkReadyCandidateRows(db) { return db.prepare(ZK_READY_ROWS_SQL).all(); }
export function zkLegacyLikeRows(db) { return db.prepare(ZK_LEGACY_LIKE_ROWS_SQL).all(); }

/**
 * 影子比对节奏(A 包 v2 · NWT 条件 2026-09-05): 旧 LIKE 全扫每次 0.4–18 s 同步阻塞(修前 max 106 s), 默认 **0 = 关**——
 * 否则三个 ZK tick 各每 N 次跑一次旧查询, 修后窗会被影子自己污染。只在 Bettor 排的影子窗里 `PHASE2_SHADOW_EVERY=<N>` 打开, 窗内 N ≥ 100(每 tick ~50 min 一次)。
 * resolveShadowEvery(env): 非法/缺省/≤0 ⇒ 0。shadowDue(calls, every): every ≤ 0 ⇒ 永假; 否则 calls 为 every 的正整数倍时真。
 */
export function resolveShadowEvery(env = process.env) {
  const n = Number.parseInt(env.PHASE2_SHADOW_EVERY ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
export function shadowDue(calls, every) {
  return every > 0 && calls > 0 && calls % every === 0;
}
/**
 * 启动时打一行开关值(Bettor 批 ledger 910): 开关读取本是静默的, 影子窗打开与否只能等 ③ 放行后第 N tick 的 equal 行才有正面证据。
 * 三个消费方(zk-autonomy-ticks / pool-market-settler / bettor-refund-claim-auto)各调一次, 进程内只打【一行】(模块级 guard); 返回是否真打了。
 */
let _shadowAnnounced = false;
export function announceShadowEvery(env = process.env, { log = console.log } = {}) {
  if (_shadowAnnounced) return false;
  _shadowAnnounced = true;
  const raw = env.PHASE2_SHADOW_EVERY;
  log(`[phase2-shadow] PHASE2_SHADOW_EVERY=${resolveShadowEvery(env)} (raw=${raw === undefined ? '<unset>' : JSON.stringify(raw)}; 0=关; 影子窗内 ≥100; 对 P2-1/P2-3 只在不一致时打, P2-2/P2-4 每次比对打 equal/mismatch)`);
  return true;
}
