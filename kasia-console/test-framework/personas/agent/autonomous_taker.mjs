// autonomous_taker.mjs — Phase 5-4 KI 41 Sub 4/6
// Brain-driven taker persona — goal: scan open offers, accept best match.

import { runAgentLoop, mockTakerBrain } from './_agent_base.mjs';

export default {
  id: 'autonomous_taker',
  name: 'Autonomous Taker Agent',
  description: 'Brain-decision taker — scan open SELL offers, accept best (lowest price)',

  async run(persona, opts) {
    const { relayId, userKasia, maxKasQty = 200, maxUsdtPay = 10, brain = mockTakerBrain } = opts;
    if (!relayId) return { stage: 'opts_invalid', error: 'requires relayId' };
    const result = await runAgentLoop({
      id: persona.id,
      persona,
      context: { relayId, userKasia },
      goal: { kind: 'take_offer' },
      policy: { maxKasQty, maxUsdtPay },
      brainFn: brain,
      maxSteps: opts.maxSteps || 3,
    });
    return {
      stage: result.ok ? 'completed' : 'incomplete',
      reason: result.finalState.completionReason,
      offerId: result.finalState.pendingOfferId,
      step: result.step,
    };
  },
};
