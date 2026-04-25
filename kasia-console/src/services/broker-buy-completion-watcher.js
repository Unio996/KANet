// broker-buy-completion-watcher.js — Phase 4 BUY+SELL 闭环 (T-J2-09 + T-J2-13)
// BUY: broker 代 user accept 后, 监听 completed → DM user "KAS 到账" (taker=broker).
// SELL: broker 代 user publish 后, 监听 completed → DM user "卖完, USDT 到 BSC" (maker=broker, give=KAS).
// 单 file 双路径不新建 (永不新建先迭代). 标记: broker_buy_dm_sent vs broker_sell_dm_sent.

import { sqlite } from '../db/client.js';

const TICK_MS = 60_000;
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
let _tickInterval = null;
let _sendOverride = null;

export function _testInjectSendCommand(fn) { _sendOverride = fn; }
export function _testResetSendCommand() { _sendOverride = null; }

async function _send(relayId, cmd) {
  if (_sendOverride) return _sendOverride(relayId, cmd);
  const { sendCommandAsync } = await import('./relay-manager.js');
  return sendCommandAsync(relayId, cmd);
}

function _findUserForOffer(offerId) {
  const row = sqlite.prepare(`
    SELECT payload FROM chain_events
    WHERE event_type = 'broker_accept_record'
    AND payload LIKE '%"offer_id":"' || ? || '"%'
    ORDER BY observed_at DESC LIMIT 1
  `).get(offerId);
  if (!row) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

function _alreadyDmed(offerId) {
  const row = sqlite.prepare(`
    SELECT 1 FROM chain_events
    WHERE event_type = 'broker_buy_dm_sent'
    AND payload LIKE '%"offer_id":"' || ? || '"%'
    LIMIT 1
  `).get(offerId);
  return !!row;
}

function _markDmed(offerId, userPeer, deliveryTx) {
  sqlite.prepare(`
    INSERT INTO chain_events (txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, ?, ?, 'broker_buy_dm_sent', ?, 'broker-buy-completion-watcher', datetime('now'))
  `).run(
    `broker_buy_dm_${offerId.slice(0, 16)}`,
    BROKER_RELAY_ID, userPeer,
    JSON.stringify({ offer_id: offerId, user_kasia_address: userPeer, delivery_tx: deliveryTx })
  );
}

async function _processCompleted(offer, brokerAddr) {
  if (_alreadyDmed(offer.id)) return false;
  const acc = _findUserForOffer(offer.id);
  if (!acc?.user_kasia_address) return false;  // 不是 broker 帮 accept 的

  const deliveryTx = offer.delivery_tx || offer.taker_tx_id || '?';
  const msg = `🎉 你买的 ${acc.qty} KAS 已到! Maker 发的 tx ${String(deliveryTx).slice(0, 16)}... 链上可查. 谢谢使用 KANet broker.`;
  await _send(BROKER_RELAY_ID, { type: 'send_message', target: acc.user_kasia_address, message: msg });
  _markDmed(offer.id, acc.user_kasia_address, deliveryTx);
  return true;
}

// T-J2-13 SELL 闭环: broker 帮 user publish 后, completed → DM user.
function _alreadySellDmed(offerId) {
  const row = sqlite.prepare(`
    SELECT 1 FROM chain_events
    WHERE event_type = 'broker_sell_dm_sent'
    AND payload LIKE '%"offer_id":"' || ? || '"%'
    LIMIT 1
  `).get(offerId);
  return !!row;
}

function _markSellDmed(offerId, userPeer, paymentTx) {
  sqlite.prepare(`
    INSERT INTO chain_events (txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, ?, ?, 'broker_sell_dm_sent', ?, 'broker-buy-completion-watcher', datetime('now'))
  `).run(
    `broker_sell_dm_${offerId.slice(0, 16)}`,
    BROKER_RELAY_ID, userPeer,
    JSON.stringify({ offer_id: offerId, user_kasia_address: userPeer, payment_tx: paymentTx })
  );
}

async function _processSellCompleted(offer) {
  if (_alreadySellDmed(offer.id)) return false;
  let meta;
  try { meta = JSON.parse(offer.metadata || '{}'); } catch { return false; }
  if (meta.source !== 'broker-intake') return false;  // 只 broker 帮卖的
  const userPeer = meta.user_kasia_address;
  if (!userPeer) return false;

  const paymentTx = offer.payment_tx || '?';
  const txShort = String(paymentTx).slice(0, 16);
  const usdtAmount = offer.want_amount || meta.quoted_usdt || '?';
  const payChain = (meta.pay_chain || 'bnb').toUpperCase();
  const msg = `🎉 你卖的 ${meta.intent_qty || meta.net_kas} KAS 完成! Taker 已付 ${usdtAmount} USDT 到你 ${payChain} (tx ${txShort}...). 链上可查. 谢谢使用 KANet broker.`;
  await _send(BROKER_RELAY_ID, { type: 'send_message', target: userPeer, message: msg });
  _markSellDmed(offer.id, userPeer, paymentTx);
  return true;
}

export async function completionTick() {
  const trader = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(BROKER_RELAY_ID);
  if (!trader) return { handled: 0, reason: 'no_broker_relay' };
  // BUY 路径: broker = taker
  const buyOffers = sqlite.prepare(`
    SELECT id, taker, delivery_tx, taker_tx_id, completed_at
    FROM exchange_offers
    WHERE protocol_status = 'completed'
    AND taker = ?
    AND completed_at > datetime('now', '-7 days')
    LIMIT 50
  `).all(trader.address);
  // SELL 路径: broker = maker, give_asset = KAS, metadata.source = broker-intake
  const sellOffers = sqlite.prepare(`
    SELECT id, want_amount, payment_tx, metadata, completed_at
    FROM exchange_offers
    WHERE protocol_status = 'completed'
    AND maker = ?
    AND give_asset = 'KAS'
    AND completed_at > datetime('now', '-7 days')
    AND json_extract(metadata, '$.source') = 'broker-intake'
    LIMIT 50
  `).all(trader.address);
  let handled = 0;
  for (const o of buyOffers) {
    try { if (await _processCompleted(o, trader.address)) handled++; }
    catch (err) { console.warn(`[broker-buy-completion] ${o.id?.slice(0,8)} err: ${err.message}`); }
  }
  for (const o of sellOffers) {
    try { if (await _processSellCompleted(o)) handled++; }
    catch (err) { console.warn(`[broker-sell-completion] ${o.id?.slice(0,8)} err: ${err.message}`); }
  }
  return { handled, scanned: buyOffers.length + sellOffers.length };
}

export function startCompletionWatcher() {
  if (_tickInterval) return;
  _tickInterval = setInterval(async () => {
    try {
      const r = await completionTick();
      if (r && r.scanned !== undefined) {
        console.log(`[broker-buy-completion] tick handled=${r.handled||0}/${r.scanned||0}`);
      }
    } catch (e) { console.error('[broker-buy-completion]', e.message); }
  }, TICK_MS);
  console.log(`[broker-buy-completion] watcher started for Trader-B tick=${TICK_MS}ms`);
}

export function stopCompletionWatcher() {
  if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
}
