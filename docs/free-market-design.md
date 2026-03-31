# 自由市场完整设计 v3 — 已实现

> 2026-03-25 设计稿 v3。Phase 0-5 全部实现并验证（3/25-3/27）。
> 3/27 追加：交易协议上链（trade-protocol-filter.js），链是源头 DB 是索引。
>
> 核心原则：**先把"出错时损失可控"设计好，再扩展自动化程度。**

---

## 一、现状（已有什么）

| 模块 | 状态 | 问题 |
|------|------|------|
| order-machine.js | 状态机完整（9状态+转换校验+对手方同步+超时） | mode 字段存了但没逻辑 |
| trading.js /action | 手动触发状态推进（accept/verify/pay/send_kas/cancel） | 无权限检查 |
| mm_orders 表 | 全字段就绪（mode/timeout/counterparty/timestamps） | 新旧状态名并存 |
| trading.eta UI | 能显示订单列表、接单、操作 | 只认旧状态名 |
| action-executor.mjs | 通信类 ACTION 完备 | 没有交易 ACTION |
| execution_states 表 | 表结构就绪 | 空表，无写入 |
| relation_states | **已接入** — 双路写入+catch-up 读取 | 稳定运行 |
| chain_events | **已接入** — ingest+discovery 写入 | 稳定运行 |

---

## 零、Phase 0 — 损失可控基础设施（在任何交易逻辑之前）

### 0.1 限额配置

```
trade_limits 配置（存 config_entries）：

per_order_max_kas:     1000    # 单笔最大 KAS 数量
per_order_max_usdt:    100     # 单笔最大 USDT 金额
daily_total_max_kas:   5000    # 单日累计 KAS
daily_total_max_usdt:  500     # 单日累计 USDT
auto_mode_max_kas:     200     # auto 模式单笔上限（比手动更严格）
auto_mode_max_usdt:    20      # auto 模式单笔 USDT 上限
```

**规则：**
- 手动模式受 per_order 限额
- auto 模式受 auto_mode 限额（更严格）
- 所有模式受 daily_total 限额
- **限额在 Phase 1 之前就写进数据库，代码层强制检查**
- 超限 → execution_states(rejected, error='limit_exceeded')

**硬约束（配置校验逻辑，写入时强制检查）：**
```
auto_mode_max_kas  <= per_order_max_kas  × 0.3
auto_mode_max_usdt <= per_order_max_usdt × 0.3
```
防止有人把 auto 限额调得比 per_order 还高。修改限额时校验，不符合就拒绝保存。

### 0.2 资金锁定机制

**问题**：同时接 3 个订单，每个"余额够"，一起执行 → 超支。

**解决**：

```sql
-- 新表：fund_locks — 资金锁定记录
fund_locks:
  id            TEXT PRIMARY KEY
  agent_address TEXT NOT NULL
  order_id      TEXT NOT NULL REFERENCES mm_orders(id)
  asset         TEXT NOT NULL       -- 'kas' / 'usdt_bnb' / 'usdt_eth' / 'usdt_tron'
  amount        REAL NOT NULL       -- 锁定金额
  status        TEXT NOT NULL       -- 'locked' / 'released' / 'spent'
  created_at    TEXT NOT NULL
  released_at   TEXT
  UNIQUE(order_id, asset)
```

**流程：**
```
接单时（accepted）：
  1. 查可用余额 = 钱包余额 - SUM(fund_locks WHERE status='locked')
  2. 可用余额 >= 需要金额？
     是 → 创建 fund_lock(locked) → 继续
     否 → 拒绝接单，execution_states(rejected, error='insufficient_available_balance')

付款完成时（paid/completed）：
  fund_lock.status = 'spent'

取消/过期时：
  fund_lock.status = 'released'
```

**每个订单唯一绑定资金 — A 订单的钱不会被 B 订单花掉。**

### 0.3 审批超时（分段设计）

