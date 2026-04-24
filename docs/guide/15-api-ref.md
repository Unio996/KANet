## 十五、API 速查表

> 全部端点按域分组。方法 + 路径 + 一句话说明。
> 页面路由（返回 HTML）用 🖥 标记，API 路由（返回 JSON）无标记。
> 需要 INGEST_SECRET 认证的用 🔒 标记。
> 源文件路径均相对于 `kasia-console/src/api/`，index.js 指 `kasia-console/src/index.js`。

### 系统 / 健康

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/` | 🖥 首页重定向（有Agent→/chat，无→/welcome） | conversations.js |
| GET | `/health` | 健康检查心跳 | health.js |
| GET | `/api/ingest-secret` | 获取 ingest secret 提示 | health.js |
| GET | `/api/health/agents` | Agent 健康红绿灯（30s缓存） | health.js |
| GET | `/api/system/diagnose` | 系统诊断报告 | settings.js |
| POST | `/api/system/repair` | 系统自修复 | settings.js |
| GET | `/api/system/info` | 当前系统信息 | broker.js |
| GET | `/api/system/downloads` | 可用下载列表 | broker.js |
| POST | `/api/system/download` | 下载白名单文件 | broker.js |
| POST | `/api/system/run` | 运行白名单安装程序 | broker.js |
| GET | `/api/system/check-installed` | 检查软件是否已安装 | broker.js |
| GET | `/api/system/check-process` | 检查进程是否运行 | broker.js |
| POST | `/lang` | 设置语言 cookie | index.js |

### Agent / Mind

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/agent` | 🖥 Agent 主页（v2 设计系统） | conversations.js |
| GET | `/agent-legacy` | 🖥 Agent 旧版页面 | conversations.js |
| GET | `/agent/status` | 🖥 健康监控独立页 | conversations.js |
| GET | `/agent/history` | 🖥 Episode 历史独立页 | conversations.js |
| GET | `/dashboard` | 🖥 旧版仪表盘（兼容保留） | conversations.js |
| GET | `/welcome` | 🖥 欢迎/创建引导页 | relay.js |
| GET | `/api/agent/profile` | Agent 列表含 adapter/relay 状态 | conversations.js |
| POST | `/api/agent/reply` | Mind 统一回复入口 | conversations.js |
| GET | `/api/agent/mind-skills` | 查询 Agent 的 Mind 技能 | conversations.js |
| GET | `/api/agent/peer-context` | 获取 peer 上下文（给 Mind） | conversations.js |
| POST | `/api/agent/mind-event` | Mind 事件上报 | conversations.js |
| GET | `/api/agent/mind-events` | 查询 Mind 事件列表 | conversations.js |
| POST | `/api/agent/skill-invoked` | 批量更新技能调用计数 | conversations.js |
| GET | `/api/agent/spending` | Agent KAS 花费摘要 | conversations.js |
| GET | `/api/agent/tx-history` | Agent 交易历史 | conversations.js |
| GET | `/api/agent/outbound-check` | 反垃圾：外发消息检查 | index.js |
| GET | `/api/agent/activity-log` | Agent 链上行为日志 | index.js |
| GET | `/api/agent/activity-by-peer` | 按 peer 聚合行为统计 | index.js |
| GET | `/api/agent/outbound-stats` | 外发统计摘要 | index.js |
| GET | `/api/agent/handshake-report` | 握手报告（全Agent） | index.js |
| POST | `/api/agent/create-adapter` | Onboarding: 预创建 adapter | relay.js |
| POST | `/api/agent/create` | Onboarding: 创建完整 Agent | relay.js |

