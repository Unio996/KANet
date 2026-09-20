// tg-wallet-network-guard.test.mjs — CR-2 测试(设计: docs/2026-09-19-kanetui-cr1-cr2-tg-bot-mainnet-guards-change-spec-v0.1.md §2 / §3.3)。
// Run: cd kasia-console && node src/api/tg-wallet-network-guard.test.mjs
//
// 手法同 tg-wallet-pilot-isolation-regression.mjs / t-loopback-authz-funds-hotfix.test.mjs: 隔离库(DB_PATH 临时 + 真 migration) + 真 Fastify 实例 + inject;
// setConfig('ingest_secret', …) 让鉴权通过(不绕过鉴权测业务); throwaway CONSOLE_ENCRYPTION_KEY; 不碰 live console.db、不发任何 RPC 请求。
// 每条 503 用例都配了正向对照臂(testnet-12 下同一路由放行), 证明 503 来自守卫而不是路由本身坏了。
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONSOLE_DIR = path.resolve(HERE, '..', '..');
const ROOT = path.resolve(CONSOLE_DIR, '..');
const DB = path.join(ROOT, 'scratch', 'tg-wallet-network-guard.test.db');
const INGEST_SECRET = 'test-ingest-secret-' + randomBytes(8).toString('hex');

for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);
mkdirSync(path.dirname(DB), { recursive: true });

