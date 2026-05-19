// External maker persona — direct /api/exchange/publish (Option B, NWT N19.25)
// Bypasses broker DM, publishes offer as external market maker
//
// 接口: async run(persona, opts) → result
//   opts: { relayId, give_asset, give_amount, give_chain, want_asset, want_amount, want_chain,
//           accepted_chains, expected_asset, receive_chain }

import {
  publishOffer, pollOfferStatus, pollChainEvents, getChainEvents, sleep,
} from '../../lib/real-chain-runner.mjs';

export default {
  id: 'external_maker',
  name: '外部 maker (direct /api/exchange/publish)',
  description: 'Bypass broker DM, publish offer directly as market participant — verify autoTaker pipeline trigger',

  async run(persona, opts) {
    const start = new Date().toISOString();
    console.log(`[${persona.id}] publish ${opts.give_amount}${opts.give_asset}→${opts.want_amount}${opts.want_asset}`);

    const result = await publishOffer({
      relayId: opts.relayId,
      give_asset: opts.give_asset,
      give_amount: String(opts.give_amount),
      give_chain: opts.give_chain,
      want_asset: opts.want_asset,
      want_amount: String(opts.want_amount),
      want_chain: opts.want_chain,
      accepted_chains: opts.accepted_chains,
      expected_asset: opts.expected_asset,
      receive_chain: opts.receive_chain,
      expires_minutes: opts.expires_minutes || 30,
      verification: 'cross_chain_tx',
    });

    if (!result.ok) {
      return { stage: 'publish_fail', error: result.error, http_body: result };
    }
    console.log(`[${persona.id}] published offer ${result.offer_id.slice(0,12)} tx ${result.broadcast_tx?.slice(0,16)}`);

    // Wait short period for autoTaker pipeline to fire
    await sleep(10000);

    // Check for autoTaker activity
    const events = await pollChainEvents(start, ['autotake_%', 'exchange_%', 'hedge%'], {
      timeoutMs: 90000, pollMs: 5000,
      untilFound: (e) => e.event_type === 'autotake_accepted' || e.event_type === 'hedge_placed' || e.event_type === 'exchange_completed',
    });

    // Final state
    const finalOffer = await pollOfferStatus(result.offer_id, { timeoutMs: 60000, pollMs: 5000 });
    const allEvents = getChainEvents(start, ['autotake_%', 'exchange_%', 'hedge%']);
    const counts = {};
    for (const e of allEvents) counts[e.event_type] = (counts[e.event_type] || 0) + 1;

    return {
      stage: 'publish_complete',
      offer_id: result.offer_id,
      broadcast_tx: result.broadcast_tx,
      final_offer: finalOffer ? {
        status: finalOffer.protocol_status,
        taker: finalOffer.taker,
        completed_at: finalOffer.completed_at,
      } : null,
      events: counts,
      autotake_fired: !!events.match,
    };
  },
};
