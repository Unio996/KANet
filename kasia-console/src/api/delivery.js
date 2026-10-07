// api/delivery.js — 账本1877 步2: 数字商品「付款后交付」运营者回环路由(设计 v0.1–v0.3)。
//   只给【运营者】在本机用: console 只听 127.0.0.1, 买家够不到(这正是 v0.2 把取货通道改成链上信箱的原因); 另加专用 tier 密钥 ADMIN_SECRET_DELIVERY(未设 ⇒ 503 disabled, fail-closed)。
//   🔴 响应永不含 nonce, 唯一例外 = POST /orders 返回的发票链接(nonce 只在其 #n= 片段里, 且只返回这一次); 请求/响应不记日志(fastify logger:false; 本文件也不 console.* 任何 body)。
//   对外(买家侧)零端点: 买家取货 = 浏览器读链 + 本地解密(步 3), 不经本进程。
import { sqlite } from '../db/client.js';
import { checkAdminSecretTier } from '../lib/admin-secret-tier.mjs';
import { configuredNetwork } from '../lib/kaspa-network.mjs';
import * as S from '../lib/delivery-store.mjs';
import { buildInvoiceLink } from '../lib/checkout-static/delivery-crypto.js';
import { deriveInvoiceOrder, encodeQuoteParam } from '../lib/delivery-invoice.mjs';
import { randomBytes } from 'node:crypto';

export const DELIVERY_TIER_ENV = 'ADMIN_SECRET_DELIVERY';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function guard(request, reply) {
  if (!LOOPBACK.has(request.ip)) { reply.code(403).send({ ok: false, error: 'delivery 路由只接受本机回环请求' }); return false; }
  const a = checkAdminSecretTier(request, DELIVERY_TIER_ENV);
  if (!a.ok) { reply.code(a.code).send({ ok: false, error: a.error }); return false; }
  return true;
}

/** @param {import('fastify').FastifyInstance} fastify  @param {{db?:object, env?:object}} [deps] 测试可注入 */
export async function registerDeliveryRoutes(fastify, deps = {}) {
  const db = deps.db || sqlite, env = deps.env || process.env;

  fastify.post('/api/delivery/orders', async (request, reply) => {
    if (!guard(request, reply)) return;
    const b = request.body || {};
    let net;
    try { net = configuredNetwork(env); } catch (e) { return reply.code(500).send({ ok: false, error: `网络未配置: ${e.message}` }); }
    // 发票模式(账本1879): body.quote(已签名报价对象)⇒ 订单地址由 nonce + 报价 + deadline + nonce 派生的退款地址完全算出, 建单即 watching, 买家无需回话。
    if (b.quote) {
      try {
        const quote = typeof b.quote === 'string' ? JSON.parse(Buffer.from(b.quote, 'base64').toString('utf8')) : b.quote;
        const deadlineMs = Number(b.deadline_ms);
        const nonceHex = randomBytes(16).toString('hex');
        const d = await deriveInvoiceOrder({ quote, orderNonceHex: nonceHex, deadlineMs, expectNetwork: net });
        const c = S.createInvoiceOrder(db, { network: d.network, skuId: b.sku_id, totalSompi: d.totalSompi, merchantAddress: d.merchantAddress, merchantAmountSompi: d.merchantAmountSompi, deadlineMs, nonceHex, orderAddress: d.orderAddress, quoteJson: JSON.stringify(quote) });
        const link = buildInvoiceLink({ baseUrl: String(b.base_url || ''), publicParams: { ...(b.public_params && typeof b.public_params === 'object' ? b.public_params : {}), q: encodeQuoteParam(quote) }, orderNonceHex: nonceHex, deadlineMs });
        return { ok: true, id: c.id, state: 'watching', order_address: d.orderAddress, refund_address: d.refundAddress, total_sompi: d.totalSompi, invoice_link: link, note: '发票链接里的 #n= 是订单 nonce(也是退款/信箱私钥的来源), 只出现这一次; 请经你自己的渠道发给买家, 不要贴进任何公开处' };
      } catch (e) { return reply.code(400).send({ ok: false, error: String(e.message).slice(0, 200) }); }
    }
    try {
      const c = S.createOrder(db, { network: net, skuId: b.sku_id, totalSompi: b.total_sompi, merchantAddress: b.merchant_address, merchantAmountSompi: b.merchant_amount_sompi, deadlineMs: Number(b.deadline_ms) });
      const link = buildInvoiceLink({ baseUrl: String(b.base_url || ''), publicParams: b.public_params && typeof b.public_params === 'object' ? b.public_params : {}, orderNonceHex: c.orderNonceHex });
      return { ok: true, id: c.id, state: 'created', invoice_link: link, note: '发票链接里的 #n= 是订单 nonce, 只出现这一次; 请经你自己的渠道发给买家, 不要贴进任何公开处' };
    } catch (e) { return reply.code(400).send({ ok: false, error: String(e.message).slice(0, 200) }); }
  });

  fastify.post('/api/delivery/orders/:id/address', async (request, reply) => {
    if (!guard(request, reply)) return;
    const addr = String(request.body?.order_address || '');
    try {
      const ok = S.registerOrderAddress(db, request.params.id, addr);
      return ok ? { ok: true, state: 'watching' } : reply.code(409).send({ ok: false, error: '订单不存在, 或已登记过地址/不在 created 状态' });
    } catch (e) { return reply.code(409).send({ ok: false, error: String(e.message).slice(0, 200) }); }
  });

  fastify.get('/api/delivery/orders/:id', async (request, reply) => {
    if (!guard(request, reply)) return;
    const o = S.getOrderPublic(db, request.params.id);
    return o ? { ok: true, order: o } : reply.code(404).send({ ok: false, error: '订单不存在' });
  });

  fastify.get('/api/delivery/orders', async (request, reply) => {
    if (!guard(request, reply)) return;
    const st = request.query?.state ? String(request.query.state).split(',') : S.STATES.filter((s) => s !== 'delivered');
    if (!st.every((s) => S.STATES.includes(s))) return reply.code(400).send({ ok: false, error: '非法 state' });
    return { ok: true, orders: S.listOrdersByState(db, st) };
  });

  // 商家导出该单的密文 hex(Bettor 补充): 商家经自己的渠道发给买家, 买家页"粘贴密文"本地解密(同一 AEAD 校验)。密文本就公开在链上; 这里不返回 nonce/明文。
  fastify.get('/api/delivery/orders/:id/ciphertext', async (request, reply) => {
    if (!guard(request, reply)) return;
    const o = S.getOrderPublic(db, request.params.id);
    if (!o || !o.mailbox_payload_hex) return reply.code(404).send({ ok: false, error: '尚无密文(未到 mailbox_sent)' });
    return { ok: true, payload_hex: o.mailbox_payload_hex, mailbox_address: o.mailbox_address, mailbox_txid: o.mailbox_txid };
  });

  fastify.post('/api/delivery/stock', async (request, reply) => {
    if (!guard(request, reply)) return;
    const b = request.body || {};
    try { const n = S.addStock(db, String(b.sku_id || ''), Array.isArray(b.items) ? b.items : []); return { ok: true, added: n, available: S.stockAvailable(db, String(b.sku_id)) }; }
    catch (e) { return reply.code(400).send({ ok: false, error: String(e.message).slice(0, 200) }); }
  });
  fastify.get('/api/delivery/stock/:sku', async (request, reply) => {
    if (!guard(request, reply)) return;
    return { ok: true, sku_id: request.params.sku, available: S.stockAvailable(db, request.params.sku) };   // 只给数量, 不给内容
  });
}
