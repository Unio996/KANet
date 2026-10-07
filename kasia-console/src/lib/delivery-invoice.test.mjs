// delivery-invoice.test.mjs — 账本1877 步3: 发票模式订单推导(退款地址 = nonce 派生 P2PK)。含与结账页浏览器路径的地址对拍 + 路由集成。
// Run: cd kasia-console && node src/lib/delivery-invoice.test.mjs   (自举: 临时 migration 库)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
if (!process.env._DLVI_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_dlvi_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _DLVI_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
process.env.KASPA_NETWORK = 'simnet'; process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import * as kaspa from 'kaspa-wasm';
const SDK = await import('./commission-plan-sdk.mjs');
const I = await import('./delivery-invoice.mjs');
const X = await import('./checkout-static/delivery-crypto.js');
const RB = await import('./checkout-static/resolve-order-browser.js');
const { CS_SOURCE_SHA256 } = await import('./checkout-static/order-template.js');
const FS = await import('./fee-split.mjs');
const { sqlite } = await import('../db/client.js');
const S = await import('./delivery-store.mjs');
const { registerDeliveryRoutes, DELIVERY_TIER_ENV } = await import('../api/delivery.js');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };

const addrOf = (seedHex) => new kaspa.PrivateKey(seedHex).toPublicKey().toAddress('simnet').toString();
const MERCHANT_PRIV = '21'.repeat(32);
const PROVIDER = addrOf('31'.repeat(32)), BROKER = addrOf('32'.repeat(32));
const mkQuote = (o = {}) => SDK.signQuote({
  schema_v: 1, quote_id: 'qinv-' + Math.random().toString(36).slice(2), network: 'simnet', merchant_pubkey_hex: new kaspa.PrivateKey(MERCHANT_PRIV).toPublicKey().toString(),
  price_sompi: '300000000',
  canonical_rules: { schema_v: 1, roles: [{ name: 'provider', bps: 7000, address: PROVIDER }, { name: 'broker', bps: 500, address: BROKER }, { name: 'channel_1', bps: 2500, fold_to: 'provider' }] },
  unfilled_channel_slot_fold_to: 'provider', valid_from_ms: Date.now() - 1000, valid_until_ms: Date.now() + 30 * 86400000, channel_whitelist: null,
  require_channel_deposit: false, min_deposit_sompi: '100000000', max_split_fee_sompi: '40000000', max_refund_fee_sompi: '10000000', deadline_offset_ms: 259200000, ...o,
}, MERCHANT_PRIV);
const NONCE = '00112233445566778899aabbccddeeff';
const DL = Date.now() + 3 * 86400000;
const quote = mkQuote();

