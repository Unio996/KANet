// ④-1..④-7 验收(预注册于切片计划 C2 16ecff6d, 事后不加项) —— v198 u1_relay_identity (§10 跨节点 pubkey 身份表)
// 🔴 安全闸(照 u1-v197-migration-acceptance.mjs): import 前把 DB_PATH 指到临时库, 并断言它真是临时库(不碰 live console.db)。
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
const dir = mkdtempSync(join(tmpdir(), 'v198-accept-'));
process.env.DB_PATH = join(dir, 'probe.db');
const { runMigrations } = await import('../db/migrate.js');
const { sqlite, dbPath } = await import('../db/client.js');
const { S10_NETWORKS } = await import('./u1-s10-identity.mjs');   // ④-8: 表枚举须与验证器枚举同集
assert.ok(dbPath.startsWith(dir), `安全闸: 必须临时库, 实际 ${dbPath}`);
runMigrations();

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('[PASS] ' + n); pass++; } catch (e) { console.log('[FAIL] ' + n + ' :: ' + e.message); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m || 'assert'); };
const MIG = new URL('../db/migrate.js', import.meta.url);
const T = 'u1_relay_identity';
const liveSql = () => sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(T)?.sql;
const PK1 = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';   // priv=1 test-only x-only(golden vectors 同钥)
const ins = (pk, ep, op = 'register') => sqlite.prepare(`INSERT INTO ${T} (relay_pubkey_xonly, network, operation, epoch, signature) VALUES (?,?,?,?,?)`).run(pk, 'testnet-12', op, ep, 'sig');
const rejects = (fn, re) => { try { fn(); return false; } catch (e) { return re ? re.test(String(e.message)) : true; } };

