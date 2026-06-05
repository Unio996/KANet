# KANet 数据库字典

> 版本：2026-04-23
> 数据库：kasia-console/data/console.db（SQLite）
> 总表数：37 张（v68 新增 retail_dex_orders）
> migrate.js 当前版本：v69
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
| **交易系统** | mm_orders, mm_quotes, fund_locks, exchange_offers, exchange_accounts, retail_dex_orders | 活跃核心 |
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
| classification | TEXT | 身份质量（和 status 正交）：seen_candidate / declared_candidate / responsive_agent / verified_agent / inactive_agent，只升不降 |

**写入方**：ingest-service.js（observeHandshake/acceptHandshake）、relation-state.js（acceptHandshake → responsive_agent）、exchange-machine.js（completed → verified_agent）、agent-cards.js（processAgentCard → declared_candidate）
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

### kaspa_tx_log（v60，嵌入式 Kaspa TX indexer）
**嵌入式索引器：Relay 订阅 block-added 事件，把流经的 Kaspa TX 写入本表**

| 字段 | 类型 | 说明 |
|------|------|------|
| tx_id | TEXT PK | Kaspa TX hash |
| block_hash | TEXT | 所在块哈希 |
| block_time | INTEGER | 块时间戳（unix seconds）|
| from_address | TEXT | 发送方（best-effort，常为 NULL 因 Kaspa RPC 不返回 input address）|
| to_address | TEXT NOT NULL | 收款方（过滤 watched_addresses 后的匹配输出地址）|
| amount | REAL | 收款金额 KAS（sompi / 1e8）|
| outputs_json | TEXT | 原始 outputs 数组 JSON，留证据 |
| observed_at | TEXT NOT NULL | Relay 上报 Console 的时间 |
| network | TEXT | mainnet / testnet |

**索引**：idx_kaspa_tx_log_to_address / from_address / block_time

**写入方**：kasia-relay/src/rpc-listener.mjs:indexBlockTxs() → /ingest/kaspa-tx → ingest.js
**读取方**：cross-chain-verify.mjs _verifyKaspa()（本地优先）

**背景**：Phase 1 S10B 发现 `chain === 'kaspa'` 分支长期是硬编码 `confirmed: true` stub，绕过所有验证。根因是 Kaspa RPC 无 getTransaction，UTXO 查询在 output 被 spent 后立即失效（f8e70ae1 真实受害案例）。v60 migration 建表，Relay hook block-added 事件过滤 watched addresses 写入本表，verifier 改为本地表查询优先、RPC UTXO fallback。返回值带 `source: 'local_indexer' | 'rpc_fallback'` 方便审计。

**watched 范围**：本地 agents + exchange 对手方 + 近 30 天 identities（通过 /api/indexer/watched-addresses endpoint 返回给 Relay，每 60s refresh）

**陷阱**：from_address 常为 NULL 因 Kaspa RPC input verboseData 不总是填。验证用途不依赖 sender，只用 tx_id + to_address + amount。

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
| reply_to | TEXT | kanet:v1:msg: 格式消息的引用 ID（支持 /story 线程展示） |

**写入方**：kaspa-scout/src/message-indexer.mjs（v49 起含 reply_to）
**读取方**：Relay catch-up 逻辑、/story 线程展示

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
| **privkey_encrypted** | TEXT | **v157 r281** — 加密的裸 kaspa 私钥（64 hex/32 byte）。null=助记词型 relay。与 mnemonic_encrypted 二选一，导入私钥时只走此列 |
| **privkey_hint** | TEXT | **v157 r281** — 固定标记 `'privkey-imported'`，**不含任何私钥字节**，仅 UI 标识私钥型 relay |
| network | TEXT NOT NULL | mainnet/testnet |
| adapter_node_id | TEXT | 关联 Adapter |
| proactive_interval_minutes | INTEGER | proactive 间隔（默认60） |
| evolution_interval_hours | INTEGER | reflection 间隔（默认24） |
| vision | TEXT | Agent 人格愿景 |
| principles_json | TEXT | 行为原则 JSON |
| style | TEXT | 风格描述 |
| social_style | TEXT | balanced/proactive/reactive |
| trading_config_json | TEXT | 交易配置 |
| is_bot_autoreply | INTEGER | v67 bot autoreply 标记 |
| is_dex_broker | INTEGER | v68 DEX Broker 标记 |
| is_service | INTEGER | v? service relay 标记 |
| broker_referral_code | TEXT | v124 broker referral 码 |
| broker_stake_locked_kas | REAL | v124 broker stake KAS |
| broker_stake_lock_until | TEXT | v124 broker stake unlock 时间 |
| broker_approved_by | TEXT | v124 broker 批准者 |
| broker_approved_at | TEXT | v124 broker 批准时间 |
| **is_oracle** | INTEGER | **v124 r211 v3** — Path D oracle relay 标记，is_oracle=1 + isRelayAlive() 同时满足才可被 maker 选为 outcome_oracle_relay_id |
| **oracle_capabilities** | TEXT | **v124** — JSON array oracle 能力（e.g. `["kanet_ai_consensus_v1","polymarket_uma_mirror"]`） |
| **oracle_stake_locked_kas** | REAL | **v124** — oracle stake KAS（Phase 4 SS escrow） |
| **oracle_reputation_score** | REAL | **v124** — oracle 信誉分（Phase 4+ 由 settle 历史累计） |

