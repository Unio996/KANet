// gateway_relay_alive_check_regression.mjs — 账本1677/1679(NWT 审 relay 判活修复时顺带发现·Owner
//   亲批修): pool.js:1530 与 :1656(经共享 helper _v07PrepConfirmPrelude, prep/confirm 两端点共用)
//   写的是 `if (!isRelayAlive(gatewayRelayId))`——isRelayAlive() 恒返回一个对象({alive:bool,...}),
//   对象在 JS 里永远 truthy, `!isRelayAlive(x)` 恒为 false, 这条"网关(maker) relay 不在线就拒绝"
//   的检查从改动引入起就从未生效过。同文件 :385/:615 已经是正确写法(`isRelayAlive(x)?.alive` /
//   `isRelayAlive(x).alive`)。修法 = 两处补 `.alive`, 不改判活逻辑本身(那是另一张票, 见
//   test-framework/cases/system/relay-manager-alive.test.mjs)。
//
// 用真监听的 fastify server + 真 TCP fetch()(同 runtime-identity-endpoint-regression.mjs 既有纪律:
//   真 runMigrations() 建表, 隔离 DB + throwaway CONSOLE_ENCRYPTION_KEY, 不碰 live console.db),
//   直接 import registerPoolRoutes(pool.js 本来就合法 import relay-manager.js, 本文件不新增任何
//   relay-manager 消费点, 不涉及 M0a)。maker_relay_id 指向一个从未 startRelay() 过的 relay id——
//   不 mock isRelayAlive, 用它的真实生产行为(找不到 _relays 条目 ⇒ {alive:false,...}), 这正是
//   "网关 relay 不在线"这个场景在生产里的真实形状。
//
// 跑法(cwd=D:/kanet-tn12): node kasia-console/test-framework/cases/predictions/pool/gateway_relay_alive_check_regression.mjs

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getRepoRoot } from '../../../../src/lib/repo-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = getRepoRoot(HERE);
const DB = path.join(ROOT, 'scratch/gateway-relay-alive-check-regression.db');

