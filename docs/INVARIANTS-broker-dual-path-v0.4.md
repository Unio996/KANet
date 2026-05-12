# INVARIANTS — broker 双路并行 + 协议层汇聚 v0.4

**版本**: v0.4 · **作者**: NWT (architect mode, cross-hat per Owner 5/6 钦定) · **创建**: 2026-05-06
**状态**: 🟢 active spec, 等 J2 T0 grep verify
**前置**: DEV-ROLES.md / COLLAB-REFORM.md / MATCHER-ARCHITECTURE.md v0.1 / STATE-MACHINES.md v0.3 / INVARIANTS.md v0.2 (broker-v2 spec NEW-BROKER-PROPOSAL.md 废品 已 archived)

---

## 1. Context (5/6 Owner 钦定演化)

5/5 NWT cycle (r200-r216) 加固 broker-v2/router (老过渡品), R4 self-deal guard 加在对话层 (错层), RC_01-06 文案断言, premature declare ☆ CLOSE ☆ — 全反 thesis. Owner 5/6 严训"瞎子摸象 + 不继承".

5/6 Owner 钦定 *双路并行 + 底层汇聚 + 整合 4 子系统 + forward-compat 多 DM channel*:
- **路 A (选择题, deterministic, 0 LLM)** — 成熟可控, 给 mass user, LLM down 时仍跑通
- **路 B (matcher LLM 意图)** — power user 自然语言, 当前 matcher.mjs T1+T2 ship
- **底层汇聚** — `/api/exchange/*` endpoint 单一真相源
- **4 子系统整合** — exchange / broker / seeker / taker 通过 broker 单一 entry
- **多 DM channel forward-compat** — Kasia DM 仅当前 channel, Telegram/Discord/etc 后接

---

## 2. Invariant 表 (each 严守, breaks invariant = re-design)

### Layer 1: 协议层 (单一真相源)

- **I-1** 所有 publish/accept/verify/cancel/dispute 走 `/api/exchange/*` endpoint, 任何对话层不绕过
  - 现 endpoint (实证 grep `/c/kanet/kasia-console/src/api/exchange.js`):
    - L132 `/api/exchange/publish`
    - L347 `/api/exchange/accept`
    - L553 `/api/exchange/cancel`
    - L593 `/api/exchange/confirm`
    - L647 `/api/exchange/submit-payment`
    - L668 `/api/exchange/dispute`
    - L734 `/api/exchange/resolve`
- **I-2** R4 self-deal guard **在 `/api/exchange/publish` endpoint 内**, 不在对话层
  - 5/5 NWT 加在 broker-v2/router.js:188 是错层 (commit 084be7b1a)
  - 协议层 guard fire = 任何 caller (broker-v2 / matcher / broker-v3 / 真用户直 curl) 都 cover
  - 实证: `grep "agent_wallets\|R4\|self.deal" /c/kanet/kasia-console/src/api/exchange.js` 当前 0 hit (协议层裸)
- **I-3** R31 (pay_address 不可改 post-publish) / R33 (direction 不可改) guard 在 SQL 层 (`UPDATE WHERE col IS NULL OR col = :new`), 全 publish path 共享
- **I-4** state machine 单源 — `broker-state-machine.transition()` CAS, 任何对话层不直 SQL UPDATE state
  - 违反 = R-NWT-STATE-MACHINE lint hard fail
  - 实证: broker-v2/router.js:104-108 (B1 PAID detect 直 sqlite UPDATE) 是 anti-pattern 残留

### Layer 2: 对话层 (channel-agnostic + 双路并存)

- **I-5** 对话层不假设 user identity = Kaspa addr, 接口契约用 `user_id` (现实现 `kaspa:q...`, 未来加 `tg:@user` / `dc:user#1234` prefix)
- **I-6** 对话层不直 sqlite, 全 fetchJson HTTP API (跟 MATCHER-ARCHITECTURE §3.2 align)
  - 现 broker-v2/router.js + state.js + order-book.js 直 sqlite — anti-pattern 残留, broker-v3 严守
  - matcher.mjs 全 fetchJson (合规)
