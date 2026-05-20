// real_hedge_verify — Force broker offer completion to verify first hedge_placed event
//
// Owner 5/19 钦定 "必须要测试 A" + J2 #535 ack Phase 4 B fire.
// Verify Phase 1a hedge mechanism (commit 45a041c08) 30-day silent dead 修后 first 真触发.
//
// flow (~$0.14 USDT cost):
// 1. NWT DM broker BUY 1.2 KAS BSC → broker publishes broker-v3-escrow offer (hedge_enabled=true)
// 2. find broker open offer (waiting for KAS taker)
// 3. NWT-or-another-relay manual /api/exchange/accept the broker offer
//    autoTaker rejected discount too low (0.26%<1%), manual accept bypasses
// 4. taker gives KAS to broker, receives USDT from broker
// 5. broker → completed → executeHedgeGuarded fire → first hedge_placed event lifetime
//
// expensive: true, skip_in_batch: true

import cnBuyer from '../../personas/real-chain/cn_buyer_real.mjs';
import {
  getRelayInfo, getChainEvents, sleep, pollOfferStatus,
  publishOffer, transferEvmUsdt, dmRoundTrip,
} from '../../lib/real-chain-runner.mjs';
import Database from 'better-sqlite3';

const NWT_RELAY = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_KASIA = 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm';
const BROKER_KASIA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const NWT_BSC_ADDR = '0xd3618e37354700d21FE8728Bd278Dc1924974799';
const CONSOLE_URL = 'http://127.0.0.1:3100';
const DB_PATH = 'C:/kanet/kasia-console/data/console.db';

