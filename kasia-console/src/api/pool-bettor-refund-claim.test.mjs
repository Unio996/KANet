// pool-bettor-refund-claim.test.mjs — buildBettorRefundClaim 抽取回归(2026-07-14, Bettor #k0i054
// 修法A: legacyRefundBuilderTick 自 fetch 死锁修复)。真 migration 库 + 真函数(非复刻)。覆盖不需要
// relay/chain 交互的快速失败分支(参数校验/market不存在/bshard拒绝/side不存在/锁仓校验) —— 走到
// signing relay resolve 之后的成功路径需要真 relay IPC, 属 e2e 范围, 不在本离线单测覆盖。
// Run: cd kasia-console && node src/api/pool-bettor-refund-claim.test.mjs   (自举同 pregate.test.mjs)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._REFUND_CLAIM_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_refundclaim_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _REFUND_CLAIM_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { buildBettorRefundClaim } = await import('./pool.js');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

sqlite.pragma('foreign_keys = OFF');

const info = sqlite.pragma('table_info(pool_markets)');
const required = info.filter(c => c.notnull === 1 && c.dflt_value == null && c.name !== 'id');
function seedMarket(id, { protocolVersion = 'v0.7', deadline = 1000 } = {}) {
  const cols = ['id', ...required.map(c => c.name), 'protocol_version', 'protocol_status', 'deadline', 'metadata', 'resolution_rule_spec', 'maker_pk', 'broker_pk', 'pool_merkle_root'];
  const uniq = [...new Set(cols)];
  const vals = uniq.map(c => {
    if (c === 'id') return id;
    if (c === 'protocol_version') return protocolVersion;
    if (c === 'protocol_status') return 'verifying';
    if (c === 'deadline') return deadline;
    if (c === 'metadata') return '{}';
    if (c === 'resolution_rule_spec') return '{}';
    if (c === 'maker_pk' || c === 'broker_pk') return 'f0'.repeat(32);
    if (c === 'pool_merkle_root') return 'e0'.repeat(32);
    const rc = required.find(r => r.name === c);
    return rc && (rc.type === 'INTEGER' || rc.type === 'REAL') ? 0 : 'x';
  });
  sqlite.prepare(`INSERT INTO pool_markets (${uniq.join(',')}) VALUES (${uniq.map(() => '?').join(',')})`).run(...vals);
}
function insertDyn(table, fields) {
  const req = sqlite.pragma(`table_info(${table})`).filter(c => c.notnull === 1 && c.dflt_value == null && !(c.name in fields) && c.pk === 0);
  const all = { ...fields };
  for (const c of req) all[c.name] = (c.type === 'INTEGER' || c.type === 'REAL') ? 0 : 'x';
  const cols = Object.keys(all);
  sqlite.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => all[c]));
}

console.log('[test] buildBettorRefundClaim 快速失败分支(不需要 relay/chain 交互):');
{
  const r1 = await buildBettorRefundClaim('nonexistent-market', {});
  ok(r1.ok === false && r1.httpStatus === 400, '缺 bettor_pk 和 side_id → 400');

  const r2 = await buildBettorRefundClaim('nonexistent-market', { sideId: 1 });
  ok(r2.ok === false && r2.httpStatus === 404 && r2.error === 'market not found', 'market 不存在 → 404');

  seedMarket('m-bshard-reject');
  insertDyn('market_shards', { logical_market_id: 'm-bshard-reject', shard_market_id: 'm-bshard-reject-s0', shard_index: 0, status: 'sealed' });
  const r3 = await buildBettorRefundClaim('m-bshard-reject', { sideId: 1 });
  ok(r3.ok === false && r3.httpStatus === 409 && r3.refund_path === 'bshard_fold', 'bshard 市场 → 409 拒绝(路由到 fold path)');

  seedMarket('m-no-side');
  const r4 = await buildBettorRefundClaim('m-no-side', { sideId: 9999 });
  ok(r4.ok === false && r4.httpStatus === 404 && r4.error.includes('side row not found'), 'side 不存在 → 404');

  seedMarket('m-side-unlocked');
  insertDyn('pool_bettor_sides', { id: 501, market_id: 'm-side-unlocked', bettor_pk: 'aa'.repeat(32), stake_amount: '100000000', direction: 1, side_lock_tx: null, side_redeem_script_hex: 'ab' });
  const r5 = await buildBettorRefundClaim('m-side-unlocked', { sideId: 501 });
  ok(r5.ok === false && r5.httpStatus === 409 && r5.error.includes('not yet locked'), 'side 未锁仓(side_lock_tx=null) → 409');

  seedMarket('m-side-no-redeem');
  insertDyn('pool_bettor_sides', { id: 502, market_id: 'm-side-no-redeem', bettor_pk: 'bb'.repeat(32), stake_amount: '100000000', direction: 1, side_lock_tx: 'cc'.repeat(32), side_redeem_script_hex: null });
  const r6 = await buildBettorRefundClaim('m-side-no-redeem', { sideId: 502 });
  ok(r6.ok === false && r6.httpStatus === 409 && r6.error.includes('missing redeem_script_hex'), 'side 缺 redeem_script_hex → 409');

  // 无本地 relay 匹配(relay_nodes 空表)—— 这正是 70-ojizv/legacy-refund 现场撞的那个 error 形状。
  seedMarket('m-side-no-relay');
  insertDyn('pool_bettor_sides', { id: 503, market_id: 'm-side-no-relay', bettor_pk: 'cc'.repeat(32), stake_amount: '100000000', direction: 1, side_lock_tx: 'dd'.repeat(32), side_redeem_script_hex: 'ab' });
  const r7 = await buildBettorRefundClaim('m-side-no-relay', { sideId: 503 });
  ok(r7.ok === false && r7.httpStatus === 404 && r7.error.includes('no local relay matches'), '无本地 relay 匹配 → 404(与生产实况同款错误文案)');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — buildBettorRefundClaim 快速失败分支覆盖(抽取后行为与原 HTTP handler 逐条一致)'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
