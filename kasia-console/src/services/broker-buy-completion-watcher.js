// broker-buy-completion-watcher.js — Phase 4 BUY 闭环 (T-J2-09)
// broker 代 user accept 后, 监听 exchange-machine completed → DM user "KAS 到账" 含 tx 链.
// 复用 chain_events: broker_accept_record (T-J2-08 写) + completed offer + 标记 broker_buy_dm_sent.

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

export async function completionTick() {
  const trader = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(BROKER_RELAY_ID);
  if (!trader) return { handled: 0, reason: 'no_broker_relay' };
  const offers = sqlite.prepare(`
    SELECT id, taker, delivery_tx, taker_tx_id, completed_at
    FROM exchange_offers
    WHERE protocol_status = 'completed'
    AND taker = ?
    AND completed_at > datetime('now', '-7 days')
    LIMIT 50
  `).all(trader.address);
  let handled = 0;
  for (const o of offers) {
    try { if (await _processCompleted(o, trader.address)) handled++; }
    catch (err) { console.warn(`[broker-buy-completion] ${o.id?.slice(0,8)} err: ${err.message}`); }
  }
  return { handled, scanned: offers.length };
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