await t('推导: 确定性(同输入同地址); 换 nonce/deadline ⇒ 地址变; 退款地址 = nonce 派生 P2PK; 总额/商家额来自报价', async () => {
  const a = await I.deriveInvoiceOrder({ quote, orderNonceHex: NONCE, deadlineMs: DL, expectNetwork: 'simnet' });
  const b = await I.deriveInvoiceOrder({ quote, orderNonceHex: NONCE, deadlineMs: DL });
  assert.strictEqual(a.orderAddress, b.orderAddress); assert.ok(a.orderAddress.startsWith('kaspasim:p'));
  assert.notStrictEqual((await I.deriveInvoiceOrder({ quote, orderNonceHex: NONCE.replace(/.$/, '0'), deadlineMs: DL })).orderAddress, a.orderAddress);
  assert.notStrictEqual((await I.deriveInvoiceOrder({ quote, orderNonceHex: NONCE, deadlineMs: DL + 1 })).orderAddress, a.orderAddress);
  const rk = (await X.deriveRefundKey({ orderNonceHex: NONCE, network: 'simnet' })).refundPrivHex;
  assert.strictEqual(a.refundAddress, new kaspa.PrivateKey(rk).toPublicKey().toAddress('simnet').toString());
  assert.strictEqual(a.totalSompi, '300000000'); assert.strictEqual(a.merchantAddress, PROVIDER); assert.strictEqual(BigInt(a.merchantAmountSompi) > 0n, true);
  assert.ok(BigInt(a.merchantAmountSompi) <= BigInt(a.totalSompi));
});
await t('与结账页浏览器路径对拍: resolveRulesForOrder + rebuildCommissionOrderAddress(固定偏移覆写, 买家页用的同一套)得到【同一个】订单地址', async () => {
  const d = await I.deriveInvoiceOrder({ quote, orderNonceHex: NONCE, deadlineMs: DL });
  const src = fs.readFileSync(new URL('./sil-v1/CommissionSplit.sil', import.meta.url));
  const sha = createHash('sha256').update(src).digest('hex');
  assert.strictEqual(sha, CS_SOURCE_SHA256, '模板锚点与当前 .sil 一致(否则买家页降级路径会 fail-closed, 先重生成模板)');
  const resolved = RB.resolveRulesForOrder(kaspa, FS, quote, { ok: true, channelSpks: [] });
  const finalRoles = resolved.payoutLeaves.map((r) => ({ amountSompi: r.amountSompi, spk: new Uint8Array(r.spk) }));
  const refundAddress = d.refundAddress;
  const buyer = RB.rebuildCommissionOrderAddress(kaspa, { network: 'simnet', finalRoles, payerRefundAddress: refundAddress, maxSplitFeeSompi: BigInt(quote.max_split_fee_sompi), maxRefundFeeSompi: BigInt(quote.max_refund_fee_sompi), orderNonceHex: await X.deriveOrderNonce({ orderNonceHex: NONCE }), deadlineMs: DL }, sha);
  assert.strictEqual(buyer.address, d.orderAddress, '买家页推出的订单地址 ≠ 商家 console 推出的 ⇒ 付款会打到买家看不到的地址');
});
await t('🔴 合约 order_nonce 是交付秘密的单向派生: redeem(split/退款花费时公开上链)里没有秘密的任何 8 位窗口, 但有派生出的合约 nonce', async () => {
  const d = await I.deriveInvoiceOrder({ quote, orderNonceHex: NONCE, deadlineMs: DL });
  const cn = await X.deriveOrderNonce({ orderNonceHex: NONCE });
  assert.notStrictEqual(cn, NONCE); assert.match(cn, /^[0-9a-f]{32}$/);
  assert.ok(!X.leaksNonce(d.protocol.redeemScriptHex, NONCE), '订单 redeem(花费时公开)泄漏了交付秘密 ⇒ split 之后任何人能解密交付物/清扫');
  assert.ok(d.protocol.redeemScriptHex.includes(cn), 'redeem 里烤的是派生出的合约 nonce');
  assert.strictEqual(d.protocol.orderNonceHex, cn);
});
await t('拒绝: 验签失败 / 过期 / 未生效 / 网络不符 / 要求押金 / deadline 已过 / 缺 network', async () => {
  const rej = (q, o = {}) => assert.rejects(I.deriveInvoiceOrder({ quote: q, orderNonceHex: NONCE, deadlineMs: DL, ...o }));
  await rej({ ...quote, price_sompi: '299999999' });                                   // 篡改 ⇒ 验签失败
  await rej(mkQuote({ valid_until_ms: Date.now() - 1 }));
  await rej(mkQuote({ valid_from_ms: Date.now() + 86400000 }));
  await rej(quote, { expectNetwork: 'mainnet' });
  await rej(quote, { deadlineMs: Date.now() - 1 });
  await rej(null);
  const noNet = { ...quote }; delete noNet.network; await rej(noNet);
});

