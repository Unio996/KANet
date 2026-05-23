# INVARIANTS v0.2 §9 — Event-Sourced State Machine (DRAFT)

> **Status**: DRAFT for v0.2 integration (timing per Owner 钦定: post Phase 1 close + Phase 2 第一 ship 后 v0.2 起)
> **Origin**: Owner 5/3 钦定 — broker T3 真需要 state machine, 旧 order-machine "漏水永远缝不上" 教训 sediment
> **作者**: NWT architect hat (cross-hat per Owner 5/3 explicit authorize "自动切换身份 + J2 协作干")
> **审**: Owner architect (claude.ai) 整合到 v0.2 时 final review
>
> **本章目的**: 把 5/2 上午 → 5/3 现在的 "似乎绕圈" pattern sediment 成永久 invariant。 真 lesson 不是 "用 vs 不用 state machine", 是 "**state 在哪里 own**"。

---

## 9.1 State ownership 是 design 关键, NOT state machine 本身

**Invariant**: 任何 protocol state 的设计, 第一问 不是 "需要哪些 state?", 是 **"state 真相源 在哪里?"**。

**起源**:

5/2 上午 Owner 看旧 broker order-machine (9 state: published → accepted → paying → paid → verified → delivering → completed + disputed/escalated 旁路) "漏水永远缝不上"。 真因 不是 9 state 太复杂, 是 **state 真住在 process memory + DB cache**:
- 多 writer (matcher / payment-handler / chain-listener 全写)
- 进程 restart 不 reload (in-memory state lost)
- Multi-instance race (两 matcher 同时 advance state 不一致)
- 异常路径 cascade (disputed→escalated→? 没真 recovery)

5/2-5/3 试 "matcher 0 私有 state" — push state 到 KANet primitives, 但 settlement (paid / verified / delivered) 没 KANet primitive cover, T3 真需要 state 不可避免。

**真 lesson**: state 不是 "要不要", 是 "在哪里 own"。 旧 order-machine 漏水因为 state owned by mutable process memory + DB writes; 新 design 必把 state ownership 移到 immutable event log。

---

## 9.2 Event-sourced 真 design (chain_events = truth, DB = projection)

**Invariant**: KANet protocol state 用 **event-sourced pattern**。 三层职责:

| 层 | role | 真位置 | 性质 |
|---|---|---|---|
| **Truth** | 状态变迁的 immutable append-only log | Kaspa chain_events 表 + chain TX | **multi-writer append-only** (7+ writer paths per J2 r128 grep verify), ordered by chain TX, multi-instance consensus |
| **Projection** | 当前 state cache (优化 query 用) | Console DB column (eg `exchange_offers.lifecycle_state`) | derived, rebuildable from chain replay |
| **Reactor** | 监听 events → 决策 → emit next event | matcher / broker / settlement skill (process) | **0 own state**, 仅 reactive event handler |

**关键**: 任 process die 100 次, 重新 spawn → replay chain events → state 重建。 Multi-instance 同时跑 → chain TX consensus order = 0 race。

**对比旧 order-machine**:

| 维 | 旧 (漏水) | 新 (event-sourced) |
|---|---|---|
| Truth source | Process memory + DB cache (mutable) | chain_events log (immutable) |
| Restart | state lost, manual recovery | replay events → state 自动重建 |
| Multi-writer | race / lost transitions | append-only, chain consensus order is truth |
| Recovery | DB cache may be stale, hard to verify | chain TX 是 ground truth, projection 重建 trivial |

---

## 9.3 KANet primitives 真 enable event-sourced (现有 infra)

KANet 已 ship 的 infra 真 cover event-sourced 模式 (J2 r127 后 sediment 待 verify):

**Primary primitives** (per J2 r128 grep verify, 5/3):

- **chain_events** 表 (id / txid / from_address / to_address / event_type / payload / observed_at) — multi-writer append-only INSERT (7+ writer paths verified: state-transitions / broker-inventory-watcher / broker-state-authority / broker-state-machine / exchange-machine 等). Append-only convention 守 — 0 UPDATE, 0 DELETE chain_events row.
- **trade-protocol-filter** (services/trade-protocol-filter.js, 62656 bytes) — chain_events handler-style switch on `t` field, **15 protocol types verified** (7 OTC: kanet_sell_v1/buy/accept/paid/delivered/cancel/timeout + 8 Exchange: kanet_exchange_v1/_accept/_cancel/_paid/_delivered/_timeout/_dispute/_resolve + 1 misc: kanet_confirm_v1)
- **broadcast_messages** 表 — broadcast TX 上链 audit trail
- **kaspa_tx_log** 表 (Week 2 Day 1 ship) — Relay 嵌入 indexer 观察 watched-address TX

**Reactor pattern primitives**:
- **mind reactive loop** — Brain wakeup on inbound DM event
- **registry.mjs orchestrate** — gatherContext + formatForBrain pair (T1 ship)
- **skill canActivate** — task type 触发判断

