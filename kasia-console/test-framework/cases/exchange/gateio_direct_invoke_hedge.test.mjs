// gateio_direct_invoke_hedge — Phase 6 #3 seq 2 KI 56 Gate.io route verify (NWT N19.135)
//
// Pattern: KI 42.1 真 integration (direct invoke executeHedge with test process env override).
// NOT via real Kasia DM flow (Console env undefined for KANET_HEDGE_MODE).
//
// Steps:
//   1. Set process.env.KANET_HEDGE_MODE='auto_e2e' (test process)
//   2. INSERT test offer with broker-v3-escrow metadata + status='completed' + hedge_enabled=true
//   3. invoke filter.executeHedge(offerId, 'Test', 'SELL', 50, null)
//   4. assert chain_events hedge_placed exchange='gateio' + orderId
//   5. cleanup: delete env + delete test offer + delete chain_events

import Database from 'better-sqlite3';
import crypto from 'node:crypto';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';
const BROKER_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

export default {
  id: 'gateio_direct_invoke_hedge',
  description: 'KI 56 Phase 6 #3 seq 2: Gate.io route verify via direct invoke (KANET_HEDGE_MODE=auto_e2e)',
  domain: 'exchange',
  tags: ['real_chain', 'expensive', 'p1', 'phase-6-3', 'gateio-verify'],
  skip_in_batch: true,
  expensive: true,

  async run() {
    const filter = await import('../../../src/services/trade-protocol-filter.js');
    const db = new Database(DB_PATH);

    const origHedgeMode = process.env.KANET_HEDGE_MODE;
    process.env.KANET_HEDGE_MODE = 'auto_e2e';

    const testOfferId = `gateio-verify-${Date.now()}`;
    const fakeTxId = crypto.randomBytes(32).toString('hex');
    const qty = 100;  // KI 56.1 5/21: bump 50→100 clear Gate.io $3 min ($3.40), avoid failover (NWT N19.137 ack)
    const giveUsdt = (qty * 0.034).toFixed(4);  // ~$3.40

    try {
      // INSERT test offer (broker-v3-escrow source + completed + hedge_enabled=true)
      db.prepare(`
        INSERT INTO exchange_offers (id, maker, give_asset, give_amount, want_asset, want_amount, protocol_status, market_key, verification, is_fully_observed, created_at, updated_at, broadcast_at, broadcast_tx_id, metadata)
        VALUES (?, ?, 'USDT', ?, 'KAS', ?, 'completed', 'KAS-USDT', 'cross_chain_tx', 1, datetime('now'), datetime('now'), datetime('now'), ?, ?)
      `).run(testOfferId, BROKER_ADDR, giveUsdt, String(qty), fakeTxId, JSON.stringify({ source: 'broker-v3-escrow', hedge_enabled: true }));

      console.log(`[gateio_direct_invoke] setup ✓ offer ${testOfferId}, qty=${qty}, KANET_HEDGE_MODE=auto_e2e`);
      console.log(`[gateio_direct_invoke] invoking executeHedge...`);
      await filter.executeHedge(testOfferId, 'Test', 'SELL', qty, null).catch(err => {
        console.log(`[gateio_direct_invoke] executeHedge threw: ${err.message}`);
      });

      // Wait for chain_event emit (recordChainEvent dynamic import async)
      await new Promise(r => setTimeout(r, 1500));

      const evt = db.prepare(`SELECT payload FROM chain_events WHERE txid=? AND event_type IN ('hedge_placed','hedge_failed','hedge_skipped') ORDER BY observed_at DESC LIMIT 1`).get(testOfferId);
      if (!evt) {
        return { ok: false, error: `no hedge chain_event emitted for ${testOfferId}` };
      }
      let p; try { p = JSON.parse(evt.payload); } catch {}

      // Verify Gate.io route was selected
      const expectedRoute = process.env.KANET_HEDGE_MODE === 'auto_e2e';  // env still set within test
      const isGateio = p?.exchange === 'gateio';
      const isPlaced = p?.orderId; // hedge_placed has orderId; hedge_failed has error

      if (!isGateio) {
        return { ok: false, error: `wrong exchange routed: ${p?.exchange} (expected gateio for auto_e2e mode)`, payload: p };
      }
      if (!isPlaced) {
        // Hedge_failed valid result — Gate.io route was selected but API call failed (key/balance/network)
        return {
          ok: false,
          error: `Gate.io route SELECTED but order failed: ${p?.error}`,
          payload: p,
          note: 'route logic verified (gateio) but Gate.io API call failed — separate issue',
        };
      }

      return {
        ok: true,
        summary: `Gate.io route VERIFIED: orderId=${p.orderId} qty=${qty} price=${p.price}`,
        details: { offerId: testOfferId, payload: p },
      };
    } finally {
      // Restore env
      if (origHedgeMode === undefined) delete process.env.KANET_HEDGE_MODE;
      else process.env.KANET_HEDGE_MODE = origHedgeMode;
      // Cleanup
      db.prepare(`DELETE FROM exchange_offers WHERE id=?`).run(testOfferId);
      db.prepare(`DELETE FROM chain_events WHERE txid=?`).run(testOfferId);
      db.close();
    }
  },
};
