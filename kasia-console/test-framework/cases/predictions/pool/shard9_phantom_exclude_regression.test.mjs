// Regression guard: excludeSideLockTx optional parameter (2026-07-11, 28mln shard9 phantom-leaf recovery)
//
// docs/2026-07-10-shard9-recovery-design.md — 3 independent raw-SQL consumption points of
// pool_bettor_sides (getSidesByShard/getMarketBets, loadBettorsCrossShard, verifyBettorsCompleteFromChain's
// local-DB fallback) each need to exclude the same set of phantom bet rows from V1 settlement math, keyed
// by side_lock_tx (chain-anchored, identical across every independent committee-voter node) rather than
// the local `id` primary key (SQLite auto-increment, insert-order-dependent per node — NOT safe across
// committee nodes that each run their own separate DB, per J1's machine being genuinely separate).
//
// This test covers gate (ii) from Bettor's 5-gate acceptance (#fcr3t2.1):
//   - passing excludeSideLockTx precisely excludes the matching rows (and only those)
//   - NOT passing it (all pre-existing callers) is byte-identical to pre-change behavior
//
// Same convention as zk_autonomy_ticks_regression.test.mjs: node assert, `node <file>` directly (not the
// declarative test-framework runner — these are JS function calls, not SQL-only checks), fresh migrated
// DB (runMigrations, real schema+triggers, not a live-DB copy — feedback-offline-test-must-use-real-
// schema-with-triggers).
import assert from 'node:assert/strict';
import { pathToFileURL as _pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
// 🔴 硬编码绝对路径 D:/kanet-tn12 已改为【相对本文件】解析(2026-08-04 J1, Bettor 派工 #dmvn2r)。
// D:/kanet-tn12 是旧代码库路径, 本机不存在 ⇒ import 抛 ERR_MODULE_NOT_FOUND, 而 runner 的
// `await import()`(scripts/test.mjs:122) 无 try/catch ⇒ 整批在这里中断, 后面的用例一个都不跑。
// 同一个坑 NWT 在 99b224ee 修过一次(见同目录 c1_folded_shard_anchor_regression.test.mjs:13-14),
// 这两个文件当时漏了 —— 各 agent 的检出路径不同(D:/kanet/KANet vs D:/kanet-tn12), 绝对路径必坏。
import path from 'node:path';
import { fileURLToPath as _fileURLToPath } from 'node:url';
const _HERE = path.dirname(_fileURLToPath(import.meta.url));
const _CONSOLE_ROOT = path.resolve(_HERE, '../../../../');   // → kasia-console
const _SCRATCH = path.resolve(_HERE, '../../../../../scratch'); // → repo root/scratch (gitignored, CLAUDE.md 临时脚本铁律)

const TEST_DB = `${_SCRATCH}/_shard9_exclude_test_${randomUUID().slice(0, 8)}.db`;
mkdirSync(_SCRATCH, { recursive: true });
process.env.DB_PATH = TEST_DB;
const { runMigrations } = await import(_pathToFileURL(path.join(_CONSOLE_ROOT, 'src/db/migrate.js')).href);
runMigrations();

const { sqlite } = await import(_pathToFileURL(path.join(_CONSOLE_ROOT, 'src/db/client.js')).href);
const { getSidesByShard, getMarketBets } = await import(_pathToFileURL(path.join(_CONSOLE_ROOT, 'src/lib/pool-bettor-sides-query.mjs')).href);
const { loadBettorsCrossShard } = await import(_pathToFileURL(path.join(_CONSOLE_ROOT, 'src/services/bshard-close-voter.js')).href);

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.error(`❌ ${msg}`); } else { console.log(`✅ ${msg}`); } }

// ── seed a synthetic bshard market: 1 shard, 3 real bets + 2 "phantom" bets ──
const MKT = `test-shard9-exclude-${randomUUID().slice(0, 8)}`;
const SHARD = `${MKT}-s0`;
const insertMarketRow = sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, resolution_rule_spec)
  VALUES (?, 'test-relay', 'kaspatest:fake-spine', 'deadbeef', 9999999999, 'v0.7', ?, '{}')`);
insertMarketRow.run(MKT, 'verifying');
insertMarketRow.run(SHARD, 'shard_internal'); // shard clone row — market_shards.shard_market_id REFERENCES pool_markets(id)
sqlite.prepare(`INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, current_leaf_outpoint, current_leaf_state, status, created_at)
  VALUES (?, 0, ?, 'kaspatest:fake', 'deadbeef:0', '{}', 'sealed', strftime('%s','now'))`).run(MKT, SHARD);

const rows = [
  { pk: 'aa'.repeat(16), tx: 'real1'.padEnd(64, '0'), stake: 1000000000 },
  { pk: 'bb'.repeat(16), tx: 'real2'.padEnd(64, '0'), stake: 2000000000 },
  { pk: 'cc'.repeat(16), tx: 'real3'.padEnd(64, '0'), stake: 3000000000 },
  { pk: 'dd'.repeat(16), tx: 'phantom1'.padEnd(64, '0'), stake: 4000000000 },
  { pk: 'ee'.repeat(16), tx: 'phantom2'.padEnd(64, '0'), stake: 5000000000 },
];
const insertBet = sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex, pay_amount_sompi)
  VALUES (?, ?, NULL, 0, ?, '', ?, 0, '', ?)`);
