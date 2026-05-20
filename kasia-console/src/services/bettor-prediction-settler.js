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
import { sendCommandAsync } from './relay-manager.js';
import { getConfig } from '../data/settings/configs.js';

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
      SELECT id, maker, maker_kaspa_addr, maker_relay_id, give_asset, give_amount, want_asset, want_amount, taker,
             outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side,
             outcome_end_date, outcome_oracle_hook, outcome_max_deviation_pp,
             outcome_oracle_relay_id, resolution_rule_spec,
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

        // r211 O-7 multi-oracle aggregation path (= Path D maker 自选 oracle):
        //   若 outcome_oracle_relay_id 设, 走 collectMultiOracleVotes (= 收 3+ vote DM from voter daemon)
        //   否则 fallback legacy verifyPredictionOutcome (= polymarket_uma_mirror 直接 Polymarket gamma)
        let r;
        if (offer.outcome_oracle_relay_id) {
          r = await collectMultiOracleVotes(offer);
        } else {
          // r177 Phase 2a hotfix PB4: offer.maker_relay_id 直 from DB col (v122).
          // verifyPredictionOutcome 只用 outcome_* fields, 不查 whitelist — 这里 alias 已 cleanup.
          r = await verifyPredictionOutcome(offer);
        }
        if (!r.ok) {
          console.warn(`[prediction-settler] verify fail ${offer.id.slice(0, 8)}: ${r.reason}`);
          errored++;
          continue;
        }
        if (!r.resolved) { pending++; continue; }

        const winner = r.winner;  // 'YES' or 'NO'
        const makerWon = (offer.outcome_side === winner);
        const metaPrev = (() => {
          try { return JSON.parse(offer.metadata || '{}'); } catch { return {}; }
        })();
        // r177 Phase 2b'.1 stake = (1 - price) × shares × (1/KAS_USD) (真 prediction math).
        // Phase 1 / 2 / 2a / 2b 时期写的 offer 没 metadata.stake_locked_kas, fallback want_amount (= wager math, legacy compat).
        const stakeKas = parseFloat(metaPrev.stake_locked_kas) || parseFloat(offer.want_amount) || 0;
        const settleKasDelta = makerWon ? stakeKas : -stakeKas;
        const metaAfterDetect = {
          ...metaPrev,
          settle_winner: winner,
          maker_outcome_side: offer.outcome_side,
          maker_won: makerWon,
          settle_kas_delta: settleKasDelta,
          settled_at: new Date().toISOString(),
        };

        // r177 Phase 2b'.2 真 KAS payout chain TX (Owner 5/19 "一气呵成" + Bettor r205/r206 共识 A1.a/A2.b):
        // verifying → delivering (settler 准 payout) → 真链 sendKas → completed.
        // winner_addr: maker_won = offer.maker_kaspa_addr (v123 双 col) || offer.maker (legacy fallback)
        //            : taker_won = offer.taker (kaspa addr, transition('matched') 时 set)
        // escrow_addr config + reverse-lookup relay_id (= relay 控 escrow 私钥) 走 sendCommandAsync transfer.
        try {
          transition(offer.id, 'delivering');
        } catch (e) {
          console.error(`[prediction-settler] transition verifying→delivering fail ${offer.id.slice(0,8)}: ${e.message}`);
          errored++;
          continue;
        }

        const winnerAddr = makerWon
          ? (offer.maker_kaspa_addr || offer.maker)
          : offer.taker;
        if (!winnerAddr || !String(winnerAddr).startsWith('kaspa:')) {
          console.error(`[prediction-settler] payout target missing or invalid ${offer.id.slice(0,8)}: maker_won=${makerWon} winnerAddr=${winnerAddr}`);
          errored++;
          continue;  // 留 delivering, 下次 tick retry (Owner 介入 可能)
        }

        const escrowAddr = await getConfig('kanet_prediction_escrow_addr');
        const escrowRelay = escrowAddr ? sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(escrowAddr) : null;
        if (!escrowRelay) {
          console.error(`[prediction-settler] escrow config missing OR relay row not found ${offer.id.slice(0,8)}: escrowAddr=${escrowAddr}. Stay delivering, Owner action required.`);
          errored++;
          continue;
        }

        let payoutTxId = null;
        const PAYOUT_MAX_ATTEMPTS = 3;
        for (let attempt = 1; attempt <= PAYOUT_MAX_ATTEMPTS; attempt++) {
          try {
            const result = await sendCommandAsync(escrowRelay.id, {
              type: 'transfer',
              target: winnerAddr,
              amount: stakeKas.toFixed(8),  // KI-30: Kaspa sompi max 8 decimal precision
            });
            payoutTxId = result?.txId || null;
            if (payoutTxId) break;
            if (attempt < PAYOUT_MAX_ATTEMPTS) await new Promise(r => setTimeout(r, attempt * 5000));
          } catch (err) {
            console.error(`[prediction-settler] payout attempt ${attempt}/${PAYOUT_MAX_ATTEMPTS} fail ${offer.id.slice(0,8)}: ${err.message}`);
            if (attempt < PAYOUT_MAX_ATTEMPTS) await new Promise(r => setTimeout(r, attempt * 5000));
          }
        }
        if (!payoutTxId) {
          console.error(`[prediction-settler] payout chain TX exhausted 3 attempts ${offer.id.slice(0,8)} winner=${winnerAddr.slice(-12)} stake=${stakeKas.toFixed(4)} — stay delivering, next tick retry`);
          errored++;
          continue;  // 留 delivering, retry next tick (= 跟 exchange auto-deliver Bug-Z2 pattern 一致)
        }

        const metaFinal = JSON.stringify({
          ...metaAfterDetect,
          payout_tx: payoutTxId,
          payout_target: winnerAddr,
          settle_outcome_phase: 'paid',
        });
        try {
          transition(offer.id, 'completed', { metadata: metaFinal });
        } catch (e) {
          console.error(`[prediction-settler] transition delivering→completed fail (after payout TX ${payoutTxId.slice(0,12)}) ${offer.id.slice(0,8)}: ${e.message} — manual DB cleanup needed (chain TX done)`);
          errored++;
          continue;
        }
        // r177 Phase 2a hotfix PB4: 用 maker_relay_id (UUID) 写 reputation log.
        // r177 Phase 2b'.2: event_type='paid' 区分 detect-only vs 真链已 payout. (= 'settled' deprecated Phase 2b'.2 后)
        const makerRelayForLog = offer.maker_relay_id || offer.maker;
        if (makerRelayForLog) {
          sqlite.prepare(`INSERT INTO prediction_reputation_log (id, maker_relay_id, event_type, settled_kas_delta, dispute_outcome, recorded_at) VALUES (?, ?, 'paid', ?, NULL, CURRENT_TIMESTAMP)`)
            .run(randomUUID(), makerRelayForLog, settleKasDelta);
        }
        console.log(`[prediction-settler] PAYOUT ${offer.id.slice(0, 8)}: winner=${winner} addr=${winnerAddr.slice(-12)} stake=${stakeKas.toFixed(4)} KAS payout_tx=${payoutTxId.slice(0,12)}`);
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

