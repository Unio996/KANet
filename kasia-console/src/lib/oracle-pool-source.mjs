// oracle-pool-source.mjs — Oracle Pool 单一源访问器 (Owner 6/5 钦定 spec 焊死).
//
// Canonical (不可再争):
//   池成员 / stake / lock      → oracle_pool_chain_view (= scanAndDerivePool 写, 跨节点同源)
//   PK → relay_address          → oracle_stake_enrollments (= Path A envelope ingest 写)
//   oracle_pool_membership      → DEPRECATED (= v0.5 legacy seed bridge, v164 已清空 + 不准新 reader)
//
// 任何 reader 必经此模块. NWT L?? lint baked: oracle_pool_membership 出现在
// 访问器+migrate 外 = commit 拦死 (= regression 守).
//
// 参考 docs/2026-06-05-oracle-pool-single-source-enforcement.md (Owner 终裁 spec).

import { sqlite } from '../db/client.js';

/**
 * 取当前 active chain pool (= chain_view 最新一行).
 * 跨节点同 chain state → 同 root → 同 pool_pks + pool_stakes.
 *
 * @returns {{ snapshotDaa, merkleRoot, poolSize, leaves: [{pk_x, stake_sompi, lock_until_daa, p2sh, outpoint_txid, outpoint_index}] } | null}
 *   null = chain_view 表空 (= 首次 scanner 未跑 OR 池 0 staker).
 */
export function getActivePool() {
  const row = sqlite.prepare(
    'SELECT snapshot_daa, merkle_root, pool_size, leaves_json FROM oracle_pool_chain_view ORDER BY snapshot_daa DESC LIMIT 1'
  ).get();
  if (!row) return null;
  let leaves;
  try {
    leaves = JSON.parse(row.leaves_json);
  } catch {
    leaves = [];
  }
  return {
    snapshotDaa: row.snapshot_daa,
    merkleRoot: row.merkle_root,
    poolSize: row.pool_size,
    leaves,
  };
}

/**
 * 取 chain_view at 指定 snapshotDaa (= settler committee sample 时点 frozen pool).
 *
 * @param {number} snapshotDaa
 * @returns 同 getActivePool() shape, 或 null
 */
export function getPoolAtSnapshot(snapshotDaa) {
  const row = sqlite.prepare(
    'SELECT snapshot_daa, merkle_root, pool_size, leaves_json FROM oracle_pool_chain_view WHERE snapshot_daa = ?'
  ).get(snapshotDaa);
  if (!row) return null;
  let leaves;
  try { leaves = JSON.parse(row.leaves_json); } catch { leaves = []; }
  return {
    snapshotDaa: row.snapshot_daa,
    merkleRoot: row.merkle_root,
    poolSize: row.pool_size,
    leaves,
  };
}

/**
 * Resolve oracle PK → Kaspa address. 真源 oracle_stake_enrollments (= Path A envelope baked).
 * Fallback oracle_pool_membership.relay_address (= 防 enrollment 表丢数据 stopgap).
 *
 * @param {string} pkHex - 64-char lowercase
 * @returns {string|null} Kaspa address OR null
 */
export function resolveOracleAddress(pkHex) {
  const pk = String(pkHex || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return null;
  const enr = sqlite.prepare(
    'SELECT relay_address FROM oracle_stake_enrollments WHERE staker_pk_x = ? AND active = 1'
  ).get(pk);
  if (enr?.relay_address) return enr.relay_address;
  // Fallback: legacy bridge (will warn). Spec: should never trigger post-r337 envelope v2 backfill.
  const mem = sqlite.prepare(
    'SELECT relay_address FROM oracle_pool_membership WHERE oracle_pk = ? AND relay_address IS NOT NULL'
  ).get(pk);
  return mem?.relay_address || null;
}

/**
 * Resolve N PKs → addresses (batch). Returns Map<pk_lowercase, address|null>.
 * Missing PK = no row in map (caller distinguishes null vs not-resolved-yet).
 *
 * @param {string[]} pks - array of 64-char hex
 * @returns {Map<string, string>}
 */
export function resolveOracleAddresses(pks) {
  const result = new Map();
  if (!Array.isArray(pks) || pks.length === 0) return result;
  const norm = pks.map(p => String(p || '').toLowerCase()).filter(p => /^[0-9a-f]{64}$/.test(p));
  if (norm.length === 0) return result;
  const placeholders = norm.map(() => '?').join(',');
  // Primary source.
  const enrRows = sqlite.prepare(
    `SELECT staker_pk_x, relay_address FROM oracle_stake_enrollments WHERE active = 1 AND staker_pk_x IN (${placeholders})`
  ).all(...norm);
  for (const r of enrRows) {
    if (r.relay_address) result.set(r.staker_pk_x.toLowerCase(), r.relay_address);
  }
  // Fallback for missing.
  const missing = norm.filter(p => !result.has(p));
  if (missing.length > 0) {
    const fbPlaceholders = missing.map(() => '?').join(',');
    const memRows = sqlite.prepare(
      `SELECT oracle_pk, relay_address FROM oracle_pool_membership WHERE oracle_pk IN (${fbPlaceholders}) AND relay_address IS NOT NULL`
    ).all(...missing);
    for (const r of memRows) {
      if (r.relay_address) result.set(r.oracle_pk.toLowerCase(), r.relay_address);
    }
  }
  return result;
}
