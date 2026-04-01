/**
 * Strategy Engine — 策略选择 + 交易提案生成（纯逻辑，不用 AI）
 *
 * 输入：signal-engine 的 analysis + 当前价格 + 账户状态
 * 输出：完整交易提案（或 null = 不交易）
 *
 * 核心设计：锚参数（anchor）贯穿始终
 *   anchor='usd' → 法币锚：KAS 是资产，USDT 是目标，卖出=落袋为安
 *   anchor='kas' → 本币锚：KAS 是目标，USDT 是弹药，卖出=动用弹药等低买回
 *
 * Brain 不参与策略选择。Brain 只做最后的常识审批。
 */

// ═══════════════════════════════════════════════════════════════
//  Strategy Templates — USD Anchor (法币锚)
//  目标：增加 USDT 价值
// ═══════════════════════════════════════════════════════════════

const STRATEGIES_USD = {

  trend_following: {
    name: '趋势跟踪（法币锚）',
    condition: (analysis) =>
      analysis.regime === 'trending' && analysis.actionable,
    generate: (analysis, price, account) => {
      const action = analysis.composite > 0 ? 'buy' : 'sell';
      const amount = calcPositionSize(account, 0.02, 'usd');
      return {
        action,
        amount,
        price:      action === 'buy' ? price * 1.001 : price * 0.999,
        stopLoss:   action === 'buy' ? price * 0.97  : price * 1.03,
        takeProfit: action === 'buy' ? price * 1.06  : price * 0.94,
      };
    },
  },

  grid_trading: {
    name: '网格交易（法币锚）',
    condition: (analysis) =>
      analysis.regime === 'ranging' && analysis.signals.volatility > 20,
    generate: (analysis, price, account) => ({
      action: analysis.composite < 0 ? 'buy' : 'sell',
      amount: calcPositionSize(account, 0.01, 'usd'),
      price,
      stopLoss: null,
      takeProfit: null,
    }),
  },

  mean_reversion: {
    name: '均值回归（法币锚）',
    condition: (analysis) =>
      Math.abs(analysis.signals.momentum) > 70 && analysis.confidence > 0.6,
    generate: (analysis, price, account) => {
      const action = analysis.signals.momentum > 0 ? 'sell' : 'buy';
      return {
        action,
        amount: calcPositionSize(account, 0.01, 'usd'),
        price,
        stopLoss:   action === 'buy' ? price * 0.96 : price * 1.04,
        takeProfit: action === 'buy' ? price * 1.03 : price * 0.97,
      };
    },
  },

};

// ═══════════════════════════════════════════════════════════════
//  Strategy Templates — KAS Anchor (本币锚)
//  目标：增加 KAS 数量
//  USDT 是弹药，不是利润
//  卖 KAS = 把弹药准备好等低点买回更多
//  买 KAS = 动用弹药换回目标资产
// ═══════════════════════════════════════════════════════════════

const STRATEGIES_KAS = {

  accumulate: {
    name: '低吸囤币',
    // 价格下跌 + 有 USDT 弹药 → 买入机会
    condition: (analysis, account) =>
      analysis.composite < -20 &&
      analysis.actionable &&
      (account.usdtBalance || 0) > 1,
    generate: (analysis, price, account) => {
      // 动用部分 USDT 弹药买入 KAS
      const usdtToUse = Math.min(
        (account.usdtBalance || 0) * 0.3,  // 最多用 30% 弹药
        account.autoModeMaxUsdt || 20,
      );
      const rawKas = Math.floor(usdtToUse / price);
      // KAS 数量也受 auto 限额约束
      const kasAmount = Math.min(rawKas, account.autoModeMax || 200);
      return {
        action: 'buy',
        amount: kasAmount,
        price:      price * 0.999,    // 略低于市价挂单
        stopLoss:   null,             // 本币锚不设买入止损（跌了更便宜=更好）
        takeProfit: null,             // 不止盈，目标是囤
        usdtDeployed: usdtToUse,
      };
    },
  },

  deploy_ammo: {
    name: '高抛备弹',
    // 价格上涨 + 信号看涨 + KAS 充足 → 卖出部分换弹药，等回调再买
    condition: (analysis, account) =>
      analysis.composite > 40 &&
      analysis.actionable &&
      analysis.regime === 'trending' &&
      (account.kasBalance || 0) > 100,
    generate: (analysis, price, account) => {
      // 卖出少量 KAS 换 USDT 弹药（最多 1% KAS 持仓）
      const amount = calcPositionSize(account, 0.01, 'kas');
      const expectedUsdt = amount * price;
      return {
        action: 'sell',
        amount,
        price:      price * 1.001,    // 略高于市价
        stopLoss:   null,             // 本币锚：卖出不设止损
        takeProfit: null,
        expectedUsdt,
        // 目标不是赚 USDT，是在回调时用这些 USDT 买回更多 KAS
        targetBuyback: Math.floor(expectedUsdt / (price * 0.95)),  // 假设跌 5% 能买回多少
        netKasGain: Math.floor(expectedUsdt / (price * 0.95)) - amount,  // 预计净增 KAS
      };
    },
  },

  dip_reentry: {
    name: '回调补仓',
    // 之前高抛过（有 USDT），现在跌了 → 买回
    condition: (analysis, account) =>
      analysis.composite < 0 &&
      analysis.signals.momentum < -30 &&
      (account.usdtBalance || 0) > 5,
    generate: (analysis, price, account) => {
      const usdtToUse = Math.min(
        (account.usdtBalance || 0) * 0.5,  // 用 50% 弹药
        account.autoModeMaxUsdt || 20,
      );
      const rawKas = Math.floor(usdtToUse / price);
      const kasAmount = Math.min(rawKas, account.autoModeMax || 200);
      return {
        action: 'buy',
        amount: kasAmount,
        price:  price * 0.998,
        stopLoss: null,
        takeProfit: null,
        usdtDeployed: usdtToUse,
      };
    },
  },

};

