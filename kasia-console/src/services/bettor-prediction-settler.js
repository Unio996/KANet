// r177 Phase 2c — prediction_outcome_share settlement detector (Owner 5/19 钦定 "go phase 2 直 fire
// 2c 不 UAT" + Bettor r197 0 push back ack).
//
// lint-allow-protocol-status-direct: r177-phase2c-settle-detector (Phase 2b exchange-machine
// integration 接管后改走 transition(id,'completed'); 现阶段 detect+mark 与 chain payout 解耦).
//
// 5min cron tick: 检查所有 outcome_end_date 已过的 prediction offer (matched/verifying/delivering 中),
// 调 verifyPredictionOutcome (bettor-prediction-verifier.js 已 ship) → 若 resolved (winner 出):
//   1. mark offer protocol_status=completed (direct UPDATE w/ allow marker per Phase 2b deferred)
//      + metadata json{settle_winner, maker_outcome_side, maker_won, settle_kas_delta,
//                      settle_outcome_phase='detected', settled_at}
//   2. INSERT prediction_reputation_log (event_type='settled', settled_kas_delta)
//
// settle_kas_delta 语义: 正 = maker 赢 (taker 输 KAS), 负 = maker 输 (maker 真链 payout 待 Phase 2b
// exchange-machine.transition delivering→completed 钩 evm-transfer/sendKas).
// 本 service 只 detect + mark + log, 不动 chain TX. 解耦 detect 与 payout, Phase 2c isolated.
//
// 不撞 30s exchange-machine cron (expireStale/timeoutVerifying): gamma API 每 offer 1 fetch,
// 5min 频率 + startup catch-up 1 tick (R-CRON-NO-STARTUP-CATCHUP sediment 守).

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';
import { verifyPredictionOutcome } from './bettor-prediction-verifier.js';

const TICK_INTERVAL_MS = 5 * 60 * 1000;  // 5 min
const STARTUP_GRACE_MS = 30 * 1000;       // 30s grace 让 Console boot 其他 cron 先稳

let timer = null;
let running = false;

export function startPredictionSettlerCron() {
  if (timer) return;
  console.log('[prediction-settler] started — 5min cron, settle expired prediction_outcome_share offers (Phase 2c detect+mark+log, payout 真链 Phase 2b)');
  setTimeout(() => {
    settlePredictionOutcomes().catch(e => console.error('[prediction-settler] startup catch-up:', e.message));
  }, STARTUP_GRACE_MS);
  timer = setInterval(() => {
    settlePredictionOutcomes().catch(e => console.error('[prediction-settler] tick:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopPredictionSettlerCron() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function settlePredictionOutcomes() {
  if (running) {
    console.log('[prediction-settler] tick skipped (previous still running)');
    return { skipped: true };
  }
  running = true;
  try {
    const offers = sqlite.prepare(`
      SELECT id, maker, give_asset, give_amount, want_asset, want_amount, taker,
             outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side,
             outcome_end_date, outcome_oracle_hook, outcome_max_deviation_pp,
             published_price, protocol_status, metadata
      FROM exchange_offers
      WHERE (give_asset = 'prediction_outcome_share' OR want_asset = 'prediction_outcome_share')
        AND protocol_status IN ('matched','verifying','delivering')
        AND outcome_end_date IS NOT NULL
        AND datetime(outcome_end_date) <= datetime('now')
    `).all();
    if (!offers.length) return { ok: true, processed: 0 };

    let settled = 0, pending = 0, errored = 0;
    for (const offer of offers) {
      try {
        const offerForVerify = { ...offer, maker_relay_id: offer.maker };
        const r = await verifyPredictionOutcome(offerForVerify);
        if (!r.ok) {
          console.warn(`[prediction-settler] verify fail ${offer.id.slice(0, 8)}: ${r.reason}`);
          errored++;
          continue;
        }
        if (!r.resolved) { pending++; continue; }

        const winner = r.winner;  // 'YES' or 'NO'
        const makerWon = (offer.outcome_side === winner);
        const sizeKas = parseFloat(offer.want_amount) || 0;
        const settleKasDelta = makerWon ? sizeKas : -sizeKas;
        const metaPrev = (() => {
          try { return JSON.parse(offer.metadata || '{}'); } catch { return {}; }
        })();
        const metaNew = JSON.stringify({
          ...metaPrev,
          settle_winner: winner,
          maker_outcome_side: offer.outcome_side,
          maker_won: makerWon,
          settle_kas_delta: settleKasDelta,
          settled_at: new Date().toISOString(),
          settle_outcome_phase: 'detected',  // Phase 2b 真链 payout 后改 'paid'
        });

        // lint-allow-protocol-status-direct: r177-phase2c-settle-detector-pre-exchange-machine-integration
        sqlite.prepare(`UPDATE exchange_offers SET protocol_status='completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP, metadata=? WHERE id=?`)
          .run(metaNew, offer.id);
        if (offer.maker) {
          sqlite.prepare(`INSERT INTO prediction_reputation_log (id, maker_relay_id, event_type, settled_kas_delta, dispute_outcome, recorded_at) VALUES (?, ?, 'settled', ?, NULL, CURRENT_TIMESTAMP)`)
            .run(randomUUID(), offer.maker, settleKasDelta);
        }
        settled++;
        console.log(`[prediction-settler] settled ${offer.id.slice(0, 8)}: winner=${winner} maker_side=${offer.outcome_side} maker_won=${makerWon} delta=${settleKasDelta.toFixed(4)} KAS`);
      } catch (e) {
        console.error(`[prediction-settler] settle fail ${offer.id?.slice(0, 8)}: ${e.message}`);
        errored++;
      }
    }
    console.log(`[prediction-settler] tick: ${offers.length} expired, settled=${settled} pending=${pending} errored=${errored}`);
    return { ok: true, processed: offers.length, settled, pending, errored };
  } finally {
    running = false;
  }
}
