/**
 * Skill: Trade Executor — smart order splitting & execution
 *
 * The Agent's trading ability. Reads orderbook, plans splits,
 * executes with time spacing via Console API.
 *
 * Architecture:
 *   Agent reads orderbook (public, no auth) → plans split → sends
 *   individual orders to Console → Console signs & forwards to exchange.
 *   Intelligence in Agent, execution in Console.
 *
 * Safety:
 *   - DRY-RUN by default (full simulation, no real orders)
 *   - Slippage ceiling — stops if price deviates too far from best
 *   - Per-trade and position limits from trading config
 *   - Order-by-order: if one fails, halt remaining
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

const CONSOLE_URL = process.env.CONSOLE_URL || 'http://localhost:3100';
const MEXC_BASE = 'https://api.mexc.com/api/v3';

// ── Orderbook (public, no credentials) ──────────────────────────────────────

async function fetchOrderbook(symbol = 'KASUSDT', limit = 50) {
  const data = await fetchJson(`${MEXC_BASE}/depth?symbol=${symbol}&limit=${limit}`);
  return {
    bids: (data.bids || []).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
    asks: (data.asks || []).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
  };
}

// ── Split Planner ───────────────────────────────────────────────────────────

/**
 * Plan order split based on orderbook depth.
 *
 * BUY eats asks (ascending price), SELL eats bids (descending price).
 * Each order takes at most `maxPctPerLevel` of that level's liquidity
 * to minimize market impact ("不惊动市场").
 *
 * @param {'BUY'|'SELL'} side
 * @param {number} totalQty - total KAS to trade
 * @param {object} orderbook - { bids, asks }
 * @param {object} options
 * @returns {object} { orders, remaining, summary }
 */