// ═══════════════════════════════════════════════════════════════
//  Position Sizing — Quarter Kelly, max 2% of portfolio
// ═══════════════════════════════════════════════════════════════

function calcPositionSize(account, maxPct, anchor) {
  if (anchor === 'kas') {
    // 本币锚：仓位以 KAS 持仓为基准
    const kasBase = account.kasBalance || 0;
    const max = kasBase * maxPct;
    const dailyRemaining = (account.dailyLimit || 5000) - (account.dailyUsed || 0);
    const autoMax = account.autoModeMax || 200;
    return Math.max(0, Math.min(max, dailyRemaining, autoMax));
  }
  // 法币锚：仓位以总价值（KAS+USDT 折算）为基准
  const totalValue = account.totalValueKas || 0;
  const max = totalValue * maxPct;
  const dailyRemaining = (account.dailyLimit || 5000) - (account.dailyUsed || 0);
  const autoMax = account.autoModeMax || 200;
  return Math.max(0, Math.min(max, dailyRemaining, autoMax));
}

// ═══════════════════════════════════════════════════════════════
//  Reason Builder — human-readable explanation
// ═══════════════════════════════════════════════════════════════

function buildReason(analysis, anchor = 'usd') {
  const parts = [];
  if (Math.abs(analysis.signals.trend) > 30) {
    parts.push(`趋势${analysis.signals.trend > 0 ? '看涨' : '看跌'}(EMA${analysis.signals.trend > 0 ? '金叉' : '死叉'})`);
  }
  if (Math.abs(analysis.signals.momentum) > 30) {
    parts.push(`动量${analysis.signals.momentum > 0 ? '偏强' : '偏弱'}(RSI+MACD)`);
  }
  if (Math.abs(analysis.signals.orderFlow) > 30) {
    parts.push(`${analysis.signals.orderFlow > 0 ? '买盘' : '卖盘'}压力(OBI=${analysis.signals.orderFlow})`);
  }
  if (Math.abs(analysis.signals.whale) > 30) {
    parts.push(`鲸鱼${analysis.signals.whale > 0 ? '累积' : '派发'}信号`);
  }
  parts.push(`ADX=${analysis.adx}(${analysis.regime === 'trending' ? '强趋势' : analysis.regime === 'ranging' ? '震荡' : '不确定'})`);
  if (anchor === 'kas') {
    parts.push('[本币锚：目标增持KAS]');
  }
  return parts.join(' + ');
}

// ═══════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a trade proposal from market analysis.
 *
 * @param {object} analysis — from signal-engine.analyzeMarket()
 * @param {number} price — current market price
 * @param {object} account — { kasBalance, usdtBalance, totalValueKas, dailyLimit, dailyUsed, autoModeMax, autoModeMaxUsdt }
 * @param {object} opts — { anchor: 'usd'|'kas' }
 * @returns {object|null} proposal or null (no actionable signal)
 */
export function generateProposal(analysis, price, account, opts = {}) {
  if (!analysis?.actionable) return null;
  if (!price || price <= 0) return null;
  if (!account) return null;

  const anchor = opts.anchor || 'usd';
  const strategies = anchor === 'kas' ? STRATEGIES_KAS : STRATEGIES_USD;

  // Try strategies in priority order
  for (const [key, strategy] of Object.entries(strategies)) {
    if (!strategy.condition(analysis, account)) continue;

    const params = strategy.generate(analysis, price, account);
    if (!params.amount || params.amount <= 0) continue;

    // Build anchor-appropriate risk description
    const riskCheck = anchor === 'kas'
      ? {
          anchor: 'kas',
          kasAtRisk: params.amount + ' KAS',
          usdtDeployed: params.usdtDeployed ? params.usdtDeployed.toFixed(2) + ' USDT' : 'N/A',
          targetBuyback: params.targetBuyback ? params.targetBuyback + ' KAS' : 'N/A',
          netKasGain: params.netKasGain ? '+' + params.netKasGain + ' KAS (预估)' : 'N/A',
          dailyUsed: `${account.dailyUsed || 0}/${account.dailyLimit || 5000} KAS`,
        }
      : {
          anchor: 'usd',
          positionPct: ((params.amount / (account.totalValueKas || 1)) * 100).toFixed(2) + '%',
          maxLoss: params.stopLoss
            ? Math.abs(params.amount * (params.stopLoss - params.price)).toFixed(2) + ' KAS'
            : 'N/A',
          dailyUsed: `${account.dailyUsed || 0}/${account.dailyLimit || 5000} KAS`,
        };

    return {
      strategy:     key,
      strategyName: strategy.name,
      anchor,
      signal: {
        composite:  analysis.composite,
        confidence: analysis.confidence,
      },
      regime: analysis.regime,
      adx:    analysis.adx,
      action: params.action,
      params: {
        amount:     Math.round(params.amount),
        price:      parseFloat(params.price.toFixed(6)),
        stopLoss:   params.stopLoss ? parseFloat(params.stopLoss.toFixed(6)) : null,
        takeProfit: params.takeProfit ? parseFloat(params.takeProfit.toFixed(6)) : null,
        reason:     buildReason(analysis, anchor),
      },
      riskCheck,
      generatedAt: new Date().toISOString(),
    };
  }

  return null; // no strategy matched
}
