// autonomous_buyer.mjs — Phase 5-4 KI 41 Sub 2/6
// Brain-driven buyer persona — goal: buy N KAS via broker DM flow.

import { runAgentLoop, mockBuyerBrain } from './_agent_base.mjs';

export default {
  id: 'autonomous_buyer',
  name: 'Autonomous Buyer Agent',
  description: 'Brain-decision buyer — goal-driven broker BUY KAS flow (DM → quote → pay)',

  async run(persona, opts) {
    const { relayId, relayName = 'NWT', userKasia, brokerKasia, userEvmAddr, qty = 50, brain = mockBuyerBrain } = opts;
    if (!relayId || !userKasia || !brokerKasia || !userEvmAddr) {
      return { stage: 'opts_invalid', error: 'requires relayId, userKasia, brokerKasia, userEvmAddr' };
    }
    const result = await runAgentLoop({
      id: persona.id,
      persona,
      // KI 46.1 #1: thread metricsSink through context for broker DM latency reporting
      context: { relayId, relayName, userKasia, brokerKasia, userEvmAddr, metricsSink: opts.metricsSink },
      goal: { kind: 'buy_kas', qty },
      policy: opts.policy || { maxStepUsdt: 20 },
      brainFn: brain,
      maxSteps: opts.maxSteps || 15,
    });
    return {
      stage: result.ok ? 'completed' : 'incomplete',
      reason: result.finalState.completionReason,
      step: result.step,
      historyCount: result.history.length,
      lastTx: result.history.find(h => h.tx)?.tx || null,
    };
  },
};
