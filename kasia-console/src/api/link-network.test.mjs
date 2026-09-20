// link-network.test.mjs — CR-3 服务端半(POST /api/link/bind 按 KASPA_NETWORK 校验地址; Owner 批 2026-09-20)。
// Run: cd kasia-console && node src/api/link-network.test.mjs
//
// 隔离库(DB_PATH 临时 + 真 migration) + 真 Fastify inject + 真 kaspa-wasm 生成【真实合法】各网络地址(随机私钥, 公开地址, 不涉及任何真实账户);
// setConfig('ingest_secret') 让鉴权通过。每条拒绝用例配正向对照臂(该网络下合法地址放行), 证明拒绝来自网络校验而不是路由坏了。
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONSOLE_DIR = path.resolve(HERE, '..', '..');
const ROOT = path.resolve(CONSOLE_DIR, '..');
const DB = path.join(ROOT, 'scratch', 'link-network.test.db');
const INGEST_SECRET = 'test-ingest-secret-' + randomBytes(8).toString('hex');
for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);
mkdirSync(path.dirname(DB), { recursive: true });

process.env.DB_PATH = DB;   // 🔴 顺序 load-bearing: 先于任何 db/client.js 导入
process.env.CONSOLE_ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';   // 模块加载期 fail-fast 检查用; 本测试不发 RPC
process.env.KASPA_NETWORK = 'mainnet';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.error(`  ❌ ${name} ${detail}`); } };

