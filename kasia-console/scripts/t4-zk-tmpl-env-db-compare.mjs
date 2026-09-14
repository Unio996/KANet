#!/usr/bin/env node
// t4-zk-tmpl-env-db-compare.mjs — T4 创世对照工具第一片(J2, ledger 1214/1236/1266, 方案
// docs/2026-09-14-j2-t4-genesis-compare-tool-implementation-plan-v0.1.md 的窄化起点)。
//
// 只读输出：当前配置的三个 ZK_* env 值（ZK_TOKEN_TMPL_HASH/ZK_CLAIM_TMPL_HASH/ZK_MARKET_SUFFIX_HASH，
// pool.js/bshard-close-transport.mjs 里 computeCloseZkTmplAnchor 调用点 fail-loud 要求的那三个）跟
// payout_shards 表里每个已存在市场自己 declare 过的 token_tmpl_hash/claim_tmpl_hash/market_suffix_hash
// 列逐字段对照——这三列是 D-019 迁移(v205)加的，"谁编译谁 declare"纪律：创世时真实烤进 redeem 的值存
// 在这三列，跟"现在配置的 ZK_* env 是不是还是那个值"是两件独立的事，不能假设两者永远一致。
//
// 不写 env。不碰写 DB 的任何 API——本脚本自始至终只调用 .prepare(...).all()/.get()（SELECT），
// 一行 INSERT/UPDATE/DELETE/pragma-write 都没有，靠"代码里根本没写"这件事保证零写，不是靠打开模式。
//
// 🔴 M0a 裸 import 差分门(docs/2026-07-22-m0a-bare-import-differential-lint-design.md)不允许新文件
// 裸引入 sqlite 驱动包本体——按既有纪律(scratch/feedback: "M0a 门只在 staged diff
// 跑·测试拿 DB = DB_PATH 临时库 + import client.js")走已在 baseline 里的唯一合法通道：
// `../src/db/client.js` 的 `sqlite` 单例。该模块的 `resolveDbPath()` 要求非 console 入口必须显式
// `DB_PATH=<abs path>`（否则 throw，见该文件头注"20 个只读脚本以后显式 DB_PATH=… 是一次性成本"）——
// 本脚本延续这个既有纪律，不发明第二套"默认路径"逻辑，也不会因为一个隐藏默认值而不小心对着错的库跑
// （J2 1266 教训：读错 data/console.db 当成活库，根源就是"某处有个默认路径假设"）。
//
// 用法：
//   DB_PATH=<repo>/kasia-console/data/console.mainnet.db node scripts/t4-zk-tmpl-env-db-compare.mjs [--market=<logical_market_id>]
//   （主网活库路径；2026-09-14 Bettor 只读实测确认过 pool_markets=0/payout_shards=0，D-017 后的真实
//   主网库——不是 data/console.db，那份是旧网遗留库，无进程服务，见 docs/DATABASE.md v205 条目状态
//   注记）。--market 只看一个市场；不给则列出该家族全部。
//
// 退出码：恒 0（这是信息性报告，不是闸；后续若要接进 assertGenesisTemplatesCoherent 那条硬门再另议）。

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ZK_ENV_KEYS = ['ZK_TOKEN_TMPL_HASH', 'ZK_CLAIM_TMPL_HASH', 'ZK_MARKET_SUFFIX_HASH'];
const DB_COL_BY_ENV_KEY = {
  ZK_TOKEN_TMPL_HASH: 'token_tmpl_hash',
  ZK_CLAIM_TMPL_HASH: 'claim_tmpl_hash',
  ZK_MARKET_SUFFIX_HASH: 'market_suffix_hash',
};

function parseArgs(argv) {
  const out = { market: null };
  for (const a of argv) {
    if (a.startsWith('--market=')) out.market = a.slice('--market='.length);
  }
  return out;
}

/** 只读解析 kanet.env 的 KEY=VALUE 行(不 export，不改动进程 env，不依赖 dotenv 库)——process.env 里没有
 * 才退回读这个文件，标注来源，让报告的人知道这个值到底是"进程真的带着这个 env 跑"还是"配置文件里写了但
 * 这次调用没传"两种不同的事实。 */
