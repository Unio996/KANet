# KANet 数据库字典

> 版本：2026-04-06
> 数据库：kasia-console/data/console.db（SQLite）
> 总表数：36 张
> 维护原则：改表前必查本文档，确认影响范围

---

## 总览

### 表分类

| 类别 | 表名 | 状态 |
|------|------|------|
| **核心社交** | relation_states, identities, conversations, messages | 活跃核心 |
| **链上数据** | chain_events, tx_records, kanet_message_index, broadcast_messages | 活跃核心 |
| **Agent 配置** | relay_nodes, adapter_nodes, agent_connections, agent_wallets | 活跃核心 |
| **系统运行** | events, replies, execution_states, pending_actions, skills | 活跃核心 |
| **交易系统** | mm_orders, mm_quotes, fund_locks, exchange_offers, exchange_accounts | 活跃核心 |
| **交易辅助** | trade_executions, trade_log, trade_baselines | 活跃辅助 |
| **市场数据** | chain_snapshots, address_balances, whale_watchlist, stock_watchlist | 活跃辅助 |
| **配置存储** | config_entries, scout_checkpoint, broker_accounts | 活跃辅助 |
| **待清理** | account_relations, interaction_records | 技术债 |
| **空表/低用** | contracts, probe_logs, mm_quotes | 观察中 |

---

## 核心社交层

### relation_states（196 条）
**唯一真相源：Agent 的社交关系状态**

所有社交决策必须读这张表，禁止用其他表推断关系状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| local_address | TEXT NOT NULL | 我方 Agent 地址 |
| peer_address | TEXT NOT NULL | 对方地址 |
| status | TEXT NOT NULL | observed/accepted/active/blocked |
| trust_level | TEXT | normal/trusted/owner |
| is_blocked | INTEGER | 1=已拉黑 |
| their_alias | TEXT | 对方 comm 通信别名（握手时写入） |
| first_seen_tx | TEXT | 首次发现的 TX |
| handshake_observed_at | TEXT | 观察到握手的时间 |
| handshake_accepted_at | TEXT | 接受握手的时间 |
| session_confirmed_at | TEXT | 会话确认时间 |
| updated_at | TEXT NOT NULL | 最后更新时间 |

**写入方**：ingest-service.js（observeHandshake/acceptHandshake）
**读取方**：context-builder.mjs、discovery.js、contacts API、anti-spam.js

---

### identities（363 条）
**全局地址注册表：所有已知地址的元数据**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| address | TEXT NOT NULL | Kaspa 地址 |
| network | TEXT NOT NULL | mainnet/testnet |
| identity_type | TEXT NOT NULL | local/remote |
| display_name | TEXT | 显示名称 |
| trust_level | TEXT NOT NULL | 全局默认信任级别（被 relation_states 覆盖） |
| is_blocked | INTEGER NOT NULL | 全局拉黑 |
| tags | TEXT | 标签列表 |
| notes | TEXT | 备注 |
| discovery_status | TEXT NOT NULL | connected/discovered |
| confidence_score | REAL NOT NULL | 置信度 0-1 |
| card_* | 多个字段 | Agent Card 数据（技能/简介/版本等） |
| interaction_count | INTEGER NOT NULL | 历史交互次数 |
| last_seen_at | TEXT | 最后见到的时间 |

**写入方**：ingest-service.js
**读取方**：几乎所有 API

> 注意：trust_level/is_blocked 是全局默认值，per-Agent 的覆盖在 relation_states 里

---

### conversations（275 条）
**会话容器：每对地址之间的对话上下文**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| local_identity_id | TEXT NOT NULL | 我方 identity.id |
| remote_identity_id | TEXT | 对方 identity.id（不能为 NULL） |
| channel_type | TEXT NOT NULL | dm/broadcast |
| status | TEXT NOT NULL | active/archived |
| last_message_at | TEXT | 最后消息时间 |
| unread_count | INTEGER NOT NULL | 未读数 |
| network | TEXT NOT NULL | mainnet/testnet |

**写入方**：ingest-service.js（ensureConversation）
**读取方**：conversations API、messages 表关联

> 陷阱：remote_identity_id 不能为 NULL，否则是孤立 conversation

---