async function main() {
  const kaspa = await import('kaspa-wasm');
  const addrFor = (netType) => new kaspa.PrivateKey(randomBytes(32).toString('hex')).toKeypair().toAddress(netType).toString();
  const A = {
    mainnet: addrFor(kaspa.NetworkType.Mainnet),
    testnet: addrFor(kaspa.NetworkType.Testnet),
    simnet: addrFor(kaspa.NetworkType.Simnet),
    devnet: addrFor(kaspa.NetworkType.Devnet),
  };
  ok('夹具: 四种网络地址前缀正确', A.mainnet.startsWith('kaspa:') && A.testnet.startsWith('kaspatest:') && A.simnet.startsWith('kaspasim:') && A.devnet.startsWith('kaspadev:'), JSON.stringify(Object.values(A).map((a) => a.slice(0, 12))));
  const badChecksum = (a) => a.slice(0, -1) + (a.endsWith('q') ? 'p' : 'q');

  const migrateMod = await import(pathToFileURL(path.join(CONSOLE_DIR, 'src/db/migrate.js')).href);
  await migrateMod.runMigrations();
  const { sqlite } = await import(pathToFileURL(path.join(CONSOLE_DIR, 'src/db/client.js')).href);
  const { setConfig } = await import(pathToFileURL(path.join(CONSOLE_DIR, 'src/data/settings/configs.js')).href);
  await setConfig('ingest_secret', INGEST_SECRET, { category: 'security', isSensitive: true });
  const Fastify = (await import('fastify')).default;
  const fastify = Fastify({ logger: false });
  const { registerLinkRoutes } = await import(pathToFileURL(path.join(CONSOLE_DIR, 'src/api/link.js')).href);
  await registerLinkRoutes(fastify);

  const rows = () => sqlite.prepare('SELECT COUNT(*) AS n FROM user_notification_prefs').get().n;
  const bind = async (payload, { secret = INGEST_SECRET } = {}) => {
    const res = await fastify.inject({ method: 'POST', url: '/api/link/bind', headers: secret ? { 'x-ingest-secret': secret } : {}, payload });
    let body; try { body = JSON.parse(res.body); } catch { body = { raw: res.body }; }
    return { status: res.statusCode, body, raw: res.body };
  };
  let tg = 1000;
  const uid = () => String(++tg);

  console.log('[test] KASPA_NETWORK=mainnet:');
  process.env.KASPA_NETWORK = 'mainnet';
  {
    const r = await bind({ address: A.mainnet, telegram_user_id: uid() });
    ok('正向对照臂: 合法主网地址 → 200 linked:true', r.status === 200 && r.body.linked === true, `${r.status} ${r.raw.slice(0, 120)}`);
    ok('  库里新增 1 行', rows() === 1, `rows=${rows()}`);
  }
  {
    const before = rows();
    const r = await bind({ address: A.testnet, telegram_user_id: uid() });
    ok('合法【测试网】地址 → 400 code=prefix-mismatch expected_prefix=kaspa(旧代码 startsWith("kaspa") 会放行)', r.status === 400 && r.body.code === 'prefix-mismatch' && r.body.expected_prefix === 'kaspa', `${r.status} ${r.raw.slice(0, 160)}`);
    ok('  不写库', rows() === before, `before=${before} after=${rows()}`);
  }
  for (const [label, a] of [['simnet', A.simnet], ['devnet', A.devnet]]) {
    const before = rows(); const r = await bind({ address: a, telegram_user_id: uid() });
    ok(`合法 ${label} 地址 → 400 prefix-mismatch, 不写库`, r.status === 400 && r.body.code === 'prefix-mismatch' && rows() === before, `${r.status} ${r.raw.slice(0, 120)}`);
  }
  {
    const before = rows();
    const r1 = await bind({ address: badChecksum(A.mainnet), telegram_user_id: uid() });
    ok('主网前缀但校验和被改坏 → 400 code=invalid-checksum(旧代码只看前缀会放行)', r1.status === 400 && r1.body.code === 'invalid-checksum', `${r1.status} ${r1.raw.slice(0, 120)}`);
    const r2 = await bind({ address: 'kaspa:notarealaddress', telegram_user_id: uid() });
    ok('kaspa:notarealaddress → 400 invalid-checksum', r2.status === 400 && r2.body.code === 'invalid-checksum', `${r2.status} ${r2.raw.slice(0, 120)}`);
    const r3 = await bind({ address: ' ' + A.mainnet, telegram_user_id: uid() });
    ok('前导空格的合法地址 → 400(不被悄悄 trim 放行)', r3.status === 400, `${r3.status} ${r3.raw.slice(0, 120)}`);
    ok('  以上都不写库', rows() === before, `before=${before} after=${rows()}`);
  }
  {
    const r1 = await bind({ telegram_user_id: uid() });
    ok('缺 address → 400 code=empty', r1.status === 400 && r1.body.code === 'empty', `${r1.status} ${r1.raw.slice(0, 120)}`);
    const r2 = await bind({ address: A.mainnet });
    ok('缺 telegram_user_id → 400(既有行为不变)', r2.status === 400 && /telegram_user_id/.test(r2.raw), `${r2.status} ${r2.raw.slice(0, 120)}`);
  }
  {
    const r1 = await bind({ address: A.testnet, telegram_user_id: uid() }, { secret: null });
    const r2 = await bind({ address: A.mainnet, telegram_user_id: uid() }, { secret: 'wrong' });
    ok('无/错 ingest secret → 401(鉴权先于网络校验, 未鉴权行为没变)', r1.status === 401 && r2.status === 401, `${r1.status}/${r2.status}`);
  }

  console.log('[test] KASPA_NETWORK 未设 / 未知 → fail-closed 503, 不写库(不落默认网络):');
  for (const v of [undefined, '', 'mainnet-2', 'Mainnet', 'testnet-12 ']) {
    if (v === undefined) delete process.env.KASPA_NETWORK; else process.env.KASPA_NETWORK = v;
    const before = rows();
    const r = await bind({ address: A.mainnet, telegram_user_id: uid() });
    ok(`KASPA_NETWORK=${JSON.stringify(v)} → 503 code=network-unset, 不写库`, r.status === 503 && r.body.code === 'network-unset' && rows() === before, `${r.status} ${r.raw.slice(0, 120)}`);
  }

  console.log('[test] KASPA_NETWORK=testnet-12(TN12 行为不变 + 对称拒绝):');
  process.env.KASPA_NETWORK = 'testnet-12';
  {
    const r1 = await bind({ address: A.testnet, telegram_user_id: uid() });
    ok('合法测试网地址 → 200(正向对照臂)', r1.status === 200 && r1.body.linked === true, `${r1.status} ${r1.raw.slice(0, 120)}`);
    const before = rows();
    const r2 = await bind({ address: A.mainnet, telegram_user_id: uid() });
    ok('合法主网地址 → 400 prefix-mismatch expected_prefix=kaspatest, 不写库', r2.status === 400 && r2.body.code === 'prefix-mismatch' && r2.body.expected_prefix === 'kaspatest' && rows() === before, `${r2.status} ${r2.raw.slice(0, 140)}`);
  }

  await fastify.close();
}

main().then(() => {
  console.log(`\n[link-network.test] ${pass} passed, ${fail} failed`);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { if (existsSync(f)) rmSync(f); } catch { /* best effort */ } }
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('[link-network.test] crashed:', e); process.exit(2); });
