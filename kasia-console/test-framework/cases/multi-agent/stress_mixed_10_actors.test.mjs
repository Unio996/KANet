// stress_mixed_10_actors — Phase 5-4 KI 42 Sub 6a/6
// Mixed actors: N buyer + M seller + K taker concurrent.
// Tests broker + autoTaker + cross-match interaction under load.
//
// NWT N19.72 spec, J2 ship.

import { runConcurrent } from '../../lib/multi-actor-orchestrator.mjs';
import autonomousBuyer from '../../personas/agent/autonomous_buyer.mjs';
import autonomousSeller from '../../personas/agent/autonomous_seller.mjs';
import autonomousTaker from '../../personas/agent/autonomous_taker.mjs';
import { getRelayInfo } from '../../lib/real-chain-runner.mjs';

const BROKER_KASIA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

export default {
  id: 'stress_mixed_10_actors',
  description: 'Phase 5-4: mixed N buyer + M seller + K taker concurrent (real chain)',
  domain: 'multi-agent',
  tags: ['real_chain', 'expensive', 'p1', 'phase-5-4', 'multi-agent', 'stress'],
  skip_in_batch: true,
  expensive: true,

  async run(opts = {}) {
    const config = opts.config || {
      buyers: [],   // [{ relayName, userEvmAddr, qty }]
      sellers: [],  // [{ relayName, qty, pricePerKas }]
      takers: [],   // [{ relayName, maxKasQty, maxUsdtPay }]
    };

    const actors = [];

    for (let i = 0; i < (config.buyers?.length || 0); i++) {
      const b = config.buyers[i];
      const r = getRelayInfo(b.relayName);
      if (!r) continue;
      actors.push({
        id: `buyer_${i}_${b.relayName}`,
        personaFn: autonomousBuyer.run,
        persona: { id: `buyer_${i}_${b.relayName}` },
        opts: { relayId: r.id, relayName: b.relayName, userKasia: r.address, brokerKasia: BROKER_KASIA, userEvmAddr: b.userEvmAddr, qty: b.qty },
      });
    }
    for (let i = 0; i < (config.sellers?.length || 0); i++) {
      const s = config.sellers[i];
      const r = getRelayInfo(s.relayName);
      if (!r) continue;
      actors.push({
        id: `seller_${i}_${s.relayName}`,
        personaFn: autonomousSeller.run,
        persona: { id: `seller_${i}_${s.relayName}` },
        opts: { relayId: r.id, qty: s.qty, pricePerKas: s.pricePerKas, expiresMin: s.expiresMin ?? 10 },
      });
    }
    for (let i = 0; i < (config.takers?.length || 0); i++) {
      const t = config.takers[i];
      const r = getRelayInfo(t.relayName);
      if (!r) continue;
      actors.push({
        id: `taker_${i}_${t.relayName}`,
        personaFn: autonomousTaker.run,
        persona: { id: `taker_${i}_${t.relayName}` },
        opts: { relayId: r.id, userKasia: r.address, maxKasQty: t.maxKasQty, maxUsdtPay: t.maxUsdtPay },
      });
    }

    if (actors.length === 0) {
      return { ok: false, error: 'no actors configured — pass opts.config.{buyers,sellers,takers}[]' };
    }

    const { results, total_ms, success_count } = await runConcurrent(actors, { stagger_ms: 3_000, summary: true });

    return {
      ok: success_count >= Math.floor(actors.length * 0.8),  // 80% success threshold
      summary: `${success_count}/${actors.length} actors completed in ${total_ms}ms (80% threshold)`,
      details: { results, total_ms, actor_count: actors.length },
    };
  },
};
