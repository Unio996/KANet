// ════════════════════════════════════════════════════════════════
// HIGH-RISK FILE (Critical 8 per docs/COLLAB-REFORM.md 规 10/13/15)
// 改前必跑: grep -nE 'T-J[0-9]+-|T-NWT-|Bug-[A-Z][0-9]+' 本 file
// 改后 commit msg 必含: acknowledged: T-X-X (per surfaced anti-pattern)
// 关联 docs: ANTI-PATTERNS R38+ / DEVELOPER-GUIDE ch19
// 关键历史: Bug-Z17 retail_dex_orders state sync / Bug-Z20 timeout sweep self-deceive
//          / Layer 4 chain reconciler J1 2187455a / spread% J1 52545357d
// blast radius: 5min refund tick / chain DM classify / broker SELL spread / refund chain TX
// ════════════════════════════════════════════════════════════════
//
// broker-intake-watcher.js — Phase 3 兜底机制 (v2.1 §4.2)
// 每 60s 扫 Trader-B 入账, 4 场景路由 (意图一致/反向/陌生/黑名单). Broker 吃 gas.
// 挂在 Console 启动 (index.js) setInterval, 不新建表只新增 event_type='broker_intake_processed' 作处理标记.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

const TICK_MS = 60_000;
const REFUND_TICK_MS = 5 * 60_000;
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';  // Trader-B
const PUBLISH_EXPIRES_MIN = 120;
const DEFAULT_FEE_KAS = '0.1';
let _intakeInterval = null;
let _refundInterval = null;
let _sendCommandOverride = null;  // test injection
let _publishOverride = null;      // test injection (POST /api/exchange/publish)

export function _testInjectSendCommand(fn) { _sendCommandOverride = fn; }
export function _testResetSendCommand() { _sendCommandOverride = null; }
export function _testInjectPublish(fn) { _publishOverride = fn; }
export function _testResetPublish() { _publishOverride = null; }

// R-NWT-2026-04-28 Layer 5: import canonical command enum (Z21 root fix + future regression防).
import { COMMAND_TYPES } from '../../../kasia-relay/src/lib/commands.mjs';

async function _send(relayId, cmd) {
  if (_sendCommandOverride) return _sendCommandOverride(relayId, cmd);
  // R4 (T-NWT-09): broker 出链全走 broker-action-queue 单线 pump 防 UTXO 双花.
  // 其他 relay (e.g. test) 仍直走 sendCommandAsync.
  if (relayId === BROKER_RELAY_ID) {
    const { enqueue } = await import('./broker-action-queue.js');
    let kind, payload;
    if (cmd.type === COMMAND_TYPES.SEND_MESSAGE)   { kind = 'dm_quote'; payload = { message: cmd.message }; }
    else if (cmd.type === COMMAND_TYPES.TRANSFER)  { kind = 'sendKas';  payload = { amount_kas: cmd.amount_kas ?? cmd.amount, note: cmd.note }; }
    else if (cmd.type === COMMAND_TYPES.SEND_BROADCAST) { kind = 'accept_v1'; payload = { channel: cmd.channel, message: cmd.message }; }
    else { kind = 'dm_quote'; payload = cmd; }
    enqueue({ kind, peer: cmd.target || null, payload });
    return { ok: true, queued: true };
  }
  const { sendCommandAsync } = await import('./relay-manager.js');
  return sendCommandAsync(relayId, cmd);
}