```
approval_timeout 根据资金是否已流出，分两段：

pre_payment_timeout:  15min   # 付款前的审批超时
  → 还没花钱 → 直接 cancelled（无损取消）
  → fund_lock → released

post_payment_timeout: 60min   # 付款后的审批超时
  → 已经花了钱 → 转 disputed（有损，给足时间处理）
  → fund_lock 保持 locked

判断依据：order.status 是否已到达 paid 或之后的状态
  status in (published, accepted, paying) → pre_payment → 15min → cancelled
  status in (paid, verified, delivering)  → post_payment → 60min → disputed
```

### 0.4 Dispute 升级路径

```
disputed 状态的出口：

disputed → resolved    # 查实到账，手动标记完成 → 自动推进到 completed
disputed → cancelled   # 协商退款或放弃 → 双方订单取消
disputed → escalated   # 升级 — 见下方

升级机制（Agent-Agent 场景）：
  disputed 15min 后 → 自动触发双方 Agent 重新验证链上 TX
  disputed 30min 后 → 通知双方 Owner
  disputed 60min 后 → 冻结订单，等待人工介入

人-Agent 场景：
  disputed → 立即通知 Owner（因为有人在盯着）
```

### 0.5 确认数阈值

```
verification_confirmations 配置：

bnb:   15 blocks  (~45 seconds)   — 自动验证 ✓
eth:   12 blocks  (~2.5 minutes)  — 自动验证 ✓
tron:  19 blocks  (~57 seconds)   — 自动验证 ✓ (2026-03-27 实现)
sol:   32 slots   (~13 seconds)   — 自动验证 ✓ (2026-03-27 实现)
kas:   10 blocks  (~1 second)
```

**verify_payment 必须等确认数达标后才推进，不能只看 TxHash 存在。**
防范：假充值、链回滚、双花攻击。

---

## 二、交易状态机（继承 + 修正）

```
published → accepted → paying → paid → verified → delivering → completed
                                                              ↘ disputed → resolved / cancelled / escalated
任何非终态 → cancelled / expired
```

### paying / paid / verified 状态定义（2026-03-27 对齐实现）

```
accepted → paying:   TX 广播成功（有 txhash），开始链上确认
paying → paid:       TX 已入链（RPC 返回成功），但确认数可能未达标
paid → verified:     确认数达标 + 金额校验通过（自动 60s 后验证）
paying → accepted:   TX 失败/回滚 → 回退重试
```

> **注意**：`paid` 在实现中表示"TX 已入链"，不等同于"确认数达标"。
> 真正的确认数校验在 `verified` 阶段完成（verify_payment 动作）。
> 三阶段确保安全：paying(广播) → paid(入链) → verified(确认达标+金额匹配)。

paying 对应 execution_states.status = 'executing'。
paid 对应 execution_states.status = 'completed'（付款执行完成）。
verified 对应独立的 verify_payment execution（验证执行完成）。

| 状态 | 谁负责 | 含义 | fund_lock |
|------|--------|------|-----------|
| published | 卖方 | 订单发布到市场 | 卖方锁定 KAS |
| accepted | 买方 | 买方接受，双方锁定 | 买方锁定 USDT |
| paying | 买方 | 付款 TX 已广播，等确认 | - |
| paid | 系统 | TX 确认数达标 | - |
| verified | 卖方 | 卖方确认收到付款 | - |
| delivering | 卖方 | KAS TX 已广播，等确认 | - |
| completed | 系统 | 双方交割完成 | 双方 fund_lock → spent |
| disputed | 任一方 | 争议 | fund_lock 保持 locked |
| cancelled | 任一方 | 主动取消 | fund_lock → released |
| expired | 系统 | 超时取消 | fund_lock → released |

---

## 三、三模式设计

**核心原则：mode 只决定 execution_states 的 pending→approved 由谁推。状态机逻辑不变。**

### 3.1 execution_states 在每个转换中的角色

```
花钱操作的标准流程：
  1. 检查限额（per_order + daily_total + auto_mode）
  2. 检查可用余额（钱包余额 - 已锁定）
  3. 锁定资金（fund_locks）
  4. 创建 execution_states（status=pending）
  5. 模式判断：
     - auto:     pending → approved → executing → completed/failed
     - approval: pending → 停住，等 owner 确认（最长 approval_timeout 分钟）
     - manual:   不创建 execution_states，人直接操作 UI
  6. 执行具体动作
  7. 更新 mm_orders 状态
  8. 记录 output_txid + chain_events
  9. 完成/失败 → 更新 fund_lock
```

