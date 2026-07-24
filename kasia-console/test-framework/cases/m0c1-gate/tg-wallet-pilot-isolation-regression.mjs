// M0c-1 Path B pilot — legacy tg-wallet /send 路由隔离 regression（Codex MSG-124 MUST-FIX E）
// 设计: docs/2026-07-24-m0c1-pilot-codex-msg124-rectification.md §E（Bettor 批·KANet-UI 主）
// 实锤: kasia-console/src/api/tg-wallet.js:93 POST /:tg_user_id/send 原本只挂 AUTH（shared
// ingest secret），完全绕过 M0c-1 grant/source-scope/armed 闸/capability 网关——pilot 钱包
// 一旦充值、arm 前，持 ingest secret + pilot tg_user_id 者即可经这条路径把钱转走。
// 修法: /send handler 查出 wallet 地址后，若命中 PILOT_WALLET_ADDRESSES（复用 capability.js:237
// 已用的单一真相源），fail-closed 403 拒绝；同时去掉 line28 的 FAUCET_RELAY_ID 隐式 fallback
// （K-13 一并了）。
//
// 真 Fastify inject 调 tg-wallet.js 注册的路由处理器（走完整 HTTP handler 代码路径，非直调
// 内部函数），真 runMigrations() 建表（同门⑤/G4 harness 纪律，非简化 schema），真 setConfig
// 写 ingest_secret 让 AUTH 通过（非绕过鉴权测业务逻辑）。隔离 DB + throwaway
// CONSOLE_ENCRYPTION_KEY，不碰 live console.db。
//
// 跑法(cwd=D:/kanet-tn12): node kasia-console/test-framework/cases/m0c1-gate/tg-wallet-pilot-isolation-regression.mjs

import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const DB = path.join(ROOT, 'scratch/tg-wallet-pilot-isolation-regression.db');
const LOG_DIR = path.join(ROOT, 'logs/test-runs');
const INGEST_SECRET = 'test-ingest-secret-' + randomBytes(8).toString('hex');

for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);
mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(path.dirname(DB), { recursive: true });

// 🔴 顺序 load-bearing: DB_PATH 必须在任何 db/client.js 触发导入之前设好（同 G4 harness 纪律）。
process.env.DB_PATH = DB;
process.env.CONSOLE_ENCRYPTION_KEY = randomBytes(32).toString('hex'); // throwaway, 仅本次测试用
// tg-wallet.js 静态 import rpc-health.js, 该模块 module-load 时（非调用时）就 fail-fast 检查这两个
// env（同 G4 harness 隔离铁律）——死端口/占位网络值, 本测试不实际发 RPC 请求。
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
process.env.KASPA_NETWORK = 'testnet-12';
// 隔离进程内 env, 不碰 live console 进程/kanet.env。测 E 隔离本身不需要真 relay/RPC——隔离检查
// 在 relayId 解析、balance 校验之前就会拦下(见下方对 handler 内检查顺序的核实), CUSTODIAL_RELAY_ID
// 留空是刻意的(测 503 fallback-removed 那条用例专门验证这个)。

let pass = 0, fail = 0;
const evidence = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${label}`); }
  else { fail++; console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`); }
  evidence.push({ label, ok, detail: detail ? String(detail).slice(0, 500) : undefined });
}

