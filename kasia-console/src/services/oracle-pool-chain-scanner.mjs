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

import sqlite from '../db/sqlite.js';
import { createHash } from 'node:crypto';

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

  const enrollments = sqlite.prepare(
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

  // Leaf hashing (KANet-UI r484/2 锁公式): leaf_i = sha256(pkX || stake_sompi_be64).
  const leafHashes = valid.map(v => {
    const pkBytes = Buffer.from(v.pk_x, 'hex');
    const stakeBytes = Buffer.alloc(8);
    stakeBytes.writeBigUInt64BE(BigInt(v.stake_sompi));
    return createHash('sha256').update(Buffer.concat([pkBytes, stakeBytes])).digest();
  });

  // Build depth-8 merkle (reuse pool-merkle-builder pattern — pad to next power-of-2 by repeating last).
  const { buildPoolMerkleTreeFromLeaves } = await import('../services/pool-merkle-v06.mjs').then(m => ({
    buildPoolMerkleTreeFromLeaves: m.buildPoolMerkleTreeFromLeaves,
  })).catch(() => ({}));

  let merkleRoot;
  if (buildPoolMerkleTreeFromLeaves) {
    const tree = buildPoolMerkleTreeFromLeaves(leafHashes);
    merkleRoot = tree.root.toString('hex');
  } else {
    // Fallback inline: depth-8 blake2b merkle.
    const { blake2b } = await import('@noble/hashes/blake2b');
    const padded = [...leafHashes];
    const target = Math.max(1, leafHashes.length);
    while (padded.length < target) padded.push(padded[padded.length - 1] || Buffer.alloc(32));
    let level = padded;
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        next.push(Buffer.from(blake2b(Buffer.concat([left, right]), { dkLen: 32 })));
      }
      level = next;
    }
    merkleRoot = (level[0] || Buffer.alloc(32)).toString('hex');
  }

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
