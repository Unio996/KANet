# State Machines

**Version**: v0.3
**Last Updated**: 2026-05-01
**Owner**: NWT (architect mode)
**Status**: 🟢 active spec

---

## Revision History

- **v0.1** (2026-04-30): Ship A 起草 — 7 state, 9 transition, broker state machine 设计核心
- **v0.2** (2026-04-30): Ship A 期间 4 处补漏 (intermediate state 明文 / Baseline 三段化 / SA-5a 拆分 / runner 路径修正), column-before-transition pattern sediment
- **v0.3** (2026-05-01): **基于 PZ-MATCHER-audit-2 prod 数据修订** — 扩 9 state (含 confirming + refunding 真 prod state), 修订 transition 表, 提出 SA-6 runtime invariant 升级要求

---

## v0.3 修订动因 (audit-driven, 不是 architect 凭空设计)

PZ-MATCHER-audit-2 report A4.1 数据揭示:

```
state            count   in v0.2 spec?
────────────────────────────────────
expired          4050    ✓
confirming       1708    ✗ (spec 漏)
failed           1268    ✓
awaiting_payment 528     ✓
refunded         107     ✓
aligning         20      ✓
refunding        16      ✗ (spec 漏)
completed        1       ✓
```

**1724 row 处于 v0.2 spec 不 cover 的 state**. 这不是 prod bug —— prod 代码真的在写这两个 state. 是 v0.2 spec 不完整.

v0.2 → v0.3 的核心修订: **acknowledge prod 现实, 让 spec 真覆盖完整状态机, 而不是把 prod 数据迁移到不完整 spec**.

这条决策遵循 Owner 钦定 "现在状态机不够单一, 我们就让他单一" 原则 — 单一不等于"7 state"也不等于"9 state", 单一等于 "spec 真覆盖 prod, 不分裂".

---

## 9 状态枚举

| state | 类型 | 终态? | 语义 |
|---|---|---|---|
| `aligning` | active | ✗ | matcher 正在跟 user 对话, 撮合中, 未发布 offer |
| `awaiting_payment` | active | ✗ | offer 已发布到 /exchange, 等 user 付款 |
| `confirming` | active | ✗ | user 付款 TX 已上链 (pay_tx_hash 写入), 等链上确认数达标 |
| `paid` | active | ✗ | 跨链确认数达标, 准备发 KAS 给 user |
| `refunding` | active | ✗ | 退款 TX 已发 (refund_tx_hash 写入), 等 Kaspa 链确认 |
| `completed` | terminal | ✓ | KAS 已发给 user, 撮合成功 |
| `refunded` | terminal | ✓ | 退款已确认到账, 撮合主动取消 |
| `failed` | terminal | ✓ | 撮合失败 (系统错误 / 链上异常 / 等) |
| `expired` | terminal | ✓ | 撮合超时 (user 未付 / aligning 阶段超时 30min) |

**5 active + 4 terminal = 9 state 完整.**

> **语义校验提醒** (J2 实施前必跑):
> 上面 `confirming` / `refunding` 的语义是基于 audit-2 数据 + DEVELOPER-GUIDE.md 第四章"确认数达标 (BNB ≥15, ETH ≥12, SOL ≥32, TRON ≥19)" 交叉推断. 实施 v0.3 前 J2 必 grep 代码验证:
> ```bash
> grep -rn "'confirming'\|\"confirming\"" kasia-console/src/ --include="*.js"
> grep -rn "'refunding'\|\"refunding\"" kasia-console/src/ --include="*.js"
> ```
> 看每个写入点 caller 的真实含义. 如果跟此 spec 描述不一致, 优先以**代码现实**为准, 修 spec 不修代码.

---

## 转换表 (13 合法 transitions)

```
                        ┌──────────────────┐
                        │     aligning     │  matcher 对话, 未发布
                        └────────┬─────────┘
                                 │ publish (无 chain TX)
                                 ▼
                        ┌──────────────────┐
                  ┌─────│awaiting_payment  │  offer 在 /exchange
                  │     └────────┬─────────┘
                  │              │ user_paid (pay_tx_hash 写)
                  │              ▼
                  │     ┌──────────────────┐
                  │     │   confirming     │  等链上确认数
                  │     └────────┬─────────┘
                  │              │ tx_confirmed
                  │              ▼
                  │     ┌──────────────────┐
                  │     │      paid        │  确认达标
                  │     └────────┬─────────┘
                  │              │ deliver (deliver_tx_hash)
                  │              ▼
                  │     ┌──────────────────┐
                  │     │    completed     │  ✓ 终态
                  │     └──────────────────┘
                  │
                  │ cancel/timeout (refund_tx_hash)
                  ▼
              ┌──────────────────┐
              │   refunding      │  退款已发, 等确认
              └────────┬─────────┘
                       │ refund_confirmed
                       ▼
              ┌──────────────────┐
              │    refunded      │  ✓ 终态
              └──────────────────┘

      aligning ──── timeout ───→ expired (终态)
      任何 active ── error ───→ failed (终态)
```

