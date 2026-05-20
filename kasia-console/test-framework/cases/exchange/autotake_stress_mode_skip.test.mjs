// autotake_stress_mode_skip — Phase 6 #5 KI 49.3 真 integration regression (NWT N19.118)
//
// REWRITE: import + invoke真 production _evaluateAutoTake. NWT N19.118 rejected KI 49.2 inline mirror anti-pattern.
//
// Tests:
//   T1: STRESS_MODE=1 + source='multi-agent-test' → autotake_skip emit reason='stress_mode_skip'
//   T2: STRESS_MODE=1 + source='stress_5_5_A_run1' → autotake_skip emit reason='stress_mode_skip'
//   T3: STRESS_MODE=1 + source='broker-v3-escrow' → NOT skip via stress_mode (may skip other gate)
//   T4: STRESS_MODE undefined + source='stress_*' → NOT skip via stress_mode (gate noop)

import Database from 'better-sqlite3';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';

export default {
  id: 'autotake_stress_mode_skip',
  description: 'KI 49.3 真 integration: invoke production _evaluateAutoTake + assert autotake_skip emit',
  domain: 'exchange',
  tags: ['regression', 'p1', 'ki-49', 'autotaker', 'stress-mode', 'integration'],

  async run() {
    const failures = [];
    const filter = await import('../../../src/services/trade-protocol-filter.js');
    const { setConfig, getConfig } = await import('../../../src/data/settings/configs.js');
    const db = new Database(DB_PATH);

    // Backup environment + config
    const origStress = process.env.KANET_STRESS_MODE;
    const origAutotake = await getConfig('autotake_enabled');
    await setConfig('autotake_enabled', 'true');  // ensure not skipped by enabled gate

    try {
      // Helper: invoke _evaluateAutoTake + scan autotake_skip emit
      async function probeGate(offerId, msg, expectedReason) {
        const before = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='autotake_skip' AND txid LIKE ?`).get(`autotake_skip_${offerId}_%`).c;
        await filter._evaluateAutoTake(offerId, msg);
        await new Promise(r => setTimeout(r, 200));  // recordChainEvent dynamic import async
        const after = db.prepare(`SELECT txid, payload FROM chain_events WHERE event_type='autotake_skip' AND txid LIKE ? ORDER BY observed_at DESC LIMIT 1`).get(`autotake_skip_${offerId}_%`);
        const emitted = after && (db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='autotake_skip' AND txid LIKE ?`).get(`autotake_skip_${offerId}_%`).c > before);
        return { emitted, lastEvent: after };
      }

      // T1: STRESS_MODE=1 + multi-agent-test → skip
      process.env.KANET_STRESS_MODE = '1';
      let r1 = await probeGate('test-T1-' + Date.now(), {
        _from: 'kaspa:qexternal_maker_addr',
        verification: 'cross_chain_tx',
        give_amount: '0.034', give_asset: 'USDT',
        want_amount: '1', want_asset: 'KAS',
        metadata: JSON.stringify({ source: 'multi-agent-test' }),
      }, 'stress_mode_skip');
      if (!r1.emitted) failures.push('T1: STRESS_MODE=1 + multi-agent-test → no autotake_skip emit');
      else {
        const reason = JSON.parse(r1.lastEvent.payload).reason;
        if (reason !== 'stress_mode_skip') failures.push(`T1: emit reason='${reason}' expected 'stress_mode_skip'`);
      }

      // T2: STRESS_MODE=1 + stress_5_5_A → skip
      let r2 = await probeGate('test-T2-' + Date.now(), {
        _from: 'kaspa:qexternal_maker_addr',
        verification: 'cross_chain_tx',
        give_amount: '0.34', give_asset: 'USDT',
        want_amount: '10', want_asset: 'KAS',
        metadata: JSON.stringify({ source: 'stress_5_5_A_run1' }),
      }, 'stress_mode_skip');
      if (!r2.emitted) failures.push('T2: STRESS_MODE=1 + stress_5_5_A_run1 → no autotake_skip emit');

      // T3: STRESS_MODE=1 + broker-v3-escrow → NOT skip via stress_mode (will skip via another gate or attempt full eval)
      let r3 = await probeGate('test-T3-' + Date.now(), {
        _from: 'kaspa:qexternal_maker_addr',
        verification: 'cross_chain_tx',
        give_amount: '0.34', give_asset: 'USDT',
        want_amount: '10', want_asset: 'KAS',
        metadata: JSON.stringify({ source: 'broker-v3-escrow' }),
      }, null);
      // Production source should NOT trigger 'stress_mode_skip'. Other gates may fire (e.g., price oracle null) but reason MUST NOT be 'stress_mode_skip'.
      if (r3.emitted && r3.lastEvent) {
        const reason = JSON.parse(r3.lastEvent.payload).reason;
        if (reason === 'stress_mode_skip') failures.push(`T3: broker-v3-escrow incorrectly hit 'stress_mode_skip' gate`);
      }

      // T4: STRESS_MODE undefined + stress_* → NOT skip via stress_mode (gate noop)
      delete process.env.KANET_STRESS_MODE;
      let r4 = await probeGate('test-T4-' + Date.now(), {
        _from: 'kaspa:qexternal_maker_addr',
        verification: 'cross_chain_tx',
        give_amount: '0.34', give_asset: 'USDT',
        want_amount: '10', want_asset: 'KAS',
        metadata: JSON.stringify({ source: 'stress_5_5_A_run1' }),
      }, null);
      if (r4.emitted && r4.lastEvent) {
        const reason = JSON.parse(r4.lastEvent.payload).reason;
        if (reason === 'stress_mode_skip') failures.push(`T4: STRESS_MODE undefined incorrectly hit 'stress_mode_skip' gate (production no-op violated)`);
      }
    } finally {
      // Restore env + config
      if (origStress === undefined) delete process.env.KANET_STRESS_MODE;
      else process.env.KANET_STRESS_MODE = origStress;
      if (origAutotake !== undefined && origAutotake !== null) await setConfig('autotake_enabled', origAutotake);
      // Cleanup test chain_events
      db.prepare(`DELETE FROM chain_events WHERE txid LIKE 'autotake_skip_test-T%'`).run();
      db.close();
    }

    if (failures.length > 0) {
      return { ok: false, error: failures.join('; '), failures };
    }
    return { ok: true, summary: '4 真 integration test PASS: invoke production _evaluateAutoTake + assert real chain_event emit' };
  },
};
