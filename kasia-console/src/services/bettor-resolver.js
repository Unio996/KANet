/**
 * Bettor Resolver — 战绩追踪 (Phase 3d, Owner 5/9 钦定)
 *
 * 1h cron 扫已到期未结算的推荐, 查 Polymarket 真实 outcome, 算 was_correct/brier/pnl_hypothetical.
 * 结果回写 bettor_recommendations, status='resolved'.
 *
 * 累计胜率 + 平均 Brier + 总 PnL = "Bettor 这个 Agent 的真实战绩".
 */

import { sqlite } from '../db/client.js';
import { getMarketWinner } from './polymarket.js';

const RESOLVER_INTERVAL_MS = 60 * 60 * 1000; // 1h
let _timer = null;
let _running = false;

export async function resolveExpired() {
  if (_running) return { skipped: 'already running' };
  _running = true;
  try {
    // J1 #105 fix: scanner 把 end_date 写成赛季结束日不是单场, resolver SQL 太严漏 6 仓.
    // OR 化: 任一条件命中即拉链上 payoutNumerators (双重确认):
    //   1. end_date < now (老逻辑, 时间到了)
    //   2. 最新 snapshot current_yes_price ∈ {0, 1} (Polymarket 价已 binary 化, 实际已 resolve)
    const pendings = sqlite.prepare(`
      SELECT r.id, r.condition_id, r.decision, r.p_mid, r.yes_price, r.size_usd, r.fraction
      FROM bettor_recommendations r
      WHERE r.status = 'pending' AND r.outcome IS NULL
        AND (
          (r.end_date IS NOT NULL AND r.end_date < datetime('now'))
          OR EXISTS (
            SELECT 1 FROM bettor_sim_positions p
            JOIN bettor_sim_snapshots s ON s.id = (
              SELECT id FROM bettor_sim_snapshots WHERE position_id = p.id
              ORDER BY snapshot_at DESC LIMIT 1
            )
            WHERE p.recommendation_id = r.id
              AND (s.current_yes_price <= 0.01 OR s.current_yes_price >= 0.99)
          )
        )
      LIMIT 200
    `).all();

    if (pendings.length === 0) {
      return { resolved: 0, errors: 0, skipped: 0, total: 0 };
    }
    console.log(`[bettor-resolver] checking ${pendings.length} expired pending recs`);

    let resolved = 0, errors = 0, stillPending = 0, unresolvable = 0;
    for (const r of pendings) {
      if (!r.condition_id) {
        sqlite.prepare(`UPDATE bettor_recommendations SET status='unresolvable' WHERE id=?`).run(r.id);
        unresolvable++;
        continue;
      }
      try {
        const wInfo = await getMarketWinner(r.condition_id);
        if (!wInfo?.resolved) { stillPending++; continue; }

        // Normalize 'Yes'/'No' → 'YES'/'NO'
        const outcome = wInfo.winner === 'Yes' ? 'YES' : wInfo.winner === 'No' ? 'NO' : null;
        if (!outcome) { unresolvable++; continue; } // tied/invalid

        const wasCorrect = r.decision === outcome ? 1 : 0;
        const actual = outcome === 'YES' ? 1 : 0;
        const brier = Math.pow((r.p_mid - actual), 2);

        // 假想 PnL (你按推荐 size_usd 出手时):
        //   BUY YES @ price=yes_price → 赢 = size*(1/yes_price-1), 输 = -size
        //   BUY NO  @ price=(1-yes_price) → 赢 = size*(1/(1-yes_price)-1), 输 = -size
        //   SKIP → PnL = 0
        let pnl = 0;
        if (r.decision !== 'SKIP') {
          const buyPrice = r.decision === 'YES' ? r.yes_price : (1 - r.yes_price);
          if (buyPrice > 0 && buyPrice < 1) {
            pnl = wasCorrect
              ? r.size_usd * (1 / buyPrice - 1)
              : -r.size_usd;
          }
        }

        sqlite.prepare(`
          UPDATE bettor_recommendations
          SET outcome=?, outcome_resolved_at=datetime('now'), was_correct=?,
              brier=?, pnl_hypothetical=?, status='resolved'
          WHERE id=?
        `).run(outcome, wasCorrect, brier, pnl, r.id);
        // Mirror: close the linked sim_position with realized_pnl
        sqlite.prepare(`
          UPDATE bettor_sim_positions
          SET closed_at=datetime('now'), close_reason='resolved', realized_pnl=?
          WHERE recommendation_id=? AND closed_at IS NULL
        `).run(pnl, r.id);
        // Auto-dismiss any pending adjustment for this resolved position (truth resolved
        // → no manual stop-loss decision needed). UI 调仓 tab 自动清.
        sqlite.prepare(`
          UPDATE bettor_adjustments SET status='dismissed', decided_at=datetime('now'), decided_by='auto-resolver'
          WHERE recommendation_id=? AND status='pending'
        `).run(r.id);
        // Module 3 (Owner 5/15 推荐历史 + 胜率轨迹): log to bettor_outcome_log (v110 Module 1).
        // Predicted P&L: same formula as `pnl` above (hypothetical at recommendation size).
        // Actual P&L: same value (sim mode, no real fill cost basis tracking yet — extend when bettor_real_positions has filled rows).
        const marketIdRow = sqlite.prepare(`SELECT market_id FROM bettor_recommendations WHERE id=?`).get(r.id);
        sqlite.prepare(`
          INSERT INTO bettor_outcome_log
            (recommendation_id, market_id, resolved_at, actual_outcome, recommended_outcome, was_correct, predicted_pnl_usd, actual_pnl_usd, close_price, notes)
          VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
        `).run(
          r.id, String(marketIdRow?.market_id || ''),
          outcome, r.decision, wasCorrect,
          pnl, pnl, // sim mode: predicted == actual; will diverge when real wallet fills tracked separately
          actual, // close_price = settle price (1 if YES wins, 0 if NO wins)
          `sim resolved at brier=${brier.toFixed(3)}`
        );
        resolved++;
        console.log(`[bettor-resolver] ${r.id.slice(0,8)} ${r.decision}/${outcome} ${wasCorrect ? '✓' : '✗'} pnl=${pnl.toFixed(2)} brier=${brier.toFixed(3)}`);
      } catch (e) {
        console.log(`[bettor-resolver] ${r.id.slice(0,8)} error: ${e.message}`);
        errors++;
      }
    }
    console.log(`[bettor-resolver] done: resolved=${resolved} stillPending=${stillPending} unresolvable=${unresolvable} errors=${errors}`);
    return { resolved, stillPending, unresolvable, errors, total: pendings.length };
  } finally {
    _running = false;
  }
}

export function isResolverRunning() { return _running; }

export function startResolverCron() {
  if (_timer) return;
  _timer = setInterval(() => {
    resolveExpired().catch(err => console.log(`[bettor-resolver] cron error: ${err.message}`));
  }, RESOLVER_INTERVAL_MS);
  // J1 #104 Q2 fix: boot tick 提前到 15s (在 tracker 45s + reactor 75s 之前)
  // 这样 reactor 评估时已 resolved 的 sim_position 已 close, 不会被错读为 -100% pnl
  setTimeout(() => {
    resolveExpired().catch(err => console.log(`[bettor-resolver] boot tick error: ${err.message}`));
  }, 15_000);
  console.log(`[bettor-resolver] cron registered: every ${RESOLVER_INTERVAL_MS / 3600000}h (boot tick 15s before tracker/reactor)`);
}

export function stopResolverCron() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