### Episode / History

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/history/episodes` | Episode 列表 | conversations.js |
| GET | `/api/history/episode-detail` | 单 Episode 详情 | conversations.js |
| GET | `/api/history/mind-summary` | Mind 运行摘要 | conversations.js |

### 通讯录 / Contacts

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/contacts` | 🖥 通讯录页面 | conversations.js |
| GET | `/api/contacts/list` | 联系人列表（含关系状态） | conversations.js |
| GET | `/api/contacts/merged` | 合并通讯录（DB+链上） | index.js |
| GET | `/api/contacts/tags` | 标签列表 | conversations.js |
| POST | `/api/contacts/update` | 更新联系人信息 | conversations.js |
| POST | `/api/contacts/add` | 添加联系人 | conversations.js |
| POST | `/api/contacts/block` | 拉黑联系人 | conversations.js |
| POST | `/api/contacts/tags/delete` | 删除标签 | conversations.js |
| POST | `/api/contacts/tags/rename` | 重命名标签 | conversations.js |

### 会话 / Conversations

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/conversations` | 🖥 会话列表页 | conversations.js |
| GET | `/conversations/:id` | 🖥 会话详情页（时间线） | conversations.js |
| GET | `/api/conversations/find` | 按 peer 地址查会话 ID | conversations.js |
| POST | `/conversations/:id/reply` | 手动回复（经 Mind） | conversations.js |

### 聊天 / Broadcast Chat

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/chat` | 🖥 聊天页面 | chat.js |
| GET | `/api/chat/messages` | 聊天消息列表 | chat.js |
| GET | `/api/chat/channels` | 频道列表 | chat.js |
| POST | `/api/chat/send` | 发送聊天消息 | chat.js |
| POST | `/api/chat/local` | 发送本地消息（不上链） | chat.js |
| POST | `/api/chat/ingest` | 🔒 外部消息写入 | chat.js |
| POST | `/api/chat/confirm` | 确认消息已处理 | chat.js |

### Relay / 账户管理

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/relays` | 🖥 Relay 管理页面 | relay.js |
| POST | `/relays` | 创建 Relay 节点 | relay.js |
| POST | `/relays/:id/delete` | 删除 Relay 节点 | relay.js |
| POST | `/relays/:id/assign` | 分配 adapter 给 relay | relay.js |
| GET | `/relays/:id/mnemonic` | 获取助记词（加密） | relay.js |
| POST | `/relays/generate-mnemonic` | 生成新助记词 | relay.js |
| GET | `/api/relay/:id/balance` | 查询 Kaspa 余额 | relay.js |
| POST | `/api/relay/:id/split-utxos` | IPC 拆分 UTXO | relay.js |
| POST | `/api/relay/:id/transfer` | 转账 KAS | relay.js |
| POST | `/api/relay/:id/send-command` | 统一命令发送到 Relay | relay.js |
| GET | `/api/relay/:id/card` | 获取 Agent Card | relay.js |
| POST | `/api/relay/:id/publish-card` | 发布 Agent Card 上链 | relay.js |
| GET | `/api/relation/status` | 查关系状态（握手去重） | index.js |

### 钱包 / Wallets

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/relay/:id/wallets` | 钱包列表 | relay.js |
| POST | `/api/relay/:id/wallets` | 创建钱包 | relay.js |
| POST | `/api/relay/:id/wallets/import` | 导入钱包（私钥） | relay.js |
| GET | `/api/relay/:id/wallets/:walletId/privkey` | 获取钱包私钥 | relay.js |
| GET | `/api/relay/:id/wallets/:walletId/balance` | 查询钱包余额 | relay.js |
| PUT | `/api/relay/:id/wallets/:walletId` | 更新钱包信息 | relay.js |
| DELETE | `/api/relay/:id/wallets/:walletId` | 删除钱包 | relay.js |
| POST | `/api/relay/:id/wallets/:walletId/withdraw` | 钱包提现（旧，仅 BNB/ETH） | relay.js |
| POST | `/api/relay/:id/wallets/:walletId/send` | **钱包出口（统一）**：9 链 × {usdt/usdc/native}，Portfolio + Exchange 共用 | relay.js |
| POST | `/api/relay/:id/wallets/:walletId/swap` | 钱包换币 | relay.js |
| GET | `/portfolio` | 🖥 资产总览页面（5 卡单一统计） | portfolio.js |
| GET | `/api/portfolio/unified` | 全 Agent 聚合（KAS/稳定币/原生/DeFi/Perp + 开仓数 HL+Aevo+Polymarket+Aave） | portfolio.js |