### messages（13586 条）
**DM 消息真相源：所有点对点消息**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| trace_id | TEXT NOT NULL | 追踪 ID |
| conversation_id | TEXT | 关联会话 |
| direction | TEXT NOT NULL | inbound/outbound |
| message_type | TEXT NOT NULL | text/handshake/query_card |
| content_text | TEXT NOT NULL | 消息正文 |
| source_txid | TEXT | 链上 TX hash |
| created_at | TEXT NOT NULL | 创建时间 |

**写入方**：ingest-service.js（ingestMessage，唯一入口）
**读取方**：conversations API、activity-log、context-builder

> 陷阱：message_type='text' 才是真正 DM，query_card 是系统响应，统计时必须过滤

---

## 链上数据层

### chain_events（63230 条）
**链上事件索引：记录"发生了什么"**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| txid | TEXT NOT NULL | 链上 TX hash |
| from_address | TEXT | 发送方地址 |
| to_address | TEXT | 接收方地址 |
| event_type | TEXT NOT NULL | handshake/text/comm/comm_sent/payment/kas_delivery 等 |
| payload | TEXT | 事件附加数据 JSON |
| observed_by | TEXT NOT NULL | 哪个模块写入 |
| observed_at | TEXT NOT NULL | 观察时间 |

**写入方**：ingest-service.js
**读取方**：anti-spam.js、activity-log、handshake-report

> event_type 完整列表见 shared/lib/event-types.mjs
> anti-spam 查询范围：IN ('comm', 'comm_sent', 'text', 'handshake')

---

### tx_records（15027 条）
**花费真相源：Agent 的链上交易记录**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| trace_id | TEXT NOT NULL | 追踪 ID（格式：handshake:{txid} 等） |
| txid | TEXT NOT NULL | 链上 TX hash |
| direction | TEXT NOT NULL | outbound（花费）/inbound（收入） |
| amount | TEXT | 转账金额（字符串，避免精度问题） |
| fee | TEXT | 手续费 |
| local_address | TEXT | 归属 Agent 地址（v45 新增） |
| conversation_id | TEXT | 关联会话（握手 TX 为 NULL） |
| status | TEXT NOT NULL | broadcasted（永远是这个，已知局限） |
| network | TEXT NOT NULL | mainnet/testnet |

**写入方**：ingest-service.js（ingestTx，16 处调用全部补传 local_address）
**读取方**：ledger API（花费统计唯一来源）

> 花费 = COALESCE(amount,0) + COALESCE(fee,0)
> 握手 TX 的 conversation_id = NULL，通过 trace_id LIKE 'handshake:%' 识别

---

### kanet_message_index（5277 条）
**Scout 消息索引：扫链发现的消息待处理队列**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| txid | TEXT NOT NULL | TX hash |
| for_address | TEXT NOT NULL | 目标地址 |
| from_address | TEXT NOT NULL | 发送方地址 |
| payload_type | TEXT NOT NULL | 消息类型 |
| block_time | TEXT NOT NULL | 出块时间 |
| indexed_by | TEXT NOT NULL | 索引来源 |
| processed_at | TEXT | 处理时间（NULL=待处理，幂等保护） |

**写入方**：kaspa-scout/src/message-indexer.mjs
**读取方**：Relay catch-up 逻辑

---

### broadcast_messages（3244 条）
**广播消息：comm 频道的公开消息**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| channel_name | TEXT NOT NULL | 频道名 |
| sender_address | TEXT NOT NULL | 发送方 |
| content | TEXT NOT NULL | 消息内容 |
| tx_hash | TEXT | 链上 TX hash |
| status | TEXT NOT NULL | confirmed |
| created_at | TEXT NOT NULL | 创建时间 |

**写入方**：chat.js（send_broadcast 路径）
**读取方**：/chat 页面、/events 页面

---

## Agent 配置层

### relay_nodes（5 条）
**Agent 核心配置：每个 Agent 的身份和运行参数**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | Agent 名称（目录名，含下划线） |
| address | TEXT | Kaspa 地址 |
| mnemonic_encrypted | TEXT | 加密助记词 |
| network | TEXT NOT NULL | mainnet/testnet |
| adapter_node_id | TEXT | 关联 Adapter |
| proactive_interval_minutes | INTEGER | proactive 间隔（默认60） |
| evolution_interval_hours | INTEGER | reflection 间隔（默认24） |
| vision | TEXT | Agent 人格愿景 |
| principles_json | TEXT | 行为原则 JSON |
| style | TEXT | 风格描述 |
| social_style | TEXT | balanced/proactive/reactive |
| trading_config_json | TEXT | 交易配置 |