**应用空缺 (Phase 2 backlog 候选)**:
- protocol state machine 的 transition() helper 当前 broker-state-machine.js 是 read-modify-write pattern (旧风格), 需重构 → emit chain event TX pattern
- exchange_offers.lifecycle_state column 存在但当前 update via 直 SQL UPDATE — 需改为 derive from chain_events replay
- Skill 接 trade-protocol-filter event subscription 模式还没标准化 (per skill 注册 event handler 的 API 待 design)

---

## 9.4 State machine 真 应用 (transitions = events, 9-state for T3)

**Invariant**: protocol state machine 的每个 transition **必对应一条 chain event**。 transition() 真定义 = "emit next event TX", NOT "UPDATE row"。

**T3 settlement state machine** (per Owner 5/3 spec):

```
published → accepted → paying → paid → verified → delivering → completed
                                                              ↓
                                          disputed → escalated
                                          ← (回退路径)
```

9 states + 14 transitions (含 disputed/escalated 旁路 + 回退):

| transition | event_type | emitter | trigger |
|---|---|---|---|
| → published | offer_published | matcher (publishOffer) | T2 ship |
| published → accepted | offer_accepted | taker | taker DM accept |
| accepted → paying | payment_initiated | taker | EVM tx pending |
| paying → paid | payment_received | trade-protocol-filter (cross-chain observer) | EVM tx confirmed |
| paid → verified | payment_verified | matcher (cross-chain proof check) | proof valid |
| verified → delivering | delivery_initiated | matcher (sendKaspa) | KAS TX pending |
| delivering → completed | delivery_confirmed | trade-protocol-filter (Kaspa observer) | KAS TX confirmed |
| any → expired | offer_expired | timeout reactor | 30 min elapsed |
| paid/verified → disputed | dispute_raised | maker OR taker | dispute DM |
| disputed → escalated | dispute_escalated | timeout / manual | 24h dispute unresolved |
| disputed → resolved (回退) | dispute_resolved | resolver | dispute outcome decided |

**每 transition = 一个 chain event TX**:
- matcher / taker / trade-protocol-filter 等 reactor emit chain TX
- chain_events INSERT (Scout 观察 block)
- exchange_offers.lifecycle_state projection 更新 (可直接 from chain_events replay 算)
- 任 reactor 0 直 SQL UPDATE lifecycle_state — 仅 emit event

**Recovery semantics**:
- matcher process die → 重新 spawn → replay chain_events for offer_id → 当前 state 重建
- DB cache lifecycle_state 不可信 → 任 critical 操作前 replay events from chain
- Multi-instance: 各 matcher 看到 same chain_events → same state → consensus

---

## 9.5 反模式 (旧 order-machine 漏水 lessons sediment)

