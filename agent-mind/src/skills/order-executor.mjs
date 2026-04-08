/**
 * Skill: Order Executor — KANet 做市 + CEX 对冲
 *
 * 读 market-scanner 缓存 → 计算挂单价格 → 输出 MAKE_MARKET ACTION。
 * 不实际下单（执行在 action-executor.mjs）。
 *
 * Brain 输出：
 *   [ACTION:MAKE_MARKET amount=500 sell_price=0.03135 buy_price=0.03117
 *    hedge_cex=Gate reason="spread 0.3% opportunity"]
 */

import { Skill } from './base.mjs';
import { getScannerCache } from './market-scanner.mjs';
import { fetchJson } from '../utils.mjs';

const REACTIVE_KEYWORDS = [
  '挂单', '做市', 'make market', 'make_market', 'MAKE_MARKET',
  'place offer', 'post offer', '发布报价', '挂卖单', '挂买单',
];

const DEFAULT_SPREAD = 0.003;        // 0.3%
const MAX_PER_ORDER_KAS = 1000;
const MAX_DAILY_KAS = 5000;
const MIN_ORDER_KAS = 50;

export class OrderExecutorSkill extends Skill {
  constructor() {
    super('order_executor', 'KANet market-making — generate MAKE_MARKET orders with CEX hedge reference');
  }

  canActivate(taskType, context) {
    if (taskType === 'proactive') return false; // market-scanner 触发，不独立 proactive
    if (taskType === 'reactive') {
      const msg = (context._inputMessage || '').toLowerCase();
      return REACTIVE_KEYWORDS.some(k => msg.includes(k));
    }
    return false;
  }

  async gatherContext(kernels, config) {
    const scanner = getScannerCache();

    // Agent 余额
    let kasBalance = null;
    let openOffers = [];
    try {
      const bal = await fetchJson(`${config.consoleUrl}/api/relay/${config.relayNodeId}/balance`);
      kasBalance = bal?.balance ?? null;
    } catch {}

    // 当前在 KANet 上的挂单
    try {
      const res = await fetchJson(`${config.consoleUrl}/api/exchange/offers?maker=${config.address}&status=open`);
      openOffers = res?.offers || res || [];
    } catch {}

    // 今日累计做市量（从 execution_states 查）
    let dailyVolume = 0;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const execs = await fetchJson(`${config.consoleUrl}/api/trade/executions?agent=${config.address}&after=${today}`);
      const list = execs?.executions || execs || [];
      dailyVolume = list
        .filter(e => e.action === 'make_market')
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    } catch {}

    // CEX 对冲资金查询（余额数字可以给 Brain，Key 绝不出现）
    const cexFunds = [];
    try {
      // 账户列表
      const accounts = await fetchJson(`${config.consoleUrl}/api/trade/accounts`);
      const list = accounts?.accounts || accounts || [];
      for (const acct of list) {
        const entry = { exchange: acct.exchange, label: acct.label || acct.exchange, usdt: null, configured: true };
        // 查余额：用 test 端点触发连接验证后，用 portfolio 拿默认账户的
        // portfolio 只返回默认账户余额，非默认账户标记为"已配置"但余额未知
        cexFunds.push(entry);
      }
      // 默认账户余额从 portfolio 取
      const portfolio = await fetchJson(`${config.consoleUrl}/api/trade/portfolio`);
      const usdtBal = (portfolio?.balances || []).find(b => b.asset === 'USDT');
      if (usdtBal && cexFunds.length > 0) {
        // portfolio.exchange 可能是 "Gate.io" 而 DB 存 "gateio"，按默认账户匹配
        const defaultEntry = cexFunds.find(f => f.exchange === list.find(a => a.is_default)?.exchange) || cexFunds[0];
        if (defaultEntry) defaultEntry.usdt = usdtBal.free || 0;
      }
    } catch {}

