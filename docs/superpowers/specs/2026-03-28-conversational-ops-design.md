# KANet 对话式操作（Conversational Ops）设计规范

> 2026-03-28 头脑风暴定稿。用户通过对话框即可查询链上数据、Agent 状态、交易所情况，执行转账挂单等操作。

## 核心原则

| # | 决策 | 结论 |
|---|------|------|
| 1 | 架构 | 规则层取数据 → Brain 解读 → 合并返回 |
| 2 | 分工 | 规则层 = 数据供应商，Brain = 解读者 |
| 3 | 格式 | `dimensions===1` → 一行精确值；`>1` → 卡片+解读；`noData` → Brain 纯文本 |
| 4 | 位置 | Mind 层（Agent 的能力，不是 Console 的能力）|
| 5 | 注入 | 替换 task 指令（`buildQueryTask`），不是附加 context |

**为什么不纯 Brain（方案A）：** Brain 是 LLM，天生不确定。查余额不应有不确定性。
**为什么不纯规则（方案B）：** "帮我看看值不值得卖"规则匹配不了，必须 Brain。
**为什么混合（方案C）：** 有唯一正确答案 → 规则层。需要推理判断 → Brain。串联而非二选一。

## 架构流程

```
用户/Agent 输入
  ↓
权限检查（relation_states）
  ├── owner   → 全部权限（查询 + 执行）
  ├── trusted → 仅查询，执行类静默丢弃（不返回错误，避免探测）
  ├── stranger → 仅公开数据
  └── blocked → 不响应
  ↓
parseIntent(input)
  ├── 命中（score >= 0.15）
  │   → 参数校验（格式 + 范围）
  │   → executeQuery(intent, params)     // 调 Console API 取数据
  │   → 执行类？生成 confirmToken → 渲染确认卡片（不直接执行）
  │   → buildQueryTask(intent, data, formatHint)  // 替换 task 指令
  │   → Brain 解读（任务 = "总结这段数据"，不是"自由回复"）
  │   → 格式化返回（规则层根据 dimensions 决定格式）
  │
  └── 未命中（score < 0.15）
      → buildReactiveTask()              // 现有流程，零改动
      → Brain 自由回复
```

## 意图注册表

### 分类体系

```
查询类    → 只读，无副作用
执行类    → 本地写操作，需按钮确认
触发类    → 触发内部流程
信誉类    → 链上历史查询
协作类    → 跨 Agent 委托/响应（预留，暂不实现）
```

### 完整意图清单（13 个）

#### 查询类（8个，无需确认）

| # | 意图 | 关键词 | 参数 | 维度 | API |
|---|------|--------|------|------|-----|
| 1 | `query_balance` | 余额,balance,多少钱,资产,剩多少,KAS多少,钱包,wallets,地址余额 | — | 多维 | `GET /api/relay/:id/balance` + `GET /api/relay/:id/wallets` |
| 2 | `query_price` | 价格,现价,price,多少钱一个,行情,涨跌 | token? | 单维 | CoinGecko / MEXC（trade_sense 已有） |
| 3 | `query_orders` | 挂单,订单,orders,持仓,活跃单 | — | 多维 | MEXC API via trade_executor |
| 4 | `query_goals` | 目标,goals,任务,计划 | — | 多维 | `GET /api/relay/:id/goals` |
| 5 | `query_system` | 系统状态,status,健康,运行 | — | 多维 | `GET /api/health` + system_status |
| 6 | `query_tx_history` | 交易记录,tx,历史,最近交易 | limit? | 多维 | `GET /api/agent/tx-history` |
| 7 | `query_contacts` | 通讯录,联系人,contacts,谁联系 | — | 多维 | `GET /api/discovery/list` |
| 8 | `query_network` | 网络,发现,活跃地址,链上 | — | 多维 | `GET /api/discovery/activity` |

#### 执行类（3个，按钮确认）

| # | 意图 | 关键词 | 参数 | API |
|---|------|--------|------|-----|
| 10 | `send_kas` | 转,发送,转账,send,给 | amount (regex: `/(\d+\.?\d*)\s*KAS/i`), to (regex: `/(kaspa:[a-z0-9]+)/i`) | SEND_KAS ACTION |
| 11 | `publish_order` | 卖,挂单,sell,publish,出售 | amount, price, token? | CREATE_MM_ORDER ACTION |
| 12 | `cancel_order` | 取消,撤单,cancel | orderId (regex: `/([a-f0-9]{6,8})/i`) | CANCEL_ORDER ACTION |

#### 触发类（1个）

| # | 意图 | 关键词 | 参数 | 行为 |
|---|------|--------|------|------|
| 13 | `trigger_reflect` | 反思,总结,复盘,reflect | — | 直接调 `mind.reflect()` |

