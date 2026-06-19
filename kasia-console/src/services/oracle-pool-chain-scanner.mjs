// oracle-pool-chain-scanner.mjs — DoD §2.2 J2 step [2] (5-agent 共识乙路线锁定 6/1).
//
// 池 = 链上 OracleStake_v1 P2SH UTXO 集合. 跨节点扫链派生 (= 数学上各节点同 snapshotDaa
// 同 chain state 同结果, 不依赖中心 DB).
//
// 算法:
//   1. snapshotDaa = currentDaa - FINALITY_N (J2 r273 钦定 N=600 blocks ~60s, reorg buffer).
//   2. 对每个 enrolled staker (oracle_stake_enrollments active=1):
//      a. 派生 p2sh = computeStakeP2SH_v1(stakerPkX, lockUntilDaa)
//      b. RPC getUtxosByAddresses([p2sh]) at finality depth
//      c. 验 UTXO unspent + amount >= ORACLE_STAKE_MIN_SOMPI
//      d. lockUntilDaa > snapshotDaa (= 仍 locked 不可花)
//   3. 排序 valid stakers by pkX ascending (= determinism, 跨节点必同序).
//   4. 计算 leaves = sha256(pkX || amount_be64) — KANet-UI r484/2 锁公式.
//   5. Build depth-8 blake2b merkle tree → root.
//   6. INSERT OR REPLACE oracle_pool_chain_view (snapshot_daa, leaves_json, merkle_root, pool_size).
//
// 协议不变量: settle TX ctor poolMerkleRoot == derive(snapshotDaa) — relay reject mismatch.
// 跨节点验证: GET /api/oracle/pool-snapshot?daa=X fetch + diff across :3200/:3300 (NWT verifier).

import { sqlite } from '../db/client.js';
// J2-tn r380: createHash (sha256) removed — leaf hashing now uses pool-merkle-v06.buildPoolMerkleTree
// internal blake2b to align with SS PoolSpine_v07 expectation.

const FINALITY_N = parseInt(process.env.ORACLE_POOL_FINALITY_N, 10) || 600;

/**
 * Derive (snapshotDaa, leaves, root) from current chain state.
 *
 * @param {string} networkId - 'testnet-12' or 'mainnet'
 * @param {number} currentDaa - current chain DAA score (= caller fetches via RPC)
 * @returns {Promise<{snapshotDaa, leaves, merkleRoot, poolSize}>}
 */
export async function deriveOraclePoolFromChain(networkId, currentDaa) {
  const snapshotDaa = currentDaa - FINALITY_N;
  if (snapshotDaa <= 0) throw new Error(`snapshotDaa ${snapshotDaa} <= 0 — chain too young or FINALITY_N too high`);

  // Idempotent: if already derived at this snapshotDaa, return cached.
  const cached = sqlite.prepare(
    'SELECT leaves_json, merkle_root, pool_size FROM oracle_pool_chain_view WHERE snapshot_daa = ?'
  ).get(snapshotDaa);
  if (cached) {
    return {
      snapshotDaa,
      leaves: JSON.parse(cached.leaves_json),
      merkleRoot: cached.merkle_root,
      poolSize: cached.pool_size,
      fromCache: true,
    };
  }

  // Read enrollments + RPC verify each (= scanner caller pre-loaded enrollments + UTXO scan).
  // The actual RPC + amount verify happens in the caller (= API endpoint or settler) so this
  // module stays pure. Pass already-validated enrollments via the validEnrollments arg.
  throw new Error('deriveOraclePoolFromChain: caller must pass pre-validated enrollments via scanAndDerivePool()');
}

/**
 * Scan + derive in one shot (used by API endpoint + future cron).
 *
 * @param {object} args
 * @param {object} args.rpc - kaspa-wasm RpcClient (connected)
 * @param {string} args.networkId
 * @param {number} args.currentDaa
 * @returns {Promise<{snapshotDaa, leaves, merkleRoot, poolSize, scanned, valid, rejected}>}
 */
