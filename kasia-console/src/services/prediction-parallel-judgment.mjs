// Oracle v0.3 Phase 2 — parallel-judgment loop engine (J1tn cluster, Owner r148 architecture).
//
// 并行判定 (NOT pure shadow): KANet oracles judge real markets INDEPENDENTLY from an independent
// source ‖ UMA remains the final settlement basis (money follows UMA, 48h finalization) ‖ KANet's
// independent verdict is scored vs UMA's finalized outcome to accumulate per-domain track record.
//
// Design (Bettor r148 + r149, J1 R23b design-gap catch resolved):
//   - 独立判定必须有独立源. A market is GRADABLE only if condition_id_mapping (v153, J2) has
//     independent_source set AND mirror_only=0. Markets with only gamma/UMA token → mirror_only → skip
//     (拿答案考自己无意义 = re-reading UMA is not independent judgment).
//   - Disagreement (KANet ≠ UMA) → enqueue oracle_disagreement_queue (v152), do NOT auto-penalize
//     (UMA is "final basis" not "always right"; KANet correct where UMA herds = promotion signal).
//   - 并行加速积累 (每单都练), 不加速结算 (钱仍 UMA 48h 节奏).
//
// Schema deps (all shipped): oracle_history v150 (shadow_flag/uma_resolved_outcome/shadow_correct/
//   domain/uma_assertion_id/offer_id), oracle_disagreement_queue v152, condition_id_mapping v153 (J2),
//   oracle_registry.licensed_domains/frozen v151.
//
// Dependency injection: judge/resolve functions are passed in (= decouple from voter.js internals).
//   judgeFn(independentSource, offer)  → { outcome:'YES'|'NO', confidence? } | null (abstain)
//   umaResolveFn(offer)                → { ok:true, outcome } | { ok:false } (= UMA not finalized yet)
//
// HARD GATE (Bettor): auto-grant licensed_domains stays DISABLED here until post_settle_audit
// revocation engine is built + tested. This module only ACCUMULATES + SCORES; it does NOT grant.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

/**
 * Read v153 condition_id_mapping grading config for a market.
 * @returns {{ gradable, independentSource, umaAssertionId, domain, mirrorOnly }|null}
 *          null = no mapping row (= unmapped market, treat as not-yet-gradable).
 */
export function getGradingConfig(conditionId) {
  if (!conditionId) return null;
  let row;
  try {
    row = sqlite.prepare(`
      SELECT independent_source, uma_assertion_id, mirror_only, domain
      FROM condition_id_mapping WHERE condition_id = ?
    `).get(conditionId);
  } catch {
    return null; // v153 table absent (defensive — should exist post-migration)
  }
  if (!row) return null;
  return {
    gradable: row.mirror_only === 0 && !!row.independent_source,
    independentSource: row.independent_source || null,
    umaAssertionId: row.uma_assertion_id || null,
    domain: row.domain || null,
    mirrorOnly: row.mirror_only === 1,
  };
}

/**
 * Phase A — record one oracle's independent parallel judgment for a market (shadow_flag=1).
 * Idempotent: at most one parallel row per (offer, oracle). Skips mirror-only / unmapped markets.
 */
export async function recordParallelJudgment(offer, oracleRelayId, judgeFn) {
  const cfg = getGradingConfig(offer.outcome_condition_id);
  if (!cfg) return { graded: false, reason: 'no_mapping' };
  if (cfg.mirrorOnly) return { graded: false, reason: 'mirror_only' };
  if (!cfg.gradable || !cfg.independentSource) return { graded: false, reason: 'no_independent_source' };

  const exists = sqlite.prepare(
    `SELECT 1 FROM oracle_history WHERE offer_id = ? AND oracle_relay_id = ? AND shadow_flag = 1 LIMIT 1`
  ).get(offer.id, oracleRelayId);
  if (exists) return { graded: false, reason: 'already_recorded' };

  const verdict = await judgeFn(cfg.independentSource, offer);
  if (!verdict || !verdict.outcome) return { graded: false, reason: 'judge_abstain' };

  const id = randomUUID();
  sqlite.prepare(`
    INSERT INTO oracle_history
      (id, oracle_relay_id, market_id, offer_id, vote, audit_mode, shadow_flag, domain, uma_assertion_id, audited_at, epoch)
    VALUES (?, ?, ?, ?, ?, 'shadow', 1, ?, ?, datetime('now'), 1)
  `).run(id, oracleRelayId, offer.outcome_condition_id || offer.id, offer.id, verdict.outcome, cfg.domain, cfg.umaAssertionId);
  return { graded: true, id, outcome: verdict.outcome, domain: cfg.domain };
}

/**
 * Phase B — score recorded parallel judgments against UMA's finalized outcome.
 * Only scores rows where UMA has finalized (umaResolveFn ok); else leaves pending.
 * Disagreement (KANet ≠ UMA) → oracle_disagreement_queue (v152), NO auto-penalty (herding defense).
 */
