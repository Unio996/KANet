// liquidity_hunter — Autonomous agent: scan broker open SELL offer, take if price favorable.
// Owner 5/20 redirect: agent (not human). decision = rule-based threshold.

import { AgentBase } from './shared/agent-base.mjs';

export default {
  id: 'liquidity_hunter',
  name: 'Liquidity Hunter Agent',
  description: 'autonomous arbitrage agent — accepts broker SELL KAS offer if discount available',

  async run(persona, opts) {
    const { relayId, maxAcceptAmount = 1.5, minDiscountPct = 0 } = opts;
    const agent = new (class extends AgentBase {
      async decide(state) {
        const market = state.marketPrice;
        if (!market) return { kind: 'idle', reason: 'no market price' };
        // Find broker SELL KAS offer (broker gives KAS, wants USDT)
        const candidates = (state.openOffers || []).filter(o =>
          o.give_asset === 'KAS' && o.want_asset === 'USDT'
          && parseFloat(o.give_amount) <= maxAcceptAmount
          && o.maker !== state.selfAddress  // skip own
        );
        if (!candidates.length) return { kind: 'idle', reason: 'no broker SELL offer in size' };
        // Score by discount (lower price = better deal for taker)
        candidates.sort((a, b) => (parseFloat(a.want_amount) / parseFloat(a.give_amount))
                                - (parseFloat(b.want_amount) / parseFloat(b.give_amount)));
        const best = candidates[0];
        const offerPrice = parseFloat(best.want_amount) / parseFloat(best.give_amount);
        const discountPct = ((market - offerPrice) / market) * 100;
        // If minDiscountPct=0, accept any (used for hedge_verify smoke; production agent uses > threshold)
        if (discountPct < minDiscountPct) return { kind: 'idle', reason: `discount ${discountPct.toFixed(2)}% < min ${minDiscountPct}%` };
        return {
          kind: 'accept',
          offer_id: best.id,
          chain: best.want_chain || 'bnb',
          asset: 'USDT',
          reason: `accept ${best.id.slice(0,8)} discount ${discountPct.toFixed(2)}% market=${market} offer=${offerPrice.toFixed(6)}`,
        };
      }
    })({ id: persona.id, relayId, role: 'liquidity_hunter' });

    const result = await agent.tick();
    return {
      stage: result.ok ? 'completed_action' : 'fail',
      action: result.action,
      result: result.result,
      error: result.error,
    };
  },
};