function readKanetEnvFile() {
  const p = join(REPO_ROOT, 'kanet.env');
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function resolveZkEnvValue(key, kanetEnvFile) {
  if (process.env[key]) return { value: process.env[key], source: 'process.env' };
  if (kanetEnvFile[key]) return { value: kanetEnvFile[key], source: 'kanet.env(未被进程实际带上, 只是配置文件里写了)' };
  return { value: null, source: 'MISSING(两处都没有)' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('=== T4 ZK_* env vs DB 现值对照（只读，零写）===\n');

  const kanetEnvFile = readKanetEnvFile();
  console.log('--- ZK_* env 当前状态 ---');
  const envResolved = {};
  for (const key of ZK_ENV_KEYS) {
    const r = resolveZkEnvValue(key, kanetEnvFile);
    envResolved[key] = r;
    console.log(`  ${key} = ${r.value ? r.value : '(未设置)'}  [来源: ${r.source}]`);
  }
  const anyMissing = ZK_ENV_KEYS.some(k => !envResolved[k].value);
  if (anyMissing) {
    console.log('\n  🔴 至少一个 ZK_* 缺失 — pool.js:_resolveZkNativeCtorExtras / bshard-close-transport.mjs:');
    console.log('     buildZkHandoffRequestV2 的 fail-loud 检查会直接 throw，ZK-native(v2_zk)市场创世/close-transport');
    console.log('     在这个进程环境下现在跑不通（这不是本工具的判断，是那两处代码本来就有的检查——本工具只是');
    console.log('     把"env 到底有没有配"从要去翻两个源码文件才知道，变成一行就能看见）。');
  }

  // 🔴 zero-write 铁律的最窄防线: better-sqlite3 `new Database(path)`(db/client.js 内部用的正是这个
  // 默认打开模式, 没有 readonly)对不存在的路径会**静默新建一个空 sqlite 文件**——这本身就是一次写。
  // 在 import db/client.js(会立刻执行这个 open)之前, 先用纯 fs.existsSync 核一遍 DB_PATH 指向的文件
  // 真的已经存在, 不存在就直接拒绝继续, 不给 client.js 任何"顺手建库"的机会。
  if (!process.env.DB_PATH) {
    console.log('\n  ⚠ 未设置 DB_PATH — 只报告 env 侧状态(见上)，跳过 DB 对照。设 DB_PATH=<abs path> 到目标库(建议主网活库 console.mainnet.db)重跑。');
    process.exit(0);
  }
  const dbPath = resolve(process.env.DB_PATH);
  console.log(`\nDB: ${dbPath}`);
  if (!existsSync(dbPath)) {
    console.log('  ⚠ 文件不存在 — 拒绝继续(避免 db/client.js 的默认打开模式静默新建空库这个写副作用)。仅报告 env 侧状态。');
    process.exit(0);
  }

  // 走既有唯一合法通道(M0a 裸 import 差分门只放行 baseline 里已有的 better-sqlite3 调用点——
  // db/client.js 在 baseline 里, 本脚本不新增裸 import)。DB_PATH 已在上面确认存在且已设, resolveDbPath
  // 会直接采用它, 不会走"非 console 入口且无 DB_PATH ⇒ throw"那条分支, 也不会走 console-entry 默认路径。
  const { sqlite } = await import('../src/db/client.js');

  const cols = sqlite.prepare('PRAGMA table_info(payout_shards)').all().map(c => c.name);
  const hasV205Cols = Object.values(DB_COL_BY_ENV_KEY).every(c => cols.includes(c));
  console.log(`\n--- payout_shards 表状态 ---`);
  console.log(`  v205 三列(token_tmpl_hash/claim_tmpl_hash/market_suffix_hash)存在: ${hasV205Cols ? '是' : '否(这台库还没跑过 v205 迁移)'}`);
  if (!hasV205Cols) { process.exit(0); }

  const where = args.market ? 'WHERE logical_market_id = ?' : "WHERE covenant_family = 'v2_zk'";
  const rows = args.market
    ? sqlite.prepare(`SELECT logical_market_id, covenant_family, token_tmpl_hash, claim_tmpl_hash, market_suffix_hash, created_at FROM payout_shards ${where}`).all(args.market)
    : sqlite.prepare(`SELECT logical_market_id, covenant_family, token_tmpl_hash, claim_tmpl_hash, market_suffix_hash, created_at FROM payout_shards ${where}`).all();

  console.log(`\n--- 逐市场对照(${args.market ? `指定 market=${args.market}` : "covenant_family='v2_zk'，ZK_* 只影响这个家族的 CloseZkV2 anchor"}) ---`);
  if (rows.length === 0) {
    console.log('  (无匹配市场 — 这台库当前没有可对照的行，不代表配置没问题，只代表没有实例可比)');
  }
  for (const row of rows) {
    console.log(`\n  市场 ${row.logical_market_id} (${row.covenant_family}, created_at=${row.created_at}):`);
    for (const envKey of ZK_ENV_KEYS) {
      const dbCol = DB_COL_BY_ENV_KEY[envKey];
      const dbVal = row[dbCol];
      const envVal = envResolved[envKey].value;
      let verdict;
      if (dbVal == null) verdict = 'DB_NULL(该市场创世时这列没写值——D-019 迁移前的旧市场，或写入方漏传)';
      else if (!envVal) verdict = 'ENV_MISSING(DB 有值但当前 env 没配，无法对照)';
      else if (dbVal.toLowerCase() === envVal.toLowerCase()) verdict = '✅ 一致';
      else verdict = `❌ 不一致(db=${dbVal}, env=${envVal}) — 若这个市场之后还要 recompile/续约，用当前 env 会算出跟创世时不同的字节`;
      console.log(`    ${dbCol.padEnd(18)} db=${dbVal || '(null)'}  env=${envVal || '(未设置)'}  → ${verdict}`);
    }
  }
  console.log('\n=== 对照完毕(只读，未写任何东西) ===');
  process.exit(0);
}

main();