// r211 O-7 collectMultiOracleVotes — maker-side aggregator (= Path D + PB-D consensus).
//   收 voter daemon DM (= kanet_oracle_vote_v1) via chain_events 'oracle_vote' to maker_kaspa_addr.
//   3+ aligned outcome (= 3-of-5 multi-sig consensus) → declare winner.
//   Phase 3a MVP: 仅 DB aggregation. Phase 4 (= SS contract address available) 真 build settleByMultiOracle TX.
async function collectMultiOracleVotes(offer) {
  if (!offer.maker_kaspa_addr) {
    return { ok: false, reason: 'missing maker_kaspa_addr (= aggregator target)' };
  }
  const votes = sqlite.prepare(`
    SELECT id, from_address, payload, observed_at
    FROM chain_events
    WHERE event_type = 'oracle_vote'
      AND to_address = ?
      AND payload LIKE ?
  `).all(offer.maker_kaspa_addr, `%"offer_id":"${offer.id}"%`);

  if (!votes.length) {
    return { ok: false, reason: 'no oracle votes received yet' };
  }

  // Parse + tally by outcome
  const tally = { YES: 0, NO: 0, DISPUTE: 0 };
  const voters = new Set();
  for (const v of votes) {
    try {
      const p = JSON.parse(v.payload || '{}');
      if (p.t !== 'kanet_oracle_vote_v1') continue;
      // dedupe per voter (= same voter multi-vote, take latest)
      if (voters.has(p.voter_relay_id)) continue;
      voters.add(p.voter_relay_id);
      if (tally[p.outcome] !== undefined) tally[p.outcome]++;
    } catch {}
  }

  const REQUIRED_SIGS = 3;  // r211 v3 Phase 3a: 3-of-5 multi-sig consensus
  if (tally.YES >= REQUIRED_SIGS) {
    return { ok: true, resolved: true, winner: 'YES', votes_yes: tally.YES, votes_no: tally.NO, total_voters: voters.size };
  }
  if (tally.NO >= REQUIRED_SIGS) {
    return { ok: true, resolved: true, winner: 'NO', votes_yes: tally.YES, votes_no: tally.NO, total_voters: voters.size };
  }
  // 不 quorum yet — 继续 wait (= 留 verifying)
  return { ok: true, resolved: false, votes_yes: tally.YES, votes_no: tally.NO, votes_dispute: tally.DISPUTE, total_voters: voters.size, required: REQUIRED_SIGS };
}