function _getUserPayAddress(peer) {
  let row = sqlite.prepare(
    `SELECT preferred_chain AS chain, preferred_pay_address AS address
     FROM retail_dex_user_memory WHERE user_kasia_address = ?`
  ).get(peer);
  if (row?.chain && row?.address) return row;
  row = sqlite.prepare(
    `SELECT pay_chain AS chain, pay_address AS address FROM retail_dex_orders
     WHERE user_kasia_address = ? AND pay_chain IS NOT NULL AND pay_address IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get(peer);
  return (row?.chain && row?.address) ? row : null;
}

function _getFeeKasPerOrder() {
  const r = sqlite.prepare(
    `SELECT fee_kas_per_order FROM retail_dex_broker_config WHERE broker_relay_id = ?`
  ).get(BROKER_RELAY_ID);
  return r?.fee_kas_per_order || DEFAULT_FEE_KAS;
}

async function _fetchKasPrice() {
  const { fetchKasPrice } = await import('./market-seeder.js');
  return fetchKasPrice();
}

async function _publishOffer(body) {
  if (_publishOverride) return _publishOverride(body);
  const PORT = process.env.PORT || 3100;
  const res = await fetch(`http://127.0.0.1:${PORT}/api/exchange/publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
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

// T-NWT-2026-04-30 R1 (RCA Owner 真测 fatal bug 1): synthetic-id workflow markers 切 broker_workflow_markers
// 表 (v86 migrate). chain_events trigger 仅守 chain truth (real 64-hex tx_id), 不再撞 markProcessed.
function markProcessed(srcEventId, outcome) {
  sqlite.prepare(`
    INSERT INTO broker_workflow_markers (id, event_type, src_event_id, payload, created_at)
    VALUES (?, 'broker_intake_processed', ?, ?, datetime('now'))
  `).run(`broker_intake_${srcEventId}`, srcEventId, JSON.stringify({ src_event_id: srcEventId, outcome }));
}

async function handleIntake(event) {
  let peer = event.from_address;
  let amount;
  try { amount = parseFloat(JSON.parse(event.payload).amount || 0); } catch { amount = 0; }
  if (amount <= 0) return markProcessed(event.id, 'skip_no_amount');
  // T-NWT-07 hack fallback: kaspa_tx_log indexer 没解 sender (verboseData 缺) → from_address NULL.
  // 用 retail_dex_orders.sell_kas + qty 接近 amount + recent + awaiting state, 反查 user_kasia_address.
  // 长期靠 J2 C 任务修 indexer 补 from_address.
  if (!peer) {
    const cand = sqlite.prepare(
      `SELECT user_kasia_address FROM retail_dex_orders
       WHERE side='sell_kas' AND state IN ('aligning','confirming','awaiting_payment')
       AND ABS(CAST(qty AS REAL) - ?) < 0.5
       AND created_at > datetime('now','-24 hours')
       ORDER BY created_at DESC LIMIT 1`
    ).get(amount);
    if (cand?.user_kasia_address) peer = cand.user_kasia_address;
  }
  if (!peer) return markProcessed(event.id, 'skip_no_peer');

  if (isBlacklisted(peer)) {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: peer, amount_kas: amount, note: 'refund blocked peer' });
    return markProcessed(event.id, 'refund_blocked');
  }

  const intent = findUserIntent(peer);
  if (intent?.side === 'sell_kas' && Math.abs(parseFloat(intent.qty) - amount) < 0.5) {
    return _publishBrokerSellOffer(peer, amount, event.id);
  }
  if (intent?.side === 'buy_kas') {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer, message: `你是想买 KAS 对吧? 这 ${amount} KAS 我先收着, 要我代卖成 USDT 付你还是退回? 回复 "卖" 或 "退".` });
    return markProcessed(event.id, 'buy_intent_conflict');
  }
  await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer, message: `收到你 ${amount} KAS, 你想做什么? 代卖/继续持有/退回? 12h 无回复自动退.` });
  return markProcessed(event.id, 'unsolicited_wait');
}

