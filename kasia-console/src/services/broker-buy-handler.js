// broker-buy-handler.js — Phase 4 A 模式撮合 (T-J2-08, v2.1.1)
// 用户 DM "买 X KAS" → 选 best open offer → 报价 → 用户 YES → 广播 accept_v1
// 复用 exchange_offers + exchange-machine, 不自建状态机不自建订单表.

import { sqlite } from '../db/client.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const BUY_REGEX = /^\s*(?:买|buy)\s*(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*KAS\s*$/i;
const CONFIRM_WORDS = ['YES', 'yes', 'y', '确认', '好', '行', 'OK', 'ok'];
const CANCEL_WORDS  = ['NO', 'no', 'n', '取消', '不要', '算了'];
const QUOTE_TTL_MS = 5 * 60 * 1000;

const _quotes = new Map();  // peer → {offer_id, qty, quoted_usdt, pay_chain, maker_addr, expires_at}
let _sendOverride = null;

export function _testInjectSendCommand(fn) { _sendOverride = fn; }
export function _testResetSendCommand() { _sendOverride = null; }
export function _clearQuotes() { _quotes.clear(); }
export function _hasQuote(peer) { return _quotes.has(peer); }

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

async function broadcastAccept(offerId, peerAddr, payChain) {
  const payload = {
    t: 'kanet_exchange_accept_v1',
    offer_id: offerId,
    selected_chain: payChain,
    payment_asset: 'usdt',
    receive_address: peerAddr,
  };
  const r = await _send(BROKER_RELAY_ID, {
    type: 'send_broadcast', channel: 'kanet-exchange', message: JSON.stringify(payload),
  });
  return r?.txId || null;
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

export async function handleBuyIntent(peerAddr, message) {
  const trimmed = (message || '').trim();
  const pending = _quotes.get(peerAddr);

  // 用户确认 pending quote → 广播 accept
  if (pending && Date.now() < pending.expires_at) {
    if (CONFIRM_WORDS.includes(trimmed)) {
      const tx = await broadcastAccept(pending.offer_id, peerAddr, pending.pay_chain);
      _quotes.delete(peerAddr);
      if (!tx) return `accept 上链失败, 报价取消, 请重发"买 X KAS".`;
      _recordAccept({ offerId: pending.offer_id, userPeer: peerAddr, qty: pending.qty, quotedUsdt: pending.quoted_usdt, payChain: pending.pay_chain, acceptTx: tx });
      return `✓ 已上链 tx ${tx.slice(0,12)}.... 请 30min 内付 ${pending.quoted_usdt} USDT 到 ${pending.maker_addr?.slice(0,22)||'?'}... (${pending.pay_chain}). Maker 收 USDT 后直发 ${pending.qty} KAS 到你 Kasia 地址.`;
    }
    if (CANCEL_WORDS.includes(trimmed)) {
      _quotes.delete(peerAddr);
      return `已取消报价. 重新下单回"买 X KAS".`;
    }
  }

  // 解析买意图
  const m = BUY_REGEX.exec(trimmed);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  if (qty <= 0) return null;

  const payChain = 'bnb';  // 默认 BSC; 后续可加 chain 关键字识别
  const offer = selectBestOffer(qty, payChain);
  if (!offer) {
    return `当前无 ${qty} KAS 卖单 (${payChain.toUpperCase()} 链). 晚点再来或试试别的链.`;
  }
  const unit = parseFloat(offer.want_amount) / parseFloat(offer.give_amount);
  const quotedUsdt = (unit * qty).toFixed(6);
  _quotes.set(peerAddr, {
    offer_id: offer.id, qty, quoted_usdt: quotedUsdt, pay_chain: payChain,
    maker_addr: offer.maker_addr, expires_at: Date.now() + QUOTE_TTL_MS,
  });
  return `📋 买 ${qty} KAS 报价:\n· 单价 ${unit.toFixed(6)} USDT/KAS\n· 你付: ${quotedUsdt} USDT (${payChain.toUpperCase()})\n· Maker 收款 ${offer.maker_addr.slice(0,22)}...\n· Maker 直发 KAS 到你 Kasia 地址\n\n确认回 YES (5min 内). 取消回 NO.`;
}
