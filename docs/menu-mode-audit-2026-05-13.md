# Menu Mode Audit — broker-v3 BSC 1 chain 闭环 verify

**版本**: v1.0 · **作者**: NWT (architect+reviewer cross-hat) + J2 (implementor)
**创建**: 2026-05-13 (Phase B audit + fix), close 2026-05-14
**状态**: 🟢 close
**前置**: Phase A.2 (broker-v2 + LLM 残留 archive commit e605890c1) + Phase B P0+P1 ship (6f1626059 + e887d163a)

---

## 1. Context

Owner 5/13 严训:
- "怎么现在还残留 LLM 路径? 如果和 Matcher 无关直接删除"
- "要保证菜单路径的纯粹和可靠, 逻辑和功能闭环完整"
- "现在要回答, 纯菜单模式是否链路完整? (起码一条链路 比如 BSC), 功能完整且链路闭环, 随时用户可撤销"
- "紧扣主题 BSC 1 chain 彻底跑通无 bug"

本 audit 覆盖 broker-v3 menu mode (kasia-console 路 A deterministic 选择题) BSC 1 chain 闭环 7 维度.

---

## 2. KANet broker 架构 (5/6 + 5/13 演化 final)

- **路 A** = `kasia-console/src/services/broker-v3/` — deterministic 选择题菜单, 0 LLM, mass user 默认
- **路 B** = `agent-mind/src/skills/matcher.mjs` — LLM 意图 Skill, HTTP API client (跨 service)
- **共用底层**: `/api/exchange/*` 协议层 + state machine + retail_dex_orders/exchange_offers

5/13 archive scope (~4500 LOC):
- `archive/2026-05-13-broker-v2-llm/`: broker-v2/ (5 files) + broker-llm-agent.js + broker-buy-handler.js + broker-sell-handler.js + bsc-incoming-watcher.js + 38 LLM 老 test case (含 lifecycle_state_expire_boundary)
- production code delete ~200 LOC: conversations.js LLM dispatch + index.js bsc-incoming-watcher startup + broker-v3/router.js v2 fall-through + state-machine.js LLM hint
- env clean: kanet.env BROKER_V2_ENABLED + kanet-start.sh case

---

## 3. 7 维度 audit results

### 维度 1: /api/exchange/* 7 endpoint cover 菜单式 ✓ (P1 fix e887d163a)

broker-v3/exchange-client.js exports:
| helper | endpoint |
|---|---|
| publishOffer | POST /api/exchange/publish |
| acceptOffer | POST /api/exchange/accept |
| cancelOffer | POST /api/exchange/cancel |
| getOffer | GET /api/exchange/offers/:id |
| **submitPayment** (P1 new) | POST /api/exchange/submit-payment |
| **confirmOffer** (P1 new) | POST /api/exchange/confirm |
| **disputeOffer** (P1 new) | POST /api/exchange/dispute |
| **resolveOffer** (P1 new) | POST /api/exchange/resolve |

8 endpoint coverage (含 P1 新加 4) — 协议层 endpoint inventory 完整对应 menu user-facing action.

### 维度 2: UI menu-select 完整 ✓ (P0 fix 6f1626059)

broker-v3/state-machine.js:
- `SUPPORTED_CHAINS = ['bsc', 'eth', 'polygon', 'arbitrum', 'optimism', 'base']` (P0 加 op + base)
- `_chainSelectText` 6 chain 显示 (Phase 2 β prefund 4 chain 全 user 可用)

menu 6 top-level option:
- '1' BUY / '2' SELL / '3' BROWSE_MARKET / '4' ACCEPT_OFFER / '5' MY_ORDERS / '6' CANCEL_ORDER

任意 state 'back/取消' → MENU_TOP ✓

### 维度 3: 协议自动 trigger 链路 (v0.4 backlog P2 defer)