### Mind 配置 / Goals

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/relay/:id/mind-config` | 读取 Mind 配置 | relay.js |
| PUT | `/api/relay/:id/mind-config` | 更新 Mind 配置 | relay.js |
| GET | `/api/relay/:id/goals` | 目标列表 | relay.js |
| POST | `/api/relay/:id/goals` | 创建目标 | relay.js |
| PUT | `/api/relay/:id/goals/:goalId` | 更新目标 | relay.js |
| DELETE | `/api/relay/:id/goals/:goalId` | 删除目标 | relay.js |

### Adapter / AI 大脑

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/adapters` | 🖥 Adapter 管理页面 | adapter.js |
| POST | `/adapters` | 创建 Adapter | adapter.js |
| GET | `/adapters/:id/token` | 获取 Adapter token | adapter.js |
| GET | `/adapters/ingest-secret` | 获取 ingest secret | adapter.js |
| POST | `/adapters/:id/start` | 启动 Adapter 进程 | adapter.js |
| POST | `/adapters/:id/stop` | 停止 Adapter 进程 | adapter.js |
| POST | `/adapters/:id/restart` | 重启 Adapter 进程 | adapter.js |
| POST | `/adapters/:id` | 更新 Adapter 配置 | adapter.js |
| POST | `/adapters/:id/delete` | 删除 Adapter | adapter.js |

### 认证 / Connections

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/auth/resolve/:connectionId` | 按 connectionId 解析凭据 | auth.js |
| GET | `/api/auth/resolve-by-adapter/:adapterNodeId` | 按 adapter 解析凭据 | auth.js |
| GET | `/api/auth/connections` | 连接列表 | auth.js |
| GET | `/api/auth/connection/:id` | 单条连接详情 | auth.js |
| DELETE | `/api/auth/connection/:id` | 删除连接 | auth.js |
| GET | `/api/oauth/openai/start` | 发起 OpenAI OAuth 流程 | oauth.js |
| POST | `/api/oauth/openai/refresh/:connectionId` | 刷新 OAuth token | oauth.js |

### 身份 / 地址簿

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/identities` | 🖥 地址簿页面 | identities.js |
| POST | `/identities` | 添加身份 | identities.js |
| POST | `/identities/:id` | 更新身份 | identities.js |
| POST | `/identities/:id/trust` | 设置信任级别 | identities.js |
| POST | `/identities/:id/block` | 拉黑身份 | identities.js |
| POST | `/identities/tags/delete` | 删除标签 | identities.js |
| POST | `/identities/tags/rename` | 重命名标签 | identities.js |
| GET | `/api/identity/blocked` | 已拉黑列表 | identities.js |
| GET | `/api/identity/blocklist` | 拉黑地址列表 | identities.js |
| GET | `/api/identity/trust` | 信任列表 | identities.js |
| POST | `/api/identity/:id/annotate` | 按 ID 添加备注 | identities.js |
| POST | `/api/identity/annotate` | 按地址添加备注 | identities.js |

