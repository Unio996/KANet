# KANet 数据完整性与可追溯性测试方案

> 2026-03-30 | 优先级高于 UI 美化
> 原则：**页面上出现的每一个数字，都必须找得到源头，点得进明细，逻辑自洽。**

---

## 一、测试维度

| 维度 | 说明 | 失败 = |
|------|------|--------|
| **溯源性** | 每个数字来自哪张表、哪条 SQL | 数字来路不明 |
| **可钻取** | 点击数字能看到明细列表 | 死数字，看了也没用 |
| **一致性** | 同一数据在不同页面显示一致 | A 说 40，B 说 37 |
| **完整性** | 所有应该有的字段都有值 | 空白、null、undefined |
| **时效性** | 数据是当前的，不是过期缓存 | 看到昨天的数据以为是今天的 |

---

## 二、逐页面数字清单

### 页面 1：Agent 页（/agent）

#### 顶部概览区

| 数字/指标 | 数据源 | 验证方法 |
|-----------|--------|---------|
| Agent 名称 | `relay_nodes.name` | 对比 DB 直查 |
| Agent 地址 | `relay_nodes.address` | 对比 DB |
| KAS 余额 | Kaspa RPC `getBalanceByAddress` | 对比链上浏览器 |
| 花费统计 | `tx_records` SUM(amount) WHERE direction='outbound' | 对比 tx_records 明细 |

#### 交易提案面板

| 数字/指标 | 数据源 | 验证方法 |
|-----------|--------|---------|
| 综合评分 X/100 | `signal-engine.analyzeMarket()` → composite | 手动用同一组 K线数据重算 |
| 置信度 X% | signal-engine → confidence | 检查信号一致性逻辑 |
| ADX 值 | signal-engine → calcADX() | 对比 TradingView 同周期 ADX |
| 提案金额 | strategy-engine → calcPositionSize() | 检查不超过限额 |
| 提案价格 | 最新 K 线 close × 系数 | 对比交易所实时价格 |
| 日限额 X/5000 | `config_entries` daily_total_max_kas - 今日已用 | 对比 mm_orders 今日 SUM |

**可钻取要求**：
- [ ] 综合评分 → 点击展开五维信号明细
- [ ] 提案金额 → 能看到 position sizing 计算过程
- [ ] 日限额 → 点击看今日所有交易明细

#### 通讯录 Tab

| 数字/指标 | 数据源 | 验证方法 |
|-----------|--------|---------|
| X 联系人 | `relation_states` WHERE local_address=agent COUNT | DB 直查对比 |
| 交易笔数 | `mm_orders` WHERE agent_address=X AND peer_address=Y COUNT | DB 直查 |
| 交易量 KAS | `mm_orders` SUM(kas_amount) WHERE status IN completed | DB 直查 |
| 争议数 | `mm_orders` WHERE status IN disputed/escalated COUNT | DB 直查 |
| 消息发出/收到 | `chain_events` WHERE from/to address COUNT | DB 直查 |

**一致性检查**：
- [ ] 联系人总数 = relation_states 行数（该 Agent）
- [ ] 交易笔数之和 = mm_orders 总数（该 Agent）
- [ ] 争议率计算正确：disputed / (completed + disputed) × 100

**可钻取要求**：
- [ ] 联系人 → 点击进入故事线（/story）
- [ ] 交易笔数 → 故事线里能看到每一笔
- [ ] 争议 → 能看到争议订单明细

#### 目标 Tab

| 数字/指标 | 数据源 | 验证方法 |
|-----------|--------|---------|
| 活跃目标数 | `intent.json` goals WHERE status=active COUNT | 文件直读对比 |
| 尝试次数 | intent.json goal.attempts | 文件直读 |
| 失败次数 | intent.json goal.failCount | 文件直读 |
| 冷却状态 | intent.json goal.isCoolingDown | 计算验证 |

**可钻取要求**：
- [ ] 每个目标 → 能看到尝试历史（哪些成功哪些失败）

#### 历史 Tab（Episode）