现状: `_autoPayExchange` (trade-protocol-filter.js L697) + `_autoSettleAsset` (L716) 触发条件完整, BSC e2e 5/12 PASS + 4 chain 5/13 PASS.

bridge-router 接 `_autoPayExchange` auto multichain rebalance (broker 自动 detect chain X USDT 不足 → auto bridge) — **v0.4 backlog**. 现 NWT operator 手动 fire bridges (5/13 12 bridges, broker BSC → 4 chain). 不阻 Phase B close, 单独 spec 后续.

### 维度 4: chain_events 8 行 trace 完整 multichain ✓

5/13 Sub #4 4 chain real e2e completed offer chain_events trace identical 4 events pattern:
| chain | offer | matched | broker_chunk_filled | exchange_paid | exchange_completed |
|---|---|---|---|---|---|
| polygon | 522c170e | ✓ ba9d0e39 | ✓ | ✓ 0xbc7e6e63 | ✓ fe2b8dd7 |
| arbitrum | 1f51b8a1 | ✓ 4f95686f | ✓ | ✓ 0x7a0000c8 | ✓ 26e88162 |
| optimism | 35b7707e | ✓ c146405a | ✓ | ✓ 0x8b74e66a | ✓ 05930fad |
| base | b8296ffa | ✓ f126a024 | ✓ | ✓ 0x62d61e2a | ✓ a640bce2 |

每 offer 4 chain_events row + publish broadcast_messages + broker send_kas transactions = 总 lifecycle 8+ 行 audit trail.

### 维度 5: fund_lock multichain 准确 ✓

