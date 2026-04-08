/**
 * Skill: Trade Advisor — KANet's first service skill
 *
 * The first protocol-level demonstration of machine-native economy:
 *   External agent/user sends request → Agent analyzes market → Returns report
 *   Free tier: basic market summary (引流)
 *   Paid tier: full analysis + split plan + signals (变现, requires KIP-9 payment)
 *
 * This skill does NOT trade. It provides intelligence as a service.
 * Payment verification: checks interaction_records for payment from sender.
 *
 * Protocol flow:
 *   1. Sender sends comm: "analyze KASUSDT" or "交易分析"
 *   2. trade_advisor activates (reactive only, external service)
 *   3. Gathers trade_sense data (reuses 7-layer intelligence)
 *   4. Checks if sender has paid (interaction_records.interaction_type = 'payment')
 *   5. Brain generates: free summary OR paid full report
 *   6. Response sent via comm (on-chain, verifiable)
 *
 * This proves: Agent as autonomous economic participant.
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_FEE_KAS = 0.001;  // Minimum payment for full report

const ADVISOR_KEYWORDS = [
  // English
  'analyze', 'analysis', 'advise', 'advisor', 'report', 'split plan',
  'market report', 'trade advice', 'trading advice', 'full report',
  'buy or sell', 'should i buy', 'should i sell', 'entry point',
  // Chinese
  '分析', '交易分析', '报告', '完整报告', '拆单方案', '买还是卖',
  '该买吗', '该卖吗', '入场', '建议', '顾问',
];

// MEXC public API (no auth needed)
const MEXC_BASE = 'https://api.mexc.com/api/v3';

// ── Skill Class ───────────────────────────────────────────────────────────────

export class TradeAdvisorSkill extends Skill {
  constructor() {
    super(
      'trade_advisor',
      'KANet Trade Advisor Service — provide personalized market analysis to external agents/users for KIP-9 micropayment',
    );
    this._lastMessage = '';
    this._senderAddress = '';
  }

  canActivate(taskType, context) {
    // Service skill: only activates on reactive (incoming requests)
    if (taskType !== 'reactive') return false;

    const msg = (context._inputMessage || '').toLowerCase();
    this._lastMessage = context._inputMessage || '';
    this._senderAddress = context._senderAddress || '';

    return ADVISOR_KEYWORDS.some(k => msg.includes(k));
  }

  async gatherContext(kernels, config) {
    const consoleUrl = config.consoleUrl || 'http://localhost:3100';
    const symbol = 'KASUSDT';
    const result = {
      symbol,
      service: {
        name: 'KANet Trade Advisor',
        fee: SERVICE_FEE_KAS,
        provider: config.name,
        providerAddress: config.address,
      },
      senderAddress: this._senderAddress,
      isPaid: false,
      ticker: null,
      signals: null,
      depth: null,
      chainIntel: null,
      chainFundamentals: null,
      whaleActivity: null,
      error: null,
    };

    try {
      // ── Check payment status ────────────────────────────────────────────
      if (this._senderAddress && !this._senderAddress.startsWith('owner:')) {
        // Query interaction_records for payment from this sender to us
        const payments = await fetchJson(
          `${consoleUrl}/api/discovery/activity?limit=200`
        ).catch(() => null);

        if (payments?.interactions) {
          const myAddress = config.address;
          const paid = payments.interactions.some(
            i => i.interaction_type === 'payment'
              && i.address_a === this._senderAddress
              && i.address_b === myAddress
          );
          result.isPaid = paid;
        }
      }

      // Owner always gets full report
      if (this._senderAddress.startsWith('owner:')) {
        result.isPaid = true;
      }

      // ── Market data (parallel fetch, reuse trade_sense patterns) ────────
      const [ticker, klines, depth, chainFundamentals, whaleActivity] = await Promise.all([
        fetchJson(`${MEXC_BASE}/ticker/24hr?symbol=${symbol}`).catch(() => null),
        fetchJson(`${MEXC_BASE}/klines?symbol=${symbol}&interval=60m&limit=48`).catch(() => null),
        fetchJson(`${MEXC_BASE}/depth?symbol=${symbol}&limit=10`).catch(() => null),
        fetchJson(`${consoleUrl}/api/chain/fundamentals`).catch(() => null),
        fetchJson(`${consoleUrl}/api/chain/whale-activity`).catch(() => null),
      ]);

      // Ticker
      if (ticker) {
        result.ticker = {
          price: parseFloat(ticker.lastPrice),
          change24hPct: parseFloat(parseFloat(ticker.priceChangePercent).toFixed(2)),
          high24h: parseFloat(ticker.highPrice),
          low24h: parseFloat(ticker.lowPrice),
          volume24h: Math.round(parseFloat(ticker.quoteVolume)),
        };
      }

      // Signals from klines
      if (klines?.length >= 7) {
        const closes = klines.map(k => parseFloat(k[4]));
        const sma7 = closes.slice(-7).reduce((a, b) => a + b, 0) / 7;
        const sma25 = closes.length >= 25
          ? closes.slice(-25).reduce((a, b) => a + b, 0) / 25
          : null;
        const currentPrice = closes[closes.length - 1];

        // Volatility
        const returns = [];
        for (let i = 1; i < closes.length; i++) {
          returns.push((closes[i] - closes[i - 1]) / closes[i - 1] * 100);
        }
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / returns.length;
        const volatility = Math.sqrt(variance);

        // Momentum (6-period ROC)
        const roc6 = closes.length >= 7
          ? ((closes[closes.length - 1] - closes[closes.length - 7]) / closes[closes.length - 7] * 100)
          : null;

        // Support/Resistance
        const recent12 = closes.slice(-12);
        const support = Math.min(...recent12);
        const resistance = Math.max(...recent12);

        result.signals = {
          sma7: parseFloat(sma7.toFixed(6)),
          sma25: sma25 ? parseFloat(sma25.toFixed(6)) : null,
          shortTrend: currentPrice > sma7 ? 'up' : currentPrice < sma7 ? 'down' : 'flat',
          longTrend: sma25 ? (sma7 > sma25 ? 'bullish' : sma7 < sma25 ? 'bearish' : 'neutral') : null,
          volatility: parseFloat(volatility.toFixed(2)),
          volatilityLevel: volatility < 1 ? 'low' : volatility < 3 ? 'medium' : 'high',
          momentum: roc6 !== null ? parseFloat(roc6.toFixed(2)) : null,
          support: parseFloat(support.toFixed(6)),
          resistance: parseFloat(resistance.toFixed(6)),
        };
      }

      // Orderbook depth
      if (depth?.bids?.length && depth?.asks?.length) {
        const bidDepth = depth.bids.reduce((s, b) => s + parseFloat(b[1]), 0);
        const askDepth = depth.asks.reduce((s, a) => s + parseFloat(a[1]), 0);
        const bestBid = parseFloat(depth.bids[0][0]);
        const bestAsk = parseFloat(depth.asks[0][0]);

        result.depth = {
          bestBid,
          bestAsk,
          spread: parseFloat(((bestAsk - bestBid) / bestBid * 100).toFixed(3)),
          bidDepth: Math.round(bidDepth),
          askDepth: Math.round(askDepth),
          imbalance: parseFloat((bidDepth / (bidDepth + askDepth) * 100).toFixed(1)),
          bidLevels: depth.bids.slice(0, 8).map(b => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) })),
          askLevels: depth.asks.slice(0, 8).map(a => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) })),
        };

        // Split plan demo for paid users
        if (result.isPaid) {
          result.splitPlan = this._planSplit('BUY', 50000, depth);
        }
      }

      // Chain fundamentals
      if (chainFundamentals?.available) {
        result.chainFundamentals = chainFundamentals;
      }

      // Whale activity
      if (whaleActivity?.summary) {
        result.whaleActivity = whaleActivity;
      }

    } catch (err) {
      result.error = err.message;
    }

    return result;
  }

  formatForBrain(gathered) {
    if (gathered.isPaid) {
      return this._formatFullReport(gathered);
    }
    return this._formatFreeReport(gathered);
  }

  // ── Free Report (引流) ──────────────────────────────────────────────────────

  _formatFreeReport(g) {
    const sections = [
      '--- KANET TRADE ADVISOR SERVICE ---',
      `Provider: ${g.service.provider} | Fee: ${g.service.fee} KAS for full report`,
      '',
    ];

    // Basic market summary (free)
    if (g.ticker) {
      sections.push(
        'MARKET SUMMARY (free tier):',
        `KAS/USDT: $${g.ticker.price} (${g.ticker.change24hPct > 0 ? '+' : ''}${g.ticker.change24hPct}% 24h)`,
        `24h Range: $${g.ticker.low24h} — $${g.ticker.high24h}`,
      );
    }
    if (g.signals) {
      sections.push(
        `Trend: ${g.signals.shortTrend} | Volatility: ${g.signals.volatilityLevel}`,
      );
    }

    // Upsell
    sections.push(
      '',
      '--- UPGRADE TO FULL REPORT ---',
      `Send ${g.service.fee} KAS to ${g.service.providerAddress}`,
      'Full report includes:',
      '  - 7-layer signal analysis (SMA, momentum, support/resistance)',
      '  - Orderbook depth with bid/ask imbalance',
      '  - Smart split plan for large orders (minimize slippage)',
      '  - On-chain intelligence (whale activity, exchange flows)',
      '  - Blockchain fundamentals (hashrate, difficulty trends)',
      '  - Personalized entry/exit recommendations',
      '',
      'After payment, send your request again to receive the full report.',
    );

    return {
      name: this.name,
      description: 'Trade Advisor free tier — basic summary with upgrade prompt',
      data: g,
      instructions: sections.join('\n'),
    };
  }

  // ── Full Report (付费) ──────────────────────────────────────────────────────

  _formatFullReport(g) {
    const sections = [
      '--- KANET TRADE ADVISOR — FULL REPORT ---',
      `Provider: ${g.service.provider} | Status: PAID ✓`,
      '',
    ];

    // L1: Price & Volume
    if (g.ticker) {
      sections.push(
        '═══ MARKET DATA ═══',
        `Price: $${g.ticker.price} USDT`,
        `24h Change: ${g.ticker.change24hPct > 0 ? '+' : ''}${g.ticker.change24hPct}%`,
        `24h Range: $${g.ticker.low24h} — $${g.ticker.high24h}`,
        `24h Volume: $${g.ticker.volume24h.toLocaleString()} USDT`,
      );
    }

    // L2: Signals
    if (g.signals) {
      sections.push(
        '',
        '═══ SIGNAL ANALYSIS ═══',
        `Short trend (7h SMA): ${g.signals.shortTrend} | SMA7: $${g.signals.sma7}`,
        g.signals.sma25 ? `Long trend (25h SMA): ${g.signals.longTrend} | SMA25: $${g.signals.sma25}` : '',
        `Volatility: ${g.signals.volatilityLevel} (${g.signals.volatility}%)`,
        g.signals.momentum !== null ? `Momentum (6h ROC): ${g.signals.momentum > 0 ? '+' : ''}${g.signals.momentum}%` : '',
        `Support: $${g.signals.support} | Resistance: $${g.signals.resistance}`,
      );
    }

    // L3: Orderbook depth
    if (g.depth) {
      sections.push(
        '',
        '═══ ORDERBOOK DEPTH ═══',
        `Best bid: $${g.depth.bestBid} | Best ask: $${g.depth.bestAsk}`,
        `Spread: ${g.depth.spread}%`,
        `Bid depth: ${g.depth.bidDepth.toLocaleString()} KAS | Ask depth: ${g.depth.askDepth.toLocaleString()} KAS`,
        `Imbalance: ${g.depth.imbalance}% bid (${g.depth.imbalance > 55 ? 'buyers dominate' : g.depth.imbalance < 45 ? 'sellers dominate' : 'balanced'})`,
        '',
        'BID levels (sell targets):',
      );
      for (const l of g.depth.bidLevels) {
        sections.push(`  $${l.price} | ${Math.round(l.qty).toLocaleString()} KAS`);
      }
      sections.push('', 'ASK levels (buy targets):');
      for (const l of g.depth.askLevels) {
        sections.push(`  $${l.price} | ${Math.round(l.qty).toLocaleString()} KAS`);
      }
    }

    // Split plan
    if (g.splitPlan) {
      const sp = g.splitPlan;
      sections.push(
        '',
        '═══ SMART SPLIT PLAN (50K KAS) ═══',
        `Orders: ${sp.orders.length} | Avg price: $${sp.avgPrice} | Slippage: ${sp.slippagePct}%`,
      );
      for (let i = 0; i < sp.orders.length; i++) {
        const o = sp.orders[i];
        sections.push(`  #${i + 1}: ${Math.round(o.qty).toLocaleString()} KAS @ $${o.price} (take ${o.takePct}% of level)`);
      }
      sections.push(`Estimated cost: $${sp.estimatedCost.toLocaleString()} | Saved vs market: ${sp.savedPct}%`);
    }

    // Chain fundamentals
    if (g.chainFundamentals?.available && g.chainFundamentals.latest) {
      const l = g.chainFundamentals.latest;
      sections.push(
        '',
        '═══ BLOCKCHAIN FUNDAMENTALS ═══',
        l.hashrate ? `Hashrate: ${l.hashrate.toExponential(2)} H/s` : '',
        l.difficulty ? `Difficulty: ${l.difficulty.toExponential(2)}` : '',
        l.tipsCount ? `DAG tips: ${l.tipsCount}` : '',
        l.circulatingSupply && l.maxSupply
          ? `Supply: ${(l.circulatingSupply / 1e9).toFixed(2)}B / ${(l.maxSupply / 1e9).toFixed(1)}B (${(l.circulatingSupply / l.maxSupply * 100).toFixed(1)}% mined)`
          : '',
      );
    }

    // Whale activity
    if (g.whaleActivity?.summary) {
      const wa = g.whaleActivity;
      sections.push(
        '',
        '═══ WHALE & EXCHANGE INTELLIGENCE ═══',
        `Tracked: ${wa.summary.trackedAddresses} addresses | Significant moves: ${wa.summary.significantMoves}`,
      );
      if (wa.exchanges?.length) {
        sections.push(`Exchange holdings: ${wa.summary.exchangeBalance?.toFixed(0)} KAS total`);
        const inflows = wa.exchanges.filter(e => e.changePct > 5);
        const outflows = wa.exchanges.filter(e => e.changePct < -5);
        if (inflows.length) sections.push('  ALERT: Exchange inflows detected — potential sell pressure');
        if (outflows.length) sections.push('  SIGNAL: Exchange outflows — accumulation pattern');
      }
      if (wa.significantMoves?.length) {
        for (const m of wa.significantMoves.slice(0, 3)) {
          const dir = m.changePct > 0 ? 'IN' : 'OUT';
          sections.push(`  ${dir} ${Math.abs(m.changePct).toFixed(1)}%: ${m.label} (${m.tag})`);
        }
      }
    }

    // Cross-validation reminder
    sections.push(
      '',
      '═══ SIGNAL VALIDATION ═══',
      'Priority: Exchange orderbook > Trade volume > Chain fundamentals > Whale moves',
      'Chain signals can be faked. Always cross-validate with orderbook before acting.',
    );

    // Actionable recommendation instruction
    sections.push(
      '',
      '═══ YOUR TASK ═══',
      'Based on ALL the data above, provide the requester with:',
      '1. Market verdict: BULLISH / BEARISH / NEUTRAL with confidence %',
      '2. Recommended action: BUY / SELL / HOLD with specific entry/exit prices',
      '3. Risk assessment: what could go wrong',
      '4. If they want to trade 50K+ KAS, provide the split plan details above',
      '',
      'Respond as a professional trading advisor. Be specific with numbers.',
      'This is a PAID report — deliver maximum value.',
    );

    return {
      name: this.name,
      description: 'Trade Advisor FULL report — paid tier, complete 7-layer analysis',
      data: g,
      instructions: sections.join('\n'),
    };
  }

  // ── Split Planning (reused from trade-sense pattern) ────────────────────────

  _planSplit(side, totalQty, depthRaw) {
    const levels = side === 'BUY'
      ? depthRaw.asks.map(a => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) }))
      : depthRaw.bids.map(b => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) }));

    const maxPctPerLevel = 0.4;
    const orders = [];
    let remaining = totalQty;
    const bestPrice = levels[0]?.price || 0;

    for (const level of levels) {
      if (remaining <= 0) break;
      const maxTake = level.qty * maxPctPerLevel;
      const take = Math.min(remaining, maxTake);
      if (take < 100) continue; // exchange minimum
      const slippage = Math.abs(level.price - bestPrice) / bestPrice * 100;
      if (slippage > 1.0) break; // max 1% slippage
      orders.push({
        price: level.price,
        qty: take,
        takePct: Math.round(take / level.qty * 100),
        slippagePct: parseFloat(slippage.toFixed(3)),
      });
      remaining -= take;
    }

    const totalPlanned = orders.reduce((s, o) => s + o.qty, 0);
    const avgPrice = orders.length > 0
      ? orders.reduce((s, o) => s + o.price * o.qty, 0) / totalPlanned
      : 0;
    const estimatedCost = totalPlanned * avgPrice;
    const naiveCost = totalPlanned * (side === 'BUY' ? levels[0]?.price : levels[0]?.price);
    const savedPct = naiveCost > 0
      ? parseFloat(Math.abs((estimatedCost - naiveCost) / naiveCost * 100).toFixed(2))
      : 0;

    return {
      side,
      totalRequested: totalQty,
      totalPlanned: Math.round(totalPlanned),
      remaining: Math.round(remaining),
      orders,
      avgPrice: parseFloat(avgPrice.toFixed(6)),
      slippagePct: orders.length > 0 ? orders[orders.length - 1].slippagePct : 0,
      estimatedCost: Math.round(estimatedCost),
      savedPct,
    };
  }
}