完整 transition 表:

| # | from | to | trigger | chain TX | 写哪个字段 |
|---|---|---|---|---|---|
| 1 | aligning | awaiting_payment | publish_offer | forbidden | exchange_offer_id |
| 2 | aligning | expired | timeout (30min) | forbidden | error_reason |
| 3 | aligning | failed | system_error | forbidden | error_reason |
| 4 | awaiting_payment | confirming | user_paid | required | pay_tx_hash |
| 5 | awaiting_payment | refunding | cancel_user | required | refund_tx_hash |
| 6 | awaiting_payment | expired | timeout | forbidden | error_reason |
| 7 | awaiting_payment | failed | system_error | forbidden | error_reason |
| 8 | confirming | paid | tx_confirmed | required (verify_only) | (no new field) |
| 9 | confirming | refunding | underpayment / chain_anomaly | required | refund_tx_hash |
| 10 | confirming | failed | verify_failed | forbidden | error_reason |
| 11 | paid | completed | kas_delivered | required | deliver_tx_hash |
| 12 | paid | failed | delivery_failed | forbidden | error_reason |
| 13 | refunding | refunded | refund_confirmed | required (verify_only) | (no new field) |

**任何不在表中的 transition = illegal = throw + lint hard fail.**

---

## v0.2 → v0.3 transition 表对比

```
v0.2 (9 transition):                    v0.3 (13 transition):
─────────────────────                   ─────────────────────
1. aligning → awaiting_payment          1. ✓ 同
2. aligning → expired                   2. ✓ 同
3. aligning → failed                    3. ✓ 同
4. awaiting_payment → paid              ✗ 拆成 4 + 8 (经 confirming)
5. awaiting_payment → refunded          ✗ 拆成 5 + 13 (经 refunding)
6. awaiting_payment → expired           6. ✓ 同
7. awaiting_payment → failed            7. ✓ 同
8. paid → completed                     11. ✓ 同 (重编号)
9. paid → failed                        12. ✓ 同 (重编号)

v0.3 新加:
4. awaiting_payment → confirming   (跨链 verify 中间态)
5. awaiting_payment → refunding    (退款 verify 中间态)
8. confirming → paid               (确认数达标)
9. confirming → refunding          (确认中检出 underpayment)
10. confirming → failed             (verify 异常)
13. refunding → refunded            (退款 confirm)
```

**核心变化**: v0.2 把 `awaiting_payment → paid` 当一步完成, v0.3 acknowledge 这一步在 prod 真有"等链上确认"的中间态. 同样 refund 也有中间态.

这跟 KANet "链上为真相 + NO TX NO STATE CHANGE" 哲学一致 —— 链上确认不是即时事件, 状态机必须 acknowledge 这个时间窗口.

---

## column-before-transition pattern (v0.2 sediment, v0.3 保留)

当业务 column 写入与 state transition 同时发生时, **column 写必须先于 transition()**.

理由: transition() 推到新 state 后, 原 state 的 CAS 保护失效, 下一个 caller 可能立即 advance, 留下 column 永久未写.

适用场景示例 (v0.3):
- transition #1 (publish): exchange_offer_id 写, 然后 transition()
- transition #4 (user_paid): pay_tx_hash 写, 然后 transition()
- transition #5/9 (退款): refund_tx_hash 写, 然后 transition()
- transition #11 (deliver): deliver_tx_hash 写, 然后 transition()

**Anti-pattern**: transition() 后写 column → race window 暴露.

---

## helper 接口签名 (v0.3 不变, 仍是 v0.2 接口)

```js
// kasia-console/src/services/broker-state-machine.js (Ship A 落地)

function transition({ orderId, expectedFromState, toState, opts }) {
  // 1. 查 ALLOWED_TRANSITIONS[`${expectedFromState}→${toState}`]
  // 2. SQL UPDATE SET state = toState WHERE id = orderId AND state = expectedFromState
  // 3. INSERT chain_events
  // 4. CAS race protection — UPDATE 0 row 时 throw
}

function getOrderState(orderId) { ... }
function findActiveOrder(peerAddr) { ... }   // ⚠ Ship B B-3 升级 throw MultiActiveOrderError
function reconcileStaleOrders() { ... }
```

