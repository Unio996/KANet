// hedge_router_failover_integration — Phase 5-2 KI 42.1 fix (NWT N19.85 "假集成" critique)
//
// Real integration test: monkey-patch placeOrder + invoke真 _executeHedge → assert callCount + chain_event emit.
// NWT N19.85: 之前版本 PASS 但 inline 复刻 logic — mutation test mindset 漏.
//
// Pattern: dependency injection via module-level monkey-patch + chain_event SQL verify.

import Database from 'better-sqlite3';
import crypto from 'node:crypto';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';

export default {
  id: 'hedge_router_failover_integration',
  description: 'KI 42.1: 真 integration — mock placeOrder, invoke 真 _executeHedge, assert callCount + chain_event audit',
  domain: 'exchange',
  tags: ['regression', 'p0', 'ki-42', 'hedge-router', 'failover', 'integration'],

  async run() {
    const failures = [];
    const ordersModule = await import('../../../src/services/exchange-orders.js');
    const filterModule = await import('../../../src/services/trade-protocol-filter.js');
    const { setConfig, getConfig } = await import('../../../src/data/settings/configs.js');
    const db = new Database(DB_PATH);

    // Backup originals
    const originalEnabled = await getConfig('hedge_router_enabled');
    const originalChain = await getConfig('hedge_router_failover_chain');

    // Setup: enable router + known failover chain
    await setConfig('hedge_router_enabled', 'true');
    await setConfig('hedge_router_failover_chain', 'bybit,gateio,kucoin');

    // Create test offer (broker-v3-escrow shape) so executeHedge has metadata
    const testOfferId = `test-failover-${Date.now()}`;
    const fakeTxId = crypto.randomBytes(32).toString('hex');
    db.prepare(`
      INSERT INTO exchange_offers (id, maker, give_asset, give_amount, want_asset, want_amount, protocol_status, market_key, verification, is_fully_observed, created_at, updated_at, broadcast_at, broadcast_tx_id, metadata)
      VALUES (?, 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l', 'USDT', '6.7', 'KAS', '200', 'completed', 'KAS-USDT', 'cross_chain_tx', 1, datetime('now'), datetime('now'), datetime('now'), ?, ?)
    `).run(testOfferId, fakeTxId, JSON.stringify({ source: 'test-integration', hedge_enabled: true }));

    // KI 42.1 (NWT N19.85): use exchange-orders.js _setMockPlaceOrder injection point.
    let callCount = 0;
    const callLog = [];
    ordersModule._setMockPlaceOrder(async (params) => {
      callCount++;
      callLog.push({ baseUrl: params.baseUrl, kasPair: params.kasPair });
      return { ok: false, error: `mock_fail_attempt_${callCount}` };
    });

    try {
      // Invoke 真 executeHedge (which is _executeHedgeGuarded → _executeHedge)
      await filterModule.executeHedge(testOfferId, 'TestAgent', 'SELL', 1.2, 'bybit').catch(() => {});

      // Assertion 1: real _executeHedge called placeOrder exactly 3 times (max attempts after KI 42 fix)
      if (callCount !== 3) failures.push(`real _executeHedge called placeOrder ${callCount} times, expected 3 (KI 42 #1 boundary)`);

      // Assertion 2: chain_event hedge_failed emitted with attemptedChain[] (KI 42 #2 fix)
      const hedgeEvt = db.prepare(`
        SELECT payload FROM chain_events WHERE txid=? AND event_type='hedge_failed' LIMIT 1
      `).get(testOfferId);
      if (!hedgeEvt) {
        failures.push('chain_event hedge_failed not emitted by _executeHedge');
      } else {
        let p; try { p = JSON.parse(hedgeEvt.payload); } catch {}
        if (!p?.attemptedChain) failures.push('hedge_failed payload missing attemptedChain[] (KI 42 #2 violated)');
        else if (p.attemptedChain.length !== 3) failures.push(`attemptedChain.length=${p.attemptedChain.length} expected 3 full CEX trail`);
      }
    } finally {
      // Restore originals (critical — test pollution防)
      ordersModule._clearMockPlaceOrder();
      if (originalEnabled) await setConfig('hedge_router_enabled', originalEnabled);
      if (originalChain) await setConfig('hedge_router_failover_chain', originalChain);
      db.prepare(`DELETE FROM exchange_offers WHERE id=?`).run(testOfferId);
      db.prepare(`DELETE FROM chain_events WHERE txid=?`).run(testOfferId);
      db.close();
    }

    if (failures.length > 0) {
      return { ok: false, error: failures.join('; '), failures, callCount, callLog };
    }
    return {
      ok: true,
      summary: `real _executeHedge integration verified: ${callCount} placeOrder calls + attemptedChain[] audit trail`,
      details: { callCount, callLog },
    };
  },
};