### 3.2 Peer 校验（修复抢单漏洞）

```
accept_order 的额外校验：

1. 消息来源地址 == 消息内声明的 peer 地址？
   → 防止伪造 sender
2. 订单是否已被其他人 accepted？
   → published 状态才能接，其他状态拒绝
3. 如果订单指定了 peer_address（定向交易），消息来源必须匹配
   → 防止第三方抢单
4. 签名验证（Kasia 协议级别，Relay 已保证）
   → 消息经过 ECDH 解密，来源可信
```

### 3.3 每个状态转换的具体行为

#### published → accepted（接单）

| 模式 | 触发者 | 流程 |
|------|--------|------|
| auto | Agent 收到 kanet_accept_v1 消息 | 校验 peer → 检查限额 → 锁定资金 → execution_states(pending→approved) → 创建对手订单 → 链接双方 |
| approval | Agent 收到接单消息 | 校验 peer → 检查限额 → 锁定资金 → execution_states(pending) → UI 显示"有人接单，确认？" → owner 确认 → 执行 |
| manual | Owner 在 UI 点"接受" | 校验 peer → 检查限额 → 锁定资金 → 直接执行 |

#### accepted → paying → paid（付款）

| 模式 | 触发者 | 流程 |
|------|--------|------|
| auto | 系统（接单后自动） | 检查限额 → 检查可用余额 → execution_states(pending→approved→executing) → 签名发送 → paying(txhash) → 等确认 → paid |
| approval | 系统准备好付款 | execution_states(pending) → UI 显示金额/地址/Gas → owner 确认 → 发送 |
| manual | Owner 在 UI 点"付款" | 直接执行 |

**失败处理：**
- 余额不足 → execution_states(rejected) → 不推进，通知 owner
- TX 广播失败 → execution_states(failed) → paying 回退到 accepted → 可重试
- TX 广播成功但确认失败（回滚）→ paying 回退到 accepted → 记录错误

#### paid → verified（验证收款）

| 模式 | 触发者 | 流程 |
|------|--------|------|
| auto | cross_chain_verify 技能 | 查链 → 确认数 >= 阈值 → 金额匹配？ → execution_states(completed) → verified |
| approval | 系统检测到到账 | UI 显示"检测到 X USDT 到账（Y 确认），确认？" → owner 确认 |
| manual | Owner 查链后点"确认收款" | 直接推进 |

**金额校验：**
- 实际到账 >= 订单金额 × 0.995（允许 0.5% 误差，覆盖链上手续费）
- 实际到账 < 订单金额 × 0.995 → 不推进，→ disputed(reason='underpayment')
- 到账地址不对 → 不推进，→ disputed

**确认数校验：**
- BSC >= 15 blocks, ETH >= 12, TRON >= 19
- 未达标 → 等待，超时后通知 owner

#### verified → delivering → completed（发 KAS）

| 模式 | 触发者 | 流程 |
|------|--------|------|
| auto | 系统（验证后自动） | execution_states(pending→approved→executing) → Relay 发送 KAS → delivering → 确认 → completed |
| approval | 系统准备好 | UI 显示"将发送 X KAS 到 Y 地址，确认？" → owner 确认 → 发送 |
| manual | Owner 点"发送 KAS" | 直接执行 |

**失败处理：**
- KAS 余额不足（fund_lock 应该已锁定，理论上不会发生）→ 检查 fund_lock 完整性
- UTXO 不够 → 自动拆分后重试
- Relay 不在线 → 等待重试，超时 → disputed

---

## 四、execution_states 字段设计

```sql
execution_states（已有表结构，确认字段用法）:
  id               -- UUID
  intent_id        -- 关联 Mind 意图（proactive/reactive 触发时填，手动操作为 null）
  type             -- 动作类型（见下表）
  source           -- 触发来源：owner / peer / agent / system
  agent_address    -- 哪个 Agent
  permission_level -- 这个 type 需要的权限：owner / connected / public
  status           -- pending / approved / executing / completed / failed / rejected
  input_txid       -- 触发这个动作的链上事件
  output_txid      -- 执行结果的链上事件
  error_text       -- 失败/拒绝原因
  created_at
  updated_at

-- 需要新增字段（migrate v29）:
  order_id         -- 关联 mm_orders.id（花钱操作必填）
  amount           -- 涉及金额
  asset            -- 涉及资产类型 (kas / usdt_bnb / usdt_eth)
  approval_timeout -- 审批超时分钟数（默认 15）
```

