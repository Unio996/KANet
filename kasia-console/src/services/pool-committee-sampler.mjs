// J2.2 + J2.3 — Oracle v0.6 committee selection (Bettor r42 spec ACK):
//
// Design (Bettor r42 critical anti-bribery 命门):
//   1. 建市时: freeze pool snapshot → pool_snapshots (root bake side ctor + spine ctor)
//   2. 市场 end 时: VRF select 5 committee from snapshot → pool_committee
//   3. 必绝不建市时选 (= 提前知谁被选→定向贿赂攻击 path)
//
// Sampling:
//   - stake-weighted 线性 (Bettor r3 Owner 钦定 — 线性 sybil-中性, 砍 stake^0.7 已 J2 r101 reproduce PASS)
//   - 无放回 N=5 (FROST t=4-of-5)
//   - seed = blake2b(marketId || endBlockHash || poolMerkleRoot) (= 三因子防 grinding)
//   - endBlockHash 必市场 end 后某确定区块 hash (建市不可知 → 防 maker grinding seed)
//
// VRF (lite, deterministic):
//   - 此 v0 实现用 blake2b chain (= seed → next_seed = blake2b(seed||idx)) 串行抽
//   - proof = (seed, all_intermediate_hashes) — 任何人重算验同 5 选中 = "公开可验"
//   - Phase 2 可升级 ECVRF / RSA-VRF (= 私钥签名+证明真随机), 现 lite 版 testnet 够
//
// Verifier role 限制: ENDBLOCKHASH 必由独立观察者提供, 不能 maker 自定 (= 1-of-N trust = ok testnet,
// mainnet 升级 Phase 2 chain ANCHOR_BLOCK)

import { blake2b } from '@noble/hashes/blake2b';

const COMMITTEE_SIZE = 5;

function b2b(buf) {
  return Buffer.from(blake2b(buf, { dkLen: 32 }));
}

function cat(...bufs) {
  return Buffer.concat(bufs.map(b => Buffer.isBuffer(b) ? b : Buffer.from(b, 'hex')));
}

function hexToBuf(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Buffer.from(clean, 'hex');
}

/**
 * Derive VRF seed = blake2b(marketId || endBlockHash || poolMerkleRoot).
 *
 * marketId — string (will be UTF-8 encoded), unique per market
 * endBlockHash — 32-byte hex (= chain block hash after market deadline)
 * poolMerkleRoot — 32-byte hex (= root bake'd into spine ctor at market create)
 */
export function deriveCommitteeSeed(marketId, endBlockHashHex, poolMerkleRootHex) {
  if (!marketId || typeof marketId !== 'string') throw new Error('marketId required (string)');
  const endBuf = hexToBuf(endBlockHashHex);
  if (endBuf.length !== 32) throw new Error(`endBlockHash must be 32 bytes hex, got ${endBuf.length}`);
  const rootBuf = hexToBuf(poolMerkleRootHex);
  if (rootBuf.length !== 32) throw new Error(`poolMerkleRoot must be 32 bytes hex, got ${rootBuf.length}`);
  return b2b(cat(Buffer.from(marketId, 'utf8'), endBuf, rootBuf));
}

/**
 * REFUND-PATH-ONLY seed = blake2b(marketId || poolMerkleRoot) — no endBlockHash.
 *
 * 2026-07-18 J1/Bettor co-verify (kr5l4/aukqt semifinal refund crisis): endBlockHash
 * requires a live block at deadline_daa, which for markets predating the K-17
 * pre-prune-capture worker can be physically pruned by the node (backward walk
 * exhausted, index covered:true entries proven stale via direct RPC — see channel
 * history 2026-07-18 ~13:00-14:00). This is safe ONLY for refund because
 * PayoutShardV2.sil's cancel_attest entry never validates the seed on-chain — it only
 * checks (a) validSigs>=4 4-of-5 checkSig, (b) 5 distinct committee pks,
 * (c) blake2b(pks)==committeePkHash, (d) merkle membership of each pk vs the
 * ctor-baked poolMerkleRoot. The seed is purely an off-chain VRF input for "which 5
 * members get asked to sign" — cross-node determinism (same seed → same 5 members)
 * is the only requirement, and marketId+poolMerkleRoot are both already ctor-baked/
 * publicly known, so this is deterministic across nodes without needing a
 * deadline-anchored block hash. MUST NOT be used for settlement (that still needs
 * endBlockHash to prevent maker-grinding the seed pre-deadline).
 */
export function deriveRefundCommitteeSeed(marketId, poolMerkleRootHex) {
  if (!marketId || typeof marketId !== 'string') throw new Error('marketId required (string)');
  const rootBuf = hexToBuf(poolMerkleRootHex);
  if (rootBuf.length !== 32) throw new Error(`poolMerkleRoot must be 32 bytes hex, got ${rootBuf.length}`);
  return b2b(cat(Buffer.from(marketId, 'utf8'), rootBuf));
}

/**
 * Stake-weighted linear sampling WITHOUT replacement.
 *
 * Input:
 *   members: array of { pk_hex, stake_sompi } — pool snapshot members (any order)
 *   seed: 32-byte Buffer (= VRF seed from deriveCommitteeSeed)
 *
 * Output:
 *   { selected: [{ pk_hex, stake_sompi, draw_index }],
 *     proof: { rounds: [{ randHash, modSum, hit_pk, remaining_n }] } }
 *
 * Algorithm:
 *   - At each round i (0..N-1):
 *       randHash_i = blake2b(seed || i)
 *       rand_i = uint64(randHash_i[0:8])  (= take 8 bytes as uint64)
 *       hit = rand_i % totalRemainingStake
 *       scan members (cumulative stake) until hit < cumStake
 *       remove hit member, record draw_index
 *   - Reproducible: same (seed, members) → same selected (positional sort first for determinism)
 */
