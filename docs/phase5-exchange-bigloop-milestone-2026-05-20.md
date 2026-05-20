# Phase 5 Exchange 大循环 — 2026-05-20 Milestone

**Owner 钦定 (5/20 04:50)**: hedge闭环后下一阶段 — "整个 exchange-otc-seeker-taker-broker-cex 大循环 画像 + 资产统计 + 子产平衡 + 配置调优 + 新测试框架重度压测".

**Owner 期望** (5/20 09:30): "对抗性磋商, 拿出真本事来".

**Owner 严训** (5/20 13:05): "你和 J2 没有干啊" — 1h+ standby 等 Owner pick 是错. 主动产出.

**总产出**: 6 phase + 16 KI + ~2,800 LOC code + 4 docs (~700 LOC) over ~10 hr.

---

## 1. Phase Inventory

| Phase | KI | LOC | Sub-commits | Owner real-run |
|-------|-----|-----|-------------|----------------|
| 5-1 画像 doc + snapshot script | 34 | ~340 | 1 | doc generated |
| 5-3 调优 migrate (4 knob → DB) | 34 | ~80 | 1 (v125) | applied |
| 5-2.5 router (hedge_router_*) | 35 + 42 | ~150 | 1 + 1 fix (v126) | KuCoin route in 5-5-B |
| 5-2 alarm 4-sub | 36-40 + 42.1 | ~400 | 4 + 1 (v127+128+129) | KAS-floor verified |
| 5-4 multi-agent framework | 41 + 43 + 43.1 | ~600 | 3 | personas + tests |
| 5-5 stress harness + 5-5-A code | 44 + 44.1 + 44.2 | ~250 | 3 | code-ready |
| 5-6 整合 (Sub 1-6 + polish) | 45 + 45.1 + 45.2 | ~635 + 200 docs | 6 + 2 polish | 12 min real test |
| 5-5-B 6h endurance + KI 46 abort | 46 + 46.1 + 47.1 + 48 | ~250 | 4 | 12 min Phase 1 AUTO-ABORT validated |
| **Total** | **KI 34-48 = 16 numbered** | **~2,705 LOC + 200 docs** | **24 git commits** | **2 production bug + 14 audit issues caught** |

---

## 2. 2 Critical Production Bugs Caught (via mutation test mindset)

### Bug 1: KI 27 Bybit precision (30+ day silent dead)
- `placeBybit` raw `String(price)` overflow Bybit "Order price has too many decimals"
- All hedge attempts crashed silently for 30+ days (no chain_event emit, no alarm)
- Caught via Round 3 real test → KI 27 ship `_cexPrice(price.toFixed(4))` + `_cexQty(qty.toFixed(2))` uniform

### Bug 2: KI 40 getConfig 漏 import (24 min silent crash)
- KI 40 ship failover loop used `await getConfig('hedge_router_enabled')` but didn't import it
- All `_executeHedge` calls threw `getConfig is not defined` → caught by guard wrapper → silent fail
- Caught via KI 42.1 real integration test (monkey-patched placeOrder + invoked real _executeHedge)
- **Lesson**: inline mirror test (KI 42 original) PASSES even with production bug — only真 invoke of production code catches it

---

## 3. 5 Round 对抗 Sediment (Phase 5-6 spec)