export default {
  id: 'real_hedge_verify',
  description: 'Phase 4 B — force broker offer completion + verify first hedge_placed event lifetime (Phase 1a hedge mechanism真触发)',
  domain: 'broker-realchain',
  tags: ['real_chain', 'expensive', 'p0', 'hedge-verify'],
  skip_in_batch: true,
  expensive: true,

  async run() {
    const startIso = new Date().toISOString();
    console.log(`[real_hedge_verify] start ${startIso}`);

    // Pre-flight 1: NWT no active escrow (avoid Bug AW race)
    {
      const db = new Database(DB_PATH, { readonly: true });
      const active = db.prepare(`
        SELECT id FROM user_escrow_balances WHERE user_kasia_addr=? AND status='active'
      `).all(NWT_KASIA);
      db.close();
      if (active.length > 0) {
        return { ok: false, error: `NWT has ${active.length} active escrow(s) — wait 30 min cool-down OR refund first` };
      }
    }
    console.log('[real_hedge_verify] pre-flight 1: NWT no active escrow ✓');

    // Pre-flight 2: NWT BSC USDT balance >= $0.5 buffer
    // (broker quote ~0.024 USDT, plus J2/Trader-A accept stage may need broker pay USDT to taker)
    const nwt = getRelayInfo('NWT');
    if (!nwt) return { ok: false, error: 'NWT relay not found' };
    console.log('[real_hedge_verify] pre-flight 2: NWT relay resolved ✓');

    // Pre-flight 3: hedge_placed lifetime baseline (should be 0)
    let hedgeBaseline;
    {
      const db = new Database(DB_PATH, { readonly: true });
      const r = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_placed'`).get();
      db.close();
      hedgeBaseline = r.c;
    }
    console.log(`[real_hedge_verify] pre-flight 3: hedge_placed baseline=${hedgeBaseline} (expected 0)`);

    // Step 1: NWT trigger broker offer via DM BUY 0.7 KAS distinct qty
    console.log(`[real_hedge_verify] step 1: NWT DM broker BUY 0.7 KAS BSC`);
    const buyResult = await cnBuyer.run(
      { id: 'real_hedge_verify_buyer' },
      {
        relayId: NWT_RELAY,
        userKasia: NWT_KASIA,
        brokerKasia: BROKER_KASIA,
        userEvmAddr: NWT_BSC_ADDR,
        qty: 50,  // KI 28 5/20: Bybit min order value ~$1, 50 KAS × 0.034 = $1.70 clears threshold
        chain: 'BSC',
        fromRelayName: 'NWT',
      },
    );
    if (buyResult.stage !== 'completed_flow') {
      return { ok: false, error: `step 1 buy flow stage=${buyResult.stage}: ${buyResult.error || ''}` };
    }
    console.log(`[real_hedge_verify] step 1 ✓ pay TX ${buyResult.payTx}`);

    // Step 2: wait broker offer publish (broker-v3-escrow path)
    console.log(`[real_hedge_verify] step 2: wait broker offer publish (60s)`);
    await sleep(60000);
    let brokerOffer;
    {
      const db = new Database(DB_PATH, { readonly: true });
      brokerOffer = db.prepare(`
        SELECT id, give_amount, give_asset, want_amount, want_asset, protocol_status, metadata
        FROM exchange_offers
        WHERE maker=? AND created_at > ? AND protocol_status='open'
        ORDER BY created_at DESC LIMIT 1
      `).get(BROKER_KASIA, startIso);
      db.close();
    }
    if (!brokerOffer) {
      return { ok: false, error: `step 2: no broker open offer found (broker may have failed publish)` };
    }
    console.log(`[real_hedge_verify] step 2 ✓ broker offer ${brokerOffer.id.slice(0,12)} ${brokerOffer.give_amount}${brokerOffer.give_asset}→${brokerOffer.want_amount}${brokerOffer.want_asset}`);

    // Step 3: trigger manual /api/exchange/accept from Trader-M (74 KAS, sufficient for 50 KAS taker pay)
    // (Trader-A only 7.47 KAS, insufficient — Round 7 KI fix)
    console.log(`[real_hedge_verify] step 3: Trader-M manual /api/exchange/accept`);
    const traderM = getRelayInfo('Trader-M');
    if (!traderM) return { ok: false, error: 'Trader-M relay not found' };

    const acceptBody = {
      relayNodeId: traderM.id,
      offer_id: brokerOffer.id,
      selected_chain: 'bnb',
      payment_asset: 'USDT',
    };
    const acceptR = await fetch(`${CONSOLE_URL}/api/exchange/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(acceptBody),
    });
    const acceptJson = await acceptR.json().catch(() => ({}));
    if (!acceptR.ok || !acceptJson.ok) {
      return {
        ok: false,
        error: `step 3 accept fail (HTTP ${acceptR.status}): ${JSON.stringify(acceptJson).slice(0, 200)}`,
        brokerOfferId: brokerOffer.id,
      };
    }
    console.log(`[real_hedge_verify] step 3 ✓ accept submitted: ${JSON.stringify(acceptJson).slice(0, 150)}`);

    // Step 4: wait broker offer completion (max 5 min)
    console.log(`[real_hedge_verify] step 4: wait broker offer completion (max 5 min)`);
    const finalOffer = await pollOfferStatus(brokerOffer.id, { timeoutMs: 5 * 60 * 1000, pollMs: 5000 });
    console.log(`[real_hedge_verify] step 4: final offer state=${finalOffer?.protocol_status || 'TIMEOUT'}`);

    // Step 5: check hedge_placed event lifetime
    await sleep(5000);  // give executeHedgeGuarded a moment to fire
    let hedgeFinal;
    {
      const db = new Database(DB_PATH, { readonly: true });
      const r = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_placed'`).get();
      db.close();
      hedgeFinal = r.c;
    }
    const hedgeFired = hedgeFinal > hedgeBaseline;
    console.log(`[real_hedge_verify] step 5: hedge_placed final=${hedgeFinal} (baseline ${hedgeBaseline}, fired=${hedgeFired})`);

    // Get all hedge + autoTaker events
    const events = getChainEvents(startIso, ['hedge%', 'autotake_%', 'exchange_%']);
    const counts = {};
    for (const e of events) counts[e.event_type] = (counts[e.event_type] || 0) + 1;

    return {
      ok: finalOffer?.protocol_status === 'completed' && hedgeFired === true,
      summary: `offer=${brokerOffer.id.slice(0,12)} final=${finalOffer?.protocol_status || 'TIMEOUT'} hedge_fired=${hedgeFired} (baseline ${hedgeBaseline} → ${hedgeFinal})`,
      details: {
        broker_offer_id: brokerOffer.id,
        buy_pay_tx: buyResult.payTx,
        accept_result: acceptJson,
        final_offer: finalOffer ? { status: finalOffer.protocol_status, completed_at: finalOffer.completed_at } : null,
        hedge_baseline: hedgeBaseline,
        hedge_final: hedgeFinal,
        hedge_fired: hedgeFired,
        event_counts: counts,
      },
    };
  },
};
