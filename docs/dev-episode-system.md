# Episode System — 开发者文档

## 概述

Episode 系统将离散的链上事件聚合为"对话故事线"——用户不再看一堆 txid 和 event_type，而是看到"与 Martin 的买入交易，已完成，+320 KAS"。

**验收标准**：用户打开 History tab，3 秒内能回答"今天和谁做了交易，结果怎样，有没有未完成的"。

## 架构

```
chain_events + mm_orders + execution_states + relation_states
                    ↓
            episode-builder.js（查询时聚合，不改底层表）
                    ↓
        GET /api/history/episodes          → episode 列表
        GET /api/history/episode-detail    → 单个 episode 详情（lazy-load）
                    ↓
            agent-v2.eta History tab
                    ↓
        四个内部 tab: 故事线 / 通讯录 / 会话 / 链上凭证
```

## 数据模型

### Episode（列表级）

```typescript
{
  episode_id: string,        // mm_orders.id（交易）或 'social-{txid前12位}'（社交）
  episode_type: 'trade' | 'social',
  counterparty_name: string | null,
  counterparty_addr: string,
  status: 'in_progress' | 'completed' | 'cancelled' | 'disputed',
  side: 'buy' | 'sell' | null,
  kas_amount: number | null,
  price: number | null,
  result_kas: number | null,  // 正=收入 负=支出 null=未结算
  started_at: string,
  ended_at: string | null,
  order_status: string | null,
  steps: Step[],
}
```

### Step（时间线步骤）

```typescript
{
  type: 'publish' | 'handshake' | 'payment' | 'verify' | 'transfer' | 'complete' | 'cancelled' | 'disputed' | 'negotiate',
  label: string,           // 人话描述："支付 0.40 USDT"
  detail: string,          // 补充："BNB 链 · TX 0xf428ef..."
  ts: string | null,       // ISO timestamp
  done: boolean,           // false = 等待中的下一步
  txhash?: string,         // 链上凭证（可选）
  reason?: string,         // Agent 决策理由（从 execution_states.display_summary）
  reasonSource?: string,   // 'agent' | 'owner' | 'system'
}
```

### Episode Detail（详情级，lazy-load）

```typescript
{
  profile: {
    displayName: string | null,
    address: string,
    trustLevel: string,        // 'owner' | 'recommended' | 'normal' | 'stranger' | 'blocked'
    relationStatus: string,    // 'active' | 'accepted' | 'observed' | 'none'
    tradeCount: number,
    disputeCount: number,
    disputeRate: number,       // 百分比，> 20% 红色告警
    totalVolume: number,       // KAS
    firstContact: string | null,
  },
  messages: [{
    sender: 'self' | 'peer',
    text: string,
    ts: string,
  }],
  evidence: [{
    txhash: string | null,
    type: string,              // 'payment' | 'transfer' | 'handshake' | 'conclusion'
    description: string,       // 人话
    status: 'confirmed' | 'pending' | 'missing' | 'failed' | 'success' | 'warning' | 'error' | 'neutral',
    ts: string | null,
  }],
}
```

## API

### GET /api/history/episodes

| 参数 | 必填 | 说明 |
|------|------|------|
| relay_node_id | 是 | Agent 的 relay 节点 ID |
| limit | 否 | 最多返回数（默认 30，最大 100） |
| status | 否 | 筛选：'active' / 'completed' / 'all'（默认 all） |

返回 Episode[] 数组，in_progress/disputed 排前面，按时间倒序。

### GET /api/history/episode-detail

| 参数 | 必填 | 说明 |
|------|------|------|
| relay_node_id | 是 | Agent 的 relay 节点 ID |
| order_id | 二选一 | 交易 episode 的订单 ID |
| peer_address | 二选一 | 社交 episode 的对手方地址 |

返回 `{ profile, messages, evidence }`。

## Episode 构建逻辑

### 交易 Episode（主源：mm_orders）

每个 mm_order 就是一个 episode。步骤从订单自身的时间戳字段构建：

| 字段 | → Step type |
|------|-------------|
| created_at | publish |
| accepted_at | handshake |
| paid_at | payment |
| verified_at | verify |
| delivered_at / completed_at + kas_txhash | transfer |
| completed_at (status=completed) | complete |
| completed_at (status=cancelled/expired) | cancelled |
| status=disputed/escalated | disputed |

**决策理由注入**：从 execution_states 表按 order_id + type 查 display_summary，映射：
- accept_order → handshake
- pay_usdt → payment
- verify_payment → verify
- send_kas → transfer
- publish_order → publish

### 社交 Episode（主源：chain_events handshake）

按 counterparty 聚合 handshake 事件 + 消息计数。跳过已有交易 episode 的 peer（避免重复）。

### 争议结论（自动生成）

在链上凭证 tab 底部，争议 episode 自动追加结论：
- 双方凭证完整 → 绿底"交易双方凭证均已验证"
- 己方有链上证明，对方缺失 → 黄底"你持有完整证明"
- 双方均无凭证 → 红底"需人工介入"

## 前端结构

每个 episode 卡片：

```
┌─────────────────────────────────────────────┐
│ [头像] 与 Martin 的买入交易  [已完成]  +320 KAS  ▼│  ← 始终可见
├─────────────────────────────────────────────┤
│ [故事线] [通讯录] [会话] [链上凭证]              │  ← 展开后的内 tab
├─────────────────────────────────────────────┤
│  ● 发布 发布买入 320 KAS           3分钟前     │
│  │  ┌─Agent 决策──────────────────┐          │
│  │  │ 价格低于均值5%，符合买入策略   │          │
│  │  └────────────────────────────┘          │
│  ● 连接 与 Martin 达成意向          2分钟前     │
│  ● 付款 支付 12.80 USDT            1分钟前     │
│  ● 转账 收到 320 KAS               刚刚       │
│  ✓ 完成 交易完成                              │
└─────────────────────────────────────────────┘
```

默认状态：
- in_progress / disputed → 展开
- completed / cancelled → 折叠

内 tab 默认显示"故事线"。通讯录/会话/凭证切换时 lazy-load（首次点击才请求 /episode-detail）。

## 文件清单

| 文件 | 作用 |
|------|------|
| `src/services/episode-builder.js` | 聚合逻辑：buildEpisodes() + getEpisodeDetail() |
| `src/api/conversations.js` | 路由注册：/api/history/episodes + /api/history/episode-detail |
| `src/ui/agent-v2.eta` | 前端渲染：History tab + 四个内 tab |
| `public/kanet-ui.js` | 工具函数：shortAddr / relativeTime / formatKas / copy |
| `src/ui/partials/styles.eta` | 设计系统 CSS：badge / card / status-dot / approval-card |
| `test/order-machine.test.mjs` | 30 个核心测试 |

## 已知限制

1. **reason 覆盖率**：只有经过 execution_states 的操作才有 reason。手动操作（owner 直接点 UI）没有 execution_states 记录，因此没有 reason。
2. **社交 episode 粒度粗**：目前按 counterparty 聚合所有 handshake，没有区分"多次独立会话"。
3. **消息内容可能是 JSON**：messages 表的 content_text 有时存 JSON（如 query_card），前端做了 JSON.parse fallback 取 label/summary。

## 未来方向

**Episode 反哺 Mind**（已记录为后续任务）：
- Memory Kernel 读 episode 作为 episodic memory 结构化输入
- Evolution Kernel 从 episode 历史提取模式
- Context Builder 用 episode 摘要替代零散 chain_events
- 从"会执行的工具"进化到"会学习的伙伴"
