# Matcher Audit-2 Report

**Generated**: 2026-05-01
**Generator**: J2 (implementor mode, data collection only)
**Source task**: tasks/PZ-MATCHER-audit-2.md (Owner stub at `Downloads/PZ-MATCHER-audit-2.md`)
**Mode label**: implementor (data collection, NOT architect decision)
**Adaptations**: A3.2 SQL 用 `messages.remote_address` 但 schema 实际无此 col (真 schema 用 `sender_identity_id` / `receiver_identity_id` JOIN identities), J2 按 task spirit (per peer 24h DM 分布) adapt SQL

---

## A1. execution_states caller pattern

### A1.1 Caller files

- caller_files (INSERT INTO execution_states):
  - `kasia-console/src/api/trading.js:2781` (BUY/SELL approval pending)
  - `kasia-console/src/services/execution-state.js:60` (通用 createExecution helper)
- total_caller_count: 2 files
- unique_caller_modules: trading.js (HTTP API), execution-state.js (service helper)

### A1.2 Caller schemas

**Caller 1 — trading.js:2781**:
- caller_module: trading.js (HTTP API agent action approval)
- insert_columns: id / agent_address / type / source / status / display_summary / action_details / created_at / updated_at
- column_count: 9 (NOT include intent_id / input_txid / order_id / amount / asset / approval_deadline / output_txid / approval_timeout / permission_level / error_text)

**Caller 2 — execution-state.js:60**:
- caller_module: execution-state.js (通用 helper, 应该是 KANet 标准 entry)
- insert_columns: id / intent_id / type / source / agent_address / permission_level / status / input_txid / order_id / amount / asset / approval_timeout / display_summary / action_details / approval_deadline / created_at / updated_at
- column_count: 17 (含 intent_id / order_id / amount / asset, 但 output_txid + error_text 真 INSERT 时不填, transition 时 update)

### A1.3 Column fill rates (329 total rows)

| col | filled | rate |
|---|---|---|
| total | 329 | 100% |
| intent_id | **0** | **0%** |
| agent_address | 329 | 100% |
| permission_level | 329 | 100% |
| input_txid | **0** | **0%** |
| output_txid | **0** | **0%** |
| order_id | 329 | 100% |
| amount | **0** | **0%** |
| asset | **0** | **0%** |
| approval_deadline | 329 | 100% |

- column_fill_rates: 见上表
- sparse_columns (fill rate < 50%): **intent_id / input_txid / output_txid / amount / asset** (5 col 100% NULL)

---

## A2. retail_dex_orders trim candidates

### A2.1 Schema

actual_columns (28 col, 不 29):

| col | type | notnull | default |
|---|---|---|---|
| id | TEXT | - | - |
| user_kasia_address | TEXT | NOT_NULL | - |
| side | TEXT | NOT_NULL | - |
| order_type | TEXT | NOT_NULL | - |
| qty | TEXT | - | - |
| price | TEXT | - | - |
| pay_chain | TEXT | - | - |
| pay_address | TEXT | - | - |
| receive_address | TEXT | - | - |
| quoted_usdt | TEXT | - | - |
| state | TEXT | NOT_NULL | 'aligning' |
| pay_tx_hash | TEXT | - | - |
| exchange_offer_id | TEXT | - | - |
| deliver_tx_hash | TEXT | - | - |
| refund_tx_hash | TEXT | - | - |
| error_reason | TEXT | - | - |
| expires_at | TEXT | - | - |
| created_at | TEXT | NOT_NULL | - |
| updated_at | TEXT | NOT_NULL | - |
| agent_pay_addr | TEXT | - | - |
| mid_price_at_quote | TEXT | - | - |
| group_id | TEXT | - | - |
| broker_fee_kas | TEXT | - | - |
| net_delivery_kas | TEXT | - | - |
| expires_user_set | TEXT | - | - |
| filled_qty | REAL | - | 0 |
| settle_grace_until | INTEGER | - | - |
| picks_json | TEXT | - | - |

trim_candidates_confirmed (13 候选, 跑 A2.2 数据真实性):
- order_type, price, quoted_usdt, exchange_offer_id, agent_pay_addr, mid_price_at_quote, group_id, broker_fee_kas, net_delivery_kas, expires_user_set, filled_qty, settle_grace_until, picks_json

