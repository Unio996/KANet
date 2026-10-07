// delivery-store.mjs — 账本1877 步2: 数字商品交付的【唯一写入口】(delivery_orders / delivery_stock, migrate v222)。
//   设计 docs/2026-10-07-j2-digital-goods-delivery-design-v0.1/0.2/0.3.md。db 由调用方注入(M0a: 新钱路模块不裸 import DB 客户端)。
//   🔴 orderNonce(128 位)只以 services/crypto.js 信封加密存(nonce_encrypted); 本文件对外返回的订单视图【永远不含】nonce(列清单显式枚举, 不用 SELECT *)。
//   nonce 只在两处出现明文: createOrder 的返回值(给运营者拼发票链接, 一次)与 unsealNonceForDelivery(watcher 加密交付物时内部用); 二者都不得写日志。
import { randomBytes, randomUUID } from 'node:crypto';
import { encrypt, decrypt } from '../services/crypto.js';

export const STATES = Object.freeze(['created', 'watching', 'paid', 'split_done', 'mailbox_sent', 'delivered', 'expired', 'manual_review']);
// 允许的状态迁移(CAS 的"from"集合在此集中声明; 其它迁移一律拒)
const ALLOWED = Object.freeze({
  watching: ['created'],
  paid: ['watching'],
  split_done: ['watching', 'paid'],          // watching→split_done: 买家抢先 split 且三条件全满足
  mailbox_sent: ['split_done'],
  delivered: ['mailbox_sent'],
  expired: ['created', 'watching', 'paid'],
  manual_review: ['watching', 'paid', 'split_done', 'mailbox_sent'],
});
// 公开视图的列(显式枚举; 绝不含 nonce_encrypted)
const PUBLIC_COLS = 'id, network, sku_id, order_address, total_sompi, merchant_address, merchant_amount_sompi, deadline_ms, state, manual_reason, pay_txid, split_txid, split_attempts, stock_id, mailbox_address, mailbox_txid, mailbox_payload_hex, mailbox_attempts, mailbox_sent_at, delivered_at, created_at, updated_at';
const PATCHABLE = new Set(['manual_reason', 'pay_txid', 'split_txid', 'stock_id', 'mailbox_address', 'mailbox_txid', 'mailbox_payload_hex', 'mailbox_sent_at', 'delivered_at']);
const SOMPI_RE = /^[1-9][0-9]{0,18}$/;

/** 创建订单(状态 created, 尚无订单地址)。返回 { id, orderNonceHex } —— nonce 明文只在这里返回一次, 调用方只能拿去拼发票链接(buildInvoiceLink), 不得记录。 */
export function createOrder(db, { network, skuId, totalSompi, merchantAddress, merchantAmountSompi, deadlineMs }) {
  if (!network || typeof network !== 'string') throw new Error('createOrder: network 必填');
  if (!skuId || typeof skuId !== 'string' || skuId.length > 100) throw new Error('createOrder: skuId 必填(≤100 字符)');
  for (const [k, v] of [['totalSompi', totalSompi], ['merchantAmountSompi', merchantAmountSompi]]) if (!SOMPI_RE.test(String(v))) throw new Error(`createOrder: ${k} 必须是正整数 sompi 字符串`);
  if (BigInt(merchantAmountSompi) > BigInt(totalSompi)) throw new Error('createOrder: merchantAmountSompi > totalSompi');
  if (!merchantAddress || typeof merchantAddress !== 'string') throw new Error('createOrder: merchantAddress 必填');
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= Date.now()) throw new Error('createOrder: deadlineMs 必须是未来的毫秒时间戳');
  const id = randomUUID();
  const nonceHex = randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO delivery_orders (id, network, sku_id, nonce_encrypted, total_sompi, merchant_address, merchant_amount_sompi, deadline_ms) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, network, skuId, encrypt(nonceHex), String(totalSompi), merchantAddress, String(merchantAmountSompi), deadlineMs);
  return { id, orderNonceHex: nonceHex };
}

/** 对外视图: 永不含 nonce。 */
export function getOrderPublic(db, id) {
  return db.prepare(`SELECT ${PUBLIC_COLS} FROM delivery_orders WHERE id = ?`).get(id) || null;
}
export function listOrdersByState(db, states) {
  const ph = states.map(() => '?').join(',');
  return db.prepare(`SELECT ${PUBLIC_COLS} FROM delivery_orders WHERE state IN (${ph}) ORDER BY created_at, id`).all(...states);
}