async function _publishBrokerSellOffer(peer, amount, eventId) {
  const userPay = _getUserPayAddress(peer);
  if (!userPay) {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
      message: `收到 ${amount} KAS, 但还没你的 USDT 收款链 + 地址. 回复 "用 bnb 0x..." 之类设置. 12h 无回复自动退.`
    });
    return markProcessed(eventId, 'await_pay_addr');
  }
  // T-J2-2026-04-30 R4 self-deal SQL guard (Owner 真测撞: pay_address=0xaD12544E=broker BSC own).
  // 用户误 copy broker 自己 BSC addr 当 SELL 收 USDT 地址 → publish 上去 maker 付 USDT 流到 broker
  // (不是 user) → 真钱风险. 检 pay_address 不在 broker_relay 自己的 agent_wallets 任何 chain 中.
  // 命中 self-deal → ABORT publish + Q2 保险 sendKaspa 退原 KAS + DM 告知用户改地址.
  try {
    const selfDealCheck = sqlite.prepare(
      `SELECT 1 FROM agent_wallets WHERE relay_node_id = ? AND lower(address) = lower(?) LIMIT 1`
    ).get(BROKER_RELAY_ID, userPay.address);
    if (selfDealCheck) {
      console.warn(`[broker-intake R4] self-deal blocked: peer=${peer.slice(-12)} pay_address=${userPay.address.slice(0,12)}... ∈ broker wallets`);
      await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: peer, amount_kas: amount,
        note: `self-deal pay_address rejected: ${userPay.address.slice(0,10)}...` });
      await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
        message: `挂单失败: 你给的收款地址 ${userPay.address.slice(0,10)}...${userPay.address.slice(-6)} 是 broker 自己的钱包(不是你的). USDT 付到那里就是付给 broker 了. ${amount} KAS 已退回你 Kasia. 重新下单时请用 **你自己的** EVM 钱包地址收 USDT.`
      });
      return markProcessed(eventId, 'self_deal_refunded');
    }
  } catch (err) {
    console.warn(`[broker-intake R4] self-deal check err: ${err.message}, skip guard`);
  }
  const feeKas = parseFloat(_getFeeKasPerOrder()) || 0.1;
  const netKas = amount - feeKas;
  if (netKas <= 0) {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: peer, amount_kas: amount, note: 'amount too small for fee' });
    return markProcessed(eventId, 'amount_too_small');
  }
  let midPrice = 0;
  try { midPrice = await _fetchKasPrice(); } catch {}
  if (!midPrice || midPrice <= 0) {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: peer, amount_kas: amount, note: 'no price feed' });
    return markProcessed(eventId, 'no_price');
  }
  // Owner 88 KAS 真测真撞 (J2 f5b0a272 dig + NWT 7d8710a8 ack): broker offer 0% spread =
  // mid price → autoTaker config min_discount_pct=1% SKIP + self-maker exclusion → 真**真**真 taker.
  // 修 broker SELL offer 加 1.5% spread below mid 真**真 outside taker incentive 接.
  // 副作用: broker 短期 unhedged KAS 仓位 risk (88 KAS << CEX liquidity, drop 风险 acceptable).
  // CEX hedge prototype 真**真 separate task R35 候选.
  const SELL_SPREAD_PCT = 0.015;  // 1.5% offer below mid (broker-intake-watcher hotfix)
  const wantUsdt = (netKas * midPrice * (1 - SELL_SPREAD_PCT)).toFixed(4);

  let res = null;
  try {
    res = await _publishOffer({
      relayNodeId: BROKER_RELAY_ID,
      give_asset: 'KAS', give_amount: String(netKas),
      want_asset: 'USDT', want_amount: wantUsdt,
      verification: 'cross_chain_tx',
      verification_meta: {
        accepted_chains: [{ chain: userPay.chain, address: userPay.address }],
        expected_asset: 'USDT',
      },
      expires_minutes: PUBLISH_EXPIRES_MIN,
      metadata: { source: 'broker-intake', user_kasia_address: peer, intent_qty: amount,
        fee_kas: feeKas, net_kas: netKas, mid_price: midPrice },
    });
  } catch (err) { res = { ok: false, error: err.message }; }

  if (!res?.ok) {
    // Q2 保险: publish 失败立即退原 KAS, broker 不持仓
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: peer, amount_kas: amount,
      note: `publish failed: ${res?.error || 'unknown'}` });
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
      message: `挂单失败 (${(res?.error || 'unknown').slice(0,80)}), ${amount} KAS 已退原路.`
    });
    return markProcessed(eventId, 'publish_failed');
  }

  const addrShort = userPay.address.slice(0,10) + '...' + userPay.address.slice(-4);
  // Bug-Z17 fix (NWT 7d8710a8 dig — Owner 88 KAS UI 卡 'awaiting_payment'):
  // _publishOffer ok 后**真**真**真**真 update retail_dex_orders.state → 'broadcast' + link exchange_offer_id.
  // 之前**真**真 update, 真**真**Owner UI 卡 'awaiting_payment' 真**真**真**真**真**真 broker offer 真**真 publish 上链.
  try {
    const updated = sqlite.prepare(
      `UPDATE retail_dex_orders SET state = 'broadcast', exchange_offer_id = ?, updated_at = datetime('now')
       WHERE user_kasia_address = ? AND side = 'sell_kas' AND state = 'awaiting_payment'
       AND created_at > datetime('now','-24 hours')`
    ).run(res.offer_id, peer);
    if (updated.changes > 0) {
      console.log(`[broker-intake] Z17 retail_dex_orders state sync: peer=${peer.slice(-12)} → broadcast, offer=${res.offer_id.slice(0,8)}`);
    }
  } catch (e) { console.warn(`[broker-intake] Z17 state sync err: ${e.message}`); }
  await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
    message: `收到 ${amount} KAS ✓ 已挂 SELL 单 ${netKas} KAS → ${wantUsdt} USDT (fee ${feeKas} KAS)\n` +
             `订单: ${res.offer_id.slice(0,8)} · 2h 内有人接单 USDT 直付你 ${userPay.chain} ${addrShort}\n` +
             `广播 tx: ${res.broadcast_tx?.slice(0,16) || '?'}`
  });
  return markProcessed(eventId, `sell_published:${res.offer_id}`);
}