**写入方**：relay API（用户配置）
**读取方**：mind-manager.js、health API、几乎所有 Agent 操作

---

### adapter_nodes（7 条）
**AI 大脑配置：每个 Adapter 的连接信息**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | Adapter 名称 |
| ai_provider | TEXT NOT NULL | openclaw/openai/grok/deepseek |
| ai_provider_url | TEXT | API URL |
| ai_model | TEXT | 模型名称 |
| ai_provider_key_encrypted | TEXT | 加密 API Key |
| http_port | INTEGER NOT NULL | 监听端口（默认3002） |
| token_encrypted | TEXT | Ingest token |

**写入方**：adapter API
**读取方**：Adapter 进程启动时读取

---

### agent_connections（7 条）
**OAuth/API Key 认证状态**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| adapter_node_id | TEXT NOT NULL | 关联 Adapter |
| provider | TEXT NOT NULL | 提供商 |
| auth_mode | TEXT NOT NULL | api_key/oauth/gateway |
| status | TEXT NOT NULL | connected/expiring/expired/refresh_failed |
| access_token_enc | TEXT | 加密 access token |
| refresh_token_enc | TEXT | 加密 refresh token |
| credential_version | INTEGER NOT NULL | 每次更新+1，Adapter 缓存据此失效 |
| expires_at | TEXT | token 过期时间 |

**写入方**：connection-manager.js
**读取方**：resolve-auth.mjs（Adapter 侧）

---

### agent_wallets（9 条）
**多链钱包：Agent 持有的非 Kaspa 链钱包**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| relay_node_id | TEXT NOT NULL | 归属 Agent |
| chain | TEXT NOT NULL | bnb/eth/sol/polygon 等 |
| address | TEXT NOT NULL | 链上地址 |
| privkey_encrypted | TEXT | 加密私钥 |
| is_default | INTEGER NOT NULL | 是否默认钱包 |

**写入方**：relay API（用户添加）
**读取方**：self-awareness.mjs（资产感知）、跨链验证

---

## 系统运行层

### events（37792 条）
**系统事件日志：所有模块的运行日志**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| trace_id | TEXT | 追踪 ID |
| event_scope | TEXT NOT NULL | system/agent/trade |
| event_type | TEXT NOT NULL | 事件类型 |
| source | TEXT NOT NULL | 来源模块 |
| level | TEXT NOT NULL | info/warn/error |
| summary | TEXT NOT NULL | 人读摘要 |
| payload_json | TEXT | 详细数据 JSON |
| agent_address | TEXT | 关联 Agent 地址 |
| created_at | TEXT NOT NULL | 创建时间 |

**写入方**：所有模块（ingestEvent）
**读取方**：/events 页面、health monitor、agent-health.js

---

### replies（13153 条）
**AI 回复记录：Brain 生成的所有回复**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| trace_id | TEXT NOT NULL | 追踪 ID |
| conversation_id | TEXT | 关联会话 |
| message_id | TEXT | 触发消息 ID |
| reply_type | TEXT NOT NULL | ai/system |
| model_name | TEXT | 使用的模型 |
| reply_text | TEXT NOT NULL | 回复正文 |
| status | TEXT NOT NULL | draft/sent/failed |
| sent_txid | TEXT | ⚠ 已废弃字段，hack 实现，待删除 |
| created_at | TEXT NOT NULL | 创建时间 |

**写入方**：ingest-service.js（ingestReply）
**读取方**：conversations 页面详情

> sent_txid 字段是残留 hack，chat.js 的 30s 盲匹配回填逻辑待删除

---

### execution_states（167 条）
**交易执行状态：每笔操作的审计链**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| type | TEXT NOT NULL | 操作类型 |
| source | TEXT NOT NULL | mind/owner/auto |
| agent_address | TEXT | 执行 Agent |
| status | TEXT NOT NULL | pending/approved/rejected/done |
| permission_level | TEXT NOT NULL | owner/trusted |
| input_txid | TEXT | 输入 TX |
| output_txid | TEXT | 输出 TX |
| display_summary | TEXT | Brain 决策理由（人读） |
| action_details | TEXT | 操作详情 JSON |
| approval_deadline | TEXT | 审批截止时间 |

**写入方**：action-executor.mjs、trading.js
**读取方**：Episode 系统、审批 API

---