**写入方**：relay API（用户配置）、bettor-prediction-voter.js (v124 oracle 字段)
**读取方**：mind-manager.js、health API、几乎所有 Agent 操作、bettor.js publish (v124 is_oracle + isRelayAlive)、bettor-prediction-voter.js cron tick
**v124 r211 v3 oracle 字段意义**：Path D 设计 = maker 在 publish 时自选 oracle relay_id（必满足 `is_oracle=1` + `isRelayAlive()` PB-A 实现）。Phase 3a MVP 5 J1tn-* (Alice/Bob/Carol/Dave/Eve) 全 `is_oracle=1` + `oracle_capabilities=["kanet_ai_consensus_v1"]`，3-of-5 multi-sig quorum 走 `PredictionEscrowMulti.sil`。

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
| maker_kaspa_addr | TEXT | v122 maker Kaspa addr 双锚 |
| maker_relay_id | TEXT | v122 maker relay UUID |
| outcome_market_source | TEXT | r177 Phase 2 prediction market source (polymarket/kanet_native) |
| outcome_condition_id | TEXT | r177 Phase 2 prediction market condition id |
| outcome_token_id | TEXT | r177 Phase 2 prediction CLOB token id (= clob_token_ids 查询 key) |
| outcome_side | TEXT | r177 Phase 2 maker 押的 side (YES/NO) |
| outcome_end_date | TEXT | r177 Phase 2 market 截止时间 (settler 触发 condition) |
| outcome_oracle_hook | TEXT | r177 Phase 2 oracle hook 类型 (polymarket_uma_mirror/kanet_ai_consensus_v1) |
| outcome_max_deviation_pp | REAL | r177 Phase 2 价格 deviation 上限 pp |
| published_price | REAL | r177 Phase 2 publish 时价格快照 |
| **outcome_oracle_relay_id** | TEXT | **v124 r211 v3** — Path D maker 自选 oracle relay UUID (= relay_nodes.id where is_oracle=1)；触发 settler dispatcher 走 collectMultiOracleVotes (3-of-5 quorum) |
| **resolution_rule_spec** | TEXT | **v124** — JSON 5 字段 `{data_source_canonical, secondary_sources, ambiguity_handler, dispute_keywords, edge_case_examples}` (= structured oracle 判定规则，voter daemon 读取 deriveVote) |

**写入方**：exchange.js（乐观写入）、trade-protocol-filter.js、bettor.js publish (r211 v3 oracle 字段)
**读取方**：/exchange 页面、bettor-prediction-settler.js (collectMultiOracleVotes + verifyPredictionOutcome dispatcher)、bettor-prediction-voter.js (扫 outcome_oracle_relay_id=this)
**v124 r211 v3 dispatcher 规则**：settler.js#L91 `if (offer.outcome_oracle_relay_id) → collectMultiOracleVotes(aggregator) else → verifyPredictionOutcome(legacy polymarket gamma)`。Phase 3a aggregator 走 chain_events.event_type='oracle_vote' query + 3-of-5 quorum tally + dedupe by voter_relay_id。

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

## 预言机池层（v0.6+ chain-derived）