export async function _scanExpiredBrokerOffers() {
  const trader = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(BROKER_RELAY_ID);
  if (!trader) return { handled: 0, scanned: 0, reason: 'no_broker_relay' };
  // Bug-Z20 fix (NWT 1a77fdd1 Owner 88 KAS 卡 broker 钱包): 真**真**proactive scan —
  // 真**真**真 broker offer 真**真**真 'open' + expires_at < now 真**真**真**真**真 'expired' 真**真**timed_out',
  // 都**真**真 trigger refund. 之前真**真**真 'expired'/'cancelled'/'timed_out' status 真**真**真 trigger,
  // 但**真**真**status 转 'expired' 真**真**真**真**exchange-machine TTL check, 真**真**'open' 长久 stuck 真**真**真**真 refund.
  // metadata.source 真**真**真 strict filter (老 offer 真**真**真**真**真**真 source 真**真**真**真 strict miss).
  const rows = sqlite.prepare(`
    SELECT id, give_amount, metadata, protocol_status, expires_at, broadcast_at FROM exchange_offers
    WHERE maker = ?
    AND give_asset = 'KAS'
    AND taker IS NULL
    AND (
      protocol_status IN ('expired', 'cancelled', 'timed_out')
      OR (protocol_status = 'open' AND expires_at IS NOT NULL AND julianday(expires_at) < julianday('now'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM chain_events e
      WHERE e.event_type = 'broker_kas_refunded'
      AND e.payload LIKE '%"offer_id":"' || exchange_offers.id || '"%'
      AND e.txid IN (SELECT tx_id FROM kaspa_tx_log)
    )
    AND json_extract(metadata, '$.user_kasia_address') IS NOT NULL
    ORDER BY broadcast_at DESC
    LIMIT 10
  `).all(trader.address);
  let handled = 0;
  if (rows.length > 0) console.log(`[broker-refund] Z20 scan: ${rows.length} expired/timeout offer(s) to refund`);
  // T-J2-2026-04-29 紧急 Track A: chain-truth dedup. 现 dedup SQL `txid IN kaspa_tx_log` 因占位符 txid='refund_xxx'
  // 永久失效, 同 offer 可重复退款 broker 真亏. 改: 退款前查 kaspa_tx_log 真链有没 broker→user refund TX matching
  // expected_amount + offer broadcast_at 时间窗. 有则 skip (已退过).
  // T-J2-2026-04-29 Track B step 5 (Owner 钦定单一状态机, round 3 共识):
  // 替原 inline sendKas + chain_event placeholder INSERT pattern → call advanceToRefunded.
  // advanceToRefunded 内部 chain-truth dedup + Phase 1 CAS + Phase 2 sendKas (真 chain hash) + Phase 3 atomic 3-table sync.
  // chain_events INSERT 真 real txId (post-v83 lenient trigger PASS), 不再占位符 polluting.
  const { advanceToRefunded } = await import('./broker-state-authority.js');
  for (const r of rows) {
    try {
      const meta = JSON.parse(r.metadata || '{}');
      const userKasia = meta.user_kasia_address;
      if (!userKasia) {
        console.warn(`[broker-refund] Z20 ${r.id.slice(0,8)} skip: no user_kasia_address in metadata`);
        continue;
      }
      const refundAmount = parseFloat(meta.intent_qty || r.give_amount);

      // 'open' → 'timed_out' status transition (proactive sweep set timestamp).
      // advanceToRefunded refundable states: 'awaiting_payment','paid','expired'. 'open'/'timed_out' offer
      // 真 retail_dex_orders state 真 'awaiting_payment' (broker held KAS) — advanceToRefunded 真 work.
      if (r.protocol_status === 'open') {
        sqlite.prepare(`UPDATE exchange_offers SET protocol_status='timed_out', timed_out_at=datetime('now') WHERE id=?`).run(r.id);
      }

      // Find linked retail_dex_orders.id
      const order = sqlite.prepare(`
        SELECT id FROM retail_dex_orders
        WHERE user_kasia_address=?
          AND (exchange_offer_id=? OR (exchange_offer_id IS NULL AND CAST(qty AS REAL) >= ? - 0.5 AND CAST(qty AS REAL) <= ? + 0.5 AND state IN ('awaiting_payment','paid','expired')))
        ORDER BY created_at DESC LIMIT 1
      `).get(userKasia, r.id, refundAmount, refundAmount);

      if (!order?.id) {
        console.warn(`[broker-refund] Z20 ${r.id.slice(0,8)} skip — no retail_dex_orders link, advanceToRefunded 真 orderId 必`);
        continue;
      }

      const result = await advanceToRefunded({ orderId: order.id, reason: 'expired_auto_refund' });

      if (result.ok) {
        if (result.noRefundNeeded) {
          // J1 #73 Edge 1: order.state 'aligning'/'confirming' — broker 没收 user payment, 真 NO refund needed.
          // 不该 retry 也不 DM user. log 一次 surface unusual case (cron 真 'aligning' 30min 才扫到, 真 abnormal).
          console.warn(`[broker-refund] Z20 ${r.id.slice(0,8)} no-refund-needed (order state=${result.orderState}, broker 没收 user payment) — skip refund + skip retry`);
        } else if (result.alreadyRefunded) {
          console.warn(`[broker-refund] Z20 ${r.id.slice(0,8)} DEDUP — chain 真已退过 (TX: ${result.txId?.slice(0,12)}), DB 已自动 backfill`);
        } else {
          console.log(`[broker-refund] Z20 ${r.id.slice(0,8)} ✓ refund ${result.refundAmount} KAS → ${userKasia.slice(-12)} (TX: ${result.txId?.slice(0,12)})`);
          // DM ack user (advanceToRefunded 不 send DM, caller send per round 3 共识 Q6)
          await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: userKasia,
            message: `订单 ${r.id.slice(0,8)} 2h 无人接单, 已退 ${result.refundAmount} KAS 给你. broker 吃 gas. Kasia TX: ${result.txId?.slice(0,16)}`
          });
        }
        handled++;
      } else if (result.skipReason === 'race_lost') {
        console.warn(`[broker-refund] Z20 ${r.id.slice(0,8)} race lost (其他 caller 已 claim refunding lock), reconciler 真 backfill`);
      } else {
        console.error(`[broker-refund] Z20 ${r.id.slice(0,8)} advanceToRefunded FAIL: ${result.error || result.skipReason}`);
      }
    } catch (err) { console.warn(`[broker-refund] Z20 ${r.id} err: ${err.message}`); }
  }
  return { handled, scanned: rows.length };
}