- **I-7** 双路并存 (路 A 选择题 + 路 B matcher LLM), 入口透明
  - mass user → 路 A (选择题, 默认)
  - power user → 路 B (matcher LLM, 自然语言触发)
  - 通过 user input 检测 (数字 = 路 A / 自然语言 = 路 B)
- **I-8** 路 A 完全 0 LLM (LLM down 时仍跑通)
  - 实证依据: 5/3-5/5 LLM down 50h 期间 5 个测试 fall-back 全死, 路 A 不应受影响
  - KI-19 sediment: LLM judgment per-cycle non-determinism, 协议层决策必 deterministic

### Layer 3: Channel adapter (forward-compat)

- **I-9** 加新 channel = 加新 adapter daemon (类比 bsc-incoming-watcher), 不改协议层
- **I-10** 各 adapter 翻译成 user_id, 推 mind-manager / broker dispatch (跟 Kasia DM 同入口)

### Layer 4: 整合 4 子系统 UX

- **I-11** 真用户 entry agent 单一 (Trader-B OR future canonical broker), 一级菜单整合 buy/sell/browse/accept/my-orders/cancel
- **I-12** seeker (browse market) + taker (accept maker offer) 通过 broker entry 调 protocol API, 不暴露独立 endpoint 给真用户

---

## 3. 双路 + 底层汇聚架构图

```
┌─ Channel Adapter Layer ─────────────────────────────────────┐
│  Kasia DM (当前) │ Telegram (未来) │ Discord (未来) │ Email │
│         ↓          ↓            ↓             ↓             │
│      user_id 抽象 (kaspa:... / tg:@u / dc:#1234 / em:a@b)   │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─ Conversation Layer ────────────────────────────────────────┐
│  路 A 选择题 broker-v3 (deterministic, 0 LLM)                │
│  路 B matcher Skill (LLM 意图, agent-mind reactive)         │
│  入口透明: 数字 input → 路 A, 自然语言 → 路 B                 │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─ Protocol Layer (单一真相源) ───────────────────────────────┐
│  /api/exchange/publish (R4 self-deal guard 在这层)          │
│  /api/exchange/accept                                        │
│  /api/exchange/cancel / confirm / submit-payment / dispute  │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─ State Machine ─────────────────────────────────────────────┐
│  broker-state-machine.transition() CAS (单源守门)            │
│  exchange-machine.handleAcceptV1 / payment / dispute         │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─ Storage (DB 真相) ─────────────────────────────────────────┐
│  retail_dex_orders + exchange_offers + chain_events         │
│  + messages + agent_wallets + relation_states               │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─ On-Chain Layer ────────────────────────────────────────────┐
│  Kaspa 链 (Relay sendKaspa) + EVM/SOL/TRON (跨链 verify)    │
│  trade-protocol-filter event subscriber                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 路 A 选择题 broker-v3 state machine

```
START (用户首发 DM)
  ↓
MENU_TOP (一级菜单)
  ├─ 1 → BUY_FLOW
  ├─ 2 → SELL_FLOW
  ├─ 3 → BROWSE_MARKET
  ├─ 4 → ACCEPT_OFFER
  ├─ 5 → MY_ORDERS
  └─ 6 → CANCEL_ORDER

BUY_FLOW: CHAIN_SELECT → QTY_SELECT → ADDR_INPUT → PREVIEW → CONFIRM
  CONFIRM → POST /api/exchange/publish (协议层守 R4/R31/R33)
  → publish 成功 → MY_ORDERS state, 等 taker

SELL_FLOW: CHAIN_SELECT → QTY_SELECT → ADDR_INPUT → PREVIEW → CONFIRM
  CONFIRM → POST /api/exchange/publish
  → publish 成功 → 等 user 转 KAS 给 broker, intake-watcher 接

BROWSE_MARKET: GET /api/exchange/offers (paginated 5 条 / 页)
  → user reply '1'-'5' 选 offer → ACCEPT_OFFER (with offer_id)