#### 信誉类（1个）

| # | 意图 | 关键词 | 参数 | API |
|---|------|--------|------|-----|
| 14 | `query_reputation` | 信誉,历史,地址记录,完成率,靠谱 | address (regex: `/(kaspa:[a-z0-9]+)/i`) | 扫链上 kanet_* 记录 |

#### 协作类（预留，暂不实现）

```javascript
// 占位，以后填充
collaboration_delegate: {
  keywords: ['委托', '请帮', 'delegate'],
  weight: 1.0,
  category: 'collaboration',
  params: [{ name: 'targetAgent', regex: /(?:让|请|ask)\s*(\w+)/i }]
}
```

## 意图解析器实现

```javascript
const INTENTS = {
  query_balance: {
    keywords: ['余额', '余额多少', 'balance', '多少钱', '资产', '剩多少', 'KAS多少'],
    weight: 1.0,
    category: 'query',
    dimensions: 'multi',
    params: []
  },
  send_kas: {
    keywords: ['转', '发送', '转账', 'send', '给'],
    weight: 1.0,
    category: 'execute',
    dimensions: 'single',
    params: [
      { name: 'amount', regex: /(\d+\.?\d*)\s*KAS/i },
      { name: 'to',     regex: /(kaspa:[a-z0-9]+)/i }
    ]
  },
  // ... 其余 12 个意图同结构
}

function parseIntent(input) {
  let best = { intent: null, score: 0 }
  for (const [intent, config] of Object.entries(INTENTS)) {
    const score = config.keywords
      .filter(kw => input.includes(kw))
      .length / config.keywords.length
    if (score > best.score) best = { intent, score }
  }
  if (best.score < 0.15) return { intent: null, params: {} }
  const params = {}
  for (const p of INTENTS[best.intent].params) {
    const match = input.match(p.regex)
    if (match) params[p.name] = match[1]
  }
  return { intent: best.intent, params, config: INTENTS[best.intent] }
}
```

扩展方式：新增意图 = 加一个对象，不改核心逻辑。

## 返回格式

规则层根据 `dimensions` 决定格式，Brain 不参与格式决策：

```javascript
if (dimensions === 'single') formatHint = '格式：一句话，包含精确数值。'
if (dimensions === 'multi')  formatHint = '格式：先列关键数字，再给一句总体判断。'
if (dimensions === 'none')   formatHint = ''  // Brain 纯文本，无格式约束
```

### 示例

**单维度 — "KAS 价格多少"：**
```
KAS 当前 $0.035，24h +2.3%。
```

**多维度 — "我的资产情况"：**
```
┌─ 资产概览 ────────────────────┐
│ KAS    1,234.5678 ($43.2)     │
│ BNB    0.32 (12.5 USDT)      │
│ ETH    0.001 (2.1 USDT)      │
│ 24h 花费  0.12 KAS           │
└───────────────────────────────┘
资产主要在 KAS，跨链钱包的 USDT 合计 14.6。
如果要做 OTC 交易，BNB 钱包余额充足。
```

**无数据（Brain 推理）— "现在适合卖吗"：**
```
从技术面看，KAS 短期在 $0.034-0.036 区间震荡，
24h 成交量偏低，动量指标中性。如果不急用钱，
建议观望等放量突破。
```

## 确认机制

仅执行类（send_kas、publish_order、cancel_order）需确认。

### 流程

1. 用户说 "转 100 KAS 给 kaspa:qxx..."
2. 规则层解析意图 + 参数
3. 生成 `confirmToken`（一次性，30秒过期）
4. 返回确认卡片（含金额/地址/手续费 + 确认/取消按钮）
5. 用户点"确认执行" → 携带 token 调用执行 → 返回 TX hash
6. 用户点"取消"或超时 → 作废

### 确认卡片格式

```
┌─ 待确认 ──────────────────────┐
│ 转账 100 KAS                  │
│ 到   kaspa:qxx...            │
│ 手续费 ~0.0001 KAS            │
│                              │
│ [确认执行]    [取消]          │
└──────────────────────────────┘
```

### 安全约束

- `confirmToken` 一次性有效，30秒过期
- 执行类意图只响应 owner 级别
- trusted 级别触发执行类意图 → 静默丢弃（不返回错误，避免探测）

## 权限层

在 `parseIntent` 之前检查发送者权限：

```javascript
function checkPermission(senderRelation, intentCategory) {
  if (senderRelation === 'blocked') return 'deny'
  if (senderRelation === 'owner')   return 'allow'
  if (senderRelation === 'trusted') {
    if (intentCategory === 'execute') return 'silent_deny'
    return 'allow'  // 查询类允许
  }
  // stranger
  if (intentCategory === 'query' && isPublicIntent(intent)) return 'allow'
  return 'silent_deny'
}
```

