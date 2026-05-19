// sequential_3_round_buy — NWT BUY 3 round distinct qty (Bug AW防 60s gap)
// Verify broker BSC intake + autoTaker pipeline + offer state progression
//
// NWT N19.33-35 framework Phase 3 first case ship.
// Owner 5/19 钦定 "全链测试 + 并发多轮" — sequential variant of multi-round test.
//
// expected (post Phase 1a hedge fix + Path A+B + Option A + J2 #531):
// - 3 broker offers (broker-v3-escrow path) published with hedge_enabled=true metadata
// - autoTaker pipeline fires on each (KANET_TEST_MODE=1 bypass own_offer)
// - 至少 1 offer reach completed → first hedge_placed event lifetime
//
// expensive: true, skip_in_batch: true — manual only via --case=

import cnBuyer from '../../personas/real-chain/cn_buyer_real.mjs';
import { runSequential } from '../../lib/multi-actor-orchestrator.mjs';
import { getRelayInfo, getChainEvents } from '../../lib/real-chain-runner.mjs';

// Hardcoded actor identifiers (verified via getRelayInfo + DB at write time)
const NWT_RELAY = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_KASIA = 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm';
const BROKER_KASIA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const NWT_BSC_ADDR = '0xd3618e37354700d21FE8728Bd278Dc1924974799';

export default {
  id: 'sequential_3_round_buy',
  description: 'NWT BUY 3 round distinct qty (1.1/1.3/1.5 KAS), 60s gap (Bug AW防), verify broker intake + autoTaker pipeline',
  domain: 'broker-realchain',
  tags: ['real_chain', 'expensive', 'p1', 'hedge-verify'],
  skip_in_batch: true,
  expensive: true,

  async run() {
    // pre-flight: verify identities resolvable
    const nwt = getRelayInfo('NWT');
    const broker = getRelayInfo('Trader-B');
    if (!nwt?.address || !broker?.address) {
      return { ok: false, error: 'NWT or Trader-B relay not found' };
    }
    if (nwt.address !== NWT_KASIA || broker.address !== BROKER_KASIA) {
      return { ok: false, error: `relay address mismatch (NWT=${nwt.address} vs ${NWT_KASIA}, Trader-B=${broker.address} vs ${BROKER_KASIA})` };
    }

    const startIso = new Date().toISOString();

    // 3 actors: NWT user same relay, 3 distinct qty (KI 19 防 amount collision)
    const baseOpts = {
      relayId: NWT_RELAY,
      userKasia: NWT_KASIA,
      brokerKasia: BROKER_KASIA,
      userEvmAddr: NWT_BSC_ADDR,
      chain: 'BSC',
      fromRelayName: 'NWT',
    };
    const actors = [
      { id: 'round1_q1.1', personaFn: cnBuyer.run, persona: cnBuyer, opts: { ...baseOpts, qty: 1.1 } },
      { id: 'round2_q1.3', personaFn: cnBuyer.run, persona: cnBuyer, opts: { ...baseOpts, qty: 1.3 } },
      { id: 'round3_q1.5', personaFn: cnBuyer.run, persona: cnBuyer, opts: { ...baseOpts, qty: 1.5 } },
    ];

    // runSequential 60s gap for Bug AW guard race防御
    const orchestratorResult = await runSequential(actors, { wait_between_ms: 60000 });

    // aggregate chain_events
    const allEvents = getChainEvents(startIso, ['hedge%', 'autotake_%', 'exchange_%', 'broker_%']);
    const eventCounts = {};
    for (const e of allEvents) eventCounts[e.event_type] = (eventCounts[e.event_type] || 0) + 1;

    // verdict
    const hedge_fired = (eventCounts['hedge_placed'] || 0) > 0;
    const autotake_fired = (eventCounts['autotake_accepted'] || 0) > 0 || (eventCounts['autotake_skip'] || 0) > 0;
    const completed_count = eventCounts['exchange_completed'] || 0;

    const success = orchestratorResult.success_count >= 2 && autotake_fired;

    return {
      ok: success,
      summary: `${orchestratorResult.success_count}/3 rounds completed flow, autotake_fired=${autotake_fired}, hedge_fired=${hedge_fired}, completions=${completed_count}`,
      details: {
        actors: orchestratorResult.results.map((r) => ({ id: r.id, ok: r.ok, duration_ms: r.duration_ms })),
        event_counts: eventCounts,
        hedge_fired,
        autotake_fired,
        completed_count,
      },
    };
  },
};