export function selectCommittee(members, seed, options = {}) {
  // J1tn r303 P0-#1 sweep (Bettor r365b 问2 钦定 同市场 broker∉oracle, r367 sybil 框正 PK-level
  // 隔离): excludePks 参数硬过滤 maker_pk + broker_pk 防同 PK 双角色操纵 (= 自家收 broker fee +
  // 自家当 oracle 投票自家方向). 跨节点可验 (= excludePks 来自市场公开 maker_pk + broker_pk).
  // Sybil 多 PK 共谋是 P2+ deferred 议题, 此 PK-level 隔离不防 sybil 但防 same-PK 直接操纵.
  const excludePks = Array.isArray(options.excludePks)
    ? new Set(options.excludePks.map(pk => String(pk || '').toLowerCase()))
    : new Set();
  if (!Array.isArray(members)) {
    throw new Error(`pool members must be array (got ${typeof members})`);
  }
  if (!Buffer.isBuffer(seed) || seed.length !== 32) {
    throw new Error('seed must be 32-byte Buffer');
  }
  // sort by pk_hex ascending for determinism (= same as pool-merkle-v06 sortedPks)
  const sorted = [...members].map(m => ({
    pk_hex: (m.pk_hex || m.pubkey).toLowerCase(),
    stake_sompi: BigInt(m.stake_sompi || m.stake || 0),
  })).filter(m => !excludePks.has(m.pk_hex))
    .sort((a, b) => a.pk_hex < b.pk_hex ? -1 : (a.pk_hex > b.pk_hex ? 1 : 0));
  if (sorted.length < COMMITTEE_SIZE) {
    throw new Error(`pool must have >= ${COMMITTEE_SIZE} members after excludePks filter (got ${sorted.length}, excluded ${excludePks.size})`);
  }

  for (const m of sorted) {
    if (m.stake_sompi <= 0n) throw new Error(`pool member ${m.pk_hex.slice(0, 12)}.. has non-positive stake`);
  }

  const remaining = [...sorted];
  const selected = [];
  const rounds = [];

  for (let i = 0; i < COMMITTEE_SIZE; i++) {
    // randHash_i = blake2b(seed || i as 32-bit big-endian)
    const idxBuf = Buffer.alloc(4);
    idxBuf.writeUInt32BE(i);
    const randHash = b2b(cat(seed, idxBuf));
    // Bettor r44 F-S2 fix: take full 256-bit hash as BigInt (was 64-bit, modulo bias 显著
    // when totalStake → 2^61). With 256-bit random vs ≤2^64 stake, bias factor ≈ 2^192 buckets
    // per remainder → uniform within negligible bias.
    const rand = BigInt('0x' + randHash.toString('hex'));

    const totalStake = remaining.reduce((s, m) => s + m.stake_sompi, 0n);
    const hit = rand % totalStake;

    let cum = 0n;
    let hitIdx = -1;
    for (let j = 0; j < remaining.length; j++) {
      cum += remaining[j].stake_sompi;
      if (hit < cum) {
        hitIdx = j;
        break;
      }
    }
    if (hitIdx < 0) throw new Error(`sampling round ${i}: no member hit (totalStake=${totalStake}, hit=${hit})`);

    const drawn = remaining[hitIdx];
    selected.push({
      pk_hex: drawn.pk_hex,
      stake_sompi: drawn.stake_sompi.toString(),
      draw_index: i,
    });
    rounds.push({
      round: i,
      rand_hash: randHash.toString('hex'),
      hit: hit.toString(),
      total_remaining_stake: totalStake.toString(),
      hit_pk: drawn.pk_hex,
      remaining_n_before: remaining.length,
    });
    remaining.splice(hitIdx, 1);
  }

  return {
    selected,
    proof: {
      seed_hex: seed.toString('hex'),
      rounds,
      pool_size_at_sample: sorted.length,
      committee_size: COMMITTEE_SIZE,
    },
  };
}

/**
 * Verify a committee selection — re-run sampling with same inputs, check identical output.
 *
 * Input:
 *   members: array of { pk_hex, stake_sompi } — same snapshot
 *   seed: 32-byte Buffer
 *   claimedSelected: array of { pk_hex } — claimed 5 committee
 *
 * Output: { valid: bool, reason?: string }
 */
export function verifyCommitteeSelection(members, seed, claimedSelected) {
  if (!Array.isArray(claimedSelected) || claimedSelected.length !== COMMITTEE_SIZE) {
    return { valid: false, reason: `claimed committee must have ${COMMITTEE_SIZE} members, got ${claimedSelected?.length || 0}` };
  }
  let result;
  try {
    result = selectCommittee(members, seed);
  } catch (e) {
    return { valid: false, reason: `selectCommittee threw: ${e.message}` };
  }
  for (let i = 0; i < COMMITTEE_SIZE; i++) {
    const expected = result.selected[i].pk_hex;
    const claimed = (claimedSelected[i].pk_hex || claimedSelected[i]).toLowerCase();
    if (expected !== claimed) {
      return { valid: false, reason: `position ${i}: expected ${expected.slice(0, 16)}.. got ${claimed.slice(0, 16)}..` };
    }
  }
  return { valid: true };
}

export { COMMITTEE_SIZE };