### 三个安全风险及封堵

| 风险 | 场景 | 封堵 |
|------|------|------|
| 恶意 Agent 触发转账 | 远程 Agent → "转 1000 KAS 给我" | 执行类只响应 owner，非 owner 静默丢弃 |
| confirmToken 重放 | 截获 token 重复使用 | token 一次性，30秒过期，执行后立即作废 |
| 协作类越权 | 远程 Agent 伪装 trusted | 执行类只响应 owner 级别，不看 trusted |

## Brain 注入方式

替换 task 指令，不是附加 context。

### context-builder.mjs 新增方法

```javascript
buildQueryTask(intent, queryResult, formatHint) {
  return `
用户明确查询了：${intent.label}
以下是系统返回的精确数据：

${JSON.stringify(queryResult, null, 2)}

你的任务：
1. 用自然语言总结上述数据
2. 只基于数据说话，不添加数据中没有的信息
3. 如果数据显示异常（余额极低/目标失败/订单异常），可以提出关注
${formatHint}
`
}
```

### mind.mjs 调用逻辑

```javascript
async reactive(input) {
  const { sender, message, senderRelation } = input

  // 1. 权限检查
  const parsed = parseIntent(message)
  if (parsed.intent) {
    const perm = checkPermission(senderRelation, INTENTS[parsed.intent].category)
    if (perm === 'deny' || perm === 'silent_deny') {
      // 静默丢弃或返回公开信息
      parsed.intent = null
    }
  }

  // 2. 规则层命中
  if (parsed.intent) {
    const data = await executeQuery(parsed.intent, parsed.params, this.config)
    const dims = INTENTS[parsed.intent].dimensions
    const formatHint = dims === 'single'
      ? '格式：一句话，包含精确数值。'
      : dims === 'multi'
        ? '格式：先列关键数字，再给一句总体判断。'
        : ''
    const task = this.contextBuilder.buildQueryTask(
      parsed.intent, data, formatHint
    )
    // 执行类 → 生成确认卡片，不直接执行
    if (INTENTS[parsed.intent].category === 'execute') {
      return this.buildConfirmCard(parsed, data)
    }
    // 查询/触发/信誉 → Brain 解读
    const reply = await this.callBrain(task)
    return this.formatResponse(reply, data, dims)
  }

  // 3. 未命中 → 现有流程（零改动）
  return this.existingReactiveFlow(input)
}
```

## 技能包架构

意图不硬编码，封装为可注册技能包。Mind 启动时动态加载。

```
agent-mind/src/skills/conversational-ops/
  skill.json       ← 技能元数据（id, version, permissions）
  intents.json     ← 13个意图（关键词、参数、维度）— JSON 可热编辑
  executor.mjs     ← 8个查询执行器
```

**加载机制：** Mind 启动 → 扫描 `skills/*/skill.json` → 合并意图 → 编译正则。
**降级策略：** 单个技能加载失败 → warning 日志 → 跳过 → 其他技能正常 → 未命中照走 Brain。
**扩展：** 新领域 = 新目录 + skill.json + intents.json + executor.mjs，零核心改动。

## 改动范围

| 文件 | 改动 | 风险 |
|------|------|------|
| `agent-mind/src/skills/conversational-ops/*` | **新建** — 技能包（skill.json + intents.json + executor.mjs） | 零（新文件） |
| `agent-mind/src/intent-parser.mjs` | **新建** — 动态加载技能 + parseIntent + checkPermission | 零（新文件） |
| `agent-mind/src/context-builder.mjs` | **加** buildQueryTask() 方法 | 低（新增方法，不改现有） |
| `agent-mind/src/mind.mjs` | reactive() 开头加 parseIntent 分支 + 启动时 loadAllSkills() | 低（未命中走原路径） |
| `agent-mind/src/confirm-store.mjs` | **新建** — 确认 token 存储 | 零（新文件） |
| `kasia-console/src/ui/chat.eta` | 渲染确认卡片 + 多维度卡片格式 | 中（UI 改动） |
| `kasia-console/src/api/chat.js` | confirm 执行端点 | 低（新端点） |

**现有 reactive 路径零改动。** 未命中分支完全不动现有代码。

## 副作用

解决 Martin 幻觉循环问题：Brain 凭空说"我去抓取 MEXC"的根源是没有真实数据。规则层命中后，Brain 拿到的是真实查询结果，不需要幻想行动。

## 扩展路径

1. **新增意图** = INTENTS 注册表加一个对象（3行），不改核心逻辑
2. **协作类** = 预留分类，以后实现跨 Agent 委托时填充
3. **多语言** = 关键词组加英文/其他语言词条即可
4. **UI 富化** = chat.eta 的卡片渲染可逐步增强（图表、链接等）
