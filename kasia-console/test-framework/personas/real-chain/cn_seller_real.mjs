// Real-chain cn_seller persona — SELL KAS direction via Kasia DM to broker
// User wants to sell KAS, broker buys at offered price → broker pays USDT BSC to user
//
// 接口: async run(persona, opts) → result
//   opts: { relayId, userKasia, brokerKasia, userEvmAddr, qty, chain, fromRelayName }

import {
  dmRoundTrip, parseQuote, sleep, getChainEvents,
} from '../../lib/real-chain-runner.mjs';

export default {
  id: 'cn_seller_real',
  name: '中文卖家 (real-chain DM)',
  description: 'User sells KAS to broker via 6-step DM, expects broker → USDT BSC payment',

  async run(persona, opts) {
    const { relayId, userKasia, brokerKasia, userEvmAddr, qty, chain = 'BSC' } = opts;
    if (!qty || qty < 1) throw new Error(`qty must be >= 1, got ${qty}`);
    const start = new Date().toISOString();
    console.log(`[${persona.id}] start SELL qty=${qty} ${chain}`);

    const chainIndex = chain === 'BSC' ? '1' : chain === 'ETH' ? '2' : '3';
    const steps = [
      ['back', 'reset'],
      ['2', 'SELL'],                      // SELL direction (vs '1' BUY)
      [chainIndex, `recv-chain=${chain}`],  // chain to receive USDT
      [String(qty), `qty=${qty}`],
      [userEvmAddr, 'addr'],
      ['1', 'mid'],
      ['1', 'confirm-1'],
      ['1', 'confirm-2'],
    ];

    let quote = null;
    for (const [msg, label] of steps) {
      const { reply } = await dmRoundTrip(relayId, userKasia, brokerKasia, msg);
      if (!reply) return { stage: 'dm_timeout', step: label };
      quote = parseQuote(reply.content_text);
      if (quote) break;
      await sleep(2500);
    }
    if (!quote) return { stage: 'no_quote' };

    // SELL flow doesn't require user to pay USDT — user sends KAS via Kasia DM to broker
    // (broker autonomously initiates: receives KAS via Kasia transfer + sends USDT BSC to user)
    // For SELL, the "quote" reply may contain instructions instead of broker address
    // This persona just verifies broker reaches quote state

    const events = getChainEvents(start, ['exchange_%', 'broker_%', 'hedge%']);
    const counts = {};
    for (const e of events) counts[e.event_type] = (counts[e.event_type] || 0) + 1;

    return {
      stage: 'sell_quote_received',
      quote,
      events: counts,
    };
  },
};
