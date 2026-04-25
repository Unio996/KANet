// broker-buy-handler.js — Phase 4 A 模式撮合 (T-J2-08, v2.1.1)
// 用户 DM "买 X KAS" → 选 best open offer → 报价 → 用户 YES → 广播 accept_v1
// 复用 exchange_offers + exchange-machine, 不自建状态机不自建订单表.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const BUY_REGEX = /^\s*(?:买|buy)\s*(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*KAS\s*$/i;
// T-J2-12 真人 PAID 意图: "我付了 0xabc...", "已付 0x...", "paid 0x...", "pay 0x..."
const PAID_REGEX = /(?:已付|付了|我付|paid|pay)[\s\S]{0,40}?\b(0x[a-fA-F0-9]{64})\b/i;
const CONFIRM_WORDS = ['YES', 'yes', 'y', '确认', '好', '行', 'OK', 'ok'];
const CANCEL_WORDS  = ['NO', 'no', 'n', '取消', '不要', '算了'];
const QUOTE_TTL_MS = 5 * 60 * 1000;
const PENDING_ACCEPT_TTL_MS = 30 * 60 * 1000;  // 真人付款窗口 30min

const _quotes = new Map();  // peer → {offer_id, qty, quoted_usdt, pay_chain, maker_addr, expires_at}
const _pendingAccepts = new Map();  // peer → {offer_id, qty, quoted_usdt, pay_chain, maker_addr, accept_tx, expires_at}
let _sendOverride = null;

export function _testInjectSendCommand(fn) { _sendOverride = fn; }
export function _testResetSendCommand() { _sendOverride = null; }
export function _clearQuotes() { _quotes.clear(); }
export function _hasQuote(peer) { return _quotes.has(peer); }
export function _clearPendingAccepts() { _pendingAccepts.clear(); }
export function _hasPendingAccept(peer) { return _pendingAccepts.has(peer); }

async function _send(relayId, cmd) {
  if (_sendOverride) return _sendOverride(relayId, cmd);
  const { sendCommandAsync } = await import('./relay-manager.js');
  return sendCommandAsync(relayId, cmd);
}

function selectBestOffer(qtyKas, payChain) {
  const rows = sqlite.prepare(`
    SELECT id, give_amount, want_amount, verification_meta, maker
    FROM exchange_offers
    WHERE protocol_status = 'open'
      AND give_asset = 'KAS' AND want_asset = 'USDT'
      AND CAST(give_amount AS REAL) >= ?
      AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
    ORDER BY CAST(want_amount AS REAL) / CAST(give_amount AS REAL) ASC
    LIMIT 10
  `).all(qtyKas);
  for (const o of rows) {
    let meta;
    try { meta = JSON.parse(o.verification_meta || '{}'); } catch { continue; }
    const chains = Array.isArray(meta.accepted_chains) ? meta.accepted_chains : [];
    const match = chains.find(c => c && String(c.chain).toLowerCase() === payChain);
    if (match) return { ...o, maker_addr: match.address };
  }
  return null;
}

// R4 改造 (T-NWT-09 broker-action-queue): 不直接 sendCommandAsync, 进队列保 FIFO 单线.
async function _enqueue(kind, peer, payload) {
  const { enqueue } = await import('./broker-action-queue.js');
  return enqueue({ kind, peer, payload });
}

function _enqueueAccept(offerId, peerAddr, payChain) {
  const payload = {
    t: 'kanet_exchange_accept_v1',
    offer_id: offerId,
    selected_chain: payChain,
    payment_asset: 'usdt',
    receive_address: peerAddr,
  };
  return _enqueue('accept_v1', peerAddr, { channel: 'kanet-exchange', message: JSON.stringify(payload) });
}

// T-J2-12 真人付款后由 broker 代广播 paid_v1 (真人 Kasia 客户端不发协议消息).
function _enqueuePaid(offerId, paymentTx, payChain, peerAddr) {
  const payload = {
    t: 'kanet_exchange_paid_v1',
    offer_id: offerId,
    payment_tx: paymentTx,
    payment_chain: payChain,
  };
  return _enqueue('paid_v1', peerAddr, { channel: 'kanet-exchange', message: JSON.stringify(payload) });
}

// T-J2-09 broker_accept_record — completion-watcher 用此查 (offer_id → user) 关联
function _recordAccept({ offerId, userPeer, qty, quotedUsdt, payChain, acceptTx }) {
  try {
    sqlite.prepare(`
      INSERT INTO chain_events (txid, from_address, to_address, event_type, payload, observed_by, observed_at)
      VALUES (?, ?, ?, 'broker_accept_record', ?, 'broker-buy-handler', datetime('now'))
    `).run(
      `broker_accept_${acceptTx || offerId}`,
      BROKER_RELAY_ID, userPeer,
      JSON.stringify({ offer_id: offerId, user_kasia_address: userPeer, qty, quoted_usdt: quotedUsdt, pay_chain: payChain, accept_tx: acceptTx })
    );
  } catch (e) { console.warn(`[broker-buy] record err: ${e.message}`); }
}