### 动作类型表

| type | 含义 | permission_level | auto 模式 | approval 模式 |
|------|------|-----------------|-----------|---------------|
| accept_order | 接受市场订单 | owner | 自动执行 | 等确认 |
| pay_usdt | 发送跨链 USDT 付款 | owner | 自动执行（受 auto 限额） | 等确认 |
| verify_payment | 确认收到付款 | owner | 自动查链确认 | 等确认 |
| send_kas | 发送 KAS | owner | 自动执行（受 auto 限额） | 等确认 |
| cancel_order | 取消订单 | owner | owner/system | owner/system |
| publish_order | 发布新订单 | owner | Agent 可发布 | 等确认 |

### 权限校验规则

```
if source == 'owner':
  → 总是允许（owner 是最终权力）

if source == 'peer':
  → accept_order: 允许，但必须通过 peer 校验（地址匹配+订单状态）
  → 其他: 拒绝

if source == 'agent':
  → 检查 mode:
     auto:     检查 auto_mode 限额 → 允许
     approval: 创建 pending → 等 owner 确认（pre_payment: 15min→cancelled / post_payment: 60min→disputed）
     manual:   拒绝（manual 模式 Agent 不自主操作）

if source == 'system':
  → verify_payment: 允许（自动查链）
  → cancel_order(超时): 允许
  → 其他: 拒绝
```

---

## 五、异常场景完整清单

| 场景 | 检测方式 | 处理 | fund_lock |
|------|---------|------|-----------|
| 付款后对方消失 | timeout 超时 | → disputed(非 expired) → 保护已付款方 | 保持 locked |
| 付了但金额不对 | verify 金额校验 | → disputed(underpayment/overpayment) | 保持 locked |
| 付了但地址错 | verify 查不到 TX | → disputed(address_mismatch) | 保持 locked |
| 链拥堵（TX 长时间 pending） | 周期查 TX 状态 | 等待，超时后 → disputed | 保持 locked |
| 余额不足（并发超支） | fund_lock 检查 | 拒绝接单/付款 | 不创建 |
| Gas 不够 | 发送报错 | execution_states(failed) → 回退 | 保持 locked |
| Relay 不在线 | 连接失败 | 等待重连重试，超时 → disputed | 保持 locked |
| 伪造 txhash | verify 查链 | 查不到/金额不匹配 → 不推进 | - |
| 双方同时操作 | 状态机幂等 | 先到先生效 | - |
| 重复付款 | execution_states 查重 | 同 order 最近一次未失败 → 拒绝 | - |
| 审批超时 — 付款前 | pre_payment_timeout (15min) | → cancelled（无损） | released |
| 审批超时 — 付款后 | post_payment_timeout (60min) | → disputed（有损，给足时间） | 保持 locked |
| 链回滚（TX 被撤回） | 确认数降到 0 | → disputed(chain_reorg) | 保持 locked |
| 恶意第三方抢单 | peer 地址校验 | 地址不匹配 → rejected | - |

**关键修正**：已付款后的超时/异常 → disputed（不是 expired）。expired 只用于"双方都没付任何东西"的场景。

---

## 六、UI 设计（一页闭环）

### 6.1 交易室布局

