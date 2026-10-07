// delivery-routes.test.mjs — 账本1877 步2: 运营者回环路由(断言 g: 后台不展示 nonce) — fastify.inject, 临时 migration 库。
// Run: cd kasia-console && node src/api/delivery-routes.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
if (!process.env._DLVR_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_dlvr_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _DLVR_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
process.env.KASPA_NETWORK = 'simnet'; process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
import assert from 'node:assert';
import Fastify from 'fastify';
const { sqlite } = await import('../db/client.js');
const { registerDeliveryRoutes, DELIVERY_TIER_ENV } = await import('./delivery.js');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const SECRET = 'tier-secret-for-test-only';
const MERCHANT = 'kaspasim:qmerchant0000000000000000000000000000000000000000000000';
const mk = async (withSecret = true) => {
  if (withSecret) process.env[DELIVERY_TIER_ENV] = SECRET; else delete process.env[DELIVERY_TIER_ENV];
  const f = Fastify({ logger: false });
  await registerDeliveryRoutes(f, { db: sqlite, env: { KASPA_NETWORK: 'simnet' } });
  return f;
};
const H = { 'x-kanet-admin-secret': SECRET };
const body = (o = {}) => ({ sku_id: 'sku-r', total_sompi: '300000000', merchant_address: MERCHANT, merchant_amount_sompi: '250000000', deadline_ms: Date.now() + 3600_000, base_url: 'https://example.github.io/checkout/order.html', public_params: { q: 'QUOTE', ch: 'CHAN' }, ...o });
let created;

await t('鉴权: tier 密钥未设 ⇒ 503(fail-closed); 缺/错 header ⇒ 403; 非回环来源 ⇒ 403', async () => {
  const f0 = await mk(false);
  assert.strictEqual((await f0.inject({ method: 'GET', url: '/api/delivery/orders' })).statusCode, 503);
  const f = await mk();
  assert.strictEqual((await f.inject({ method: 'GET', url: '/api/delivery/orders' })).statusCode, 403);
  assert.strictEqual((await f.inject({ method: 'GET', url: '/api/delivery/orders', headers: { 'x-kanet-admin-secret': 'wrong' } })).statusCode, 403);
  assert.strictEqual((await f.inject({ method: 'GET', url: '/api/delivery/orders', headers: H, remoteAddress: '203.0.113.5' })).statusCode, 403, '非回环');
  assert.strictEqual((await f.inject({ method: 'GET', url: '/api/delivery/orders', headers: H, remoteAddress: '127.0.0.1' })).statusCode, 200);
});
await t('创建订单: 发票链接 nonce 只在 #n=; 响应其它字段无 nonce; 库里只以加密形态存在', async () => {
  const f = await mk();
  const r = await f.inject({ method: 'POST', url: '/api/delivery/orders', headers: H, payload: body() });
  assert.strictEqual(r.statusCode, 200); const j = r.json(); created = j;
  const u = new URL(j.invoice_link); assert.match(u.hash, /^#n=[0-9a-f]{32}$/); const nonce = u.hash.slice(3);
  assert.ok(!u.search.toLowerCase().includes(nonce.slice(0, 8)) && !u.pathname.includes(nonce.slice(0, 8)));
  assert.strictEqual(u.searchParams.get('q'), 'QUOTE');
  const noLink = { ...j }; delete noLink.invoice_link; assert.ok(!JSON.stringify(noLink).toLowerCase().includes(nonce), '响应其它字段不含 nonce');
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM delivery_orders').all()).toLowerCase().includes(nonce));
  created.nonce = nonce;
});
await t('断言 g: 订单查询/列表/登记地址/密文导出/库存 的响应里都没有 nonce(也没有 nonce_encrypted 字段名)', async () => {
  const f = await mk(); const nonce = created.nonce; const id = created.id; const outs = [];
  outs.push((await f.inject({ method: 'GET', url: `/api/delivery/orders/${id}`, headers: H })).body);
  outs.push((await f.inject({ method: 'GET', url: '/api/delivery/orders?state=created,watching', headers: H })).body);
  outs.push((await f.inject({ method: 'POST', url: `/api/delivery/orders/${id}/address`, headers: H, payload: { order_address: 'kaspasim:qrouteorder000000000000000000' } })).body);
  outs.push((await f.inject({ method: 'POST', url: '/api/delivery/stock', headers: H, payload: { sku_id: 'sku-r', items: ['CODE-R-1'] } })).body);
  outs.push((await f.inject({ method: 'GET', url: '/api/delivery/stock/sku-r', headers: H })).body);
  sqlite.prepare("UPDATE delivery_orders SET state='mailbox_sent', mailbox_payload_hex='4b444c31aa', mailbox_address='kaspasim:qmb', mailbox_txid=? WHERE id=?").run('f'.repeat(64), id);
  outs.push((await f.inject({ method: 'GET', url: `/api/delivery/orders/${id}/ciphertext`, headers: H })).body);
  const all = outs.join('\n').toLowerCase();
  for (let i = 0; i + 10 <= nonce.length; i++) assert.ok(!all.includes(nonce.slice(i, i + 10)), '响应含 nonce 片段');
  assert.ok(!all.includes('nonce_encrypted') && !all.includes('"nonce'), '响应不含 nonce 字段名');
  assert.ok(!all.includes('code-r-1'), '库存接口只给数量不给内容');
  assert.ok((all + nonce).includes(nonce.slice(0, 10)), '阳性对照: 扫描方法必须能抓到');
});
await t('密文导出: 未到 mailbox_sent ⇒ 404; 到了返回 payload_hex', async () => {
  const f = await mk();
  const j = (await f.inject({ method: 'POST', url: '/api/delivery/orders', headers: H, payload: body({ sku_id: 'sku-r2' }) })).json();
  assert.strictEqual((await f.inject({ method: 'GET', url: `/api/delivery/orders/${j.id}/ciphertext`, headers: H })).statusCode, 404);
  assert.strictEqual((await f.inject({ method: 'GET', url: `/api/delivery/orders/${created.id}/ciphertext`, headers: H })).json().payload_hex, '4b444c31aa');
});
await t('输入校验: 坏金额/过期 deadline/空 base_url/公开参数键 n/商家额>总额 ⇒ 400; 登记地址重复 ⇒ 409', async () => {
  const f = await mk();
  for (const bad of [{ total_sompi: '0' }, { deadline_ms: 1 }, { base_url: '' }, { public_params: { n: '1' } }, { merchant_amount_sompi: '999999999999' }]) assert.strictEqual((await f.inject({ method: 'POST', url: '/api/delivery/orders', headers: H, payload: body(bad) })).statusCode, 400, JSON.stringify(bad));
  assert.strictEqual((await f.inject({ method: 'POST', url: `/api/delivery/orders/${created.id}/address`, headers: H, payload: { order_address: 'kaspasim:qanother00000000000' } })).statusCode, 409);
});
await t('静态: delivery.js 不 console.* 任何内容; 7 个端点都过 guard; index.js 已注册', async () => {
  const src = fs.readFileSync(new URL('./delivery.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/console\./.test(src));
  assert.strictEqual((src.match(/fastify\.(get|post|put|delete)\(/g) || []).length, 7);
  assert.strictEqual((src.match(/if \(!guard\(request, reply\)\) return;/g) || []).length, 7);
  assert.match(fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8'), /await registerDeliveryRoutes\(fastify\)/);
});
console.log(`\n${pass} pass, ${fail} fail`); process.exitCode = fail ? 1 : 0;
