// env-bootstrap.mjs — DoD-E env 单源派生 (J1, Bettor r739 Option A, 2026-06-12)
//
// 根因 (KANet-UI r738 / Bettor r739): test framework 多处硬编码 Console 端口 →
//   - 24 个 dm-agent case: `process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300'` (默认 :3300 = J1 节点口)
//   - runner.mjs:19: `process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3100'` (默认 :3100 = 主网口)
//   - runner.mjs http_post: `process.env.PORT || 3100`
// 跨节点跑 (KANet-UI 从 :3200 跑 → 打 :3300 J1 节点) 不可达 fetch failed = 3 个 env-fail
// (dim1_navigation_04_full_lifecycle / dim7_audit_02_endpoint_shape / dim6_race_03_scout_outage).
//
// 修 = 单源派生: 从【跑测节点自己的 kanet.env PORT】派生 KANET_CONSOLE_URL + PORT (若未显式设),
// 跟 J1 DoD-E supervisor/status port 收敛【同模式】(kanet.env PORT 单一源). 测试节点无关:
// :3200 跑打 :3200, :3300 跑打 :3300. 显式 env 仍优先 override.
//
// 【必须在 runner.mjs import 之前 import】: runner.mjs:19 CONSOLE_URL 是顶层 const, 静态 import 即求值;
// case 文件的 TN12_CONSOLE 同理. 本模块作为 side-effect import 排在 runner 之前 → env 先就位.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function deriveConsolePort() {
  // 优先级: 显式 PORT env > kanet.env PORT > 3300 (tn sandbox 默认 fallback, 仅 kanet.env 缺时).
  if (process.env.PORT) return String(process.env.PORT).trim();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // lib → test-framework → kasia-console → repo root (kanet.env 在 repo root)
  const envFile = path.resolve(__dirname, '..', '..', '..', 'kanet.env');
  try {
    const txt = fs.readFileSync(envFile, 'utf8');
    const line = txt.split(/\r?\n/).filter(l => /^PORT=/.test(l)).pop();
    if (line) {
      const v = line.slice(5).trim();
      if (v) return v;
    }
  } catch { /* kanet.env 不在 → 退默认 */ }
  return '3300';
}

const port = deriveConsolePort();
if (!process.env.PORT) process.env.PORT = port;
if (!process.env.KANET_CONSOLE_URL) process.env.KANET_CONSOLE_URL = `http://127.0.0.1:${port}`;

// ── DB 隔离 (KANet-UI, Bettor/NWT 2026-08-04 拍板, runner 硬化卡) ──────────────────
//
// 根因(两条独立路径,同一个"顶层 const 绑定时机"形状):
//   (a) src/db/client.js:10  `resolve(process.env.DB_PATH || './data/console.db')`
//   (b) test-framework/lib/runner.mjs:20-21  `process.env.KANET_DB_PATH || .../data/console.db`
// 两者都是顶层 const,一旦任何模块先 import 就绑死——之前没人在"任何用例被 import 之前"统一设好
// DB_PATH/KANET_DB_PATH,于是 test-framework 默认直接打生产库 kasia-console/data/console.db。
// 2026-08-03 夜同时坑了两个人: J2 的用例每跑一次往生产插 5 市场+5 side 再删(跑了 7 次);
// J1 的两个自跑脚本在 runner 进程里把测试行写进了生产库(4 市场+2 分片+5 side)。
//
// 修法(照抄本文件上面 PORT 派生用过的同一手法——side-effect import 排在 runner.mjs 之前):
//   若 DB_PATH/KANET_DB_PATH 未被显式设(尊重手动 override,不覆盖调试者的意图),
//   统一指向一个独立文件 test-framework/data/test-console.db,并在这里删重建
//   (含 WAL 模式的 -wal/-shm 附属文件),再触发一次 runMigrations() 建出带真实 trigger
//   的完整 schema(不手搓空表,复用 scripts/run-migrations.mjs 同一个 runMigrations 入口)。
//
// 范围边界(spec-first 报审已钉,NWT 裁定为准): 落码前逐条扫过 test-framework/cases/ 全部用例,
// 确认"实调 relay/真实链上"那类用例(数据源是链上/relay,不读写本地 SQLite)不受这条隔离影响——
// 这条隔离对它们是 no-op 不是误伤,不需要单独放行,因为它们本来就不会去碰 DB_PATH 指向的东西。
//
// 🔴 已知项(NWT 08:28 提出/08:32 坐实具体受害路径,2026-08-04): 下面 DB_PATH/KANET_DB_PATH 两个
// 变量【总是一起设】,今天没有任何分裂风险——但若以后有人只单独设其中一个,两条消费路径各自只认
// 死一个,不会互相兜底:
//   · src/db/client.js:10(assertBettorRefundAuthorized 等走 $db 替换的 helper 走这条)只读 DB_PATH,
//     从不看 KANET_DB_PATH。
//   · test-framework/lib/runner.mjs:20-21(claimAutoDispatcherTick/buildBettorRefundClaim 这类走
//     模块顶层 import、db 来自 client.js 单例的消费者,最终还是落到上面那条 client.js:10)。
// ⇒ 只设 KANET_DB_PATH 不设 DB_PATH 时,client.js 那条路会摸不到 override,悄悄落回生产默认路径
//   ——"断言读到了某个变量" ≠ "实际生效的那条路读的是同一个变量"。今天不改(两个变量总是同时设,
//   不触发),仅记录具体受害路径,供以后任何"只设一个"的改动前先看这条。

function deriveTestDbPath() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // lib → test-framework → data/test-console.db
  return path.join(__dirname, '..', 'data', 'test-console.db');
}

function rebuildTestDb(testDbPath) {
  const dir = path.dirname(testDbPath);
  fs.mkdirSync(dir, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const f = testDbPath + suffix;
    try { if (fs.existsSync(f)) fs.rmSync(f); } catch { /* 删不掉不阻塞, migrate 会在旧文件上出错并暴露问题 */ }
  }
}

if (!process.env.DB_PATH && !process.env.KANET_DB_PATH) {
  const testDbPath = deriveTestDbPath();
  rebuildTestDb(testDbPath);
  process.env.DB_PATH = testDbPath;
  process.env.KANET_DB_PATH = testDbPath;
  // 动态 import: 必须晚于上面两行 env 赋值, 这样 src/db/client.js 的顶层 const 求值时
  // 读到的已经是 test db 路径, 不是生产库路径。
  const { runMigrations } = await import('../../src/db/migrate.js');
  runMigrations();
} else {
  // 尊重显式覆盖(比如手动指了 DB_PATH 想跑真实数据做集成调试)——只提醒,不强制。
  process.stderr.write(`[env-bootstrap] DB_PATH/KANET_DB_PATH 已被显式设置,跳过隔离(${process.env.DB_PATH || process.env.KANET_DB_PATH})\n`);
}
