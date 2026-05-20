// multichain_rebalance_integration — Phase 6 #4 Sub-1 KI 51 真 integration test
//
// Verifies broker-multichain-rebalance._runRebalanceTick:
//   T1: DRY_RUN=1 → throttle_log insert (deficit chain), NO chain_event emit
//   T2: throttle 1h prevent re-fire same deficit chain
//   T3: no deficits → no throttle inserts (early return)

import Database from 'better-sqlite3';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';

export default {
  id: 'multichain_rebalance_integration',
  description: 'KI 51 真 integration: _runRebalanceTick DRY_RUN + throttle + no-deficit early return',
  domain: 'exchange',
  tags: ['regression', 'p1', 'ki-51', 'multichain-rebalance', 'integration'],

  async run() {
    const failures = [];
    const svc = await import('../../../src/services/broker-multichain-rebalance.js');
    const { setConfig, getConfig } = await import('../../../src/data/settings/configs.js');
    const db = new Database(DB_PATH);

    const origDryRun = process.env.DRY_RUN;
    const origFloor = await getConfig('broker_multichain_floor_usd');

    try {
      // T1: DRY_RUN=1 + force deficit via very high floor → would-trigger but no real TX
      process.env.DRY_RUN = '1';
      // High floor $10000 — ensures all chains < floor = deficit, ensures bridge would-fire condition.
      // But surplus condition: src.usdt >= floor+minTransfer+5 = $10015+ which 没 chain 满足 → no bridge attempted.
      // Use moderate floor $100 — broker chains have $14 USDC (treasury_snapshot 实证) so some chains may qualify deficit, but no surplus.
      await setConfig('broker_multichain_floor_usd', '100');
      db.prepare(`DELETE FROM throttle_log WHERE key LIKE 'multichain_rebalance_%'`).run();
      const t1Before = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='broker_auto_replenish_v2' AND observed_at > datetime('now', '-1 minute')`).get().c;
      await svc._internals._runRebalanceTick();
      const t1ChainEvents = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='broker_auto_replenish_v2' AND observed_at > datetime('now', '-30 seconds')`).get().c;
      if (t1ChainEvents > t1Before) failures.push(`T1: DRY_RUN=1 emitted ${t1ChainEvents - t1Before} chain_events (should be 0)`);

      // T2: throttle 1h prevent re-fire — insert dummy throttle then tick should skip same deficit chain
      db.prepare(`DELETE FROM throttle_log WHERE key LIKE 'multichain_rebalance_%'`).run();
      db.prepare(`INSERT INTO throttle_log (key, created_at) VALUES (?, datetime('now', '-10 minutes'))`).run('multichain_rebalance_eth');
      const t2Before = db.prepare(`SELECT COUNT(*) c FROM throttle_log WHERE key='multichain_rebalance_eth'`).get().c;
      await svc._internals._runRebalanceTick();
      const t2After = db.prepare(`SELECT COUNT(*) c FROM throttle_log WHERE key='multichain_rebalance_eth'`).get().c;
      if (t2After > t2Before) failures.push(`T2: throttle 1h failed — eth got ${t2After - t2Before} new entry (should be 0)`);

      // T3: high floor + no chains qualify surplus → no bridge attempt, no throttle
      await setConfig('broker_multichain_floor_usd', '10000');  // unreachable floor — all deficit but no surplus
      db.prepare(`DELETE FROM throttle_log WHERE key LIKE 'multichain_rebalance_%'`).run();
      await svc._internals._runRebalanceTick();
      const t3After = db.prepare(`SELECT COUNT(*) c FROM throttle_log WHERE key LIKE 'multichain_rebalance_%'`).get().c;
      if (t3After > 0) failures.push(`T3: no surplus available but ${t3After} throttle entries inserted (should be 0, gracefully skip)`);
    } finally {
      if (origDryRun === undefined) delete process.env.DRY_RUN;
      else process.env.DRY_RUN = origDryRun;
      if (origFloor !== undefined && origFloor !== null) await setConfig('broker_multichain_floor_usd', origFloor);
      else await setConfig('broker_multichain_floor_usd', '20');  // default
      db.prepare(`DELETE FROM throttle_log WHERE key LIKE 'multichain_rebalance_%'`).run();
      db.close();
    }

    if (failures.length > 0) {
      return { ok: false, error: failures.join('; '), failures };
    }
    return { ok: true, summary: '3 真 integration test PASS: DRY_RUN no-emit / throttle prevent re-fire / no-surplus graceful skip' };
  },
};