// T-J2-10: 12h stale unsolicited_wait scanner — user 12h 无 ACK 自动退款
// T-NWT-2026-04-30 R1: 切 broker_workflow_markers 表. src_event_id 是 kaspa_tx_log.tx_id (post T-NWT-07
// indexer 改, src 表 chain_events 'tx' inbound 永远 0, 真源在 kaspa_tx_log).
//
// Phase Y P1 backlog: kaspa_tx_log.from_address 100% NULL (indexer T-NWT-07 残), 此 12h refund path 当前
// 实质不能退 (没 from_address sendKaspa 不知 target). post T-NWT-07 indexer 修 from_address 后真生效.
export async function _scanStaleUnsolicited() {
  const rows = sqlite.prepare(`
    SELECT p.id, p.src_event_id, p.payload
    FROM broker_workflow_markers p
    WHERE p.event_type = 'broker_intake_processed'
      AND p.payload LIKE '%"outcome":"unsolicited_wait"%'
      AND julianday(p.created_at) < julianday('now', '-12 hours')
      AND NOT EXISTS (
        SELECT 1 FROM broker_workflow_markers r
        WHERE r.event_type = 'broker_unsolicited_refunded'
        AND r.payload LIKE '%"processed_event_id":"' || p.id || '"%'
      )
    LIMIT 10
  `).all();
  let handled = 0;
  for (const p of rows) {
    try {
      const src = sqlite.prepare(`SELECT from_address, amount FROM kaspa_tx_log WHERE tx_id = ?`).get(p.src_event_id);
      if (!src?.from_address) continue;  // indexer 漏抓 sender, 不能盲发
      const amt = parseFloat(src.amount || 0);
      if (amt <= 0) continue;
      await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: src.from_address, amount_kas: amt,
        note: `12h unsolicited refund ${p.id.slice(0, 12)}` });
      sqlite.prepare(`
        INSERT INTO broker_workflow_markers (id, event_type, src_event_id, payload, created_at)
        VALUES (?, 'broker_unsolicited_refunded', ?, ?, datetime('now'))
      `).run(`unsolicited_refund_${p.id.slice(0, 16)}`, p.src_event_id, JSON.stringify({ processed_event_id: p.id, user_kasia_address: src.from_address, amount: amt }));
      await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: src.from_address,
        message: `12h 无回复, 已退 ${amt} KAS 给你. broker 吃 gas.` });
      handled++;
    } catch (err) { console.warn(`[broker-stale] ${p.id?.slice(0,8)} err: ${err.message}`); }
  }
  return { handled, scanned: rows.length };
}