async function main() {
  const migrateMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/db/migrate.js')).href);
  await migrateMod.runMigrations();

  const configsMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/data/settings/configs.js')).href);
  await configsMod.setConfig('ingest_secret', INGEST_SECRET, { category: 'security', isSensitive: true });

  const Fastify = (await import('fastify')).default;
  const fastify = Fastify({ logger: false });
  const tgWalletMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/api/tg-wallet.js')).href);
  await tgWalletMod.registerTgWalletRoutes(fastify);

  async function createWallet(tgUserId) {
    const res = await fastify.inject({
      method: 'POST', url: '/api/tg-wallet/create',
      headers: { 'x-ingest-secret': INGEST_SECRET },
      payload: { tg_user_id: tgUserId },
    });
    const body = JSON.parse(res.body);
    return body;
  }

  async function send(tgUserId, to, amountKas) {
    const res = await fastify.inject({
      method: 'POST', url: `/api/tg-wallet/${tgUserId}/send`,
      headers: { 'x-ingest-secret': INGEST_SECRET },
      payload: { to, amount_kas: amountKas },
    });
    let body; try { body = JSON.parse(res.body); } catch { body = { raw: res.body }; }
    return { status: res.statusCode, body };
  }

  const DUMMY_TARGET = 'kaspatest:qpseh8ah3vjm5jc38cq0xy219kvctlfmyz8k5zj7v0nfj2lldkjfqf4ppy0f7';

  // ── ① pilot 隔离钱包(地址命中 PILOT_WALLET_ADDRESSES) → /send 必被 403 fail-closed 拒 ──
  // 这是 E 的核心攻击场景本身：持 ingest secret（合法调用者）+ pilot tg_user_id 直接打 /send，
  // 必须被挡——不是"某种边缘输入被拒绝"，是"这条本来就该被完全阻断的路径"。
  {
    const tgUserId = 'pilot-e2e-isolation-' + Date.now();
    const created = await createWallet(tgUserId);
    check('①建 pilot 候选钱包', created.ok && created.created, JSON.stringify(created));

    process.env.PILOT_WALLET_ADDRESSES = created.address; // 建号后才设隔离集, 模拟 §3.6/§(c'') 时序
    process.env.CUSTODIAL_RELAY_ID = 'dummy-relay-not-real'; // 保证走到隔离检查而非提前被 relayId 空值 503 拦

    const r = await send(tgUserId, DUMMY_TARGET, 1);
    check('①真攻击场景: 持 ingest secret+pilot tg_user_id 直接打 /send 被 403 拒',
      r.status === 403, `status=${r.status} body=${JSON.stringify(r.body)}`);
    check('①精确命中 pilot 隔离拒绝文案(非泛泛拒绝)',
      /M0c-1 pilot 隔离钱包/.test(r.body?.error || ''), r.body?.error);
  }

  // ── ② 非 pilot 钱包 → /send 不应被隔离检查拦下(现有全体用户行为不变) ──
  {
    delete process.env.PILOT_WALLET_ADDRESSES; // 清掉①的隔离集，模拟"这个地址从未进过隔离集"
    const tgUserId = 'non-pilot-e2e-' + Date.now();
    const created = await createWallet(tgUserId);
    check('②建非 pilot 钱包', created.ok && created.created, JSON.stringify(created));

    process.env.PILOT_WALLET_ADDRESSES = 'kaspatest:someotheraddressnotthisone'; // 隔离集存在但不含这个地址
    process.env.CUSTODIAL_RELAY_ID = 'dummy-relay-not-real';

    // 🔴 已知行为(非本测试引入的坑): 非 pilot 地址会继续走到 balanceKasForAddress() → rpc-health.js
    // getWorkingRpc()——死端口不可达时该模块自带 discoverNode() fallback, 会真实对外发现请求
    // (只读, 不动链上状态, 生产环境本就是这个韧性行为)。这是 rpc-health.js 既有设计, 非本 regression
    // 引入的隔离破口——本测试要断言的"隔离检查本身对不对"不依赖这次 discovery 的结果(下方断言只判
    // 不是 pilot 隔离拒绝, 不判 balance 检查的具体结果)。
    const r = await send(tgUserId, DUMMY_TARGET, 1);
    check('②非 pilot 地址不被隔离检查拦(不是 403 pilot 隔离文案——后续因隔离 relay/RPC 不可用会以别的方式失败, 那是预期的, 只要不是这条隔离拒绝)',
      !(r.status === 403 && /M0c-1 pilot 隔离钱包/.test(r.body?.error || '')),
      `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // ── ③ CUSTODIAL_RELAY_ID 未设 → 503 fail-closed(证明 FAUCET_RELAY_ID fallback 真去掉了) ──
  {
    delete process.env.PILOT_WALLET_ADDRESSES;
    delete process.env.CUSTODIAL_RELAY_ID;
    delete process.env.FAUCET_RELAY_ID; // 确认即便这个也设了(历史遗留)也不会被拿来 fallback
    process.env.FAUCET_RELAY_ID = 'some-faucet-relay-that-should-never-be-used';

    const tgUserId = 'no-relay-id-e2e-' + Date.now();
    const created = await createWallet(tgUserId);
    check('③建钱包(测 relay id fallback)', created.ok && created.created, JSON.stringify(created));

    const r = await send(tgUserId, DUMMY_TARGET, 1);
    check('③CUSTODIAL_RELAY_ID 未设(即便 FAUCET_RELAY_ID 有值)→ 503 fail-closed, 非静默 fallback',
      r.status === 503, `status=${r.status} body=${JSON.stringify(r.body)}`);
    check('③精确命中"CUSTODIAL_RELAY_ID 未配"文案(不含 FAUCET_RELAY_ID, 证明 fallback 措辞也删了)',
      /CUSTODIAL_RELAY_ID 未配/.test(r.body?.error || '') && !/FAUCET_RELAY_ID/.test(r.body?.error || ''),
      r.body?.error);
    delete process.env.FAUCET_RELAY_ID;
  }

  const logPath = path.join(LOG_DIR, 'tg-wallet-pilot-isolation-regression-latest.json');
  writeFileSync(logPath, JSON.stringify({
    source: 'docs/2026-07-24-m0c1-pilot-codex-msg124-rectification.md §E',
    target: 'kasia-console/src/api/tg-wallet.js POST /:tg_user_id/send',
    method: '真实 Fastify inject 调 tg-wallet.js 注册路由(非 mock/非直调内部函数) + 真 runMigrations schema',
    summary: { pass, fail }, evidence,
  }, null, 2));
  console.log(`\nevidence log: ${logPath}`);
  console.log(`\n== tg-wallet pilot isolation regression: PASS ${pass} / FAIL ${fail} ==`);
  for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) { try { rmSync(f); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('TEST ERROR', e); process.exit(1); });
