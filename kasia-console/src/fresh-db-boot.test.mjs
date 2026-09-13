// fresh-db-boot.test.mjs — 全启动路径 fresh-DB 冒烟回归 (2026-09-13, J2 · Bettor 插队派单, 挡 GO-C)。
//
// 只修 context.js 那一处不够——同类 bug(ESM 静态 import 把某模块顶层立即执行的 sqlite.prepare/exec 提升到
// index.js:121 runMigrations() 之前)可能藏在 index.js 整条 import 图里的任何一个文件。本测试真起一次 Console
// 主进程(spawnSync + timeout, 不改 index.js 一行), 对着一个真·全新(0 表)DB, 断言：
//   H1  子进程输出里不出现任何 SqliteError / "no such table" 字样(= 整条启动路径上没有第二个同类坑)。
//   H2  能看到 "[migrate] DB migrations complete." (= runMigrations() 真的跑完, 不是提前崩溃侥幸没报错)。
//   H3  能看到至少一行 cron/daemon 的 "started" 日志(= migrate 完成后续代码真的继续执行, 不是卡在别处)。
//   H4  子进程退出前没有 uncaughtException/unhandledRejection 堆栈(index.js 自己的顶层 catch 之外的漏网)。
// Run: cd kasia-console && node src/fresh-db-boot.test.mjs
import { spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';

if (!process.env._FRESHDB_BOOT_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_freshdb_boot_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _FRESHDB_BOOT_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const tmpDb = process.env.DB_PATH;
// 不手动预建 DB 文件(M0a 门只认 db/client.js 一个 sqlite 入口, 见 scripts/m0a-lib.mjs SHADOW_ALLOWLIST)——
// tmpDb 指向的路径本来就不存在, 子进程里 index.js 转引 db/client.js 的 `new Database(dbPath)` 自己会创建
// 一个全新空文件(4096B 文件头, 0 表), 精确复现 Bettor 报告的现场。

// 真起一次 Console 主进程, 只给启动路径不炸所需的最小 env(不是完整生产 kanet.env——那些项与本次回归无关)。
// timeout: Node 内建的 child_process timeout 到点用 killSignal 结束子进程并保留已捕获的 stdout/stderr, 跨平台(含 Windows)可靠。
const key = crypto.randomBytes(32).toString('hex');
const r = spawnSync(process.execPath, ['--input-type=module', '-e', "import('./src/index.js').catch(e=>{console.error('BOOT-IMPORT-FAIL:',e.stack);process.exit(1);});"], {
  cwd: process.cwd(),
  env: {
    ...process.env, DB_PATH: tmpDb,
    KASPA_RPC_URL: 'ws://127.0.0.1:17110', KASPA_NETWORK: 'mainnet',
    BROKER_RELAY_ID: 'j2-freshdb-boot-test-stub',
    CONSOLE_ENCRYPTION_KEY: key,
    PORT: '0',
  },
  timeout: 8000, killSignal: 'SIGKILL',
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
});
const out = `${r.stdout || ''}\n${r.stderr || ''}`;

ok(!/SqliteError|no such table/i.test(out), 'H1: 启动路径全程零 SqliteError/no such table(同类坑没有藏在别处)');
ok(/\[migrate\] DB migrations complete\./.test(out), 'H2: runMigrations() 真的跑完(不是提前崩溃侥幸没报 SqliteError)');
ok(/\bstarted\b/.test(out), 'H3: migrate 完成后续代码真的继续执行(至少一个 cron/daemon started)');
ok(!/UnhandledPromiseRejection|uncaughtException/i.test(out), 'H4: 无未捕获异常/未处理拒绝');

if (fails) { console.log('\n--- captured output (for diagnosis) ---'); console.log(out.split('\n').slice(0, 60).join('\n')); }

// harness 翻转臂: 直接断言 H1 的反面(真实捕获的 out 里"确实出现" SqliteError)——只有当 out 里真没有这串
// 字样时这一行才会如实变红, 证明翻转臂读的是同一份真实捕获输出, 不是摆设。
{ const before = fails; ok(/SqliteError|no such table/i.test(out), 'harness-flip (expect FAIL)'); if (fails === before + 1) { fails--; console.log('  ✅ harness flip arm went red as required'); } else { fails++; } }

console.log(fails ? `\n❌ ${fails} failure(s)` : '\n✅ fresh-db full boot path: zero SqliteError, migrations completed, daemons started');
process.exit(fails ? 1 : 0);