### pending_actions（3 条）
**意图队列：待执行的 Agent 动作（v44 新增）**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| action_type | TEXT NOT NULL | handshake_accept/handshake_init |
| direction | TEXT NOT NULL | inbound/outbound |
| local_address | TEXT NOT NULL | 我方 Agent 地址 |
| target_address | TEXT NOT NULL | 目标地址 |
| source | TEXT NOT NULL | relay/ingest/scout/mind |
| idempotent_key | TEXT NOT NULL UNIQUE | 去重键 |
| status | TEXT NOT NULL | pending/executing/done/failed/expired |
| retry_count | INTEGER NOT NULL | 重试次数 |
| max_retries | INTEGER NOT NULL | 最大重试（默认3） |
| trigger_txid | TEXT | 触发本动作的 TX |
| result_txid | TEXT | 执行结果 TX |
| error | TEXT | 失败原因 |

**写入方**：ingest-service.js、rpc-listener.mjs、action-executor.mjs、discovery.js
**读取方**：catchup-service.js（唯一消费者）

> 设计原则：catch-up 只消费 pending_actions，不再读 relation_states 做决策

---

### skills（157 条）
**技能注册表：所有 Agent 技能的元数据**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| relay_node_id | TEXT | 归属 Agent（NULL=全局） |
| name | TEXT NOT NULL | 技能 ID |
| display_name | TEXT NOT NULL | 显示名称 |
| category | TEXT NOT NULL | 分类（不能为 NULL） |
| action_type | TEXT NOT NULL | builtin/skill |
| status | TEXT NOT NULL | active/frozen |
| side_effect_level | TEXT NOT NULL | 副作用级别 |
| invoke_count | INTEGER NOT NULL | 调用次数 |

**写入方**：skills.js（registerMindSkills，启动时扫描）
**读取方**：registry.autoDiscover()、/skills 页面

---

## 交易系统层

### mm_orders（109 条）
**做市订单：KAS/USDT OTC 交易订单**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| relay_node_id | TEXT NOT NULL | 归属 Agent |
| side | TEXT NOT NULL | buy/sell |
| kas_amount | REAL NOT NULL | KAS 数量 |
| usdt_amount | REAL NOT NULL | USDT 数量 |
| price | REAL NOT NULL | 成交价格 |
| chain | TEXT NOT NULL | 对手方链（bnb/eth 等） |
| status | TEXT NOT NULL | quoted/accepted/paying/paid/verified/delivering/completed |
| payment_txhash | TEXT | 付款 TX（UNIQUE 索引，不可重复） |
| mode | TEXT NOT NULL | manual/auto/approval |
| agent_address | TEXT | 执行 Agent |

**写入方**：trading.js、order-machine.js
**读取方**：trading 页面、execution_states

---

### fund_locks（45 条）
**资金锁定：防止超额使用的资金预留**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| agent_address | TEXT NOT NULL | 归属 Agent |
| order_id | TEXT NOT NULL | 关联订单 |
| asset | TEXT NOT NULL | 锁定资产类型 |
| amount | REAL NOT NULL | 锁定金额 |
| status | TEXT NOT NULL | locked/released |
| released_at | TEXT | 释放时间 |

**写入方**：order-machine.js
**读取方**：trading API（配额检查）

---

### exchange_offers（5 条）
**协议级自由市场报价（v38 新增）**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| give_asset | TEXT NOT NULL | 给出资产（自由字符串） |
| give_amount | TEXT NOT NULL | 给出数量（字符串存储） |
| want_asset | TEXT NOT NULL | 想要资产（自由字符串） |
| want_amount | TEXT NOT NULL | 想要数量（字符串存储） |
| maker | TEXT NOT NULL | 挂单方地址 |
| protocol_status | TEXT NOT NULL | open/matched/completed/cancelled/expired |
| verification | TEXT NOT NULL | manual/cross_chain_tx/kaspa_tx |
| market_key | TEXT NOT NULL | 派生分组键（本地索引，不上链） |
| taker | TEXT | 接单方地址 |
| broadcast_tx_id | TEXT NOT NULL | 链上广播 TX |

**写入方**：exchange.js（乐观写入）、trade-protocol-filter.js
**读取方**：/exchange 页面

---

### exchange_accounts（2 条）
**CEX 账户：做市对冲用的交易所 API Key**

