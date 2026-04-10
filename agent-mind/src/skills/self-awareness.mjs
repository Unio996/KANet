/**
 * Skill: Self Awareness — 系统自我感知
 *
 * Gives the agent real-time awareness of its own operational state:
 *   - Balance (how much KAS do I have?)
 *   - Recent activity (what did I do recently?)
 *   - Connection stats (how many peers? who's connected?)
 *   - System health (relay running? adapter connected?)
 *   - Spending (how many chain transactions have I made?)
 *
 * This is NOT guessing — it's querying actual Console data.
 * Without this skill, agents fabricate system knowledge from message context.
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

export class SelfAwarenessSkill extends Skill {
  constructor() {
    super('self_awareness', 'Real-time awareness of own balance, activity, connections, and system status');
  }

  canActivate(taskType) {
    this._taskType = taskType;
    return true; // Always active — self-awareness is fundamental
  }

  async gatherContext(kernels, config) {
    const { consoleUrl, relayNodeId, address } = config;

    // Parallel fetch: balance, wallets, profile, recent broadcasts, mind config, portfolio
    const [balance, wallets, profile, broadcasts, mindConfig, polyPositions, brokerAccounts, otcOrders, exchangeOffers] = await Promise.all([
      fetchJson(`${consoleUrl}/api/relay/${relayNodeId}/balance`).catch(() => null),
      fetchJson(`${consoleUrl}/api/relay/${relayNodeId}/wallets`).catch(() => null),
      fetchJson(`${consoleUrl}/api/agent/profile`).catch(() => null),
      fetchJson(`${consoleUrl}/api/chat/messages?channel=kanet-public&limit=20`).catch(() => null),
      fetchJson(`${consoleUrl}/api/relay/${relayNodeId}/mind-config`).catch(() => null),
      fetchJson(`${consoleUrl}/api/predictions/positions?relay_node_id=${relayNodeId}`).catch(() => null),
      fetchJson(`${consoleUrl}/api/broker/accounts`).catch(() => null),
      fetchJson(`${consoleUrl}/api/trade/mm-orders?status=active`).catch(() => null),
      fetchJson(`${consoleUrl}/api/exchange/offers?maker=${encodeURIComponent(address)}&limit=20`).catch(() => null),
    ]);

    // My profile from agent list
    const me = (profile || []).find(a => a.id === relayNodeId);

    // My recent broadcasts
    const myBroadcasts = (broadcasts?.messages || []).filter(m => m.sender_address === address);

    // Balance
    const balanceKas = balance?.balance;

    // Connection stats
    const contactCount = me?.stats?.contactCount || 0;
    const interactionCount = me?.stats?.interactionCount || 0;
    const handshakeCount = me?.stats?.handshakeCount || 0;
    const firstActive = me?.stats?.firstActive || null;

    // Active siblings
    const siblings = (profile || []).filter(a => a.id !== relayNodeId);

    // Multi-chain wallets
    const chainWallets = (wallets?.chains || []).map(w => ({
      chain: w.chain,
      address: w.address,
      usdt: w.usdtBalance || 0,
      usdc: w.usdcBalance || 0,
      native: w.nativeBalance || 0,
    }));

    // Polymarket positions (with human-readable questions)
    const polyPos = (polyPositions?.positions || []).map(p => ({
      question: p.question || p.market?.slice(0, 20) + '...',
      outcome: p.outcome,
      size: p.size,
      avgPrice: p.avgPrice,
      totalCost: p.totalCost,
      closed: p.closed || false,
    }));

    // Broker positions (stocks)
    let stockPositions = [];
    const connectedBroker = (brokerAccounts || []).find(b => b.status === 'connected');
    if (connectedBroker) {
      try {
        const posData = await fetchJson(`${consoleUrl}/api/broker/${connectedBroker.id}/positions`);
        stockPositions = (posData || []).map(p => ({
          symbol: p.symbol, qty: p.qty, avgCost: p.avgCost,
          marketValue: p.marketValue, pnl: p.pnl, pnlPct: p.pnlPct,
        }));
      } catch {}
    }

    // OTC active orders
    const activeOtc = (Array.isArray(otcOrders) ? otcOrders : [])
      .filter(o => !['completed', 'cancelled', 'expired'].includes(o.status))
      .map(o => ({ side: o.side, amount: o.amount, price: o.price, status: o.status }));

    // Exchange offers (free market)
    const allExOffers = exchangeOffers?.offers || [];
    const activeExchangeOffers = allExOffers
      .filter(o => ['open', 'matched', 'verifying', 'awaiting_manual_confirm'].includes(o.protocol_status))
      .map(o => ({
        id: o.id?.slice(0, 8), give: `${o.give_amount} ${o.give_asset}`, want: `${o.want_amount} ${o.want_asset}`,
        status: o.protocol_status, taker_chain: o.taker_chain, expires_at: o.expires_at, updated_at: o.updated_at,
      }));

    return {
      balance: balanceKas,
      balanceLow: balanceKas !== null && balanceKas <= 1.0,
      chainWallets,
      polyPositions: polyPos,
      stockPositions,
      activeOtcOrders: activeOtc,
      activeExchangeOffers,
      brokerConnected: !!connectedBroker,
      brokerName: connectedBroker?.name || null,
      contacts: contactCount,
      interactions: interactionCount,
      handshakes: handshakeCount,
      firstActive,
      recentBroadcastCount: myBroadcasts.length,
      lastBroadcast: myBroadcasts.length > 0 ? myBroadcasts[myBroadcasts.length - 1]?.content?.slice(0, 60) : null,
      siblings: siblings.map(s => s.name),
      vision: mindConfig?.vision || null,
      principles: mindConfig?.principles || [],
      style: mindConfig?.style || null,
    };
  }

  formatForBrain(gathered) {
    const isProactive = this._taskType === 'proactive';
    const lines = [
      `--- YOUR SYSTEM STATUS (real data, not estimated) ---`,
      // Proactive: generalize balance to prevent Brain from quoting exact numbers to strangers
      `KAS Balance: ${gathered.balance !== null
        ? (isProactive
          ? (gathered.balanceLow ? 'LOW' : 'sufficient')
          : gathered.balance + ' KAS')
        : 'unknown'}`,
      gathered.balanceLow ? `⚠ LOW BALANCE — avoid expensive operations (handshakes cost ~0.2 KAS, comms cost ~0.0001 KAS)` : '',
      gathered.chainWallets?.length > 0 ? `Multi-chain wallets:` : '',
      ...(gathered.chainWallets || []).map(w => {
        if (isProactive) {
          // Proactive: only show chain + has-funds indicator, no addresses or exact amounts
          const hasFunds = w.usdt > 0 || w.usdc > 0 || w.native > 0;
          return `  ${w.chain.toUpperCase()}: ${hasFunds ? 'funded' : 'empty'}`;
        }
        const parts = [`  ${w.chain.toUpperCase()}: ${w.address.slice(0, 10)}...`];
        if (w.usdt > 0) parts.push(`${w.usdt.toFixed(2)} USDT`);
        if (w.usdc > 0) parts.push(`${w.usdc.toFixed(2)} USDC`);
        if (w.native > 0) parts.push(`${w.native.toFixed(4)} ${w.chain === 'polygon' ? 'MATIC' : w.chain.toUpperCase()}`);
        if (w.usdt === 0 && w.usdc === 0 && w.native === 0) parts.push('empty');
        return parts.join(' | ');
      }),
      // ── Portfolio: Polymarket ──
      ...(gathered.polyPositions?.length > 0 ? [
        '',
        `Prediction market positions (${gathered.polyPositions.length}):`,
        ...gathered.polyPositions.map(p => {
          const status = p.closed ? ' [CLOSED — pending settlement]' : '';
          return `  "${p.question}" → ${p.outcome} ${p.size} shares @ $${p.avgPrice?.toFixed(3)} (cost $${p.totalCost?.toFixed(2)})${status}`;
        }),
      ] : []),
      // ── Portfolio: Stocks ──
      ...(gathered.stockPositions?.length > 0 ? [
        '',
        `Stock positions (${gathered.brokerName || 'broker'}):`,
        ...gathered.stockPositions.map(p =>
          `  ${p.symbol}: ${p.qty} shares @ $${p.avgCost?.toFixed(2)} → $${p.marketValue?.toFixed(2)} (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct?.toFixed(1)}%)`
        ),
      ] : gathered.brokerConnected ? ['', `Broker (${gathered.brokerName}): connected, no positions`] : []),
      // ── Portfolio: OTC ──
      ...(gathered.activeOtcOrders?.length > 0 ? [
        '',
        `Active OTC orders (${gathered.activeOtcOrders.length}):`,
        ...gathered.activeOtcOrders.map(o =>
          `  ${o.side.toUpperCase()} ${o.amount} KAS @ $${o.price} — ${o.status}`
        ),
      ] : []),
      // ── Exchange Offers (Free Market) ──
      ...(gathered.activeExchangeOffers?.length > 0 ? [
        '',
        `Active Exchange Offers (${gathered.activeExchangeOffers.length}):`,
        ...gathered.activeExchangeOffers.map(o => {
          const staleMs = o.status === 'matched' && o.updated_at ? Date.now() - new Date(o.updated_at).getTime() : 0;
          const staleWarn = staleMs > 30 * 60 * 1000 ? ' ⚠ STALE >30min, no payment' : '';
          return `  [${o.id}] ${o.give} → ${o.want} | ${o.status}${o.taker_chain ? ' via ' + o.taker_chain.toUpperCase() : ''}${staleWarn}`;
        }),
      ] : []),
      '',
      `Contacts: ${gathered.contacts} peers | Interactions: ${gathered.interactions} total | Handshakes: ${gathered.handshakes}`,
      gathered.firstActive ? `Active since: ${gathered.firstActive.slice(0, 10)}` : '',
      `Recent broadcasts by you: ${gathered.recentBroadcastCount}`,
      gathered.lastBroadcast ? `Your last broadcast: "${gathered.lastBroadcast}"` : '',
      gathered.siblings.length > 0 ? `Sibling agents: ${gathered.siblings.join(', ')}` : '',
      gathered.vision ? `Your founding vision: "${gathered.vision}"` : '',
      gathered.principles.length > 0 ? `Your principles: ${gathered.principles.join('; ')}` : '',
      gathered.style ? `Your communication style: ${gathered.style}` : '',
      '',
      'Use this real data in your responses. Do NOT make up numbers or claim capabilities you cannot verify.',
    ];

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: lines.filter(Boolean).join('\n'),
    };
  }
}
