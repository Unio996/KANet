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
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const SCAN_SPAN_BLOCKS = 1500;  // ~75min BSC (3s blocks)
const AMOUNT_TOLERANCE_PCT = 0.01;  // ±1% match

let _intakeInterval = null;
let _ticks = 0;
let _matches = 0;

export function start() {
  if (_intakeInterval) return { ok: false, reason: 'already_started' };
  _intakeInterval = setInterval(() => {
    tick().catch(e => console.warn(`[broker-bsc-intake] tick err: ${e.message}`));
    // Bug H γ 5/14 Sub #2 (Owner 12:05 钦定 candidate A v2): 并行 tickEscrow scan for
    // user_escrow_balances pending_prepay. ESCROW_MODE check inside tickEscrow — flag off → 直 return.
    tickEscrow().catch(e => console.warn(`[broker-bsc-intake-escrow] tick err: ${e.message}`));
  }, TICK_MS);
  console.log(`[broker-bsc-intake] started, tick=${TICK_MS / 1000}s — BSC USDT inflow → legacy BUY flow + Bug H escrow flow (flag-gated)`);
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

// Bug H γ Sub #2 (Owner 12:05 钦定 candidate A v2 broker-escrow custody):
// 扫 user_escrow_balances pending_prepay rows, match incoming USDT/USDC TX by (broker_recv_addr, amount tolerance ±0.5%).
// 匹配 → UPDATE escrow row (prepayment_tx, amount_received, user_refund_addr from sender) + status pending_prepay → active
// → call _doPublishAfterPrepay 真 publish offer backed by escrow.
// ESCROW_MODE off (default) → 直 return (legacy retail_dex_orders flow 不动).
// 当前 BSC only — eth/polygon/arbitrum/optimism/base 待 future expansion (poll Kaspa cross-chain-verify multi-chain support).
const ESCROW_AMOUNT_TOLERANCE_PCT = 0.005;  // ±0.5% per NWT 12:12 Q2 ack
const ESCROW_SCAN_SPAN_BLOCKS = 200;  // ~10 min BSC (3s blocks) — pending_prepay TTL 5 min + safety
let _escrowTicks = 0;
let _escrowMatches = 0;

export async function tickEscrow() {
  if (process.env.BROKER_V3_ESCROW_MODE !== 'true') return { ok: true, reason: 'escrow_mode_off' };
  _escrowTicks++;

  // Scan BSC broker addr for pending escrow rows (BUY flow user prepays USDT)
  const brokerWallet = sqlite.prepare(
    `SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1 LIMIT 1`
  ).get(BROKER_RELAY_ID);
  if (!brokerWallet?.address) return { ok: false, reason: 'no_broker_bsc_wallet' };
  const brokerBscAddr = brokerWallet.address;

  // Bug L 5/14 fix: include both pending_prepay (waiting for prepay TX) + active without offer_id
  // (prepay detected, publish failed/not-yet-attempted — Bug K race fix follow-up retry path).
  // 查 BUY pending escrow rows (user prepay USDT on BSC, broker_recv_addr=BSC broker addr)
  const pending = sqlite.prepare(`
    SELECT id, quote_seq, side, user_kasia_addr, amount_quoted, asset, chain, broker_recv_addr, target_amount, expires_at, status, prepayment_tx
    FROM user_escrow_balances
    WHERE (status = 'pending_prepay' OR (status = 'active' AND offer_id IS NULL))
      AND side = 'buy_kas'
      AND chain = 'bnb'
      AND broker_recv_addr = ?
      AND expires_at > datetime('now')
    ORDER BY created_at ASC
    LIMIT 10
  `).all(brokerBscAddr);
  if (!pending.length) return { ok: true, scanned: 0, matched: 0 };

  // Scan recent BSC USDT transfers to broker
  const { scanRecentTransfers } = await import('./cross-chain-verify.mjs');
  const scan = await scanRecentTransfers({ chain: 'bnb', recipient: brokerBscAddr, span_blocks: ESCROW_SCAN_SPAN_BLOCKS, paymentAsset: 'usdt' });
  if (!scan.ok || !scan.events?.length) return { ok: true, scanned: pending.length, matched: 0 };

  let matched = 0;
  for (const e of pending) {
    // Bug L 5/14 fix: 2 cases — pending_prepay (need to find prepayment TX) OR active (already detected,
    // retry publish only).
    if (e.status === 'pending_prepay') {
      const expectedAmount = parseFloat(e.amount_quoted);
      // FIFO match by amount within ±0.5% tolerance, prefer exact-amount-match (含 quote_seq noise)
      const tx = scan.events.find(t => Math.abs(t.amount - expectedAmount) / expectedAmount <= ESCROW_AMOUNT_TOLERANCE_PCT);
      if (!tx) continue;

      // anti-replay: prepayment_tx UNIQUE constraint will reject if already used.
      // Bug M 5/14 fix: scanRecentTransfers event field is `from` (NOT `sender`/`from_address`).
      // Fallback fallthrough to user_kasia_addr is wrong (kasia ≠ EVM). If truly missing, leave NULL
      // (sweep refund will skip refund + log manual review needed; cleaner than corrupt addr).
      // Bug O 5/14 fix: when status pending_prepay → active, extend expires_at from 5min (quote TTL)
      // to 30min (active offer TTL). 否则 sweep refund 提前 fire 抢 publish retry window.
      try {
        sqlite.prepare(`
          UPDATE user_escrow_balances
          SET prepayment_tx = ?, amount_received = ?, user_refund_addr = ?, status = 'active',
              expires_at = datetime('now', '+30 minutes'), updated_at = datetime('now')
          WHERE id = ? AND status = 'pending_prepay'
        `).run(tx.tx_hash, String(tx.amount), tx.from || null, e.id);
      } catch (err) {
        if (/UNIQUE constraint failed/.test(err.message)) {
          console.warn(`[broker-bsc-intake-escrow] prepayment_tx ${tx.tx_hash.slice(0,16)} already used (anti-replay)`);
          continue;
        }
        console.error(`[broker-bsc-intake-escrow] UPDATE err for escrow ${e.id.slice(0,8)}: ${err.message}`);
        continue;
      }
    }
    // else: e.status === 'active' AND offer_id IS NULL — Bug L retry path (Bug K race: prepay UPDATE
    // succeeded but publish failed). Skip TX match step, go straight to publish.

    // call _doPublishAfterPrepay to publish offer backed by escrow (post Bug K guard relax)
    try {
      const { _doPublishAfterPrepay } = await import('./broker-v3/router.js');
      const r = await _doPublishAfterPrepay(e.id, BROKER_RELAY_ID);
      if (!r.ok) {
        console.error(`[broker-bsc-intake-escrow] _doPublishAfterPrepay fail for escrow ${e.id.slice(0,8)}: ${r.error}`);
      } else {
        matched++;
        _escrowMatches++;
        const prepayLabel = e.status === 'active' ? 'retry' : `prepay-detected (tx=${e.prepayment_tx?.slice(0,16)})`;
        console.log(`[broker-bsc-intake-escrow] escrow ${e.id.slice(0,8)} ${prepayLabel} → offer ${r.offer_id?.slice(0,12)} published`);
        // Bug H γ Step 4 #3 残 — marketable matcher: check if opposite-side compatible offer exists.
        // If match: cross-settle both escrows without taker accept (broker net Δ=0, Owner invariant 守).
        try {
          const { tryMarketableMatch } = await import('./exchange-machine.js');
          const matchResult = await tryMarketableMatch(e.id);
          if (matchResult.matched) {
            console.log(`[broker-bsc-intake-escrow] escrow ${e.id.slice(0,8)} marketable MATCH cross-settled (bid=${matchResult.bidPrice.toFixed(4)} ask=${matchResult.askPrice.toFixed(4)})`);
          }
        } catch (err) { console.warn(`[broker-bsc-intake-escrow] matcher err: ${err.message}`); }
      }
    } catch (err) {
      console.error(`[broker-bsc-intake-escrow] _doPublishAfterPrepay err for escrow ${e.id.slice(0,8)}: ${err.message}`);
    }
  }
  return { ok: true, scanned: pending.length, matched };
}

export function getEscrowStats() { return { started: !!_intakeInterval, ticks: _escrowTicks, matches: _escrowMatches }; }