/** watcher 内部专用: 解封 nonce 以加密交付物。调用方不得记录返回值。 */
export function unsealNonceForDelivery(db, id) {
  const r = db.prepare('SELECT nonce_encrypted FROM delivery_orders WHERE id = ?').get(id);
  if (!r) throw new Error('unsealNonceForDelivery: 订单不存在');
  return decrypt(r.nonce_encrypted);
}

/** 登记订单地址(买家把退款地址告知商家并由运营者推导出订单地址后)。created→watching 的 CAS; 地址已被别单占用 ⇒ 抛。 */
export function registerOrderAddress(db, id, orderAddress) {
  if (!orderAddress || typeof orderAddress !== 'string' || orderAddress.length < 10) throw new Error('registerOrderAddress: orderAddress 非法');
  const r = db.prepare(`UPDATE delivery_orders SET order_address = ?, state = 'watching', updated_at = datetime('now') WHERE id = ? AND state = 'created' AND order_address IS NULL`).run(orderAddress, id);
  return r.changes === 1;
}

/** 状态迁移 CAS: 仅当当前状态 ∈ ALLOWED[to] 才生效; patch 只许白名单列。返回是否生效。 */
export function transition(db, id, to, patch = {}) {
  const from = ALLOWED[to];
  if (!from) throw new Error(`transition: 不允许迁入 ${to}`);
  const cols = Object.keys(patch);
  for (const c of cols) if (!PATCHABLE.has(c)) throw new Error(`transition: 列 ${c} 不可经 patch 写入`);
  const sets = ['state = ?', "updated_at = datetime('now')", ...cols.map((c) => `${c} = ?`)];
  const ph = from.map(() => '?').join(',');
  const r = db.prepare(`UPDATE delivery_orders SET ${sets.join(', ')} WHERE id = ? AND state IN (${ph})`).run(to, ...cols.map((c) => patch[c]), id, ...from);
  return r.changes === 1;
}
/** 只加计数、不改状态(重试次数)。 */
export function bumpCounter(db, id, which) {
  if (which !== 'split_attempts' && which !== 'mailbox_attempts') throw new Error('bumpCounter: 非法计数列');
  return db.prepare(`UPDATE delivery_orders SET ${which} = ${which} + 1, updated_at = datetime('now') WHERE id = ?`).run(id).changes === 1;
}

// ── 库存 ──
export function addStock(db, skuId, plaintexts) {
  if (!skuId) throw new Error('addStock: skuId 必填');
  const ins = db.prepare('INSERT INTO delivery_stock (sku_id, payload_encrypted) VALUES (?, ?)');
  const tx = db.transaction((items) => { for (const p of items) { if (typeof p !== 'string' || !p.length || Buffer.byteLength(p) > 1024) throw new Error('addStock: 每项须为 1..1024 字节的非空字符串'); ins.run(skuId, encrypt(p)); } return items.length; });
  return tx(plaintexts);
}
export function stockAvailable(db, skuId) {
  return db.prepare('SELECT count(*) n FROM delivery_stock WHERE sku_id = ? AND assigned_order IS NULL').get(skuId).n;
}
/**
 * 原子分配(一码一单 + 幂等): 订单已分配 ⇒ 返回同一项(崩溃重启重发同一交付物, 绝不二次分配); 否则单条 UPDATE…WHERE assigned_order IS NULL 取该 sku 最早一项。
 * 无库存 ⇒ null(调用方转人工)。分配与写 delivery_orders.stock_id 在同一事务。
 */