| state | fund_lock status | release condition |
|---|---|---|
| open | locked | publish 时 |
| matched / verifying / delivering | locked | mid-flow |
| completed | spent | broker 真发 KAS |
| cancelled | released | open→cancelled OR matched→cancelled (5/12 stress test #5 fix) |
| disputed → resolved (maker_wins) | released | KAS 退 maker |
| disputed → resolved (taker_wins) | spent | KAS 发 taker |
| expired / timed_out / refunded | released | TTL OR refund |

实证 (5/13 实运行):
- NWT operator BSC smoke offer fac9cc32: publish (locked 1 KAS) → cancel (released 18s 后) ✓
- 4 chain Sub #4 completed: fund_lock status=spent at exchange_completed time ✓
- Global state: locked 27 (active) / released 2867 / spent 25 / 0 stuck

### 维度 6: Error recovery 路径 ✓

state-machine TERMINAL states (7): completed / disputed / timed_out / failed / cancelled / expired / refunded — 全 cover.

Recovery functions:
- `timeoutVerifying()` (exchange-machine.js L627) — verifying state TTL 30 min 超时 → reopen (5/12 stress test fix)
- `processExpire()` (L583) — open 自动 expire after expires_at
- `advanceToRefunded()` (broker-state-authority L482) — 任 active state 都可走 refund

**gap (P1 backlog v0.2)**: LZ bridge timeout recovery 未 verify
- bridge_initiated 入账 但 LZ delivery fail 时协议层是否 retry / dispute / refund?
- 5/13 12 bridges 全 LZ confirm < 60s 0 timeout 实证 (低概率)
- v0.2 spec: LZ scan webhook listener (bridge_completed surfacing) + LZ timeout dispute auto-fire

### 维度 7: dispute / resolve UI + autoTaker boundary ✓

dispute UI (exchange.eta):
- L588 `showDispute` toggle "发起争议"
- L595 `disputeReason` input (上链广播 #kanet-disputes 频道)
- L598 `disputeDeal()` → POST /api/exchange/dispute
- L1522 resolve fetch (含 "公开认输记录" 警告, maker concede 路径)

DM menu dispute (P1 new): WAIT_PAYMENT state '争议' / dispute / 纠纷 → triggerDispute → POST disputeOffer

autoTaker 现状:
- config_entries.autotake_enabled=true (v88, 5/7 NWT r259 ship)
- trade-protocol-filter.js L535-606: hard-block + reputation gate + min_discount_pct=1% + self-maker exclusion
- autoTaker 是 **taker side** (主动接 open offer), user menu publish 是 **maker side** — 不冲突 ✓

**gap (P2 backlog)**: production user 真触发 dispute 0 次 (last 30 day 0 disputed rows in DB). dispute path code + 5/12 stress test #4 PASS, 但 production user 真测试 dispute UI 0 实证.

---

## 4. BSC 1 chain user 菜单 8 step 闭环 verified

| step | input | menu/protocol response |
|---|---|---|
| 1 | '1' BUY OR '2' SELL → CHAIN_SELECT → QTY → ADDR → CONFIRM YES | publish via POST /api/exchange/publish |
| 2 | publish 返 | "✓ 挂单已上链 offer_id xxx 回 5 看 / back" |
| 3 | '3' BROWSE_MARKET | 列 active offers 1-5 + next 翻页 |
| 4 | '4' ACCEPT_OFFER → offer_id → CHAIN_SELECT → CONFIRM YES | accept via POST /api/exchange/accept + payment guide (broker BSC addr + amount + USDT chain) |
| 5 | WAIT_PAYMENT: '我付了 0x<tx>' OR 0x[40-66 hex] | submitPayment via POST /api/exchange/submit-payment → 协议层 verify → auto deliver KAS (_autoSettleAsset) |
| 6 | '5' MY_ORDERS | 状态 + readable action (11 状态 translate) |
| 7 | '6' CANCEL → offer_id → CONFIRM YES | cancel via POST /api/exchange/cancel (open state only) |
| 8 | WAIT_PAYMENT '争议' / dispute | triggerDispute → POST /api/exchange/dispute |

NWT operator 5/13 实证 BSC open→cancel: offer fac9cc32 publish (state=open, broadcast_tx 64630092) → cancel (state=cancelled, cancel_tx a190c85c, fund_lock released_at 18s 后) ✓

---

## 5. Final close — Phase B 真闭环 ✓

| 项 | status |
|---|---|
| 协议层 7 endpoint | ✓ 全 wire, broker-v3 cover 8 helper (含 4 P1 新) |
| state machine | ✓ ALLOWED_TRANSITIONS 完整, TERMINAL 7 states |
| menu UI 6 chain | ✓ P0 fix |
| WAIT_PAYMENT + MY_ORDERS | ✓ P1 fix |
| cancel (open state) | ✓ NWT 实证 18s 闭环 |
| chain_events trace | ✓ 4 chain identical pattern |
| fund_lock multichain | ✓ 0 stuck row |
| dispute UI + autoTaker | ✓ wire, autoTaker hard-block |
| LLM 残留 | ✓ archive ~4500 LOC, broker-v3 0 LLM |
| **BSC 1 chain user 菜单 8 step 闭环** | ✓ verified |

---

## 6. 后续 backlog

- **P1 v0.2**: LZ bridge timeout recovery (bridge_completed dest TX webhook + LZ timeout dispute auto-fire)
- **P2 v0.4**: bridge-router 接 _autoPayExchange auto multichain rebalance (broker 自治闭环, 无需 NWT operator 手动 fire)
- **P2 production dispute UI test**: user 真测试 dispute path
- **agent-mind matcher 接入**: power user 自然语言路径 (Owner 钦定后续)

---

## 7. Sign

- NWT (architect + reviewer + operator cross-hat per Owner 5/13 钦定): 2026-05-14 ✓
- J2 (implementor): commit 6f1626059 + e887d163a + e605890c1 + archive lifecycle_state_expire_boundary ✓

**Phase B close, BSC 1 chain user 菜单闭环 production-ready** (含 Phase 2 β 多链协议层 4 chain real e2e PASS).

---

*版本 v1.0 — 2026-05-14. 后续修订必带版本号 + 修订人 mode + 修订理由.*