    // 找最优对冲 CEX
    let bestHedgeBuy = null;  // 我卖 KAS 后在哪里买回
    let bestHedgeSell = null; // 我买 KAS 后在哪里卖出
    if (scanner?.live) {
      const spot = scanner.live.filter(v => !v.id.includes('perp'));
      if (spot.length > 0) {
        bestHedgeBuy = spot.reduce((best, v) => v.ask < best.ask ? v : best, spot[0]);
        bestHedgeSell = spot.reduce((best, v) => v.bid > best.bid ? v : best, spot[0]);
      }
    }

    return {
      scanner,
      kasBalance,
      openOffers,
      dailyVolume,
      bestHedgeBuy,
      bestHedgeSell,
      cexFunds,
      remainingDaily: MAX_DAILY_KAS - dailyVolume,
    };
  }

  formatForBrain(gathered) {
    const { scanner, kasBalance, openOffers, dailyVolume, bestHedgeBuy, bestHedgeSell, cexFunds, remainingDaily } = gathered;
    const lines = [];

    lines.push('=== ORDER EXECUTOR ===');

    if (!scanner) {
      lines.push('Scanner data unavailable — run market_scanner first.');
      return { name: this.name, description: this.description, data: lines.join('\n'), instructions: '' };
    }

    const mid = scanner.midPrice;
    if (!mid) {
      lines.push('No mid-price available.');
      return { name: this.name, description: this.description, data: lines.join('\n'), instructions: '' };
    }

    // 状态
    lines.push(`KAS mid: ${mid.toFixed(5)} USDT`);
    lines.push(`Agent KAS: ${kasBalance !== null ? kasBalance + ' KAS' : 'unknown'}`);

    // CEX 对冲资金
    if (cexFunds && cexFunds.length > 0) {
      const parts = cexFunds.map(f => {
        const bal = f.usdt !== null ? `${f.usdt.toFixed(2)} USDT` : 'configured';
        return `${f.label} ${bal}`;
      });
      const anyFunded = cexFunds.some(f => f.usdt !== null && f.usdt > 0);
      lines.push(`CEX hedge funds: ${parts.join(' | ')}${anyFunded ? ' ✓' : ''}`);
    } else {
      lines.push('CEX hedge funds: none configured');
    }

    // 计算建议挂单价
    const sellPrice = mid * (1 + DEFAULT_SPREAD);
    const buyPrice = mid * (1 - DEFAULT_SPREAD);

    // 可用额度
    const maxAmount = Math.min(
      kasBalance !== null ? kasBalance * 0.5 : MAX_PER_ORDER_KAS,
      MAX_PER_ORDER_KAS,
      remainingDaily,
    );

    if (maxAmount < MIN_ORDER_KAS) {
      lines.push(`⚠ Cannot make market: Agent KAS < ${MIN_ORDER_KAS} (minimum)`);
    } else {
      const hedgeName = bestHedgeBuy?.name || 'Gate';
      lines.push('Suggested orders:');
      lines.push(`  SELL ${Math.min(maxAmount, 500).toFixed(0)} KAS @ ${sellPrice.toFixed(5)} → hedge buy @ ${bestHedgeBuy?.name || '?'}`);
      lines.push(`  BUY  ${Math.min(maxAmount, 500).toFixed(0)} KAS @ ${buyPrice.toFixed(5)} → hedge sell @ ${bestHedgeSell?.name || '?'}`);
      lines.push(`[ACTION:MAKE_MARKET amount=${Math.min(maxAmount, 500).toFixed(0)} sell_price=${sellPrice.toFixed(5)} buy_price=${buyPrice.toFixed(5)} hedge_cex=${hedgeName} reason="market making"]`);
    }

    return {
      name: this.name,
      description: this.description,
      data: lines.join('\n'),
      instructions: [
        'You can place market-making orders on KANet free market.',
        'Each MAKE_MARKET creates TWO offers: one sell + one buy.',
        'After someone takes your offer, the system auto-hedges on CEX.',
        'Do NOT exceed the max order amount shown above.',
        'Only place orders when you have a clear reason (spread opportunity, market making duty).',
      ].join(' '),
    };
  }
}
