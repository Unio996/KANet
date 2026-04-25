// broker-sell-handler.js — Phase 4 Round 3 SELL 入口 (T-NWT-08)
// 真人 DM "卖 X KAS" → broker 问 BSC 地址 → 用户 DM 0x... → broker INSERT retail_dex_orders + DM 转 KAS 指引
// 用户后续转 KAS → broker-intake-watcher (T-NWT-05/07) 自动 publish + 走 exchange protocol
// 不自建 exchange/订单状态机, 复用 retail_dex_orders + broker-intake-watcher.
// 镜像 broker-buy-handler.js 模式 (T-J2-08), 共用 conversations.js fork 路由.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const SELL_REGEX = /^\s*(?:卖|sell)\s*(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*KAS\s*$/i;
const EVM_ADDR_REGEX = /^0x[a-fA-F0-9]{40}$/;
const CANCEL_WORDS = ['NO', 'no', 'n', '取消', '不要', '算了'];
const PENDING_TTL_MS = 30 * 60 * 1000;  // 30min 等用户回 BSC 地址
const FEE_KAS = 0.1;    // 默认 broker fee (与 broker-intake-watcher DEFAULT_FEE_KAS 一致)
const MID_PRICE_HINT = 0.034;   // 报价提示 (真挂单价由 broker-intake-watcher fetchKasPrice 决定)

const _pending = new Map();  // peer → {qty, expires_at, ask_state}

export function _testClearPending() { _pending.clear(); }
export function _hasPending(peer) { return _pending.has(peer); }

function _traderBAddr() {
  return sqlite.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(BROKER_RELAY_ID)?.address;
}

function _insertSellOrder({ peerAddr, qty, userBnbAddr }) {
  const orderId = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO retail_dex_orders
      (id, user_kasia_address, side, order_type, qty, price, pay_chain, pay_address, state, created_at, updated_at)
    VALUES (?, ?, 'sell_kas', 'limit', ?, ?, 'bnb', ?, 'awaiting_payment', ?, ?)
  `).run(orderId, peerAddr, String(qty), String(MID_PRICE_HINT), userBnbAddr, now, now);
  return orderId;
}

// R4 改造 (T-NWT-09): 走 broker-action-queue 单线 pump 防 UTXO 双花.
async function _qDm(peerAddr, message) {
  const { enqueue, getQueueStats } = await import('./broker-action-queue.js');
  const stats = getQueueStats();
  const suffix = stats.length > 0 ? `\n\n(前面 ${stats.length} 笔待处理, 排队 ~${Math.ceil(stats.length * 5)}s)` : '';
  return enqueue({ kind: 'dm_quote', peer: peerAddr, payload: { message: message + suffix } });
}

export async function handleSellIntent(peerAddr, message) {
  const trimmed = (message || '').trim();
  const pending = _pending.get(peerAddr);

  // pending 'pay_addr' state: 等用户 DM BSC 地址
  if (pending && Date.now() < pending.expires_at) {
    if (CANCEL_WORDS.includes(trimmed)) {
      _pending.delete(peerAddr);
      _qDm(peerAddr, `已取消卖单. 重新下单回"卖 X KAS".`);
      return '';
    }
    if (pending.ask_state === 'pay_addr') {
      const addrMatch = trimmed.match(EVM_ADDR_REGEX);
      if (!addrMatch) {
        _qDm(peerAddr, `地址格式不对, 应该是 0x 开头 42 位 (BSC/EVM). 重发, 或回 NO 取消.`);
        return '';
      }
      const userBnbAddr = addrMatch[0];
      const qty = pending.qty;
      _insertSellOrder({ peerAddr, qty, userBnbAddr });
      _pending.delete(peerAddr);

      const traderAddr = _traderBAddr() || '(broker 地址未配置)';
      const netKas = qty - FEE_KAS;
      const estUsdt = (netKas * MID_PRICE_HINT).toFixed(4);
      _qDm(peerAddr,
        `✓ 卖单已建. 请转 ${qty} KAS 到 broker:\n${traderAddr}\n\n` +
        `转完后 broker 自动挂 SELL 单 (${netKas} KAS net, 扣 ${FEE_KAS} KAS fee), ` +
        `接单后 USDT 直付你 BSC ${userBnbAddr.slice(0,10)}...${userBnbAddr.slice(-4)} (~${estUsdt} USDT).\n` +
        `2h 内无人接 → broker 自动退原 ${qty} KAS.`);
      return '';
    }
  }

  // 解析卖意图
  const m = SELL_REGEX.exec(trimmed);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  if (qty <= 0) return null;
  if (qty <= FEE_KAS) {
    _qDm(peerAddr, `太少了, 至少 ${FEE_KAS + 0.5} KAS (扣 ${FEE_KAS} KAS broker fee 后才有意义).`);
    return '';
  }

  _pending.set(peerAddr, { qty, expires_at: Date.now() + PENDING_TTL_MS, ask_state: 'pay_addr' });

  const netKas = qty - FEE_KAS;
  const estUsdt = (netKas * MID_PRICE_HINT).toFixed(4);
  _qDm(peerAddr,
    `📋 卖 ${qty} KAS 申请收到.\n` +
    `预估 ${netKas} KAS net (扣 ${FEE_KAS} KAS broker fee) → ~${estUsdt} USDT (~${MID_PRICE_HINT} USDT/KAS, 真价由 broker 挂单时锁定).\n\n` +
    `请回你的 BSC 钱包地址 (0x... 42 位) 接收 USDT. 30min 内回. 或回 NO 取消.`);
  return '';
}