| 数字/指标 | 数据源 | 验证方法 |
|-----------|--------|---------|
| Episode 数量 | episode-builder → buildEpisodes() | 对比 mm_orders + chain_events 条数 |
| KAS 金额 | mm_orders.kas_amount | DB 直查 |
| 状态标签 | mm_orders.status → episode status 映射 | 逐条对比 |
| 时间线步骤 | execution_states + mm_orders 状态时间戳 | 逐步对比 |
| 决策理由 | execution_states.display_summary | DB 直查 |

**一致性检查**：
- [ ] Episode completed 数 + cancelled 数 + in_progress 数 = 总 Episode 数
- [ ] 每个 Episode 的 KAS 金额 = 对应 mm_orders.kas_amount
- [ ] 时间线步骤顺序与 mm_orders 状态变更时间一致

**可钻取要求**：
- [ ] Episode → 点进四 Tab（故事线/通讯录/会话/凭证）
- [ ] 链上凭证 TX hash → 能复制，能在浏览器验证

#### 状态 Tab

| 数字/指标 | 数据源 | 验证方法 |
|-----------|--------|---------|
| 健康状态（红/黄/绿） | agent-health.js → 7 指标 | 逐指标验证 |
| 最近事件时间 | events 表 MAX(created_at) | DB 直查 |
| 最近 proactive 时间 | events WHERE event_type=proactive_cycle | DB 直查 |
| 最近反思时间 | events WHERE event_type=reflection | DB 直查 |
| 错误数（2h） | events WHERE level=error AND created_at > 2h ago | DB 直查 |
| 阻塞数（2h） | events WHERE event_type LIKE '%blocked%' | DB 直查 |

#### 钱包 Tab

| 数字/指标 | 数据源 | 验证方法 |
|-----------|--------|---------|
| KAS 余额 | RPC getBalance | 链上浏览器 |
| USDT 余额（各链） | EVM/SOL/TRON RPC 查 token balance | 链上浏览器 |
| 钱包地址 | relay_nodes.address / agent_wallets | DB |
| 交易历史 | tx_records | DB 明细 |

---

### 页面 2：聊天页（/chat）

| 数字/指标 | 数据源 | 验证方法 |
|-----------|--------|---------|
| 频道列表 | broadcast_messages GROUP BY channel_name | DB 直查 |
| 消息条数 | broadcast_messages WHERE channel_name=X COUNT | DB 直查 |
| 消息内容 | broadcast_messages.content | DB 直查 |
| 发送者名称 | relay_nodes WHERE address=sender | DB 关联 |
| 时间戳 | broadcast_messages.created_at | DB 直查 |

**过滤验证**：
- [ ] 无 UUID 格式频道（交易协议消息不应出现）
- [ ] 无空 sender_address 消息
- [ ] Owner 消息正确标识（sender_address 以 'owner:' 开头）

**一致性检查**：
- [ ] 频道消息数 = 实际展示的消息条数
- [ ] 新发送的消息立即出现（乐观渲染 + 轮询确认）

---

### 页面 3：探索页（/explore）

| 数字/指标 | 数据源 | 验证方法 |
|-----------|--------|---------|
| 已发现地址 | identities COUNT 或 discovery/activity | DB 直查 |
| 24h 活跃 | identities WHERE last_active > 24h ago | DB 直查 |
| 有 Agent Card | identities WHERE card_mode IS NOT NULL | DB 直查 |
| 鲸鱼信号分 | whale-signal.js computeWhaleSignal() | 手动验证计算 |
| 鲸鱼方向 | whale-signal.js direction | 验证 inflow/outflow 逻辑 |
| 交互次数 | interaction_records 或 chain_events COUNT | DB 直查 |
| 握手/消息数 | chain_events WHERE event_type 分类 COUNT | DB 直查 |

**可钻取要求**：
- [ ] 地址 → 点击能看到该地址的完整活动
- [ ] 鲸鱼动态 → 每条有 TX hash 可验证

---

### 页面 4：市场页（/trading）