### 技能 / Skills

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/skills` | 🖥 技能管理页面 | skills.js |
| GET | `/api/skills` | 🔒 技能列表（可过滤） | skills.js |
| POST | `/api/skills/:id/invoke` | 🔒 递增技能调用计数 | skills.js |
| POST | `/api/skills/execute` | 🔒 验证并执行技能 | skills.js |
| POST | `/api/skills/register` | 🔒 注册新技能 | skills.js |
| POST | `/skills` | 创建技能（UI 表单） | skills.js |
| POST | `/skills/:id` | 更新技能（UI 表单） | skills.js |
| POST | `/skills/:id/delete` | 删除技能 | skills.js |
| POST | `/skills/rename-category` | 重命名技能分类 | skills.js |
| POST | `/skills/delete-category` | 删除技能分类 | skills.js |
| POST | `/skills/upload` | 上传技能文件 | skills.js |

### 发现 / Discovery

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/discovered` | 🖥 发现页面 | discovery.js |
| GET | `/explore` | 🖥 探索页面 | discovery.js |
| GET | `/network` | 🖥 网络页面 | discovery.js |
| GET | `/api/discovery/activity` | 链上活动列表 | discovery.js |
| GET | `/api/discovery/list` | 已发现身份列表 | discovery.js |
| POST | `/api/discovery/scanner/start` | 启动扫描器 | discovery.js |
| POST | `/api/discovery/scanner/stop` | 停止扫描器 | discovery.js |
| GET | `/api/discovery/scanner/status` | 扫描器状态 | discovery.js |
| POST | `/api/discovery/card` | 🔒 上报 Agent Card 数据 | discovery.js |
| POST | `/api/discovery/register` | 🔒 注册发现的身份 | discovery.js |
| GET | `/api/discovery/interaction` | 查询交互记录 | discovery.js |
| POST | `/api/discovery/interaction` | 🔒 记录交互事件 | discovery.js |
| GET | `/api/discovery/stats` | 发现统计 | discovery.js |
| GET | `/api/discovery/targets` | 发现目标列表 | discovery.js |
| GET | `/api/discovery/local-addresses` | 本地地址列表 | discovery.js |

### 事件 / Events

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/events` | 🖥 事件日志页面 | events.js |
| GET | `/events/export.csv` | 🖥 导出事件为 CSV | events.js |
| GET | `/api/events/trace/:traceId` | 🔒 按 traceId 查事件 | events.js |

### Ingest（Relay/Scout → Console）

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| POST | `/ingest/message` | 🔒 写入消息 | ingest.js |
| POST | `/ingest/reply` | 🔒 写入回复 | ingest.js |
| POST | `/ingest/tx` | 🔒 写入交易 | ingest.js |
| POST | `/ingest/event` | 🔒 写入事件 | ingest.js |
| GET | `/ingest/pending-handshakes` | 🔒 待处理握手（Relay catch-up） | ingest.js |
| GET | `/ingest/unreplied-messages` | 🔒 未回复消息（Relay catch-up） | ingest.js |

### Peer 上下文

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/context/:address` | 🔒 获取 peer 上下文（供 Adapter） | context.js |

### 交易 / Trading — 页面

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/trading` | 🖥 交易页面（旧版） | trading.js |
| GET | `/trading-v2` | 🖥 交易页面（新设计系统） | trading.js |
| GET | `/market` | 🖥 自由市场页面（旧版） | trading.js |
| GET | `/market-v2` | 🖥 自由市场页面（新设计系统） | trading.js |

### 交易 / Trading — 模式与配置

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/trade/mode` | 获取交易模式 | trading.js |
| PUT | `/api/trade/mode` | 设置交易模式 | trading.js |
| GET | `/api/trade/agent-mode` | 获取单 Agent 交易模式 | trading.js |
| PUT | `/api/trade/agent-mode` | 设置单 Agent 交易模式 | trading.js |
| GET | `/api/trade/agent-modes` | 全部 Agent 交易模式 | trading.js |
| GET | `/api/trade/config` | 交易配置 | trading.js |
| PUT | `/api/trade/config/:id` | 更新交易配置 | trading.js |
| GET | `/api/trade/triggers` | 交易触发器列表 | trading.js |
| PUT | `/api/trade/triggers` | 更新交易触发器 | trading.js |