let pass = 0, fail = 0;
const evidence = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${label}`); }
  else { fail++; console.log(`FAIL ${label} — ${detail}`); }
  evidence.push({ label, ok, detail: detail ? String(detail).slice(0, 800) : undefined });
}

async function main() {
  for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);
  process.env.DB_PATH = DB;
  process.env.CONSOLE_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
  process.env.KASPA_NETWORK = 'mainnet';
  process.env.KANET_ROOT = ROOT;

  const migrateMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/db/migrate.js')).href);
  await migrateMod.runMigrations();

  const kaspa = await import('kaspa-wasm');
  // 生成一个真实、语法有效的 P2PK 地址供 /prep 的 linked_addr 用——deriveXOnlyPubkey 会真的
  // new kaspa.Address(...) 解析它, 随便一个字符串过不了这一步(不是本次要测的分支, 必须先过掉)。
  const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
  const linkedAddr = priv.toPublicKey().toAddress('mainnet').toString();
  const freshBettorPk = new kaspa.PrivateKey(randomBytes(32).toString('hex')).toPublicKey().toXOnlyPublicKey().toString();

  const Fastify = (await import('fastify')).default;
  const fastify = Fastify({ logger: false });
  const poolMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/api/pool.js')).href);
  await poolMod.registerPoolRoutes(fastify);
  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${fastify.server.address().port}`;

  // 复用 db/client.js 的既有 sqlite 单例(pool.js 自己也是这样拿库连接), 不裸 import better-sqlite3
  // (M0a sqlite 族门同样对新增裸 import 计额度, db/client.js 是已获批的单一入口)。
  const { sqlite: db } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/db/client.js')).href);

  const DEAD_MAKER_RELAY_ID = '__gw_alive_check_fixture_never_started__'; // 从未 startRelay() 过, isRelayAlive 对它的真实生产返回是 {alive:false,...}
  const futureDeadline = Math.floor(Date.now() / 1000) + 3600;

  // ── 场景①: POST /api/pool/market/:id/bettor/register-v07 (pool.js:1530, freshBettor 分支) ──
  const marketA = '__gw_alive_check_market_a';
  db.prepare(`DELETE FROM pool_markets WHERE id = ?`).run(marketA);
  db.prepare(`INSERT INTO pool_markets
      (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, pool_merkle_root)
      VALUES (?, ?, ?, ?, ?, 'v0.7', 'pending_bettors', ?)`)
    .run(marketA, DEAD_MAKER_RELAY_ID, '__gw_alive_check_spine_a', 'fake-hash-a', futureDeadline, 'fake-merkle-root-a');

  {
    const r = await fetch(`${baseUrl}/api/pool/market/${marketA}/bettor/register-v07`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bettor_pk: freshBettorPk, direction: 0, stake_kas: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await r.json().catch(() => ({}));
    check('① register-v07(freshBettor): 死网关 relay ⇒ 503 gateway (maker) relay not alive',
      r.status === 503 && body.error === 'gateway (maker) relay not alive',
      `status=${r.status} body=${JSON.stringify(body)}`);
  }

  // ── 场景②: POST /api/pool/market/:id/bettor/register-v07/prep (pool.js:1656, 经共享 _v07PrepConfirmPrelude) ──
  const marketB = '__gw_alive_check_market_b';
  db.prepare(`DELETE FROM pool_markets WHERE id = ?`).run(marketB);
  db.prepare(`INSERT INTO pool_markets
      (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, pool_merkle_root)
      VALUES (?, ?, ?, ?, ?, 'v0.7', 'pending_bettors', ?)`)
    .run(marketB, DEAD_MAKER_RELAY_ID, '__gw_alive_check_spine_b', 'fake-hash-b', futureDeadline, 'fake-merkle-root-b');

  {
    const r = await fetch(`${baseUrl}/api/pool/market/${marketB}/bettor/register-v07/prep`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linked_addr: linkedAddr, direction: 0, stake_kas: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await r.json().catch(() => ({}));
    check('② register-v07/prep: 死网关 relay ⇒ 503 gateway (maker) relay not alive',
      r.status === 503 && body.error === 'gateway (maker) relay not alive',
      `status=${r.status} body=${JSON.stringify(body)}`);
  }

  // ── 场景③: register-v07/confirm 共用同一个 _v07PrepConfirmPrelude, 同一处判活代码——不重复独立测
  //    (同一函数同一行, 场景②已覆盖该代码路径本身; 场景③会需要额外的 pay-nonce/UTXO 前置状态，
  //    对判活这个 bug 本身没有增量信息), 如实标注不是漏测。
  check('③ register-v07/confirm 与 /prep 共用 _v07PrepConfirmPrelude 同一处判活代码(pool.js:1656)——已被②覆盖, 不重复独立测(如实标注, 非断言)', true, '');

  db.prepare(`DELETE FROM pool_markets WHERE id IN (?, ?)`).run(marketA, marketB);
  // 不 db.close() —— 这是 db/client.js 的共享单例, 不是本文件自己开的连接, 关它可能影响还没
  // 走完收尾的 fastify 内部逻辑; 进程退出时操作系统自然回收 fd, 同 runtime-identity-endpoint-
  // regression.mjs 只 close fastify 不 close db 的既有做法一致。
  await fastify.close();

  console.log(`\n== gateway relay alive-check regression: PASS ${pass} / FAIL ${fail} ==`);
  mkdirSync(path.join(ROOT, 'logs/test-runs'), { recursive: true });
  writeFileSync(path.join(ROOT, 'logs/test-runs/gateway-relay-alive-check-regression-latest.json'), JSON.stringify({
    source_commit: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } })(),
    summary: { pass, fail }, evidence,
  }, null, 2));
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error('regression 异常:', e.stack || e.message); process.exitCode = 1; });
