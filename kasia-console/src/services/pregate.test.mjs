// pregate.test.mjs — 不可达 pre-gate 验收(J2 2026-07-12, 合卡设计 docs/2026-07-12-bucketA-windir-backfill-
// and-unreachable-pregate-design.md §3/§4-1)。真 migration 库 + 真 selectRipeMarkets/unreachablePreGate(非复刻)。
// Run: cd kasia-console && node src/services/pregate.test.mjs   (自举: 先建隔离临时库再以 DB_PATH 重生自身)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._PREGATE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_pregate_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _PREGATE_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { selectRipeMarkets, unreachablePreGate, PREGATE_MAX_WALK } = await import('./bshard-settle-daemon.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

sqlite.pragma('foreign_keys = OFF');   // fixture dummy 列不构造整图 FK(被测行为=selection/gate, 与 FK 无关)

const FLOOR = 57000000;
const CUR = 58000000;
sqlite.prepare('INSERT INTO spc_daa_index_coverage (start_daa, end_daa) VALUES (?, ?)').run(FLOOR, CUR);
sqlite.prepare('INSERT INTO spc_daa_index (daa_score, block_hash, timestamp_ms) VALUES (?, ?, ?)').run(CUR, 'ab'.repeat(32), Date.now());

// 真 schema INSERT: NOT NULL 无默认列动态补 dummy(phase2.test⑥ 同款)
const info = sqlite.pragma('table_info(pool_markets)');
const required = info.filter(c => c.notnull === 1 && c.dflt_value == null && c.name !== 'id');
function seedMarket(id, { deadlineDaa, metadata = '{}', status = 'verifying' }) {
  const cols = ['id', ...required.map(c => c.name), 'protocol_version', 'protocol_status', 'deadline_daa', 'deadline', 'metadata', 'resolution_rule_spec', 'maker_pk', 'broker_pk', 'pool_merkle_root'];
  const uniq = [...new Set(cols)];
  const vals = uniq.map(c => {
    if (c === 'id') return id;
    if (c === 'protocol_version') return 'v0.7';
    if (c === 'protocol_status') return status;
    if (c === 'deadline_daa') return deadlineDaa;
    if (c === 'deadline') return 1000;   // unix s, 远过期 → pmt gate 放行
    if (c === 'metadata') return metadata;
    if (c === 'resolution_rule_spec') return '{}';
    if (c === 'maker_pk' || c === 'broker_pk') return 'f0'.repeat(32);
    if (c === 'pool_merkle_root') return 'e0'.repeat(32);
    const rc = required.find(r => r.name === c);
    return rc && (rc.type === 'INTEGER' || rc.type === 'REAL') ? 0 : 'x';
  });
  sqlite.prepare(`INSERT INTO pool_markets (${uniq.join(',')}) VALUES (${uniq.map(() => '?').join(',')})`).run(...vals);
  const shard = `${id}-s0`;
  _insertDyn('market_shards', { logical_market_id: id, shard_market_id: shard, shard_index: 0, status: 'sealed' });
  _insertDyn('pool_bettor_sides', { market_id: shard, bettor_pk: 'aa'.repeat(32), stake_amount: '100000000', direction: 1 });
  _insertDyn('pool_bettor_sides', { market_id: shard, bettor_pk: 'bb'.repeat(32), stake_amount: '100000000', direction: 0 });
}
// 真 schema 通用 INSERT: 指定列 + NOT NULL 无默认列自动补 dummy
function _insertDyn(table, fields) {
  const req = sqlite.pragma(`table_info(${table})`).filter(c => c.notnull === 1 && c.dflt_value == null && !(c.name in fields) && c.pk === 0);
  const all = { ...fields };
  for (const c of req) all[c.name] = (c.type === 'INTEGER' || c.type === 'REAL') ? 0 : 'x';
  const cols = Object.keys(all);
  sqlite.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => all[c]));
}

console.log(`[test] ① unreachablePreGate 判据边界(MAX_WALK=${PREGATE_MAX_WALK}, F2 off-by-one):`);
{
  const m = (dd, meta = '{}') => ({ id: `m-${dd}-${Math.random().toString(36).slice(2, 6)}`, deadline_daa: dd, metadata: meta });
  ok(unreachablePreGate(m(50000000), 50000000 + PREGATE_MAX_WALK, FLOOR) === false, 'gap==MAX_WALK 等值不 gate(rpc exhaust 时 daa==deadline=正确 crossing, 边界严格一致)');
  ok(unreachablePreGate(m(50000000), 50000000 + PREGATE_MAX_WALK + 1, FLOOR) === true, 'gap==MAX_WALK+1 → gate');
  ok(unreachablePreGate(m(FLOOR), CUR, FLOOR) === false, 'deadline_daa==floor(不小于) → 不 gate(可达一律照走)');
  ok(unreachablePreGate(m(50000000), CUR, null) === false, 'coverage 空(floor null) → 不 gate(fail-open 到既有路径)');
  const withEv = m(50000000, JSON.stringify({ settle_evidence: { close_txid: 'cc'.repeat(32) } }));
  ok(unreachablePreGate(withEv, CUR, FLOOR) === false, '有 settle_evidence.close_txid → 不 gate(resume 快路盘照进 selection)');
  ok(unreachablePreGate(m(null), CUR, FLOOR) === false, 'deadline_daa null → 不 gate');
}

console.log('[test] ② selectRipeMarkets 集成: gate 盘不占 slot, 可达盘照进(Bettor 注1 修层验证):');
{
  seedMarket('m-gated-oldpruned', { deadlineDaa: 50000000 });                      // floor 下 + gap 8M ≫ MAX_WALK
  seedMarket('m-ok-reachable', { deadlineDaa: CUR - 5000 });                       // floor 上, ripe(+60 <= CUR)
  const ripe = selectRipeMarkets(CUR, Date.now() + 1e9, 20);
  const ids = ripe.map(r => r.market.id);
  ok(!ids.includes('m-gated-oldpruned'), `gate 盘不入 ripe(不占 slot): ${JSON.stringify(ids)}`);
  ok(ids.includes('m-ok-reachable'), '可达盘照进 selection');
  const ev = sqlite.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='unreachable_gated' AND payload_json LIKE '%m-gated-oldpruned%'`).get().c;
  ok(ev === 1, `首次 gate 发一条 unreachable_gated 审计(计数=${ev})`);
  selectRipeMarkets(CUR, Date.now() + 1e9, 20);   // 第二 tick
  const ev2 = sqlite.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='unreachable_gated' AND payload_json LIKE '%m-gated-oldpruned%'`).get().c;
  ok(ev2 === 1, '第二 tick 不重发审计(进程内去重)');
}

console.log('[test] ③ 有 evidence 的 floor 下老盘照进 selection(桶A 形状——Fix-A resume 域, gate 不拦):');
{
  seedMarket('m-bucketA-shape', { deadlineDaa: 50400000, status: 'settled_partial_claims', metadata: JSON.stringify({ settle_evidence: { close_txid: 'dd'.repeat(32), payout_root: 'ee'.repeat(32) } }) });
  const ripe = selectRipeMarkets(CUR, Date.now() + 1e9, 20);
  ok(ripe.some(r => r.market.id === 'm-bucketA-shape'), '桶A 形状盘(有 close_txid)不被 gate, 照进 selection 走 resume');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — pre-gate: 边界严格一致/等值不gate/evidence豁免/coverage空fail-open/selection层不占slot/审计单发'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
