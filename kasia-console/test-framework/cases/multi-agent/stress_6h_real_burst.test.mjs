// stress_6h_real_burst — Phase 6 #1 KI 60 6h real-burst endurance (NWT N19.146 Path C)
//
// Pattern: reuse real_hedge_verify flow (NWT DM → broker publish → Trader-M accept → complete → hedge).
// Loop 180 cycles over 6h (1 cycle / 2 min) with 80/20 qty mix.
//
// real-burst > mock framework for production stress validation:
// - Phase 6 #2/#3 已 verify real broker-v3 cycle work
// - 180 real cycles = broker self-sustain 真 endurance
// - mock framework had 4 design gaps (sub-min qty / no taker / slow spawn / no sendKas)

import cnBuyer from '../../personas/real-chain/cn_buyer_real.mjs';
import { getRelayInfo, sleep, pollOfferStatus } from '../../lib/real-chain-runner.mjs';
import Database from 'better-sqlite3';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';
const NWT_RELAY = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_KASIA = 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm';
const BROKER_KASIA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const NWT_BSC_ADDR = '0xd3618e37354700d21FE8728Bd278Dc1924974799';
const CONSOLE_URL = 'http://127.0.0.1:3100';

export default {
  id: 'stress_6h_real_burst',
  description: 'Phase 6 #1 KI 60: 6h real-burst (NWT DM broker → real cycle × 180 × 80/20 mix qty)',
  domain: 'multi-agent',
  tags: ['real_chain', 'expensive', 'p0', 'phase-6-1', 'stress', '6h-burst', 'production-grade'],
  skip_in_batch: true,
  expensive: true,

  async run(opts = {}) {
    const total_duration_ms = opts.duration_ms || 6 * 60 * 60_000;  // 6h
    const cycle_interval_ms = opts.cycle_interval_ms || 2 * 60_000;  // 2 min between cycles = 30/hr
    const traderM_relay = getRelayInfo('Trader-M');
    if (!traderM_relay) return { ok: false, error: 'Trader-M relay not found' };

    const start = Date.now();
    const deadline = start + total_duration_ms;
    const startIso = new Date(start).toISOString();

    const stats = {
      cycles_attempted: 0,
      cycles_completed: 0,
      cycles_failed: 0,
      hedge_placed_baseline: null,
      hedge_failed_baseline: null,
      hedge_skipped_baseline: null,
      qty_small_count: 0,
      qty_big_count: 0,
    };

    // Baseline
    const db = new Database(DB_PATH, { readonly: true });
    stats.hedge_placed_baseline = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_placed'`).get().c;
    stats.hedge_failed_baseline = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_failed'`).get().c;
    stats.hedge_skipped_baseline = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_skipped'`).get().c;
    db.close();

    console.log(`[stress_6h_real_burst] start ${startIso}, 6h target 180 cycles, 80/20 mix`);

    let cycleIdx = 0;
    while (Date.now() < deadline) {
      cycleIdx++;
      stats.cycles_attempted = cycleIdx;
      // KI 57 80/20 mix
      const isBig = Math.random() < 0.2;
      const qty = isBig ? (100 + Math.floor(Math.random() * 151)) : (10 + Math.floor(Math.random() * 21));
      if (isBig) stats.qty_big_count++; else stats.qty_small_count++;

      console.log(`[stress_6h_real_burst] cycle ${cycleIdx} fire qty=${qty} ${isBig ? '(BIG)' : '(small)'}`);

      // Clear NWT escrow before each cycle (avoid Bug AW race) — Fix-1 KI 63 (NWT N19.153/154):
      // raw SQL UPDATE 绕过 broker refund path → escrow status='refunded' refund_tx=NULL → broker BSC USDT stuck.
      // 改 _refundEscrow proper path (Bug AW + Bug AP guard + transferUsdt + UPDATE refund_tx + audit).
      try {
        const { _refundEscrow } = await import('../../../src/services/exchange-machine.js');
        const rdb = new Database(DB_PATH, { readonly: true });
        const activeIds = rdb.prepare(`SELECT id FROM user_escrow_balances WHERE user_kasia_addr=? AND status='active'`).all(NWT_KASIA);
        rdb.close();
        for (const e of activeIds) {
          await _refundEscrow(e.id, 'pre_cycle_cleanup_test').catch(err =>
            console.warn(`[stress_6h_real_burst] refund ${e.id.slice(0,8)} skip: ${err.message}`)
          );
        }
      } catch (err) {
        console.warn(`[stress_6h_real_burst] pre-cycle cleanup err: ${err.message}`);
      }

      const cycleStart = Date.now();
      try {
        const buyResult = await cnBuyer.run(
          { id: `burst_${cycleIdx}_buyer` },
          {
            relayId: NWT_RELAY,
            userKasia: NWT_KASIA,
            brokerKasia: BROKER_KASIA,
            userEvmAddr: NWT_BSC_ADDR,
            qty,
            chain: 'BSC',
            fromRelayName: 'NWT',
          }
        );
        if (buyResult.stage !== 'completed_flow') {
          stats.cycles_failed++;
          console.log(`[stress_6h_real_burst] cycle ${cycleIdx} buyflow fail stage=${buyResult.stage} error=${buyResult.error || ''}`);
        } else {
          // wait broker publish + manually accept via Trader-M
          await sleep(30_000);
          const ndb = new Database(DB_PATH, { readonly: true });
          const offer = ndb.prepare(`SELECT id FROM exchange_offers WHERE maker=? AND created_at > ? AND protocol_status='open' ORDER BY created_at DESC LIMIT 1`).get(BROKER_KASIA, new Date(cycleStart).toISOString());
          ndb.close();
          if (offer) {
            const acceptRes = await fetch(`${CONSOLE_URL}/api/exchange/accept`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ relayNodeId: traderM_relay.id, offer_id: offer.id, selected_chain: 'bnb', payment_asset: 'USDT' }),
              signal: AbortSignal.timeout(15_000),
            });
            const acceptData = await acceptRes.json().catch(() => ({}));
            if (acceptRes.ok && acceptData.ok) {
              const finalOffer = await pollOfferStatus(offer.id, { timeoutMs: 5 * 60_000, pollMs: 5_000 });
              if (finalOffer?.protocol_status === 'completed') {
                stats.cycles_completed++;
                console.log(`[stress_6h_real_burst] cycle ${cycleIdx} ✓ completed`);
              } else {
                stats.cycles_failed++;
                console.log(`[stress_6h_real_burst] cycle ${cycleIdx} stuck status=${finalOffer?.protocol_status}`);
              }
            } else {
              stats.cycles_failed++;
              console.log(`[stress_6h_real_burst] cycle ${cycleIdx} accept fail: ${JSON.stringify(acceptData).slice(0, 100)}`);
            }
          } else {
            stats.cycles_failed++;
            console.log(`[stress_6h_real_burst] cycle ${cycleIdx} no broker offer found`);
          }
        }
      } catch (e) {
        stats.cycles_failed++;
        console.log(`[stress_6h_real_burst] cycle ${cycleIdx} err: ${e.message}`);
      }

      // Wait until next cycle start (target 2 min interval)
      const elapsed = Date.now() - cycleStart;
      const wait = Math.max(0, cycle_interval_ms - elapsed);
      if (Date.now() + wait >= deadline) break;
      await sleep(wait);
    }

    // Final stats
    const dbf = new Database(DB_PATH, { readonly: true });
    const hp = dbf.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_placed'`).get().c;
    const hf = dbf.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_failed'`).get().c;
    const hs = dbf.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_skipped'`).get().c;
    dbf.close();

    return {
      ok: stats.cycles_failed < stats.cycles_attempted * 0.3,  // fail rate < 30%
      summary: `${stats.cycles_completed}/${stats.cycles_attempted} cycles complete (${(stats.cycles_completed / stats.cycles_attempted * 100).toFixed(1)}%) | hedge Δ +${hp - stats.hedge_placed_baseline} placed / +${hf - stats.hedge_failed_baseline} failed / +${hs - stats.hedge_skipped_baseline} skipped | small=${stats.qty_small_count} big=${stats.qty_big_count}`,
      details: { ...stats, hedge_placed_final: hp, hedge_failed_final: hf, hedge_skipped_final: hs },
    };
  },
};