// R4 改造: handler 不直接发 reply DM (会撞 UTXO), 而是 enqueue 让 broker-action-queue 单线 pump.
// handler return '' 让 conversations.js → relay reply 路径变 silent (relay 看 reply='' = no DM).
// 用户视角: 自己发 "买 X KAS" → 几秒后从队列收到 broker 报价 DM.
async function _qDm(kind, peerAddr, message) {
  // T-J2-14 队列位置: snap pre-enqueue queue depth → "前面 N 笔待处理" 嵌 message 末尾.
  // T-J2-15 (R4 Bug 9): broker DM 末尾必带 4 字符唯一 tag, 避 relay anti-spam 14min "100% similar"
  // dedup 拦. 同 offer 同 qty 反复触发会 100% 相似, 加 tag 后内容必不同.
  const { getQueueStats } = await import('./broker-action-queue.js');
  const stats = getQueueStats();
  const queuePart = stats.length > 0 ? `(前面 ${stats.length} 笔, ~${Math.ceil(stats.length * 5)}s) ` : '';
  const tag = `#${randomUUID().slice(0, 4)}`;
  const suffix = `\n\n${queuePart}${tag}`;
  return _enqueue(kind, peerAddr, { message: message + suffix });
}

export async function handleBuyIntent(peerAddr, message) {
  const trimmed = (message || '').trim();
  const pending = _quotes.get(peerAddr);

  // 用户确认 pending quote → 排队 accept_v1 + 紧跟付款指引 DM
  if (pending && Date.now() < pending.expires_at) {
    if (CONFIRM_WORDS.includes(trimmed)) {
      _quotes.delete(peerAddr);
      // T-J2-12 真人付款窗口: 存待 paid 状态 (accept_tx 真值由 queue pump 后填, handler 用占位).
      _pendingAccepts.set(peerAddr, {
        offer_id: pending.offer_id, qty: pending.qty, quoted_usdt: pending.quoted_usdt,
        pay_chain: pending.pay_chain, maker_addr: pending.maker_addr, accept_tx: null,
        expires_at: Date.now() + PENDING_ACCEPT_TTL_MS,
      });
      _enqueueAccept(pending.offer_id, peerAddr, pending.pay_chain);
      _recordAccept({ offerId: pending.offer_id, userPeer: peerAddr, qty: pending.qty, quotedUsdt: pending.quoted_usdt, payChain: pending.pay_chain, acceptTx: null });
      _qDm('dm_pay_instr', peerAddr,
        `✓ 已接单. 请 30min 内付 ${pending.quoted_usdt} USDT 到 ${pending.maker_addr?.slice(0,22)||'?'}... (${pending.pay_chain}). 付完回我 "我付了 0xTX" (TX = BSC 交易哈希), 我自动通知 Maker 发 ${pending.qty} KAS 到你 Kasia.`);
      return '';
    }
    if (CANCEL_WORDS.includes(trimmed)) {
      _quotes.delete(peerAddr);
      _qDm('dm_quote', peerAddr, `已取消报价. 重新下单回"买 X KAS".`);
      return '';
    }
  }

  // T-J2-12 PAID intent: 用户回 "我付了 0xtx..." 排队 paid_v1 + ack DM.
  const accept = _pendingAccepts.get(peerAddr);
  if (accept) {
    if (Date.now() >= accept.expires_at) {
      _pendingAccepts.delete(peerAddr);
    } else {
      const pm = PAID_REGEX.exec(trimmed);
      if (pm) {
        const paymentTx = pm[1];
        _pendingAccepts.delete(peerAddr);
        _enqueuePaid(accept.offer_id, paymentTx, accept.pay_chain, peerAddr);
        _qDm('dm_completion', peerAddr,
          `✓ 收到付款 tx ${paymentTx.slice(0,12)}... 已排队通知 Maker. 验证通过后 Maker 自动发 ${accept.qty} KAS 到你 Kasia.`);
        return '';
      }
    }
  }

  // 解析买意图 → 报价 DM 入队
  const m = BUY_REGEX.exec(trimmed);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  if (qty <= 0) return null;

  const payChain = 'bnb';
  const offer = selectBestOffer(qty, payChain);
  if (!offer) {
    _qDm('dm_quote', peerAddr, `当前无 ${qty} KAS 卖单 (${payChain.toUpperCase()} 链). 晚点再来或试试别的链.`);
    return '';
  }
  const unit = parseFloat(offer.want_amount) / parseFloat(offer.give_amount);
  const quotedUsdt = (unit * qty).toFixed(6);
  _quotes.set(peerAddr, {
    offer_id: offer.id, qty, quoted_usdt: quotedUsdt, pay_chain: payChain,
    maker_addr: offer.maker_addr, expires_at: Date.now() + QUOTE_TTL_MS,
  });
  _qDm('dm_quote', peerAddr,
    `📋 买 ${qty} KAS 报价:\n· 单价 ${unit.toFixed(6)} USDT/KAS\n· 你付: ${quotedUsdt} USDT (${payChain.toUpperCase()})\n· Maker 收款 ${offer.maker_addr.slice(0,22)}...\n· Maker 直发 KAS 到你 Kasia 地址\n\n确认回 YES (5min 内). 取消回 NO.`);
  return '';
}
