// merchant-quote.test.mjs — 商家建报价 API 的路由级单测(真 Fastify + app.inject, 不碰链)。
// 真浏览器 + 真结账页的端到端见 docs/provenance/2026-10-02-j2-merchant-quote-page/e2e_merchant_quote.log。
// Run: cd kasia-console && node src/api/merchant-quote.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._MQ_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_mq_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _MQ_TEST_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
process.env.KASPA_NETWORK = 'simnet';
process.env.KASPA_RPC_URL = process.env.KASPA_RPC_URL || 'ws://127.0.0.1:1';

import Fastify from 'fastify';
import * as kaspa from 'kaspa-wasm';
const { registerMerchantQuoteRoutes, kasToSompi, percentToBps } = await import('./merchant-quote.js');
const { verifyQuoteSignature } = await import('../lib/commission-plan-sdk.mjs');
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

console.log('[test] 数值解析:');
ok(kasToSompi('10') === 1_000_000_000n && kasToSompi('0.00000001') === 1n && kasToSompi('12.5') === 1_250_000_000n, 'KAS → sompi 精确(BigInt)');
ok(throws(() => kasToSompi('0')) && throws(() => kasToSompi('-1')) && throws(() => kasToSompi('1.123456789')) && throws(() => kasToSompi('1e3')) && throws(() => kasToSompi('')), '价格 0/负数/9 位小数/科学计数/空 全拒');
ok(percentToBps('70') === 7000 && percentToBps('12.5') === 1250 && percentToBps('0') === 0 && percentToBps('100') === 10000, '百分数 → bps');
ok(throws(() => percentToBps('100.01')) && throws(() => percentToBps('101')) && throws(() => percentToBps('1.234')) && throws(() => percentToBps('abc')), '比例 >100/3 位小数/非数字 拒绝');

const app = Fastify(); await registerMerchantQuoteRoutes(app); await app.ready();
const post = (url, payload) => app.inject({ method: 'POST', url, payload });
const j = (r) => { try { return JSON.parse(r.body); } catch { return {}; } };
const addrOf = (hex) => new kaspa.PrivateKey(hex).toPublicKey().toAddress('simnet').toString();
const KEY = '0b'.repeat(32), A = addrOf(KEY), P = addrOf('0c'.repeat(32));

console.log('[test] GET quote-defaults / keygen:');
{
  const d = j(await app.inject({ method: 'GET', url: '/api/merchant/quote-defaults' }));
  ok(d.ok && d.network === 'simnet' && d.currencies.find((c) => c.id === 'KTT').enabled === false, '默认值: 网络取 env 单一源; KTT 预留未开放');
  const k = j(await post('/api/merchant/keygen', {}));
  ok(k.ok && /^[0-9a-f]{64}$/.test(k.private_key_hex) && k.address.startsWith('kaspasim:'), 'keygen 返回 64hex 私钥与 simnet 地址');
  const k2 = j(await post('/api/merchant/keygen', {}));
  ok(k.private_key_hex !== k2.private_key_hex, 'keygen 两次结果不同(随机)');
}

console.log('[test] 即时分账报价:');
{
  const r = await post('/api/merchant/quote', { kind: 'instant_split', price_kas: '10', provider_address: A, partners: [{ label: 'x', address: P, percent: '5' }], channel_percent: '25', max_channels: 3, signing_key_hex: KEY, checkout_base_url: 'https://example.com/checkout.html' });
  const b = j(r);
  ok(r.statusCode === 200 && b.ok, `200 ok(${r.statusCode} ${b.error || ''})`);
  ok(verifyQuoteSignature(b.quote), '签名可被既有 verifyQuoteSignature 独立验过');
  ok(b.quote.network === 'simnet' && b.quote.price_sompi === '1000000000', '报价带网络与精确价格');
  const roles = b.quote.canonical_rules.roles;
  ok(roles.reduce((a, x) => a + x.bps, 0) === 10000, `角色 bps 之和 = 10000(${roles.map((x) => x.name + ':' + x.bps).join(',')})`);
  ok(roles.filter((x) => x.name.startsWith('channel_')).length === 3 && roles.find((x) => x.name === 'partner_1').bps === 500, '3 层渠道 + 固定收款方 5%');
  ok(b.checkout_link.startsWith('https://example.com/checkout.html?q='), '链接 = 基址 + ?q=');
  ok(JSON.parse(Buffer.from(new URL(b.checkout_link).searchParams.get('q'), 'base64').toString()).signature_hex === b.quote.signature_hex, '链接里的 q= 解码后就是该签名报价');
  ok(typeof b.qr_svg === 'string' && b.qr_svg.includes('<svg'), '附二维码 SVG');
  const noBase = j(await post('/api/merchant/quote', { kind: 'instant_split', price_kas: '10', provider_address: A, signing_key_hex: KEY }));
  ok(noBase.ok && noBase.checkout_link === null && !!noBase.checkout_query, '没填结账页网址 ⇒ 不出链接, 仍给 q= 值');
  const noCh = j(await post('/api/merchant/quote', { kind: 'instant_split', price_kas: '10', provider_address: A, signing_key_hex: KEY }));
  ok(noCh.quote.canonical_rules.roles.length === 1 && noCh.quote.canonical_rules.roles[0].bps === 10000, '不开渠道 ⇒ 只有 provider 100%');
}

console.log('[test] 反例:');
{
  const t = async (payload, re, label) => { const r = await post('/api/merchant/quote', payload); const b = j(r); ok(r.statusCode === 400 && re.test(b.error || ''), `${label} ⇒ 400(${r.statusCode} ${b.error})`); };
  const base = { kind: 'instant_split', price_kas: '10', provider_address: A, signing_key_hex: KEY };
  await t({ ...base, kind: 'x' }, /订单类型/, '未知订单类型');
  await t({ ...base, currency: 'KTT' }, /KTT/, 'KTT 币种(预留未开放)');
  await t({ ...base, price_kas: '0' }, /价格/, '价格 0');
  await t({ ...base, provider_address: 'nonsense' }, /地址/, '非法收款地址');
  await t({ ...base, provider_address: 'kaspa:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' }, /地址/, '网络前缀与控制台网络不符的地址');
  await t({ ...base, signing_key_hex: '12' }, /私钥/, '私钥格式不对');
  await t({ ...base, partners: [{ address: P, percent: '60' }] }, /至少要占|不能超过/, '其他收款方占 60%');
  await t({ ...base, channel_percent: '30', max_channels: 6 }, /1~5/, '渠道人数 6');
  await t({ ...base, channel_percent: '60', max_channels: 3 }, /比例|占/, '渠道预算 60%');
  await t({ ...base, price_kas: '0.01', channel_percent: '25', max_channels: 5 }, /价格太低/, '价格过低放不下 5 层渠道');
  await t({ ...base, valid_days: 0 }, /有效期/, '有效期 0 天');
  await t({ ...base, checkout_base_url: 'ftp://x' }, /http/, '结账页网址非 http(s)');
  await t({ ...base, kind: 'service_escrow', buyer_refund_address: P }, /买家公钥/, '服务订单缺买家公钥且无专用 relay');
  await t({ ...base, kind: 'service_escrow', buyer_pubkey_hex: 'ab'.repeat(32) }, /买家退款/, '服务订单缺买家退款地址');
}

await app.close();
console.log(fails ? `\n${fails} 失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
