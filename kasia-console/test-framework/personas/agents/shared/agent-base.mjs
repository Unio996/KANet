// agent-base.mjs — KANet agent persona shared helpers
// Owner 5/20 钦定 redirect: "这里没有真人, 只有越来越聪明的框架和智能体"
// agent personas = autonomous AI agents (not human-mimics). Decision = rule-based OR brain LLM.

import {
  dmRoundTrip, parseQuote, transferEvmUsdt, sleep,
  getRelayInfo, getChainEvents,
} from '../../../lib/real-chain-runner.mjs';

const CONSOLE_URL = 'http://127.0.0.1:3100';

/**
 * Read open offer market state — agent decision input.
 * Returns: [{ id, maker, give_asset, give_amount, want_asset, want_amount, give_chain, want_chain, expires_at }]
 */
export async function readOpenOffers(filter = {}) {
  const res = await fetch(`${CONSOLE_URL}/api/exchange/offers?status=open`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const data = await res.json();
  const offers = data.offers || data.items || [];
  if (filter.give_asset) return offers.filter(o => o.give_asset === filter.give_asset);
  if (filter.want_asset) return offers.filter(o => o.want_asset === filter.want_asset);
  return offers;
}

/**
 * Read KAS market price (agent uses for strategy decisions).
 */
export async function readMarketPrice() {
  try {
    const res = await fetch(`${CONSOLE_URL}/api/trade/kas-price`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.price || data.mid || null;
  } catch { return null; }
}

/**
 * Accept an offer (agent action — broker is taker via Kasia API).
 */
export async function acceptOffer(relayId, offerId, selectedChain = 'bnb', paymentAsset = 'USDT') {
  const res = await fetch(`${CONSOLE_URL}/api/exchange/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: relayId, offer_id: offerId, selected_chain: selectedChain, payment_asset: paymentAsset }),
  });
  return res.json().catch(() => ({ ok: false }));
}

/**
 * Publish offer (agent action — broker is maker via Kasia API).
 */
export async function publishAgentOffer(relayId, body) {
  const res = await fetch(`${CONSOLE_URL}/api/exchange/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: relayId, ...body }),
  });
  return res.json().catch(() => ({ ok: false }));
}

/**
 * Agent decision base — agent persona implements decide(state) → action.
 * state = { marketPrice, openOffers, walletBalances, ...persona-specific }
 * action = { kind: 'accept'|'publish'|'dm'|'idle', ... }
 */
export class AgentBase {
  constructor({ id, relayId, role, strategy = 'rule-based' }) {
    this.id = id;
    this.relayId = relayId;
    this.role = role;
    this.strategy = strategy;
    this.state = {};
  }

  async snapshot() {
    this.state.marketPrice = await readMarketPrice();
    this.state.openOffers = await readOpenOffers();
    return this.state;
  }

  async decide(_state) {
    throw new Error('AgentBase.decide() must be overridden by persona');
  }

  async execute(action) {
    if (!action || action.kind === 'idle') return { ok: true, action: 'idle' };
    if (action.kind === 'accept') {
      const r = await acceptOffer(this.relayId, action.offer_id, action.chain || 'bnb', action.asset || 'USDT');
      return { ok: r.ok !== false, action: 'accept', result: r };
    }
    if (action.kind === 'publish') {
      const r = await publishAgentOffer(this.relayId, action.body);
      return { ok: r.ok !== false, action: 'publish', result: r };
    }
    return { ok: false, error: `unknown action kind: ${action.kind}` };
  }

  async tick() {
    const state = await this.snapshot();
    const action = await this.decide(state);
    return this.execute(action);
  }
}
