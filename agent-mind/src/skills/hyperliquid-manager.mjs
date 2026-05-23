/**
 * Hyperliquid Manager — Mind skill for perpetual futures awareness
 *
 * Feeds Brain with positions, PnL, funding rates, and account status.
 * Supports HYPER_OPEN and HYPER_CLOSE actions.
 */

import { BaseSkill } from './base.mjs';

export default class HyperliquidManager extends BaseSkill {
  constructor() {
    super('hyperliquid_manager', 'Hyperliquid perpetual futures — positions, PnL, funding rates, trading');
  }

  get triggerKeywords() {
    return ['perpetual', 'perp', 'futures', 'hyperliquid', 'short', 'long', 'leverage', 'funding rate', 'liquidation'];
  }

  async gatherContext(api) {
    try {
      // Find Arbitrum wallet
      const wallets = await api.get('/api/relay/' + api.relayId + '/wallets');
      const arbWallet = (wallets || []).find(w => w.chain === 'arbitrum' && w.is_default);
      if (!arbWallet) return { instructions: 'Hyperliquid: No Arbitrum wallet configured. Need one to trade perpetuals.' };

      const status = await api.get(`/api/defi/hyperliquid/status?walletId=${arbWallet.id}`);
      if (!status?.ok) return { instructions: 'Hyperliquid: Unable to fetch account status.' };

      return {
        instructions: this.formatForBrain(status),
        data: status,
      };
    } catch (err) {
      return { instructions: `Hyperliquid: Error — ${err.message}` };
    }
  }

  formatForBrain(status) {
    const { account, positions, funding } = status;
    const lines = ['=== HYPERLIQUID PERPETUALS ==='];

    // Account overview
    const marginPct = account.totalMarginUsed > 0
      ? ((account.totalMarginUsed / account.accountValue) * 100).toFixed(1)
      : '0';
    lines.push(`Account: $${account.accountValue.toFixed(2)} | Margin: $${account.totalMarginUsed.toFixed(2)} (${marginPct}%) | Available: $${account.withdrawable.toFixed(2)}`);

    // Positions
    if (positions && positions.length > 0) {
      lines.push('');
      lines.push(`Positions (${positions.length}):`);
      for (const p of positions) {
        const dir = p.size > 0 ? 'LONG' : 'SHORT';
        const pnlSign = p.pnl >= 0 ? '+' : '';
        lines.push(`  ${p.asset}-PERP: ${dir} ${Math.abs(p.size)} @ $${p.entryPrice.toFixed(2)} | PnL: ${pnlSign}$${p.pnl.toFixed(2)} | ${p.leverage}x`);
        if (p.liquidationPrice) {
          lines.push(`    Liq: $${p.liquidationPrice.toFixed(2)} | Margin: $${p.marginUsed.toFixed(2)}`);
        }
      }
    } else {
      lines.push('No open positions.');
    }

    // Funding rates
    if (funding && funding.length > 0) {
      lines.push('');
      lines.push('Funding Rates (8h):');
      for (const f of funding) {
        if (f.fundingRate !== null) {
          const rate = (f.fundingRate * 100).toFixed(4);
          lines.push(`  ${f.asset}: ${rate}%`);
        }
      }
    }

    // Actions
    lines.push('');
    lines.push('Actions:');
    lines.push('  [ACTION:HYPER_OPEN asset=ETH side=SHORT size=0.1 leverage=5 stop_loss=3580]');
    lines.push('  [ACTION:HYPER_CLOSE asset=ETH]');
    lines.push('Rules: stop_loss mandatory. Max leverage 5x. Max position $50.');

    return lines.join('\n');
  }
}