// T-NWT-06: 同 5min sub-tick 调 utxo-splitter 给 broker 钱包补零钱, 防 Round 1 一分钟 7 撞 UTXO 风暴.
// 内置 broker_workflow_markers 'broker_utxo_split' 防 4min 内重跑 (REFUND_TICK_MS 5min 偏小, 1min 缓冲).
// T-NWT-2026-04-30 R1: 切 broker_workflow_markers 表 (旧 chain_events 路径撞 v83 trigger ABORT).
export async function _ensureBrokerUtxoSplit() {
  const recent = sqlite.prepare(
    `SELECT 1 FROM broker_workflow_markers WHERE event_type='broker_utxo_split'
     AND datetime(created_at) > datetime('now','-4 minutes') LIMIT 1`
  ).get();
  if (recent) return { skipped: 'recent' };
  const { splitUtxos } = await import('./utxo-splitter.js');
  let result;
  try { result = await splitUtxos(BROKER_RELAY_ID); } catch (e) { return { ok: false, error: e.message }; }
  sqlite.prepare(
    `INSERT INTO broker_workflow_markers (id, event_type, src_event_id, payload, created_at)
     VALUES (?, 'broker_utxo_split', NULL, ?, datetime('now'))`
  ).run(`broker_utxo_split_${Date.now()}`, JSON.stringify({ result: result || null }));
  if (result?.split) console.log(`[broker-utxo-split] ${result.utxosBefore}→${result.utxosAfter} (fee ${result.fee||'?'} KAS)`);
  return result || { ok: false };
}

