// multi_agent_hedge_verify — Agent-to-agent autonomous trade, verify broker hedge fire.
//
// Owner 5/20 redirect: KANet = agent-to-agent autonomous market, no human-mimic.
// Test = autonomous agent persona drives broker offer accept → completion → hedge.
//
// Flow (10 min):
// 1. Read broker open SELL KAS offer (broker market_seeker 持续挂)
// 2. NWT agent (liquidity_hunter persona) decides to take if any
// 3. NWT accepts offer via /api/exchange/accept (Kasia API, not browser DOM)
// 4. broker auto-pay USDT → NWT sends KAS via Kasia (verification path)
// 5. broker offer completed → executeHedgeGuarded fire
// 6. verify hedge_placed event lifetime 0→1 (KI 27 fix: Bybit precision truncate)

import liquidityHunter from '../../personas/agents/liquidity_hunter.mjs';
import { getRelayInfo, getChainEvents, sleep, pollOfferStatus } from '../../lib/real-chain-runner.mjs';
import Database from 'better-sqlite3';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';

export default {
  id: 'multi_agent_hedge_verify',
  description: 'Agent-to-agent autonomous: NWT agent takes broker SELL offer → completion → hedge_placed verify',
  domain: 'broker-realchain',
  tags: ['real_chain', 'expensive', 'p0', 'hedge-verify', 'agent-vision'],
  skip_in_batch: true,
  expensive: true,

  async run() {
    const startIso = new Date().toISOString();
    console.log(`[multi_agent_hedge_verify] start ${startIso}`);

    // pre-flight: hedge baseline
    let hedgeBaseline, failBaseline;
    {
      const db = new Database(DB_PATH, { readonly: true });
      hedgeBaseline = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_placed'`).get().c;
      failBaseline = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_failed'`).get().c;
      db.close();
    }
    console.log(`[multi_agent_hedge_verify] baseline hedge_placed=${hedgeBaseline} hedge_failed=${failBaseline}`);

    const nwt = getRelayInfo('NWT');
    if (!nwt) return { ok: false, error: 'NWT relay not found' };

    // Step 1-2: NWT agent decides → execute
    console.log(`[multi_agent_hedge_verify] NWT agent tick`);
    const decision = await liquidityHunter.run(
      { id: 'multi_agent_hedge_NWT' },
      { relayId: nwt.id, maxAcceptAmount: 50, minDiscountPct: -100 },  // -100 means accept any
    );
    console.log(`[multi_agent_hedge_verify] NWT decision:`, JSON.stringify(decision).slice(0, 250));

    if (decision.stage !== 'completed_action' || decision.action !== 'accept') {
      return {
        ok: false,
        error: `agent didn't accept: ${decision.error || decision.result?.error || 'no broker SELL offer available'}`,
        decision,
      };
    }
    const offerId = decision.result?.offer_id;
    if (!offerId) return { ok: false, error: 'no offer_id in accept result', decision };

    // Step 3-4: wait broker completion (5 min max)
    console.log(`[multi_agent_hedge_verify] wait offer ${offerId.slice(0,8)} complete (5 min max)`);
    const finalOffer = await pollOfferStatus(offerId, { timeoutMs: 5 * 60 * 1000, pollMs: 5000 });
    console.log(`[multi_agent_hedge_verify] final state: ${finalOffer?.protocol_status || 'TIMEOUT'}`);

    // Step 5: wait hedge fire window (10s post-completion)
    await sleep(10000);

    // Step 6: verify hedge_placed
    let hedgeFinal, failFinal;
    {
      const db = new Database(DB_PATH, { readonly: true });
      hedgeFinal = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_placed'`).get().c;
      failFinal = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_failed'`).get().c;
      db.close();
    }
    const hedgeFired = hedgeFinal > hedgeBaseline;
    const hedgeFailed = failFinal > failBaseline;

    const events = getChainEvents(startIso, ['hedge%', 'exchange_%']);
    const counts = {};
    for (const e of events) counts[e.event_type] = (counts[e.event_type] || 0) + 1;

    return {
      ok: finalOffer?.protocol_status === 'completed' && hedgeFired,
      summary: `offer=${offerId.slice(0,12)} final=${finalOffer?.protocol_status || 'TIMEOUT'} hedge_placed=${hedgeBaseline}→${hedgeFinal} (fired=${hedgeFired}) hedge_failed=${failBaseline}→${failFinal}`,
      details: {
        offer_id: offerId,
        final_offer_status: finalOffer?.protocol_status,
        hedge_baseline: hedgeBaseline,
        hedge_final: hedgeFinal,
        hedge_fired: hedgeFired,
        hedge_failed_delta: failFinal - failBaseline,
        event_counts: counts,
        decision: decision.result,
      },
    };
  },
};