| 字段 | 类型 | 说明 |
|------|------|------|
| exchange | TEXT NOT NULL | mexc/gate/bybit 等 |
| api_key_encrypted | TEXT | 加密 API Key |
| api_secret_encrypted | TEXT | 加密 API Secret |
| is_default | INTEGER NOT NULL | 是否默认账户 |

---

## 市场数据层

### chain_snapshots（1078 条）
**Kaspa 链基本面快照：定时采集的链上指标**

每10分钟一条，包含：block_count/difficulty/daa_score/hashrate/circulating_supply 等。

**写入方**：Scout（POST /api/chain/snapshot）
**读取方**：/dashboard、market 数据

---

### address_balances（36 条）
**链上余额快照：监控地址的余额历史**

**写入方**：Scout（POST /api/chain/balances）
**读取方**：余额趋势图

---

### whale_watchlist（35 条）
**鲸鱼监控列表：需要追踪的大户地址**

| 字段 | 说明 |
|------|------|
| address | 监控地址 |
| tag | 标签（whale/exchange/team） |
| label | 人读标签 |
| active | 是否启用监控 |

---

### stock_watchlist（4 条）
**自选股列表：Brain 股票感知的标的**

**读取方**：stock-tracker.mjs（Yahoo Finance 拉数据）

---

## 配置存储层

### config_entries（36 条）
**系统配置 KV 存储**

| 字段 | 说明 |
|------|------|
| key | 配置键 |
| category | 分类 |
| value_encrypted | 加密值（敏感配置） |
| value_plain_hint | 明文提示 |
| is_sensitive | 是否敏感 |

**写入方**：settings API
**读取方**：各模块启动时读取

---

### scout_checkpoint（1 条）
**Scout 扫链进度：防止重启后漏消息**

| 字段 | 说明 |
|------|------|
| address | 监控地址 |
| last_block_time | 最后扫描的块时间 |
| last_blue_score | 最后扫描的 blue score |

**写入方**：message-indexer.mjs（每30s flush）
**读取方**：history-fetcher.mjs（启动时补全历史）

---

### broker_accounts（1 条）
**券商账户：IBKR/Alpaca 等传统券商接入**

| 字段 | 说明 |
|------|------|
| broker_type | ibkr/alpaca/tradier |
| credentials_encrypted | 加密凭证 |
| paper_trading | 是否模拟交易 |
| status | pending/connected |

---

## 技术债（待清理）

### account_relations — 已删除（v46）
v46（2026-04-06）DROP TABLE，account-relations.js 同步删除。

---

### interaction_records（73163 条）⚠ 半死表
**应迁移到 chain_events，但仍有 17 处活跃读取**

```
状态：
    写入：discovery.js:255 仍在写（Scout 上报时）
    读取：chain-data.js(7处) + events.js(7处) + discovery.js(2处) + conversations.js(1处)
    替代：chain_events 字段是其超集，完全可迁移
处置：P1 — 逐步迁移 17 处读取到 chain_events，再停写，最后 DROP TABLE
```

字段对照：

| interaction_records | chain_events 等价 |
|---------------------|-------------------|
| interaction_type='handshake' | event_type='handshake' |
| interaction_type='comm' | event_type IN ('comm','comm_sent','comm_received') |
| occurred_at | observed_at |
| address_a/address_b | from_address/to_address |

---

## 观察中（空表或低用）

### contracts（0 条）
SIL 合约系统遗留，目前无任何数据，功能未启用。

### probe_logs（0 条）
主动探测日志，功能存在但未使用。

### mm_quotes（1 条）
做市报价快照，数据极少，主要用于 UI 展示当前价差。

### trade_executions（149 条）
CEX 拆单执行记录，trading 页面使用。

### trade_log（2 条）
交易日志，数据极少。

### trade_baselines（9 条）
持仓基线，用于 PnL 计算。

---

## 索引规范

所有主键用 UUID（TEXT），SQLite 自动创建 `sqlite_autoindex_*`。
业务索引命名规范：`idx_{表名缩写}_{字段}`

---

## 修改规范

1. 加字段：migrate.js 新版本，用 `ALTER TABLE ADD COLUMN`，加幂等检查
2. 删表：migrate.js 新版本，`DROP TABLE IF EXISTS`，先确认 0 调用方
3. 改字段：SQLite 不支持直接改，需建新表→迁移→删旧表
4. 新表：migrate.js 新版本，加 `IF NOT EXISTS` 保护

**当前最新版本：v45（tx_records 加 local_address）**
