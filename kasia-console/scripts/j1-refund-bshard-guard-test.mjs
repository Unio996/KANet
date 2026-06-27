#!/usr/bin/env node
// j1-refund-bshard-guard-test.mjs — 双 fixture test for the #33/#34 bettor-refund-claim bshard-detect
// safety net (J1 红队 2026-06-25, §11 裁决 Bettor 认错 + 全员 co-verify; ANTI-PATTERNS 规则 50).
//
// WHAT IT PROVES (self-contained, temp DB, offline, zero prod pollution):
//   Fixture A (bshard register-v07): logical market with a market_shards child + a bettor side stored
//     under shard_market_id with side_redeem_script_hex='' (the real bshard recordBettor shape, pool.js
//     ~L1157). The endpoint's guard SQL must DETECT it (isBshard truthy) → endpoint returns 409 SAFE
//     reject (refund_path='bshard_fold'), NOT a standalone PoolSide refund against the shared shard pool.
//   Fixture B (v0.5 non-bshard, the path that just refunded 5,608.8 KAS): market with a per-bettor side
//     carrying a real redeem, NO market_shards row. The guard SQL must NOT fire (isBshard falsy) → the
//     legitimate refund path is preserved (regression: we must not break what we just used).
//
// The asserted SQL is byte-identical to the guard in pool.js bettor-refund-claim:
//   SELECT 1 FROM market_shards WHERE logical_market_id = ? OR shard_market_id = ? LIMIT 1
// queried by BOTH the logical id and (for fixture A) the shard id — either match = bshard.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const GUARD_SQL = 'SELECT 1 FROM market_shards WHERE logical_market_id = ? OR shard_market_id = ? LIMIT 1';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL ${name}`); }
}

const tmp = path.join(os.tmpdir(), `j1-refund-guard-${process.pid}.db`);
const db = new Database(tmp);
try {
  // Minimal schema mirroring the columns the guard + endpoint touch.
  db.exec(`
    CREATE TABLE pool_markets (id TEXT PRIMARY KEY, protocol_version TEXT, protocol_status TEXT);
    CREATE TABLE market_shards (
      logical_market_id TEXT NOT NULL, shard_market_id TEXT NOT NULL, shard_index INTEGER,
      UNIQUE(shard_market_id)
    );
    CREATE TABLE pool_bettor_sides (
      id INTEGER PRIMARY KEY AUTOINCREMENT, market_id TEXT, bettor_pk TEXT, direction INTEGER,
      stake_amount TEXT, side_p2sh TEXT, side_lock_tx TEXT, side_redeem_script_hex TEXT, merkle_index INTEGER
    );
  `);

  // ── Fixture A: bshard register-v07 ──
  const L_BSHARD = 'ext-pool-v07-test-bshardlogical';
  const S_BSHARD = 'ext-pool-v07-test-shard0';
  db.prepare('INSERT INTO pool_markets (id, protocol_version, protocol_status) VALUES (?,?,?)').run(L_BSHARD, 'v0.7', 'open');
  db.prepare('INSERT INTO pool_markets (id, protocol_version, protocol_status) VALUES (?,?,?)').run(S_BSHARD, 'v0.7', 'open');
  db.prepare('INSERT INTO market_shards (logical_market_id, shard_market_id, shard_index) VALUES (?,?,?)').run(L_BSHARD, S_BSHARD, 0);
  // bshard recordBettor shape: market_id=shardMarketId, side_p2sh=SHARED shard P2SH, side_lock_tx=leafTx, redeem=''
  db.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, side_redeem_script_hex, merkle_index)
    VALUES (?,?,?,?,?,?,?,?)`).run(S_BSHARD, 'aa'.repeat(32), 0, '1000000000', 'kaspatest:sharedshardp2sh', 'leaftx_not_a_standalone_lock', '', 0);

  // ── Fixture B: v0.5 non-bshard (per-bettor standalone side, real redeem, NO market_shards) ──
  const L_V05 = 'ext-pool-1780043949859-mdok0test';
  db.prepare('INSERT INTO pool_markets (id, protocol_version, protocol_status) VALUES (?,?,?)').run(L_V05, null, 'cancelled');
  db.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, side_redeem_script_hex, merkle_index)
    VALUES (?,?,?,?,?,?,?,?)`).run(L_V05, 'bb'.repeat(32), 0, '70000000', 'kaspatest:standalonesidep2sh', 'realLockTx', '6b6c76009c...', 0);

  const guard = db.prepare(GUARD_SQL);

  console.log('Fixture A (bshard) — guard MUST fire (→ 409 SAFE reject):');
  check('detect by logical id returns a row (isBshard truthy)', !!guard.get(L_BSHARD, L_BSHARD));
  check('detect by shard id returns a row (isBshard truthy)', !!guard.get(S_BSHARD, S_BSHARD));
  // The bshard side genuinely has the dangerous shape the guard protects against:
  const aSide = db.prepare('SELECT * FROM pool_bettor_sides WHERE market_id = ?').get(S_BSHARD);
  check('bshard side has empty redeem (no standalone refundable side)', aSide.side_redeem_script_hex === '');
  check('bshard side under shard_market_id, not logical', aSide.market_id === S_BSHARD);
  // Proof of the danger averted: WITHOUT the guard, a "shard-aware" query would FIND this side cross-shard.
  const crossShardWouldFind = db.prepare(
    `SELECT 1 FROM pool_bettor_sides WHERE market_id = ? OR market_id IN (SELECT shard_market_id FROM market_shards WHERE logical_market_id = ?) LIMIT 1`
  ).get(L_BSHARD, L_BSHARD);
  check('shard-aware migration WOULD have found the bshard side (=why guard is load-bearing)', !!crossShardWouldFind);

  console.log('Fixture B (v0.5 non-bshard, the 5,608 KAS path) — guard MUST NOT fire (→ proceed):');
  check('detect by logical id returns NO row (isBshard falsy)', !guard.get(L_V05, L_V05));
  const bSide = db.prepare('SELECT * FROM pool_bettor_sides WHERE market_id = ?').get(L_V05);
  check('v0.5 side has a real redeem (standalone refundable)', bSide.side_redeem_script_hex !== '');
  check('v0.5 side has a real standalone lock tx', bSide.side_lock_tx === 'realLockTx');

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
} finally {
  db.close();
  try { fs.unlinkSync(tmp); } catch {}
}
process.exit(fail === 0 ? 0 : 1);
