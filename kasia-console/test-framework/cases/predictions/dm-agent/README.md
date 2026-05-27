# DM Agent Test Cases — 7 维度 ship-block gate

Owner 钦定 J1 #59c push back accept (Bettor r100 R2 → r103 chase).
**36 个独立 case 文件 + audit endpoint + soak runner**.

## Dimensions

| 维 | 文件 prefix | 个数 | 说明 |
|----|-------------|------|------|
| 1 | `dim1_navigation_*` | 5 | DM menu navigation 完整 e2e (single user lifecycle) |
| 2 | `dim2_concurrency_*` | 5 | 多用户并发 + sender_address isolation + cross-talk 防漏 |
| 3 | `dim3_state_edge_*` | 5 | State machine edge case (cancel mid-flow / TTL / double confirm) |
| 4 | `dim4_invalid_input_*` | 5 | 菜单 invalid input (SQL inj / null byte / unicode / huge int / fuzz) |
| 5 | `dim5_fail_recovery_*` | 5 | 真链 fail recovery (stake reject / RPC down / Console restart) |
| 6 | `dim6_race_*` | 6 | J1 #59c add — 真链 race (UTXO / reorg / Scout outage / version migrate / NULL race / corrupt) |
| 7 | `dim7_audit_*` | 5 | J1 #59c add — audit trail completeness (chain_events × balance × spot-check) |

**Total: 36 cases.**

## Case anatomy

每个 case 都标了 `pending_dep` (= 依赖) 元数据:

- **没 `pending_dep`** → 可现在跑 (schema/audit endpoint/DB only)
- **`pending_dep: 'ui_baea285_handler'`** → 等 UI prediction-agent-mind.mjs 推到 origin OR LAN bundle 拉到 D:/Anthropic
- **`pending_dep: 'nwt_27aa21a_dispatcher'`** → 等 NWT conversations.js dispatcher 推到 origin
- **`pending_dep: 'ui_emit_dm_action'`** → 等 UI handler 调用 `emitDmMenuAction()` (audit-prediction.js 已提供)
- **`pending_dep: 'real_chain_market_create'`** → 等 testnet KAS fund + 真 market 真链 publish

## 跑

```bash
# 仅 dm-agent 域:
node scripts/test.mjs --domain=dm-agent

# 单独 case:
node scripts/test.mjs --case=test-framework/cases/predictions/dm-agent/dim1_navigation_01_help.test.mjs

# Schema + audit shape only (= 无 pending_dep 的子集):
node scripts/test.mjs --tag=dm_agent_now
```

## Audit endpoint

- `GET /api/audit/prediction-trace/:user_pk` — 单用户 markets × sides × DM actions × settle events × balance diff
- `GET /api/audit/prediction-trace-summary` — last_7_days_dm + market_counts_by_status + sides + dm_sessions

实现在 `kasia-console/src/api/audit-prediction.js` (= 已 wire src/index.js).

`emitDmMenuAction()` helper 提供给 UI prediction-agent-mind.mjs 在每 state transition 调 (= dim 7.1 sediment).

## 24h Soak Runner

`soak_runner.mjs` — 启动 5 user × 24h cycle, Console restart 5×, Scout restart 4×, audit checkpoint 每 60min.
等 UI sub-2b handler ship 后, 替换 TODO real DM sequence 即跑.

## J1tn audit refactor 真相 sediment

前 J1 沙箱 (NOT git-tracked) 在 /d/kanet-testnet 写了 audit-prediction.js + 7 dim skeleton, 触雷 `feedback-grep-code-not-infer`:
- 查 exchange_offers 上 **不存在** 的 maker_address/taker_address/kas_amount/offer_type/settle_kaspa_tx_id 列
- 引用 **不存在** event_types: dm_menu_action / pool_refund_timeout / pool_bond_slashed / pool_bond_returned (仅 pool_settle_consensual_dispatched 真存在)
- emitDmMenuAction() helper 但 0 producer 调用

J1tn R1 refactor against 真 schema (= pool_markets v62 + pool_bettor_sides + chain_events v28 + dm_menu_action emit hook). 见 dim7_audit_01_schema_lock.test.mjs 守住.