```
┌──────────────────────────────────────────────────────────┐
│ 交易室 — Martin                           [模式: 审批 ▾]  │
├──────────────┬───────────────────────────────────────────┤
│ 市场订单      │  当前交易                                  │
│              │                                           │
│ [买] 500 KAS │  状态流水线：                               │
│   $0.085     │  ✓ published → ✓ accepted → ● paying      │
│   BNB链      │                                           │
│   Sophie 发布 │  付款进度：                                │
│   5min 前     │  TX: 0xabc...def                          │
│              │  确认: 8/15 blocks (预计 ~20s)              │
│ [卖] 200 KAS │                                           │
│   $0.086     │  ┌──────────────────────────────────────┐ │
│   BNB链      │  │ ⏳ 等待链上确认（8/15）                │ │
│   3min 前     │  │ 达标后自动推进到 paid                  │ │
│              │  └──────────────────────────────────────┘ │
│              │                                           │
│ ──历史──     │  执行日志：                                │
│ ✓ 完成 3笔   │  12:03 accept_order ✓                     │
│ ✗ 取消 1笔   │  12:03 fund_lock: 42.5 USDT locked       │
│              │  12:04 pay_usdt ✓ → TX: 0xabc...          │
│              │  12:04 等待确认... (8/15)                  │
├──────────────┴───────────────────────────────────────────┤
│ 可用: 1,234.5 KAS | 7.7 USDT (已锁定: 42.5) | 0.01 BNB  │
└──────────────────────────────────────────────────────────┘
```

**注意**：钱包栏明确显示"已锁定"金额，用户知道为什么"余额不够了"。

### 6.2 审批卡片（修正：去掉"稍后再说"）

```
┌──────────────────────────────────────┐
│ ⏳ 等待确认（剩余 12:30 / 付款前15min） │
│                                      │
│ Agent 建议：发送 42.5 USDT 到         │
│ 0x742d...8f2a (BNB Chain)            │
│                                      │
│ 原因：接受了 Sophie 的 500 KAS 卖单   │
│ 可用余额：7.7 USDT（锁定 42.5）       │
│ 预计 Gas：0.0005 BNB                 │
│                                      │
│ [确认执行]  [拒绝并取消订单]           │
│                                      │
│ ⚠ 超时后自动转为争议状态               │
└──────────────────────────────────────┘
```

**修正**：
- 去掉"稍后再说" → 只有"确认"和"拒绝"
- 显示倒计时（approval_timeout）
- 超时 → disputed（不是 expired）→ 保护对方

---

## 七、新增数据结构（Phase 0 迁移）

```sql
-- migrate v29

-- 1. fund_locks 表
CREATE TABLE fund_locks (
  id            TEXT PRIMARY KEY,
  agent_address TEXT NOT NULL,
  order_id      TEXT NOT NULL REFERENCES mm_orders(id),
  asset         TEXT NOT NULL,
  amount        REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'locked',
  created_at    TEXT NOT NULL,
  released_at   TEXT,
  UNIQUE(order_id, asset)
);
CREATE INDEX idx_fund_locks_agent ON fund_locks(agent_address, status);

-- 2. execution_states 新增字段
ALTER TABLE execution_states ADD COLUMN order_id TEXT;
ALTER TABLE execution_states ADD COLUMN amount REAL;
ALTER TABLE execution_states ADD COLUMN asset TEXT;
ALTER TABLE execution_states ADD COLUMN approval_timeout INTEGER DEFAULT 15;

-- 3. trade_limits 配置（写入 config_entries）
INSERT OR IGNORE INTO config_entries (id, key, category, value_encrypted, is_sensitive, created_at, updated_at)
VALUES
  (hex(randomblob(16)), 'per_order_max_kas', 'trade_limits', '1000', 0, datetime('now'), datetime('now')),
  (hex(randomblob(16)), 'per_order_max_usdt', 'trade_limits', '100', 0, datetime('now'), datetime('now')),
  (hex(randomblob(16)), 'daily_total_max_kas', 'trade_limits', '5000', 0, datetime('now'), datetime('now')),
  (hex(randomblob(16)), 'daily_total_max_usdt', 'trade_limits', '500', 0, datetime('now'), datetime('now')),
  (hex(randomblob(16)), 'auto_mode_max_kas', 'trade_limits', '200', 0, datetime('now'), datetime('now')),
  (hex(randomblob(16)), 'auto_mode_max_usdt', 'trade_limits', '20', 0, datetime('now'), datetime('now')),
  (hex(randomblob(16)), 'pre_payment_timeout_minutes', 'trade_limits', '15', 0, datetime('now'), datetime('now')),
  (hex(randomblob(16)), 'post_payment_timeout_minutes', 'trade_limits', '60', 0, datetime('now'), datetime('now'));

-- 4. verification_confirmations 配置
INSERT OR IGNORE INTO config_entries (id, key, category, value_encrypted, is_sensitive, created_at, updated_at)
VALUES
  (hex(randomblob(16)), 'verify_confirmations_bnb', 'trade_verify', '15', 0, datetime('now'), datetime('now')),
  (hex(randomblob(16)), 'verify_confirmations_eth', 'trade_verify', '12', 0, datetime('now'), datetime('now')),
  (hex(randomblob(16)), 'verify_confirmations_tron', 'trade_verify', '19', 0, datetime('now'), datetime('now'));
```

