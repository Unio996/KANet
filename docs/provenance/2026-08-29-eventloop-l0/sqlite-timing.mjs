// sqlite-timing.mjs — L0 归因仪器: 给 better-sqlite3 连接的 prepare() 返回的 Statement 包一层, 量 run/get/all 的墙钟.
// observe-only · 不改 SQL · 不改返回值. 目的: 若某条本应 µs 级的 INSERT 跑了 8s, 那是 WAL 自动 checkpoint 在这条语句里同步发生
// (docs/…eventloop-block-investigation.md §3 行 W) —— 这是唯一能把 (W) 从"推断"变"读数"的地方.
//
// 用法 (db/client.js, `const sqlite = new Database(dbPath)` 之后): installSqliteTiming(sqlite);
// 关闭: SQLITE_TIMING_OFF=1. 阈值 SQLITE_TIMING_WARN_MS (默认 200).
import { performance } from 'node:perf_hooks';
import { recordSync } from './tick-registry.mjs';

const WARN_MS = Number(process.env.SQLITE_TIMING_WARN_MS) || 200;
const METHODS = ['run', 'get', 'all'];

function _sqlTag(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function installSqliteTiming(sqlite) {
  if (process.env.SQLITE_TIMING_OFF === '1') { console.log('[sqlite-timing] OFF by env'); return sqlite; }
  if (sqlite.__timingInstalled) return sqlite;
  const origPrepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = function (sql, ...rest) {
    const stmt = origPrepare(sql, ...rest);
    const tag = _sqlTag(sql);
    for (const m of METHODS) {
      const orig = stmt[m];
      if (typeof orig !== 'function') continue;
      // 用 defineProperty 覆盖实例方法 (better-sqlite3 Statement 方法在原型上, 实例可写)
      Object.defineProperty(stmt, m, {
        configurable: true, writable: true,
        value: function (...args) {
          const startedAt = Date.now();
          const t0 = performance.now();
          try {
            return orig.apply(this, args);
          } finally {
            const ms = Math.round(performance.now() - t0);
            if (ms >= WARN_MS) {
              recordSync(`${m}:${tag}`, startedAt, ms, 'sql');
              console.warn(`[diag:sql-sync] ms=${ms} method=${m} sql="${tag}" at=${new Date(startedAt).toISOString()}`);
            }
          }
        },
      });
    }
    return stmt;
  };
  sqlite.__timingInstalled = true;
  console.log(`[sqlite-timing] installed (warn>=${WARN_MS}ms)`);
  return sqlite;
}
