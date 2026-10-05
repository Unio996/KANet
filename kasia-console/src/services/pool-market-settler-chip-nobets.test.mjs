// pool-market-settler-chip-nobets.test.mjs — 账本1862: 旧 settler 对 ZK 筹码盘(无 spine, metadata.no_spine)的处理。
//   ① 0 注盘过 deadline+宽限 ⇒ cancelled/no_bets, 不 dispatchRefund(没有链上资金);  ② 有 ≥1 注(有 shard 行 / 有 bettor 行)⇒ 不碰, 留给 ZK close;
//   ③ legacy KAS 盘(有 spine)⇒ handleNoSpineChipMarket 返回 skip:false, 老 min-pot 行为不变;  ④ dispatchRefund 对无 spine 筹码盘不进 buildMakerRefundPreimage。
// Run: cd kasia-console && node src/services/pool-market-settler-chip-nobets.test.mjs   (自举: 临时 migration 库)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
if (!process.env._CHIPNB_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_chipnb_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _CHIPNB_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
process.env.KASPA_NETWORK = 'simnet';
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const { sqlite } = await import('../db/client.js');
const S = await import('./pool-market-settler.js');
sqlite.pragma('foreign_keys = OFF');

const fill = (table, row) => { const info = sqlite.pragma(`table_info(${table})`).filter((c) => c.notnull === 1 && c.dflt_value == null && c.name !== 'id' && !c.pk); for (const c of info) if (!(c.name in row)) row[c.name] = /INT/i.test(c.type) ? 1 : 'x'; return row; };
const ins = (table, row) => { row = fill(table, row); sqlite.prepare(`INSERT OR REPLACE INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row)); };
const NOW = 2_000_000_000;
const market = (id, over = {}) => { ins('pool_markets', { id, maker_relay_id: 'maker-x', protocol_version: 'v0.7', protocol_status: 'verifying', spine_p2sh: null, maker_stake_amount: 0, deadline: NOW - 3600, metadata: JSON.stringify({ no_spine: true, no_kas_stake: true }), resolution_rule_spec: JSON.stringify({ zk_native: true }), ...over }); return sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(id); };
const status = (id) => sqlite.prepare('SELECT protocol_status s, metadata m FROM pool_markets WHERE id = ?').get(id);
const warns = []; const w0 = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); };

console.log('[test] 1. isNoSpineChipMarket');
{
  ok(S.isNoSpineChipMarket({ metadata: '{"no_spine":true}', spine_p2sh: null }) === true, 'no_spine=true 且无 spine_p2sh ⇒ 筹码盘');
  ok(S.isNoSpineChipMarket({ metadata: '{"no_spine":true}', spine_p2sh: 'kaspa:pxx' }) === false, '有 spine_p2sh ⇒ 不是(防误判 legacy)');
  ok(S.isNoSpineChipMarket({ metadata: '{}', spine_p2sh: null }) === false, '无 no_spine 标记 ⇒ 不是');
  ok(S.isNoSpineChipMarket({ metadata: '{bad', spine_p2sh: null }) === false, '坏 metadata ⇒ 不是(fail-safe: 走老路)');
}

console.log('[test] 2. 0 注盘: deadline+宽限 之前不取消; 之后取消为 no_bets 且不动其它');
{
  const m = market('m-zero');
  const g = S.handleNoSpineChipMarket(m, sqlite, NOW - 3600 + 100);   // deadline 后 100s < 宽限 300s
  ok(g.skip === true && g.action === 'grace' && status('m-zero').s === 'verifying', `宽限内 ⇒ 不取消(实 ${g.action})`);
  const r = S.handleNoSpineChipMarket(m, sqlite, NOW);
  const st = status('m-zero'); const meta = JSON.parse(st.m);
  ok(r.skip === true && r.action === 'cancelled_no_bets' && st.s === 'cancelled', `过宽限 ⇒ cancelled(实 ${r.action}/${st.s})`);
  ok(meta.cancel_reason === 'no_bets' && meta.cancel_pool_sompi === '0' && meta.no_spine === true && typeof meta.cancelled_at === 'string', 'cancel_reason=no_bets(不是 min_pot_undersize), 原 metadata 保留');
  const again = S.handleNoSpineChipMarket(sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get('m-zero'), sqlite, NOW);
  ok(again.skip === true && again.action === 'left_to_zk_path', '已 cancelled ⇒ 再调不重复写');
}

console.log('[test] 3. 有注的筹码盘: 不取消(留给 ZK close)');
{
  const m1 = market('m-shard'); ins('market_shards', { logical_market_id: 'm-shard', shard_market_id: 'm-shard-s0', shard_index: 0 });
  const r1 = S.handleNoSpineChipMarket(m1, sqlite, NOW);
  ok(r1.skip === true && r1.action === 'left_to_zk_path' && status('m-shard').s === 'verifying', '有 shard 行 ⇒ 不碰');
  const m2 = market('m-bets'); ins('pool_bettor_sides', { market_id: 'm-bets', bettor_pk: 'ab'.repeat(32), direction: 0, stake_amount: 1, side_p2sh: 'p' });
  const r2 = S.handleNoSpineChipMarket(m2, sqlite, NOW);
  ok(r2.skip === true && r2.action === 'left_to_zk_path' && status('m-bets').s === 'verifying', '只有 bettor 行(shard 行未建) ⇒ 也不碰');
  const m3 = market('m-bets3', { protocol_status: 'verifying' }); ins('market_shards', { logical_market_id: 'm-bets3', shard_market_id: 'm-bets3-s0', shard_index: 0 }); ins('pool_bettor_sides', { market_id: 'm-bets3-s0', bettor_pk: 'cd'.repeat(32), direction: 1, stake_amount: 1, side_p2sh: 'p' });
  ok(S.handleNoSpineChipMarket(m3, sqlite, NOW).action === 'left_to_zk_path' && status('m-bets3').s === 'verifying', '注落在 shard 市场行上 ⇒ 不碰');
  // 小筹码盘: 注额远小于 1e10 也不取消(KAS min-pot 不适用)
  const m4 = market('m-small'); ins('market_shards', { logical_market_id: 'm-small', shard_market_id: 'm-small-s0', shard_index: 0 }); ins('pool_bettor_sides', { market_id: 'm-small-s0', bettor_pk: 'ef'.repeat(32), direction: 0, stake_amount: 3_000_000_000, side_p2sh: 'p' });
  ok(S.handleNoSpineChipMarket(m4, sqlite, NOW).action === 'left_to_zk_path' && status('m-small').s === 'verifying', '3e9 筹码(< 1e10) 的小盘 ⇒ 不被 min-pot 取消');
}

console.log('[test] 4. legacy KAS 盘(有 spine)不受影响');
{
  const m = market('m-legacy', { spine_p2sh: 'kaspa:pspine', metadata: '{}', maker_stake_amount: 10_000_000_000 });
  const r = S.handleNoSpineChipMarket(m, sqlite, NOW);
  ok(r.skip === false && status('m-legacy').s === 'verifying', 'handleNoSpineChipMarket 返回 skip:false, 状态不动(老 min-pot 闸照旧)');
}

console.log('[test] 5. dispatchRefund 对无 spine 筹码盘: 不进 buildMakerRefundPreimage');
{
  const m = market('m-refund');   // maker_relay_id 'maker-x' 不在 relay_nodes: 老路会 warn "no maker address"
  warns.length = 0;
  const r = await S.dispatchRefund(m, { action: 'refund', authorization: 'pool_below_minimum', reason: 't' });
  ok(r.ok === false && r.structural === true && /no-spine chip market/.test(r.reason), `返回结构性 not-ok + 清楚原因(实 ${JSON.stringify(r).slice(0, 120)})`);
  ok(!warns.some((x) => x.includes('buildMakerRefundPreimage')), '没有进 buildMakerRefundPreimage(无 "no maker address" 报错)');
  ok(status('m-refund').s === 'verifying', '状态不动');
  warns.length = 0;
  const legacy = market('m-refund-legacy', { spine_p2sh: 'kaspa:pspine', metadata: '{}' });
  const r2 = await S.dispatchRefund(legacy, { action: 'refund', authorization: 'pool_below_minimum', reason: 't' });
  ok(warns.some((x) => x.includes('buildMakerRefundPreimage')) && r2.ok === false, 'legacy 盘仍走 buildMakerRefundPreimage 老路(此处因无 maker 地址而失败)');
}

console.log('[test] 6. 结构: 主循环在 isBshard 跳过之后、三处 min-pot 闸之前接走筹码盘');
{
  const src = fs.readFileSync(new URL('./pool-market-settler.js', import.meta.url), 'utf8');
  const iB = src.indexOf('if (isBshard) { bshardSkipped++; continue; }');
  const iC = src.indexOf('if (handleNoSpineChipMarket(market).skip) continue;');
  const iG1 = src.indexOf('const MIN_POT_PRE = 10_000_000_000n;');
  ok(iB > 0 && iC > iB && iG1 > iC, 'isBshard < handleNoSpineChipMarket < MIN_POT_PRE 闸');
  ok((src.match(/MIN_POT_SOMPI = 10_000_000_000n/g) || []).length === 2 && src.includes('MIN_POT_PRE = 10_000_000_000n'), '三处 KAS min-pot 闸(L725/L934/L1245)原样保留');
}
console.warn = w0;
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
