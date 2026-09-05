// heavy-index-v199.mjs — Phase-1 ② (2026-09-05, Owner 全批 ledger 880 · Bettor 881/882 · NWT 审): kaspa_tx_log 复合索引的【记账式】迁移。
// 索引: idx_kaspa_tx_log_to_addr_observed ON kaspa_tx_log(to_address, observed_at DESC)
// 目的: broker-intake-watcher.js:703-717 每 60 s 的 `to_address=? AND observed_at > datetime(...) … ORDER BY observed_at DESC LIMIT 50`
//   现只走单列 idx_kaspa_tx_log_to_address + USE TEMP B-TREE FOR ORDER BY(schema-only EXPLAIN 实录), 活库每次 4–30 s 同步堵 loop,
//   2026-09-05 08:44Z 一次 185 s 直接把 console 15196 堵死。复合索引后计划 = SEARCH k USING INDEX …(to_address=? AND observed_at>?) 无 TEMP B-TREE。
// 🔴 为什么不是裸 `CREATE INDEX IF NOT EXISTS`(会在 boot 自建): kaspa_tx_log ~16M 行, 建索引分钟级且持写锁 ⇒ console 启动卡住数分钟、
//   -wal 涨 ~1.7 GB。索引由停机窗脚本建(kasia-console/scratch/_j2_p1_kaspa_tx_log_index_window.mjs: console 停后跑,
//   建完 PRAGMA wal_checkpoint(TRUNCATE)); 本函数只查 sqlite_master:
//     在        ⇒ 一行记账日志, 不动;
//     不在      ⇒ LOUD 警告 + 跳过(不自动建), 除非 env KANET_MIGRATE_BUILD_HEAVY_INDEX=1(小库/测试库/明确要在 boot 建)才在此建。
//   与"迁移幂等"语义一致(重复跑无副作用), 但把"什么时候付那几分钟"交给运维窗口而不是下一次意外重启。
export const KASPA_TX_LOG_TO_ADDR_OBSERVED_INDEX = 'idx_kaspa_tx_log_to_addr_observed';
export const KASPA_TX_LOG_TO_ADDR_OBSERVED_DDL = `CREATE INDEX IF NOT EXISTS ${KASPA_TX_LOG_TO_ADDR_OBSERVED_INDEX} ON kaspa_tx_log(to_address, observed_at DESC)`;

/**
 * @returns {'present'|'built'|'skipped'}
 */
export function ensureKaspaTxLogToAddrObservedIndex(db, { env = process.env, log = console.log, warn = console.warn, now = Date.now } = {}) {
  const has = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'index' AND name = ?").get(KASPA_TX_LOG_TO_ADDR_OBSERVED_INDEX);
  if (has) { log(`[migrate] v199: ${KASPA_TX_LOG_TO_ADDR_OBSERVED_INDEX} 在(停机窗已建), 记账通过`); return 'present'; }
  if (env.KANET_MIGRATE_BUILD_HEAVY_INDEX === '1') {
    const t0 = now();
    db.exec(KASPA_TX_LOG_TO_ADDR_OBSERVED_DDL);
    log(`[migrate] v199: ${KASPA_TX_LOG_TO_ADDR_OBSERVED_INDEX} 在 boot 建完 ${now() - t0} ms (KANET_MIGRATE_BUILD_HEAVY_INDEX=1)`);
    return 'built';
  }
  warn(`[migrate] v199: 🔴 ${KASPA_TX_LOG_TO_ADDR_OBSERVED_INDEX} 缺失 — 不在 boot 自建(kaspa_tx_log ~16M 行, 分钟级持写锁); 请在停机窗跑 kasia-console/scratch/_j2_p1_kaspa_tx_log_index_window.mjs, 或 KANET_MIGRATE_BUILD_HEAVY_INDEX=1 明确要求在此建(🔴 永不进 kanet.env; 只允许 supervisor/hb_guard 已停时手动单跑 migrate, 否则 boot-age 判活会把建到一半的进程杀掉 ⇒ 回滚 ⇒ 重启风暴)。正路始终是停机窗脚本。broker-intake 的 60 s SELECT 在此之前仍是 4–30 s 同步阻塞。`);
  return 'skipped';
}