t('④-1 表存在且列集精确(6 列, 名/序/类型/NOT NULL 逐一)', () => {
  A(liveSql(), '表不存在');
  const cols = sqlite.prepare(`PRAGMA table_info(${T})`).all().map(c => [c.name, c.type, c.notnull, c.pk].join(':'));
  assert.deepStrictEqual(cols, ['relay_pubkey_xonly:TEXT:0:1', 'network:TEXT:1:0', 'operation:TEXT:1:0', 'epoch:TEXT:1:0', 'signature:TEXT:1:0', 'registered_at:TEXT:1:0']);
  A(readFileSync(MIG, 'utf8').includes(`CREATE TABLE IF NOT EXISTS ${T}`), 'migrate.js 无该 DDL(用的不是生产迁移)');
});
t('④-2 PK = pubkey: 同 pubkey 二次 INSERT(不同 epoch) ⇒ SQLITE_CONSTRAINT', () => {
  ins(PK1, 'e1');
  A(rejects(() => ins(PK1, 'e2'), /UNIQUE|PRIMARY|constraint/i), '同 pubkey 第二次竟写进去了');
  A(sqlite.prepare(`SELECT COUNT(*) c FROM ${T}`).get().c === 1, '应恰 1 行');
});
t('④-3 CHECK 与 L1 同口径: 大写 / 63 位 / 纯非 hex / 🔴 hex 前缀+非 hex(a+z×63) / operation=rotate 全拒; 规范小写通过', () => {
  A(rejects(() => ins(PK1.toUpperCase(), 'e3'), /CHECK/i), '大写 64-hex 竟通过(小写归一是唯一防线)');
  A(rejects(() => ins(PK1.slice(0, 63), 'e4'), /CHECK/i), '63 位竟通过');
  A(rejects(() => ins('g'.repeat(64), 'e5'), /CHECK/i), '纯非 hex 竟通过');
  A(rejects(() => ins('a' + 'z'.repeat(63), 'e6'), /CHECK/i), '🔴 hex 前缀+非 hex 竟通过 —— GLOB 只挡了首字符(假绿形)');
  A(rejects(() => ins('0'.repeat(63) + '2', 'e7', 'rotate'), /CHECK/i), 'operation=rotate 竟通过');
  ins('0'.repeat(63) + '2', 'e8');   // 规范小写 64-hex 通过(表层不管曲线点, 那是 L1-parse 的事)
  A(sqlite.prepare(`SELECT COUNT(*) c FROM ${T}`).get().c === 2);
});
t('④-4 epoch UNIQUE: 不同 pubkey 同 epoch ⇒ 拒', () => {
  A(rejects(() => ins('0'.repeat(63) + '3', 'e1'), /UNIQUE|constraint/i), '同 epoch 竟写进第二条');
});
t('④-5 幂等: 再跑一次 migrate 不抛, 结构逐字不变', () => {
  const before = liveSql(); runMigrations(); A(liveSql() === before, '第二次迁移后结构变了');
});
t('④-6 🔴 无 local_relay_id 列; 无任何 relay_id/ecdsa 回退索引(只有 PK/UNIQUE 自动索引)', () => {
  const names = sqlite.prepare(`PRAGMA table_info(${T})`).all().map(c => c.name);
  A(!names.includes('local_relay_id') && !names.some(n => /relay_id|ecdsa/i.test(n)), `出现回退列: ${names}`);
  const idx = sqlite.prepare(`PRAGMA index_list(${T})`).all();
  A(idx.every(i => i.origin === 'pk' || i.origin === 'u'), `出现显式索引: ${JSON.stringify(idx.map(i => [i.name, i.origin]))}`);
  // ⚠ 表名 u1_relay_identity 自身含子串 "relay_id"(…relay_id|entity) ⇒ 须按【整词】匹配, 否则本臂对着表名假红
  const ddl = liveSql(); A(!/\brelay_id\b|ecdsa/i.test(ddl), 'DDL 里出现 relay_id/ecdsa 整词');
});
t('④-7 写入方唯一: 仓内 src/ 只有 u1-registration.mjs 一处 INSERT INTO u1_relay_identity(C3 起, registerIdentity 事务内)', () => {
  const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const hits = [];
  const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); const s = statSync(p); if (s.isDirectory()) { if (e !== 'node_modules') walk(p); } else if (/\.(m?js|cjs)$/.test(e) && !/u1-v198-migration-acceptance/.test(e)) { if (/INSERT\s+INTO\s+u1_relay_identity/i.test(readFileSync(p, 'utf8'))) hits.push(p); } } };
  walk(root);
  A(hits.length === 1 && /u1-registration\.mjs$/.test(hits[0]), `写入方应恰为 u1-registration.mjs, 实际: ${hits.join(',') || '(无)'}`);
});
// ④-8 定位: 防御纵深 —— app 层 C3 已按 localNetwork 拒(screenS10), 此 CHECK 挡【绕过 app 的直接 INSERT】, 与 operation CHECK 同族。
// 🔴 相等断言的两个源必须独立: 源 A = sqlite_master 里【真实 CREATE TABLE sql】解出的 CHECK 值集; 源 B = import 的验证器常量 S10_NETWORKS。
//    禁止用同一字面量构造 expected 再自比(自证测不出漂移); 末尾阳性对照证明比对器本身有判别力。
t('④-8 (Codex MSG-285 SHOULD-FIX) network 表级闭枚举: devnet / testnet-11 / 空串 直接 INSERT ⇒ SQLITE_CONSTRAINT; testnet-12 / mainnet 过; 且 DDL(sqlite_master)枚举集 === 验证器 S10_NETWORKS(两独立源机械比对)', () => {
  const insNet = (net, ep, pk) => sqlite.prepare(`INSERT INTO ${T} (relay_pubkey_xonly, network, operation, epoch, signature) VALUES (?,?,?,?,?)`).run(pk, net, 'register', ep, 'sig');
  for (const [net, ep, pk] of [['devnet', 'n1', '0'.repeat(63) + '4'], ['testnet-11', 'n2', '0'.repeat(63) + '5'], ['', 'n3', '0'.repeat(63) + '6']]) {
    A(rejects(() => insNet(net, ep, pk), /CHECK/i), `network=${JSON.stringify(net)} 竟通过`);
  }
  insNet('testnet-12', 'n4', '0'.repeat(63) + '7'); insNet('mainnet', 'n5', '0'.repeat(63) + '8');
  const m = /network\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*network\s+IN\s*\(([^)]*)\)\s*\)/i.exec(liveSql());
  A(m, 'DDL 里没有 network IN (...) CHECK');
  const ddlSet = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort();
  assert.deepStrictEqual(ddlSet, [...S10_NETWORKS].sort(), `表枚举 ${ddlSet} ≠ 验证器枚举 ${[...S10_NETWORKS]}`);
  // 阳性对照: 比对器本身有判别力 —— 人为多一个元素必须不等
  assert.notDeepStrictEqual([...ddlSet, 'devnet'].sort(), [...S10_NETWORKS].sort());
});
console.log(`\n④ 验收: ${pass} PASS / ${fail} FAIL   (临时库 ${dbPath})`);
process.exit(fail ? 1 : 0);
