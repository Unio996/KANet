// stress_6h_multi_persona_pool — Phase 6 #1 KI 62 (Owner 5/21 06:30 钦定)
//
// Owner directive: "多个新智能体, 不同角度不同方式, 才能真刀真枪测试."
// Spec: docs/phase6-multi-persona-stress-spec-2026-05-21.md
//
// v1 升级 vs stress_6h_real_burst (KI 60):
// - 4 relay rotate (NWT/Trader-M/Trader-A/J2) × 200 DM/day = 800 DM/day total budget
// - 80/20 qty mix (KI 57) — small 10-30 KAS / big 100-250 KAS
// - 每 relay 独立 BSC EVM 付款地址 — 真 4-user production-like
//
// v2 (排日 ship): flake_canceller + browse_only persona — 需 lib/real-chain-runner.mjs 加 skipPay 路径

import cnBuyer from '../../personas/real-chain/cn_buyer_real.mjs';
import { sleep, pollOfferStatus } from '../../lib/real-chain-runner.mjs';
import Database from 'better-sqlite3';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';
const BROKER_KASIA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const CONSOLE_URL = 'http://127.0.0.1:3100';

// 4-relay pool — DM budget × 4 = 800/day
// 每 relay 独立 kasia + BSC EVM, broker 真 mix 4 不同 user perspective
const RELAY_POOL = [
  {
    name: 'NWT',
    id: '5b236c08-03d0-456c-953d-e10001610938',
    kasia: 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm',
    bsc: '0xd3618e37354700d21FE8728Bd278Dc1924974799',
  },
  {
    name: 'Trader-M',
    id: '385f68eb-21a8-4e83-bb33-fa9f54a038ea',
    kasia: 'kaspa:qqndp3hcrce942c3max7mq3j9jc6m3y00mlpdpfpv0hzvlsygp9zx9z9xn7rh',
    bsc: '0xD8A87c1AfcFadAd46355c3d59377C9E6edf0da47',
  },
  {
    name: 'Trader-A',
    id: 'df8cd0f9-27e7-45c6-bbea-2fa11a1ff1cd',
    kasia: 'kaspa:qpsys3gzy4lg8txkuskhfnc4tskzn5r344eyudgyrc43te7vlq3f5a2cr843s',
    bsc: '0x83f65EEDFD9Ab9F7C5fd8c19F734e30264E96dB3',
  },
  {
    name: 'J2',
    id: 'c9c37c37-9a8c-484c-9893-20185d97ccf9',
    kasia: 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3',
    bsc: '0x00c41dC0D0d7F4232EFB6ec545F7ad9e031eb62f',
  },
];

// Accepter — Trader-M (separate role, NOT in buyer rotate since takes USDT-side risk)
const ACCEPTER_RELAY_ID = '385f68eb-21a8-4e83-bb33-fa9f54a038ea';