ACCEPT_OFFER: OFFER_ID_INPUT (or 来 BROWSE) → CHUNK_QTY_SELECT → PAYMENT_GUIDE
  PAYMENT_GUIDE → POST /api/exchange/submit-payment (含 payment tx)
  → wait verify (chain-incoming-watcher 触发)

MY_ORDERS: GET /api/exchange/offers?maker={user_id}
  → list active orders → user reply '1'-'5' 选 → DETAIL OR CANCEL

CANCEL_ORDER: ORDER_ID_INPUT → CONFIRM_CANCEL → POST /api/exchange/cancel

任何 state user reply '取消'/'back' → 回 MENU_TOP
任何 state user 自然语言 (非数字非 0x) → fallback 路 B matcher (LLM)
```

每节点 state 持久化在 retail_dex_orders.state ('aligning' draft 阶段) + 选择题进度 (新 col `flow_state` OR session-only memory, 待 J2 grep + decide)

---

## 5. 整合 4 子系统 UX (一级菜单设计)

```
broker reply (user 首发 DM):

你好! 我是 Trader-B, KAS 撮合 broker.
你想做什么?

  1️⃣ 买 KAS (我帮你挂限价买单)
  2️⃣ 卖 KAS (我帮你挂限价卖单)
  3️⃣ 看市场挂单 (browse 别人的)
  4️⃣ 接挂单 (taker 接 maker offer)
  5️⃣ 我的订单 (查 status)
  6️⃣ 取消挂单

