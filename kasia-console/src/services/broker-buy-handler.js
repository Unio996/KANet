// broker-buy-handler.js — Phase 4 A 模式撮合 (T-J2-08, v2.1.1)
// 用户 DM "买 X KAS" → 选 best open offer → 报价 → 用户 YES → 广播 accept_v1
// 复用 exchange_offers + exchange-machine, 不自建状态机不自建订单表.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const BUY_REGEX = /^\s*(?:买|buy)\s*(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*KAS\s*$/i;
// T-J1-19a (J2 probe-5a 暴露): broker dust 单接受漏洞 — finalizeBuy / _aggregateWithFallback
// 必须拒小于 MIN_QTY 的请求, 否则 broker 锁 fund_locks 浪费 broadcast tx + 用户 dust 被 broker fee 吃光.
const MIN_QTY_KAS = 1.0;
// T-J2-12 真人 PAID 意图: "我付了 0xabc...", "已付 0x...", "paid 0x...", "pay 0x..."
const PAID_REGEX = /(?:已付|付了|我付|paid|pay)[\s\S]{0,40}?\b(0x[a-fA-F0-9]{64})\b/i;
const CONFIRM_WORDS = ['YES', 'yes', 'y', '确认', '好', '行', 'OK', 'ok'];
const CANCEL_WORDS  = ['NO', 'no', 'n', '取消', '不要', '算了'];
const QUOTE_TTL_MS = 5 * 60 * 1000;
const PENDING_ACCEPT_TTL_MS = 30 * 60 * 1000;  // 真人付款窗口 30min

const _quotes = new Map();  // peer → {offer_id, qty, quoted_usdt, pay_chain, maker_addr, expires_at}
const _pendingAccepts = new Map();  // peer → {offer_id, qty, quoted_usdt, pay_chain, maker_addr, accept_tx, expires_at}
let _sendOverride = null;
let _publishOverride = null;  // T-J1-19b: unit test inject for _brokerPublishKasOffer

export function _testInjectSendCommand(fn) { _sendOverride = fn; }
export function _testResetSendCommand() { _sendOverride = null; }
export function _testInjectPublishOffer(fn) { _publishOverride = fn; }
export function _testResetPublishOffer() { _publishOverride = null; }
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
  // R5 T-J2-17 (Bug 10): broker 不 self-accept, 排除自己 maker 的 offer.
  const broker = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
  const brokerAddr = broker?.address || '';
  const rows = sqlite.prepare(`
    SELECT id, give_amount, want_amount, verification_meta, maker
    FROM exchange_offers
    WHERE protocol_status = 'open'
      AND give_asset = 'KAS' AND want_asset = 'USDT'
      AND CAST(give_amount AS REAL) >= ?
      AND maker != ?
      AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
    ORDER BY CAST(want_amount AS REAL) / CAST(give_amount AS REAL) ASC
    LIMIT 10
  `).all(qtyKas, brokerAddr);
  for (const o of rows) {
    let meta;
    try { meta = JSON.parse(o.verification_meta || '{}'); } catch { continue; }
    const chains = Array.isArray(meta.accepted_chains) ? meta.accepted_chains : [];
    const match = chains.find(c => c && String(c.chain).toLowerCase() === payChain);
    if (match) return { ...o, maker_addr: match.address };
  }
  return null;
}

// R7 路径 C: 拼现成单聚合. selectBestOffer 找不到 single ≥ qty 时, 累加多个小单
// (从最便宜的起) 直到满足 qty. 返回 [{offer, take_qty, take_usdt, maker_addr}]
// take_qty 可能 < offer.give_amount (最后一个会"切薄" 用户只买部分).
// **协议含义**: exchange-machine accept_v1 必须 take 整笔 give_amount, 不支持部分成交.
// 因此最后一笔会"过买" (take 整笔 offer 即使 cum > qty), broker 多收的 KAS 后续退回用户
// 或下次抵扣. 第一版简化处理: 累加到 cum >= qty 就停, 最后一笔 take 整笔, 用户实收 cum KAS.
export function selectBestOffers(qtyKas, payChain) {
  const broker = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(BROKER_RELAY_ID);
  const brokerAddr = broker?.address || '';
  const rows = sqlite.prepare(`
    SELECT id, give_amount, want_amount, verification_meta, maker
    FROM exchange_offers
    WHERE protocol_status = 'open'
      AND give_asset = 'KAS' AND want_asset = 'USDT'
      AND maker != ?
      AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
    ORDER BY CAST(want_amount AS REAL) / CAST(give_amount AS REAL) ASC
    LIMIT 30
  `).all(brokerAddr);
  const picks = [];
  let cum = 0;
  for (const o of rows) {
    let meta;
    try { meta = JSON.parse(o.verification_meta || '{}'); } catch { continue; }
    const chains = Array.isArray(meta.accepted_chains) ? meta.accepted_chains : [];
    const match = chains.find(c => c && String(c.chain).toLowerCase() === payChain);
    if (!match) continue;
    const give = parseFloat(o.give_amount);
    if (!(give > 0)) continue;
    picks.push({ ...o, maker_addr: match.address, take_qty: give, take_usdt: parseFloat(o.want_amount) });
    cum += give;
    if (cum >= qtyKas) break;
  }
  if (cum < qtyKas) return { ok: false, available: cum, picks };
  return { ok: true, total_kas: cum, total_usdt: picks.reduce((s, p) => s + p.take_usdt, 0), picks };
}