### 交易 / Trading — 交易所账户

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/trade/exchanges` | 支持的交易所列表 | trading.js |
| GET | `/api/trade/accounts` | 交易所账户列表 | trading.js |
| POST | `/api/trade/accounts` | 添加交易所账户 | trading.js |
| PUT | `/api/trade/accounts/:id` | 更新交易所账户 | trading.js |
| DELETE | `/api/trade/accounts/:id` | 删除交易所账户 | trading.js |
| POST | `/api/trade/accounts/:id/default` | 设为默认账户 | trading.js |
| POST | `/api/trade/accounts/:id/test` | 测试账户连接 | trading.js |
| GET | `/api/trade/accounts/:id/balance` | 单账户实时余额（KAS+USDT） | trading.js |
| GET | `/api/trade/balances` | 所有账户余额汇总（30s 缓存） | trading.js |
| GET | `/api/trade/spreads` | KAS/USDT 六家 CEX 价差矩阵（30s 缓存） | trading.js |

### 交易 / Trading — 下单与执行

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/trade/kas-price` | 实时 KAS 价格 | trading.js |
| GET | `/api/trade/wallet-balance` | 链上钱包余额（USDT+原生） | trading.js |
| GET | `/api/trade/wallet-address` | 交易钱包地址 | trading.js |
| POST | `/api/trade/withdraw` | 提现（USDT/原生币） | trading.js |
| POST | `/api/trade/ask` | 向 Mind 咨询交易 | trading.js |
| POST | `/api/trade/preview-split` | 预览拆单方案 | trading.js |
| POST | `/api/trade/execute-split` | 执行拆单交易 | trading.js |
| POST | `/api/trade/order` | 下单 | trading.js |
| GET | `/api/trade/order/:orderId` | 查询单笔订单详情 | trading.js |
| DELETE | `/api/trade/order/:orderId` | 取消订单 | trading.js |
| GET | `/api/trade/open-orders` | 未完成订单列表 | trading.js |
| DELETE | `/api/trade/open-orders` | 批量取消未完成订单 | trading.js |
| GET | `/api/trade/execution/:id` | 单笔执行详情 | trading.js |
| GET | `/api/trade/executions` | 执行列表 | trading.js |
| GET | `/api/trade/order-executions` | 订单关联执行列表 | trading.js |
| POST | `/api/trade/trigger/proactive` | 触发 proactive 交易 | trading.js |
| POST | `/api/trade/trigger/reflection` | 触发交易反思 | trading.js |
| POST | `/api/trade/preflight` | Proactive 交易预检（三层护栏） | trading.js |

### 交易 / Trading — 日限额

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/trade/daily-usage` | 今日 SELL 量（总计+各所明细） | trading.js |
| PUT | `/api/trade/daily-limit` | 修改日限额（写 config_entries） | trading.js |

### 交易 / Trading — 审批

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/trade/pending-approvals` | 待审批执行列表 | trading.js |
| POST | `/api/trade/approve-execution/:id` | 批准执行 | trading.js |
| POST | `/api/trade/reject-execution/:id` | 拒绝执行 | trading.js |

### 交易 / Trading — 持仓与信号

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/trade/portfolio` | 合并持仓视图 | trading.js |
| GET | `/api/trade/orderbook` | 订单簿 | trading.js |
| GET | `/api/trade/anchor` | 获取锚定价格 | trading.js |
| PUT | `/api/trade/set-anchor` | 设置锚定价格 | trading.js |
| GET | `/api/trade/signals` | 交易信号列表 | trading.js |
| GET | `/api/trade/proposal` | 交易建议 | trading.js |
| GET | `/api/trade/log` | 交易日志 | trading.js |
| GET | `/api/trade/performance` | 交易绩效 | trading.js |
| GET | `/api/trade/quota/:relayNodeId` | Agent 交易配额 | trading.js |
| GET | `/api/trade/fund-locks` | 资金锁定列表 | trading.js |

### 交易 / Trading — 基线

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| POST | `/api/trade/baseline` | 创建持仓基线 | trading.js |
| GET | `/api/trade/baseline` | 查询持仓基线 | trading.js |
| POST | `/api/trade/baseline/:id/settle` | 结算基线 | trading.js |

### 交易 / Trading — MM 做市

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/trade/mm-orders` | MM 订单列表 | trading.js |
| POST | `/api/trade/mm-orders` | 🔒 创建 MM 订单 | trading.js |
| PUT | `/api/trade/mm-orders/:id` | 🔒 更新 MM 订单 | trading.js |
| POST | `/api/trade/mm-orders/:id/action` | MM 订单操作（UI 端） | trading.js |
| POST | `/api/trade/mm-orders/publish` | 发布 MM 报价广播 | trading.js |
| GET | `/api/trade/mm-quotes` | MM 报价快照列表 | trading.js |
| POST | `/api/trade/mm-quotes` | 🔒 写入报价快照 | trading.js |

