// autonomous_seller.mjs — Phase 5-4 KI 41 Sub 3/6
// Brain-driven seller persona — goal: publish SELL KAS offer.

import { runAgentLoop, mockSellerBrain } from './_agent_base.mjs';

export default {
  id: 'autonomous_seller',
  name: 'Autonomous Seller Agent',
  description: 'Brain-decision seller — publish SELL KAS offer via /api/exchange/publish',

  async run(persona, opts) {
    const { relayId, qty = 10, pricePerKas = 0.034, expiresMin = 10, brain = mockSellerBrain } = opts;
    if (!relayId) return { stage: 'opts_invalid', error: 'requires relayId' };
    const result = await runAgentLoop({
      id: persona.id,
      persona,
      context: { relayId },
      goal: { kind: 'sell_kas', qty },
      policy: { pricePerKas, expiresMin },
      brainFn: brain,
      maxSteps: opts.maxSteps || 5,
    });
    return {
      stage: result.ok ? 'completed' : 'incomplete',
      reason: result.finalState.completionReason,
      offerId: result.finalState.pendingOfferId,
      step: result.step,
    };
  },
};