// T-NWT-22 (broker 库存自挂): 没现成 maker / 拼不够 deficit 时, broker 用自己 KAS
// 库存 + 当前市价 spread 1% 调 /api/exchange/publish 挂 SELL 单. 返回 offer_id +
// want_usdt + maker_chain_addr, finalizeBuy / handleBuyIntent 用此 build pick 加进 picks[].
async function _brokerPublishKasOffer(qtyKas, payChain) {
  const { fetchKasPrice } = await import('./market-seeder.js');
  const midPrice = await fetchKasPrice();
  if (!midPrice || midPrice <= 0) return { ok: false, error: 'price_unavailable' };
  const wallet = sqlite.prepare(`
    SELECT chain, address FROM agent_wallets
    WHERE relay_node_id = ? AND chain = ? AND is_default = 1
  `).get(BROKER_RELAY_ID, payChain);
  if (!wallet?.address) return { ok: false, error: `broker no ${payChain} wallet` };
  const SPREAD_PCT = 1;
  const sellPrice = midPrice * (1 + SPREAD_PCT / 100);
  const wantUsdt = (qtyKas * sellPrice).toFixed(4);
  const PORT = process.env.CONSOLE_PORT || 3100;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/exchange/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relayNodeId: BROKER_RELAY_ID,
        give_asset: 'KAS',
        give_amount: String(qtyKas),
        want_asset: 'USDT',
        want_amount: wantUsdt,
        verification: 'cross_chain_tx',
        verification_meta: { accepted_chains: [{ chain: payChain, address: wallet.address }], expected_asset: 'USDT' },
        expires_minutes: 30,
        metadata: { source: 'broker_dynamic_quote', mid_price: midPrice, spread_pct: SPREAD_PCT },
      }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: `publish: ${data.error || 'http_' + res.status}` };
    return { ok: true, offer_id: data.offer_id, want_usdt: wantUsdt, maker_chain_addr: wallet.address, mid_price: midPrice, sell_price: sellPrice };
  } catch (e) {
    return { ok: false, error: `publish_exc: ${e.message}` };
  }
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

// R6 T-J2-19: tool function for broker-llm-agent. LLM 收齐 user/qty/payChain 调此.
// R7 三层 fallback (J1+NWT 合并):
//   1. 路径 C (J1): selectBestOffers 拼现成 maker (greedy cheapest)
//   2. 路径 B (NWT T-NWT-22): 拼不够时 broker 自挂 deficit (用自己 KAS 库存)
//   3. broker 也无库存/价格 → 真 fail (极端)
// 返回 picks[] 含每个 maker + 付款金额 + 收款地址 (含 broker_dynamic 标记区分).
export async function finalizeBuy({ user_kasia, qty, pay_chain }) {
  if (!user_kasia || !qty || qty <= 0 || !pay_chain) {
    return { ok: false, error: 'missing fields (user_kasia/qty/pay_chain)' };
  }
  if (qty < MIN_QTY_KAS) {
    return { ok: false, error: `qty too small: ${qty} < min ${MIN_QTY_KAS} KAS (broker fee + dust protection)` };
  }
  const payChain = String(pay_chain).toLowerCase();
  const merged = await _aggregateWithFallback(qty, payChain);
  if (!merged.ok) return { ok: false, error: merged.error, available: merged.available };

  for (const p of merged.picks) {
    await _enqueueAccept(p.id, user_kasia, payChain);
    _recordAccept({ offerId: p.id, userPeer: user_kasia, qty: p.take_qty, quotedUsdt: p.take_usdt.toFixed(6), payChain, acceptTx: null });
  }
  return {
    ok: true,
    picks: merged.picks.map(p => ({
      offer_id: p.id,
      qty_kas: p.take_qty,
      pay_usdt: p.take_usdt.toFixed(6),
      maker_payment_address: p.maker_addr,
      broker_dynamic: !!p.broker_dynamic,
    })),
    total_kas: merged.total_kas,
    total_usdt: merged.total_usdt.toFixed(6),
    pay_chain: payChain,
    n_payments: merged.picks.length,
    broker_dynamic_quote: merged.picks.some(p => p.broker_dynamic),
    note: merged.picks.length > 1
      ? `User must send ${merged.picks.length} separate USDT payments (one per maker, ${merged.picks.filter(p=>p.broker_dynamic).length} of which is broker self-quoted).`
      : (merged.picks[0]?.broker_dynamic ? 'Broker self-quoted (no maker available, broker uses own KAS inventory).' : 'Single maker, one USDT payment.'),
  };
}