export async function intakeTick() {
  const trader = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(BROKER_RELAY_ID);
  if (!trader) return { handled: 0, reason: 'no_broker_relay' };
  // T-NWT-07: 源表 chain_events 'tx' inbound 永远 0 (那条 path 是 message-bound, 不是 KAS transfer).
  // 真正的 inbound tx ingest 在 kaspa_tx_log (rpc-listener.mjs 写). 改源表救 broker-intake.
  // src_event_id 在 marker payload 里现在是 string (tx_id), LIKE 模式带引号.
  //
  // T-J2-2026-04-30 R2+R3 fix v2 (Owner 真测 dig + 数据验证修订):
  // 实证 last 24h kaspa_tx_log to=Trader-B 3093 rows: 3092 是 >500 KAS (broker UTXO splitter
  // 自循环 chain, 994.X KAS chunks 序列 .2606→.261→.262 fee 递减), 仅 1 row <100 KAS = 真 user TX (Owner 58).
  // 旧 R2 'from_address != to_address' 失效 — kaspa_tx_log.from_address 全 NULL (indexer verboseData
  // 未抓 sender, T-NWT-07 已知 indexer 残). 改用 amount upper bound 启发式过滤:
  //   real user retail SELL/transfer 一般 < 200 KAS. broker 内部 splitter chunks 一般 > 500 KAS.
  // 长期修法: rpc-listener.mjs indexer 修 from_address 后回到 self-TX filter (T-NWT-07 sprint backlog).
  //   R2 v2: AND k.amount < 500  -- 排除 broker UTXO splitter 994 KAS chunks 等
  //   R3: ORDER BY k.observed_at DESC + LIMIT 提至 50 — 优先处理新 user TX
  const MAX_USER_TX_KAS = 500;
  const rows = sqlite.prepare(`
    SELECT k.tx_id AS id, k.tx_id AS txid, k.from_address,
           json_object('amount', CAST(k.amount AS TEXT)) AS payload
    FROM kaspa_tx_log k
    WHERE k.to_address = ?
    AND k.observed_at > datetime('now','-24 hours')
    AND k.amount < ?
    AND NOT EXISTS (
      SELECT 1 FROM broker_workflow_markers p
      WHERE p.event_type = 'broker_intake_processed'
      AND p.src_event_id = k.tx_id
    )
    ORDER BY k.observed_at DESC
    LIMIT 50
  `).all(trader.address, MAX_USER_TX_KAS);
  let handled = 0;
  for (const e of rows) {
    try { await handleIntake(e); handled++; }
    catch (err) { console.warn(`[broker-intake] ${e.id} err: ${err.message}`); }
  }
  return { handled, scanned: rows.length };
}

