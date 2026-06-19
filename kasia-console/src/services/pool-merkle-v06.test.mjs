// J2.1 mutation tests — pool-merkle-v06.mjs byte-identical cross-impl verify with PoolSpine_v06.sil
// + PoolSide_v06.sil position-aware climb (d5d4ecbdd r126 fix).
//
// Run: node src/services/pool-merkle-v06.test.mjs
// Exit 0 = all PASS, non-0 = at least 1 FAIL.

import {
  buildPoolMerkleTree,
  getPoolMerkleProof,
  verifyPoolMerkleProof,
  hashPoolLeaf,
  deriveCommitteePkHash,
  POOL_DEPTH,
  POOL_MAX_SIZE,
} from './pool-merkle-v06.mjs';

let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}` + (detail ? ` — ${detail}` : ''));
    failed++;
  }
}

function expectThrow(name, fn, fragment) {
  try {
    fn();
    assert(name, false, 'expected throw');
  } catch (e) {
    if (!fragment || e.message.includes(fragment)) assert(name, true);
    else assert(name, false, `wrong msg: "${e.message}" want "${fragment}"`);
  }
}

console.log('[pool-merkle-v06.test] J2.1 mutation tests');

// 1. hashPoolLeaf invariants
{
  const pk = 'a'.repeat(64);
  const leaf = hashPoolLeaf(pk);
  assert('leaf is 32 bytes', leaf.length === 32);
  assert('hashPoolLeaf deterministic', hashPoolLeaf(pk).equals(leaf));
  assert('hashPoolLeaf differs from input', !leaf.equals(Buffer.from(pk, 'hex')));
  assert('0x prefix tolerated', hashPoolLeaf('0x' + pk).equals(leaf));
}

expectThrow('hashPoolLeaf invalid hex', () => hashPoolLeaf('z'.repeat(64)), '64 hex');
expectThrow('hashPoolLeaf wrong length', () => hashPoolLeaf('aa'), '64 hex');

// 2. Pool size constraints
expectThrow('empty pool', () => buildPoolMerkleTree([]), 'pool empty');
expectThrow('oversize pool', () => buildPoolMerkleTree(Array(POOL_MAX_SIZE + 1).fill('a'.repeat(64))), 'exceeds max');
expectThrow('non-array', () => buildPoolMerkleTree('not array'), 'array');

// 3. Single-leaf pool (= committee always at index 0)
{
  const pk = 'b'.repeat(64);
  const tree = buildPoolMerkleTree([pk]);
  assert('single-leaf tree depth+1 levels', tree.levels.length === POOL_DEPTH + 1);
  assert('root is 32 bytes', tree.root.length === 32);
  assert('sortedPks 1 elem', tree.sortedPks.length === 1);
  const proof = getPoolMerkleProof(tree, 0);
  assert('single-leaf proof depth', proof.length === POOL_DEPTH);
  assert('single-leaf verify PASS', verifyPoolMerkleProof(pk, 0, proof, tree.root));
}

// 4. 4-leaf pool — covers position 0, 1, 2, 3 (= mirrors J2 r105 broken-climb counter-test)
{
  const pks = ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32), 'dd'.repeat(32)];
  const tree = buildPoolMerkleTree(pks);
  assert('4-leaf sort ascending', tree.sortedPks[0] < tree.sortedPks[1]);
  // Verify each position
  for (let i = 0; i < 4; i++) {
    const proof = getPoolMerkleProof(tree, i);
    const ok = verifyPoolMerkleProof(tree.sortedPks[i], i, proof, tree.root);
    assert(`4-leaf pos ${i} verify PASS (position-aware climb)`, ok);
  }
  // Mutation: wrong position should fail
  const proof0 = getPoolMerkleProof(tree, 0);
  const wrongPos = verifyPoolMerkleProof(tree.sortedPks[0], 1, proof0, tree.root);
  assert('4-leaf wrong position fails verify', !wrongPos);
  // Mutation: wrong pk should fail
  const wrongPk = verifyPoolMerkleProof(tree.sortedPks[1], 0, proof0, tree.root);
  assert('4-leaf wrong pk fails verify', !wrongPk);
}

// 5. Sort determinism — unsorted input = sorted internal
{
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const c = 'c'.repeat(64);
  const t1 = buildPoolMerkleTree([a, b, c]);
  const t2 = buildPoolMerkleTree([c, a, b]);
  const t3 = buildPoolMerkleTree([b, c, a]);
  assert('sort determinism root t1=t2', t1.root.equals(t2.root));
  assert('sort determinism root t1=t3', t1.root.equals(t3.root));
  assert('sortedPks ascending', t1.sortedPks[0] === a && t1.sortedPks[2] === c);
}

// 6. Pad convention — repeating last leaf works at level 0
{
  // 3-leaf pool pads to 256 by repeating the 3rd
  const pks = [
    '1'.repeat(64),
    '2'.repeat(64),
    '3'.repeat(64),
  ];
  const tree = buildPoolMerkleTree(pks);
  for (let i = 0; i < 3; i++) {
    const proof = getPoolMerkleProof(tree, i);
    assert(`3-leaf pad pos ${i} verify PASS`, verifyPoolMerkleProof(tree.sortedPks[i], i, proof, tree.root));
  }
}

// 7. Larger pool — 16 PKs, verify random positions
{
  const pks = Array.from({ length: 16 }, (_, i) => i.toString(16).padStart(2, '0').repeat(32));
  const tree = buildPoolMerkleTree(pks);
  const probes = [0, 1, 5, 7, 8, 15];
  for (const i of probes) {
    const proof = getPoolMerkleProof(tree, i);
    assert(`16-leaf pos ${i} verify PASS`, verifyPoolMerkleProof(tree.sortedPks[i], i, proof, tree.root));
  }
}

// 8. Full 256 pool — boundary test
{
  const pks = Array.from({ length: POOL_MAX_SIZE }, (_, i) => {
    const h = i.toString(16).padStart(4, '0');
    return (h + 'ff'.repeat(30)).slice(0, 64);
  });
  const tree = buildPoolMerkleTree(pks);
  for (const i of [0, 1, 127, 128, 254, 255]) {
    const proof = getPoolMerkleProof(tree, i);
    assert(`256-leaf pos ${i} verify PASS`, verifyPoolMerkleProof(tree.sortedPks[i], i, proof, tree.root));
  }
}

// 9. Cross-impl with SS climb pattern — emulate PoolSide_v06.sil bit-by-bit
{
  // Manually emulate the SS climb: bit_i = (idx / 2^i) % 2; if 0 hash(cur||sib) else hash(sib||cur)
  const pks = ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32), 'dd'.repeat(32)];
  const tree = buildPoolMerkleTree(pks);
  const idx = 2; // P2 at sorted position 2
  const proof = getPoolMerkleProof(tree, idx);
  // Emulate SS climb manually
  const { blake2b } = await import('@noble/hashes/blake2b');
  const b2b = (buf) => Buffer.from(blake2b(buf, { dkLen: 32 }));
  const cat = (a, b) => Buffer.concat([a, b]);
  let cur = hashPoolLeaf(tree.sortedPks[idx]);
  let p = idx;
  for (let d = 0; d < POOL_DEPTH; d++) {
    const sib = proof[d];
    const bit = (p >> d) & 1;
    cur = bit === 0 ? b2b(cat(cur, sib)) : b2b(cat(sib, cur));
  }
  assert('SS-pattern emulated climb matches root', cur.equals(tree.root));
}

// 10. deriveCommitteePkHash invariants
{
  const pks = Array.from({ length: 5 }, (_, i) => i.toString(16).repeat(64));
  const h = deriveCommitteePkHash(pks);
  assert('committee hash is 32 bytes', h.length === 32);
  assert('committee hash deterministic', deriveCommitteePkHash(pks).equals(h));
}

expectThrow('committee != 5', () => deriveCommitteePkHash(['a'.repeat(64)]), 'exactly 5');

console.log(failed === 0 ? '[pool-merkle-v06.test] ALL PASS' : `[pool-merkle-v06.test] ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