---

## 八、实现步骤（全部完成 3/25-3/27）

### ✅ Phase 0：损失可控基础设施 + 旧债清理（3/25 完成）
- 旧状态一次性迁移 + migrate v29 + fund-lock.js + trade-limits.js + UI 统一
- 测试：并发超支拒绝 ✓ / 超限拒绝 ✓ / auto<=30% ✓

### ✅ Phase 1：execution_states 基础层（3/25 完成）
- execution-state.js + order-machine 联动 + trading.js 5 个 action 写 execution_states
- 测试：HTTP 全流程 publish→accept→verify→cancel ✓

### ✅ Phase 2：权限闸门（3/26 完成，22 项测试全通过）
- trade-action.js peer 校验 + source/mode/limits 检查
- 真链交易验证 ✓

### ✅ Phase 3：auto 模式（3/26 完成）
- order-machine.js _autoAdvance hook + mm-otc.mjs 协议消息识别
- 全自动真链跑通：accept→pay(2s)→verify(60s)→send_kas(2s)→completed ✓

### ✅ Phase 4：approval 模式（3/26 完成）
- pending execution_state + UI 审批卡片 + approve 后异步执行
- accept→pending→owner确认→执行→paid ✓

### ✅ Phase 5：dispute 路径 + 交易协议上链（3/26-3/27 完成）
- dispute 升级（15/30/60min）+ escalated 状态
- **trade-protocol-filter.js** 7 种协议消息处理器
- market.eta 链上广播 + trading.js 付款/交割广播 + 超时问责上链
- 33 项安全底线测试全通过 ✓

---

## 九、安全底线（不可妥协）

1. **限额先于逻辑** — Phase 0 的限额检查在 Phase 1 的交易逻辑之前
2. **资金先锁后用** — 没有 fund_lock 就不能执行花钱操作
3. **每笔操作经 execution_states** — 没有绕过的路
4. **确认数必须达标** — verify_payment 阶段强制校验确认数（paying→paid→verified 三阶段）
5. **已付款后不能 expired** — 只能 disputed → 保护付款方
6. **disputed 必须有出口** — resolved / cancelled / escalated
7. **每笔 TX 入 chain_events** — 不管成功失败
8. **auto 模式限额 <= 手动限额 × 30%** — 机器犯错的后果要控制在小范围，配置校验强制执行
9. **审批超时分段** — 付款前 15min→cancelled（无损），付款后 60min→disputed（有损但给足时间）
10. **旧状态在 Phase 0 清理** — 不留技术债到后面

---

## 十、远期：Kaspa 脚本 + 有条件支付

测试网已验证 Kaspa 脚本可实现有条件支付（HTLC 类似物）。成熟后：

- **KAS 侧锁定**：原生链上锁定，不需要 fund_locks 表
- **原子交换可能性**：KAS ↔ USDT 的跨链原子交换
- **跨链 USDT 锁定**：仍需智能合约或托管方案（EVM 侧 HTLC）
- **Agent 可能的方案**：Agent 作为信任中间层，用自身信誉担保交易完成

当前设计的 fund_locks 是"软锁定"（数据库层面），Kaspa 脚本成熟后可升级为"硬锁定"（链上层面）。**设计兼容，迁移不痛苦。**

---

## 十一、交易协议上链（3/27 追加实现）

交易全生命周期已通过 Kasia bcast 广播上链。详见 `docs/trade-protocol-on-chain-design.md`。

核心文件：`kasia-console/src/services/trade-protocol-filter.js`
开发者文档：`docs/dev-trading.md` "On-Chain Protocol" 章节
