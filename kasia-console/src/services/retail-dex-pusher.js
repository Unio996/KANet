// retail-dex-pusher.js — T7 M5 状态推送
// Broker 在状态转换后主动 DM 用户. 模板驱动.
//
// ⚠ SUPERSEDED BY docs/spec/2026-04-24-dex-broker-v2-glue-layer.md
// ⚠ DO NOT EXTEND — see docs/ANTI-PATTERNS.md (v1 retail-dex case study)
// v2 replaces this with Mind proactive pipeline (mind-manager.triggerProactive).

import { sqlite } from '../db/client.js';

// Test injection hook
let _sendCommandOverride = null;
export function _testInjectSendCommandAsync(fn) { _sendCommandOverride = fn; }
export function _testResetSendCommandAsync() { _sendCommandOverride = null; }
async function _getSendCommandAsync() {
  if (_sendCommandOverride) return _sendCommandOverride;
  const m = await import('./relay-manager.js');
  return m.sendCommandAsync;
}

// ── Templates ──────────────────────────────────────────────────────────────

export const ORDER_TEMPLATES = {
  'confirming': (o) =>
    `📋 订单 ${o.id.slice(0, 8)} 报价: ${o.qty} KAS @ ${o.mid_price_at_quote || '?'} USDT/KAS. 回 YES 确认 NO 取消.`,
  'awaiting_payment': (o) =>
    `✅ 订单 ${o.id.slice(0, 8)} accept 已上链. 30min 内付 ${o.quoted_usdt} USDT 到 ${o.agent_pay_addr?.slice(0, 12)}...`,
  'paid': (o) =>
    `💰 订单 ${o.id.slice(0, 8)} 你付款已上链 (tx ${o.user_payment_tx?.slice(0, 10) || '?'}...). Maker 核对中...`,
  'executing': (o) =>
    `⚙️ 订单 ${o.id.slice(0, 8)} Maker 开始发 KAS, 稍候...`,
  'completed': (o) =>
    `🎉 订单 ${o.id.slice(0, 8)} 成交! Maker 发 KAS tx=${o.kas_delivery_tx?.slice(0, 10) || '?'}... 到你 Kasia ...${(o.user_kasia_address || '').slice(-12)}`,
  'expired': (o) =>
    `⏱️ 订单 ${o.id.slice(0, 8)} 超时已取消. 原因: ${o.error_reason || '无匹配挂单'}.`,
  'failed': (o) =>
    `❌ 订单 ${o.id.slice(0, 8)} 失败. ${o.error_reason || '联系管理员'}.`,
  'refunded': (o) =>
    `💵 订单 ${o.id.slice(0, 8)} 已退款. tx=${o.usdt_refund_tx?.slice(0, 10) || '?'}...`,
};

export const PUB_TEMPLATES = {
  'awaiting_deposit': (p) =>
    `📬 挂单 ${p.id.slice(0, 8)} 待充值: 请发 ${p.total_usdt} USDT 到 Seeder (${p.pay_chain.toUpperCase()}).`,
  'deposited': (p) =>
    `✅ 挂单 ${p.id.slice(0, 8)} 收到你的 USDT. Seeder 发布链上 BUY 挂单中...`,
  'published': (p) =>
    `📢 挂单 ${p.id.slice(0, 8)} 已链上发布. 等卖家接单. 60min 内无人接自动退款.`,
  'filled': (p) =>
    `🎯 挂单 ${p.id.slice(0, 8)} 卖家接单! KAS 直发你 Kasia 中...`,
  'completed': (p) =>
    `🎉 挂单 ${p.id.slice(0, 8)} 成交! Seeder 已发 USDT 给卖家 (tx ${p.kas_delivery_tx?.slice(0, 10) || '?'}...).`,
  'refunding': (p) =>
    `💵 挂单 ${p.id.slice(0, 8)} 超时无人接, Seeder 正在退你 USDT...`,
  'refunded': (p) =>
    `💵 挂单 ${p.id.slice(0, 8)} 已退款 ${p.total_usdt} USDT. tx=${p.usdt_refund_tx?.slice(0, 10) || '?'}...`,
  'failed': (p) =>
    `❌ 挂单 ${p.id.slice(0, 8)} 失败. ${p.error_reason || '联系管理员'}.`,
};

// ── Push Functions ─────────────────────────────────────────────────────────

export async function pushOrderTransition({ order, newState, brokerRelayId }) {
  const template = ORDER_TEMPLATES[newState];
  if (!template) return; // skip unknown states (aligning, refunding)
  const msg = template(order);
  return _sendDm({ userAddr: order.user_kasia_address, msg, brokerRelayId, context: `order-${newState}` });
}

export async function pushPubTransition({ pub, newState, brokerRelayId }) {
  const template = PUB_TEMPLATES[newState];
  if (!template) return;
  const msg = template(pub);
  return _sendDm({ userAddr: pub.user_kasia_address, msg, brokerRelayId, context: `pub-${newState}` });
}

async function _sendDm({ userAddr, msg, brokerRelayId, context }) {
  if (!userAddr || !brokerRelayId) {
    console.warn(`[pusher] ${context} missing userAddr/brokerRelayId, skip`);
    return { skipped: true };
  }
  try {
    const sendCommandAsync = await _getSendCommandAsync();
    const result = await sendCommandAsync(brokerRelayId, {
      type: 'send_message',
      target: userAddr,
      message: msg,
    });
    console.log(`[pusher] ${context} → ${userAddr.slice(-12)} (tx ${result.txId?.slice(0, 10) || 'err'})`);
    return result;
  } catch (err) {
    console.error(`[pusher] ${context} failed: ${err.message}`);
    return { error: err.message };
  }
}
