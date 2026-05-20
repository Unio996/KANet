# Phase 5-6 端到端压测 — 测试方案 + 实施方案

**Owner钦定 2026-05-20 09:30**: "整合 test framework + 握手实战脚本 + chrome-automation-guide + 编详细测试方案 + 实施方案 + NWT 自决资源调配 + 对抗性磋商, 拿出真本事来"

**对抗磋商 5 round** (N19.92 → N19.93 → N19.94 → KI 45 ship → reviewer audit):
- 7 friction point 初稿 (NWT N19.92)
- 3 push back 强 (J2 #574 Q3/Q5/Q7)
- 3 sub-issue 反推 (NWT N19.93 Sub-A/B/C)
- 1 correction (J2 #575 Sub-B 反 NWT (c) 推 (e))
- 1 Q-rollback (NWT N19.94)
- 3 实施 blocker (NWT N19.96 KI 45.1 fix)

---

## 1. 测试目标

**核心问**: broker 在持续 stress 下能否自维持?

| 维度 | 验证 | Pass criteria |
|---|---|---|
| K-pool sustainability | broker K balance 不跌破 floor | 1h burst 后 > 5,000 KAS |
| USDT-pool sustainability | broker BSC USDT 不 zero | > $50 |
| Hedge success rate | hedge_placed / (placed + failed) | ≥ 80% |
| Hedge circuit | hedge_skipped count | **= 0 hard gate** (circuit trip = critical) |
| Alarm trigger visibility | 红线 alarm broadcast dev-coord | every fire emit (KANET_STRESS_MODE=1 bypass throttle) |
| Cycle throughput | actual cycle/hour | ≥ 80% spawn (24/30) |
| UI render | DOM 数字 vs DB cross-check | 0 JS error per page |

## 2. 架构整合 (3 component)

```
[stress-harness 主驱动] (lib/stress-harness.mjs KI 44)
  ↓
  agent layer (autonomous_buyer × 4 + seller × 3) — personas/agent/* KI 41
    ↓ 真链 brokerBuyFlow DM (real-chain-runner.mjs)
  metric layer ── 60s sample chain_events + treasury_snapshot
  ↓
  monitor layer (chrome-automation-guide 整合)
    ── Puppeteer dedicated :9223 + own profile (Owner :9222 不动)
    ── /portfolio /relays /exchange 3 tab read-only
    ── 60s screenshot + DOM dump → DB cross-check
    ── view-only, 0 click/interact (J2 #575 Sub-B (e))
```

## 3. 资源调配 (NWT 自决)

### Pre-flight

| Resource | Status | Action |
|---|---|---|
| broker K-pool | 21,302 KAS ✓ | sufficient |
| broker BSC USDT | $448 | sufficient (10% drawdown OK) |
| Trader-A BSC USDT | $1.16 | **prefund to $5** (`_prefund_stress_pool.mjs`) |
| KANet BSC wallet | NOT EXIST | **defer** (pool 5→4) |
| NWT/Trader-M/J2 BSC USDT | $37/$22/$12 | sufficient |
| KuCoin API key | ✓ active | hedge route ($0.10 min) |
| Bybit API key | ✓ active | hedge route ($5 min, primary) |
| Owner Chrome :9222 | Owner-managed | unaffected by Puppeteer :9223 |

### Pool composition (KI 45 fix from spec 5+3)

- **buyerPool**: ['NWT', 'Trader-M', 'J2', 'Trader-A'] (4, KANet defer)
- **sellerPool**: ['NWT', 'Trader-M', 'J2'] (3)

## 4. Phase 5-6 流程

### Phase 1: KuCoin route (0-25 min)

- `hedge_router_enabled='true'`, `small_order_cex='kucoin'`, `small_order_threshold_usd='5'`
- qty 10-30 KAS = $0.34-$1.02 → route KuCoin ($0.10 min)
- Verify Phase 5-2.5 router 实证

### Drain 1: 25-30 min

- No new spawns
- Wait active actors complete (5 min)
- Force-cleanup lock files (scoped to buyer/seller pool, KI 31 守 for other tests)

### Phase 2: Bybit route (30-55 min)

- `hedge_router_enabled='false'` → default Bybit
- qty 10-30 KAS = $0.34-$1.02 < Bybit $5 min → **expected hedge_failed**
- 这 phase 验 production primary path behavior + Bybit failover chain (KI 40)

**校准** (KI 45.1 issue #4 ack): Phase 2 因 qty < Bybit min, hedge_placed Δ = 0 expected. Q7 80% threshold 用于 phase 1 only. Phase 2 测 production graceful degradation (Bybit reject → emit hedge_failed but no crash).

### Drain 2: 55-60 min

- Final drain + cleanup

## 5. 实施步骤 (Owner real-run)

1. **Pre-flight** (~5 min):
   ```bash
   cd C:/kanet/kasia-console
   node scripts/_prefund_stress_pool.mjs    # broker→Trader-A $4 USDT
   npm install puppeteer                     # if not installed
   ```

2. **Fire Puppeteer monitor** (background, separate terminal):
   ```bash
   node scripts/_stress_puppeteer_monitor.mjs --duration=3600000
   ```

3. **Fire stress test** (main):
   ```bash
   node scripts/test.mjs --case=test-framework/cases/multi-agent/stress_5_5_A_1h_burst.test.mjs
   ```

4. **Monitor**: dev-coord channel red-line alarms 实时 visible (KANET_STRESS_MODE=1 throttle bypass)

5. **Post-run** (~15 min): review aggregate metrics from test stdout + Puppeteer report JSON.

6. **Rollback (if crash)**:
   ```bash
   node scripts/_stress_rollback.mjs    # latest run state
   ```

## 6. KI 45 ship inventory

| Sub | Commit | File | LOC |
|---|---|---|---|
| 1 | 4329c7c6 | scripts/_prefund_stress_pool.mjs | ~75 |
| 2 | 1c39a4ac + KI 45.1 e075bf0f | stress_5_5_A_1h_burst.test.mjs | +90 |
| 3 | 2e689d86 | broker-treasury-monitor.js + test setup | +10 |
| 4 | e075bf0f | scripts/_stress_puppeteer_monitor.mjs | ~140 |
| 5 | 1209d4d8 | scripts/_stress_rollback.mjs + state backup | ~120 |
| 6 | (this) | docs/phase5-6-test-plan-2026-05-20.md | ~200 docs |

总: **~635 LOC code + 200 docs across 6 sub commits**.

## 7. 7 friction 解决 matrix

| Q | NWT propose | J2 push back | 终 verdict |
|---|---|---|---|
| Q1 Puppeteer scope | (a) UI monitor | (a') 严格 0 click | accept (a') |
| Q2 BSC USDT pool | (a) fund $5 each | (a') script + audit source tag | accept (a') |
| Q3 KuCoin vs Bybit | (a) sequential | **(c) 30min KuCoin + 30min Bybit** | NWT accept J2 (c) |
| Q4 DM vs HTTP | (a) DM real | ack | accept (a) |
| Q5 Owner Chrome | 隔离 | **(b') dedicated profile :9223** | NWT accept J2 (b') |
| Q6 Cleanup | soft | (a') explicit marker | accept (a') |
| Q7 Threshold | (a) 80% | **(a+) 80% + alarm-per-fail + hedge_skipped=0 hard** | NWT accept J2 (a+) |
| Sub-A switch protocol | drain pause | accept + 5 min drain cap | ack |
| Sub-B Console auth | (c) skip UI | **(e) fresh profile view-only** | NWT 撤 (c) accept J2 (e) |
| Sub-C alarm bypass | env var KANET_STRESS_MODE | ack | accept |
| Q-rollback | new script | atomic state write 加紧 | accept |

J2 push back **3 correct overrides** (Q3 hybrid / Q5 dedicated / Sub-B view-only).
NWT push back **4 finer reviews** (N19.85/86/89/96, 11 issues found).
Owner expects "拿出真本事" — delivered via对抗 5 round refinement.

## 8. Owner real-run gate

Code-ready. Real-run pending Owner pick:
- (A) 立 fire 1h burst — NWT QA monitor + me standby for emergency
- (B) Defer 排日 — Phase 5-5-B 6h 或 Phase 5-5-C 24h chaos 一并
- (C) Phase 5 全总 close sediment 沉淀 + 排其他工作

---

**今日 (2026-05-20) 总输出**:
- 9 hr 工作
- KI 27-44.2 + 45.0-45.1 = 17 numbered KI
- ~1820 + ~635 = ~2455 LOC ship
- 3 大 sediment: 主动通信 + 真 monitor + mutation test mindset
- 2 critical production bug fixed: KI 27 Bybit precision (30+ 天 silent dead) + KI 40 getConfig 漏 import (24 min silent crash)
