# Phase 5-3 Config Knob Audit — 2026-05-20

**Generated**: 2026-05-20 (J2 ship, NWT N19.66 Phase 5-3 spec)
**Scope**: exchange / broker / hedge / autotaker / seeker domains
**Convention** (NWT N19.65 Q4 agree): tunable → config_entries DB (UI 调 + 不重启), invariant → code constant (commit history = audit)

---

## Sec 1 — DB knobs (10) — KEEP as-is

| Key | Default | Location | 评 |
|-----|---------|----------|----|
| `autotake_enabled` | (off) | trade-protocol-filter.js:239 | gate flag |
| `autotake_min_discount_pct` | 0.5 | trade-protocol-filter.js:301 | core tuning |
| `autotake_max_amount_usdt` | 50 | trade-protocol-filter.js:308 | size cap |
| `autotake_daily_limit` | 3 | trade-protocol-filter.js:316 | rate cap |
| `autotake_cooldown_sec` | 30 | trade-protocol-filter.js:320 | rate cap |
| `autotake_mode` | approval | trade-protocol-filter.js:440 | mode select |
| `broker_inventory_auto_replenish` | — | broker-inventory-watcher.js:32 | gate flag |
| `broker_usdc_min_reserve` | DEFAULT | broker-inventory-watcher.js:33 | core tuning |
| `broker_usdc_replenish_amount` | DEFAULT | broker-inventory-watcher.js:34 | core tuning |
| `seeder_price_deviation_pct` | 5 | market-seeder.js:338 | core tuning |

✓ Already runtime-tunable. UI access via /settings page (config_entries CRUD).

---

## Sec 2 — Code constants — Decision Matrix

### KEEP code (invariant — safety, system rate)

| Constant | Value | File:Line | Reason |
|----------|-------|-----------|--------|
| `HEDGE_CIRCUIT_WINDOW_MS` | 1h | trade-protocol-filter.js:632 | safety invariant — circuit window not for tuning |
| `HEDGE_CIRCUIT_THRESHOLD` | 3 | trade-protocol-filter.js:633 | safety invariant — Phase 1a defense layer 4 |
| `TICK_INTERVAL_MS` (market-seeder) | 5min | market-seeder.js:14 | system rate — restart OK if change |
| `TICK_INTERVAL_MS` (broker-treasury) | 5min | broker-treasury-monitor.js:18 | system rate |
| `TICK_OFFSET_MS` (broker-treasury) | 2.5min | broker-treasury-monitor.js:19 | stagger offset, paired w/ TICK_INTERVAL |
| `TICK_MS` (cross-match) | 30s | cross-match-engine.js:16 | system rate |

### MIGRATE → DB (tunable — Owner 5 min 调参)

| Constant | Current | File:Line | Propose DB key |
|----------|---------|-----------|----------------|
| `FLOOR_USD` (broker-treasury) | 50 | broker-treasury-monitor.js:36 | `broker_treasury_floor_usd` |
| `HIGH_THRESHOLD_USD` (broker-treasury) | 500 | broker-treasury-monitor.js:37 | `broker_treasury_high_usd` |
| `PRICE_TOLERANCE` (cross-match) | 0.03 (±3%) | cross-match-engine.js:17 | `cross_match_price_tol` |
| `QTY_TOLERANCE` (cross-match) | 0.05 (±5%) | cross-match-engine.js:18 | `cross_match_qty_tol` |

Reason: 这 4 个是 Owner Phase 5-2 alarm + Phase 5-2.5 router 调优主轴 (NWT N19.65 Q4 specifically named).

---

## Sec 3 — Migration Plan (1 LOC × 4 + DB seed)

### Per-knob migration template

```javascript
// before
const FLOOR_USD = 50;
// after
const FLOOR_USD = parseFloat(await getConfig('broker_treasury_floor_usd') || '50');
```

### Seed default values (db migration)

```sql
INSERT OR IGNORE INTO config_entries (key, value) VALUES
  ('broker_treasury_floor_usd', '50'),
  ('broker_treasury_high_usd', '500'),
  ('cross_match_price_tol', '0.03'),
  ('cross_match_qty_tol', '0.05');
```

### Risk

- `FLOOR_USD` / `HIGH_THRESHOLD_USD` 是 broker-treasury-monitor 5min tick 读, 每 tick 重读 OK no cache.
- `PRICE_TOLERANCE` / `QTY_TOLERANCE` 是 cross-match-engine 30s tick 读, 同样每 tick 重读 OK.
- 无 hot-path performance concern (5min/30s 周期, 不是每请求).

### Estimate

4 × 1-LOC code edit + 1 SQL migration + UI binding (optional, defer to 5-3 polish).
**~30 min ship**.

---

## Sec 4 — Phase 5-2.5 Router Tuning Knobs (新建, NWT spec 起步)

Phase 5-2.5 router 按 CEX capability + 当前 broker pool route hedge. 需要 knobs:

| 新 key | 用途 | 建议 default |
|--------|------|--------------|
| `hedge_router_default_cex` | 默认 hedge CEX | `bybit` |
| `hedge_router_auto_e2e_cex` | 自动 e2e 测试 route | `gateio` |
| `hedge_router_small_order_cex` | 小单 ($0.10-$5) route | `kucoin` |
| `hedge_router_kas_floor_for_default` | 何时 default→failover | `5000` KAS |
| `hedge_router_enabled` | gate flag (off → 全 default) | `false` |

5 新 knob in DB. NWT 5-2.5 spec 写完后 J2 ship migration.

---

## Sec 5 — Audit Script (defer)

`scripts/audit-config-location.mjs` (NWT N19.65 propose) — automated grep+report 而不是手工 sweep. 当前 manual sweep 完成 + doc, 自动化版可 defer 到 Phase 5-3 polish (节省 time-to-ship 30 min).

---

## ack — J2 Ready to Ship

| Step | Content | Estimate |
|------|---------|----------|
| 1 | 4 LOC migrate (FLOOR_USD / HIGH_THRESHOLD_USD / PRICE_TOLERANCE / QTY_TOLERANCE) → config_entries | 15 min |
| 2 | SQL seed migration (v62 propose) | 5 min |
| 3 | Verify console restart + tick reads new config_entries values | 10 min |
| 4 | Commit + broadcast J2 #555 | 5 min |

Standby NWT N19.67 fix #1-#4 ack + Phase 5-3 migration ack.

— J2 5/20 12:35 +07 (UTC 05:35) — Phase 5-3 audit complete, ship pending NWT ack
