// Oracle v0.3 sub 2 — oracle-sampler determinism + Area 8 E9 filter regression.
//
// scope: Fisher-Yates + sha256 seed (= blake2b deferred per oracle-sampler.js comment).
// spec: pool-prediction-market-rules-v0.5.md Area 2 + Area 8 E9 sampling filter.
// migration: relies on v143 oracle_registry (= J2-tn sub 1 ship d582bee).

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data/console.db');

export default {
  id: 'oracle_sampler_determinism',
  description: 'Oracle v0.3 sub 2 — Fisher-Yates seed determinism + Area 8 E9 exclude + pool size enforce',
  domain: 'oracle',
  tags: ['regression', 'p0', 'oracle-v0.3', 'sub-2', 'sampler'],
  skip_in_batch: false,

  async run() {
    const failures = [];
    const { sampleOracles, verifySample, _internals } = await import('../../../src/services/oracle-sampler.js');

    // Setup: seed test oracles into oracle_registry (= 5 tier-2 + 1 tier-3 fixture)
    const db = new Database(DB_PATH);
    const testIds = ['test-or-A', 'test-or-B', 'test-or-C', 'test-or-D', 'test-or-E', 'test-or-F'];
    const ins = db.prepare(`
      INSERT OR REPLACE INTO oracle_registry (relay_node_id, pubkey, tier, status, expires_at, bond_amount, epoch)
      VALUES (?, ?, ?, 'active', datetime('now', '+1 hour'), ?, 1)
    `);
    try {
      for (let i = 0; i < 5; i++) ins.run(testIds[i], `pk-${testIds[i]}`, 2, 100);
      ins.run(testIds[5], `pk-${testIds[5]}`, 3, null);

      // I1: deterministic seed — 同 inputs 必返 same sample
      const inputs = { blockHash: '0123456789abcdef0123456789abcdef', marketId: 'market-test-001', n: 3, excludeRelayIds: [], tierFilter: [1, 2, 3], attempt: 0 };
      const r1 = sampleOracles(inputs);
      if (!r1.ok) { failures.push(`I1: first sample fail: ${r1.error}`); return { ok: false, error: failures.join('; ') }; }
      const r2 = sampleOracles(inputs);
      if (JSON.stringify(r1.sampled.map(s => s.relay_node_id).sort()) !== JSON.stringify(r2.sampled.map(s => s.relay_node_id).sort())) {
        failures.push(`I1: determinism failed — r1 ${JSON.stringify(r1.sampled.map(s => s.relay_node_id))} vs r2 ${JSON.stringify(r2.sampled.map(s => s.relay_node_id))}`);
      }

      // I2: different attempt → different sample (= re-sample per Area 2.5)
      const r3 = sampleOracles({ ...inputs, attempt: 1 });
      if (!r3.ok) failures.push(`I2: attempt=1 sample fail: ${r3.error}`);
      if (r1.seed_hex === r3.seed_hex) failures.push(`I2: attempt=0 and attempt=1 should produce different seeds`);

      // I3: Area 8 E9 exclude — maker + broker filtered out
      const excludeId = testIds[0];  // simulate maker
      const r4 = sampleOracles({ ...inputs, excludeRelayIds: [excludeId] });
      if (!r4.ok) failures.push(`I3: exclude sample fail: ${r4.error}`);
      else if (r4.sampled.some(s => s.relay_node_id === excludeId)) {
        failures.push(`I3: excluded relay ${excludeId} appeared in sampled list`);
      }
      if (r4.eligible_count !== 5) {  // 6 total - 1 excluded = 5
        failures.push(`I3: eligible_count expected 5 (6 - 1 excluded), got ${r4.eligible_count}`);
      }

      // I4: tier filter — tier=2 only filters out tier 3
      const r5 = sampleOracles({ ...inputs, tierFilter: [2] });
      if (!r5.ok) failures.push(`I4: tier=2 only sample fail: ${r5.error}`);
      else if (r5.eligible_count !== 5) {  // 5 tier-2 fixtures only
        failures.push(`I4: tier=2 eligible_count expected 5, got ${r5.eligible_count}`);
      }

      // I5: pool size below n → 'pool_size_below_n' error
      const r6 = sampleOracles({ ...inputs, n: 100 });  // need 100, have 6
      if (r6.ok) failures.push(`I5: n=100 should fail pool_size_below_n but ok=true`);
      else if (r6.error !== 'pool_size_below_n') failures.push(`I5: n=100 wrong error '${r6.error}'`);

      // I6: invalid block hash rejected
      const r7 = sampleOracles({ blockHash: 'short', marketId: 'm', n: 3 });
      if (r7.ok) failures.push(`I6: invalid block hash should fail`);
      else if (r7.error !== 'invalid_block_hash') failures.push(`I6: wrong error '${r7.error}'`);

      // I7: verifySample 3rd party reproduce
      const verify = verifySample({
        ...inputs,
        expectedRelayIds: r1.sampled.map(s => s.relay_node_id),
      });
      if (!verify.match) failures.push(`I7: verifySample failed reproduce: expected ${JSON.stringify(verify.expected)} actual ${JSON.stringify(verify.actual)}`);

    } finally {
      // Cleanup fixtures
      for (const id of testIds) {
        try { db.prepare(`DELETE FROM oracle_registry WHERE relay_node_id = ?`).run(id); } catch {}
      }
      db.close();
    }

    if (failures.length > 0) return { ok: false, error: failures.join('; '), failures };
    return { ok: true, summary: 'Oracle v0.3 sub 2 sampler — 7 invariant PASS (determinism / attempt diff / exclude / tier filter / pool size enforce / invalid hash / verify 3rd-party reproduce)' };
  },
};
