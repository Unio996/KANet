# autoTaker γ data analysis — 2026-05-21

**Goal** (Owner consensus): γ path = autoTaker threshold 调优 数据驱动. NWT N19.126 push back: 必 split data (production vs stress) before raw rate decision.

**Data window**: 5/20 00:00 → 5/21 01:30 UTC (~25h).

---

## 1. Production vs Stress split

| Window | Skip | Accept | Rate |
|--------|------|--------|------|
| Stress (12 min, 5/20 11:14-11:28 UTC Phase 5-5-B Phase 1) | 6 | 3 | **33%** |
| Production (rest of 25h) | 67 | 2 | **2.9%** |

**真 production autoTaker accept rate = 2.9%** (vs raw 6.4% inflated by stress).

---

## 2. Skip reason distribution (73 total)

| Reason | Count | Pct | Status |
|--------|-------|-----|--------|
| dailyLimit 5>=5 | 15 | 21% | Daily cap hit (autoTaker did 5 already) |
| verification_manual | 14 | 19% | Offers requiring manual verify (safety, expected skip) |
| discount > -1% < 1% positive | ~14 | 19% | Marginal discount (0-1%) skipped due to threshold |
| discount negative (offer > market) | ~22 | 30% | BAD offers (correctly skipped) |
| discount > 1% | 0 | 0% | None — all 1%+ profitable would have been accepted |
| cooldown 45s | 4 | 6% | Rate limit (acceptable) |
| Other | 4 | 5% | (lock, enabled=false, expired) |

---

## 3. 关键洞察

### #1: dailyLimit 5 cap 触 15 次
autoTaker hit cap 5 times/day → 后续 15 next-tick attempt 全 skip. **要不要 bump daily_limit?**

Pros: 多 cycle per day = more revenue
Cons: production 2.9% rate × 10 = 20 cycles/day worst case — broker exposure 风险

### #2: 22 negative-discount skip = healthy
22 skip 是 offer > market (做 broker 该接 = 亏). autoTaker 正确 skip. **不动**.

### #3: ~14 positive-discount skip 0-1% threshold = lost opportunity
0.5-1% positive discount × ~6 → autoTaker 该接? threshold lower 0.5% capture more.
0-0.5% positive × ~8 → 边缘. threshold 0.3% capture more, risk slippage 大.

### #4: production accept 2.9% rate too narrow?
2/69 = 2.9%. broker hedge 闭环 (KI 22+27+40 fix) — 兜底有, **可 lower threshold**.

---

## 4. Tune proposal (with risk gradient)

| Tune | Current | Proposed | Risk |
|------|---------|----------|------|
| `autotake_min_discount_pct` | 1.0 | 0.5 | Low (broker hedge 兜底, capture 6 lost 0.5-1% range) |
| `autotake_daily_limit` | 5 | 10 | Medium (2× cycle volume, observe 1 week before 20) |
| `autotake_max_amount_usdt` | 50 | 50 | Keep (per-offer cap) |
| `autotake_cooldown_sec` | 45 | 45 | Keep (rate limit OK) |
| `autotake_enabled` | true | true | Keep |

Expected outcome:
- production accept rate 2.9% → ~8-10% (capture 0.5-1% range)
- daily cycles 5 → 10 (cap relax)
- weekly broker autoTaker volume 35 → 70 cycle (2× expansion)

---

## 5. Verification plan

1. ship tune via setConfig (no Console restart needed, hot tune)
2. 1 week observation production-only window (KANET_STRESS_MODE=undefined)
3. metric: production accept rate / hedge_placed success / circuit_breaker hit
4. if rate >> 15% OR hedge_failed surge → revert

---

## 6. NWT push back ack

NWT pushed: "γ 调优 前必 split data". J2 ack — analysis above splits stress (33% inflation) from production (real 2.9%).

NWT additional concern: 0.5% threshold change is permanent change for production. Need rollback path (config_entries setConfig revert OK, 1 min).

---

**Standby NWT N19.127 review proposal**. J2 propose ship via setConfig (zero-restart). Owner ack 后 fire.
