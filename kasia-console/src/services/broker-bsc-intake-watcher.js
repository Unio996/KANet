// ════════════════════════════════════════════════════════════════
// broker-bsc-intake-watcher.js — Phase 2 (β.1) BUY flow user → broker BSC USDT receipt
// T-J2-2026-05-10 r240 T2.23 (NWT r303 green-light)
// ════════════════════════════════════════════════════════════════
//
// 30s tick poll broker BSC 0xaD12544E inflow (cross-chain-verify scanRecentTransfers BSC USDT).
// match retail_dex_orders state='awaiting_payment' side='buy_kas' pay_address=broker_BSC by amount tolerance ±1%.
// trigger _publishBrokerBuyOffer (broker-intake-watcher T2.21) 真 user_kasia=peer 真 caller chain.
//
// mirror broker-intake-watcher.js KAS Kaspa flow → BSC USDT flow:
//   broker-intake-watcher: kaspa_tx_log poll → retail_dex_orders sell_kas state mapping → _publishBrokerSellOffer
//   broker-bsc-intake-watcher: cross-chain-verify scanRecentTransfers → retail_dex_orders buy_kas state mapping → _publishBrokerBuyOffer
//
// 不破 existing bsc-incoming-watcher (maker payment verify scope 不同).

import { sqlite } from '../db/client.js';

const TICK_MS = 30 * 1000;
// Bettor #j5romh r766 身份迁移补全, env 缺失 fail-loud 拒启(死值兜底=定时雷, 见 kanet.env)。
const BROKER_RELAY_ID = process.env.BROKER_RELAY_ID;
if (!BROKER_RELAY_ID) {
  throw new Error('[broker-bsc-intake-watcher] FATAL: BROKER_RELAY_ID env var not set (see kanet.env) — refusing to start with hardcoded dead relay id fallback');
}
const SCAN_SPAN_BLOCKS = 1500;  // ~75min BSC (3s blocks)
const AMOUNT_TOLERANCE_PCT = 0.01;  // ±1% match

let _intakeInterval = null;
let _ticks = 0;
let _matches = 0;

export function start() {
  if (_intakeInterval) return { ok: false, reason: 'already_started' };
  _intakeInterval = setInterval(() => { tick().catch(e => console.warn(`[broker-bsc-intake] tick err: ${e.message}`)); }, TICK_MS);
  console.log(`[broker-bsc-intake] started, tick=${TICK_MS / 1000}s — broker BSC USDT inflow → BUY flow trigger`);
  return { ok: true };
}

export function stop() {
  if (_intakeInterval) clearInterval(_intakeInterval);
  _intakeInterval = null;
  console.log(`[broker-bsc-intake] stopped (ticks=${_ticks}, matches=${_matches})`);
}

export function getStats() { return { started: !!_intakeInterval, ticks: _ticks, matches: _matches }; }

export async function tick() {
  _ticks++;
  // R19 hygiene: dynamic load broker BSC addr
  const brokerWallet = sqlite.prepare(
    `SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1 LIMIT 1`
  ).get(BROKER_RELAY_ID);
  if (!brokerWallet?.address) return { ok: false, reason: 'no_broker_bsc_wallet' };
  const brokerBscAddr = brokerWallet.address;

  // 找 pending broker-as-maker BUY orders (T2.22 _proposeBrokerAsBuyMaker INSERT 真 row)
  const pending = sqlite.prepare(`
    SELECT id, user_kasia_address, qty, price, created_at, expires_at
    FROM retail_dex_orders
    WHERE state = 'awaiting_payment'
      AND side = 'buy_kas'
      AND order_type = 'broker_as_maker'
      AND pay_address = ?
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      AND created_at > datetime('now', '-2 hours')
    ORDER BY created_at DESC
    LIMIT 10
  `).all(brokerBscAddr);
  if (!pending.length) return { ok: true, scanned: 0, matched: 0 };

  // BSC USDT 入账 scan
  const { scanRecentTransfers } = await import('./cross-chain-verify.mjs');
  const scan = await scanRecentTransfers({ chain: 'bnb', recipient: brokerBscAddr, span_blocks: SCAN_SPAN_BLOCKS, paymentAsset: 'usdt' });
  if (!scan.ok || !scan.events?.length) return { ok: true, scanned: pending.length, matched: 0 };

  let matched = 0;
  for (const order of pending) {
    const expectedUsdt = parseFloat(order.qty) * parseFloat(order.price) * 1.015;  // BUY_SPREAD_PCT 0.015 (mirror T2.22)
    const tx = scan.events.find(e => Math.abs(e.amount - expectedUsdt) / expectedUsdt <= AMOUNT_TOLERANCE_PCT);
    if (!tx) continue;

    // dedup: chain_events 真 broker_buy_intake_processed 真 NOT yet
    const dedup = sqlite.prepare(
      `SELECT 1 FROM broker_workflow_markers WHERE event_type = 'broker_buy_intake_processed' AND src_event_id = ? LIMIT 1`
    ).get(tx.tx_hash);
    if (dedup) continue;

    // trigger _publishBrokerBuyOffer (broker-intake-watcher T2.21)
    try {
      const { _publishBrokerBuyOffer } = await import('./broker-intake-watcher.js');
      if (typeof _publishBrokerBuyOffer === 'function') {
        await _publishBrokerBuyOffer(order.user_kasia_address, tx.amount, tx.tx_hash);
      } else {
        // T2.21 真 internal function (NOT exported), 真 future export 真 wire
        console.warn(`[broker-bsc-intake] T2.21 _publishBrokerBuyOffer NOT exported, dormant`);
      }
      // mark processed
      const { randomUUID } = await import('node:crypto');
      sqlite.prepare(`
        INSERT INTO broker_workflow_markers (id, event_type, src_event_id, payload, created_at)
        VALUES (?, 'broker_buy_intake_processed', ?, ?, datetime('now'))
      `).run(`buy_intake_${tx.tx_hash.slice(0,16)}`, tx.tx_hash, JSON.stringify({
        order_id: order.id, user_kasia: order.user_kasia_address, amount_usdt: tx.amount, expected_usdt: expectedUsdt,
      }));
      matched++;
      _matches++;
      console.log(`[broker-bsc-intake] matched order ${order.id.slice(-12)} user=${order.user_kasia_address.slice(-12)} usdt=${tx.amount} tx=${tx.tx_hash.slice(0,16)}`);
    } catch (err) {
      console.warn(`[broker-bsc-intake] _publishBrokerBuyOffer err for order ${order.id.slice(-12)}: ${err.message}`);
    }
  }
  return { ok: true, scanned: pending.length, matched };
}