### 协议级自由市场 / Exchange

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/exchange` | 🖥 自由市场页面 | exchange.js |
| GET | `/api/exchange/offers` | 报价列表 | exchange.js |
| GET | `/api/exchange/offers/:id` | 单条报价详情 | exchange.js |
| GET | `/api/exchange/markets` | 活跃市场对列表 | exchange.js |
| GET | `/api/exchange/agents` | 可用 Agent 列表 | exchange.js |
| POST | `/api/exchange/publish` | 发布报价 | exchange.js |
| POST | `/api/exchange/accept` | 接受报价 | exchange.js |
| POST | `/api/exchange/cancel` | 取消报价 | exchange.js |
| POST | `/api/exchange/confirm` | 确认交割（manual 双方确认） | exchange.js |
| POST | `/api/exchange/submit-payment` | taker 提交付款 TX（cross_chain_tx） | exchange.js |
| POST | `/api/exchange/dispute` | 发起争议（maker/taker） | exchange.js |

### 市场数据 / Market Data

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/market/all` | 全部市场数据（8源） | trading.js |
| GET | `/api/market/crypto` | 加密货币行情 | trading.js |
| GET | `/api/market/stocks` | 股票行情 | trading.js |
| GET | `/api/market/prediction` | 预测市场数据 | trading.js |
| GET | `/api/market/commodities` | 大宗商品数据 | trading.js |
| GET | `/api/market/funding` | 资金费率 | trading.js |
| GET | `/api/market/sentiment` | 市场情绪 | trading.js |
| GET | `/api/market/crypto-global` | 加密全局概况 | trading.js |
| GET | `/api/market/calendar` | 经济日历 | trading.js |
| GET | `/api/market/overview` | 市场总览 | stocks.js |
| GET | `/api/market/brief` | 市场简报 | stocks.js |
| GET | `/market-overview` | 🖥 市场总览页面 | stocks.js |

### 股票 / Stocks

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/stocks` | 🖥 股票页面 | stocks.js |
| GET | `/api/stocks/watchlist` | 自选股列表 | stocks.js |
| POST | `/api/stocks/watchlist` | 添加自选股 | stocks.js |
| DELETE | `/api/stocks/watchlist/:id` | 删除自选股 | stocks.js |
| GET | `/api/stocks/quotes` | 批量报价 | stocks.js |
| GET | `/api/stocks/quote/:symbol` | 单股报价 | stocks.js |
| GET | `/api/stocks/overview` | 股市概览 | stocks.js |
| GET | `/api/stocks/klines` | **日 K 线（1 个月 OHLCV）** | stocks.js |
| GET | `/api/stocks/fundamentals` | 基本面 + 财报 + ROE/FCF/D-E/PEG | stocks.js |

### 预测市场 / Predictions

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/predictions` | 🖥 预测市场页面 | stocks.js |
| GET | `/api/predictions/markets` | 预测市场列表 | stocks.js |
| GET | `/api/predictions/wallet` | 预测市场钱包 | stocks.js |
| POST | `/api/predictions/setup` | 设置预测市场 | stocks.js |
| GET | `/api/predictions/positions` | 持仓列表 | stocks.js |
| GET | `/api/predictions/orders` | 订单列表 | stocks.js |
| GET | `/api/predictions/book/:tokenId` | 订单簿 | stocks.js |
| POST | `/api/predictions/order` | 下单 | stocks.js |
| DELETE | `/api/predictions/order/:orderId` | 取消订单 | stocks.js |
| GET | `/api/polymarket/:relay_node_id/status` | Polymarket 状态 | stocks.js |
| POST | `/api/polymarket/:relay_node_id/approve` | Polymarket 授权 | stocks.js |
| GET | `/api/polymarket/:relay_node_id/approve-status` | 授权状态查询 | stocks.js |