export async function scanAndDerivePool({ rpc, networkId, currentDaa }) {
  const snapshotDaa = currentDaa - FINALITY_N;
  if (snapshotDaa <= 0) throw new Error(`snapshotDaa ${snapshotDaa} <= 0 — chain too young or FINALITY_N too high`);

  // Idempotent cache check.
  const cached = sqlite.prepare(
    'SELECT leaves_json, merkle_root, pool_size FROM oracle_pool_chain_view WHERE snapshot_daa = ?'
  ).get(snapshotDaa);
  if (cached) {
    return {
      snapshotDaa,
      leaves: JSON.parse(cached.leaves_json),
      merkleRoot: cached.merkle_root,
      poolSize: cached.pool_size,
      fromCache: true,
      scanned: 0,
      valid: cached.pool_size,
      rejected: 0,
    };
  }

  const { ORACLE_STAKE_MIN_SOMPI } = await import('../lib/oracle-stake-v1.mjs');

  // J2-tn r301 Path A: cross-node convergence by sourcing from chain-confirmed enrollments
  // ONLY (= source='chain_envelope'). Local 'manual' enrollments waiting for backfill broadcast
  // are excluded → pool 同 chain state 跨节点 same set 收敛.
  //
  // Strict mode: ORACLE_POOL_STRICT_CHAIN_SOURCE=1 (default) — only chain_envelope source counts.
  // Set =0 to fall back to legacy (= include 'manual' rows; pre-Path A behavior, for debug).
  const strictChainSource = process.env.ORACLE_POOL_STRICT_CHAIN_SOURCE !== '0';
  const enrollments = strictChainSource
    ? sqlite.prepare(
        "SELECT staker_pk_x, lock_until_daa, p2sh_addr FROM oracle_stake_enrollments WHERE active = 1 AND source = 'chain_envelope'"
      ).all()
    : sqlite.prepare(
        'SELECT staker_pk_x, lock_until_daa, p2sh_addr FROM oracle_stake_enrollments WHERE active = 1'
      ).all();

  const valid = [];
  let rejected = 0;
  for (const row of enrollments) {
    if (row.lock_until_daa <= snapshotDaa) { rejected++; continue; }  // unlock period passed, no longer locked
    try {
      const { entries } = await rpc.getUtxosByAddresses([row.p2sh_addr]);
      if (!entries || entries.length === 0) { rejected++; continue; }
      const utxo = entries[0];
      const amountSompi = BigInt(utxo.amount || utxo.entry?.amount || 0);
      if (amountSompi < BigInt(ORACLE_STAKE_MIN_SOMPI)) { rejected++; continue; }
      valid.push({
        pk_x: row.staker_pk_x,
        stake_sompi: amountSompi.toString(),
        lock_until_daa: row.lock_until_daa,
        p2sh: row.p2sh_addr,
        outpoint_txid: utxo.outpoint.transactionId,
        outpoint_index: utxo.outpoint.index,
      });
      sqlite.prepare(`
        UPDATE oracle_stake_enrollments
        SET outpoint_txid = ?, outpoint_index = ?, amount_sompi = ?, last_scanned_at = CURRENT_TIMESTAMP
        WHERE staker_pk_x = ?
      `).run(utxo.outpoint.transactionId, utxo.outpoint.index, amountSompi.toString(), row.staker_pk_x);
    } catch (e) {
      console.warn(`[oracle-pool-scanner] enroll ${row.staker_pk_x.slice(0,12)} scan fail: ${e.message}`);
      rejected++;
    }
  }

  // Sort by pkX ascending — determinism across nodes (5-agent 共识 KANet-UI r484/2 锁公式).
  valid.sort((a, b) => a.pk_x < b.pk_x ? -1 : a.pk_x > b.pk_x ? 1 : 0);

  // J2-tn r380 (Bettor 15:54 钦定 + J1 r371 实证 + NWT r300 L18 invariant — Task #133 SS verify final fix):
  // OLD: leaf = sha256(pkX || stake_sompi_be64) + variable-depth inline merkle — KANet-UI r484/2
  // 锁公式但 SS 不认 (= 算法+输入+深度三错).
  // SS PoolSpine_v07 L138-160 + pool-merkle-v06.mjs buildPoolMerkleTree L52-86 一致:
  //   - leaf = blake2b(pk_bytes 32B) — PK only, stake 不进 SS root
  //   - sortedPks ascending hex lowercase
  //   - pad to 256 leaves by repeating last
  //   - 8-level blake2b cat tree
  //   - climb: bit_i=(idx>>i)&1; 0→hash(cur||sib), 1→hash(sib||cur)
  // 直接复用 buildPoolMerkleTree (= proof generation 同源, 保证 byte-exact root) →
  // SS verify pass on next 新市场. #9 旧 sha256 root 已烤进 spine P2SH 救不活.
  const { buildPoolMerkleTree } = await import('../services/pool-merkle-v06.mjs');
  const tree = buildPoolMerkleTree(valid.map(v => v.pk_x));
  const merkleRoot = tree.root.toString('hex');

  sqlite.prepare(`
    INSERT OR REPLACE INTO oracle_pool_chain_view (snapshot_daa, leaves_json, merkle_root, pool_size, derived_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(snapshotDaa, JSON.stringify(valid), merkleRoot, valid.length);

  return {
    snapshotDaa,
    leaves: valid,
    merkleRoot,
    poolSize: valid.length,
    fromCache: false,
    scanned: enrollments.length,
    valid: valid.length,
    rejected,
  };
}

export const ORACLE_POOL_FINALITY_N = FINALITY_N;
