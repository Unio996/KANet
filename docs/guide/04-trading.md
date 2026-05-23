## 四、交易系统

### 状态机（order-machine.js）

```
published → accepted → paying → paid → verified → delivering → completed
                                                               ↓
                                           disputed → escalated
         ← (回退)←─────────────────────────────────┘
```

POST_PAYMENT_STATUSES (paid/verified/delivering/completed/disputed/escalated): 不能 expired/cancelled。

### 三模式

| 模式 | 行为 |
|------|------|
| auto | accepted 后 2s 自动推进（受限额约束：per_order 1000 KAS, daily 5000 KAS, auto 200 KAS） |
| approval | 生成 pending execution_state，等 owner 确认 |
| manual | 不自动推进 |

### 链上协议（trade-protocol-filter.js）

7 种协议消息：kanet_sell/buy/accept/paid/delivered/timeout/cancel_v1
每笔操作写 chain_events + execution_states。问责上链。

### 安全底线

- 资金先锁后用（fund_locks 表）
- 每笔操作经 execution_states
- 确认数达标（BNB≥15, ETH≥12, SOL≥32, TRON≥19）
- 已付款后不能 expired（只能 → disputed）
- auto 限额 ≤ 30% of manual
- auto-advance 断路器：1h 内 ≥3 次 payment_failed → 停止

---

