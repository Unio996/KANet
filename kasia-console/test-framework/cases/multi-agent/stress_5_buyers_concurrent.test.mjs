// stress_5_buyers_concurrent — Phase 5-4 KI 42 Sub 5/6
// 5 autonomous buyer agents concurrent on broker — stress test broker DM handling + escrow race.
//
// NWT N19.72 spec, J2 ship.
// real_chain: true (real Kasia DM + real BSC USDT transfer). expensive: true. skip_in_batch.

import { runConcurrent } from '../../lib/multi-actor-orchestrator.mjs';
import autonomousBuyer from '../../personas/agent/autonomous_buyer.mjs';
import { getRelayInfo } from '../../lib/real-chain-runner.mjs';

const BROKER_KASIA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

export default {
  id: 'stress_5_buyers_concurrent',
  description: 'Phase 5-4: 5 autonomous buyer agents concurrent on broker (mock brain, real chain DM)',
  domain: 'multi-agent',
  tags: ['real_chain', 'expensive', 'p1', 'phase-5-4', 'multi-agent'],
  skip_in_batch: true,
  expensive: true,

  async run(opts = {}) {
    const buyerNames = opts.buyerNames || ['NWT'];  // default minimal — Phase 2 expand
    const qtyDist = opts.qtyDist || [50];  // distinct qty per actor to avoid broker collision

    const actors = [];
    for (let i = 0; i < buyerNames.length; i++) {
      const name = buyerNames[i];
      const r = getRelayInfo(name);
      if (!r) return { ok: false, error: `relay ${name} not found` };
      actors.push({
        id: `buyer_${i}_${name}`,
        personaFn: autonomousBuyer.run,
        persona: { id: `buyer_${i}_${name}` },
        opts: {
          relayId: r.id,
          relayName: name,
          userKasia: r.address,
          brokerKasia: BROKER_KASIA,
          userEvmAddr: opts.userEvmAddrs?.[i] || '0xd3618e37354700d21FE8728Bd278Dc1924974799',
          qty: qtyDist[i] || 50,
        },
      });
    }

    // Use runConcurrent (N19.33 sediment) — same-user gap 60s if multiple use same relay (avoid Bug AW race)
    const { results, total_ms, success_count } = await runConcurrent(actors, { stagger_ms: 5_000, summary: true });

    return {
      ok: success_count === actors.length,
      summary: `${success_count}/${actors.length} buyers completed in ${total_ms}ms`,
      details: { results, total_ms },
    };
  },
};