trim_candidates_missing: 无 (v0.2 design list 9 candidates 全在 schema 内)

### A2.2 Per-col data reality (7698 total rows, active = aligning/awaiting_payment/paid/verifying)

| col | total | non_null | active_non_null | terminal_non_null |
|---|---|---|---|---|
| order_type | 7698 | 7698 | 548 | 5426 |
| price | 7698 | 833 | 254 | 251 |
| quoted_usdt | 7698 | 3 | 0 | 3 |
| exchange_offer_id | 7698 | 126 | 0 | 110 |
| agent_pay_addr | 7698 | 127 | 0 | 22 |
| mid_price_at_quote | 7698 | 1760 | 0 | 765 |
| group_id | 7698 | **0** | 0 | 0 |
| broker_fee_kas | 7698 | 1763 | 0 | 768 |
| net_delivery_kas | 7698 | 1763 | 0 | 768 |
| expires_user_set | 7698 | **0** | 0 | 0 |
| filled_qty | 7698 | 7698 | 548 | 5426 |
| settle_grace_until | 7698 | **0** | 0 | 0 |
| picks_json | 7698 | **0** | 0 | 0 |

- 真死 col (non_null = 0): **picks_json / group_id / expires_user_set / settle_grace_until** (4 col 完全空)
- 历史用 active 0 (active_non_null = 0 + terminal_non_null > 0): exchange_offer_id (110) / agent_pay_addr (22) / mid_price_at_quote (765) / broker_fee_kas (768) / net_delivery_kas (768) / quoted_usdt (3)
- 几乎死 (non_null < 5): quoted_usdt (3 total)
- active 仍用 (active_non_null > 0): order_type (548) / price (254) / filled_qty (548)

### A2.3 Active row samples

10 行 active (aligning/awaiting_payment/paid) 数据 sample:
- 全 10 行 picks_json IS NULL
- 全 10 行 agent_pay_addr IS NULL
- 全 10 行 quoted_usdt IS NULL
- 全 10 行 broker_fee_kas IS NULL
- 全 10 行 group_id IS NULL

samples_observation: 10 active row 中 0 行使用 picks_json / agent_pay_addr / quoted_usdt / broker_fee_kas / group_id (5 col)

---

## A3. Per peer 24h DM distribution

### A3.1 Last 24h msg distribution

| msg_class | msg_count |
|---|---|
| text | 377 |

(只有 text 类, 无 broadcast / handshake 在过去 24h 内)

### A3.2 Top 50 high-frequency peers (adapted SQL JOIN identities)

| peer (last 12 char) | dm_count_24h |
|---|---|
| nurgcqs3s588 | 44 |
| mu6ac9cc17jf | 1 |
| imrc33dk8a8v | 1 |
| m66y25gj5ke5 | 1 |
| mc8vi7drvzz7 | 1 |
| ... (45 more peers all dm=1) | 1 |

- total peers: 50
- max_dm_count: **44** (单 peer nurgcqs3s588 24h 内 inbound 44 条 DM)
- median_dm_count (peer 25): 1
- p90_dm_count (peer 5): 1

(分布极度倾斜 — 1 peer dm=44, 其余 49 peers dm=1)

### A3.3 DM length stats

- avg_dm_chars: **71.0**
- max_dm_chars: **802**
- sampled_dms: 377
- estimated_avg_tokens_per_dm (chars / 3): **24** (中文 ~2 char/token, 英文 ~4 char/token, 取中间值)

### A3.4 LLM cost projection

- top_peer_single_call_input_tokens (44 dm × 24 tokens): **1056**
- comparison vs 8k context: 0.13x (13%)
- comparison vs 32k context: 0.03x (3%)

(top peer 单次 reactive trigger 真 1056 tokens 输入, 不爆 context window)

---

## A4. retail_dex_orders state distribution

### A4.1 State distribution (全 prod data)

| state | cnt | oldest | latest | avg_age_min |
|---|---|---|---|---|
| expired | 4050 | 2026-04-25 00:28 | 2026-05-01 00:06 | 2384.6 |
| **confirming** | **1708** | 2026-04-28 23:01 | 2026-04-29 18:53 | 2808.4 |
| failed | 1268 | 2026-04-27 05:28 | 2026-05-01 06:07 | 2480.4 |
| awaiting_payment | 528 | (truncated) | (truncated) | (truncated) |
| refunded | 107 | - | - | - |
| aligning | 20 | - | - | - |
| **refunding** | **16** | - | - | - |
| completed | 1 | - | - | - |

