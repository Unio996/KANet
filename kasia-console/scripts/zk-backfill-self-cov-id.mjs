#!/usr/bin/env node
// zk-backfill-self-cov-id.mjs — 账本1893 票: 一次性补写 pool_markets.metadata.zk_self_cov_id(见 src/lib/zk-self-cov-backfill.mjs)。
//
// 默认 DRY-RUN(不写库)。真写必须显式 --apply, 且应在 console 重启(带 stampSelfCovId 的版本上线)之后由 Bettor 跑。
// 只碰这一个字段: 单条 SQL json_set, 首写为准, 已有值一律不覆盖。
//
// 用法:
//   DB_PATH=<console 库绝对路径> node scripts/zk-backfill-self-cov-id.mjs --market <完整盘 id> --cov-id <64hex> [--apply]
// 取值与核对方法见 docs/provenance/2026-10-12-j2-zk-self-cov-backfill/README.md(cov id 取自链上 claim 交易输入, 并与重算的 claim redeem 对过)。
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const apply = argv.includes('--apply');
const market = opt('--market'), covId = opt('--cov-id');
if (!process.env.DB_PATH) { console.error('[backfill] 需要 DB_PATH(显式指向库)'); process.exit(2); }
if (!market || !covId) { console.error('[backfill] 需要 --market <完整盘 id> 与 --cov-id <64hex>'); process.exit(2); }
const { sqlite } = await import('../src/db/client.js');
const { backfillSelfCovId } = await import('../src/lib/zk-self-cov-backfill.mjs');
const r = backfillSelfCovId(sqlite, market, covId, { apply });
console.log(`[backfill] ${apply ? 'APPLY' : 'DRY-RUN(不写库)'} market=${market}`);
console.log(`[backfill] 目标: metadata.zk_self_cov_id = ${String(covId).toLowerCase()}`);
console.log(`[backfill] 结果: ${JSON.stringify(r)}`);
if (!apply && r.action === 'would_write') console.log(`[backfill] 将执行: UPDATE pool_markets SET metadata = json_set(metadata,'$.zk_self_cov_id',<cov id>) WHERE id=<market> AND json_valid(metadata) AND json_extract(metadata,'$.zk_self_cov_id') IS NULL`);
process.exit(r.ok ? 0 : 1);