export default {
  id: 'stress_6h_multi_persona_pool',
  description: 'Phase 6 #1 KI 62: 6h 4-relay rotate + 80/20 qty mix (true production-grade endurance)',
  domain: 'multi-agent',
  tags: ['real_chain', 'expensive', 'p0', 'phase-6-1', 'stress', '6h-burst', 'multi-persona'],
  skip_in_batch: true,
  expensive: true,

  async run(opts = {}) {
    const total_duration_ms = opts.duration_ms || 6 * 60 * 60_000;
    const cycle_interval_ms = opts.cycle_interval_ms || 90_000;  // 90s ≈ 40 cycle/hr × 6h = 240 cycle

    const start = Date.now();
    const deadline = start + total_duration_ms;
    const startIso = new Date(start).toISOString();

    const stats = {
      cycles_attempted: 0,
      cycles_completed: 0,
      cycles_failed: 0,
      qty_small_count: 0,
      qty_big_count: 0,
      relay_use: {},
      hedge_placed_baseline: null,
      hedge_failed_baseline: null,
      hedge_skipped_baseline: null,
    };

    // Baseline
    const db = new Database(DB_PATH, { readonly: true });
    stats.hedge_placed_baseline = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_placed'`).get().c;
    stats.hedge_failed_baseline = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_failed'`).get().c;
    stats.hedge_skipped_baseline = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_skipped'`).get().c;
    db.close();

    console.log(`[stress_6h_multi_persona_pool] start ${startIso}, 6h target ~240 cycles (40/hr), 4-relay rotate, 80/20 qty mix`);

    let cycleIdx = 0;
    while (Date.now() < deadline) {
      cycleIdx++;
      stats.cycles_attempted = cycleIdx;

      const relay = RELAY_POOL[cycleIdx % RELAY_POOL.length];
      stats.relay_use[relay.name] = (stats.relay_use[relay.name] || 0) + 1;

      // 80/20 qty mix
      const isBig = Math.random() < 0.2;
      const qty = isBig ? (100 + Math.floor(Math.random() * 151)) : (10 + Math.floor(Math.random() * 21));
      if (isBig) stats.qty_big_count++; else stats.qty_small_count++;

      console.log(`[stress_6h_multi_persona_pool] cycle ${cycleIdx} relay=${relay.name} qty=${qty}${isBig ? ' (BIG)' : ''}`);

      // Clear escrow for this relay — Fix-1 KI 63 (NWT N19.153/154):
      // raw SQL UPDATE 绕过 broker refund path → escrow status='refunded' refund_tx=NULL → broker BSC USDT stuck.
      // 改 _refundEscrow proper path (Bug AW + Bug AP guard + transferUsdt + UPDATE refund_tx + audit).
      try {
        const { _refundEscrow } = await import('../../../src/services/exchange-machine.js');
        const rdb = new Database(DB_PATH, { readonly: true });
        const activeIds = rdb.prepare(`SELECT id FROM user_escrow_balances WHERE user_kasia_addr=? AND status='active'`).all(relay.kasia);
        rdb.close();
        for (const e of activeIds) {
          await _refundEscrow(e.id, 'pre_cycle_cleanup_test').catch(err =>
            console.warn(`[stress_6h_multi_persona_pool] refund ${e.id.slice(0,8)} skip: ${err.message}`)
          );
        }
      } catch (err) {
        console.warn(`[stress_6h_multi_persona_pool] pre-cycle cleanup err: ${err.message}`);
      }

      const cycleStart = Date.now();
      try {
        const buyResult = await cnBuyer.run(
          { id: `pool_${cycleIdx}_${relay.name}` },
          {
            relayId: relay.id,
            userKasia: relay.kasia,
            brokerKasia: BROKER_KASIA,
            userEvmAddr: relay.bsc,
            qty,
            chain: 'BSC',
            fromRelayName: relay.name,
          }
        );

        if (buyResult.stage !== 'completed_flow') {
          stats.cycles_failed++;
          console.log(`[stress_6h_multi_persona_pool] cycle ${cycleIdx} buyflow fail stage=${buyResult.stage} err=${buyResult.error || ''}`);
        } else {
          await sleep(30_000);  // broker publish lag
          const ndb = new Database(DB_PATH, { readonly: true });
          const offer = ndb.prepare(`SELECT id FROM exchange_offers WHERE maker=? AND created_at > ? AND protocol_status='open' ORDER BY created_at DESC LIMIT 1`).get(BROKER_KASIA, new Date(cycleStart).toISOString());
          ndb.close();
          if (offer) {
            const acceptRes = await fetch(`${CONSOLE_URL}/api/exchange/accept`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ relayNodeId: ACCEPTER_RELAY_ID, offer_id: offer.id, selected_chain: 'bnb', payment_asset: 'USDT' }),
              signal: AbortSignal.timeout(15_000),
            });
            if (acceptRes.ok) {
              const finalOffer = await pollOfferStatus(offer.id, { timeoutMs: 5 * 60_000, pollMs: 5_000 });
              if (finalOffer?.protocol_status === 'completed') {
                stats.cycles_completed++;
                console.log(`[stress_6h_multi_persona_pool] cycle ${cycleIdx} ✓ completed via ${relay.name}`);
              } else {
                stats.cycles_failed++;
                console.log(`[stress_6h_multi_persona_pool] cycle ${cycleIdx} stuck status=${finalOffer?.protocol_status}`);
              }
            } else {
              stats.cycles_failed++;
              console.log(`[stress_6h_multi_persona_pool] cycle ${cycleIdx} accept fail status=${acceptRes.status}`);
            }
          } else {
            stats.cycles_failed++;
            console.log(`[stress_6h_multi_persona_pool] cycle ${cycleIdx} no broker offer found`);
          }
        }
      } catch (e) {
        stats.cycles_failed++;
        console.log(`[stress_6h_multi_persona_pool] cycle ${cycleIdx} err: ${e.message}`);
      }

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
      ok: stats.cycles_failed < stats.cycles_attempted * 0.3,
      summary: `${stats.cycles_completed}/${stats.cycles_attempted} cycles complete (${(stats.cycles_completed / stats.cycles_attempted * 100).toFixed(1)}%) | failed=${stats.cycles_failed} | hedge Δ +${hp - stats.hedge_placed_baseline} placed / +${hf - stats.hedge_failed_baseline} failed / +${hs - stats.hedge_skipped_baseline} skipped | small=${stats.qty_small_count} big=${stats.qty_big_count} | relay_use=${JSON.stringify(stats.relay_use)}`,
      details: { ...stats, hedge_placed_final: hp, hedge_failed_final: hf, hedge_skipped_final: hs },
    };
  },
};
