/**
 * KAS Market Maker — Main Entry Point
 *
 * Independent system. Connects to KANet via API.
 * First external KANet client. Proves: 万物皆可 KANet。
 *
 * Architecture:
 *   This system ←→ KANet API (quotes, messages, KAS transfers)
 *   This system ←→ MEXC API (price, rebalancing)
 *   This system ←→ Chain Explorer APIs (verify cross-chain payments)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KanetClient } from './kanet-client.mjs';
import { ChainVerifier } from './chain-verify.mjs';
import { Exchange } from './exchange.mjs';
import { RiskEngine } from './risk.mjs';
import { fetchPrice, calculateQuote } from './price-engine.mjs';
import { parseOrderMessage, createNewOrder, markAwaitingPayment, markPaymentVerified, markKasSent, markCompleted, expireStaleOrders, getActiveOrders } from './order-manager.mjs';
import { recordQuote, getReputation, recordTrade, getPnL, getRecentTrades } from './db.mjs';
import { startServer } from './server.mjs';

// Load config
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'config.json'), 'utf8'));

// Initialize modules
const kanet = new KanetClient(config.kanet);
const verifier = new ChainVerifier(config.chains);
const exchange = new Exchange(config.exchange);
const risk = new RiskEngine(config.risk);

const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

// ── Main Loop ────────────────────────────────────────────────────────────────

let _currentQuote = null;
let _lastKasBalance = 0;

async function updateQuote() {
  try {
    const mexcPrice = await fetchPrice(config.exchange.symbol);
    risk.checkPriceDeviation(mexcPrice);

    if (risk.isHalted) {
      log('HALTED:', risk.haltReason);
      return;
    }

    const kasBalance = await kanet.getBalance();
    _lastKasBalance = kasBalance;
    const quote = calculateQuote(mexcPrice, config.pricing.spreadPct);

    // Check inventory
    const inv = risk.checkInventory(kasBalance, 999); // TODO: track USDT balance
    if (!inv.canSell) quote.sellPrice = null;

    _currentQuote = quote;

    // Publish to KANet
    const parts = [];
    if (quote.buyPrice) parts.push(`BUY ${quote.buyPrice}`);
    if (quote.sellPrice) parts.push(`SELL ${quote.sellPrice}`);
    parts.push(`Stock: ${Math.floor(kasBalance)} KAS`);
    parts.push(`Accept: USDT(BNB,SOL,ETH,TRON)`);
    parts.push(`Updated: ${quote.updatedAt.slice(11, 19)}`);

    const quoteText = `[KAS-MM] ${parts.join(' | ')}`;
    await kanet.publishQuote(quoteText);
    log('Quote:', quoteText);

    // Record to DB
    recordQuote({ buyPrice: quote.buyPrice, sellPrice: quote.sellPrice, kasStock: kasBalance, usdtStock: 0, mexcPrice });
  } catch (err) {
    log('Quote update error:', err.message);
  }
}

async function checkOrders() {
  try {
    // Expire stale quotes
    const expired = expireStaleOrders(config.risk.quoteValidMinutes);
    if (expired > 0) log(`Expired ${expired} stale orders`);

    // Poll for new messages
    const msgs = await kanet.pollMessages('kas-market');
    for (const msg of msgs) {
      // Skip our own messages
      if (msg.sender_address?.startsWith('owner:')) continue;

      const order = parseOrderMessage(msg.content || '');
      if (!order) continue;

      log('Order detected:', order.side, order.kasAmount, 'KAS', order.usdtAmount, 'USDT on', order.chain);
      await handleOrder(order, msg.sender_address);
    }

    // Check pending orders for payment verification
    const pending = getActiveOrders().filter(o => o.status === 'awaiting_payment');
    for (const o of pending) {
      try {
        const result = await verifier.verifyPayment(o.chain, o.customer_pay_address, o.usdt_amount, o.mm_receive_address);
        if (result.verified) {
          log('Payment verified:', o.id.slice(0, 8), result.txHash);
          markPaymentVerified(o.id, result.txHash);
          // Send KAS
          await sendKasForOrder(o);
        }
      } catch (err) {
        log('Verify error for', o.id.slice(0, 8), ':', err.message);
      }
    }
  } catch (err) {
    log('Order check error:', err.message);
  }
}

async function handleOrder(order, senderAddress) {
  if (!_currentQuote) return;

  const price = order.side === 'buy' ? _currentQuote.sellPrice : _currentQuote.buyPrice;
  if (!price) {
    await kanet.replyToCustomer('kas-market', `Sorry, ${order.side === 'buy' ? 'selling' : 'buying'} is currently paused.`);
    return;
  }

  // Risk check
  const riskCheck = risk.checkOrder(order.side, order.kasAmount, senderAddress, true);
  if (!riskCheck.ok) {
    await kanet.replyToCustomer('kas-market', `Order rejected: ${riskCheck.reason}`);
    return;
  }

  // Calculate
  const kasAmount = order.side === 'buy'
    ? parseFloat((order.usdtAmount / price).toFixed(2))
    : order.kasAmount;
  const usdtAmount = order.side === 'buy'
    ? order.usdtAmount
    : parseFloat((order.kasAmount * price).toFixed(2));

  // Batch plan
  const batches = risk.getBatchPlan(usdtAmount, kasAmount);

  // Get MM receive address for the chain
  const chainConfig = config.chains[order.chain];
  if (!chainConfig?.receiveAddress) {
    await kanet.replyToCustomer('kas-market', `Chain ${order.chain} not configured yet.`);
    return;
  }

  // Create order records
  const orderIds = createNewOrder({
    side: order.side,
    kasAmount, usdtAmount, price,
    chain: order.chain,
    customerKaspaAddress: senderAddress,
    mmReceiveAddress: chainConfig.receiveAddress,
    batchPlan: batches,
  });

  // Reply with instructions
  const batchNote = batches.length > 1 ? ` (${batches.length} batches of ${batches[0].usdtAmount} USDT)` : '';
  const reply = order.side === 'buy'
    ? `Confirmed: ${kasAmount} KAS @ ${price} = ${usdtAmount} USDT${batchNote}\nSend ${batches[0].usdtAmount} USDT to: ${chainConfig.receiveAddress} (${order.chain.toUpperCase()})\nValid for ${config.risk.quoteValidMinutes} minutes.`
    : `Confirmed: ${kasAmount} KAS @ ${price} = ${usdtAmount} USDT${batchNote}\nSend ${batches[0].kasAmount} KAS to my Kaspa address.\nUSDT will be sent to your ${order.chain.toUpperCase()} address after verification.`;

  await kanet.replyToCustomer('kas-market', reply);
  orderIds.forEach(id => markAwaitingPayment(id));
  log('Order created:', orderIds.length, 'batch(es) for', senderAddress?.slice(-12));
}

async function sendKasForOrder(order) {
  try {
    // 1. Send KAS to customer on-chain
    const result = await kanet.sendKas(order.customer_kaspa_address, order.kas_amount);
    markKasSent(order.id, result?.txId || 'sent');

    // 2. Hedge on exchange — buy same amount to replenish inventory
    let hedgeResult = null;
    try {
      hedgeResult = await exchange.hedge('sell', order.kas_amount);
      log('Hedge:', hedgeResult.side, order.kas_amount, 'KAS @ exchange price', hedgeResult.executedPrice);
    } catch (err) {
      log('Hedge failed (manual rebalance needed):', err.message);
    }

    // 3. Record trade with profit
    const exchangePrice = hedgeResult?.executedPrice || _currentQuote?.mexcPrice || order.price;
    const trade = recordTrade({
      orderId: order.id,
      side: 'sell',  // MM sold KAS on-chain
      kasAmount: order.kas_amount,
      onchainPrice: order.price,
      exchangePrice,
      exchangeOrderId: hedgeResult?.orderId,
    });
    log('Trade recorded: profit', trade.profit.toFixed(4), 'USDT');

    markCompleted(order.id);
    await kanet.replyToCustomer('kas-market',
      `Sent ${order.kas_amount} KAS to your address. Batch ${order.batch_index + 1}/${order.batch_total} complete.`
    );
  } catch (err) {
    log('KAS send failed:', err.message);
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────

log('KAS Market Maker starting...');
log('KANet:', config.kanet.consoleUrl);
log('Exchange:', config.exchange.name, config.exchange.symbol);
log('Chains:', Object.keys(config.chains).join(', '));
log('Spread:', config.pricing.spreadPct + '%');

const rep = getReputation();
log('Reputation:', rep.total_orders, 'orders,', rep.completed, 'completed,', rep.disputes, 'disputes');

// Resolve agent address → relayNodeId (skip if not configured yet — setup guide will handle it)
try {
  await kanet.init();
  await updateQuote();
} catch {
  log('KANet not configured yet — open Dashboard to connect');
}

// Main loops
setInterval(updateQuote, config.pricing.updateIntervalSec * 1000);
setInterval(checkOrders, 5000);

// Start operator dashboard
startServer(() => ({
  connected: !!config.kanet.relayNodeId || !!config.kanet.agentAddress,
  agentName: config.kanet.agentName || '',
  quote: _currentQuote,
  kasBalance: _lastKasBalance,
  halted: risk.isHalted,
  haltReason: risk.haltReason,
  canSell: !risk.isHalted && _lastKasBalance >= config.risk.minKasReserve,
  canBuy: !risk.isHalted,
  activeOrders: getActiveOrders().length,
  config: { ...config.pricing, ...config.risk },
}));

log('Market Maker running. Ctrl+C to stop.');