### 券商 / Broker

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/broker/accounts` | 券商账户列表 | broker.js |
| GET | `/api/broker/registry` | 券商注册表 | broker.js |
| POST | `/api/broker/accounts` | 添加券商账户 | broker.js |
| POST | `/api/broker/accounts/:id/test` | 测试券商连接 | broker.js |
| DELETE | `/api/broker/accounts/:id` | 删除券商账户 | broker.js |
| GET | `/api/broker/:id/account` | 券商账户详情 | broker.js |
| GET | `/api/broker/:id/positions` | 持仓列表 | broker.js |
| GET | `/api/broker/:id/orders` | 订单列表 | broker.js |
| POST | `/api/broker/:id/order` | 下单 | broker.js |
| DELETE | `/api/broker/:id/order/:orderId` | 取消订单 | broker.js |
| GET | `/api/broker/:id/search` | 搜索标的 | broker.js |
| GET | `/api/broker/:id/quote/:conid` | 获取报价 | broker.js |

### 链上数据 / Chain Data

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/api/chain/stats` | 链统计（DAA/出块/难度） | chain-data.js |
| POST | `/api/chain/snapshot` | 🔒 上报链基本面快照 | chain-data.js |
| POST | `/api/chain/balances` | 🔒 批量余额上报 | chain-data.js |
| GET | `/api/chain/watchlist` | 链上监控列表 | chain-data.js |
| POST | `/api/chain/watchlist` | 添加监控地址 | chain-data.js |
| GET | `/api/chain/whale-activity` | 鲸鱼活动列表 | chain-data.js |
| POST | `/api/chain/whale-alert` | 🔒 上报鲸鱼警报 | chain-data.js |
| GET | `/api/chain/whale-alerts` | 鲸鱼警报列表 | chain-data.js |
| GET | `/whale-signal` | 🖥 Whale Signal 页面 | chain-data.js |
| GET | `/api/chain/whale-signal` | Whale Signal 数据 | chain-data.js |
| GET | `/api/chain/whale-signal/params` | Whale Signal 参数 | chain-data.js |
| PUT | `/api/chain/whale-signal/params` | 更新 Whale Signal 参数 | chain-data.js |
| GET | `/api/chain/fundamentals` | 链基本面数据 | chain-data.js |

### 节点配置 / Settings

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| POST | `/settings/node` | 保存节点配置 | settings.js |
| POST | `/settings/node/test` | 测试节点连接 | settings.js |
| POST | `/settings/node/discover` | 自动发现节点 | settings.js |
| GET | `/api/config/rpc-url` | 获取 RPC URL | settings.js |

### 其他页面

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| GET | `/story` | 🖥 Agent 故事页面 | conversations.js |
| GET | `/graph` | 🖥 关系图谱页面 | conversations.js |
| GET | `/handshakes` | 🖥 握手报告页面 | index.js |
| GET | `/audit` | 重定向到 /contacts | index.js |
| GET | `/settings` | 重定向到 /relays | index.js |
| GET | `/relay` | 重定向到 /relays | relay.js |
| POST | `/relay/config` | 重定向到 /relays | relay.js |
| GET | `/adapter` | 重定向到 /adapters | adapter.js |
| POST | `/adapter/config` | 重定向到 /adapters | adapter.js |

### 统计

- **总端点数**：约 200 个
- **页面路由**：约 30 个（返回 HTML）
- **🔒 认证路由**：约 25 个（需要 INGEST_SECRET）
- **最大文件**：trading.js（~2800 行，约 70 个端点）

---

