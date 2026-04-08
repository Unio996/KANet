/**
 * Skill: MM OTC — Market Maker OTC Order Management
 *
 * The only self-written skill for the KAS Market Maker Agent.
 * Everything else (pricing, exchange ops, cross-chain verify) uses existing tools:
 *   - CCXT for exchange data and hedging
 *   - Etherscan V2 / solscan / trongrid for cross-chain verification
 *   - ethers.js / tronweb / solana-web3 for USDT transfers
 *
 * This skill handles MM-specific business logic:
 *   - OTC order state machine (quote → payment → verify → deliver → complete)
 *   - Spread calculation on top of market price
 *   - Inventory tracking (KAS + multi-chain USDT balances)
 *   - Customer history and first-trade limits
 *   - Batch delivery management for large orders
 *   - Inventory deviation alerts (triggers hedging via existing PLACE_ORDER ACTION)
 *   - Quote broadcasting (proactive cycle)
 *
 * Protocol flow (buy KAS):
 *   1. User sees quote on broadcast channel (bcast protocol)
 *   2. User sends Kasia private message: "buy 2755 KAS paying 100 USDT on BNB"
 *   3. mm_otc activates (reactive), gathers inventory + pricing
 *   4. Brain understands intent, creates order via [ACTION:CREATE_MM_ORDER]
 *   5. User sends payment TX hash
 *   6. Brain triggers [ACTION:VERIFY_PAYMENT] → cross-chain verification
 *   7. Brain triggers [ACTION:SEND_KAS] → Relay transfer
 *   8. Order completed, reputation accumulates on-chain
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';
import ccxt from 'ccxt';

// ── Keywords ────────────────────────────────────────────────────────────────

const OTC_KEYWORDS = [
  // English
  'buy', 'sell', 'purchase', 'order', 'quote', 'price',
  'paying', 'usdt', 'swap', 'exchange', 'trade',
  // Chinese
  '买', '卖', '购买', '出售', '订单', '报价', '价格',
  '兑换', '交易',
];

// ── Skill Class ─────────────────────────────────────────────────────────────

export class MmOtcSkill extends Skill {
  constructor() {
    super('mm_otc', 'KAS Market Maker OTC — order management, quote broadcasting, batch delivery, inventory tracking');
    this._lastMessage = '';
    this._senderAddress = '';
  }

  canActivate(taskType, context) {
    if (taskType === 'proactive') {
      // Only activate if this agent has MM config (not all agents are market makers)
      return !!(context?.config?.mmConfig);
    }
    if (taskType === 'reactive') {
      const msg = (context._inputMessage || '').toLowerCase();
      this._lastMessage = context._inputMessage || '';
      this._senderAddress = context._senderAddress || '';
      // Phase 3: 识别 kanet 协议消息（accept/sell/buy）
      this._isProtocolMessage = false;
      try {
        const parsed = JSON.parse(context._inputMessage || '');
        if (parsed.type && parsed.type.startsWith('kanet_')) {
          this._isProtocolMessage = true;
          this._protocolData = parsed;
          return true;
        }
      } catch {}
      return OTC_KEYWORDS.some(k => msg.includes(k));
    }
    return false;
  }

  async gatherContext(kernels, config) {
    const consoleUrl = config.consoleUrl || 'http://localhost:3100';
    const mmConfig = config.mmConfig || {};

    const result = {
      // Pricing (from existing market data — will use CCXT when integrated)
      ticker: null,
      buyPrice: null,
      sellPrice: null,

      // Inventory
      kasBalance: null,
      // usdtBalances: null,  // TODO: multi-chain USDT via ethers/tronweb/solana

      // OTC state
      activeOrders: [],
      customerHistory: null,

      // Hedging signal
      deviation: null,
      needsRebalance: false,

      // BNB receive address (for customers to send USDT)
      bnbReceiveAddress: null,

      // Config
      spread: mmConfig.spreadPct || 0.0005,
      minKasReserve: mmConfig.minKasReserve || 1000,
      minUsdtReserve: mmConfig.minUsdtReserve || 100,
      targetKasBalance: mmConfig.targetKasBalance || 10000,
      rebalanceThreshold: mmConfig.rebalanceThreshold || 2000,
      maxPerTrade: mmConfig.maxPerTrade || 5000,
      newCustomerLimit: mmConfig.newCustomerLimit || 500,
      batchThresholdUsdt: mmConfig.batchThresholdUsdt || 50,

      error: null,
    };

    try {
      // ── Market price (via CCXT — 110+ exchanges, unified API) ────────
      const exchange = new ccxt.mexc();
      const ticker = await exchange.fetchTicker('KAS/USDT').catch(() => null);

      if (ticker?.last && ticker.last > 0) {
        result.ticker = {
          price: ticker.last,
          change24hPct: parseFloat((ticker.percentage || 0).toFixed(2)),
          volume24h: Math.round(ticker.quoteVolume || 0),
          high24h: ticker.high,
          low24h: ticker.low,
        };
        result.buyPrice = parseFloat((ticker.last * (1 - result.spread)).toFixed(6));
        result.sellPrice = parseFloat((ticker.last * (1 + result.spread)).toFixed(6));
      }

      // ── KAS balance ─────────────────────────────────────────────────────
      if (config.relayNodeId) {
        const bal = await fetchJson(
          `${consoleUrl}/api/relay/${encodeURIComponent(config.relayNodeId)}/balance`
        ).catch(() => null);
        if (bal?.balance != null) result.kasBalance = Number(bal.balance) || 0;
      }

      // ── Inventory deviation ─────────────────────────────────────────────
      if (result.kasBalance !== null) {
        result.deviation = result.kasBalance - result.targetKasBalance;
        result.needsRebalance = Math.abs(result.deviation) > result.rebalanceThreshold;
      }

      // ── Pause logic ─────────────────────────────────────────────────────
      if (result.kasBalance !== null && result.kasBalance < result.minKasReserve) {
        result.sellPrice = null;  // Can't sell, low KAS
      }

      // ── Active OTC orders ──────────────────────────────────────────────
      if (config.relayNodeId) {
        const pendingStatuses = ['published', 'accepted', 'paying', 'paid', 'verified', 'delivering'];
        for (const st of pendingStatuses) {
          const orders = await fetchJson(
            `${consoleUrl}/api/trade/mm-orders?status=${st}&relay_node_id=${encodeURIComponent(config.relayNodeId)}&limit=10`
          ).catch(() => []);
          if (Array.isArray(orders)) result.activeOrders.push(...orders);
        }
      }

      // ── BNB receive address (from mmConfig or env) ────────────────────
      result.bnbReceiveAddress = mmConfig.bnbReceiveAddress
        || process.env.MM_BNB_RECEIVE_ADDRESS
        || null;

      // ── Customer history ────────────────────────────────────────────────
      if (this._senderAddress) {
        const peerCtx = await fetchJson(
          `${consoleUrl}/api/agent/peer-context?my_address=${encodeURIComponent(config.address)}&peer_address=${encodeURIComponent(this._senderAddress)}&limit=5`
        ).catch(() => null);

        result.customerHistory = {
          address: this._senderAddress,
          interactionCount: peerCtx?.peer?.interactionCount || 0,
          trustLevel: peerCtx?.peer?.trustLevel || 'unknown',
          isNew: (peerCtx?.peer?.interactionCount || 0) === 0,
        };
      }

    } catch (err) {
      result.error = err.message;
    }

    return result;
  }

  formatForBrain(gathered) {
    const g = gathered;
    const sections = ['== MM OTC =='];

    // Pricing
    if (g.ticker) {
      sections.push(
        `Market: $${g.ticker.price} (${g.ticker.change24hPct > 0 ? '+' : ''}${g.ticker.change24hPct}% 24h)`,
        `OTC BUY: ${g.buyPrice ? '$' + g.buyPrice : 'PAUSED'} | OTC SELL: ${g.sellPrice ? '$' + g.sellPrice : 'PAUSED'}`,
        `Spread: ${(g.spread * 100).toFixed(2)}%`,
      );
    } else {
      sections.push('Market data unavailable');
    }

    // Inventory
    sections.push('');
    if (g.kasBalance !== null) {
      sections.push(`KAS stock: ${Number(g.kasBalance).toFixed(2)} KAS`);
    }

    // Hedging signal
    if (g.needsRebalance) {
      const action = g.deviation > 0 ? 'SELL excess on exchange' : 'BUY deficit on exchange';
      sections.push(`INVENTORY DEVIATION: ${g.deviation.toFixed(0)} KAS — ${action} via [ACTION:PLACE_ORDER]`);
    } else if (g.deviation !== null) {
      sections.push('Inventory balanced');
    }

    // BNB receive address
    if (g.bnbReceiveAddress) {
      sections.push(`BNB receive address: ${g.bnbReceiveAddress}`);
      sections.push('(Tell the customer this address when confirming a trade on BNB chain)');
    }

    // Active orders
    if (g.activeOrders.length > 0) {
      sections.push(`\nActive OTC orders: ${g.activeOrders.length}`);
      for (const o of g.activeOrders.slice(0, 5)) {
        sections.push(`  #${o.id?.slice(-8) || '?'}: ${o.side} ${o.kas_amount} KAS @ $${o.price} — status=${o.status} chain=${o.chain || '?'}`);
      }
    }

    // Customer info
    if (g.customerHistory) {
      const c = g.customerHistory;
      sections.push('');
      if (c.isNew) {
        sections.push(`NEW CUSTOMER (${c.address.slice(-12)}) — first-trade limit: ${g.newCustomerLimit} KAS`);
      } else {
        sections.push(`Customer ${c.address.slice(-12)}: ${c.interactionCount} interactions, trust: ${c.trustLevel}`);
      }
    }

    // Risk rules reminder
    sections.push(
      '',
      'Rules:',
      `  Max per trade: ${g.maxPerTrade} KAS`,
      `  New customer limit: ${g.newCustomerLimit} KAS`,
      `  Batch delivery: orders > $${g.batchThresholdUsdt} USDT`,
      '  Quotes via broadcast (bcast), orders via private message (comm)',
    );

    // Phase 3: 协议消息指导
    if (this._isProtocolMessage && this._protocolData) {
      const p = this._protocolData;
      sections.push('');
      sections.push('=== PROTOCOL MESSAGE RECEIVED ===');
      sections.push(`Type: ${p.type}`);
      if (p.type === 'kanet_accept_v1') {
        sections.push(`This peer wants to accept an order.`);
        sections.push(`Amount: ${p.amount || '?'} ${p.token || 'KAS'}, Chain: ${p.chain || 'bnb'}`);
        if (p.order_id) sections.push(`Order ID: ${p.order_id}`);
        sections.push('If the terms are acceptable, respond with [ACTION:ACCEPT_ORDER orderId=' + (p.order_id || 'ORDER_ID') + ']');
      } else if (p.type === 'kanet_buy_v1' || p.type === 'kanet_sell_v1') {
        sections.push(`Peer wants to ${p.type.includes('buy') ? 'buy' : 'sell'} ${p.amount || '?'} ${p.token || 'KAS'}`);
        sections.push(`Payment: ${p.pay || p.want || 'USDT'} on ${(p.chains || ['bnb']).join(', ')}`);
        sections.push('Create an order with [ACTION:CREATE_MM_ORDER side=... kasAmount=... price=... chain=...]');
      }
    }

    return {
      name: this.name,
      description: 'MM OTC order management and pricing',
      data: g,
      instructions: sections.join('\n'),
    };
  }
}