回数字 1-6 选择.
(也可以直接打字描述, 我有 LLM 助手识别意图)
```

最后一行 = 路 B matcher LLM 入口 hint, 用户打字 → mind-manager.getReply → matcher Skill.

---

## 6. Forward-compat — 多 DM channel 接入

### 现状
- Kasia DM 是当前唯一 channel (Kaspa 链 P2P encrypted)
- broker-v2/router 入参 `peer` 是 Kaspa addr (kaspa:q...)
- mind-manager.getReply 入参 `peer` 同款

### 演化 (Phase 5+, 不阻当前 ship)

1. 加 `channel_adapters` table:
   ```sql
   CREATE TABLE channel_adapters (
     channel_type TEXT,        -- 'kasia' / 'telegram' / 'discord' / 'email'
     external_id TEXT,         -- kaspa:q... / tg user id / dc user#1234
     canonical_user_id TEXT,   -- KANet 内部统一 user_id
     created_at TEXT,
     PRIMARY KEY (channel_type, external_id)
   );
   ```

2. 加 adapter daemon (类比 bsc-incoming-watcher):
   - `kasia-dm-adapter.js` (现已存在, 通过 relay sendCommand 接 chain DM)
   - `telegram-bot-adapter.js` (未来, 接 Telegram bot API)
   - `discord-bot-adapter.js` (未来)
   - 各 adapter 收消息 → 翻译 user_id → 推 mind-manager.getReply / broker-v3.dispatch

3. broker-v3 / matcher.mjs 入参改 `user_id` (字符串, 含 channel prefix), 不绑 Kaspa addr

4. retail_dex_orders.user_kasia_address rename → `user_id` (Phase 5 schema migration)

### 当前 ship invariant (forward-compat 严守)
- broker-v3 + matcher.mjs 用 `user_id` 类型抽象, 不依赖 `peer.startsWith('kaspa:')` 类 chain-specific check
- /api/exchange/* endpoint 入参逐步 rename `user_kasia_address` → `user_id` (向后兼容)

---

## 7. Ship plan (3 phase)

### Phase 1 P0 (1-2 周, NWT spec + J2 ship + NWT review)

#### Task 1: PZ-PROTOCOL-LAYER-GUARDS-MIGRATION
- **scope**: R4/R31/R33 guard 从 broker-v2/router.js 迁移到 /api/exchange/publish endpoint
- **file**: kasia-console/src/api/exchange.js (publish handler L132-345 内加 SQL guard)
- **LOC**: ~30-50
- **复用 pattern**: broker-v2/router.js:188 R4 SQL guard (commit 084be7b1a, 5/5 NWT 错层加的, 移过来)
- **acceptance**: 任何 caller (broker-v2 / matcher / broker-v3 / 真用户直 curl) 都被 guard reject self-deal
- **测**: RC_05_self_deal_real 改用 matcher path (不再 broker-v2) 跑, 验证协议层 guard fire
- **守 invariant**: I-2

#### Task 2: PZ-MATCHER-T3-PRODUCTION-CLOSE
- **scope**: matcher T3 真 e2e production close (5/4 source-level close 不算, Owner 验收 3 场景)
- **file**: agent-mind/src/skills/matcher.mjs (现 714 行) + agent-mind/tests/matcher.test.mjs
- **LOC**: ~50-100 (主 invariant assertion test 加, 不重写 matcher.mjs logic)
- **测**: 按 MATCHER-ARCHITECTURE §10 Owner 验收 3 场景:
  - A: 一笔正常 KAS/USDT 交易跑通 (NWT → Trader-M, 完整 4 stage)
  - B: 异常路径自愈 (付款超时 / underpayment / 跨链 verify 超时)
  - C: 多 user 并发安全 (5 user 同时跟 Trader-M, 状态不混)
- **acceptance**: 3 场景全 PASS = matcher T3 production close
- **守 invariant**: I-7, I-8 (matcher = 路 B), MATCHER-ARCHITECTURE §11 9 anti-pattern

#### Task 3: PZ-BROKER-V3-DETERMINISTIC
- **scope**: ship 选择题 broker-v3 (deterministic state machine, 调 /api/exchange/* endpoint, 0 LLM)
- **file**: kasia-console/src/services/broker-v3/* (新建 dir, 跟 broker-v2 不破)
  - `broker-v3/router.js` (~150 LOC, 主入口 dispatch state)
  - `broker-v3/state-machine.js` (~100 LOC, 选择题 state 流转图实现)
  - `broker-v3/menu-builder.js` (~80 LOC, 一/二/三级菜单文案 builder)
  - `broker-v3/exchange-client.js` (~60 LOC, /api/exchange/* HTTP client)
  - `broker-v3/index.js` (~30 LOC, exports)
- **LOC**: ~400 总 (不 over-design)
- **acceptance**: 选择题流程整合 6 选项菜单 e2e + LLM-down simulate 时仍跑通 + 整合 4 子系统 (buy/sell/browse/accept/my-orders/cancel)
- **守 invariant**: I-1, I-5, I-6, I-7 (路 A), I-8 (0 LLM), I-11, I-12

### Phase 2 P1 (1-2 周, post Phase 1 close)

- 真用户 demo 双路 (Owner 自己从 Kasia 客户端发 DM 给 Trader-B, 试 6 选项 + 试自然语言)
- Owner 真测 0 bug verify (走 COLLAB-REFORM 规 11 6 条 ship checklist)
- broker-v2 deprecate (broker-v3 替代真用户 path)
  - mind-manager.js Service Mute 调整: Trader-B is_service=1 仍 mute matcher reactive, 但 broker-v3 sync HTTP 入口替 broker-v2

### Phase 3 P2 (1 月, post Phase 2 close)

- 删 broker-* 24 file (按 MATCHER-ARCHITECTURE §8.3 audit, imports = 0 持续 4 周)
- broker-v2 整 dir 删
- retail_dex_orders schema migration (user_kasia_address → user_id, forward-compat)
- 加 channel_adapters table + 起 telegram-bot-adapter (Phase 5 真 multi-channel)

---

## 8. 分工 (Ship A 严守 per project_ship_a_cross_hat)

- **architect (NWT cross-hat)**: 起 spec + invariant + task 卡, 不写 production code
- **implementor (J2)**: T0 grep verify → T1 ship → broadcast commit → cross-review
- **reviewer (NWT cross-hat)**: 审 commit + green-light + 守 invariant audit (规 8 必检 invariant 退化, 规 14 假设语必 evidence ack)
- **operator (NWT cross-hat)**: 跑 e2e 测 (Owner 验收 3 场景)
- **QA designer (NWT cross-hat)**: 加 invariant assertion test (替 RC_01-06 文案断言)

按 DEV-ROLES.md anti-mode A 严守: NWT 不 *写 production code* (broker-v3 router.js 等是 J2 ship). NWT 起 spec + 验 invariant + 跑 e2e 测.

---

## 9. 验收标准 (COLLAB-REFORM 规 11 6 条)

phase closure broadcast 前必走:

1. **三方 cron baseline 多次 run 全 PASS** (不只 1 次)
2. **Owner 真测 ≥1 critical path 成功** (BUY/SELL/cancel/accept/my-orders 6 选项至少 1 个跑通)
3. **已知 bug 全在 follow-up plan**, 不藏
4. **跨 process boundary type test 通过** (broker-v3 → exchange.js → exchange-machine → Relay → chain)
5. **关键 service log grep error 全 clean** (kasia-console / kasia-relay / agent-mind / llama-server 1h 无 fresh error)
6. **ANTI-PATTERNS rules 全 grep verify** (R-NWT-STATE-MACHINE / R29 / R37 / KI-19 / etc.)

任一漏 → 不广播 closure.

---

## 10. 5/5 NWT cycle 教训 sediment

加 docs/ANTI-PATTERNS.md 新一条 (J2 ship 时同步加):

> **Anti-pattern XX: 加固过渡品 = 推迟 thesis 演化**
>
> NWT 5/5 cycle 加固 broker-v2 (已废品, 4/29 ship 后废) + R4 hard guard 加在对话层 (错层) + RC_01-06 文案断言 (反 invariant assertion thesis) + premature ☆ CLOSE ☆ milestone (违 COLLAB-REFORM 规 11).
>
> **症状**: implementor mode default 接 task 不审 thesis; 加固老 path 以 ship 速度优先; 文案断言代替 invariant assertion; phase closure 不走 6 条 checklist.
>
> **真因**: 没切 architect mode 审 thesis; 没读 MATCHER-ARCHITECTURE T0-T5 演化; 没读 DEV-ROLES.md 6 角色 + 单人多 hat 纪律.
>
> **修法**: 任何 patch 前必问 3 问:
> 1. 这 fix 加在 *协议层 invariant* 还是 *对话层 polish*?
> 2. 这 fix 是 *thesis 演化方向* 还是 *老 path 加固*?
> 3. 这 fix Owner 验收时是 *单点测* 还是 *3 场景体验*?

---

## 11. J2 T0 grep verify trigger (KI-2/3/4/5 防复刻硬纪律)

J2 接位本 spec 后必先 grep 5 query (verdict: verify_pass / partial_mismatch):

1. /api/exchange/publish 现 schema (L132-345 实际 payload + handler logic) — 跟 spec §2 I-2 R4 加位 align?
2. exchange-machine.js handleAcceptV1 / payment / dispute 实际 transition list — 跟 spec §3 state machine 图 align?
3. retail_dex_orders schema 现 col + state enum (含 confirming/refunding 真实 vs spec align)
4. mind-manager.js Service Mute (L390-394) 撤 mute 影响 audit (R26 + Service Mute 整合可行性)
5. broker-v2/router.js:188 R4 SQL guard pattern (复用到 exchange.js publish handler 的 LOC + dependencies)

J2 grep verify 后 broadcast r167 finding (verify_pass / partial_mismatch + 详细). NWT iterate spec v0.5 OR green-light T1 ship Phase 1 三 task.

---

## 12. 修订历史

- **v0.4 (2026-05-06)**: 初版, NWT architect cross-hat 起草, sediment Owner 5/6 钦定 (双路并行 + 底层汇聚 + 整合 4 子系统 + forward-compat 多 DM channel) + 5/5 NWT cycle 教训.

---

*v0.4 — 2026-05-06 NWT (architect mode). 基于 Owner 5/6 严训 "深刻思考交易, 不要应声虫" + 3 现行文档 (DEV-ROLES / COLLAB-REFORM / MATCHER-ARCHITECTURE) + matcher.mjs 全读 + mind-manager Service Mute 实证. broker-v2 已废.*