⚠ **注意**: prod 真 state 含 `confirming` (1708 rows) + `refunding` (16 rows) — 这两个 state Ship A v0.1 spec **不在 7 state list 内** (per `STATE-MACHINES.md` v0.2). 真**1724 row 处于 Ship A v0.1 不 cover 状态**.

### A4.2 Active state data health

| state | cnt | null_qty | null_peer | bad_side |
|---|---|---|---|---|
| aligning | 20 | 0 | 0 | 0 |
| awaiting_payment | 528 | 0 | 0 | 0 |
| confirming | 1708 | 0 | 0 | 0 |

(active 状态数据 health 干净: 0 null_qty, 0 null_peer, 0 bad_side)

verdict: prod active row 全 well-formed (无 schema 违反数据), 但 state 列含 1708 confirming + 16 refunding 真 Ship A v0.1 不 cover

---

## A5. 5 候选删表确认

### A5.1 Current row counts

| table | count |
|---|---|
| retail_dex_buy_publications | 0 |
| retail_dex_broker_config | 0 |
| broker_accounts | 0 |
| pending_exchange_accepts | 0 |
| retail_dex_user_memory | 10 |

### A5.2 Table callers (production code references)

**retail_dex_buy_publications** (0 rows):
- `kasia-console/src/api/exchange.js:1273` SELECT
- `kasia-console/src/api/exchange.js:1291` SELECT
- migrate.js v74 schema
- 真 caller > migrate, 真 production code 真 SELECT 但 0 data → **伪死表**

**retail_dex_broker_config** (0 rows):
- `kasia-console/src/api/exchange.js:1252-1256` SELECT fee_kas_per_order (撮合费率配置)
- migrate.js v71 schema
- 真 caller > migrate → **伪死表** (代码 expected fee 配置但 0 row)

**broker_accounts** (0 rows):
- `kasia-console/src/api/broker.js:61` SELECT
- `kasia-console/src/api/broker.js:104` SELECT list
- `kasia-console/src/api/broker.js:149` INSERT
- 真 caller 多, 真 broker UI 真 expected 数据但 0 setup → **伪死表**

**pending_exchange_accepts** (0 rows):
- 仅 migrate.js v62 schema
- 真 0 production caller → **真死表**

**retail_dex_user_memory** (10 rows):
- migrate.js v73 schema
- 真 5 broker-* / broker-v2/* file 引用 (broker-intake-watcher / broker-state-authority / broker-v2/llm / broker-v2/router)
- 真 caller > migrate (10 rows + 5 service callers) → **半死表** (production code 真用但 10 row 真小数据量)

---

## Aggregated facts (本字段是事实聚合, 不做架构判断)

- execution_states 真 caller 数: **2 (trading.js + execution-state.js)**
- execution_states sparse columns 数: **5 (intent_id / input_txid / output_txid / amount / asset 真 100% NULL)**
- retail_dex_orders trim 候选中 active_non_null > 0 的 col 数: **3 (order_type 548 / price 254 / filled_qty 548)**
- retail_dex_orders trim 候选中 真死 col (non_null = 0) 数: **4 (picks_json / group_id / expires_user_set / settle_grace_until)**
- retail_dex_orders 真 prod state 含 Ship A v0.1 spec 不 cover 状态数: **2 (confirming 1708 row + refunding 16 row)**
- top peer 24h DM 数: **44 (nurgcqs3s588)**
- top peer 单次 LLM 输入 tokens 估算: **1056 (~13% 8k context)**
- 5 候选删表真死表数 (row=0 + caller=migrate only): **1 (pending_exchange_accepts)**
- 5 候选删表伪死表数 (row=0 + caller > migrate): **3 (retail_dex_buy_publications / retail_dex_broker_config / broker_accounts)**
- 5 候选删表半死表数 (row > 0): **1 (retail_dex_user_memory: 10 rows + 5 service callers)**

---

*Report v1.0 — 2026-05-01 J2 (implementor mode, data collection). Pure facts, no architect judgment. Ping NWT architect mode for verdict on 4 v0.2 design questions.*