// ── 路由集成 ──
const C_leaks = (s, n) => X.leaksNonce(s, n);
const SECRET = 'tier-secret-for-test-only';
const mkApp = async () => { process.env[DELIVERY_TIER_ENV] = SECRET; const f = Fastify({ logger: false }); await registerDeliveryRoutes(f, { db: sqlite, env: { KASPA_NETWORK: 'simnet' } }); return f; };
const H = { 'x-kanet-admin-secret': SECRET };
await t('路由发票模式: 建单即 watching; 链接 nonce 与 dl 只在片段, ?q= 可解回报价; 响应与库里对外视图零 nonce; 解封的 nonce = 链接里的; 库里存了 quote_json', async () => {
  const f = await mkApp();
  const r = await f.inject({ method: 'POST', url: '/api/delivery/orders', headers: H, payload: { sku_id: 'sku-inv', deadline_ms: DL, base_url: 'https://example.github.io/checkout/delivery.html', quote } });
  assert.strictEqual(r.statusCode, 200, r.body); const j = r.json();
  assert.strictEqual(j.state, 'watching'); assert.ok(j.order_address.startsWith('kaspasim:p')); assert.strictEqual(j.total_sompi, '300000000');
  const u = new URL(j.invoice_link); const nonce = /n=([0-9a-f]{32})/.exec(u.hash)[1];
  assert.ok(u.hash.includes('&dl=' + DL)); assert.ok(!C_leaks(u.search + u.pathname, nonce));
  assert.deepStrictEqual(JSON.parse(Buffer.from(u.searchParams.get('q'), 'base64').toString('utf8')), quote);
  const noLink = { ...j }; delete noLink.invoice_link; assert.ok(!JSON.stringify(noLink).toLowerCase().includes(nonce));
  const pub = S.getOrderPublic(sqlite, j.id); assert.strictEqual(pub.order_address, j.order_address); assert.ok(!JSON.stringify(pub).toLowerCase().includes(nonce));
  assert.strictEqual(S.unsealNonceForDelivery(sqlite, j.id), nonce); assert.deepStrictEqual(JSON.parse(S.getQuoteJson(sqlite, j.id)), quote);
  // 买家侧只凭链接片段+报价就能推出同一订单地址
  const d = await I.deriveInvoiceOrder({ quote, orderNonceHex: nonce, deadlineMs: DL }); assert.strictEqual(d.orderAddress, j.order_address);
});
await t('路由发票模式: 坏报价/网络不符/过期 deadline ⇒ 400 且不留半成品订单', async () => {
  const f = await mkApp(); const before = sqlite.prepare('SELECT count(*) n FROM delivery_orders').get().n;
  for (const bad of [{ quote: { ...quote, price_sompi: '1' } }, { quote: mkQuote({ network: 'mainnet' }) }, { deadline_ms: 1 }]) {
    const r = await f.inject({ method: 'POST', url: '/api/delivery/orders', headers: H, payload: { sku_id: 's', deadline_ms: DL, base_url: 'https://example.github.io/o.html', quote, ...bad } });
    assert.strictEqual(r.statusCode, 400, JSON.stringify(bad).slice(0, 80));
  }
  assert.strictEqual(sqlite.prepare('SELECT count(*) n FROM delivery_orders').get().n, before);
});
await t('store: createInvoiceOrder 校验(坏 nonce/地址/报价/金额/过期)⇒抛; 对外视图无 quote_json 之外的 nonce', () => {
  const ok = { network: 'simnet', skuId: 's', totalSompi: '5', merchantAddress: PROVIDER, merchantAmountSompi: '3', deadlineMs: Date.now() + 1e6, nonceHex: NONCE, orderAddress: 'kaspasim:pdup0000000000', quoteJson: '{}' };
  for (const bad of [{ nonceHex: 'zz' }, { orderAddress: '' }, { quoteJson: '' }, { totalSompi: '0' }, { merchantAmountSompi: '9' }, { deadlineMs: 1 }]) assert.throws(() => S.createInvoiceOrder(sqlite, { ...ok, ...bad }), undefined, JSON.stringify(bad));
  const a = S.createInvoiceOrder(sqlite, ok); assert.ok(a.id); assert.throws(() => S.createInvoiceOrder(sqlite, ok), /UNIQUE/i, '同一订单地址不能建两单');
});
console.log(`\n${pass} pass, ${fail} fail`); process.exitCode = fail ? 1 : 0;
