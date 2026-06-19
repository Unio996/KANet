// J2.2 + J2.3 mutation tests for pool-committee-sampler.mjs
// Run: node src/services/pool-committee-sampler.test.mjs

import {
  deriveCommitteeSeed,
  selectCommittee,
  verifyCommitteeSelection,
  COMMITTEE_SIZE,
} from './pool-committee-sampler.mjs';

let failed = 0;
function assert(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}` + (detail ? ` — ${detail}` : '')); failed++; }
}
function expectThrow(name, fn, fragment) {
  try { fn(); assert(name, false, 'expected throw'); }
  catch (e) {
    if (!fragment || e.message.includes(fragment)) assert(name, true);
    else assert(name, false, `wrong msg: "${e.message}" want "${fragment}"`);
  }
}

console.log('[pool-committee-sampler.test] J2.2+J2.3 mutation tests');

// 1. Seed derivation invariants
{
  const seed1 = deriveCommitteeSeed('market-1', '1'.repeat(64), '2'.repeat(64));
  assert('seed is 32 bytes', seed1.length === 32);
  assert('seed deterministic', deriveCommitteeSeed('market-1', '1'.repeat(64), '2'.repeat(64)).equals(seed1));
  assert('different marketId → different seed',
    !deriveCommitteeSeed('market-2', '1'.repeat(64), '2'.repeat(64)).equals(seed1));
  assert('different endBlockHash → different seed',
    !deriveCommitteeSeed('market-1', 'a'.repeat(64), '2'.repeat(64)).equals(seed1));
  assert('different poolMerkleRoot → different seed',
    !deriveCommitteeSeed('market-1', '1'.repeat(64), 'b'.repeat(64)).equals(seed1));
}

expectThrow('seed empty marketId', () => deriveCommitteeSeed('', '1'.repeat(64), '2'.repeat(64)), 'marketId required');
expectThrow('seed wrong endBlockHash', () => deriveCommitteeSeed('m', 'aa', '2'.repeat(64)), 'endBlockHash');
expectThrow('seed wrong poolMerkleRoot', () => deriveCommitteeSeed('m', '1'.repeat(64), 'bb'), 'poolMerkleRoot');

// 2. Pool size constraints
{
  const seed = deriveCommitteeSeed('m', '1'.repeat(64), '2'.repeat(64));
  expectThrow('< 5 members', () => selectCommittee([{ pk_hex: 'aa'.repeat(32), stake_sompi: 1 }], seed), '>= 5');
  expectThrow('zero stake', () => {
    const members = Array.from({ length: 5 }, (_, i) => ({ pk_hex: i.toString(16).repeat(64), stake_sompi: 0 }));
    selectCommittee(members, seed);
  }, 'non-positive stake');
}

// 3. Basic selection (equal stakes, 10 members)
{
  const seed = deriveCommitteeSeed('m', '1'.repeat(64), '2'.repeat(64));
  const members = Array.from({ length: 10 }, (_, i) => ({
    pk_hex: i.toString(16).padStart(2, '0').repeat(32),
    stake_sompi: 1_000_000n,
  }));
  const result = selectCommittee(members, seed);
  assert('5 committee selected', result.selected.length === COMMITTEE_SIZE);
  assert('no duplicate selection', new Set(result.selected.map(s => s.pk_hex)).size === COMMITTEE_SIZE);
  assert('proof has 5 rounds', result.proof.rounds.length === COMMITTEE_SIZE);
  assert('proof seed matches', result.proof.seed_hex === seed.toString('hex'));
}

// 4. Reproducibility — same inputs → same output
{
  const seed = deriveCommitteeSeed('m', '1'.repeat(64), '2'.repeat(64));
  const members = Array.from({ length: 20 }, (_, i) => ({
    pk_hex: i.toString(16).padStart(2, '0').repeat(32),
    stake_sompi: BigInt(100_000 + i * 10_000),
  }));
  const r1 = selectCommittee(members, seed);
  const r2 = selectCommittee(members, seed);
  const r3 = selectCommittee([...members].reverse(), seed); // shuffled input
  for (let i = 0; i < COMMITTEE_SIZE; i++) {
    assert(`reproducible pos ${i} r1==r2`, r1.selected[i].pk_hex === r2.selected[i].pk_hex);
    assert(`shuffle-stable pos ${i} r1==r3`, r1.selected[i].pk_hex === r3.selected[i].pk_hex);
  }
}

// 5. Stake-weighted bias — heavy stake should be selected more often (across many seeds)
{
  const members = [
    { pk_hex: 'aa'.repeat(32), stake_sompi: 1_000_000n },    // small × 4
    { pk_hex: 'bb'.repeat(32), stake_sompi: 1_000_000n },
    { pk_hex: 'cc'.repeat(32), stake_sompi: 1_000_000n },
    { pk_hex: 'dd'.repeat(32), stake_sompi: 1_000_000n },
    { pk_hex: 'ee'.repeat(32), stake_sompi: 1_000_000n },
    { pk_hex: 'ff'.repeat(32), stake_sompi: 100_000_000n }, // whale × 1, 100x stake
  ];
  let whaleHits = 0;
  const trials = 200;
  for (let i = 0; i < trials; i++) {
    const seed = deriveCommitteeSeed(`m-${i}`, '1'.repeat(64), '2'.repeat(64));
    const r = selectCommittee(members, seed);
    if (r.selected.some(s => s.pk_hex === 'ff'.repeat(32))) whaleHits += 1;
  }
  // With 100x stake vs others 5×, whale should be selected most rounds
  assert(`whale selected >= 90% of trials (linear stake-weighted, got ${whaleHits}/${trials})`, whaleHits >= 180);
}

// 6. Verify works (positive)
{
  const seed = deriveCommitteeSeed('m', '1'.repeat(64), '2'.repeat(64));
  const members = Array.from({ length: 10 }, (_, i) => ({
    pk_hex: i.toString(16).padStart(2, '0').repeat(32),
    stake_sompi: 1_000_000n,
  }));
  const result = selectCommittee(members, seed);
  const v = verifyCommitteeSelection(members, seed, result.selected);
  assert('verify positive', v.valid === true);
}

// 7. Verify catches tampering
{
  const seed = deriveCommitteeSeed('m', '1'.repeat(64), '2'.repeat(64));
  const members = Array.from({ length: 10 }, (_, i) => ({
    pk_hex: i.toString(16).padStart(2, '0').repeat(32),
    stake_sompi: 1_000_000n,
  }));
  const result = selectCommittee(members, seed);
  // Swap position 0 and 1
  const tampered = [...result.selected];
  [tampered[0], tampered[1]] = [tampered[1], tampered[0]];
  const v = verifyCommitteeSelection(members, seed, tampered);
  assert('verify catches swap', !v.valid);
  // Try with completely wrong pk
  const wrong = [...result.selected];
  wrong[2] = { pk_hex: 'ff'.repeat(32) };
  const v2 = verifyCommitteeSelection(members, seed, wrong);
  assert('verify catches injected fake pk', !v2.valid);
}

// 8. Wrong-size committee rejected
{
  const members = Array.from({ length: 10 }, (_, i) => ({
    pk_hex: i.toString(16).padStart(2, '0').repeat(32),
    stake_sompi: 1_000_000n,
  }));
  const seed = deriveCommitteeSeed('m', '1'.repeat(64), '2'.repeat(64));
  const v3 = verifyCommitteeSelection(members, seed, [{ pk_hex: 'aa'.repeat(32) }]);
  assert('verify rejects committee size != 5', !v3.valid);
}

// 9. 256-pool boundary
{
  const seed = deriveCommitteeSeed('big-market', '1'.repeat(64), '2'.repeat(64));
  const members = Array.from({ length: 256 }, (_, i) => ({
    pk_hex: (i.toString(16).padStart(4, '0') + 'ff'.repeat(30)).slice(0, 64),
    stake_sompi: BigInt(1_000_000 + i * 1000),
  }));
  const r = selectCommittee(members, seed);
  assert('256-pool returns 5 distinct', new Set(r.selected.map(s => s.pk_hex)).size === COMMITTEE_SIZE);
  const v = verifyCommitteeSelection(members, seed, r.selected);
  assert('256-pool verify PASS', v.valid);
}

console.log(failed === 0 ? '[pool-committee-sampler.test] ALL PASS' : `[pool-committee-sampler.test] ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