> Bettor 2026-06-05 钦定 docs/2026-06-05-oracle-pool-single-source-enforcement.md：
> **canonical 单一源** 焊死。`oracle_pool_membership` DEPRECATED (零新读零新写)。
> 池成员/stake/lock 走 `oracle_pool_chain_view`，PK→relay_address 走 `oracle_stake_enrollments`。

### oracle_stake_enrollments（v162+）
**链上 stake 注册表：oracle 把 stake 锁进 OracleStake_v1 P2SH 的 envelope ingest 记录**

**字段**：staker_pk_x (PK), lock_until_daa, p2sh_addr, p2sh_hash, outpoint_txid/index,
amount_sompi, active, **source** (`chain_envelope` = path A 跨节点确权 / `manual` = 本地 INSERT 仅 debug),
relay_address (v166 +, = oracle PK 绑定的 relay 接收 DM 地址).

**写入方**：scout ingest `oracle_stake_enroll_v1` broadcast envelope (`pool-broadcast.mjs`) → trade-protocol-filter 路 A handler。
**读取方**：`oracle-pool-chain-scanner.mjs` (派生 chain_view) / settler PK→relay_address 映射 / `/api/oracle-pool/chain-snapshot`。
**陷阱**：`source != 'chain_envelope'` 行不算 path A 池成员 (= strict 模式过滤掉)。relay_address NULL 的旧行需 backfill 重广播 envelope v2。

---

### oracle_pool_chain_view（v162+）
**池快照 cache：scanner 跑 finality_n 锚定的 (snapshot_daa, leaves, root) 派生结果**

**字段**：snapshot_daa (PRIMARY KEY), leaves_json (JSON {pk_x, stake_sompi, lock_until_daa, p2sh, outpoint_txid, outpoint_index} 数组按 pkX 升序), merkle_root (64-hex), pool_size, derived_at。

**写入方**：`oracle-pool-chain-scanner.mjs` `scanAndDerivePool()` (主)+ cron (`oracle-pool-chain-scanner-cron.mjs` 每 5min)。
**读取方**：`derivePoolMerkleRoot(snapshotDaa)` → `pool-market-settler-v06.mjs` → `pool/create-v07`. UI 经 `/api/oracle-pool/chain-snapshot`. NWT verifier L5 跨节点 byte-exact diff。
**陷阱**：snapshotDaa = currentDaa − FINALITY_N (= 600 默认)；必 take EXPLICIT snapshotDaa, 不能 latest (跨节点漂)。

---

### oracle_pool_membership — DEPRECATED（v159 legacy）
**Bettor 2026-06-05: ZERO new reads, ZERO new writes. 用 chain_view + enrollments 替**

旧 v159 v0.6 path A 真池表，关 1 行 = 1 active oracle，含 oracle_pk + stake_locked_kas + relay_id。
**陷阱**：本地表跨节点必漂 (J1 r317 实证: :3300 缺 7212edc7 → settler L342 pkToRelay Map miss → committee 跳过 PK → poolSize=0 → 首 settle 卡 1hr)。
**只剩 audit 用**：grep 看历史读者迁移进度。Bettor ⑥ DROP migrate 在所有读者迁完确认零读者后做。

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

### retail_dex_orders（v68/v69，活跃）
**零售 DEX Agent 订单簿：手机 Kasia 用户下单经 Broker 代发协议走非托管成交**

