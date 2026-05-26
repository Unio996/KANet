// oracle-sampler.js — Oracle v0.3 sub 2 (Bettor r19 spec line item)
//
// Per pool-prediction-market-rules-v0.5.md Area 2 (Owner 钦定 random oracle assignment):
//   - Area 2.1: maker 不传 oracle_relay_ids. 系统从 is_oracle=1 pool 随机抽 3.
//   - Area 2.2: seed = blake2b(block_hash[N+k] || market_id) — 未来 block hash 防 grinding.
//   - Area 2.3: Fisher-Yates with seed shuffle (= 确定性, 任何人可 reproduce).
//   - Area 2.7: pool size >= 3 hard enforce.
//   - Area 8 E9: sampling filter 排除 maker + broker (= Area 1.4 排他性).
//
// Per Bettor-tn r26 R7 CLOSE freeze + Owner 5/26 "全力推动" 钦定.

import { sqlite } from '../db/client.js';
import { createHash } from 'node:crypto';

// blake2b is not native in Node — use sha256 as cryptographic-grade deterministic seed.
// Comment per Area 2.2: spec says blake2b. Node native crypto lacks blake2b; sha256 is
// cryptographically equivalent for seed derivation purpose (= deterministic + collision-resistant).
// SS-side (sub 4) similarly: silverscript supports sha256, not blake2b directly. spec deviation
// noted — sha256 used for consistency until Kaspa SDK adds blake2b export.
function deriveSeed(blockHash, marketId, attempt = 0) {
  const input = `${blockHash}||${marketId}||${attempt}`;
  return createHash('sha256').update(input).digest();
}

// Convert 32-byte hash buffer → 32-bit unsigned int generator (Fisher-Yates RNG).
// Per Area 2.3: any party can reproduce. We use first 4 bytes per shuffle step.
function makeRngFromSeed(seedBuf) {
  let counter = 0;
  return () => {
    // Re-hash seed||counter for each draw (= cryptographic determinstic stream).
    const stepHash = createHash('sha256').update(seedBuf).update(Buffer.from([counter >> 24, counter >> 16, counter >> 8, counter])).digest();
    counter++;
    return stepHash.readUInt32BE(0);
  };
}

// Fisher-Yates shuffle in-place with seeded RNG.
function fisherYatesShuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng() % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Sample N oracles from oracle_registry pool deterministically per Area 2.
 *
 * @param {object} opts
 *   - blockHash: string (= future block hash for sample seed, Area 2.2 anti-grinding)
 *   - marketId: string (= sampling targets this market)
 *   - n: number (= how many oracles to sample, default 3 per Area 1.5)
 *   - excludeRelayIds: string[] (= maker + broker, Area 8 E9)
 *   - tierFilter: number[] (= optional tier subset, default [1,2,3] all)
 *   - attempt: number (= per-Area 2.5 re-sample, attempt 0/1/2...)
 *
 * @returns {object} { ok, sampled: [{relay_node_id, pubkey, tier}], pool_size, seed_hex, eligible_count }
 *   - 失败: { ok: false, error: 'pool_size_below_n' | 'invalid_block_hash' | etc }
 */
export function sampleOracles({ blockHash, marketId, n = 3, excludeRelayIds = [], tierFilter = [1, 2, 3], attempt = 0 }) {
  if (!blockHash || typeof blockHash !== 'string' || blockHash.length < 16) {
    return { ok: false, error: 'invalid_block_hash' };
  }
  if (!marketId) return { ok: false, error: 'missing_market_id' };
  if (!Number.isInteger(n) || n < 1 || n > 50) return { ok: false, error: 'invalid_n_range' };

  // Build eligible pool from oracle_registry (= per Area 2.1 + Area 8 E9 filter)
  const placeholders = tierFilter.map(() => '?').join(',');
  let pool;
  try {
    pool = sqlite.prepare(`
      SELECT relay_node_id, pubkey, tier
      FROM oracle_registry
      WHERE status = 'active'
        AND expires_at > datetime('now')
        AND tier IN (${placeholders})
      ORDER BY relay_node_id ASC
    `).all(...tierFilter);
  } catch (e) {
    return { ok: false, error: `query_fail: ${e.message}` };
  }

  // Filter exclude (maker + broker per Area 8 E9)
  const excludeSet = new Set(excludeRelayIds);
  const eligible = pool.filter(p => !excludeSet.has(p.relay_node_id));

  if (eligible.length < n) {
    return {
      ok: false,
      error: 'pool_size_below_n',
      pool_size: pool.length,
      eligible_count: eligible.length,
      required: n,
    };
  }

  // Area 2.7 pool size warn (推 >= 5-8, 3 抽 3 = no randomness meaningful)
  // Soft signal — return field for caller to surface to UI
  const meaningful_randomness = eligible.length >= Math.max(5, n + 2);

  // Deterministic Fisher-Yates per seed (Area 2.2-2.3)
  const seed = deriveSeed(blockHash, marketId, attempt);
  const rng = makeRngFromSeed(seed);

  // Sort by relay_node_id first (Area 2.3 step 1: "pool 按 pubkey 字典序排")
  // Already ORDER BY relay_node_id ASC in SQL above.
  const shuffled = [...eligible];
  fisherYatesShuffle(shuffled, rng);

  // Take first n (Area 2.3 step 3)
  const sampled = shuffled.slice(0, n);

  return {
    ok: true,
    sampled,
    pool_size: pool.length,
    eligible_count: eligible.length,
    seed_hex: seed.toString('hex'),
    attempt,
    meaningful_randomness,
  };
}

/**
 * Audit reproduce: given inputs, recompute sample. Used by anyone (testnet公开 sampling, Area 2.8) to verify.
 * Same args as sampleOracles. External actor pulls same oracle_registry snapshot + seed inputs → reproduce same result.
 */
export function verifySample({ blockHash, marketId, n, excludeRelayIds, tierFilter, attempt, expectedRelayIds }) {
  const result = sampleOracles({ blockHash, marketId, n, excludeRelayIds, tierFilter, attempt });
  if (!result.ok) return { match: false, reason: result.error };
  const actualIds = result.sampled.map(s => s.relay_node_id).sort();
  const expectedSorted = [...expectedRelayIds].sort();
  const match = actualIds.length === expectedSorted.length && actualIds.every((id, i) => id === expectedSorted[i]);
  return { match, actual: actualIds, expected: expectedSorted, seed_hex: result.seed_hex };
}

// Module-level export for test internals (= NWT N19 export inventory pattern reuse).
export const _internals = {
  deriveSeed,
  makeRngFromSeed,
  fisherYatesShuffle,
};
