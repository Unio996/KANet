// M0c-1 app provision — grant registry relay 侧只读访问 (fresh 读, 零 grant 数据缓存)
// 设计: docs/2026-07-23-m0c-1-app-provision-design.md §2
//
// 读通道: node:sqlite readOnly 直开 console.db (路径由 relay-manager fork env M0C1_GRANT_DB_PATH
//   传入, console 侧解析成绝对路径)。零新 npm 依赖 / 零 HTTP 面 / 零 IPC 往返; WAL 多进程读不阻写。
// 🔴 fresh 读语义 (v0.2 note·焊吊销即时可见): 连接可复用 (WAL reader), 但每次调用都执行新查询、
//   读最新已提交数据 — 本模块不缓存任何 grant 行/字段。operator 吊销 (revoked=1) 写库后, 该 grant
//   的下一条命令在这里就读到 revoked=1 → gate 立即拒, 无 relay 启动缓存 staleness 窗。
// 🔴 fail-closed: 路径缺失 / DB 打不开 / 表不存在 / 查询异常 → 返回 { ok:false } → 调用方
//   (app-envelope.mjs) 一律 deny (M1-4 fail-closed-on-error)。
// 🔴 只读焊死: readOnly 连接 — 本模块物理上写不了 registry (M1-5 写入方仅 operator 离线脚本)。

import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const TABLE = 'm0c1_app_grants'; // schema 单一真相源: kasia-console/src/db/m0c1-grant-registry-schema.js

let _db = null;

function _openDb() {
  if (_db) return _db;
  const dbPath = process.env.M0C1_GRANT_DB_PATH || '';
  if (!dbPath) throw new Error('M0C1_GRANT_DB_PATH 未设置 (relay-manager fork env 传入)');
  // node:sqlite (node ≥22.13 内建): 延迟 require — 失败可捕获 → 调用方 fail-closed, 不炸 relay 启动。
  const { DatabaseSync } = _require('node:sqlite');
  _db = new DatabaseSync(dbPath, { readOnly: true });
  return _db;
}

/**
 * 按 grant_id fresh 读一行 grant (每次调用新查询, 读最新已提交数据, 不缓存结果)。
 * @returns {{ok:true, grant:object|null} | {ok:false, error:string}}
 */
export function getGrantFresh(grantId) {
  try {
    const db = _openDb();
    const row = db.prepare(`SELECT * FROM ${TABLE} WHERE grant_id = ?`).get(String(grantId));
    return { ok: true, grant: row || null };
  } catch (e) {
    _db = null; // 连接可能已坏, 下次调用重开; 本次由调用方 fail-closed deny
    return { ok: false, error: e?.message || String(e) };
  }
}
