// Creates and exports the drizzle DB instance
// DB path resolution (2026-08-28 J2 · Bettor/NWT 裁 · ANTI-PATTERNS 规则 74 根治):
//   · DB_PATH 有 ⇒ resolve(DB_PATH)(语义不变, 不拒建: mkdtemp 验收 + 首启建库都靠它)。
//   · DB_PATH 无 ⇒ 【仅当入口是 console】(argv[1] 以 kasia-console/src/index.js 结尾, 或 KANET_CONSOLE_ENTRY=1)
//     ⇒ 锚定 import.meta.url 的 ../../data/console.db(= <repo>/kasia-console/data/console.db, 与 cwd 无关),
//     并回写 process.env.DB_PATH 让 fork/spawn 的子进程继承(它们 argv[1] 不是 index.js)。
//   · 其它入口无 DB_PATH ⇒ **throw**(在 mkdirSync 之前, 零建目录/文件)。
//     🔴 为什么不退成 LOUD 警告+只读: 旧形 `resolve('./data/console.db')` 随 cwd 漂 + better-sqlite3 对缺失路径静默建空库
//     ⇒ 从仓根跑脚本读/建杂库且不报错(规则 74 实录); 而若改成"无 DB_PATH 即 live", 15 个历史写脚本(smoke DELETE/INSERT)会从"打杂库"升成"打 live"。
//     throw 是唯一让那 15 个【结构上】打不到 live 的形; 20 个只读脚本以后显式 DB_PATH=… 是一次性成本。
//   · 加载时打印一行 `[db] path=<abs> source=<DB_PATH|default(console-entry)>`(console 启动日志可见; 不含密钥)。
// Ensures the data directory exists
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export const DB_PATH_REFUSE_MSG = '[db] DB_PATH not set and this is not the console entry — refusing to default to live; run with DB_PATH=<abs path>';

/** 纯函数(可测): 由 env / 本模块 URL / 入口 argv[1] 决定库路径; 不读 cwd、不碰文件系统。 */
export function resolveDbPath(env = process.env, moduleUrl = import.meta.url, argv1 = process.argv[1]) {
  if (env.DB_PATH) return { path: resolve(env.DB_PATH), source: 'DB_PATH' };
  const entry = argv1 ? resolve(String(argv1)).replace(/\\/g, '/') : '';
  const isConsoleEntry = entry.endsWith('/kasia-console/src/index.js') || env.KANET_CONSOLE_ENTRY === '1';
  if (!isConsoleEntry) throw new Error(DB_PATH_REFUSE_MSG);
  return { path: resolve(dirname(fileURLToPath(moduleUrl)), '../../data/console.db'), source: 'default(console-entry)' };
}

/** 默认解析时回写 env(子进程继承); DB_PATH 本就有则不动。返回是否写了。 */
export function exportDbPathToEnv(resolved, env = process.env) {
  if (resolved.source === 'DB_PATH') return false;
  env.DB_PATH = resolved.path;
  return true;
}

const resolved = resolveDbPath();   // 非 console 入口且无 DB_PATH ⇒ 这里 throw, 下面一行都不跑
exportDbPathToEnv(resolved);
const dbPath = resolved.path;
console.log(`[db] path=${dbPath} source=${resolved.source}`);
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { sqlite, dbPath };
