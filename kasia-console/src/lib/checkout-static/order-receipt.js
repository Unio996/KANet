// order-receipt.js — 订单凭据(D-034 结账页, Owner 2026-10-01 批「修」: 订单#1 的 1.0 KAS 因出单时随机
// orderNonce 没存、重建不了地址而永久退不回)。纯函数、零浏览器全局依赖(Node 可直接 import 测试)。
//
// 凭据 = 重建订单地址所需的、出单时才存在的那部分信息: orderNonce(16 字节随机)+ deadlineMs, 外加
// 报价/渠道链接原文(重建要重新验签验链)、退款地址、网络、出单时的地址。其余影响地址的字段(角色金额、
// 费用上限)都由"已验签的报价 + 已验证的渠道链"确定, 不进凭据(进了也不能信, 只会多一个可被篡改的口)。
// 地址是否一致由页面重建后逐字比对 order_address 把关——凭据被改任何一个字段都会得到不同地址而被拒。
export const RECEIPT_KIND = 'kanet-checkout-order-receipt';
export const RECEIPT_VERSION = 1;

const HEX32_RE = /^[0-9a-f]{32}$/;

export function buildOrderReceipt({ network, link, refundAddress, order, totalSompi }) {
  if (!HEX32_RE.test(order.orderNonceHex || '')) throw new Error('buildOrderReceipt: order.orderNonceHex 缺失或格式非法');
  if (!Number.isSafeInteger(order.deadlineMs)) throw new Error('buildOrderReceipt: order.deadlineMs 缺失或非整数');
  return {
    kind: RECEIPT_KIND,
    version: RECEIPT_VERSION,
    network,
    link, // 出单时的完整归因链接(含 q= 报价、ch=/sc= 渠道链), 重建时需打开同一份
    refund_address: refundAddress,
    order_nonce_hex: order.orderNonceHex,
    deadline_ms: order.deadlineMs,
    deadline_iso: new Date(order.deadlineMs).toISOString(),
    order_address: order.address,
    total_sompi: String(totalSompi),
    issued_at_iso: new Date().toISOString(),
  };
}

/** 解析并校验凭据 JSON 文本; 任何字段缺失/非法一律抛错(不补默认值)。 */
export function parseOrderReceipt(text) {
  let r;
  try { r = JSON.parse(text); } catch { throw new Error('凭据不是合法 JSON'); }
  if (!r || typeof r !== 'object') throw new Error('凭据格式非法');
  if (r.kind !== RECEIPT_KIND) throw new Error(`凭据类型不符(kind=${r.kind})`);
  if (r.version !== RECEIPT_VERSION) throw new Error(`凭据版本不支持(version=${r.version})`);
  for (const f of ['network', 'link', 'refund_address', 'order_address']) {
    if (typeof r[f] !== 'string' || !r[f]) throw new Error(`凭据缺少字段 ${f}`);
  }
  if (!HEX32_RE.test(r.order_nonce_hex || '')) throw new Error('凭据 order_nonce_hex 缺失或格式非法(需 32 位小写 hex)');
  if (!Number.isSafeInteger(r.deadline_ms) || r.deadline_ms <= 0) throw new Error('凭据 deadline_ms 缺失或非法');
  return r;
}

/** 凭据里的链接与当前页面链接是否指向同一份报价+渠道链(比 q / ch / sc 三个参数, 不比域名路径)。 */
export function receiptLinkMismatch(receipt, currentHref) {
  const a = new URL(receipt.link).searchParams, b = new URL(currentHref).searchParams;
  for (const k of ['q', 'ch', 'sc']) {
    if ((a.get(k) || '') !== (b.get(k) || '')) return k;
  }
  return null;
}