// 🔴 顺序 load-bearing: DB_PATH 必须在任何 db/client.js 触发导入之前设好。
process.env.DB_PATH = DB;
process.env.CONSOLE_ENCRYPTION_KEY = randomBytes(32).toString('hex'); // throwaway
// tg-wallet.js 静态 import rpc-health.js, 该模块 module-load 时就 fail-fast 检查这两个 env; 死端口, 本测试不实际发 RPC。
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
process.env.KASPA_NETWORK = 'testnet-12';
delete process.env.CUSTODIAL_RELAY_ID;
delete process.env.PILOT_WALLET_ADDRESSES;
delete process.env.ADMIN_DIAGNOSE_ENABLED;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name} ${detail}`); }
};

const GUARD_TEXT = '托管钱包暂不可用';
const SEND_BODY = { to: 'kaspatest:qpseh8ah3vjm5jc38cq0xy219kvctlfmyz8k5zj7v0nfj2lldkjfqf4ppy0f7', amount_kas: 1 };

async function main() {
  const migrateMod = await import(pathToFileURL(path.join(CONSOLE_DIR, 'src/db/migrate.js')).href);
  await migrateMod.runMigrations();
  const { sqlite } = await import(pathToFileURL(path.join(CONSOLE_DIR, 'src/db/client.js')).href);
  const { setConfig } = await import(pathToFileURL(path.join(CONSOLE_DIR, 'src/data/settings/configs.js')).href);
  await setConfig('ingest_secret', INGEST_SECRET, { category: 'security', isSensitive: true });

  const Fastify = (await import('fastify')).default;
  const fastify = Fastify({ logger: false });
  const { registerTgWalletRoutes } = await import(pathToFileURL(path.join(CONSOLE_DIR, 'src/api/tg-wallet.js')).href);
  await registerTgWalletRoutes(fastify);

  const rows = () => sqlite.prepare('SELECT COUNT(*) AS n FROM tg_custodial_wallets').get().n;
  const call = async (method, url, { secret = INGEST_SECRET, payload } = {}) => {
    const res = await fastify.inject({ method, url, headers: secret ? { 'x-ingest-secret': secret } : {}, ...(payload ? { payload } : {}) });
    let body; try { body = JSON.parse(res.body); } catch { body = { raw: res.body }; }
    return { status: res.statusCode, body, raw: res.body };
  };
  const routes = (u = 'guard-user-1') => [
    ['POST /create', () => call('POST', '/api/tg-wallet/create', { payload: { tg_user_id: u } }), () => call('POST', '/api/tg-wallet/create', { secret: null, payload: { tg_user_id: u } })],
    ['GET /:id', () => call('GET', `/api/tg-wallet/${u}`), () => call('GET', `/api/tg-wallet/${u}`, { secret: null })],
    ['POST /:id/send', () => call('POST', `/api/tg-wallet/${u}/send`, { payload: SEND_BODY }), () => call('POST', `/api/tg-wallet/${u}/send`, { secret: null, payload: SEND_BODY })],
  ];

  for (const [label, net] of [['KASPA_NETWORK=mainnet', 'mainnet'], ['KASPA_NETWORK 未设', undefined], ['KASPA_NETWORK=simnet', 'simnet']]) {
    console.log(`[test] ${label}: 带正确 ingest secret 的三条路由 → 503(守卫), 不建钱包、不出助记词:`);
    if (net === undefined) delete process.env.KASPA_NETWORK; else process.env.KASPA_NETWORK = net;
    const before = rows();
    for (const [name, authed] of routes()) {
      const r = await authed();
      ok(`${name} → 503 且文案是守卫文案`, r.status === 503 && (r.body?.error || '').includes(GUARD_TEXT), `status=${r.status} body=${r.raw.slice(0, 160)}`);
      ok(`${name} 响应体不含 mnemonic`, !/mnemonic/i.test(r.raw), r.raw.slice(0, 160));
    }
    ok('tg_custodial_wallets 行数未变(守卫在任何 DB 写之前)', rows() === before && rows() === 0, `before=${before} after=${rows()}`);
  }

  console.log('[test] 顺序对照: 网络不符 + 不带/带错 ingest secret → 401(鉴权先于守卫, 未鉴权行为没变):');
  process.env.KASPA_NETWORK = 'mainnet';
  for (const [name, , unauthed] of routes()) {
    const r = await unauthed();
    ok(`${name} 无 secret → 401(不是 503)`, r.status === 401, `status=${r.status} body=${r.raw.slice(0, 120)}`);
  }
  {
    const r = await call('POST', '/api/tg-wallet/create', { secret: 'wrong-secret', payload: { tg_user_id: 'guard-user-1' } });
    ok('POST /create 错 secret → 401(不是 503)', r.status === 401, `status=${r.status}`);
  }
  ok('顺序用例后仍 0 行', rows() === 0);

  console.log('[test] 正向对照臂: KASPA_NETWORK=testnet-12 时同一批路由放行(证明上面的 503 来自守卫, 不是路由本身坏了):');
  process.env.KASPA_NETWORK = 'testnet-12';
  {
    const c = await call('POST', '/api/tg-wallet/create', { payload: { tg_user_id: 'guard-user-1' } });
    ok('POST /create → 200 且 created:true 且给了地址', c.status === 200 && c.body?.created === true && typeof c.body?.address === 'string', `status=${c.status} ${c.raw.slice(0, 120)}`);
    ok('  库里新增 1 行(说明"0 行"断言不是空转)', rows() === 1, `rows=${rows()}`);
    const g = await call('GET', '/api/tg-wallet/no-such-user');   // 不存在的用户 ⇒ 不触发余额 RPC
    ok('GET /:id(不存在的用户)→ 200 {exists:false}', g.status === 200 && g.body?.ok === true && g.body?.exists === false, `status=${g.status} ${g.raw.slice(0, 120)}`);
    const s = await call('POST', '/api/tg-wallet/guard-user-1/send', { payload: SEND_BODY });
    ok('POST /:id/send(CUSTODIAL_RELAY_ID 未设)→ 503 但文案是既有闸的"转账暂不可用", 不是守卫文案',
      s.status === 503 && (s.body?.error || '').includes('转账暂不可用') && !(s.body?.error || '').includes(GUARD_TEXT), `status=${s.status} ${s.raw.slice(0, 160)}`);
  }

  console.log('[test] /diagnose 不被本守卫触碰(它有自己的三重门):');
  process.env.KASPA_NETWORK = 'mainnet';
  {
    const d = await call('GET', '/api/tg-wallet/guard-user-1/diagnose', { secret: null });
    ok('mainnet 下 /diagnose 的响应不是守卫文案(由它自己的 ADMIN_DIAGNOSE_ENABLED 门拒)', !(d.raw || '').includes(GUARD_TEXT), `status=${d.status} ${d.raw.slice(0, 160)}`);
  }

  await fastify.close();
}

main().then(() => {
  console.log(`\n[tg-wallet-network-guard.test] ${pass} passed, ${fail} failed`);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { if (existsSync(f)) rmSync(f); } catch { /* best effort */ } }
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('[tg-wallet-network-guard.test] crashed:', e); process.exit(2); });
