#!/usr/bin/env node
// J2-tn r301 Path A backfill — re-broadcast envelope for every active enrollment that's
// still source='manual' (= pre-Path A) so cross-node ingest reaches consensus.
//
// Algo:
//   1. Read oracle_stake_enrollments WHERE active=1 AND source!='chain_envelope'.
//   2. For each: loop local relays → IPC get_pubkey → match staker_pk_x.
//   3. POST /api/oracle-pool/enroll {staker_pk_x, lock_until_daa, signing_relay_id} —
//      'already_enrolled' branch triggers rebroadcast via envelope.
//   4. Print per-row result; idempotent (= same envelope re-INSERT 由 chain_events.txid UNIQUE
//      deduped on consumer side; UPDATE source='chain_envelope' once consumer sees the envelope).
//
// Run on EACH node holding manual enrollments (= J1 :3300 + Bettor :3200). Each node
// finds the relays it owns (= the signing keys that match its enrollments).

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.CONSOLE_DB || path.join(__dirname, '..', 'data', 'console.db');
const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3200';

async function main() {
  const db = new Database(DB_PATH, { readonly: true });
  // J2-tn r337 v2 backfill scope: 也包括 chain_envelope source 但 relay_address NULL 的
  // (= pre-r337 历史 envelopes 无 address 字段, 需 v2 envelope 重广播 解锁 cross-node settle DM).
  const enrollments = db.prepare(
    "SELECT staker_pk_x, lock_until_daa, p2sh_addr, source, relay_address FROM oracle_stake_enrollments WHERE active = 1 AND (source != 'chain_envelope' OR relay_address IS NULL)"
  ).all();
  const relays = db.prepare('SELECT id, name FROM relay_nodes').all();
  db.close();

  console.log(`[backfill] ${enrollments.length} manual enrollments, ${relays.length} local relays`);

  if (enrollments.length === 0) {
    console.log('[backfill] no work to do — all enrollments already chain_envelope sourced');
    return;
  }

  // 1. Pre-resolve every relay's pubkey via /api/relay/:id/command get_pubkey.
  //    (= avoid N×M IPC calls per enrollment.)
  const relayPkMap = new Map();
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
        relayPkMap.set(pk, r);
      }
    } catch (e) {
      // relay offline / IPC fail — skip silently, this relay 不能签
    }
  }
  console.log(`[backfill] resolved ${relayPkMap.size}/${relays.length} relay pubkeys via IPC`);

  // 2. For each enrollment, find owning local relay + POST enroll to trigger rebroadcast.
  let success = 0;
  let noLocalRelay = 0;
  let broadcastFail = 0;
  for (const e of enrollments) {
    const owner = relayPkMap.get(e.staker_pk_x.toLowerCase());
    if (!owner) {
      console.log(`[backfill] staker=${e.staker_pk_x.slice(0,12)} → no local relay (= peer-owned, handled by peer node)`);
      noLocalRelay++;
      continue;
    }
    try {
      const res = await fetch(`${CONSOLE_URL}/api/oracle-pool/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staker_pk_x: e.staker_pk_x,
          lock_until_daa: e.lock_until_daa,
          signing_relay_id: owner.id,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        console.log(`[backfill] staker=${e.staker_pk_x.slice(0,12)} relay=${owner.name} FAIL status=${res.status} ${j?.error || ''}`);
        broadcastFail++;
        continue;
      }
      const bc = j.broadcast;
      if (!bc || !bc.ok) {
        console.log(`[backfill] staker=${e.staker_pk_x.slice(0,12)} relay=${owner.name} broadcast FAIL ${bc?.error || 'none'}`);
        broadcastFail++;
        continue;
      }
      console.log(`[backfill] staker=${e.staker_pk_x.slice(0,12)} relay=${owner.name} OK tx=${bc.txId?.slice(0,16)}${bc.chunks?` chunks=${bc.chunks}`:''}`);
      success++;
      // 不 spam relay: 间隔 1.5s 避免 broadcast 拥堵.
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.log(`[backfill] staker=${e.staker_pk_x.slice(0,12)} relay=${owner.name} EXCEPTION ${err.message}`);
      broadcastFail++;
    }
  }

  console.log(`\n[backfill] summary: ${success} broadcast OK, ${noLocalRelay} skipped (peer-owned), ${broadcastFail} fail`);
  console.log('[backfill] re-run this script on the peer node to backfill its owned enrollments.');
}

main().catch(err => { console.error(err); process.exit(1); });
