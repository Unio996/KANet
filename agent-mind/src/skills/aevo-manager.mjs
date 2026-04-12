/**
 * Aevo Options Manager — Mind Skill
 *
 * Brain sees options positions, Greeks, portfolio summary.
 * Supports AEVO_ORDER / AEVO_CLOSE ACTION tags.
 */

export default class AevoManager {
  constructor(name = 'aevo_manager', description = 'Aevo options: positions, Greeks, portfolio risk') {
    super(name, description);
  }

  get category() { return 'defi'; }
  get activationKeywords() { return ['options', 'greeks', 'aevo', 'put', 'call', 'delta', 'theta', 'vega', 'iv', 'volatility']; }

  async gatherContext(config) {
    const consoleUrl = config.consoleUrl || 'http://localhost:3100';
    const agentId = config.relayNodeId;

    try {
      const [accountRes, positionsRes] = await Promise.all([
        fetch(`${consoleUrl}/api/defi/aevo/account?agentId=${agentId}`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null),
        fetch(`${consoleUrl}/api/defi/aevo/positions?agentId=${agentId}`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null),
      ]);

      if (!accountRes || accountRes.error) {
        return { instructions: 'Aevo: not configured or unreachable.', data: {} };
      }

      const account = accountRes;
      const positions = positionsRes?.positions || [];

      let instructions = '=== AEVO OPTIONS ===\n';
      instructions += `Account: $${account.equity?.toFixed(2) || '?'} equity | $${account.available?.toFixed(2) || '?'} available | Margin: ${account.marginPct?.toFixed(1) || '?'}%\n`;

      if (account.portfolioGreeks) {
        const g = account.portfolioGreeks;
        instructions += `Portfolio Greeks: Delta ${g.delta?.toFixed(2) || '?'} | Gamma ${g.gamma?.toFixed(3) || '?'} | Theta $${g.theta?.toFixed(2) || '?'} | Vega $${g.vega?.toFixed(2) || '?'}\n`;
      }

      if (positions.length > 0) {
        instructions += `\nPositions (${positions.length}):\n`;
        for (const p of positions) {
          instructions += `  ${p.instrument}: ${p.side} ${p.amount} @ $${p.avgPrice?.toFixed(2)} | Mark $${p.markPrice?.toFixed(2)} | PnL ${p.pnl >= 0 ? '+' : ''}$${p.pnl?.toFixed(2)}\n`;
          if (p.greeks) {
            instructions += `    Delta ${p.greeks.delta?.toFixed(2)} | Gamma ${p.greeks.gamma?.toFixed(3)} | Theta $${p.greeks.theta?.toFixed(2)} | IV ${(p.greeks.iv * 100)?.toFixed(0)}%\n`;
          }
        }
      } else {
        instructions += '\nNo open positions.\n';
      }

      instructions += '\nActions: [ACTION:AEVO_ORDER instrument=X side=buy amount=1 price=50] or [ACTION:AEVO_CLOSE instrument=X]\n';

      return { instructions, data: { account, positions } };
    } catch (err) {
      return { instructions: `Aevo error: ${err.message}`, data: {} };
    }
  }
}