export async function scoreParallelJudgments(umaResolveFn) {
  const pending = sqlite.prepare(`
    SELECT id, oracle_relay_id, offer_id, market_id, vote
    FROM oracle_history
    WHERE shadow_flag = 1 AND shadow_correct IS NULL AND uma_resolved_outcome IS NULL
  `).all();

  let scored = 0, disagreements = 0, pendingFinal = 0, missingOffer = 0;
  for (const row of pending) {
    const offer = sqlite.prepare(`SELECT * FROM exchange_offers WHERE id = ?`).get(row.offer_id);
    if (!offer) { missingOffer++; continue; }
    const uma = await umaResolveFn(offer);
    if (!uma || !uma.ok) { pendingFinal++; continue; } // UMA 48h finalization gate not passed yet

    const correct = row.vote === uma.outcome ? 1 : 0;
    sqlite.prepare(
      `UPDATE oracle_history SET uma_resolved_outcome = ?, shadow_correct = ?, settled_at = datetime('now') WHERE id = ?`
    ).run(uma.outcome, correct, row.id);
    scored++;

    if (!correct) {
      sqlite.prepare(`
        INSERT INTO oracle_disagreement_queue
          (id, market_id, oracle_relay_id, oracle_vote, uma_outcome, source, status)
        VALUES (?, ?, ?, ?, ?, 'shadow', 'pending')
      `).run(randomUUID(), row.market_id, row.oracle_relay_id, row.vote, uma.outcome);
      disagreements++;
    }
  }
  return { scored, disagreements, pendingFinal, missingOffer };
}

/**
 * Per-domain shadow accuracy aggregate for one oracle (= 能力支柱 input).
 * Used by the (hard-gated) auto-grant decision: domain D gradable if accuracy ≥ threshold over ≥ N.
 * This is READ-ONLY accumulation reporting; it does NOT grant licenses.
 */
export function shadowAccuracyByDomain(oracleRelayId) {
  return sqlite.prepare(`
    SELECT domain,
           COUNT(*) AS graded,
           SUM(CASE WHEN shadow_correct = 1 THEN 1 ELSE 0 END) AS correct
    FROM oracle_history
    WHERE oracle_relay_id = ? AND shadow_flag = 1 AND shadow_correct IS NOT NULL
    GROUP BY domain
  `).all(oracleRelayId).map(r => ({
    domain: r.domain,
    graded: r.graded,
    correct: r.correct,
    accuracy: r.graded > 0 ? r.correct / r.graded : null,
  }));
}

/**
 * Auto-grant evaluation — HARD GATED (Bettor). Returns domains that MEET the bar but does NOT
 * write licensed_domains. Wiring to oracle_registry.licensed_domains is BLOCKED until the
 * post_settle_audit revocation engine is built + tested (= can't grant what you can't revoke).
 *
 * @param thresholds { minAccuracy=0.9, minGraded=100 } (= Owner-locked ≥90%/≥100单/域)
 */
export function evaluateAutoGrantCandidates(oracleRelayId, thresholds = {}) {
  const minAccuracy = thresholds.minAccuracy ?? 0.9;
  const minGraded = thresholds.minGraded ?? 100;
  const perDomain = shadowAccuracyByDomain(oracleRelayId);
  return {
    HARD_GATED: true,
    reason: 'auto-grant disabled until post_settle_audit revocation engine ready + tested (Bettor 硬 gate)',
    candidates: perDomain.filter(d => d.domain && d.accuracy !== null && d.accuracy >= minAccuracy && d.graded >= minGraded),
    thresholds: { minAccuracy, minGraded },
  };
}

/**
 * Engine tick — wires Phase A (record) + Phase B (score) over active prediction offers.
 * Caller injects judgeFn (independent-source LLM judge) + umaResolveFn (UMA finalized outcome).
 * voterRelayIds = the host's is_oracle=1 relay ids that produce independent judgments.
 */
export async function parallelJudgmentTick({ judgeFn, umaResolveFn, voterRelayIds = [] } = {}) {
  if (typeof judgeFn !== 'function' || typeof umaResolveFn !== 'function') {
    throw new Error('parallelJudgmentTick requires judgeFn + umaResolveFn');
  }
  // Phase A: active prediction offers (give_asset prediction share) past their outcome window,
  // restricted to gradable (mapped + independent_source) markets — recordParallelJudgment filters.
  const activeOffers = sqlite.prepare(`
    SELECT id, outcome_condition_id, outcome_market_source, outcome_token_id, outcome_side,
           resolution_rule_spec, protocol_status
    FROM exchange_offers
    WHERE (give_asset = 'prediction_outcome_share' OR want_asset = 'prediction_outcome_share')
      AND protocol_status IN ('matched','verifying','collecting_sigs','completed')
  `).all();

  let recorded = 0, skipped = 0;
  for (const offer of activeOffers) {
    for (const oracleId of voterRelayIds) {
      const r = await recordParallelJudgment(offer, oracleId, judgeFn);
      if (r.graded) recorded++; else skipped++;
    }
  }

  // Phase B: score any pending parallel rows whose UMA outcome has finalized.
  const scoreResult = await scoreParallelJudgments(umaResolveFn);

  return { phaseA: { recorded, skipped }, phaseB: scoreResult };
}