function planSplit(side, totalQty, orderbook, options = {}) {
  const {
    maxPctPerLevel = 0.4,   // take at most 40% of each level
    maxSlippagePct = 1.0,   // stop if price deviates >1% from best
    minOrderQty = 100,      // exchange minimum
  } = options;

  const levels = side === 'BUY' ? orderbook.asks : orderbook.bids;
  if (!levels?.length) return { orders: [], remaining: totalQty, summary: null };

  const bestPrice = levels[0].price;
  let remaining = totalQty;
  const orders = [];

  for (const level of levels) {
    if (remaining <= 0) break;

    const slippage = Math.abs(level.price - bestPrice) / bestPrice * 100;
    if (slippage > maxSlippagePct) break;

    const available = level.qty * maxPctPerLevel;
    let fillQty = Math.min(remaining, available);

    // Handle minimum order size
    if (fillQty < minOrderQty) {
      if (remaining >= minOrderQty) {
        fillQty = Math.min(minOrderQty, remaining);
      } else if (orders.length > 0) {
        orders[orders.length - 1].qty += remaining;
        remaining = 0;
        break;
      } else {
        break;
      }
    }

    orders.push({
      price: level.price,
      qty: Math.round(fillQty * 100) / 100,
      levelDepth: level.qty,
      takePct: Math.round(fillQty / level.qty * 100),
      slippagePct: Math.round(slippage * 10000) / 10000,
    });

    remaining -= fillQty;
  }

  const totalFilled = orders.reduce((s, o) => s + o.qty, 0);
  const avgPrice = totalFilled > 0
    ? orders.reduce((s, o) => s + o.price * o.qty, 0) / totalFilled
    : 0;
  const worstPrice = orders.at(-1)?.price || bestPrice;

  // Estimate saved vs naive market order (worst-price for all)
  const naiveCost = totalQty * worstPrice;
  const splitCost = orders.reduce((s, o) => s + o.price * o.qty, 0);
  const savedPct = naiveCost > 0 ? (naiveCost - splitCost) / naiveCost * 100 : 0;

  return {
    orders,
    remaining: Math.round(remaining * 100) / 100,
    summary: {
      totalRequested: totalQty,
      totalPlanned: Math.round(totalFilled * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      orderCount: orders.length,
      bestPrice,
      avgPrice: Math.round(avgPrice * 1e6) / 1e6,
      worstPrice,
      slippagePct: Math.round(Math.abs(worstPrice - bestPrice) / bestPrice * 10000) / 100,
      estimatedCostUsdt: Math.round(splitCost * 100) / 100,
      savedVsNaivePct: Math.round(savedPct * 100) / 100,
    },
  };
}

// ── Executor (time-spaced, via Console) ─────────────────────────────────────

/**
 * Execute a split plan by sending orders to Console one by one
 * with random time spacing.
 *
 * @param {'BUY'|'SELL'} side
 * @param {string} symbol
 * @param {Array} orders - from planSplit
 * @param {object} options
 * @returns {Promise<object>} execution result
 */
async function executeSplit(side, symbol, orders, options = {}) {
  const {
    dryRun = true,
    intervalMs = 500,
    jitterMs = 300,
  } = options;

  const results = [];
  let totalExecuted = 0;
  let totalCost = 0;
  const t0 = Date.now();

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];

    if (dryRun) {
      results.push({
        index: i + 1, price: o.price, qty: o.qty,
        costUsdt: Math.round(o.price * o.qty * 100) / 100,
        status: 'DRY-RUN', ok: true,
      });
      totalExecuted += o.qty;
      totalCost += o.price * o.qty;
    } else {
      try {
        const res = await fetchJson(`${CONSOLE_URL}/api/trade/order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol, side, type: 'LIMIT',
            price: o.price, qty: o.qty,
          }),
        });

        results.push({
          index: i + 1, price: o.price, qty: o.qty,
          costUsdt: Math.round(o.price * o.qty * 100) / 100,
          ...res,
        });

        if (res.ok) {
          totalExecuted += res.executedQty || o.qty;
          totalCost += o.price * (res.executedQty || o.qty);
        } else {
          // Order failed — stop, market may have moved
          results.push({ index: i + 1, aborted: true, reason: res.error });
          break;
        }
      } catch (err) {
        results.push({ index: i + 1, ok: false, error: err.message, aborted: true });
        break;
      }
    }

    // Time spacing with jitter (skip after last)
    if (i < orders.length - 1) {
      const delay = intervalMs + Math.floor(Math.random() * jitterMs);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return {
    ok: results.every(r => r.ok !== false),
    dryRun,
    ordersPlaced: results.filter(r => r.ok).length,
    ordersFailed: results.filter(r => r.ok === false).length,
    totalExecuted: Math.round(totalExecuted * 100) / 100,
    totalCostUsdt: Math.round(totalCost * 100) / 100,
    avgPrice: totalExecuted > 0 ? Math.round(totalCost / totalExecuted * 1e6) / 1e6 : 0,
    elapsedMs: Date.now() - t0,
    orders: results,
  };
}

// ── Skill Class ─────────────────────────────────────────────────────────────

const EXEC_KEYWORDS = [
  'buy', 'sell', 'order', 'execute', 'place', 'trade',
  '买', '卖', '买入', '卖出', '下单', '执行', '挂单', '交易',
  'cancel', '撤单', '撤销',
  'position', 'balance', '余额', '持仓',
  'split', '拆单', 'slippage', '滑点',
];

export class TradeExecutorSkill extends Skill {
  constructor() {
    super('trade_executor', 'Order execution only — place, check, cancel orders via ACTION protocol. Requires owner confirm or autonomous mode');
    this._lastMessage = '';
  }

  canActivate(taskType, context) {
    // Executor only activates on reactive (owner confirmed) or proactive (autonomous)
    // NOT on reflect — reflection uses trade-sense for self-assessment
    if (taskType === 'proactive') return true; // autonomous trading
    if (taskType !== 'reactive') return false;
    const msg = (context._inputMessage || '').toLowerCase();
    this._lastMessage = context._inputMessage || '';
    return EXEC_KEYWORDS.some(k => msg.includes(k));
  }

  async gatherContext(kernels, config) {
    const consoleUrl = config.consoleUrl || CONSOLE_URL;
    const symbol = 'KASUSDT';

    // Parallel: portfolio, trading config, mode, orderbook, open orders, my baseline, my trade history
    const relayId = config.relayNodeId || '';
    const [portfolio, configs, tradeMode, orderbook, openOrders, myBaseline, myTrades, myQuota] = await Promise.all([
      fetchJson(`${consoleUrl}/api/trade/portfolio`).catch(() => null),
      fetchJson(`${consoleUrl}/api/trade/config`).catch(() => null),
      fetchJson(`${consoleUrl}/api/trade/mode`).catch(() => null),
      fetchOrderbook(symbol, 50).catch(() => null),
      fetchJson(`${consoleUrl}/api/trade/open-orders?symbol=${symbol}`).catch(() => null),
      fetchJson(`${consoleUrl}/api/trade/baseline`).catch(() => null),
      fetchJson(`${consoleUrl}/api/trade/log?agent=${config.name}&days=7&limit=20`).catch(() => null),
      relayId ? fetchJson(`${consoleUrl}/api/trade/quota/${relayId}`).catch(() => null) : null,
    ]);

    const tradeConfig = Array.isArray(configs) && config.relayNodeId
      ? configs.find(c => c.id === config.relayNodeId) || configs[0]
      : null;

    const configured = !!(portfolio && portfolio.balances?.length > 0);
    const isLive = tradeMode?.mode === 'LIVE';

    // Analyze orderbook depth for the brain
    let depthAnalysis = null;
    if (orderbook?.asks?.length && orderbook?.bids?.length) {
      const bidDepth = orderbook.bids.slice(0, 20);
      const askDepth = orderbook.asks.slice(0, 20);
      const totalBidQty = bidDepth.reduce((s, l) => s + l.qty, 0);
      const totalAskQty = askDepth.reduce((s, l) => s + l.qty, 0);

      // Demo split plans — so the brain can see how splitting works
      const buyPlan = planSplit('BUY', 50000, orderbook);
      const sellPlan = planSplit('SELL', 50000, orderbook);

      depthAnalysis = {
        bestBid: bidDepth[0],
        bestAsk: askDepth[0],
        spread: Math.round((askDepth[0].price - bidDepth[0].price) / bidDepth[0].price * 10000) / 100,
        bidDepth20: Math.round(totalBidQty),
        askDepth20: Math.round(totalAskQty),
        bidLevels: bidDepth,
        askLevels: askDepth,
        buyPlanDemo: buyPlan.summary,
        sellPlanDemo: sellPlan.summary,
      };
    }

    return {
      mode: isLive ? 'LIVE' : 'DRY-RUN',
      exchange: portfolio?.exchange || 'unknown',
      configured,
      balances: portfolio?.balances || null,
      market: portfolio?.market || null,
      openOrders: Array.isArray(openOrders) ? openOrders : null,
      depthAnalysis,
      limits: {
        maxPerTrade: tradeConfig?.maxPerTrade ?? 10000,
        maxPositionPct: tradeConfig?.maxPositionPct ?? 20,
        dailyLossLimit: tradeConfig?.dailyLossLimit ?? 5,
        capital: tradeConfig?.capital ?? 0,
        baseCurrency: tradeConfig?.baseCurrency ?? 'USDT',
        strategy: tradeConfig?.strategy || '',
      },
      // My account & performance
      myAccount: Array.isArray(myBaseline)
        ? myBaseline.find(b => b.relayNodeId === relayId) || null
        : null,
      myTrades: Array.isArray(myTrades) ? myTrades : [],
      myQuota: myQuota || null,
    };
  }

  formatForBrain(gathered) {
    const sections = ['--- TRADE EXECUTION CAPABILITY ---'];
    const g = gathered;

    sections.push(
      `Mode: ${g.mode}${g.mode === 'DRY-RUN' ? ' (simulation only)' : ' (REAL ORDERS)'}`,
      `Exchange: ${g.exchange}`,
      `API: ${g.configured ? 'connected' : 'not configured'}`,
    );

    // Balances
    if (g.balances?.length > 0) {
      sections.push('', '--- ACCOUNT BALANCES ---');
      for (const b of g.balances) {
        sections.push(`  ${b.asset}: ${b.free} free, ${b.locked} locked`);
      }
    }

    // Open orders
    if (g.openOrders?.length > 0) {
      sections.push('', `--- OPEN ORDERS (${g.openOrders.length}) ---`);
      for (const o of g.openOrders) {
        sections.push(`  ${o.side} ${o.origQty} ${o.symbol} @ ${o.price} (${o.status})`);
      }
    } else if (g.configured) {
      sections.push('', 'No open orders.');
    }

    // Orderbook depth analysis
    if (g.depthAnalysis) {
      const d = g.depthAnalysis;
      sections.push(
        '',
        '--- ORDERBOOK DEPTH ---',
        `Best bid: ${d.bestBid.price} (${d.bestBid.qty} KAS)`,
        `Best ask: ${d.bestAsk.price} (${d.bestAsk.qty} KAS)`,
        `Spread: ${d.spread}%`,
        `Total bid depth: ${d.bidDepth20.toLocaleString()} KAS`,
        `Total ask depth: ${d.askDepth20.toLocaleString()} KAS`,
        '',
        'BID levels (for SELL):',
      );
      for (const l of d.bidLevels.slice(0, 10)) {
        sections.push(`  ${l.price} | ${l.qty} KAS`);
      }
      sections.push('', 'ASK levels (for BUY):');
      for (const l of d.askLevels.slice(0, 10)) {
        sections.push(`  ${l.price} | ${l.qty} KAS`);
      }

      if (d.buyPlanDemo) {
        const b = d.buyPlanDemo;
        sections.push(
          '',
          '--- SPLIT PLAN PREVIEW (50K KAS) ---',
          `BUY 50,000 KAS → ${b.orderCount} orders, avg ${b.avgPrice}, slippage ${b.slippagePct}%`,
          `  Planned: ${b.totalPlanned} KAS | Remaining: ${b.remaining} KAS`,
          `  Cost: $${b.estimatedCostUsdt} | Saved vs market: ${b.savedVsNaivePct}%`,
        );
      }
      if (d.sellPlanDemo) {
        const s = d.sellPlanDemo;
        sections.push(
          `SELL 50,000 KAS → ${s.orderCount} orders, avg ${s.avgPrice}, slippage ${s.slippagePct}%`,
          `  Planned: ${s.totalPlanned} KAS | Remaining: ${s.remaining} KAS`,
          `  Revenue: $${s.estimatedCostUsdt} | Saved vs market: ${s.savedVsNaivePct}%`,
        );
      }
    }

    // My virtual account
    const acct = g.myAccount;
    if (acct) {
      sections.push(
        '',
        '--- MY VIRTUAL ACCOUNT ---',
        `Baseline: ${acct.baseline?.equivalentKas?.toLocaleString()} KAS (set ${acct.baseline?.createdAt?.slice(0, 10)})`,
        `Current holdings: ${acct.current?.kas || 0} KAS + $${acct.current?.usdt || 0} USDT`,
        `Equivalent KAS: ${acct.current?.equivalentKas?.toLocaleString() || '--'}`,
        `P&L: ${acct.pnl?.kas >= 0 ? '+' : ''}${acct.pnl?.kas || 0} KAS (${acct.pnl?.pct >= 0 ? '+' : ''}${acct.pnl?.pct || 0}%)`,
        `Risk status: ${acct.risk?.status || 'unknown'}`,
      );
      if (acct.risk?.lossAlert) sections.push('⚠ WARNING: approaching loss limit!');
      if (acct.risk?.hardStop) sections.push('🛑 HARD STOP: loss limit breached — DO NOT trade!');
    }

    // My recent trades
    if (g.myTrades?.length > 0) {
      sections.push('', '--- MY RECENT TRADES ---');
      for (const t of g.myTrades.slice(0, 10)) {
        sections.push(`  ${t.created_at?.slice(5, 16)} ${t.side} ${t.qty} KAS @ $${t.price} ($${t.cost_usdt?.toFixed(2)})`);
      }
      // Simple self-assessment
      const buys = g.myTrades.filter(t => t.side === 'BUY');
      const sells = g.myTrades.filter(t => t.side === 'SELL');
      if (buys.length > 0) {
        const avgBuy = buys.reduce((s, t) => s + t.price, 0) / buys.length;
        sections.push(`  Avg buy price: $${avgBuy.toFixed(6)} (${buys.length} trades)`);
      }
      if (sells.length > 0) {
        const avgSell = sells.reduce((s, t) => s + t.price, 0) / sells.length;
        sections.push(`  Avg sell price: $${avgSell.toFixed(6)} (${sells.length} trades)`);
      }
    } else {
      sections.push('', 'No trades yet — this is my starting point.');
    }

    // Daily quota
    if (g.myQuota) {
      sections.push(
        '',
        '--- TODAY\'S QUOTA ---',
        `Trades today: ${g.myQuota.today?.trades || 0}`,
        `Volume today: ${g.myQuota.today?.volumeKas || 0} KAS`,
        g.myQuota.remaining?.capitalLeft != null ? `Remaining capital: ${g.myQuota.remaining.capitalLeft} KAS` : '',
        g.myQuota.remaining?.canTrade === false ? '🛑 CANNOT TRADE: ' + g.myQuota.remaining.reason : '',
      );
    }

    // Safety limits
    sections.push(
      '',
      '--- SAFETY LIMITS ---',
      `Capital: ${g.limits.capital} ${g.limits.baseCurrency}`,
      `Max per trade: ${g.limits.maxPerTrade} ${g.limits.baseCurrency}`,
      `Max position: ${g.limits.maxPositionPct}%`,
      `Daily loss limit: ${g.limits.dailyLossLimit} ${g.limits.baseCurrency}`,
      g.limits.strategy ? `Strategy: ${g.limits.strategy}` : '',
    );

    // Execution instructions
    sections.push(
      '',
      '--- SMART ORDER EXECUTION ---',
      'You have ORDER SPLITTING capability.',
      'When the owner wants to buy or sell a large amount:',
      '1. Check orderbook depth (provided above)',
      '2. Recommend splitting into multiple smaller limit orders',
      '3. Each order takes ≤40% of that price level\'s liquidity',
      '4. Orders are spaced 500-800ms apart to minimize market impact',
      '5. If depth is insufficient, only fill what\'s available and report',
      '',
      '--- EXECUTION RULES ---',
    );

    // Available actions
    sections.push(
      '',
      '--- AVAILABLE ACTIONS ---',
      'You can EXECUTE actions by including action tags in your response.',
      'The system will execute them and send you the results. You then decide the next step.',
      '',
      'Actions:',
      '  [ACTION:PLACE_ORDER side=SELL qty=500 price=0.038 symbol=KASUSDT]',
      '  [ACTION:CHECK_ORDER orderId=xxx symbol=KASUSDT]',
      '  [ACTION:CANCEL_ORDER orderId=xxx symbol=KASUSDT]',
      '  [ACTION:READ_ORDERBOOK symbol=KASUSDT limit=20]',
      '  [ACTION:CHECK_OPEN_ORDERS symbol=KASUSDT]',
      '  [ACTION:CANCEL_ALL_ORDERS symbol=KASUSDT]',
      '  [ACTION:WAIT ms=3000]',
      '',
      'EXECUTION FLOW for a large order:',
      '1. READ_ORDERBOOK to see current depth',
      '2. Plan your split based on depth (each order ≤40% of that level)',
      '3. PLACE_ORDER for each slice (include multiple in one response)',
      '4. WAIT ms=5000',
      '5. CHECK_OPEN_ORDERS to see what filled vs still pending',
      '6. CANCEL unfilled orders if price moved',
      '7. READ_ORDERBOOK again (prices may have changed)',
      '8. Re-plan for remaining quantity at new prices',
      '9. Repeat until fully filled or you decide to stop',
      '',
      'You can include MULTIPLE actions in one response. They execute in order.',
      'After execution, you receive results and decide the next step.',
      'You are the decision-maker. Adjust strategy based on what you see.',
      '',
    );

    if (g.mode === 'DRY-RUN') {
      sections.push(
        '--- MODE: DRY-RUN ---',
        'Actions will be SIMULATED. No real orders placed.',
        'When the owner asks to buy or sell:',
        '1. Use [ACTION:READ_ORDERBOOK] to get depth.',
        '2. Present your split plan with reasoning.',
        '3. Do NOT use PLACE_ORDER — only analyze.',
        '4. State clearly this is a SIMULATION.',
      );
    } else {
      sections.push(
        '--- MODE: LIVE ---',
        'Actions will place REAL ORDERS with real money.',
        '',
        'CRITICAL RULE: When owner asks to buy or sell via chat:',
        '1. Use [ACTION:READ_ORDERBOOK] to analyze depth.',
        '2. Present your split plan with reasoning.',
        '3. *** DO NOT place orders. ***',
        '4. Say: "方案已就绪，请点击确认执行按钮。"',
        '5. The owner will click the Execute button in the UI to confirm.',
        '6. ONLY place orders when you receive an explicit "[EXECUTE_CONFIRMED]" signal.',
        '',
        'You may ONLY use PLACE_ORDER when:',
        '  a) You receive "[EXECUTE_CONFIRMED]" from the system, OR',
        '  b) You are in autonomous proactive mode (not responding to chat)',
      );
    }

    sections.push(
      '',
      'FORMAT your split plan like this:',
      '  拆单方案: [BUY/SELL] [total] KAS',
      '  共 N 笔 | 均价 $X.XXXXX | 滑点 X.XX%',
      '  #1: XXXX KAS @ $X.XXXXX (吃该档 XX%)',
      '  ...',
      '  预计成本/收入: $XXXX',
    );

    return {
      name: this.name,
      description: this.description,
      data: {
        mode: g.mode,
        configured: g.configured,
        hasDepth: !!g.depthAnalysis,
        openOrderCount: g.openOrders?.length || 0,
      },
      instructions: sections.filter(Boolean).join('\n'),
    };
  }
}

// Export split utilities for potential direct use
export { planSplit, executeSplit, fetchOrderbook };