**v0.3 接口不变**, 但 ALLOWED_TRANSITIONS 表数据从 9 → 13 行. 这是数据变化, 不是 API 变化.

---

## 升级路径 (v0.2 → v0.3 migration)

**v0.3 不需要 prod 数据迁移**. 1708 confirming + 16 refunding row 已经在 prod, v0.3 只是 acknowledge 它们合法.

实施工作:

### Step 1: 修订 broker-state-machine.js 的 ALLOWED_TRANSITIONS 表
从 9 行扩到 13 行 (add 4 + 8 + 9 + 10 + 13, 删 v0.2 的 4 + 5).

### Step 2: 修订 STATES 集合
从 7 → 9 (加 confirming + refunding).

### Step 3: 修订 TX_REQUIRED 表
从 9 行扩到 13 行, 标 verify_only 模式 (transition 8 + 13 — chain TX 已存在, 仅 verify, 不再 fire).

### Step 4: 升级 SA-6 runtime invariant
新加 invariant_5:
```sql
SELECT state, COUNT(*) FROM retail_dex_orders
WHERE state NOT IN ('aligning','awaiting_payment','confirming','paid','refunding',
                    'completed','refunded','failed','expired')
GROUP BY state;
-- 期望: 0 row
```

跑这条 invariant 在 v0.2 spec 下会 fail 1724 次, 在 v0.3 spec 下应 pass. 这本身就是 **invariant 系统真正起作用的证据** — spec 不完整时 invariant 抓出来, spec 修订后 invariant 守住新边界.

### Step 5: 修订 docs/STATE-MACHINES.md (本文档)
v0.3 起草完成 = step 5 完成.

### Step 6: 修订 PZ-STATE-MACHINE-shipA.md v1.4
任务卡里所有"7 state" / "9 transition" / "STATES = {...}" 引用更新.

### Step 7: 修订 INVARIANTS.md (待起草)
状态机相关 invariant 反映 v0.3.

实施 ETA: ~30min (纯 spec + 代码 const 修订, 无业务逻辑改动).

---

## v0.3 简化决策 (沿袭 v0.2, 7 条)

| # | 决策 | owner | due |
|---|---|---|---|
| 1 | ❌ 不做 outbox pattern | NWT | phase Y+2 |
| 2 | ❌ 不做 SQL trigger | J2 | phase Z 同期 |
| 3 | ❌ 不做 lint 绕过严格 | NWT | phase Z+1 |
| 4 | ❌ 不做 disputed state | NWT | phase Y+2 OR 第一笔 paid→delivery 失败 |
| 5 | ❌ 不做 cross-user fallback | J2/J1 | (50 KAS misroute Ship B B-1) |
| 6 | ❌ 不做 multi-asset | Owner | phase 2 OR 第一笔 USDC/USDT BUY 撞 |
| 7 | ❌ 不做 partial fill state | J2 | 第一笔 multi-taker partial fill |

v0.3 新加决策:

| 8 | ❌ 不做 sub-state (例如 confirming-1 / confirming-2 区分链) | NWT | 如有需要, 用 chain_id 字段, 不扩 state |

理由: state 集合扩大有边际成本 (anti-spam / lint / invariant 都要跟着扩). chain 信息属于 row 数据, 不属于 state.

---

## v0.3 之后的 sediment 价值

v0.3 的真正贡献不只是 "+2 state":

1. **Spec 跟 prod 数据闭环验证机制建立** — audit-2 是第一次系统性"用 prod 数据反向验证 spec", 抓到脱节. 这条流程应固化:
   - 每次 ship 完后跑 audit, 看 spec 是否仍 cover prod
   - INVARIANTS.md 加一条: `runtime_invariant: spec.STATES ⊇ prod.SELECT DISTINCT state`

2. **Ship A meta-finding 的工程化结尾** — Ship A 期间 SA-6 抓 10 historical multi-active, 指向 "broker 反复修水龙头是因为没架构 owner". v0.3 是这条洞察的另一个验证 — spec 不完整也是"没 owner"的另一种表现 (有 owner 就该早抓 confirming/refunding).

3. **Matcher v0.1 design 的真前提** — matcher 必须基于完整 9 state 设计, 不能基于 v0.2 的 7 state. matcher 不写 confirming/refunding 处理 = matcher 上线后会撞 1724 row (历史数据继续累积 + 新数据持续产生).

---

*v0.3 — 2026-05-01 NWT (architect mode). audit-driven 修订, 不基于 architect 凭空想象. v0.4 后续触发: 第一笔 disputed / multi-asset / partial fill 真撞.*
