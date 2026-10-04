// spine-null-readers.test.mjs — 账本1846 S2: ZK 原生·不收 KAS 的盘没有 spine(pool_markets.spine_p2sh = NULL)。
// ① v221 迁移把 spine_p2sh 的 NOT NULL 去掉(含幂等 / integrity_check / foreign_key_check); ② 设计 §3.3 列出的读 spine 的旧路径遇到空值要【跳过而不是报错】, 逐个单测:
//    pool-commingle-detect / pool-card-groups / broker-fee-emit / reclaimBshardMakerBond / pbs8-2-signreq-anchors。
// 自举: 先建隔离的真 migration 临时库再以 DB_PATH 重生自身(同 broker-fee-emit-package-switch.test.mjs 惯例)。
// Run: cd kasia-console && node src/lib/spine-null-readers.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._SPINE_NULL_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_spine_null_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'mainnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'mainnet', _SPINE_NULL_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';   // rpc-health.js 模块加载就要这个 env(经 bshard-auto-settler 间接引入); 指向不可达端口, 本测试不碰任何节点

const { sqlite } = await import('../db/client.js');
const { runMigrations } = await import('../db/migrate.js');
const { isCommingledSpine, commingledSpineSet, assertNotCommingled } = await import('./pool-commingle-detect.mjs');
const { aggregateCardGroups } = await import('./pool-card-groups.mjs');
const { evaluateSignReqAnchors } = await import('./pbs8-2-signreq-anchors.mjs');
const { brokerFeeLandedEmitTick, ensureBackfillSuppressed } = await import('../services/broker-fee-emit.mjs');
const { reclaimBshardMakerBond } = await import('../services/bshard-auto-settler.mjs');

let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
sqlite.pragma('foreign_keys = OFF');   // fixture dummy 列不构造整图 FK

