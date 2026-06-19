#!/usr/bin/env node
// J2-tn r309 急: backfill (1) oracle_pool_membership (= 路 A 后空, settler PK→relay_id 查不到)
// + (2) pool_snapshots for ALL v0.7 markets missing snapshot (= Bettor 急 13+ 哑弹).
// 统一一次 IPC pubkey resolve, 复用 chain_view 最新 daa.

import Database from 'better-sqlite3';
import { ensurePoolSnapshot } from '../src/services/pool-market-settler-v06.mjs';

const DB = process.env.CONSOLE_DB || 'data/console.db';
const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3200';

const db = new Database(DB);

// 1. Get latest chain_view (snapshot_daa, root, pool_size)
const cv = db.prepare('SELECT snapshot_daa, merkle_root, pool_size FROM oracle_pool_chain_view ORDER BY snapshot_daa DESC LIMIT 1').get();
if (!cv) { console.error('no chain_view cached'); process.exit(1); }
console.log(`[backfill] chain_view: snapshot_daa=${cv.snapshot_daa} root=${cv.merkle_root.slice(0,16)} pool_size=${cv.pool_size}`);

// 2. Get all relays + IPC get_pubkey → pk → relay_id map.
const relays = db.prepare('SELECT id, name, address FROM relay_nodes').all();
const pkToRelay = new Map();
let resolved = 0;
for (const r of relays) {
  try {
    const res = await fetch(`${CONSOLE_URL}/api/relay/${r.id}/send-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'get_pubkey' }),
    });
    const j = await res.json().catch(() => ({}));
    const pk = String(j?.x_only_pubkey || '').toLowerCase();
    if (pk && pk.length === 64) {
      pkToRelay.set(pk, { relay_id: r.id, name: r.name, address: r.address });
      resolved++;
    }
  } catch {}
}
console.log(`[backfill] resolved ${resolved}/${relays.length} relay pubkeys via IPC`);

// 3. Backfill oracle_pool_membership from chain_envelope enrollments.
//    J2-tn r337 (Bettor 6/5 C2): 加 relay_address column (= settler 跨节点 DM target).
const enrollments = db.prepare(
  "SELECT staker_pk_x, amount_sompi, relay_address FROM oracle_stake_enrollments WHERE active = 1 AND source = 'chain_envelope'"
).all();
console.log(`[backfill] ${enrollments.length} chain_envelope enrollments`);

const insertMembership = db.prepare(`
  INSERT OR REPLACE INTO oracle_pool_membership
    (relay_id, oracle_pk, stake_locked_kas, joined_at, active, relay_address)
  VALUES (?, ?, ?, COALESCE((SELECT joined_at FROM oracle_pool_membership WHERE relay_id = ?), CURRENT_TIMESTAMP), 1, ?)
`);

let membershipInserted = 0;
let membershipNoRelay = 0;
for (const e of enrollments) {
  const owner = pkToRelay.get(e.staker_pk_x.toLowerCase());
  // J2-tn r337: enrollment.relay_address 是 chain envelope baked address (= 跨节点同源).
  // 优先用它. 本地 relay row.address 是 fallback (= 仅当 envelope address NULL 但 local owner).
  const relayAddress = e.relay_address || owner?.address || null;
  if (!owner) {
    const syntheticRelay = `peer-${e.staker_pk_x.slice(0, 12)}`;
    const stakeKas = e.amount_sompi ? Number(e.amount_sompi) / 1e8 : 5;
    insertMembership.run(syntheticRelay, e.staker_pk_x.toLowerCase(), stakeKas, syntheticRelay, relayAddress);
    membershipNoRelay++;
    console.log(`[backfill] peer-owned staker=${e.staker_pk_x.slice(0,12)} → synthetic relay=${syntheticRelay} stake=${stakeKas} addr=${relayAddress?.slice(-12) || 'NULL'}`);
  } else {
    const stakeKas = e.amount_sompi ? Number(e.amount_sompi) / 1e8 : 5;
    insertMembership.run(owner.relay_id, e.staker_pk_x.toLowerCase(), stakeKas, owner.relay_id, relayAddress);
    membershipInserted++;
    console.log(`[backfill] staker=${e.staker_pk_x.slice(0,12)} relay=${owner.name} stake=${stakeKas} KAS addr=${relayAddress?.slice(-12) || 'NULL'}`);
  }
}
console.log(`[backfill] oracle_pool_membership: ${membershipInserted} local + ${membershipNoRelay} peer synthetic`);

// 4. Find all v0.7 markets missing pool_snapshots.
const markets = db.prepare(`
  SELECT m.id, m.protocol_status, m.pool_merkle_root, m.protocol_version
  FROM pool_markets m
  WHERE m.protocol_version = 'v0.7'
    AND m.protocol_status IN ('pending_bettors', 'verifying')
    AND NOT EXISTS (SELECT 1 FROM pool_snapshots s WHERE s.market_id = m.id)
`).all();
console.log(`[backfill] ${markets.length} v0.7 markets missing pool_snapshots`);

let snapshotSuccess = 0, snapshotFail = 0;
for (const m of markets) {
  try {
    if (m.pool_merkle_root.toLowerCase() !== cv.merkle_root.toLowerCase()) {
      console.log(`[backfill] ${m.id} root mismatch (ctor=${m.pool_merkle_root.slice(0,16)} vs current=${cv.merkle_root.slice(0,16)}) — chain_view stale or market predates current pool, skip`);
      snapshotFail++;
      continue;
    }
    const r = ensurePoolSnapshot(m.id, cv.merkle_root, cv.snapshot_daa);
    snapshotSuccess++;
    if (snapshotSuccess <= 3 || snapshotSuccess % 10 === 0) {
      console.log(`[backfill] ${m.id} ✓ pool_size=${r.pool_size} source=${r.source}`);
    }
  } catch (e) {
    console.log(`[backfill] ${m.id} FAIL ${e.message}`);
    snapshotFail++;
  }
}
db.close();
console.log(`\n[backfill] SUMMARY:`);
console.log(`  oracle_pool_membership: ${membershipInserted} local + ${membershipNoRelay} peer synthetic`);
console.log(`  pool_snapshots backfilled: ${snapshotSuccess} OK / ${snapshotFail} fail (out of ${markets.length} markets missing)`);
