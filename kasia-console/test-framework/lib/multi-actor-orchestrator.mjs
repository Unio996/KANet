// Multi-actor concurrent orchestrator (NWT N19.33 framework sediment)
//
// Spawn N personas concurrently, await all, aggregate results.
// Used by cases/broker-realchain/*.test.mjs for concurrent stress tests.
//
// Each actor = { id, personaFn, persona, opts }
//   personaFn: async (persona, opts) → result
//   persona: persona object (from personas/real-chain/*.mjs)
//   opts: persona-specific {relayId, userKasia, brokerKasia, qty, chain, ...}

import { sleep } from './real-chain-runner.mjs';

export async function runConcurrent(actors, opts = {}) {
  const { stagger_ms = 0, summary = true } = opts;
  const t0 = Date.now();
  console.log(`[orchestrator] spawning ${actors.length} actors concurrently (stagger ${stagger_ms}ms)`);

  const promises = actors.map(async (actor, i) => {
    if (stagger_ms > 0) await sleep(i * stagger_ms);
    const at0 = Date.now();
    try {
      const r = await actor.personaFn(actor.persona, actor.opts);
      return { id: actor.id, ok: true, result: r, duration_ms: Date.now() - at0 };
    } catch (e) {
      return { id: actor.id, ok: false, error: e.message, duration_ms: Date.now() - at0 };
    }
  });

  const results = await Promise.all(promises);
  const total_ms = Date.now() - t0;

  if (summary) {
    console.log(`\n[orchestrator] all ${actors.length} actors done in ${total_ms}ms:`);
    for (const r of results) {
      const mark = r.ok ? '✓' : '✗';
      console.log(`  ${mark} ${r.id} (${r.duration_ms}ms): ${r.ok ? JSON.stringify(r.result).slice(0, 100) : r.error}`);
    }
  }

  return { results, total_ms, success_count: results.filter(r => r.ok).length };
}

// J2 #532 propose — groupByUser auto-batch same-user sequential, different-user concurrent
// Same user can't run concurrent (Bug AW guard race, broker state pollution).
// Different users (different relayId) safe to fire simultaneously.
export async function runMixed(actors, opts = {}) {
  const { same_user_gap_ms = 60000, summary = true } = opts;
  const t0 = Date.now();

  // Group actors by opts.relayId (same user → same group)
  const byUser = {};
  for (const a of actors) {
    const key = a.opts?.relayId || a.id;
    (byUser[key] = byUser[key] || []).push(a);
  }
  const groups = Object.values(byUser);

  console.log(`[orchestrator] runMixed: ${actors.length} actors → ${groups.length} user groups (same-user serial gap ${same_user_gap_ms}ms, different-user concurrent wait=0)`);

  // Each group runs actors sequentially internally
  // All groups run in parallel
  const groupPromises = groups.map(async (group) => {
    const groupResults = [];
    for (const [i, actor] of group.entries()) {
      if (i > 0) await sleep(same_user_gap_ms);
      const at0 = Date.now();
      try {
        const r = await actor.personaFn(actor.persona, actor.opts);
        groupResults.push({ id: actor.id, ok: true, result: r, duration_ms: Date.now() - at0 });
      } catch (e) {
        groupResults.push({ id: actor.id, ok: false, error: e.message, duration_ms: Date.now() - at0 });
      }
    }
    return groupResults;
  });

  const groupedResults = await Promise.all(groupPromises);
  const results = groupedResults.flat();
  const total_ms = Date.now() - t0;

  if (summary) {
    console.log(`\n[orchestrator] runMixed done in ${total_ms}ms (${groups.length} parallel groups):`);
    for (const r of results) {
      const mark = r.ok ? '✓' : '✗';
      console.log(`  ${mark} ${r.id} (${r.duration_ms}ms)`);
    }
  }

  return { results, total_ms, success_count: results.filter(r => r.ok).length };
}

export async function runSequential(actors, opts = {}) {
  const { wait_between_ms = 60000, summary = true } = opts;
  const t0 = Date.now();
  console.log(`[orchestrator] running ${actors.length} actors sequentially (gap ${wait_between_ms}ms)`);

  const results = [];
  for (const [i, actor] of actors.entries()) {
    if (i > 0) {
      console.log(`  [gap ${wait_between_ms}ms before ${actor.id}]`);
      await sleep(wait_between_ms);
    }
    const at0 = Date.now();
    try {
      const r = await actor.personaFn(actor.persona, actor.opts);
      results.push({ id: actor.id, ok: true, result: r, duration_ms: Date.now() - at0 });
    } catch (e) {
      results.push({ id: actor.id, ok: false, error: e.message, duration_ms: Date.now() - at0 });
    }
  }

  const total_ms = Date.now() - t0;
  if (summary) {
    console.log(`\n[orchestrator] sequential done in ${total_ms}ms:`);
    for (const r of results) {
      const mark = r.ok ? '✓' : '✗';
      console.log(`  ${mark} ${r.id} (${r.duration_ms}ms): ${r.ok ? JSON.stringify(r.result).slice(0, 100) : r.error}`);
    }
  }

  return { results, total_ms, success_count: results.filter(r => r.ok).length };
}