// 三层 fallback 合并器: 拼现成 + broker 自挂补 deficit. 给 finalizeBuy/handleBuyIntent 复用.
// 返回 { ok, total_kas, total_usdt, picks: [{id, take_qty, take_usdt, maker_addr, broker_dynamic?}] }
// 单测可用 _testInjectPublishOffer 注入 mock _brokerPublishKasOffer.
export async function _aggregateWithFallback(qty, payChain) {
  const sel = selectBestOffers(qty, payChain);
  let picks = sel.picks ? [...sel.picks] : [];
  let cumKas = picks.reduce((s, p) => s + p.take_qty, 0);

  if (cumKas < qty) {
    // 拼现成不够, broker 自挂补 deficit
    const deficit = qty - cumKas;
    const pub = _publishOverride ? await _publishOverride(deficit, payChain) : await _brokerPublishKasOffer(deficit, payChain);
    if (!pub.ok) {
      // 全失败: broker 也无价格 / 无库存 / publish 失败 → 真 fail
      return { ok: false, available: cumKas, picks, error: `aggregation insufficient (${cumKas}/${qty} from makers) + broker self-quote failed: ${pub.error}` };
    }
    picks.push({
      id: pub.offer_id,
      take_qty: deficit,
      take_usdt: parseFloat(pub.want_usdt),
      maker_addr: pub.maker_chain_addr,
      broker_dynamic: true,
    });
    cumKas += deficit;
  }

  const totalUsdt = picks.reduce((s, p) => s + p.take_usdt, 0);
  return { ok: true, total_kas: cumKas, total_usdt: totalUsdt, picks };
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

  // 用户确认 pending quote → 多笔 enqueue accept_v1 + 一条聚合 dm_pay_instr 列出所有 maker 付款指引
  if (pending && Date.now() < pending.expires_at) {
    if (CONFIRM_WORDS.includes(trimmed)) {
      _quotes.delete(peerAddr);
      // R7 路径 C: pending.picks 是数组. 给每个 pick enqueue accept + 跟踪 paid 状态
      _pendingAccepts.set(peerAddr, {
        picks: pending.picks.map(p => ({ ...p, paid_tx: null })),
        total_kas: pending.total_kas,
        total_usdt: pending.total_usdt,
        pay_chain: pending.pay_chain,
        expires_at: Date.now() + PENDING_ACCEPT_TTL_MS,
      });
      for (const p of pending.picks) {
        await _enqueueAccept(p.id, peerAddr, pending.pay_chain);
        _recordAccept({ offerId: p.id, userPeer: peerAddr, qty: p.take_qty, quotedUsdt: p.take_usdt.toFixed(6), payChain: pending.pay_chain, acceptTx: null });
      }
      const lines = pending.picks.map((p, i) =>
        `${i+1}. ${p.take_qty} KAS → 付 ${p.take_usdt.toFixed(6)} USDT 到 ${p.maker_addr?.slice(0,22)||'?'}...${p.maker_addr?.slice(-6)||''}`
      ).join('\n');
      const note = pending.picks.length > 1
        ? `\n\n注意: 共 ${pending.picks.length} 笔 USDT 转账 (拼单聚合). 每笔付完回我 "我付了 0xTX", 一笔一条.`
        : `\n\n付完回我 "我付了 0xTX" (BSC 交易哈希), 自动通知 Maker.`;
      _qDm('dm_pay_instr', peerAddr,
        `✓ 已接单. 请 30min 内分笔付:\n${lines}${note}`);
      return '';
    }
    if (CANCEL_WORDS.includes(trimmed)) {
      _quotes.delete(peerAddr);
      _qDm('dm_quote', peerAddr, `已取消报价. 重新下单回"买 X KAS".`);
      return '';
    }
  }

  // PAID intent: 用户回 "我付了 0xtx..." → 一次匹配一个 unpaid pick (FIFO)
  const accept = _pendingAccepts.get(peerAddr);
  if (accept) {
    if (Date.now() >= accept.expires_at) {
      _pendingAccepts.delete(peerAddr);
    } else {
      const pm = PAID_REGEX.exec(trimmed);
      if (pm) {
        const paymentTx = pm[1];
        const nextUnpaid = accept.picks.find(p => !p.paid_tx);
        if (!nextUnpaid) {
          _qDm('dm_completion', peerAddr, `所有 ${accept.picks.length} 笔已确认, 无待付项.`);
          return '';
        }
        nextUnpaid.paid_tx = paymentTx;
        _enqueuePaid(nextUnpaid.id, paymentTx, accept.pay_chain, peerAddr);
        const remaining = accept.picks.filter(p => !p.paid_tx).length;
        if (remaining === 0) {
          _pendingAccepts.delete(peerAddr);
          _qDm('dm_completion', peerAddr,
            `✓ 全部 ${accept.picks.length} 笔付款已收 (最后 tx ${paymentTx.slice(0,12)}...). Maker 验证后陆续发 ${accept.total_kas} KAS 到你 Kasia.`);
        } else {
          _qDm('dm_completion', peerAddr,
            `✓ 付款 ${paymentTx.slice(0,12)}... 已确认 (#${accept.picks.findIndex(p => p.paid_tx === paymentTx)+1}/${accept.picks.length}). 还差 ${remaining} 笔.`);
        }
        return '';
      }
    }
  }

  // 解析买意图 → 拼单 + 报价 DM 入队
  const m = BUY_REGEX.exec(trimmed);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  if (qty <= 0) return null;
  if (qty < MIN_QTY_KAS) {
    _qDm('dm_quote', peerAddr, `📊 ${qty} KAS 太小 (最小 ${MIN_QTY_KAS} KAS, 防 dust 单 + broker fee 吃光本金). 改大点回 "买 N KAS".`);
    return '';
  }

  const payChain = 'bnb';
  const merged = await _aggregateWithFallback(qty, payChain);
  if (!merged.ok) {
    _qDm('dm_quote', peerAddr,
      `📊 暂无报价: 你要 ${qty} KAS (${payChain.toUpperCase()}), 现成 maker 拼到 ${merged.available || 0} KAS, broker 自挂也失败 (${merged.error?.slice(0,80) || '?'}).\n` +
      `选项: 1) 改小一点 (回"买 X KAS"), 2) 等等再来, 3) 试别的链.`);
    return '';
  }
  const unit = merged.total_usdt / merged.total_kas;
  _quotes.set(peerAddr, {
    picks: merged.picks,
    total_kas: merged.total_kas,
    total_usdt: merged.total_usdt,
    pay_chain: payChain,
    expires_at: Date.now() + QUOTE_TTL_MS,
  });
  const dynamicCount = merged.picks.filter(p => p.broker_dynamic).length;
  const breakdown = merged.picks.length === 1
    ? (merged.picks[0].broker_dynamic ? `· broker 自挂 (无 maker)` : `· 1 个 maker (单笔)`)
    : `· 拼 ${merged.picks.length} 笔: ${merged.picks.map(p => `${p.take_qty}${p.broker_dynamic?'(broker)':''}`).join('+')} = ${merged.total_kas} KAS`;
  const dynNote = dynamicCount > 0
    ? `\n· 含 broker 自挂 ${dynamicCount} 笔 (市价+1% spread, broker 用自己 KAS 库存)`
    : '';
  _qDm('dm_quote', peerAddr,
    `📋 买 ${qty} KAS 报价:\n${breakdown}${dynNote}\n· 实成交: ${merged.total_kas} KAS\n· 平均单价 ${unit.toFixed(6)} USDT/KAS\n· 你付总: ${merged.total_usdt.toFixed(6)} USDT (${payChain.toUpperCase()}, 分 ${merged.picks.length} 笔)\n\n确认回 YES (5min). 取消回 NO.`);
  return '';
}
