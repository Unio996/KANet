// broker-intake-watcher.js — Phase 3 兜底机制 (v2.1 §4.2)
// 每 60s 扫 Trader-B 入账, 4 场景路由 (意图一致/反向/陌生/黑名单). Broker 吃 gas.
// 挂在 Console 启动 (index.js) setInterval, 不新建表只新增 event_type='broker_intake_processed' 作处理标记.

import { sqlite } from '../db/client.js';

const TICK_MS = 60_000;
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';  // Trader-B
let _intakeInterval = null;
let _sendCommandOverride = null;  // test injection

export function _testInjectSendCommand(fn) { _sendCommandOverride = fn; }
export function _testResetSendCommand() { _sendCommandOverride = null; }

async function _send(relayId, cmd) {
  if (_sendCommandOverride) return _sendCommandOverride(relayId, cmd);
  const { sendCommandAsync } = await import('./relay-manager.js');
  return sendCommandAsync(relayId, cmd);
}

function findUserIntent(peerAddr) {
  return sqlite.prepare(`
    SELECT side, qty FROM retail_dex_orders
    WHERE user_kasia_address = ? AND created_at > datetime('now','-24 hours')
    AND state IN ('aligning','confirming','awaiting_payment')
    ORDER BY created_at DESC LIMIT 1
  `).get(peerAddr);
}

function isBlacklisted(peerAddr) {
  const r = sqlite.prepare(`SELECT is_blocked FROM relation_states WHERE peer_address = ? LIMIT 1`).get(peerAddr);
  return r?.is_blocked === 1;
}

function markProcessed(srcEventId, outcome) {
  sqlite.prepare(`
    INSERT INTO chain_events (txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, NULL, NULL, 'broker_intake_processed', ?, 'broker-intake-watcher', datetime('now'))
  `).run(`broker_intake_${srcEventId}`, JSON.stringify({ src_event_id: srcEventId, outcome }));
}

async function handleIntake(event) {
  const peer = event.from_address;
  let amount;
  try { amount = parseFloat(JSON.parse(event.payload).amount || 0); } catch { amount = 0; }
  if (amount <= 0 || !peer) return markProcessed(event.id, 'skip_no_amount');

  if (isBlacklisted(peer)) {
    await _send(BROKER_RELAY_ID, { type: 'send_kas', target: peer, amount_kas: amount, note: 'refund blocked peer' });
    return markProcessed(event.id, 'refund_blocked');
  }

  const intent = findUserIntent(peer);
  if (intent?.side === 'sell_kas' && Math.abs(parseFloat(intent.qty) - amount) < 0.5) {
    await _send(BROKER_RELAY_ID, { type: 'send_message', target: peer, message: `收到你 ${amount} KAS ✓ 开始代卖, 预计 10 分钟完成.` });
    return markProcessed(event.id, 'custodial_sell');
  }
  if (intent?.side === 'buy_kas') {
    await _send(BROKER_RELAY_ID, { type: 'send_message', target: peer, message: `你是想买 KAS 对吧? 这 ${amount} KAS 我先收着, 要我代卖成 USDT 付你还是退回? 回复 "卖" 或 "退".` });
    return markProcessed(event.id, 'buy_intent_conflict');
  }
  await _send(BROKER_RELAY_ID, { type: 'send_message', target: peer, message: `收到你 ${amount} KAS, 你想做什么? 代卖/继续持有/退回? 12h 无回复自动退.` });
  return markProcessed(event.id, 'unsolicited_wait');
}

export async function intakeTick() {
  const trader = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(BROKER_RELAY_ID);
  if (!trader) return { handled: 0, reason: 'no_broker_relay' };
  const rows = sqlite.prepare(`
    SELECT id, txid, from_address, payload FROM chain_events
    WHERE to_address = ? AND event_type = 'tx'
    AND observed_at > datetime('now','-24 hours')
    AND NOT EXISTS (
      SELECT 1 FROM chain_events p
      WHERE p.event_type = 'broker_intake_processed'
      AND p.payload LIKE '%"src_event_id":' || chain_events.id || ',%'
    )
    LIMIT 20
  `).all(trader.address);
  let handled = 0;
  for (const e of rows) {
    try { await handleIntake(e); handled++; }
    catch (err) { console.warn(`[broker-intake] ${e.id} err: ${err.message}`); }
  }
  return { handled, scanned: rows.length };
}

export function startIntakeWatcher() {
  if (_intakeInterval) return;
  _intakeInterval = setInterval(async () => {
    try {
      const r = await intakeTick();
      if (r && r.scanned !== undefined) {
        // 每次 tick 打存活 + 结果, J1 验收标准"[broker-intake] tick 至少一条"
        console.log(`[broker-intake] tick handled=${r.handled||0}/${r.scanned||0}`);
      }
    } catch (e) { console.error('[broker-intake]', e.message); }
  }, TICK_MS);
  console.log(`[broker-intake] watcher started for Trader-B tick=${TICK_MS}ms`);
}

export function stopIntakeWatcher() {
  if (_intakeInterval) { clearInterval(_intakeInterval); _intakeInterval = null; }
}
