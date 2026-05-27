// Oracle v0.3 sub 10.x sub 6 — SS SPOF Path A+B recovery regression cases (Bettor r93 spec).
//
// scope: prediction-params-cache.js emit + recover + dual-sig verify + silverc recompile.
// migration: relies on v146 predictions_offers_local_cache (= J2-tn ship 4e9dbd8/486ae8d).
// commits covered: v1 (4e9dbd8) + v2 (632e3b2 NWT r66 3 CRITICAL) + v3 (c61555c NWT r67 dual-sig) + v4 (2893ae4 NWT r68 truncate).

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data/console.db');

function canonicalJson(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

export default {
  id: 'oracle_spof_recovery',
  description: 'Oracle v0.3 sub 10.x sub 6 — SPOF Path A+B recovery 3 regression cases (db loss / dual-sig forge / chain absent)',
  domain: 'oracle',
  tags: ['regression', 'p0', 'oracle-v0.3', 'sub-10', 'spof-recovery'],
  skip_in_batch: false,

  async run() {
    const failures = [];
    const { recoverPredictionParams, computeParamsHash, verifyParamsDualSig } = await import('../../../src/services/prediction-params-cache.js');
    const db = new Database(DB_PATH);

    // ────────────────────────────────────────────────────────────────────────────
    // I1: test_recovery_chain_event_absent — graceful fail when no chain_event + no cache
    // ────────────────────────────────────────────────────────────────────────────
    try {
      const nonexistentOfferId = 'test-spof-absent-' + Date.now();
      // Pre-clean (= idempotent)
      db.prepare(`DELETE FROM predictions_offers_local_cache WHERE offer_id = ?`).run(nonexistentOfferId);
      db.prepare(`DELETE FROM chain_events WHERE event_type = 'kanet_prediction_params_v1' AND payload LIKE ?`).run(`%"offer_id":"${nonexistentOfferId}"%`);

      const result = await recoverPredictionParams(nonexistentOfferId);
      if (result !== null) {
        failures.push(`I1: expected null for absent offer, got ${JSON.stringify(result).slice(0, 100)}`);
      }
    } catch (e) {
      failures.push(`I1 exception: ${e.message}`);
    }

    // ────────────────────────────────────────────────────────────────────────────
    // I2: test_recovery_dual_sig_invalid — forge attack reject
    // ────────────────────────────────────────────────────────────────────────────
    // Insert chain_event with self-consistent hash but invalid sig → recovery must reject.
    try {
      const forgeOfferId = 'test-spof-forge-' + Date.now();
      const forgeCtorParams = {
        offer_id: forgeOfferId,
        p2sh_addr: 'kaspatest:forge-p2sh-attacker',
        maker_pk: '20f208b765fe9d61e50e68231cb851c725e6637189df4ba0ef5213a814d81fb6',  // valid hex but not signer of forge_sig
        taker_pk: 'e72d8e7ea88a53d6deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        broker_pk: '1f6ba54ac74af5dcdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        oracle_pks: [],
        deadline: 1779878155530,
        miner_fee_sompi: 1000000,
        broker_fee_pct: 100,
        oracle_fee_pct: 100,
        maker_stake_sompi: 100000000,
        taker_stake_sompi: 100000000,
        market_metadata_hash: null,
        protocol_version: 'v0.3-full',
      };
      const forgeHash = createHash('sha256').update(canonicalJson(forgeCtorParams), 'utf8').digest('hex');
      const forgePayload = {
        t: 'kanet_prediction_params_v1',
        offer_id: forgeOfferId,
        p2sh_addr: forgeCtorParams.p2sh_addr,
        ctor_params: forgeCtorParams,
        params_hash: forgeHash,
        maker_sig: 'aa'.repeat(64),  // forge sig — won't verify against maker_pk
        taker_sig: 'bb'.repeat(64),
      };
      // Pre-clean + INSERT forge chain_event directly
      db.prepare(`DELETE FROM chain_events WHERE event_type = 'kanet_prediction_params_v1' AND payload LIKE ?`).run(`%"offer_id":"${forgeOfferId}"%`);
      db.prepare(`DELETE FROM predictions_offers_local_cache WHERE offer_id = ?`).run(forgeOfferId);
      db.prepare(`
        INSERT INTO chain_events (txid, event_type, from_address, to_address, payload, observed_by, observed_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run('forge-tx-' + Date.now(), 'kanet_prediction_params_v1', null, null, JSON.stringify(forgePayload), 'test');

      const result = await recoverPredictionParams(forgeOfferId);
      if (result !== null) {
        failures.push(`I2: forge attack should be rejected, but got source=${result.source} (expected null)`);
      }

      // Also verify dual-sig check at unit level
      const sigCheck = await verifyParamsDualSig(forgePayload);
      if (sigCheck.valid !== false) {
        failures.push(`I2 unit: verifyParamsDualSig should return valid=false for forge sigs, got valid=${sigCheck.valid}`);
      }

      // Cleanup
      db.prepare(`DELETE FROM chain_events WHERE event_type = 'kanet_prediction_params_v1' AND payload LIKE ?`).run(`%"offer_id":"${forgeOfferId}"%`);
    } catch (e) {
      failures.push(`I2 exception: ${e.message}`);
    }

    // ────────────────────────────────────────────────────────────────────────────
    // I3: test_recovery_console_db_loss — recovery from chain_event when local cache wiped
    // ────────────────────────────────────────────────────────────────────────────
    // Use real on-chain emitted offer (= NWT r70 verified) if exists. Else skip with marker.
    try {
      const recentRows = db.prepare(`
        SELECT payload FROM chain_events
        WHERE event_type = 'kanet_prediction_params_v1'
        ORDER BY observed_at DESC LIMIT 1
      `).all();
      if (recentRows.length === 0) {
        // No real on-chain event yet — skip as SETUP. Not a failure.
        console.log('[spof_recovery.I3] SKIP — no real on-chain kanet_prediction_params_v1 event yet (= test framework can\'t simulate full silverc compile easily without real emit)');
      } else {
        const payload = JSON.parse(recentRows[0].payload);
        const realOfferId = payload.offer_id;
        // Wipe local cache for this offer (= simulate console.db loss)
        db.prepare(`DELETE FROM predictions_offers_local_cache WHERE offer_id = ?`).run(realOfferId);

        const result = await recoverPredictionParams(realOfferId);
        if (!result) {
          failures.push(`I3: recovery from chain_event should succeed for real offer ${realOfferId.slice(0, 20)}, got null`);
        } else {
          if (result.source !== 'chain_event') {
            failures.push(`I3: expected source='chain_event', got '${result.source}'`);
          }
          if (!result.redeem_script_hex) {
            failures.push(`I3: silverc recompile should set redeem_script_hex`);
          }
          if (!result.p2sh_addr) {
            failures.push(`I3: recovery should set p2sh_addr`);
          }
          if (result.ctor_params.offer_id !== realOfferId) {
            failures.push(`I3: returned ctor_params.offer_id mismatch`);
          }
        }
      }
    } catch (e) {
      failures.push(`I3 exception: ${e.message}`);
    }

    db.close();

    if (failures.length > 0) {
      return { ok: false, error: `${failures.length} invariant(s) failed: ${failures.join(' | ')}` };
    }
    return { ok: true, invariants_passed: 'I1+I2+I3 — absent gracefully nulls, forge sig rejected, chain_event recovery (if real event exists)' };
  },
};
