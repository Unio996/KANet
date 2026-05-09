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
    const pendings = sqlite.prepare(`
      SELECT id, condition_id, decision, p_mid, yes_price, size_usd, fraction
      FROM bettor_recommendations
      WHERE status = 'pending' AND outcome IS NULL
        AND end_date IS NOT NULL AND end_date < datetime('now')
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
  // Also fire once at boot (delay 30s so Console settles)
  setTimeout(() => {
    resolveExpired().catch(err => console.log(`[bettor-resolver] boot tick error: ${err.message}`));
  }, 30_000);
  console.log(`[bettor-resolver] cron registered: every ${RESOLVER_INTERVAL_MS / 3600000}h`);
}

export function stopResolverCron() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
