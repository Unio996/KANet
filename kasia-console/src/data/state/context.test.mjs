// context.test.mjs — regression for fresh-db-first-start (2026-09-13, J2 · Bettor 插队派单, 挡 GO-C)。
// 守什么:
//   H1  context.js 在 runMigrations() 之前 import(= ESM 静态 import 提升到任何调用方顶层语句之前的真实场景)
//       不许抛 —— 原 bug: 模块顶层立即 sqlite.prepare(...) 早于 index.js:121 的 runMigrations(), 全新空 DB(0 表)
//       首启直接 SqliteError: no such table: identities, 进程崩。lazy 化后 import 本身不碰 DB。
//   H2  迁移完成后调用 getContextByAddress() 真正命中 lazy prepare, 返回 null(无匹配行), 不抛。
//   H3  翻转臂: 故意在 runMigrations() 之前就调用 getContextByAddress() —— 这时【必须】抛(表还不存在),
//       证明 H1 的"不抛"不是因为 lazy 化把真实的表依赖也一起吞掉了(H1 只证 import 安全, 不证调用时机无关紧要)。
// Run: cd kasia-console && node src/data/state/context.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._CONTEXT_FRESHDB_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_context_freshdb_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  // 关键: 这里【不】先跑 run-migrations.mjs —— 本测试的全部意义就是验证"DB 文件不存在/0 表"这一刻 import 安全。
  // 不手动预建文件: DB_PATH 指向不存在的路径, db/client.js 里 `new Database(dbPath)` 自己会创建一个全新空
  // sqlite 文件(4096B 文件头, 0 表)——跟 better-sqlite3 auto-create 语义一致, 也省一次裸 import(M0a 门只认
  // db/client.js 一个入口, 见 scripts/m0a-lib.mjs SHADOW_ALLOWLIST)。
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _CONTEXT_FRESHDB_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

// H1: import 在 0 表状态下不许抛
let mod, importErr = null;
try { mod = await import('./context.js'); } catch (e) { importErr = e; }
ok(!importErr && typeof mod.getContextByAddress === 'function', `H1: import(0 表 DB) 不抛${importErr ? ` (实际: ${importErr.message})` : ''}`);

// H3(翻转前置): 表还不存在时真的调用 ⇒ 必须抛(证明 lazy 化没有连带把"表必须存在"这条真实约束一起吞掉)
let calledBeforeMigrateThrew = false;
try { mod.getContextByAddress('kaspa:qtest', 'mainnet'); } catch { calledBeforeMigrateThrew = true; }
ok(calledBeforeMigrateThrew, 'H3: runMigrations() 之前真的调用 → 仍然抛(lazy 化只挪时机, 不吞掉表依赖)');

// 现在真正迁移
execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env }, stdio: 'pipe' });

// H2: 迁移完成后调用 ⇒ 不抛, 无匹配行返回 null
let afterErr = null, result;
try { result = mod.getContextByAddress('kaspa:qtest-nonexistent', 'mainnet'); } catch (e) { afterErr = e; }
ok(!afterErr && result === null, `H2: 迁移后调用 → 不抛, 无匹配返回 null${afterErr ? ` (实际: ${afterErr.message})` : ''}`);

// harness 翻转臂
{ const before = fails; ok(afterErr !== null, 'harness-flip (expect FAIL)'); if (fails === before + 1) { fails--; console.log('  ✅ harness flip arm went red as required'); } else { fails++; } }

console.log(fails ? `\n❌ ${fails} failure(s)` : '\n✅ all fresh-db context.js vectors passed');
process.exit(fails ? 1 : 0);