export function assignStock(db, orderId) {
  const run = db.transaction(() => {
    const o = db.prepare('SELECT sku_id, stock_id FROM delivery_orders WHERE id = ?').get(orderId);
    if (!o) throw new Error('assignStock: 订单不存在');
    if (o.stock_id != null) return { stockId: o.stock_id, reused: true };
    const row = db.prepare(`UPDATE delivery_stock SET assigned_order = ? WHERE id = (SELECT id FROM delivery_stock WHERE sku_id = ? AND assigned_order IS NULL ORDER BY id LIMIT 1) AND assigned_order IS NULL RETURNING id`).get(orderId, o.sku_id);
    if (!row) return null;
    db.prepare("UPDATE delivery_orders SET stock_id = ?, updated_at = datetime('now') WHERE id = ?").run(row.id, orderId);
    return { stockId: row.id, reused: false };
  });
  return run();
}
export function readStockPlaintext(db, stockId) {
  const r = db.prepare('SELECT payload_encrypted FROM delivery_stock WHERE id = ?').get(stockId);
  if (!r) throw new Error('readStockPlaintext: 库存项不存在');
  return decrypt(r.payload_encrypted);
}

/** 记录一次 split 广播(txid 落库 + 计数 +1 + updated_at 刷新, 供"等多久再重试"判断)。状态不变(仍 paid)。 */
export function recordSplitBroadcast(db, id, txid) {
  return db.prepare("UPDATE delivery_orders SET split_txid = ?, split_attempts = split_attempts + 1, updated_at = datetime('now') WHERE id = ? AND state = 'paid'").run(txid, id).changes === 1;
}
/** 记录一次信箱重发(同一密文新交易): mailbox_txid 换成新的, 计数 +1, mailbox_sent_at 刷新。状态不变(仍 mailbox_sent)。 */
export function recordMailboxResend(db, id, txid) {
  return db.prepare("UPDATE delivery_orders SET mailbox_txid = ?, mailbox_attempts = mailbox_attempts + 1, mailbox_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND state = 'mailbox_sent'").run(txid, id).changes === 1;
}

// ── 发票模式(账本1877 步3): 订单地址由 nonce + 报价 + deadline + nonce 派生的退款地址完全决定, 建单即可登记, 无需买家回话 ──
/**
 * 创建订单并同时登记订单地址(状态直接 watching)。nonce 由调用方生成(订单地址依赖它), 加密落库, 返回值不含 nonce。
 * quoteJson = 公开签名报价 JSON(重建协议/split 用)。
 */
export function createInvoiceOrder(db, { network, skuId, totalSompi, merchantAddress, merchantAmountSompi, deadlineMs, nonceHex, orderAddress, quoteJson }) {
  if (!/^[0-9a-f]{32}$/.test(String(nonceHex || ''))) throw new Error('createInvoiceOrder: nonceHex 必须是 32 位小写 hex');
  if (!orderAddress || typeof orderAddress !== 'string' || orderAddress.length < 10) throw new Error('createInvoiceOrder: orderAddress 非法');
  if (typeof quoteJson !== 'string' || !quoteJson.length || quoteJson.length > 20000) throw new Error('createInvoiceOrder: quoteJson 必填(≤20KB)');
  if (!network || typeof network !== 'string') throw new Error('createInvoiceOrder: network 必填');
  if (!skuId || typeof skuId !== 'string' || skuId.length > 100) throw new Error('createInvoiceOrder: skuId 必填(≤100 字符)');
  for (const [k, v] of [['totalSompi', totalSompi], ['merchantAmountSompi', merchantAmountSompi]]) if (!SOMPI_RE.test(String(v))) throw new Error(`createInvoiceOrder: ${k} 必须是正整数 sompi 字符串`);
  if (BigInt(merchantAmountSompi) > BigInt(totalSompi)) throw new Error('createInvoiceOrder: merchantAmountSompi > totalSompi');
  if (!merchantAddress) throw new Error('createInvoiceOrder: merchantAddress 必填');
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= Date.now()) throw new Error('createInvoiceOrder: deadlineMs 必须是未来的毫秒时间戳');
  const id = randomUUID();
  db.prepare(`INSERT INTO delivery_orders (id, network, sku_id, order_address, state, nonce_encrypted, total_sompi, merchant_address, merchant_amount_sompi, deadline_ms, quote_json) VALUES (?,?,?,?, 'watching', ?,?,?,?,?,?)`)
    .run(id, network, skuId, orderAddress, encrypt(nonceHex), String(totalSompi), merchantAddress, String(merchantAmountSompi), deadlineMs, quoteJson);
  return { id };
}
export function getQuoteJson(db, id) {
  const r = db.prepare('SELECT quote_json FROM delivery_orders WHERE id = ?').get(id);
  return r ? r.quote_json : null;
}