// T-J1-2026-04-28 Layer 4 (phase 3 8-layer system fix): chain reconciler 周期 sweep.
// 治 J2's Defect C 残留 + pre-Layer-1 历史: chain_events 'broker_kas_refunded' 真**真**真 txid 在 kaspa_tx_log 真存在.
// Z20 旧 INSERT 用 'refund_<offer_id>' 合成 txid (非真链 hash), Layer 1 markOrderRefunded 用真 txId.
// 本 sweep 抓两类 drift:
//   A. chain_events broker_kas_refunded.txid 非 64-hex 或不在 kaspa_tx_log → 自欺 INSERT 残留 → DM Owner alert
//   B. retail_dex_orders state IN ('refunded','cancelled_refunded','timed_out_refunded') AND
//      没对应 kaspa_tx_log-verified chain_event → 状态造假 → DM Owner alert
// dedupe: events.event_type='reconcile_drift_alert' + payload.chain_event_id, 不重复 alert 已 flagged 的.
export async function _reconcileRefundsTick() {
  let inspected = 0, drift = 0, alerted = 0;
  try {
    const rows = sqlite.prepare(`
      SELECT ce.id, ce.txid, ce.payload, ce.observed_at
      FROM chain_events ce
      LEFT JOIN kaspa_tx_log k ON k.tx_id = ce.txid
      WHERE ce.event_type = 'broker_kas_refunded'
        AND k.tx_id IS NULL
        AND julianday(ce.observed_at) > julianday('now', '-24 hours')
        AND NOT EXISTS (
          SELECT 1 FROM events e
          WHERE e.event_type = 'reconcile_drift_alert'
            AND e.payload_json LIKE '%"chain_event_id":"' || ce.id || '"%'
        )
      LIMIT 20
    `).all();
    inspected = rows.length;
    for (const o of rows) {
      drift++;
      let p = {};
      try { p = JSON.parse(o.payload || '{}'); } catch {}
      const summary = `Refund drift: chain_event ${String(o.id).slice(0,8)} txid=${String(o.txid||'').slice(0,16)} 不在 kaspa_tx_log (offer ${String(p.offer_id||'').slice(0,8)})`;
      console.error(`[broker-reconciler Layer4] ${summary}`);
      try {
        sqlite.prepare(`
          INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
          VALUES (?, 'broker', 'reconcile_drift_alert', 'broker-reconciler', 'critical', ?, ?, datetime('now'))
        `).run(
          randomUUID(), summary,
          JSON.stringify({ chain_event_id: o.id, txid: o.txid, offer_id: p.offer_id, user_kasia: p.user_kasia_address, amount: p.amount, observed_at: o.observed_at })
        );
        alerted++;
      } catch (e) { console.warn(`[broker-reconciler] alert INSERT err: ${e.message}`); }
    }
  } catch (e) {
    console.error(`[broker-reconciler Layer4] tick err: ${e.message}`);
  }
  return { inspected, drift, alerted };
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
  if (!_refundInterval) {
    _refundInterval = setInterval(async () => {
      try {
        const r = await _scanExpiredBrokerOffers();
        if (r && r.scanned > 0) console.log(`[broker-refund] tick handled=${r.handled||0}/${r.scanned||0}`);
      } catch (e) { console.error('[broker-refund]', e.message); }
      // T-J2-10: 同 5min sub-tick 同时扫 12h unsolicited stale
      try {
        const s = await _scanStaleUnsolicited();
        if (s && s.scanned > 0) console.log(`[broker-stale] tick handled=${s.handled||0}/${s.scanned||0}`);
      } catch (e) { console.error('[broker-stale]', e.message); }
      // T-NWT-06: 同 5min sub-tick 主动 ensure broker 钱包 UTXO 数 (Round 1 UTXO 双花治本)
      try { await _ensureBrokerUtxoSplit(); } catch (e) { console.error('[broker-utxo-split]', e.message); }
      // T-J1-2026-04-28 Layer 4 (phase 3): chain reconciler — 抓 chain_events refunded.txid 不在 kaspa_tx_log 的 drift
      try {
        const r = await _reconcileRefundsTick();
        if (r && r.drift > 0) console.warn(`[broker-reconciler] tick drift=${r.drift}/${r.inspected} alerted=${r.alerted}`);
      } catch (e) { console.error('[broker-reconciler]', e.message); }
    }, REFUND_TICK_MS);
  }
  console.log(`[broker-intake] watcher started for Trader-B tick=${TICK_MS}ms, refund tick=${REFUND_TICK_MS}ms`);
}

export function stopIntakeWatcher() {
  if (_intakeInterval) { clearInterval(_intakeInterval); _intakeInterval = null; }
  if (_refundInterval) { clearInterval(_refundInterval); _refundInterval = null; }
}
