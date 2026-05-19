// r177 Phase 2c (detect+mark) + Phase 2b (state-machine 集成) — prediction_outcome_share
// settlement settler.
//
// Owner 5/19 "go phase 2 直 fire 2c 不 UAT" + Bettor r197 0 push back (2c initial)
// Owner 5/19 "一气呵成 不停" + #286 立 fire (2b state-machine integration).
//
// 5min cron tick (prediction lifecycle 用 verifying/delivering — 都 in DB CHECK 约束):
//   matched → verifying (settler 一拿到 matched 立 transition; 表 oracle 验证中)
//   verifying (未 resolve) → 留 verifying 下次 tick
//   verifying (resolved) → delivering → completed (同 tick 串 transition, prediction 无真链 delivery)
// awaiting_oracle/awaiting_manual_confirm/verified 在 VALID_TRANSITIONS 但 DB CHECK 缺,
// 需 migration 加入 → 留 Phase 2b' 一起加 (跟 fund_lock prediction 分类 + 真链 payout 同步).
//
// transition() to 'completed' 触发 exchange-machine 内 spendFunds(offerId) (idempotent 安全;
// prediction Phase 1 publish 没 lock fund 所以 no-op) + DM taker (= UX 闭环 提示).
//
// 真链 KAS payout 真转账 (delivering→completed 钩 sendKas 给 winner) 留 Phase 2b' (~120 LOC
// stake escrow + fund_lock prediction 分类 + chain TX 真转), 跟 detect 解耦.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';
import { verifyPredictionOutcome } from './bettor-prediction-verifier.js';
import { transition } from './exchange-machine.js';

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
    // r177 Phase 2b: prediction lifecycle = matched → verifying → delivering → completed.
    // 用 verifying/delivering 都 in DB CHECK 约束 (跟 awaiting_oracle 不同, 后者 CHECK 缺失,
    // 需 v122 migration 才能 enable — 留 Phase 2b' 真链 payout 一起加).
    //   matched → verifying: settler 首次 tick detect (= "已 detect 过期, oracle 验证中")
    //   verifying (未 resolve) → 留 verifying 下次 tick
    //   verifying (resolved) → delivering → completed: 同 tick 串 transition (prediction 无真链 delivery)
    const offers = sqlite.prepare(`
      SELECT id, maker, give_asset, give_amount, want_asset, want_amount, taker,
             outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side,
             outcome_end_date, outcome_oracle_hook, outcome_max_deviation_pp,
             published_price, protocol_status, metadata
      FROM exchange_offers
      WHERE (give_asset = 'prediction_outcome_share' OR want_asset = 'prediction_outcome_share')
        AND protocol_status IN ('matched','verifying')
        AND outcome_end_date IS NOT NULL
        AND datetime(outcome_end_date) <= datetime('now')
    `).all();
    if (!offers.length) return { ok: true, processed: 0 };

    let settled = 0, pending = 0, errored = 0;
    for (const offer of offers) {
      try {
        // matched → verifying 立 transition (= settler 已认领, 表 oracle 验证中)
        if (offer.protocol_status === 'matched') {
          try {
            transition(offer.id, 'verifying');
          } catch (e) {
            console.warn(`[prediction-settler] transition matched→verifying fail ${offer.id.slice(0,8)}: ${e.message}`);
          }
        }

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
          settle_outcome_phase: 'detected',  // Phase 2b' 真链 payout 后改 'paid'
        });

        // verifying → delivering → completed 同 tick 串 transition (= VALID_TRANSITIONS 真路径)
        // prediction 无真链 KAS 转 (Phase 2b'), delivering state 仅做 audit timestamp,
        // 立 走 completed. transition() 内 spendFunds idempotent + DM taker 表 settle 闭环.
        try {
          transition(offer.id, 'delivering');
          transition(offer.id, 'completed', { metadata: metaNew });
        } catch (e) {
          console.error(`[prediction-settler] transition verifying→delivering→completed fail ${offer.id.slice(0,8)}: ${e.message}`);
          errored++;
          continue;
        }
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