// ── ① v221 ──
console.log('[test] ① v221: pool_markets.spine_p2sh 可空');
{
  const col = sqlite.prepare('PRAGMA table_info(pool_markets)').all().find((c) => c.name === 'spine_p2sh');
  ok(col && col.notnull === 0, 'table_info: spine_p2sh notnull=0');
  const ddl = () => sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pool_markets'").get().sql;
  const before = ddl();
  ok(!/spine_p2sh\s+TEXT\s+NOT\s+NULL/.test(before), 'DDL 里已无 "spine_p2sh TEXT NOT NULL"');
  ok(/maker_relay_id\s+TEXT\s+NOT\s+NULL/.test(before) || /deadline\s+INTEGER\s+NOT\s+NULL/.test(before), '其它列的 NOT NULL 原样保留(只动 spine_p2sh 一行)');
  const ic = sqlite.prepare('PRAGMA integrity_check').all();
  ok(ic.length === 1 && ic[0].integrity_check === 'ok', 'integrity_check = ok');
  sqlite.pragma('foreign_keys = ON'); const fk = sqlite.prepare('PRAGMA foreign_key_check').all(); sqlite.pragma('foreign_keys = OFF');
  ok(fk.length === 0, 'foreign_key_check 0 违例');
  const trg = sqlite.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE tbl_name='pool_markets' AND type IN ('trigger','index')").get().c;
  runMigrations();   // 再跑一遍 = 幂等零操作
  ok(ddl() === before, '再跑 runMigrations: DDL 不变(幂等)');
  ok(sqlite.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE tbl_name='pool_markets' AND type IN ('trigger','index')").get().c === trg && trg >= 4, `触发器/索引原样在(${trg} 个, 含 fee_rules 写一次触发器与表达式索引)`);
}

// ── 夹具: 真 schema 补 NOT NULL 无默认列 ──
const info = sqlite.pragma('table_info(pool_markets)');
const required = info.filter((c) => c.notnull === 1 && c.dflt_value == null && c.name !== 'id');
function seed(id, over = {}) {
  const base = { id, protocol_version: 'v0.7', protocol_status: 'pending_bettors', broker_pk: null, settle_txid: null, spine_p2sh: null, spine_lock_tx: null, resolution_rule_spec: '{}', metadata: '{}', fee_rules: null, maker_stake_amount: 0, deadline_daa: 1000, deadline: 1000, pool_merkle_root: 'aa'.repeat(32), maker_pk: 'ff'.repeat(32), maker_relay_id: 'r1' };
  for (const c of required) if (!(c.name in base)) base[c.name] = /INT/i.test(c.type) ? 1 : 'x';
  const row = { ...base, ...over };
  sqlite.prepare(`INSERT INTO pool_markets (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
}
seed('nospine-a'); seed('nospine-b');   // 两行都是 NULL spine: 不能被当成"同址 commingled"
let nullInsertOk = sqlite.prepare("SELECT COUNT(*) c FROM pool_markets WHERE spine_p2sh IS NULL").get().c === 2;
ok(nullInsertOk, '真 schema 可插入 spine_p2sh=NULL 的行(两行)');

// ── ② pool-commingle-detect ──
console.log('[test] ② pool-commingle-detect');
ok(isCommingledSpine(null, sqlite) === false && isCommingledSpine(undefined, sqlite) === false && isCommingledSpine('', sqlite) === false, 'isCommingledSpine(null/undefined/"") = false(两行 NULL 不算同址)');
ok(commingledSpineSet(sqlite).size === 0, 'commingledSpineSet: 两行 NULL spine 不入集');
{
  let sent = null; const reply = { code() { return this; }, send(x) { sent = x; } };
  ok(assertNotCommingled({ spine_p2sh: null }, reply, sqlite) === false && sent === null, 'assertNotCommingled(spine=null) = false(放行, 不回包)');
}

// ── ③ pool-card-groups ──
console.log('[test] ③ pool-card-groups');
{
  const spec = JSON.stringify({ card_group_id: 'cg1', leg_key: 'winner_a', title: 'T', data_source_canonical: 'u', resolution_criteria: 'c' });
  let out, threw = null;
  try { out = aggregateCardGroups([{ id: 'nospine-a', resolution_rule_spec: spec, outcome_side: 'YES', deadline: 1, maker_stake_amount: 0, spine_p2sh: null, bettor_count: 1, yes_sompi: 5, no_sompi: 5 }], new Set(['x']), {}); } catch (e) { threw = e; }
  ok(!threw && out && out.ok === true, 'spine=null 的行不抛');
  const leg = out?.card_groups?.[0]?.legs?.[0] ?? out?.card_groups?.[0];
  ok(JSON.stringify(out).includes('"spine_p2sh":null') || out?.count >= 1, 'spine=null 的行照常聚合(未被当成 commingled 排除), spine_p2sh 透传 null');
}

// ── ④ pbs8-2-signreq-anchors ──
console.log('[test] ④ pbs8-2-signreq-anchors');
{
  const r1 = evaluateSignReqAnchors({ market: { id: 'nospine-a', spine_p2sh: null, spine_lock_tx: null, maker_relay_id: 'r1' }, spineIsCommingled: false, txObj: { inputs: [], outputs: [] }, inputTotalSompi: 1n });
  ok(r1.ok === false && r1.code === 'NO_SPINE_MARKET', '无 spine ⇒ 专用拒签码 NO_SPINE_MARKET(fail-closed, 不放行)');
  const r2 = evaluateSignReqAnchors({ market: { id: 'half', spine_p2sh: 'kaspa:x', spine_lock_tx: null, maker_relay_id: 'r1' }, spineIsCommingled: false, txObj: { inputs: [], outputs: [] }, inputTotalSompi: 1n });
  ok(r2.ok === false && r2.code === 'MISSING_LOAD_BEARING_COLUMN', '只缺一个 spine 列 ⇒ 仍是原 MISSING_LOAD_BEARING_COLUMN(数据残缺口径不变)');
}

// ── ⑤ broker-fee-emit ──
console.log('[test] ⑤ broker-fee-emit');
{
  ensureBackfillSuppressed(sqlite);
  seed('zk-nospine', { broker_pk: 'bb'.repeat(32), protocol_status: 'pending_bettors', resolution_rule_spec: JSON.stringify({ zk_native: true }), metadata: JSON.stringify({ zk_continuation: { exhausted: 1 } }) });
  const logs = []; const derived = [];
  let threw = null;
  try { brokerFeeLandedEmitTick(sqlite, (pk, network) => { derived.push(network); return null; }, (m) => logs.push(m)); } catch (e) { threw = e; }
  ok(!threw, `无 spine 的 ZK 盘进入候选不抛(${threw ? threw.message : 'ok'})`);
  ok(!logs.some((l) => /spine_p2sh not on configured network/.test(l)), '没有被当成"spine 不在配置网络"而静默跳过');
  ok(derived.length === 1 && derived[0] === 'mainnet', `改用配置网络单源: deriveBrokerAddress 被以 network=mainnet 调用(实 ${JSON.stringify(derived)})`);
}

// ── ⑥ reclaimBshardMakerBond ──
console.log('[test] ⑥ reclaimBshardMakerBond');
{
  let relayCalls = 0;
  const db = { prepare(sql) { if (sql.includes('FROM pool_markets WHERE id')) return { get: () => ({ id: 'nospine-a', spine_p2sh: null, spine_lock_tx: null, metadata: '{}' }) }; throw new Error('不应再查别的表: ' + sql.slice(0, 50)); } };
  const r = await reclaimBshardMakerBond('nospine-a', { db, relayPost: async () => { relayCalls++; return {}; }, feeRelay: { id: 'f' } });
  ok(r.ok === false && r.noSpine === true && /无 spine/.test(r.reason), '无 spine ⇒ 干净返回 {ok:false, noSpine:true}, 不抛');
  ok(relayCalls === 0, '零 relay 调用(不去 check_utxo_landed(null))');
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
