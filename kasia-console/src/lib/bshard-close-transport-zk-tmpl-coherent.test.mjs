// bshard-close-transport-zk-tmpl-coherent.test.mjs — regression guard for assertZkHandoffTmplCoherent
// (J2 design docs/2026-09-14-j2-t4-genesis-compare-tool-v0.2-gap-closure-and-hard-gate-design.md §3,
// Bettor 1288 派工落码): buildZkHandoffRequestV2 铸 CloseZkV2 时(genesis②)必须用跟这个市场自己
// genesis①(pool.js:_resolveZkNativeCtorExtras 铸 PayoutShardV2 时)一致的 token_tmpl_hash/
// claim_tmpl_hash/market_suffix_hash，否则四段模板跟链上已烤的 anchor 对不上。
//
// assertZkHandoffTmplCoherent 是纯函数(接收 psRow 普通对象 + marketId + envVals，不自己碰 DB)，
// 单测直接构造对象，不需要真实 sqlite seed——但导入 bshard-close-transport.mjs 本身会触发
// db/client.js 的 DB_PATH 解析(模块顶层 side effect)，所以仍需同款 bootstrap 拿一个隔离临时库，
// 不是为了 seed 数据，是为了让 import 本身不 throw。
//
// Run: cd kasia-console && node src/lib/bshard-close-transport-zk-tmpl-coherent.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._ZKTMPLCOHERENT_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_zktmplcoherent_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _ZKTMPLCOHERENT_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { assertZkHandoffTmplCoherent } = await import('./bshard-close-transport.mjs');
const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const TTH = 'aa'.repeat(32), CTH = 'bb'.repeat(32), MSH = 'cc'.repeat(32);
const goodRow = { token_tmpl_hash: TTH, claim_tmpl_hash: CTH, market_suffix_hash: MSH };
const goodEnv = { tokenTmplHash: TTH, claimTmplHash: CTH, marketSuffixHash: MSH };

console.log('[test] positive: DB 三列跟 env 现值逐字段一致(大小写不敏感)→ 不 throw:');
{
  let threw = null;
  try { assertZkHandoffTmplCoherent(goodRow, 'mk-good', goodEnv); } catch (e) { threw = e; }
  ok(threw === null, `一致时不 throw (got: ${threw?.message})`);
  // 大小写不敏感 sanity: env 传大写，DB 是小写，仍应视为一致。
  let threwUpper = null;
  try { assertZkHandoffTmplCoherent(goodRow, 'mk-good-upper', { tokenTmplHash: TTH.toUpperCase(), claimTmplHash: CTH.toUpperCase(), marketSuffixHash: MSH.toUpperCase() }); } catch (e) { threwUpper = e; }
  ok(threwUpper === null, `大小写不同但值相同(hex 不区分大小写)不 throw (got: ${threwUpper?.message})`);
}

console.log('[test] negative①: 查无此 payout_shards 行(psRow=null)→ throw，reason 指名 marketId:');
{
  let threw = null;
  try { assertZkHandoffTmplCoherent(null, 'mk-no-row', goodEnv); } catch (e) { threw = e; }
  ok(threw != null, `throws (got: ${threw ? 'threw' : 'NO THROW — REGRESSION'})`);
  ok(threw && /mk-no-row/.test(threw.message) && /找不到 payout_shards 行/.test(threw.message), `reason 含 marketId + "找不到 payout_shards 行" (got: ${threw?.message})`);
}

console.log('[test] negative②: DB 该市场三列之一是 NULL(D-019 之前的旧市场)→ throw，reason 指名字段名:');
{
  const rowWithNull = { token_tmpl_hash: null, claim_tmpl_hash: CTH, market_suffix_hash: MSH };
  let threw = null;
  try { assertZkHandoffTmplCoherent(rowWithNull, 'mk-null-col', goodEnv); } catch (e) { threw = e; }
  ok(threw != null, `throws (got: ${threw ? 'threw' : 'NO THROW — REGRESSION'})`);
  ok(threw && /mk-null-col/.test(threw.message) && /token_tmpl_hash/.test(threw.message) && /NULL/.test(threw.message), `reason 含 marketId + 字段名 token_tmpl_hash + "NULL" (got: ${threw?.message})`);
}

console.log('[test] negative③: env 值缺失(defensive 兜底, 调用点通常已检查过)→ throw，reason 指名字段名:');
{
  let threw = null;
  try { assertZkHandoffTmplCoherent(goodRow, 'mk-env-missing', { tokenTmplHash: '', claimTmplHash: CTH, marketSuffixHash: MSH }); } catch (e) { threw = e; }
  ok(threw != null, `throws (got: ${threw ? 'threw' : 'NO THROW — REGRESSION'})`);
  ok(threw && /mk-env-missing/.test(threw.message) && /token_tmpl_hash/.test(threw.message) && /env 现值为空/.test(threw.message), `reason 含 marketId + 字段名 + "env 现值为空" (got: ${threw?.message})`);
}

console.log('[test] negative④: DB 值与 env 现值不一致(env 在市场创建之后被改过)→ throw，reason 含 marketId + 字段名 + 两边的值:');
{
  const driftedEnv = { tokenTmplHash: TTH, claimTmplHash: 'dd'.repeat(32), marketSuffixHash: MSH };
  let threw = null;
  try { assertZkHandoffTmplCoherent(goodRow, 'mk-drifted', driftedEnv); } catch (e) { threw = e; }
  ok(threw != null, `throws (got: ${threw ? 'threw' : 'NO THROW — REGRESSION'})`);
  ok(threw && /mk-drifted/.test(threw.message) && /claim_tmpl_hash/.test(threw.message) && new RegExp(CTH).test(threw.message) && /dd{32}|d{64}/i.test(threw.message), `reason 含 marketId + 字段名 claim_tmpl_hash + db 值 + env 值 (got: ${threw?.message})`);
}

console.log('[test] wiring: buildZkHandoffRequestV2 真的在 ZK_TOKEN_TMPL_HASH env 检查之后、computeCloseZkTmplAnchor 之前调用了 assertZkHandoffTmplCoherent(不是定义了但没接线):');
{
  const srcPath = fileURLToPath(new URL('./bshard-close-transport.mjs', import.meta.url));
  const src = readFileSync(srcPath, 'utf8');
  const envCheckIdx = src.indexOf("ZK_MARKET_SUFFIX_HASH env 必需");
  const callIdx = src.indexOf('assertZkHandoffTmplCoherent(ps, marketId');
  const computeIdx = src.indexOf('computeCloseZkTmplAnchor(closeZkSilPath, gateTmplHash, process.env.ZK_TOKEN_TMPL_HASH');
  ok(envCheckIdx >= 0 && callIdx >= 0 && computeIdx >= 0, `全部三个锚点都在源码里找到 (envCheckIdx=${envCheckIdx}, callIdx=${callIdx}, computeIdx=${computeIdx})`);
  ok(envCheckIdx < callIdx && callIdx < computeIdx, `顺序正确: env 检查 < assertZkHandoffTmplCoherent 调用 < computeCloseZkTmplAnchor 调用(在任何真实模板计算之前拦)`);
}

console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