Dex-Agent 的状态机数据源。每笔 DM 下的订单从 `aligning` 开始，经对齐追问 → 报价确认 → 支付 → 执行 → 完成。非托管语义：`agent_pay_addr` 存的是 Maker 的 BSC 地址（不是 Broker 的），Broker 全程不持有用户资金。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| user_kasia_address | TEXT NOT NULL | 手机用户 Kasia 地址（主键的查询字段） |
| side | TEXT NOT NULL | buy_kas / sell_kas（CHECK 约束） |
| order_type | TEXT NOT NULL | market / limit |
| qty | TEXT NOT NULL | KAS 数量 |
| price | TEXT | limit 单价（市价为 null） |
| pay_chain | TEXT | 用户付款链：BSC/ETH/TRON/SOL（aligning 阶段追问填入） |
| pay_address | TEXT | 用户付款钱包地址（退款用，非托管下 Broker 不主动退） |
| receive_address | TEXT | 卖单：用户 USDT 收款地址（sell_kas 场景） |
| quoted_usdt | TEXT | Maker offer.want_amount 按 qty 比例算出（非托管不加 spread） |
| agent_pay_addr | TEXT | **v69**: Maker 的 BSC 收款地址（用户直付这里，**不是 Broker**） |
| mid_price_at_quote | TEXT | **v69**: 报价时的单价（USDT/KAS），写入 Maker offer 算出的 unit price |
| state | TEXT NOT NULL | 10 态：aligning→confirming→awaiting_payment→paid→executing→completed；分支 refunding/refunded/failed/expired（CHECK 约束） |
| pay_tx_hash | TEXT | 用户 USDT 付款 TX（用户在 awaiting_payment 回复 txhash） |
| exchange_offer_id | TEXT | 锁定的 exchange_offers.id（confirming 阶段选中） |
| deliver_tx_hash | TEXT | Maker 的 KAS delivery TX（从 offer.delivery_tx 复制） |
| refund_tx_hash | TEXT | 退款 TX（非托管下保留字段，当前不用） |
| error_reason | TEXT | 失败原因（如 non_custodial_maker_refund_required） |
| expires_at | TEXT | 订单过期时间（默认 30 min，processTimeouts 扫） |
| created_at / updated_at | TEXT NOT NULL | ISO 时间戳 |

**索引**：idx_retail_dex_user (user_kasia_address, state)、idx_retail_dex_state (state, updated_at)

**写入方**：retail-dex.js（handleDm createOrder / 状态推进 / orderMonitorTick）
**读取方**：retail-dex.js 本身；UI 目前未接入

**相关列**：`relay_nodes.is_dex_broker`（v68）标记这个 relay 是 DEX Broker，其 DM 走 retail-dex 流程绕开 Mind；`exchange-machine.js` auto-pay/auto-send-KAS 对 `is_dex_broker=1` 硬门控关闭，保证 Broker 零资金托管。

**陷阱**：
- `state` 包含 10 个 CHECK 值，加新态必须 migrate.js 改约束
- `agent_pay_addr` 字段名历史遗留（原托管 v0 时存 Broker 地址），v2 非托管语义改成存 Maker 地址但字段名未改
- 非托管下 `refunding → refunded` 路径不可达（Broker 不持币），refunding 直接推 failed

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

### interaction_records — 已删除（v47）
v47（2026-04-06）DROP TABLE。
所有读取已迁移到 chain_events，discovery.js 停止写入。

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

### trade_log（12+ 条）
CEX 交易日志。v51 新增 `exchange` 列记录交易所归属（旧记录为 NULL）。日限额 `GET /api/trade/daily-usage` 从 chain_events 查 `cex_sell_placed` 事件。

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

**当前最新版本：v157（r281 私钥型 relay — relay_nodes 加 privkey_encrypted + privkey_hint）**

> 注：v125–v156 尚未在本表逐条回填（r281 scope 外）；新增 migration 接 v157 之后。

## 版本历史（近期）

- **v157 (2026-05-30 r281 私钥型 relay)**: `relay_nodes` 新加 `privkey_encrypted` + `privkey_hint`（裸 kaspa 私钥型 relay 支持，幂等 additive，不破助记词型）。详见 `KANet-Knowledge-Base/architecture/2026-05-30-privkey-relay-spec.md`
- **v124 (2026-05-20 r211 Phase 3a v3 oracle)**: `exchange_offers` 新加 `outcome_oracle_relay_id` + `resolution_rule_spec` (= Path D maker 自选 oracle + 5 字段 structured 判定规则); `relay_nodes` 新加 `is_oracle` + `oracle_capabilities` + `oracle_stake_locked_kas` + `oracle_reputation_score` + `broker_referral_code/broker_stake_locked_kas/broker_stake_lock_until/broker_approved_by/broker_approved_at` (broker treasury 字段同 line 出 v124)
- v122 (2026-05-19 r177 Phase 2 prediction market): exchange_offers 新加 outcome_* 字段 (= polymarket-style prediction market on Kaspa) + `maker_kaspa_addr` + `maker_relay_id`
- v69 (2026-04-22 T6): retail_dex_orders.agent_pay_addr + mid_price_at_quote
- v68 (2026-04-22 T2): retail_dex_orders 新表 + relay_nodes.is_dex_broker
- v67: is_bot_autoreply on relay_nodes
- v64: social_spend_log
