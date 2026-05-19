// Real-chain cn_buyer persona — Owner DM 风格 中文买家 via Kasia
// Adapted from personas/cn_newbie.mjs for real-chain DM context
// Drives broker BUY flow + real USDT transfer + waits completion + reports
//
// 接口: async personaFn(persona, opts) → result
//   opts: { relayId, userKasia, brokerKasia, userEvmAddr, qty, chain, fromRelayName }

import {
  brokerBuyFlow, transferEvmUsdt, pollOfferStatus,
  getChainEvents, sleep,
} from '../../lib/real-chain-runner.mjs';

export default {
  id: 'cn_buyer_real',
  name: '中文真人买家 (real-chain DM)',
  description: 'NWT-style user — 6-step DM via Kasia, real USDT pay, wait for KAS deliver',

  // 接口 fn — used by orchestrator
  async run(persona, opts) {
    const { relayId, userKasia, brokerKasia, userEvmAddr, qty, chain = 'BSC', fromRelayName = 'NWT' } = opts;
    const start = new Date().toISOString();
    console.log(`[${persona.id}] start qty=${qty} ${chain}`);

    // Step 1: drive DM flow until quote captured
    const flow = await brokerBuyFlow(relayId, userKasia, brokerKasia, { qty, chain, userEvmAddr });
    if (!flow.ok) {
      return { stage: 'dm_flow_fail', error: flow.error };
    }
    const { amount, address } = flow.quote;
    console.log(`[${persona.id}] quote: ${amount} USDT → ${address.slice(0, 10)}...`);

    // Step 2: real USDT transfer
    const chainKey = chain.toLowerCase() === 'bsc' ? 'bnb' : chain.toLowerCase();
    let payTx;
    try {
      payTx = await transferEvmUsdt(fromRelayName, chainKey, amount, address);
    } catch (e) {
      return { stage: 'pay_fail', error: e.message, quote: flow.quote };
    }
    console.log(`[${persona.id}] pay tx: ${payTx}`);

    // Step 3: wait broker offer publication (broker-bsc-intake-escrow publishes after intake)
    await sleep(60000);  // give broker 60s to detect + publish

    // Step 4: find broker offer for this escrow
    const events = getChainEvents(start, ['hedge_%', 'autotake_%', 'exchange_%', 'broker_%']);
    const stageCounts = {};
    for (const e of events) stageCounts[e.event_type] = (stageCounts[e.event_type] || 0) + 1;

    return {
      stage: 'completed_flow',
      quote: flow.quote,
      payTx,
      events: stageCounts,
    };
  },
};
