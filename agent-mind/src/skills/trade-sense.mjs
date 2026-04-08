/**
 * Skill: Trade Sense — market intelligence for trading decisions
 *
 * The "living" skill — what this provides directly determines trading quality.
 * Mind receives digested intelligence, not raw data.
 *
 * Four layers:
 *   L1 — Raw Data:     price, volume, orderbook depth, klines
 *   L2 — Signals:      trend direction, volatility, momentum, support/resistance
 *   L3 — Portfolio:    current positions, P&L, risk exposure
 *   L4 — Owner Intent: capital, target return, risk tolerance, time horizon
 *
 * Exchange-agnostic framework. First implementation: MEXC public API (no key needed).
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

// ── Exchange Adapters ───────────────────────────────────────────────────────

const EXCHANGES = {
  mexc: {
    name: 'MEXC',
    baseUrl: 'https://api.mexc.com/api/v3',
    async getPrice(symbol) {
      const data = await fetchJson(`${this.baseUrl}/ticker/price?symbol=${symbol}`);
      return parseFloat(data.price);
    },
    async getTicker24h(symbol) {
      const data = await fetchJson(`${this.baseUrl}/ticker/24hr?symbol=${symbol}`);
      return {
        price: parseFloat(data.lastPrice),
        high24h: parseFloat(data.highPrice),
        low24h: parseFloat(data.lowPrice),
        volume24h: parseFloat(data.volume),
        quoteVolume24h: parseFloat(data.quoteVolume),
        change24hPct: parseFloat(data.priceChangePercent),
      };
    },
    async getKlines(symbol, interval = '60m', limit = 24) {
      const data = await fetchJson(`${this.baseUrl}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      return data.map(k => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
    },
    async getDepth(symbol, limit = 50) {
      const data = await fetchJson(`${this.baseUrl}/depth?symbol=${symbol}&limit=${limit}`);
      return {
        bids: (data.bids || []).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
        asks: (data.asks || []).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
      };
    },
  },
};

// ── Split Planning ──────────────────────────────────────────────────────────

function planSplit(side, totalQty, orderbook, options = {}) {
  const { maxPctPerLevel = 0.4, maxSlippagePct = 1.0, minOrderQty = 100 } = options;
  const levels = side === 'BUY' ? orderbook.asks : orderbook.bids;
  if (!levels?.length) return null;

  const bestPrice = levels[0].price;
  let remaining = totalQty;
  const orders = [];

  for (const level of levels) {
    if (remaining <= 0) break;
    const slippage = Math.abs(level.price - bestPrice) / bestPrice * 100;
    if (slippage > maxSlippagePct) break;
    let fillQty = Math.min(remaining, level.qty * maxPctPerLevel);
    if (fillQty < minOrderQty && remaining >= minOrderQty) fillQty = Math.min(minOrderQty, remaining);
    else if (fillQty < minOrderQty) {
      if (orders.length > 0) { orders[orders.length - 1].qty += remaining; remaining = 0; break; }
      break;
    }
    orders.push({ price: level.price, qty: Math.round(fillQty * 100) / 100, takePct: Math.round(fillQty / level.qty * 100) });
    remaining -= fillQty;
  }

  if (!orders.length) return null;
  const totalFilled = orders.reduce((s, o) => s + o.qty, 0);
  const avgPrice = orders.reduce((s, o) => s + o.price * o.qty, 0) / totalFilled;
  return {
    orderCount: orders.length,
    totalPlanned: Math.round(totalFilled * 100) / 100,
    remaining: Math.round(remaining * 100) / 100,
    avgPrice: Math.round(avgPrice * 1e6) / 1e6,
    bestPrice,
    worstPrice: orders.at(-1)?.price || bestPrice,
    slippagePct: Math.round(Math.abs((orders.at(-1)?.price || bestPrice) - bestPrice) / bestPrice * 10000) / 100,
    orders,
  };
}

// ── Signal Processing (L2) ──────────────────────────────────────────────────

function computeSignals(klines) {
  if (!klines || klines.length < 5) return null;

  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const latest = closes[closes.length - 1];

  // Simple Moving Averages
  const sma7 = avg(closes.slice(-7));
  const sma25 = closes.length >= 25 ? avg(closes.slice(-25)) : null;

  // Trend direction
  const shortTrend = latest > sma7 ? 'up' : latest < sma7 ? 'down' : 'flat';
  const longTrend = sma25 !== null ? (sma7 > sma25 ? 'bullish' : sma7 < sma25 ? 'bearish' : 'neutral') : null;

  // Volatility (standard deviation of returns)
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const volatility = stddev(returns);
  const volatilityLevel = volatility > 0.03 ? 'high' : volatility > 0.01 ? 'medium' : 'low';

  // Momentum (Rate of Change over last 6 periods)
  const roc6 = closes.length >= 7
    ? ((latest - closes[closes.length - 7]) / closes[closes.length - 7]) * 100
    : null;

  // Volume trend
  const recentVol = avg(volumes.slice(-3));
  const olderVol = avg(volumes.slice(-6, -3));
  const volumeTrend = olderVol > 0 ? (recentVol > olderVol * 1.5 ? 'surging' : recentVol > olderVol * 1.1 ? 'rising' : recentVol < olderVol * 0.7 ? 'declining' : 'stable') : 'unknown';

  // Support / Resistance (simple: recent lows/highs)
  const recentHighs = klines.slice(-12).map(k => k.high);
  const recentLows = klines.slice(-12).map(k => k.low);
  const resistance = Math.max(...recentHighs);
  const support = Math.min(...recentLows);

  return {
    shortTrend,
    longTrend,
    sma7: round4(sma7),
    sma25: sma25 !== null ? round4(sma25) : null,
    volatility: round4(volatility * 100),
    volatilityLevel,
    momentum: roc6 !== null ? round4(roc6) : null,
    volumeTrend,
    support: round4(support),
    resistance: round4(resistance),
    distToResistance: round4(((resistance - latest) / latest) * 100),
    distToSupport: round4(((latest - support) / latest) * 100),
  };
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length);
}
function round4(n) { return Math.round(n * 10000) / 10000; }

// ── Chain Intelligence (L3) — our unique edge ─────────────────────────────

function analyzeChainForTrading(chainActivity) {
  const profiles = chainActivity.profiles || [];
  const handshakes = chainActivity.handshakes || [];
  const stats = chainActivity.stats || {};

  // Ecosystem size and growth
  const totalPeers = profiles.length;
  const totalInteractions = stats.total_interactions || 0;
  const totalHandshakes = stats.total_handshakes || 0;

  // Active agents (those with Agent Cards = real KANet participants)
  const agentsWithCards = profiles.filter(p => p.card_mode);

  // Recent activity concentration — are a few wallets dominating?
  const top5Activity = profiles.slice(0, 5).reduce((sum, p) => sum + (p.total || 0), 0);
  const activityConcentration = totalInteractions > 0
    ? round4(top5Activity / totalInteractions)
    : 0;

  // High-frequency addresses (potential whales or bots)
  const highFreq = profiles.filter(p => (p.freq_per_hour || 0) > 2);

  // Network health signal
  // More peers + more interactions + more handshakes = healthier ecosystem = bullish
  let ecosystemHealth = 'unknown';
  if (totalPeers >= 20 && totalHandshakes >= 30) ecosystemHealth = 'strong';
  else if (totalPeers >= 10 && totalHandshakes >= 10) ecosystemHealth = 'growing';
  else if (totalPeers >= 3) ecosystemHealth = 'early';
  else ecosystemHealth = 'nascent';

  // New participants (recently appeared, high recent activity)
  const newActive = profiles.filter(p => {
    if (!p.first_active || !p.last_active) return false;
    const firstActive = new Date(p.first_active).getTime();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return firstActive > dayAgo && (p.total || 0) >= 2;
  });

  return {
    ecosystemHealth,
    totalPeers,
    totalInteractions,
    totalHandshakes,
    agentCount: agentsWithCards.length,
    activityConcentration,
    highFreqAddresses: highFreq.length,
    newParticipants24h: newActive.length,
    // Trading interpretation
    signal: ecosystemHealth === 'strong' ? 'bullish'
      : ecosystemHealth === 'growing' ? 'slightly-bullish'
      : 'neutral',
  };
}

// ── Owner Intent (L4) ──────────────────────────────────────────────────────

function parseOwnerIntent(goals) {
  // Extract trading-related goals from Intent Kernel
  const tradingGoals = (goals || []).filter(g => {
    const text = (g.text || '').toLowerCase();
    return text.match(/trade|trading|invest|profit|capital|return|risk|buy|sell|market|portfolio/i);
  });

  if (tradingGoals.length === 0) return null;

  return {
    goals: tradingGoals.map(g => ({
      text: g.text,
      priority: g.priority || 5,
    })),
    summary: tradingGoals.map(g => g.text).join('; '),
  };
}

// ── Skill Class ─────────────────────────────────────────────────────────────

const TRADE_KEYWORDS = [
  'trade', 'trading', 'buy', 'sell', 'price', 'market', 'position',
  'profit', 'loss', 'portfolio', 'order', 'exchange', 'invest',
  'kas', 'usdt', 'btc', 'eth', 'kline', 'candle', 'chart',
  '交易', '买', '卖', '价格', '行情', '持仓', '盈亏', '下单', '市场',
  'bull', 'bear', 'trend', 'volume', 'support', 'resistance',
  'dip', 'pump', 'dump', 'moon', 'signal',
];

export class TradeSenseSkill extends Skill {
  constructor() {
    super('trade_sense', 'Market analysis, orderbook depth, split planning, account P&L —看和想, never places orders');
    this._lastMessage = '';
  }

  canActivate(taskType, context) {
    if (taskType === 'reflect') return true; // reflect: review my trading performance
    const msg = (context._inputMessage || '').toLowerCase();
    this._lastMessage = context._inputMessage || '';

    // Always active for proactive (check market periodically)
    if (taskType === 'proactive') return true;

    return TRADE_KEYWORDS.some(k => msg.includes(k));
  }

  async gatherContext(kernels, config) {
    const exchange = EXCHANGES.mexc; // Default exchange
    const symbol = 'KASUSDT';        // Primary pair
    const consoleUrl = config.consoleUrl || 'http://localhost:3100';

    // ── New path: fetch computed signals + proposal from Console ──
    let signalAnalysis = null;
    let tradeProposal = null;
    try {
      const [sigRes, propRes] = await Promise.all([
        fetchJson(`${consoleUrl}/api/trade/signals`).catch(() => null),
        fetchJson(`${consoleUrl}/api/trade/proposal`).catch(() => null),
      ]);
      signalAnalysis = sigRes;
      tradeProposal = propRes?.proposal || null;
    } catch {}

    const result = {
      exchange: exchange.name,
      symbol,
      ticker: null,
      signals: null,
      depth: null,
      chainIntel: null,
      kaspaChain: null,
      tradingConfig: null,
      ownerIntent: null,
      error: null,
      // New: signal-engine + strategy-engine output
      signalAnalysis,
      tradeProposal,
    };

    try {
      // L1: Raw market data + L3: Chain intelligence + trading config (parallel fetch)
      const [ticker, klines, depth, chainActivity, tradeConfigs, kaspaChain, chainFundamentals, whaleActivity, whaleAlerts, portfolio] = await Promise.all([
        exchange.getTicker24h(symbol).catch(() => null),
        exchange.getKlines(symbol, '60m', 48).catch(() => null),
        exchange.getDepth(symbol, 10).catch(() => null),
        fetchJson(`${consoleUrl}/api/discovery/activity?limit=100`).catch(() => null),
        fetchJson(`${consoleUrl}/api/trade/config`).catch(() => null),
        fetchJson(`${consoleUrl}/api/chain/stats`).catch(() => null),
        fetchJson(`${consoleUrl}/api/chain/fundamentals`).catch(() => null),
        fetchJson(`${consoleUrl}/api/chain/whale-activity`).catch(() => null),
        fetchJson(`${consoleUrl}/api/chain/whale-alerts?limit=10`).catch(() => null),
        fetchJson(`${consoleUrl}/api/trade/portfolio`).catch(() => null),
      ]);

      // Find this agent's trading config
      if (tradeConfigs && config.relayNodeId) {
        result.tradingConfig = tradeConfigs.find(c => c.id === config.relayNodeId) || null;
      }

      result.ticker = ticker;
      result.portfolio = portfolio;

      // Depth analysis + split plans
      if (depth?.bids?.length && depth?.asks?.length) {
        const bidDepth = depth.bids.slice(0, 20);
        const askDepth = depth.asks.slice(0, 20);
        result.depth = {
          bestBid: bidDepth[0], bestAsk: askDepth[0],
          spread: Math.round((askDepth[0].price - bidDepth[0].price) / bidDepth[0].price * 10000) / 100,
          bidDepth: Math.round(bidDepth.reduce((s, l) => s + l.qty, 0)),
          askDepth: Math.round(askDepth.reduce((s, l) => s + l.qty, 0)),
          bidLevels: bidDepth, askLevels: askDepth,
        };
        // Demo split plans for Brain to reference
        result.splitPlanBuy = planSplit('BUY', 50000, depth);
        result.splitPlanSell = planSplit('SELL', 50000, depth);
      } else {
        result.depth = depth;
      }

      // L2: Signal processing
      if (klines) {
        result.signals = computeSignals(klines);
      }

      // L3a: KANet social intelligence
      if (chainActivity) {
        result.chainIntel = analyzeChainForTrading(chainActivity);
      }

      // L3b: Kaspa chain fundamentals (social + blockchain)
      if (kaspaChain) {
        result.kaspaChain = kaspaChain;
      }

      // L3c: Kaspa blockchain fundamentals (hashrate, supply, DAG — from Scout)
      if (chainFundamentals?.available) {
        result.chainFundamentals = chainFundamentals;
      }

      // L3d: Whale + exchange balance tracking (from Scout balance-tracker)
      if (whaleActivity?.summary) {
        result.whaleActivity = whaleActivity;
      }

      // L3e: Real-time whale alerts (from Scout whale-alert)
      if (Array.isArray(whaleAlerts) && whaleAlerts.length > 0) {
        result.whaleAlerts = whaleAlerts;
      }
    } catch (err) {
      result.error = err.message;
    }

    // L4: Owner intent (from goals)
    try {
      const intentCtx = await kernels.intent.buildIntentContext();
      result.ownerIntent = parseOwnerIntent(intentCtx.currentGoals);
    } catch {}

    // L5: My account & trade history (self-awareness for trading)
    const consoleUrl2 = config.consoleUrl || 'http://localhost:3100';
    try {
      const [myBaseline, myTrades, performance7d] = await Promise.all([
        fetchJson(`${consoleUrl2}/api/trade/baseline`).catch(() => null),
        fetchJson(`${consoleUrl2}/api/trade/log?agent=${config.name}&days=7&limit=20`).catch(() => null),
        fetchJson(`${consoleUrl2}/api/trade/performance?days=7`).catch(() => null),
      ]);
      if (Array.isArray(myBaseline)) {
        result.myAccount = myBaseline.find(b => b.relayNodeId === config.relayNodeId) || null;
      }
      result.myTrades = Array.isArray(myTrades) ? myTrades : [];
      // Performance summary for this agent
      if (Array.isArray(performance7d)) {
        result.myPerformance = performance7d.find(p => p.agent === config.name) || null;
      }
    } catch {}

    return result;
  }

  formatForBrain(gathered) {
    // ── New: Proposal mode — Brain only approves/rejects, doesn't freestyle ──
    if (gathered.tradeProposal) {
      const p = gathered.tradeProposal;
      const rc = p.riskCheck || {};
      const riskLines = p.anchor === 'kas'
        ? `KAS at risk: ${rc.kasAtRisk || 'N/A'}\nUSDT deployed: ${rc.usdtDeployed || 'N/A'}\nTarget buyback: ${rc.targetBuyback || 'N/A'}\nNet KAS gain: ${rc.netKasGain || 'N/A'}\nDaily: ${rc.dailyUsed || 'N/A'}`
        : `Position: ${rc.positionPct || 'N/A'} of portfolio\nMax loss: ${rc.maxLoss || 'N/A'}\nDaily: ${rc.dailyUsed || 'N/A'}`;

      return {
        name: this.name,
        description: 'Trade proposal — Brain approval mode',
        data: gathered,
        instructions: `=== TRADING PROPOSAL ===
Strategy: ${p.strategyName}
Anchor: ${p.anchor === 'kas' ? '本币锚（目标增持KAS）' : '法币锚（目标增值USDT）'}
Signal: ${p.signal?.composite}/100 (confidence ${Math.round((p.signal?.confidence || 0) * 100)}%)
Regime: ${p.regime} (ADX=${p.adx})
Action: ${p.action.toUpperCase()} ${p.params?.amount} KAS @ $${p.params?.price}
${p.params?.stopLoss ? 'Stop-loss: $' + p.params.stopLoss : 'Stop-loss: none (本币锚不设)'}
${p.params?.takeProfit ? 'Take-profit: $' + p.params.takeProfit : 'Take-profit: none'}
Reason: ${p.params?.reason}

Risk Assessment:
${riskLines}

YOUR TASK:
Accept or reject this proposal.
If reject, explain why in one sentence.
Do NOT modify parameters. Do NOT invent your own trade.
Most proposals should be ACCEPTED unless you see an obvious problem
the signal layer cannot detect (breaking news, extreme event, logical error).

Reply format:
[ACTION:PLACE_ORDER side=${p.action} amount=${p.params?.amount} price=${p.params?.price} market=exchange]
or
Do nothing — REJECT: [one sentence reason]`,
      };
    }

    // ── No proposal: show market status, do NOT encourage trading ──
    if (gathered.signalAnalysis && !gathered.signalAnalysis.actionable) {
      const a = gathered.signalAnalysis;
      return {
        name: this.name,
        description: 'Market status — no actionable signal',
        data: gathered,
        instructions: `=== MARKET STATUS: NO ACTIONABLE SIGNAL ===
Composite: ${a.composite}/100 | Confidence: ${a.confidence}
Regime: ${a.regime} (ADX=${a.adx})
Signals: trend=${a.signals?.trend} momentum=${a.signals?.momentum} orderFlow=${a.signals?.orderFlow} whale=${a.signals?.whale}
Volatility: ${a.signals?.volatility}/100

Signal below threshold (60). Do not trade.
Focus on other tasks: social outreach, learning, observation.
If owner asks about market, share the signal data above.`,
      };
    }

    // ── Fallback: original market intelligence format (backward compat) ──
    const sections = ['--- MARKET INTELLIGENCE ---'];

    // Ticker
    const t = gathered.ticker;
    if (t) {
      sections.push(
        `Exchange: ${gathered.exchange} | Pair: ${gathered.symbol}`,
        `Price: ${t.price} USDT`,
        `24h Change: ${t.change24hPct > 0 ? '+' : ''}${t.change24hPct}%`,
        `24h Range: ${t.low24h} — ${t.high24h}`,
        `24h Volume: ${Math.round(t.quoteVolume24h).toLocaleString()} USDT`,
      );
    }

    // Signals
    const s = gathered.signals;
    if (s) {
      sections.push(
        '',
        '--- SIGNALS ---',
        `Short trend (7h): ${s.shortTrend} | SMA7: ${s.sma7}`,
        s.longTrend ? `Long trend (25h): ${s.longTrend} | SMA25: ${s.sma25}` : '',
        `Volatility: ${s.volatilityLevel} (${s.volatility}%)`,
        s.momentum !== null ? `Momentum (6h ROC): ${s.momentum > 0 ? '+' : ''}${s.momentum}%` : '',
        `Volume trend: ${s.volumeTrend}`,
        `Support: ${s.support} (${s.distToSupport}% away)`,
        `Resistance: ${s.resistance} (${s.distToResistance}% away)`,
      );
    }

    // Order book depth + split planning
    const d = gathered.depth;
    if (d?.bestBid && d?.bestAsk) {
      sections.push(
        '',
        '--- ORDER BOOK DEPTH ---',
        `Best bid: ${d.bestBid.price} (${d.bestBid.qty} KAS)`,
        `Best ask: ${d.bestAsk.price} (${d.bestAsk.qty} KAS)`,
        `Spread: ${d.spread}%`,
        `Total bid depth: ${d.bidDepth?.toLocaleString()} KAS`,
        `Total ask depth: ${d.askDepth?.toLocaleString()} KAS`,
      );
      // Show levels for split planning
      if (d.bidLevels?.length) {
        sections.push('', 'BID levels (for SELL split):');
        for (const l of d.bidLevels.slice(0, 10)) sections.push(`  ${l.price} | ${l.qty} KAS`);
      }
      if (d.askLevels?.length) {
        sections.push('', 'ASK levels (for BUY split):');
        for (const l of d.askLevels.slice(0, 10)) sections.push(`  ${l.price} | ${l.qty} KAS`);
      }
      // Demo split plans
      if (gathered.splitPlanBuy) {
        const b = gathered.splitPlanBuy;
        sections.push('', `SPLIT PLAN (BUY 50K): ${b.orderCount} orders, avg $${b.avgPrice}, slippage ${b.slippagePct}%`);
      }
      if (gathered.splitPlanSell) {
        const s = gathered.splitPlanSell;
        sections.push(`SPLIT PLAN (SELL 50K): ${s.orderCount} orders, avg $${s.avgPrice}, slippage ${s.slippagePct}%`);
      }
    } else if (d?.bids?.length) {
      // Fallback for old format
      sections.push('', '--- ORDER BOOK ---',
        `Best bid: ${d.bids[0].price}`, `Best ask: ${d.asks?.[0]?.price || '--'}`);
    }

    // My account (self-awareness)
    if (gathered.myAccount) {
      const a = gathered.myAccount;
      sections.push(
        '',
        '--- MY TRADING ACCOUNT ---',
        `Holdings: ${a.current?.kas || 0} KAS + $${a.current?.usdt || 0} USDT`,
        `Equivalent: ${a.current?.equivalentKas?.toLocaleString() || '--'} KAS`,
        `P&L: ${(a.pnl?.kas >= 0 ? '+' : '') + (a.pnl?.kas || 0)} KAS (${(a.pnl?.pct >= 0 ? '+' : '') + (a.pnl?.pct || 0)}%)`,
        `Status: ${a.risk?.status || '--'}`,
      );
    }
    if (gathered.myTrades?.length > 0) {
      sections.push('', 'Recent trades:');
      for (const t of gathered.myTrades.slice(0, 5)) {
        sections.push(`  ${t.created_at?.slice(5, 16)} ${t.side} ${t.qty} KAS @ $${t.price}`);
      }
    }

    // Performance summary (7-day aggregate)
    const perf = gathered.myPerformance;
    if (perf && perf.trades > 0) {
      sections.push(
        '',
        '--- 7-DAY TRADING PERFORMANCE ---',
        `Total trades: ${perf.trades}`,
        `Bought: ${perf.bought.qty} KAS ($${perf.bought.usdt}) avg $${perf.bought.avgPrice}`,
        `Sold: ${perf.sold.qty} KAS ($${perf.sold.usdt}) avg $${perf.sold.avgPrice}`,
        `Net P&L: ${perf.net.kas >= 0 ? '+' : ''}${perf.net.kas} KAS / ${perf.net.usdt >= 0 ? '+' : ''}$${perf.net.usdt} USDT`,
      );
      // Win rate analysis from recent trades
      if (gathered.myTrades?.length >= 2) {
        const sells = gathered.myTrades.filter(t => t.side === 'SELL');
        const buys = gathered.myTrades.filter(t => t.side === 'BUY');
        if (sells.length > 0 && buys.length > 0) {
          const avgSell = sells.reduce((s, t) => s + parseFloat(t.price), 0) / sells.length;
          const avgBuy = buys.reduce((s, t) => s + parseFloat(t.price), 0) / buys.length;
          const spreadPct = ((avgSell - avgBuy) / avgBuy * 100).toFixed(2);
          sections.push(
            `Avg sell price vs avg buy price spread: ${spreadPct}% (need >0.2% to profit after fees)`,
          );
        }
      }
      sections.push(
        '',
        'REFLECT ON THIS: What patterns led to wins? What led to losses?',
        'Should you adjust position sizing, timing, or signal thresholds?',
      );
    } else {
      sections.push(
        '',
        '--- 7-DAY TRADING PERFORMANCE ---',
        'No trades executed in the last 7 days.',
        'Consider: Are you being too cautious? Or is the market not providing clear signals?',
      );
    }

    // Chain intelligence — our unique data
    const c = gathered.chainIntel;
    if (c) {
      sections.push(
        '',
        '--- ON-CHAIN INTELLIGENCE (KANet exclusive) ---',
        `Ecosystem health: ${c.ecosystemHealth} (${c.signal})`,
        `Network: ${c.totalPeers} peers, ${c.agentCount} agents with Cards`,
        `Activity: ${c.totalInteractions} interactions, ${c.totalHandshakes} handshakes`,
        `Activity concentration (top 5): ${(c.activityConcentration * 100).toFixed(1)}%`,
        c.highFreqAddresses > 0 ? `High-frequency addresses: ${c.highFreqAddresses} (potential whales/bots)` : '',
        c.newParticipants24h > 0 ? `New participants (24h): ${c.newParticipants24h} — ecosystem expanding` : '',
        '',
        'This on-chain data is UNIQUE to KANet — no other trading system has it.',
        'Ecosystem growth signals are leading indicators for KAS demand.',
      );
    }

    // Kaspa chain data (from KANet DB — Scout-fed)
    const kc = gathered.kaspaChain;
    if (kc?.activity) {
      const a = kc.activity;
      const addr = kc.addresses || {};
      const eco = kc.ecosystem || {};
      sections.push(
        '',
        '--- KASPA CHAIN DATA (KANet DB, Scout-scanned) ---',
        `Interactions: ${a.last24h} (24h) / ${a.last7d} (7d) / ${a.total} (all time)`,
        a.weekTrend !== null ? `Week-over-week trend: ${a.weekTrend > 0 ? '+' : ''}${a.weekTrend}%` : '',
        `Protocols: comm=${a.protocols?.comm || 0} handshake=${a.protocols?.handshake || 0} broadcast=${a.protocols?.bcast || 0}`,
        '',
        `Addresses: ${addr.total} total, ${addr.active} active`,
        `New addresses: ${addr.new24h} (24h) / ${addr.new7d} (7d)`,
        addr.new7d > 10 ? 'New address growth is STRONG — ecosystem expanding' : '',
        `Agent Cards on chain: ${eco.agentCards}`,
        '',
        'TRADING SIGNALS from chain data:',
        a.weekTrend > 20 ? '  Activity surging (+' + a.weekTrend + '%) — high demand signal' :
          a.weekTrend > 0 ? '  Activity growing — healthy ecosystem' :
          a.weekTrend < -20 ? '  Activity declining — caution' :
          '  Activity stable',
        addr.new24h > 5 ? '  New addresses arriving — adoption signal' : '',
      );

      // Top addresses (whale activity)
      if (kc.topAddresses?.length > 0) {
        sections.push('', '--- TOP ADDRESSES (whale activity) ---');
        kc.topAddresses.slice(0, 5).forEach(w => {
          sections.push(`  ${w.name || w.address.slice(-12)}: ${w.interactions} interactions${w.type ? ' [' + w.type + ']' : ''}`);
        });
      }
    }

    // Kaspa blockchain fundamentals (hashrate, supply, difficulty — from Scout RPC)
    const cf = gathered.chainFundamentals;
    if (cf?.available && cf.latest) {
      const l = cf.latest;
      sections.push(
        '',
        '--- KASPA BLOCKCHAIN FUNDAMENTALS (live RPC data) ---',
        `Block count: ${l.blockCount?.toLocaleString() || '?'}`,
        `DAA score: ${l.daaScore?.toLocaleString() || '?'}`,
        `Difficulty: ${l.difficulty ? l.difficulty.toExponential(2) : '?'}`,
        `Hashrate: ${l.hashrate ? l.hashrate.toExponential(2) + ' H/s' : '?'}`,
        `Tips (DAG width): ${l.tipsCount || '?'}`,
        l.circulatingSupply ? `Circulating supply: ${(l.circulatingSupply / 1e9).toFixed(3)}B KAS` : '',
        l.maxSupply ? `Max supply: ${(l.maxSupply / 1e9).toFixed(1)}B KAS` : '',
        l.circulatingSupply && l.maxSupply ? `Mined: ${(l.circulatingSupply / l.maxSupply * 100).toFixed(1)}%` : '',
      );

      // Trends
      if (cf.trend1h) {
        const t = cf.trend1h;
        sections.push(
          '',
          '1h trends:',
          t.hashrateChange ? `  Hashrate: ${t.hashrateChange}` : '',
          t.difficultyChange ? `  Difficulty: ${t.difficultyChange}` : '',
          t.newBlocks ? `  New blocks: ${t.newBlocks.toLocaleString()}` : '',
        );
      }
      if (cf.trend24h) {
        const t = cf.trend24h;
        sections.push(
          '24h trends:',
          t.hashrateChange ? `  Hashrate: ${t.hashrateChange}` : '',
          t.difficultyChange ? `  Difficulty: ${t.difficultyChange}` : '',
          t.newBlocks ? `  New blocks: ${t.newBlocks.toLocaleString()}` : '',
        );
      }

      // Trading signals from blockchain fundamentals
      sections.push(
        '',
        'BLOCKCHAIN TRADING SIGNALS:',
      );
      if (cf.trend1h?.hashrateChange) {
        const pct = parseFloat(cf.trend1h.hashrateChange);
        if (pct > 5) sections.push('  Hashrate surging — miners confident, bullish signal');
        else if (pct < -5) sections.push('  Hashrate dropping — miners leaving, cautious');
      }
      if (l.tipsCount > 20) {
        sections.push('  Wide DAG (many tips) — high network activity');
      }
      if (l.circulatingSupply && l.maxSupply) {
        const pctMined = l.circulatingSupply / l.maxSupply * 100;
        if (pctMined > 50) sections.push(`  Over ${pctMined.toFixed(0)}% mined — increasing scarcity`);
      }
    }

    // Whale + exchange balance tracking
    const wa = gathered.whaleActivity;
    if (wa?.summary) {
      sections.push(
        '',
        '--- WHALE & EXCHANGE TRACKING (live balance monitoring) ---',
        `Tracked addresses: ${wa.summary.trackedAddresses}`,
        `Significant moves (>5%): ${wa.summary.significantMoves}`,
      );

      if (wa.exchanges?.length > 0) {
        const exTotal = wa.summary.exchangeBalance;
        sections.push(
          '',
          `EXCHANGE HOLDINGS: ${exTotal.toFixed(2)} KAS total`,
        );
        for (const ex of wa.exchanges.slice(0, 10)) {
          const change = ex.changePct !== null ? ` (${ex.changePct > 0 ? '+' : ''}${ex.changePct}%)` : '';
          sections.push(`  ${ex.label}: ${ex.balance.toFixed(2)} KAS${change}`);
        }
        // Trading signals from exchange flows
        const exInflows = wa.exchanges.filter(e => e.changePct > 5);
        const exOutflows = wa.exchanges.filter(e => e.changePct < -5);
        if (exInflows.length > 0) sections.push('  ALERT: Exchange inflows detected — potential sell pressure');
        if (exOutflows.length > 0) sections.push('  BULLISH: Exchange outflows — accumulation signal');
      }

      if (wa.whales?.length > 0) {
        sections.push('', 'TOP WHALE BALANCES:');
        for (const w of wa.whales.slice(0, 10)) {
          const change = w.changePct !== null ? ` (${w.changePct > 0 ? '+' : ''}${w.changePct}%)` : '';
          sections.push(`  ${w.label}: ${w.balance.toFixed(2)} KAS${change}`);
        }
      }

      if (wa.significantMoves?.length > 0) {
        sections.push('', 'SIGNIFICANT BALANCE MOVES (>5%):');
        for (const m of wa.significantMoves.slice(0, 5)) {
          const dir = m.changePct > 0 ? 'INFLOW' : 'OUTFLOW';
          sections.push(`  ${dir} ${Math.abs(m.changePct).toFixed(1)}%: ${m.label} (${m.tag}) ${m.prevBalance?.toFixed(2)} → ${m.balance.toFixed(2)} KAS`);
        }
      }
    }

    // Real-time whale alerts (large transfers detected by Scout)
    if (gathered.whaleAlerts?.length > 0) {
      sections.push('', '--- REAL-TIME LARGE TRANSFER ALERTS ---');
      for (const a of gathered.whaleAlerts.slice(0, 5)) {
        sections.push(
          `  ${a.direction} ${Math.round(a.amountKas).toLocaleString()} KAS | ${a.label} (${a.tag}) | ${a.timestamp?.slice(11, 19) || ''}`
        );
      }
      const inflows = gathered.whaleAlerts.filter(a => a.direction === 'INFLOW');
      const outflows = gathered.whaleAlerts.filter(a => a.direction === 'OUTFLOW');
      if (inflows.length > outflows.length) {
        sections.push('  NET TREND: More inflows — accumulation or exchange deposit (potential sell pressure)');
      } else if (outflows.length > inflows.length) {
        sections.push('  NET TREND: More outflows — distribution to cold storage (bullish signal)');
      }
    }

    // Trading config + strategy
    const tc = gathered.tradingConfig;
    if (tc) {
      const base = tc.baseCurrency || 'USDT';
      sections.push(
        '',
        '--- YOUR TRADING MANDATE ---',
        `Status: ${tc.enabled ? 'ACTIVE' : 'DISABLED (advice only, no execution)'}`,
        `Base currency: ${base}`,
        `Capital allocated: ${tc.capital} ${base}`,
        `Max per trade: ${tc.maxPerTrade} ${base}`,
        `Max position: ${tc.maxPositionPct}%`,
        `Daily loss limit: ${tc.dailyLossLimit} ${base}`,
        tc.strategy ? `Strategy: ${tc.strategy}` : '',
      );

      if (base === 'KAS') {
        // Detect current holding state from portfolio balances
        const kasBalance = gathered.ticker?.price && gathered.tradingConfig?.capital
          ? gathered.tradingConfig.capital : 0;
        const portfolioKas = gathered.portfolio?.balances?.find(b => b.asset === 'KAS')?.free || 0;
        const portfolioUsdt = gathered.portfolio?.balances?.find(b => b.asset === 'USDT')?.free || 0;
        const holdingKas = portfolioKas > portfolioUsdt * 10; // rough heuristic
        const holdingUsdt = portfolioUsdt > 100;

        sections.push(
          '',
          '--- KAS-BASE STRATEGY (CRITICAL — read carefully) ---',
          '',
          'GOAL: INCREASE total KAS count through swing trading.',
          'Success metric: Did the total KAS count go UP?',
          '',
          'THE CYCLE:',
          '1. When price is HIGH → SELL some KAS → receive USDT',
          '2. WAIT for price to DROP',
          '3. BUY BACK more KAS with that USDT → net gain in KAS',
          '',
          `CURRENT STATE: ${portfolioKas > 0 ? portfolioKas.toLocaleString() + ' KAS' : 'No KAS'} | ${portfolioUsdt > 0 ? '$' + portfolioUsdt.toFixed(2) + ' USDT' : 'No USDT'}`,
          '',
        );

        if (holdingUsdt && !holdingKas) {
          sections.push(
            'SITUATION: Owner holds USDT, waiting to buy back KAS.',
            '  → Look for LOW price / dip to BUY KAS with USDT',
            '  → DO NOT rush — wait for support levels or significant dip',
            '  → Every $0.001 lower = more KAS per USDT',
          );
        } else if (holdingKas && !holdingUsdt) {
          sections.push(
            'SITUATION: Owner holds KAS, no USDT.',
            '  → Look for HIGH price / pump to SELL some KAS for USDT',
            '  → A dip is NOT a buy signal — no USDT to buy with!',
            '  → When in doubt, hold — KAS is the default position',
          );
        } else if (holdingKas && holdingUsdt) {
          sections.push(
            'SITUATION: Owner holds both KAS and USDT.',
            '  → Can both SELL (if price high) and BUY (if price low)',
            '  → Optimize entries — buy on dips, sell on pumps',
          );
        } else {
          sections.push(
            'SITUATION: Low balances. Consider strategy carefully.',
          );
        }

        sections.push(
          '',
          'EXAMPLE:',
          '  Sell 10,000 KAS at $0.04 → get $400 USDT',
          '  Buy back at $0.035 → get 11,428 KAS → net +1,428 KAS',
          '',
          'RULES:',
          `  - Never exceed ${tc.maxPerTrade} KAS per trade`,
          `  - Max position: ${tc.maxPositionPct}%`,
          `  - Daily loss limit: ${tc.dailyLossLimit} KAS`,
          '  - Fees ~0.1% per trade → need >0.2% spread to profit',
          '',
          '--- SIGNAL VALIDATION (CRITICAL — chain data can be faked) ---',
          '',
          'On-chain whale moves may be DELIBERATELY STAGED to manipulate sentiment.',
          'Real price discovery happens in the exchange orderbook, not on chain.',
          '',
          'CROSS-VALIDATION RULES before acting on chain signals:',
          '1. Whale deposits to exchange → check if orderbook ask walls ACTUALLY grew',
          '   No new sell walls = bluff. Ignore the chain signal.',
          '2. Large transfer alert → check MEXC 24h volume change.',
          '   Volume stable = internal wallet shuffle. Not a trading signal.',
          '3. Exchange outflows (bullish signal) → verify bid depth increased.',
          '   No bid growth = could be cold storage rotation, not accumulation.',
          '4. Multiple whale moves in same direction → higher confidence.',
          '   Single large move = could be manipulation. Pattern of moves = real trend.',
          '5. Chain signal CONFIRMS exchange signal = high confidence.',
          '   Chain signal CONTRADICTS exchange signal = ignore chain, trust orderbook.',
          '',
          'HIERARCHY: Exchange orderbook > Trade volume > Chain fundamentals > Whale moves',
        );
      } else {
        sections.push(
          '',
          '--- USDT-BASE STRATEGY ---',
          'The owner has USDT and wants to profit by trading KAS.',
          'Buy low, sell high. Measure success in USDT gains.',
          `  - Max ${tc.maxPerTrade} USDT per trade`,
          `  - Stop if daily loss exceeds ${tc.dailyLossLimit} USDT`,
        );
      }
    }

    // Owner intent (from goals)
    if (gathered.ownerIntent) {
      sections.push(
        '',
        '--- ADDITIONAL OWNER GOALS ---',
        gathered.ownerIntent.summary,
      );
    }

    if (gathered.error) {
      sections.push(`\nMarket data error: ${gathered.error}`);
    }

    sections.push(
      '',
      '--- RESPONSE GUIDELINES ---',
      '1. State market condition (bullish/bearish/sideways)',
      '2. Key levels (support, resistance)',
      '3. Clear recommendation aligned with base currency strategy',
      '4. Risks and what could go wrong',
      '5. Never guarantee profits',
      '6. NEVER say "click confirm", "click execute", "press button" — you have NO UI buttons. You are an analyst, not an executor.',
      '7. If showing a split plan, say "this is the analysis" — execution requires owner to use the trading panel separately.',
    );

    return {
      name: this.name,
      description: this.description,
      data: {
        price: gathered.ticker?.price,
        change24h: gathered.ticker?.change24hPct,
        trend: gathered.signals?.shortTrend,
      },
      instructions: sections.filter(Boolean).join('\n'),
    };
  }
}