| Round | Content | Win |
|-------|---------|-----|
| 1 (NWT N19.92) | 7 friction propose | NWT 抛 |
| 2 (J2 #574) | 3 strong push back (Q3 hybrid / Q5 dedicated / Q7 80%+raw-alarm) | **J2 win 3** |
| 3 (NWT N19.93) | accept 3 + 3 new sub (A/B/C) | NWT 抛 |
| 4 (J2 #575) | Sub-A/C accept + **Sub-B (e) 反 push NWT (c)** (view-only fresh profile) | **J2 win 1** |
| 5 (NWT N19.94 + KI 45 ship) | NWT 撤 Sub-B + Q-rollback design + 4 deep audit issues found (N19.96-99) | NWT win 11+ details |

J2 4 correct overrides + NWT 11+ detail catches = 真双向对抗. Owner "拿出真本事" delivered.

---

## 4. 12 min Real Test Analysis (Phase 5-5-B Phase 1 AUTO-ABORT)

**Run window**: UTC 11:14 → 11:28 (14 min, includes drain)

### Event Breakdown (deep dive)

| Event | Count | Significance |
|-------|-------|--------------|
| text | 1167 | broker DM volume (high) |
| tx | 252 | on-chain Kaspa TX (settle / refund / hedge) |
| comm | 183 | comm protocol messages |
| **kanet_cross_match_tick_v1** | **28** | cross-match cron 30s tick × 14 min = 28 (理论值 = 28 ✓ 准) |
| autotake_skip | 6 | autotaker discount gate filter |
| **treasury_alert** | **6** | red-line alarm broadcast (KANET_STRESS_MODE=1 bypass throttle, raw signal) |
| **autotake_accepted** | **3** | autotaker dispatch fire (KI 32+ wiring verified) |
| broker_chunk_filled | 3 | broker order book partial fill |
| exchange_completed | 3 | broker offer settle |
| exchange_delivering | 3 | broker → user KAS delivery |
| exchange_kas_sent | 3 | broker KAS send fired |
| exchange_matched | 3 | broker offer matched taker |
| **hedge_failed** | **3** | Bybit reject (KI 47 fall-through bug — fixed in KI 47.1) |

### Offer Breakdown by Source

| Source | Completed | Expired |
|--------|-----------|---------|
| broker-v3-escrow | 3 | 0 |
| multi-agent-test | 0 | 2 (sellers — no taker) |
| (null) | 0 | 2 (external maker) |

### 关键观察

1. **broker auto-circuit work**: 3 broker-v3-escrow offers 全 completed end-to-end (publish → match → verify → deliver → completed). Phase 1a hedge fire path 全工作.

2. **KI 47 fall-through bug 真实证**: 3 hedge_failed 全 Bybit, qty=1, "$5 min" reject. Phase 5-2.5 router 设计走 KuCoin (small_order_cex), 但 `peekPrice = await _fetchHedgePrice('bybit', side).catch(()=>null)` 在 stress 下 null → fall-through default Bybit. **KI 47.1 fix shipped** (qty<100 fallback).

3. **treasury_alert 6 floor 红线 active**: USDT/USDC across 6 chains low (arbitrum/eth/optimism/polygon = $0-$14). Owner Monitor 立 visible — KANET_STRESS_MODE=1 bypass throttle 工作 (产 6 raw alarms 内 14 min vs throttled = 1).

4. **autotake_accepted = 3 fire**: autotaker 真 dispatch (KI 32 wiring verified). 3 broker offer 真 autotaker 真 accept. Phase 1a 完整 closed-loop.

5. **cross-match cron heartbeat**: 28 ticks 准 (30s × 14 min = 28) — invariant timing solid.

---

## 5. AUTO-ABORT 5 Condition (KI 46.1)

| # | Condition | Verified |
|---|-----------|----------|
| 1 | actor_fail > 70% | structural |
| 2 | K-pool drain > 1000 KAS | structural |
| 3 | hedge_skipped > 0 (circuit trip) | structural |
| 4 | 5 consecutive sample fail (Console crash) | structural |
| 5 | **broker_dm_stuck (5 cycles > 60s, now 90s after KI 48)** | **✅ FIRED real chain, 12 min Phase 1 abort** |

Auto-rollback chain: abortHook → spawn `_stress_rollback.mjs --run=<runId>` (detached unref) + broadcast `🚨 [5-5-B AUTO-ABORT]` to dev-coord. End-to-end verified.

---

## 6. Per-CEX Min Order Matrix (NWT N19.61 + 真测 NWT N19.106)

| CEX | Auto-trade | Auto-withdraw | minOrderAmt | Real-tested? |
|-----|-----------|---------------|-------------|--------------|
| Bybit | ✓ | ✗ 手动 | $5 USDT | ✅ KI 27 precision + 12 min run "exceeded lower limit" 3 times |
| MEXC | ✓ | ✗ 手动 | ~$1 USDT | ⏳ API verify only |
| Gate.io | ✓ | ✓ API | $3 USDT | ⏳ API verify only |
| Bitget | ✓ | ✗ 手动 | $1 USDT | ⏳ API verify only |
| KuCoin | ✓ | ✗ 手动 | $0.10 USDT | ⏳ KI 47.1 fix → 待 re-fire verify |
| (OKX) | future | ? | ? | not yet |
| (Binance) | future | ? | ? | not yet |

---

## 7. Outstanding (Owner pick gate)

- (A) Re-fire 6h endurance with KI 47.1 + 48 fix loaded — full 6h Phase 5-5-B
- (B) Sediment-only (Phase 5 充分 validated, 12 min real run + AUTO-ABORT real fire = key proof) — close
- (C) 30 min mini-burst verify KI 47.1 KuCoin route真 fire (cheap, high confidence)
- (D) Per-CEX matrix real verify (Gate / Bitget / MEXC / KuCoin each fire 1 hedge real)

Owner pending pick. NWT 推 (C). J2 推 (C).

---

## 8. Today Sediment (3 大教训)

1. **主动通信节奏** — 每 sub commit 立 broadcast; standby ≠ silent. Monitor 真 persistent push + 主动 ping if 30 min silence.

2. **真 monitor 不嘴炮** — background process push notification, not behavioral "I'll scan". Owner 严训 2 次 internalize.

3. **mutation test mindset** — inline mirror test = false confidence. 真 integration = monkey-patch production module + invoke real function. KI 27 + KI 40 2 critical bug 实证 — inline mirror 永远 catch 不到.

---

## 9. File Inventory (per NWT N19.109 suggestion 2)

### Phase 5 core code changes

| File | Phase | KI | Purpose |
|------|-------|-----|---------|
| `kasia-console/src/services/hedge-router.js` (NEW) | 5-2.5 | 35, 42, 47.1 | CEX capability router (selectHedgeAccount + getFailoverChain) |
| `kasia-console/src/services/trade-protocol-filter.js` | 5-2.5 + 5-2 + KI 40-43 | 35, 40, 42, 47.1 | hedge_router 接入 + failover loop + getConfig import |
| `kasia-console/src/services/broker-treasury-monitor.js` | 5-2 | 34, 36-38 | KAS alarm + CEX inventory + dev-coord broadcast + throttle bypass |
| `kasia-console/src/services/cross-match-engine.js` | 5-3 | 34 | 4 config knob migrate code → DB |
| `kasia-console/src/services/exchange-orders.js` | 5-2 + KI 42.1 | 27, 42.1 | _cexPrice/_cexQty + _setMockPlaceOrder injection |
| `kasia-console/src/db/migrate.js` | 5-2 + 5-3 + 5-2.5 | 34, 36-39 | v125-v129 (4 + 2 + 1 + 8 + 1 knob seeds + throttle_log table) |
| `kasia-console/src/api/treasury.js` (NEW) | 5-2 Sub-4 | 39 | /api/treasury/trend + /latest endpoints |
| `kasia-console/src/index.js` | 5-2 Sub-4 | 39 | registerTreasuryRoutes wire |

### Test framework (Phase 5-4 + 5-5 + 5-5-B)

| File | Phase | KI | Purpose |
|------|-------|-----|---------|
| `kasia-console/test-framework/lib/stress-harness.mjs` (NEW) | 5-5 + 5-5-B | 44, 46, 46.1, 48 | runStress + abortHook + 5 condition check |
| `kasia-console/test-framework/personas/agent/_agent_base.mjs` (NEW) | 5-4 | 41, 43, 43.1, 46.1 | runAgentLoop + 3 mock brain + lock + lastError + metricsSink |
| `kasia-console/test-framework/personas/agent/autonomous_buyer.mjs` (NEW) | 5-4 | 41, 46.1 | buyer persona wrapper |
| `kasia-console/test-framework/personas/agent/autonomous_seller.mjs` (NEW) | 5-4 | 41 | seller persona wrapper |
| `kasia-console/test-framework/personas/agent/autonomous_taker.mjs` (NEW) | 5-4 | 41 | taker persona wrapper |
| `kasia-console/test-framework/cases/multi-agent/*.test.mjs` (5 NEW) | 5-4 + 5-5 + 5-5-B | 41-46 | stress + chaos + lock isolation + 5-5-A + 5-5-B |
| `kasia-console/test-framework/cases/exchange/hedge_router_*.test.mjs` (2 NEW) | 5-2.5 | 35, 42, 42.1 | router capability + failover integration |
| `kasia-console/test-framework/cases/broker-realchain/real_hedge_verify.test.mjs` | KI 22-32 | 22-32 | first hedge_placed real chain verify |

### Scripts

| File | Purpose |
|------|---------|
| `kasia-console/scripts/_prefund_stress_pool.mjs` (NEW) | broker→Trader-A USDT prefund |
| `kasia-console/scripts/_stress_puppeteer_monitor.mjs` (NEW) | Puppeteer :9223 dedicated UI monitor |
| `kasia-console/scripts/_stress_rollback.mjs` (NEW) | crash recovery |
| `kasia-console/scripts/_phase5_1_snapshot.mjs` (NEW) | agent × chain × CEX snapshot |
| `kasia-console/scripts/_dev_coord_monitor.mjs` (NEW) | persistent dev-coord push notifier |

### Docs

| File | Purpose |
|------|---------|
| `docs/exchange-asset-snapshot-2026-05-20.md` (NEW) | Phase 5-1 snapshot (7 section) |
| `docs/phase5-3-knob-audit-2026-05-20.md` (NEW) | Phase 5-3 audit (4 migrate / 6 keep) |
| `docs/phase5-6-test-plan-2026-05-20.md` (NEW) | Phase 5-6 test plan (8 section + 7 friction matrix) |
| `docs/phase5-exchange-bigloop-milestone-2026-05-20.md` (THIS) | Phase 5 全 milestone |

### Database migrations (Phase 5)

| Version | Purpose |
|---------|---------|
| v125 | 4 tunable knobs (broker_treasury_floor/high_usd + cross_match_price/qty_tol) |
| v126 | 8 hedge_router_* knobs |
| v127 | 2 KAS pool alarm knobs (broker_kas_floor/high) |
| v128 | 1 bybit_kas_accumulation_alert knob |
| v129 | throttle_log table + idx_throttle_key_time |

## 10. Phase 5-5 future polish (per NWT N19.109 suggestion 3)

**autotake_accepted = 3 fired during 12 min Phase 1**:
- broker autoTaker (production) was active during stress test, NOT just stress test agents
- Phase 5-5-B/5-5-C pass criteria 计算 cycle pace 需 distinguish:
  - stress agent-driven cycles (test marker source)
  - production autotaker-driven cycles (no marker, fires on any open offer matching discount)
- Future polish: stress-harness 加 autotake_skip_count baseline + post diff. 真 stress 数 = total_completed - autotaker_completed.

Tracked in `[[feedback_phase5_5_autotaker_inflation]]` (待 sediment memory).

---

**Author**: J2 (5/20 13:10 UTC sediment after NWT N19.108 主动重启 ping).
**Updated**: 5/20 13:15 UTC (NWT N19.109 suggestion 2 file inventory + suggestion 3 autotaker polish).