for (const r of rows) insertBet.run(SHARD, r.pk, r.stake, r.tx, r.stake);

const excludeSet = [rows[3].tx, rows[4].tx]; // phantom1, phantom2
const REAL_SUM = (1000000000 + 2000000000 + 3000000000).toString();

// ── getSidesByShard ──
const gsAll = getSidesByShard(SHARD, sqlite);
check(gsAll.length === 5, 'getSidesByShard no-arg: returns all 5 rows (backward-compat baseline)');
const gsExcl = getSidesByShard(SHARD, sqlite, excludeSet);
check(gsExcl.length === 3, 'getSidesByShard excludeSideLockTx: excludes exactly the 2 phantom rows');
check(gsExcl.every((r) => !excludeSet.includes(r.side_lock_tx)), 'getSidesByShard excludeSideLockTx: no excluded txid present in result');
const gsAllAfter = getSidesByShard(SHARD, sqlite); // re-call without arg — must be unaffected by the prior excluded call
check(JSON.stringify(gsAllAfter) === JSON.stringify(gsAll), 'getSidesByShard no-arg call is unaffected by a prior excludeSideLockTx call (no shared mutable state)');

// ── getMarketBets ──
const gmAll = getMarketBets(MKT, sqlite);
check(gmAll.betCount === 5 && gmAll.poolSompi === '15000000000', 'getMarketBets no-arg: betCount=5, poolSompi=15000000000 (backward-compat baseline)');
const gmExcl = getMarketBets(MKT, sqlite, excludeSet);
check(gmExcl.betCount === 3, 'getMarketBets excludeSideLockTx: betCount=3');
check(gmExcl.poolSompi === REAL_SUM, `getMarketBets excludeSideLockTx: poolSompi=${REAL_SUM} (only real bets)`);
// unrelated txid list (matches nothing in this shard) → zero side effect, identical to no-arg
const gmIrrelevant = getMarketBets(MKT, sqlite, ['ffffffff'.padEnd(64, '0')]);
check(JSON.stringify(gmIrrelevant) === JSON.stringify(gmAll), 'getMarketBets with a non-matching excludeSideLockTx is byte-identical to no-arg call');

// ── loadBettorsCrossShard ──
const lbAll = loadBettorsCrossShard(MKT);
check(lbAll.length === 5, 'loadBettorsCrossShard no-arg: returns all 5 bettors (backward-compat baseline)');
const lbExcl = loadBettorsCrossShard(MKT, excludeSet);
check(lbExcl.length === 3, 'loadBettorsCrossShard excludeSideLockTx: excludes exactly the 2 phantom rows');
const lbExclSum = lbExcl.reduce((s, b) => s + BigInt(b.stake), 0n).toString();
check(lbExclSum === REAL_SUM, `loadBettorsCrossShard excludeSideLockTx: Σstake=${REAL_SUM} (only real bets)`);
const lbAllAfter = loadBettorsCrossShard(MKT);
check(JSON.stringify(lbAllAfter) === JSON.stringify(lbAll), 'loadBettorsCrossShard no-arg call is unaffected by a prior excludeSideLockTx call');

// ── real 28mln shard9 numbers, as a literal cross-check against the doc's recorded values (not re-derived) ──
check(REAL_SUM !== '64824000000', 'sanity: synthetic fixture Σ is NOT the real 28mln shard9 value (fixture is isolated, not accidentally aliasing prod data)');

console.log(failures === 0 ? `\n✅ ALL PASS (0 failures)` : `\n❌ ${failures} FAILURE(S)`);
// 🔴 顶层 process.exit 会杀死 runner(2026-08-04 J1, Bettor 派工 #dmvn2r; J2 报的根因)。
// scripts/test.mjs:121-124 逐个 `await import()` 每个 *.test.mjs —— 顶层 exit 在【import 阶段】就结束
// 整个 runner 进程 ⇒ walk 顺序排在本文件之后的用例【一个都不会被 import】, 而 runner 以本文件的退出码
// 收场。实测(改前): `--domain=predictions` 零 runner 统计行、exit 0 = 整批看起来"跑完且全过"。
// ⇒ 只在本文件被【直接执行】时才 exit; 被 import 时不碰进程状态(也不设 exitCode —— 本文件无 default
//   export, runner 不计分, 若在这里改 exitCode 会让 runner 的 all-pass 汇总配一个非零退出码, 更难读)。
const _directRun = !!process.argv[1] && _pathToFileURL(process.argv[1]).href === import.meta.url;
if (_directRun) process.exit(failures === 0 ? 0 : 1);
else console.log(`[imported] 本文件是自跑脚本(无 default export), runner 不计分; 自身判定=${failures === 0 ? 'PASS' : 'FAIL'}`);