**Anti-pattern #1**: state owned by process memory
- ❌ \`this._currentOrders = new Map()\` — 进程 die 即 lost
- ✅ matcher reactor 0 own state, query chain_events for current state

**Anti-pattern #2**: DB UPDATE as state transition
- ❌ \`UPDATE exchange_offers SET lifecycle_state = 'paid' WHERE id = ?\` — multi-writer race + no audit trail
- ✅ emit chain event TX → trade-protocol-filter observe → projection update derived

**Anti-pattern #3**: Read-modify-write transition
- ❌ \`row = SELECT ...; row.state = 'verified'; UPDATE ...\` — TOCTOU race
- ✅ Append-only event log, last event determines state

**Anti-pattern #4**: 异常路径 cascade in process memory
- ❌ \`if (state === 'disputed') { advanceToEscalated(); ... }\` — recovery 不可靠
- ✅ disputed event TX + reactor on dispute_raised event handles cascade

**Anti-pattern #5**: Multi-instance state in process
- ❌ 多 matcher 同时跑各持 in-memory state → divergence
- ✅ 全 multi-instance read same chain_events → consensus

---

## 9.6 应用 (T3 settlement / Bug A handshake / future skills)

### 9.6.1 T3 settlement state machine
- 9-state per 9.4 应用
- matcher subscribe trade-protocol-filter for: kanet_exchange_paid_v1 / kanet_exchange_delivered_v1 / kanet_exchange_dispute_v1 / kanet_exchange_timeout_v1
- matcher emit: kanet_exchange_paid_v1 (post EVM proof verify) / kanet_exchange_delivered_v1 (sendKaspa)
- **column name verified (per J2 r128 grep)**: \`exchange_offers.protocol_status\` (NOT \`lifecycle_state\` — NWT §9 v0 凭印象, J2 grep catch). Schema 现状 (Migration v83 `CHECK(protocol_status IN ('open','matched','verifying','delivering','completed','refunded','failed','expired','timed_out','cancelled','disputed'))` 11 enum values).
- 现状 9.5 anti-pattern #2 widespread: 8+ direct UPDATE paths to \`exchange_offers.protocol_status\` (api/exchange.js / broker-intake-watcher / broker-state-authority / exchange-machine), 不全经 transition() helper. T3 重构 candidate: 全 UPDATE → emit chain event TX → trade-protocol-filter handler 推 derive projection.

### 9.6.2 Bug A (cross-agent handshake decrypt fail) state perspective
- Handshake protocol 当前 implicit state in relation_states (status='accepted') + chain_events handshake type
- Bug A reflects: cross-agent handshake decrypt fail 时, **没 event emitted** = state transition 漏 = relation 卡 unknown
- Phase 2 修法候选: handshake_decrypt_failed event type 加, decrypt fail 时 reactor emit (NOT silent throw) — 跟 (iii) outer catch 配套

### 9.6.3 Future skills
- 新 skill 接 protocol layer 必 follow event-sourced pattern (NOT 自建 state machine)
- INVARIANTS §9 = sediment 防止 future skills 重 旧 broker 错误

---

## 9.6.4 §9 draft 自身 实证 — KI-2/3/4/5 防复刻硬纪律 第 5 cycle

per J2 r128 grep verify of NWT §9 v0 draft:
- §9.2 wording "single observer" → 修 "multi-writer append-only" (7+ writer paths verified)
- §9.3 protocol type count "7 OTC + 7 Exchange = 14" → 修 "7 + 8 + 1 misc = 15" (kanet_exchange_dispute_v1/resolve_v1 漏 + kanet_confirm_v1)
- §9.6.1 column name "lifecycle_state" → 修 "protocol_status" (Migration v54 假定不存在, 真 v83 column exists)
- §9.5 anti-pattern #2/#3 confirm transition() RMW with CAS hybrid (实证 OK)
- §9.3 sub Skill event subscription standardization confirm 0 hit (实证 OK)

**Meta-invariant**: INVARIANTS sediment 章节本身也 subject to KI-2/3/4/5 防复刻 — architect 起 invariant doc 凭 specific facts (column 名 / type count / writer paths) 时仍可能凭印象。 J2 grep verify infrastructure 必 raise 到**INVARIANTS sediment layer**, NOT 仅 task卡 spec layer。

INVARIANTS v0.2 §1.2 surface area 应扩 cover (per 5 cycle catch trace):
- API signature (Phase 1 KI-2/3/4/5)
- Endpoint shape (T2 v1.0)
- Class lifecycle structure (T2 v1.1)
- Method signature param count + input shape (T2 v1.2)
- Helper method existence (T2 v1.2)
- Method orchestrate flow direction (T2 v1.2)
- **Schema column names** (T2 v1.2 + §9 draft 5/3 新触发)
- **Protocol message type count + names** (§9 draft 5/3 新触发)
- **Multi-writer paths to event/state tables** (§9 draft 5/3 新触发)

---

## 9.7 Sediment Evidence

- **5/2 上午**: Owner 看旧 broker order-machine "漏水永远缝不上" → 触发 matcher 0 state 设计
- **5/2-5/3**: matcher T1 ship 0 私有 state (gatherContext 借 KANet API + extractIntent 借 Adapter LLM + formatForBrain 借 Brain reactive 自然 reply) — Phase 1 r109/r114/r117 实证 0 state 工作 for listen + intent extract
- **5/3 早**: Owner 钦定 broker chat-driven 0 state (T2 publish 仍 0 私有 state, lifecycle_state DB column 是 cache derive)
- **5/3 现在**: Owner 钦定 T3 真需要 state, "和我之前钦定 0 state 不冲突 — state 在哪里 own 是关键"
- **回到 5/2 上午 不是 circular**: lessons learned 的就是 state ownership location, 不是 "用 vs 不用"

---

## 9.8 Phase 2 实施 candidate (post v0.2 sediment)

新增 backlog item (retro Phase 2 backlog 加):

**PZ-MATCHER-shipT3-event-sourced** (~200-400 LOC architect spec)
- T3 9-state machine event-sourced 实施
- Migration v54 lifecycle_state column
- matcher subscribe trade-protocol-filter (5 event types)
- matcher emit (payment_verified + delivery_initiated)
- exchange_offers.lifecycle_state derive from chain_events replay
- broker-state-machine.js transition() refactor → emit event TX pattern
- 测试: state replay correctness + recovery from process restart + multi-instance consensus

ETA: ~3-5 hr ship + 1 hr cross-review + system auto-verify

---

## 9.9 v0.2 §9 整合时机

per Owner 5/3 钦定 INVARIANTS v0.2 timing:
- v0.2 起草触发 = Phase 1 close + Phase 2 第一 ship (= post T2 close)
- 本 §9 draft 现在 sediment 完, 留 v0.2 整合
- T3 任务卡 起草前必引用本 §9 invariants (KI-2/3/4/5 防复刻 sediment 应用)

---

*v0.2 §9 draft — 2026-05-03 NWT architect hat (cross-hat per Owner 5/3 explicit authorize). J2 grep verify 真 current event infra (trade-protocol-filter subscriptions / chain_events write path / broker-state-machine current behavior / exchange_offers.lifecycle_state usage) → iterate doc → v0.2 整合 architect (claude.ai) final.*

*真核心: state ownership 决定 design, NOT state machine 本身。 旧 order-machine 漏水因 state 住 process memory; event-sourced 把 state 移到 chain event log = immutable consensus = 0 漏水。*