| 数字/指标 | 数据源 | 验证方法 |
|-----------|--------|---------|
| KAS 价格 | 交易所 API ticker | 对比交易所网页 |
| 24h 涨跌 | 交易所 API 24h change | 对比交易所 |
| 持仓数据 | exchange API account balance | 对比交易所 |
| 订单列表 | mm_orders | DB 直查 |
| 订单状态 | mm_orders.status | DB 直查 |
| 审批列表 | execution_states WHERE status=pending | DB 直查 |
| Agent 交易模式 | config_entries agent_trade_mode:* | DB 直查 |
| 锚定设置 | config_entries trade_anchor | DB 直查 |
| 限额配置 | config_entries per_order_max_* / daily_* / auto_* | DB 直查 |

**一致性检查**：
- [ ] 模式显示 = DB 存储值
- [ ] 锚定显示 = DB 存储值
- [ ] 限额约束：auto_mode_max ≤ per_order_max × 0.3

---

## 三、跨页面一致性检查

| 检查项 | 涉及页面 | 验证方法 |
|--------|---------|---------|
| 联系人总数 | Agent 通讯录 Tab vs /contacts 页 | 两处查同一 API，数字必须相同 |
| 交易笔数 | Agent 历史 Tab vs /trading 订单列表 | episode 数 = mm_orders 非取消数 |
| Agent 余额 | Agent 钱包 Tab vs /trading 持仓 | 同一 RPC 查询 |
| Agent 名称 | Sidebar vs Agent 页 vs 聊天页 | relay_nodes.name 统一 |
| 健康状态颜色 | Agent 状态 Tab vs /api/health/agents | API 返回值 = UI 颜色 |
| 交易模式 | /trading 设置 vs trade-action 实际行为 | 设 approval → Agent 操作实际被拦截 |
| 锚定 | /trading 设置 vs /api/trade/proposal | 设 kas → 提案是本币锚策略 |

---

## 四、边界情况测试

| 场景 | 预期行为 |
|------|---------|
| Agent 无联系人 | 通讯录显示"暂无"，不报错 |
| 无交易历史 | 历史 Tab 显示空，提案面板显示信号状态 |
| 交易所未连接 | 信号返回 composite=0，提案返回 null |
| 钱包余额为 0 | 显示 0，不显示 undefined/NaN |
| 鲸鱼信号无数据 | 探索页显示 "—"，不显示 0/100 |
| 单条联系人 | 通讯录正常显示，图谱能渲染 |
| 极长地址/名称 | 截断显示，不撑破布局 |
| **锚从 usd 切换到 kas** | 提案方向反转（跌=买入机会），P&L 单位变 KAS |
| **锚切换后查历史** | 历史 episode 标注各自使用的锚，不混淆 |
| **本币锚下价格下跌** | 提案显示"低吸囤币"而非"止损卖出" |
| **本币锚下 KAS 净减少** | 触发止损是因为 KAS 数量减少，不是 USDT 亏损 |
| **锚切换 → signal 不变 strategy 反转** | signal-engine 输出不变，strategy-engine 选不同策略模板 |
| **锚切换 → Brain context 格式对应** | Brain 看到的 TRADING PROPOSAL 标注正确的锚 |
| **锚切换 → execution_states 记录锚** | 每笔交易记录当时的 anchor 值，事后可溯 |

---

## 五、执行方式

### 自动化测试脚本

编写 `tests/test-data-integrity.mjs`：
1. 直接查 DB 拿"真相"
2. 调 API 拿"页面数据"
3. 对比：不一致 = FAIL
4. 检查必填字段：null/undefined = FAIL
5. 检查跨页面一致性

### 手动验证清单

对于无法自动化的（如链上浏览器对比、交易所价格对比）：
- 输出检查清单
- 列出每个需要人工验证的数字和对比来源

---

## 六、测试优先级

| 优先级 | 内容 | 原因 |
|--------|------|------|
| P0 | 钱包余额准确性 | 涉及真金白银 |
| P0 | 交易提案参数正确性 | 会触发真实交易 |
| P0 | 限额/模式生效验证 | 安全底线 |
| P1 | 通讯录数字一致性 | 用户信任基础 |
| P1 | Episode 数据完整性 | 交易历史不能丢 |
| P2 | 探索页统计数字 | 非关键路径 |
| P2 | 聊天频道过滤 | 已修复，回归验证 |
