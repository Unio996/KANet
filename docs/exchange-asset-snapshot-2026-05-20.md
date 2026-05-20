# KANet Exchange Asset Snapshot — 2026-05-20

**Generated**: 2026-05-20T05:21:54.262Z
**Scope**: 7 agent × 10 chain × 5 CEX + hedge lifetime + 24h flow + 7-day trend + capability matrix
**Phase**: 5-1 (NWT N19.66 spec, J2 ship)
**Status**: first cut — NWT review pending


## Sec 1 — Agent × Chain 资产快照

| Agent | KAS | BSC USDT | ETH USDT | Polygon | Arbitrum | Base | Optimism | Avalanche | SOL | TRON |
|-------|-----|----------|----------|---------|----------|------|----------|-----------|-----|------|
| Bettor | 1.788 | — | — | 0 | — | — | — | — | — | — |
| J2 | 26.682 | 12.884 | — | 0.100 | 0 | — | — | — | — | — |
| KANet | 4.419 | — | — | — | — | — | — | — | — | — |
| NWT | 286.234 | 37.760 | — | — | — | — | — | — | — | — |
| Opus | — | — | — | — | — | — | — | — | — | — |
| Qclaude | 0.843 | — | — | — | — | — | — | — | — | — |
| Trader-A | 7.472 | 1.165 | 0 | 1.899 | 1.949 | 0 | 0.949 | 0 | 0 | 0 |
| Trader-B | 21301.811 | 448.828 | 0 | 14.093 | 14.043 | 0 | 14.043 | 0 | 0 | 0 |
| Trader-M | 263.332 | 22.567 | 0 | 0 | — | — | — | — | 0 | 0 |

## Sec 2 — 5 CEX 账户清单

| Exchange | Label | Default | Auto-trade | Auto-withdraw | KAS/USDT min order |
|---|---|---|---|---|---|
| bitget | Bitget Main |  | ✓ | ✗ 手动 | TBD |
| bybit | Bybit Main | ✓ | ✓ | ✗ 手动 (Owner) | 5 USDT |
| gateio | Gate Main |  | ✓ | ✓ API | TBD |
| kucoin | KuCoin Main |  | ✓ | ✗ 手动 | TBD |
| mexc | MEXC Main |  | ✓ | ✗ 手动 | TBD |

## Sec 3 — 24h chain_events 流量

| event_type | count |
|---|---|
| comm | 13813 |
| kanet_cross_match_tick_v1 | 2312 |
| text | 1930 |
| tx | 916 |
| treasury_alert | 530 |
| autotake_skip | 90 |
| broker_kas_refunded | 20 |
| handshake | 10 |
| broker_chunk_filled | 9 |
| exchange_completed | 9 |
| exchange_delivering | 9 |
| exchange_kas_sent | 9 |
| exchange_matched | 9 |
| exchange_paid | 7 |
| hedge_failed | 6 |
| comm_sent | 5 |
| self_stash | 5 |
| legacy | 4 |
| exchange_cancelled | 1 |
| hedge_placed | 1 |
| hedge_skipped | 1 |

### Exchange offers 24h by status

| status | count |
|---|---|
| cancelled | 4 |
| completed | 9 |
| expired | 124 |
| open | 1 |

### hedge lifetime (all time)

| event | lifetime |
|---|---|
| hedge_failed | 6 |
| hedge_placed | 1 |
| hedge_skipped | 1 |

## Sec 4 — Broker pool 7-day trend (chain_events tx flow approx)

(chain_events tx 7-day 无数据 broker addr)

*Note*: address_balances table 是 current-state only (no `snapshot_at` col). 真 trend 需新 cron 写 time-series.

## Sec 5 — Per-CEX Capability Matrix

见 Sec 2. Phase 5-2.5 router 按 capability 分路: 重度压测/自动 e2e → Gate.io, 其他 → Bybit + Owner 周期手动 rebalance.

## Sec 6 — Broker 日 cycle capacity

**假设**: 每 cycle = 200 KAS × $0.034 = $6.74 USDT

| 维度 | 余 | cycle / day max |
|---|---|---|
| KAS-bound (broker) | 21302 KAS | 106 |
| USDT-bound (BSC) | TBD | TBD |
| Bybit risk limit | TBD | TBD |

**实测今天**: cycle rate sub-1/day (28 KAS/day drain → 750 day runway 实际值). 重度压测目标 10k cycle → 当前 K-pool 撞死.

## Sec 7 — Alarm Threshold Propose (NWT review)

| Metric | Threshold | Action |
|---|---|---|
| broker K-pool < 5,000 KAS | 红线 | broadcast Owner notify + auto-throttle cycle |
| broker BSC USDT < $50 | 黄线 | broadcast warn |
| Bybit KAS balance > 1,000 KAS (积压) | 黄线 | Owner withdraw |
| hedge_failed > 5 in 1h | 红线 | circuit breaker (已 ship Phase 1a) |
| any non-broker relay KAS < 1 | info | log only |