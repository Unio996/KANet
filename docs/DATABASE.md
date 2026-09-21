# KANet 数据库字典

> 版本：2026-04-23
> 数据库：kasia-console/data/console.db（SQLite）
> 总表数：37 张（v68 新增 retail_dex_orders）——⚠ 此行 stale，v69 后新表未回填总数，以 sqlite_master 实数为准
> migrate.js 当前版本：v190（2026-07-23 m0c1_app_grants；此前头部长期 stale 写 v69，以 migrate.js 实际为准）
> 维护原则：改表前必查本文档，确认影响范围

---

## 总览

### 表分类

| 类别 | 表名 | 状态 |
|------|------|------|
| **核心社交** | relation_states, identities, conversations, messages | 活跃核心 |
| **链上数据** | chain_events, tx_records, kanet_message_index, broadcast_messages, submit_intents（v202） | 活跃核心 |
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

### group_chat_log / agent_groups — 规格残留（v149 建，恒 0 行，无写入方/无读取方）

**2026-08-18 J2 实核（全仓 ripgrep + 本机库计数）**：两表同批由 **v149**（Tier 2.2 N-way 群聊设计）建。本机库现状：**两张表各 0 行**。全仓生产代码（`.js`/`.mjs`）**无任何写入方、无任何读取方**——唯一读过 `group_chat_log` 的是两个 **gitignored 根目录 scratch 脚本**（`kasia-console/_nwt_read5.cjs` / `_nwt_read6.cjs`，2026-06-09，非入库文件），把它当频道消息表查，永远返回空且不报错。

**陷阱（本条即案例）**：该库真正的频道公开消息表是 `broadcast_messages`（见上）；若脚本/查询误查 `group_chat_log`，静默拿到空结果，不会报错——KANet-UI 2026-08-18 复核 §6-1 ⑤ escape-hatch live-check 时正撞上此形状（跑了一份未入库的旧 scratch 脚本查这张空表，读数与权威脚本 `scripts/u1-escape-hatch-live-check.cjs`（查 broadcast_messages）不符，经 J2 澄清+独立重跑确认非数据问题）。

**处置（J2 建议，非删表）**：零行零引用，风险不在留着，在"删表"本身要过迁移+审；留着 + 登记文档，让下一个人一秒判掉即可。

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
| status | TEXT NOT NULL | broadcasted（永远是这个，已知局限——语义不改；"落链"看下面四列） |
| network | TEXT NOT NULL | mainnet/testnet |
| target_address | TEXT | 收款地址（v202 · (c) F4/F5 · relay `transfer` 分支传 `cmd.target`；老行 NULL） |
| landed_at | TEXT | 落链时间（v202 · 对账器 `tx-landed-reconciler` 回写：kaspa_tx_log 命中取 block_time，UTXO 集命中取检查时刻） |
| landed_depth | INTEGER | 落链深度 = 当前 DAA − 块 DAA（v202 · 块 header 已剪时 NULL） |
| landed_checked_at | TEXT | 对账器最近一次核过的时间（v202 · 三源都无时也更新） |

**写入方**：ingest-service.js（ingestTx，16 处调用全部补传 local_address；`target_address` 目前只有 relay `transfer` 分支传）；`landed_*` 三列只由 `services/tx-landed-reconciler.mjs` 写
**读取方**：ledger API（花费统计唯一来源）；对账器 `WHERE direction='outbound' AND landed_at IS NULL AND created_at < now−10min`（索引 `idx_tx_records_direction_landed`）

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
**v124 r211 v3 oracle 字段意义**：Path D 设计 = maker 在 publish 时自选 oracle relay_id（必满足 `is_oracle=1` + `isRelayAlive()` PB-A 实现）。Phase 3a MVP 5 J1tn-* (Alice/Bob/Carol/Dave/Eve) 全 `is_oracle=1` + `oracle_capabilities=["kanet_ai_consensus_v1"]`，Phase 3a 设想的 3-of-5 multi-sig 从未实现（silverc 无 `checkMultiSig`，`PredictionEscrowMulti.sil` 已于 2026-08-30 移除），实际托管 = `PredictionEscrowUnanimous5.sil` 5-of-5 unanimous，见 `prediction-escrow-ss.mjs:33/:142`。

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

### execution_states（2026-07-12 实查 0 条，文档曾记"167 条"已 stale——历史某次 DB 重置/清库后未同步更新此行，数字快照类注记不代表当前状态，改表前必须现查不能信文档数字）
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

**`type='user_feedback'` 场景（feedback.js openTicket, 2026-07-12 卡B）`action_details` JSON 形状**：
`{ linkedAddr, summary, rawText, escalated, is_simulated, escalated_at? }`。`is_simulated`
（2026-07-17, S1, 设计 `docs/2026-07-17-s1-support-cases-simulated-traffic-isolation-design.md`）
= 该工单是否走 `TEST_HARNESS_TOKEN` 标记的模拟流量，只有独立测试凭证校验通过才能置 `true`（不来自
任意 HTTP body 字段，物理隔离于文本约定）；`events.payload_json`（`event_type='feedback_escalated'`）
镜像同一个值，供 `owner-bot.mjs pollFeedbackEscalations` 过滤——`is_simulated:true` 的升级完全不
转发到 `dev-coord-testnet`（不进 Owner 真实身份广播链路，减攻击面优先于隔离频道方案）。

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
| **escrow_landed_at / escrow_landed_depth** | TEXT / INTEGER | **v203 · (c) 第 5 笔 (B) 硬消费门** — maker 锁仓（metadata.escrow_lock_tx）落链时刻/深度。唯一写入方 `tx-landed-reconciler` 经 `escrow-landed-gate.applyIntentLanded`（submit_intents kind escrow_lock/maker_stake landed）。**不变量**：带 escrow 锁的预测 offer，`escrow_landed_at IS NULL ⇒ transition 拒 matched/verifying/delivering/completed`（无 taker 接受/无匹配/无结算资格/无价值移动/无声誉终态），taker-stake 处理器 409，settler 跳过；refunded/cancelled/expired/timed_out/disputed 不拦 |
| **taker_escrow_landed_at / taker_escrow_landed_depth** | TEXT / INTEGER | **v203** — taker 押金（列 taker_escrow_lock_tx）落链时刻/深度；有 taker 锁时结算态（verifying 起）还要它非空 |

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

### submit_intents（v202 · (c) NO-TX-NO-STATE F2 · 2026-09-13 J2）
**广播前持久 submit-intent：每一笔"console 派 relay 转账"的幂等身份 + 两阶段回执 + 落链回写**

| 字段 | 类型 | 说明 |
|------|------|------|
| intent_key | TEXT PK | 幂等键：`payout:<offer_id>` / `escrow:<bet_id>` / `stake:maker:<bet_id>` / `stake:taker:<bet_id>`；重建 attempt≥2 加后缀 `#n` |
| intent_kind | TEXT NOT NULL | payout / escrow_lock / maker_stake / taker_stake |
| offer_id | TEXT NOT NULL | exchange_offers.id（或 bet/pending offer id） |
| relay_id | TEXT | 执行转账的 relay（relay_nodes.id）；捡回/核落链都问它 |
| target_address | TEXT NOT NULL | 收款地址 |
| amount_kas | TEXT NOT NULL | KAS 字符串（8 位小数，KI-30） |
| status | TEXT NOT NULL | pending → prepared → submitted → landed；abandoned = 旧 txid 的输入已被别笔花掉后重建（CHECK 约束；`markIntent` 单调不退） |
| attempt / parent_intent_key | INTEGER / TEXT | 重建链：`#2` 行的 parent 指向被 abandoned 的原行 |
| prepared_txid | TEXT | 确定性 txid（签名前后/序列化往返不变；relay 广播【之前】经 `/ingest/submit-intent` 写入） |
| prepared_tx_json | TEXT | 已签名交易字节（`serializeToSafeJSON` 数组）。重启捡回只允许**同字节重播**（relay `finalize()` 重算 txid 断言相等）；有 txid 无字节 ⇒ 不发不建 + 告警 `intent_prepared_without_bytes` |
| submitted_txid | TEXT | 广播后的 txid（正常 == prepared_txid） |
| landed_depth / landed_at | INTEGER / TEXT | `check_utxo_landed(minDepth=REORG_SAFE_MIN_DEPTH)` 或对账器三源回写 |
| last_error | TEXT | 最近一次失败原因（截 500 字） |
| created_at / updated_at | TEXT NOT NULL | ISO |

**索引**：idx_submit_intents_status_updated(status, updated_at) / idx_submit_intents_offer(offer_id, intent_kind)

**写入方**：`lib/submit-intent.mjs`（console 侧 pending/submitted/landed/abandoned；调用方注入 `sendCommandAsync`，本模块不 import relay-manager = M0a 门）；`POST /ingest/submit-intent`（relay 侧 prepared{txid,bytes}/submitted 回执，未知 key 409）
**读取方**：`bettor-prediction-settler.js`（派彩 + delivering 扫描 + prepared 陈行捡回）· `api/bettor.js` 三处 escrow 锁仓 · `tx-landed-reconciler.mjs`（submitted>30min 三源核、prepared>2min 告警）

**陷阱**：① `txId` 回来只是 submitted（进 mempool）≠ landed，推进"完成"态前必须 `checkIntentLanded(minDepth>0)`；② attempt≥2 的重发判据只能是本表 + relay 侧（mempool / UTXO / 同字节重播），**永不读 exchange_offers.metadata**（向量 F2-I5-弱注入 证明删了本表行就会重发）；③ kaspa-wasm `deserializeFromSafeJSON` 信 JSON 里的 `id` 不重算，改过的字节顶着旧 id 能过——relay 重播前必 `finalize()`（serialize-roundtrip.test.mjs 两臂钉住）；④ 残余双付窗（设计 v0.3 F2-R 如实记）：旧笔已落且收款方在重试窗内又花掉、且收款地址不在索引器 watched 集 ⇒ 重播判 inputs_spent ⇒ 重建。

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

## 预测市场分片层（v171+, bshard 无限押注）

> Owner 2026-06-15 #1 directive：分片(sharding)+自取(self-claim) = 无限押注设计。一个**逻辑市场** =
> N 个**物理分片**；每片 = 独立的 `pool_markets` 行（自己的 market_id + spine_p2sh），装保守 ≤32 bettors，
> 一笔普通 settle_aggregate TX 结算（不分块、不撞 mass cap）。片数无上限 → 总容量无限。跨片全局赔率走
> trustless fold 树（J1 `PoolShard_fold.sil` ddd043d7），winner 自取（`PoolSide_v07 claim_winner`）。
> 设计：`docs/2026-06-02-bshard-rolling-design-consensus.md` / `docs/2026-06-14-bshard-fold-trustless-§4-consensus.md`。

### market_shards（v171+）
**滚动分片注册表：逻辑市场 ↔ 物理分片(pool_markets) 映射 + 顺序填分配锁**

**字段**：id (PK AUTOINCREMENT), logical_market_id (用户面市场 group key), shard_index (0,1,2... 顺序填),
shard_market_id (= 本片 `pool_markets.id`，KANet-UI 按此 join `pool_bettor_sides` 聚合赔率 / fold 叶),
shard_p2sh (本片 PoolSpine P2SH，denorm 给 fold调度 by-root), bettor_count, projected_settle_mass
(= Σ `estimateStorageMass(stake)`，复用 `kip9-mass.mjs`), status (open|sealed|settling|settled|refunded),
created_at, sealed_at,
**current_leaf_outpoint** (v172, `txid:idx`，当前 ShardLeaf 续约 UTXO outpoint — (A) 模型 ShardLeaf covenant 每 register
续约地址变，shard_p2sh 只 holds 创世；buildRegisterCommand 下一笔 register 的 leaf input)，
**current_leaf_state** (v172, JSON `{count, local_yes, local_no, pool_value}` — `spliceLeafState` 重算续约 redeem，
不存全 redeem_hex，J2 已验 byte-equal)，
**shard_token_tmpl_hash** (v205, 2026-09-14, D-019 迁移——`ShardLeaf.sil` T3 代币化 ctor-only 常量，创世时
由 T4 单源产物写入，允许 NULL；genesis-mint 时缺值须 fail-loud 拒绝，不猜值)。
**UNIQUE(logical_market_id, shard_index)** = 注册竞态锁（并发开新片只一个 INSERT 赢，输者重试读已开片）；
**UNIQUE(shard_market_id)** = 一物理片一行。索引 `idx_market_shards_open(logical_market_id, status)`。

**写入方**：`src/lib/shard-allocator.mjs`（registerShard / sealShard / onBettorRegistered），register 流路由。
**读取方**：fold调度 by-root（listShards 按 shard_index ASC）/ KANet-UI 跨片赔率聚合 `/api/pool/markets` /
allocateForRegister 顺序填。
**封片规则**（保守，Owner 钦定）：bettor_count ≥ 32 **OR** projected_settle_mass > 380_000（< 470k SAFE）→ 封片开下一片。
**陷阱**：market_shards 是**链锚分片集的本地索引**（同 pool_markets 是链上市场的本地 cache）；logical↔shard 链接烤在
分片 PoolSpine ctor（J1 shard variant）→ 每节点派生同分片集（by-root determinism）。double-count 由
`pool_bettor_sides` 的 `UNIQUE(market_id, bettor_pk)` (v62) + 链上 PoolSide spent-once 双堵。

### pool_markets（v62+，预测市场核心表）
**一行 = 一个"市场"——注意 bshard(v0.7) 下这可能是逻辑市场，也可能是它的某个物理分片**

**字段（节选，完整见 `migrate.js` v62 建表 + 后续 `ALTER TABLE`）**：id (PK，市场标识，形如 `ext-pool-v07-<ts>-<slug>` 或分片 id `<logical>-s<N>`), maker_relay_id, spine_p2sh/spine_lock_tx（PoolSpine covenant 锚点）, deadline/deadline_daa, protocol_version（v0.5/v0.6/v0.7）, protocol_status（pending_bettors → collecting_sigs → verifying → settling/refunding → completed/refunded/shard_internal 等，见各服务的状态机)，maker_stake_amount/broker_fee_pct/oracle_bond_amount/miner_fee, outcome_*（预言机源绑定), settle_txid/refund_txid, metadata（JSON，`settle_evidence`/`phase2_outputs`/`fee_rules` 等结算期写回都堆在这一列——见下方陷阱), sides_merkle_root/pool_merkle_root, fee_rules（v184, write-once trigger）。

**写入方**：`pool.js` create-v07/v06（建市场）→ `pool-market-settler.js`/`bshard-settle-daemon.mjs`（结算写回 `protocol_status`+`metadata.settle_evidence`）→ voter/oracle 服务（委员投票中间态）。
**读取方**：`/api/pool/my-positions`（用户仓位+赔付展示）/ `/api/pool/markets`（列表）/ settler/voter 每 tick 扫描 / prediction-menu.mjs（TG bot 展示）。

**🔴 陷阱（H2 bug 根因，2026-07-17 补，docs/2026-07-17-h2-mybets-multiwin-split-design.md）**：bshard 市场的"逻辑市场"和"物理分片"**都是 `pool_markets` 里独立的一行**（分片 id 形如 `<logical>-s0`/`-s1`），通过 `market_shards.shard_market_id → logical_market_id` 关联。**结算证据(`metadata.settle_evidence.winner_details`) 只写在逻辑市场那一行，且按 `bettor_pk` 聚合(一个 pk 一条，amount = 该 pk 在整个逻辑市场的总赢得金额)**——不是按分片/按行。若同一 bettor 在同一逻辑市场的**不同分片**各下过注（`pool_bettor_sides.UNIQUE(market_id, bettor_pk)` 只挡同一分片内重复，挡不住跨分片），读侧必须按 stake 比例把这一份聚合 amount **拆給** 该 bettor 在这个逻辑市场+方向下的所有行，不能直接原样赋给每一行（否则金额被算重复次）——`pool.js` 的 `splitWinnerAmountByStake()`(H2 修复引入) 就是做这件事的，任何新读路径复用 `winner_details` 时必须走同样的拆分，不能重蹈。

### pool_bettor_sides（v62+，逐笔下注记录）
**一行 = 一笔独立下注（一个 bettor 在一个 market_id/分片、一个方向上的一次锁仓）**

**字段**：id (PK AUTOINCREMENT，跨分片场景下唯一稳定排序键，H2 largest-remainder 拆分用它做确定性排序), market_id (REFERENCES pool_markets(id)——bshard 下是**分片** id，非逻辑市场 id), bettor_pk, bettor_relay_id, direction (0=YES/1=NO), stake_amount (sompi), side_p2sh/side_lock_tx（下注锁仓 P2SH+锁仓 tx）, merkle_index, claim_txid（**语义已废弃 for bshard 赢家**——唯二写入点 `bettor-refund-claim-auto.mjs:126`+`pool.js:501` 都只服务退款路，bshard 赢家 claim 循环 `bshard-auto-settler.mjs:407-460` 从未写这一列，故 bshard 赢家此列永远 NULL；赢家真实 claim 信息在 `pool_markets.metadata.settle_evidence.winner_details`，用户面已改读那里（`pool.js:3339-3353`），内部 `audit-prediction.js` 尚未跟进仍读本列会误报"未 claim"，见 `docs/2026-07-21-28-state-sync-architecture-full-design.md` 表2.2 #4/#6), side_lock_daa（v187+，下注锁仓块的 DAA score，backward-walk 从链上派生，见 `docs/2026-07-08-backward-walk-daa-index-design.md`——**若此列长期 NULL 且已过物理剪裁点(pruningPoint daaScore)，本地/任何节点均无法再补，是永久性的，非"待补"**）, pay_amount_sompi, refund_attempted_at。

**唯一约束**：`UNIQUE(market_id, bettor_pk)` — 只挡"同一 bettor 在同一 market_id(分片)重复下注"，**不挡跨分片**（同一 bettor 在同逻辑市场的不同分片各下一笔完全合法，也正是上面 H2 陷阱的成因）。

**写入方**：`pool.js` register-v07/v06 confirm 端点（bettor 付款确认后 INSERT）。
**读取方**：`/api/pool/my-positions`（逐行读+按 (market_id, bettor_pk) 或 (logical_market_id, direction) 分组聚合）/ settler（结算时按 market_id 汇总赔率池）/ voter（委员抽样）。

### payout_shards（v172+，每逻辑市场一个 PayoutShard covenant）
**一行 = 一个逻辑市场唯一的 consolidation sink covenant（每片 ShardLeaf consolidate 目的地，genesis-mint 一次）**

**字段**：logical_market_id (PK), payout_cov_id, payout_ps_addr (P2SH 地址), payout_ps_outpoint (`txid:idx`), payout_redeem_hex (当前 redeem，随 consolidate/close 推进而 splice 更新), pool_merkle_root, predicate_commit, created_at, **covenant_family**（v189, 2026-07-21, K-18 §3.1——`v1_committee`(committee-sig)/`v2_zk`(ZK-native)/`unknown`(backfill 判不出，需人工归因)，不可变列，genesis-mint 时由写入点声明——`ensurePayoutShard`→`v1_committee`/`ensurePayoutShardV2`→`v2_zk`；`src/lib/bshard-payout-family-coherence.mjs` 提供 `assertPayoutShardCoherence` 四步一致性花费前 gate + `assertZkNativeImmutable` 铸后不可变守卫），**token_tmpl_hash / claim_tmpl_hash / market_suffix_hash**（v205, 2026-09-14, D-019 迁移——`PayoutShard.sil`/`PayoutShardV2.sil` T3 代币化 ctor-only 常量，创世时由 T4 单源产物写入，允许 NULL；结算/重编译路径（`compilePayoutShardRedeem`/`compilePayoutShardV2Redeem`）读回这三列，缺列/缺值须 fail-loud 拒结算，不能假设"现在的全局配置应该还是那个值"）。

**写入方**：`src/lib/pool-shard-register.mjs`（`ensurePayoutShard`/`ensurePayoutShardV2`，genesis-mint 时 INSERT）→ consolidate/close 流程 UPDATE `payout_redeem_hex`（splice-not-recompile 为权威，见 `docs/2026-07-21-p0-consolidated-pool-rederive-implementation-plan.md`）。
**读取方**：`bshard-settle-daemon.mjs`/`bshard-auto-settler.mjs`（consolidate/claim 编排）、K-18 backfill/coherence gate。
**陷阱**：`payout_redeem_hex` 的字段布局（state 区 offset 0/1/10/19/52 + ctor 常量区 predicateCommit@518/poolMerkleRoot@1002(V1)、predicateCommit@642(V2)）已实测定稿（`docs/2026-07-21-p2-batch1-truth-source-layer-k18-landing-design.md` §1），不是从 ctor 参数顺序推断——改动前必读该文档，不能凭 `.sil` ctor 声明顺序猜字节位置。
> 📌 **状态注记（2026-09-14 · D-019 迁移，ledger 1224/1226）**：上面这组 V2 offset（含 `_PMR_COMMITTEE_CHECK_OFFSETS_V2`）经实测确认**已随 ctor 25/27→30 参数扩容 + silverc v1.0.0 迁移全部漂移**（新实测值与旧值相差约 15000 字节量级），`payoutshardv2-offset-tripwire.test.mjs` 目前保留已知 RED——不是本条陷阱描述错了，是这批 V2 offset 字面量本身需要重新 live-derive（另立独立报备，见
> `docs/2026-09-14-j2-d019-silverc-v100-migration-inventory-v0.1.md` §2.1），V1 offset（518/1002）未在 D-019 本批范围内验证是否同样受影响。

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

### broker_onboarding（v173 建表, v194 移除 status 列, 2 条）
玩家→轻路 broker 自助 onboarding（Owner 钦定 2026-06-22, 骨架）。**铁律=地址制**：`broker_address`（UNIQUE）是 broker 身份，**非 relay_id**（玩家当玩家时绑的地址转 broker 不变）。字段：`broker_address` / `bot_token_encrypted`（Telegram bot token，crypto.encrypt aes-256-gcm 加密落库，**任何 GET 都不回**）/ `bot_username` / `note` / `created_at` / `updated_at`。**🔴 v194 (2026-07-29) 移除 `status` 列**：它 vestigial（唯一写入恒 'pending'，无产生路径），留着 = gate 陷阱（`AND status='approved'` 对恒 pending 列静默返回空 ⇒ 全 broker 永不 fork，SQL 不报错）；移除后任何 `b.status` 引用当场 SQL 报错（fail-loud）。**「哪些 broker 会被 fork」只由本表决定**（v0.6 2026-07-28：`approvedBrokers()` 只看 `bot_token_encrypted IS NOT NULL`，不再从 `identities.trust_level` 派生 approved——功能开关与社交信任解耦，信任交回 relation_states）。写入方 `POST /api/kanet-broker/onboard`（INSERT 6 列，v194 后不含 status）；读取方 `GET /api/kanet-broker/onboard/status|list` + `broker-home.eta` onboarding 卡。多-bot tg-manager（托管各 broker token 同步呈现市场）=下一步。设计 `docs/2026-07-29-broker-onboarding-status-vestigial-drop-design.md`。

### escrow_states（v175, 0 条）
Silverscript P2SH 三方托管合约状态表（2026-06-27）。表从 v175 建立；对应路由 `src/api/escrow.js` 早于表存在（v51 注释），build 后长期死路由直到此次复活。**⚠ 建表同时活化了资金操作路由，create/lock/execute 三端点挂 `verifyIngestRequest` 鉴权**。字段：`id`（UUID PK）/ `offer_id`（外键关联 exchange_offers，可 NULL）/ `initiator_relay_id`（发起方 relay_id）/ `buyer_address` / `seller_address` / `arbiter_address`（三方 Kaspa 地址）/ `p2sh_address`（合约地址，relay IPC create_escrow 返回）/ `redeem_script_hex`（赎回脚本，relay 编译结果）/ `amount_sompi`（TEXT，锁定金额 sompi）/ `deadline`（INTEGER，CLTV DAA score，NULL=无超时）/ `status`（TEXT: created/locked/released/refunded/disputed）/ `lock_txid`（锁币 TX）/ `unlock_txid`（解锁 TX）/ `created_at` / `updated_at`。写入方 `POST /api/escrow/create|lock|execute`（均需 ingest-secret）；读取方 `GET /api/escrow/list`（只读，无鉴权）。Relay IPC 依赖：`create_escrow` / `lock_escrow` / `execute_escrow`（白名单需确认）。

### zk_prove_jobs（v180 建表 + v181 补列, 0 条历史/新表）
跨机器 ZK proving 任务队列（2026-07-07，T2b ZK-native 结算生产线缺件②）。`market_id` 上的 partial unique index（`WHERE status IN ('pending','in_progress')`）是持久化幂等锁（防同一市场并发入队两个 job）。字段：`id`（PK）/ `market_id` / `status`（TEXT: pending/in_progress/done/failed）/ `ordered_bets_json`（TEXT，winner 侧 bets 数组）/ `bets_root_hex` / `attested_winner`（INTEGER）/ `fee_leaves_json`（TEXT，v181 补，默认 `'[]'`，§4 硬门⑤禁 bps-fallback 要求 guest 必须拿到完整 fee_leaves，非空数组）/ `pool_total_sompi`（TEXT，v181 补，可 NULL）/ `receipt_hex`（TEXT，RISC0 Groth16 receipt borsh-hex）/ `journal_digest_hex`（TEXT）/ `error`（TEXT，失败原因）/ `created_at` / `updated_at`。写入方：enqueue 侧（缺件①，J1 域，close_attest_v2 落链后自动 insert，走幂等锁）+ `zk-prove-server.mjs POST /zk-prove/enqueue`（手动/跨机器 HTTP 备用路径，bearer-token 门）。读取/推进方：`zk-prove-worker.mjs`（本机同 host 直读 DB, 原子 claim pending→in_progress→done/failed）+ `zk-prove-server.mjs GET /zk-prove/poll`（跨机器备用路径）。**⚠ v1 已知限制（NWT 审过接受）**：job 若长期卡在 `in_progress`（worker 进程崩溃/网络断）需手动 `UPDATE zk_prove_jobs SET status='failed' WHERE id=X` 解锁重新入队，自动超时恢复留待下个迭代。job 完成/失败会同步回写 `pool_markets.metadata.zk_continuation.proving`（T2b(i) schema，见 `closezk-v2-mint.mjs` `updateProvingReady`/`updateProvingFailed`）——job 表是内部队列记账，`zk_continuation.proving` 才是下游（`dispatchUnlockZkClose`）读取的权威状态。

### m0c1_app_grants（v190, 0 条）
M0c-1 app provision grant registry（2026-07-23, 设计 `docs/2026-07-23-m0c-1-app-provision-design.md` §2，母卡 §4.2 relay-authoritative 防 grant inflation）。DDL 单一真相源：`src/db/m0c1-grant-registry-schema.js`（migrate v190 与 provision 脚本共用）。字段：`grant_id`（UUID PK）/ `app_key_id` / `app_pubkey`（x-only 32B hex，信封验签公钥）/ `allowed_commands`（JSON array 命令类型集）/ `typed_intent_version` / `relay_scope`（JSON array relay_node_id）/ `network` / `market_scope` / `outpoint_scope` / `branch_scope` / `payee_scope`（各 JSON array，**NULL=该维度未授权=intent 触及即拒（缺维度默认最严），不是"不限制"**）/ `max_amount_sompi`（单笔上限）/ `max_cumulative_sompi`（累计上限，enforcement 归 M0c-3 审计派生，本版只存）/ `max_fee_sompi` / `valid_from` / `valid_until`（**INTEGER unix 秒**，避 ISO 字符串字典序比较坑）/ `grant_version` / `revoked` / `revoked_at` / `created_at` / `provisioned_by`。**🔴 写入方静态可枚举（M1-5）：仅 operator 离线脚本 `scripts/m0c1-grant-provision.mjs` 一处（gen-key/issue/revoke/list），零 HTTP 写/零 IPC 写；任何请求处理代码出现本表写入 = diff 审打回**。读取方：`kasia-relay/src/lib/grant-registry.mjs`（node:sqlite **readOnly** 直开，路径经 relay-manager fork env `M0C1_GRANT_DB_PATH`，每命令 fresh 读零缓存 = 吊销即时可见）。乙路 TCB 诚实边界：表在 Console 信任域内，对场景 A 有效、不抗场景 B（禁称"抗 Console"）。

### proto_token_defs / proto_markets / proto_bets / proto_bet_intents / proto_claims / proto_settlement_intents（v206/v207/v208/v209/v210, 0 条）
原型 v0 代币/市场原型（2026-09-14，Owner 直令要求可跑原型，设计 `docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md` v0.1，Bettor GREEN-with-rulings）。**完全隔离的新命名空间**：与生产 `pool_markets` / `market_shards` / `payout_shards` / `pool_bettor_sides` 零表名交集、零外键指向——`bshard-settle-daemon.mjs` 的选熟盘主查询硬编码 `WHERE protocol_version = 'v0.7'` 在 `pool_markets` 上，对 `proto_*` 结构性不可见（不是运行时过滤，是表名不重叠）。

- **`proto_token_defs`**：代币定义，纯 DB 展示层，不对应任何链上实例（Owner"代币属性配置需要界面互动"落这一层）。字段：`id`（PK）/ `name` / `ticker` / `description` / `default_denomination` / `created_at`。写入方 `POST /api/proto/tokens`（待落码）。
- **`proto_markets`**：市场壳 + 当前 UTXO 指针 + 状态机，`token_def_id` FK 指向一个 `proto_token_defs`。`committee_pubkeys_json` 存 5 委员公钥（v0 单 keypair 模拟 5 委员，5 项同值——见设计稿 §5）；`committee_privkey_enc` 用 `src/services/crypto.js` 的 `encrypt`/`decrypt`（`CONSOLE_ENCRYPTION_KEY`）加密落库，**不落明文**，且**独立于 `relay_nodes` 表**（不经 `startRelay()`/relay 管理路径）——market_genesis/bet_mint(步骤A/B) 全程不解密这把私钥（`register_append` entry 体内没有任何 `checkSig`，`bettorPk` 是无签名绑定的 witness 值，T-PROTO-BETTORPK-BINDING），只用公钥算 `committee_hash`；未来 `close_commit`(market_resolve)才需要解密签名，不在本轮范围。
  > 📌 **状态注记（2026-09-15 · J2 · 账本1423/1425 market_genesis 落码 · v207）**：`status` CHECK 由 `betting/sealed/resolved/cancelled` 扩到加 `genesis_pending`/`genesis_prepared`/`genesis_submitted`/`genesis_ambiguous` 四态，`DEFAULT` 从 `'betting'` 改成 `'genesis_pending'`——硬条件①要求"发 IPC 之前必须先 INSERT pending 行"，不再是"广播成功才 INSERT"（旧的"写入方 POST /api/proto/markets"那句已过期，见下）。新状态机（单步，不进 `proto_bet_intents`——该表 FK 是 `bet_id`，市场创世没有 bet 行）照抄 `proto_bet_intents` 的 pending→prepared→submitted→landed/ambiguous 哲学，直接落在本表七个新列上：`genesis_prepared_txid`/`genesis_prepared_tx_json`/`genesis_submitted_txid`/`genesis_landed_depth`/`genesis_landed_at`/`genesis_last_error`/`shardleaf_cov_id`。`shardleaf_cov_id`（账本1429/1431批准）是 genesis 交易 input[0] outpoint 决定的 covenant_id——一次性事实，genesis 时算一次、之后不变、库里没有其它数据能推算出来，同 `shardleaf_txid`/`shardleaf_vout` 一类（`payout_shards.payout_cov_id` 是同类先例），不属于下面"leaf State 不单独存储"那种可推算冗余。写入时机：genesis_prepared 阶段与 `genesis_prepared_txid` 一起写（`recordMarketIntentPhase` 的 `shardLeafCovId` 参数）。按 F2-R 规则 genesis 进入 ambiguous 后不重建，因此不存在"换输入后这一列过期"的路径——但如果未来任何代码路径重建了 genesis 交易，必须同时重写这一列。落链校验（fail-closed）：`checkMarketGenesisLanded` 推进到 `betting` 之前，从**落链交易的实际** input[0] outpoint 用同一个 consensus 纯函数（`kaspa.covenantId`）重新算一遍，必须等于已存的值，不一致 ⇒ `genesis_ambiguous` + 告警，不推进到可下注状态（见 `docs/provenance/2026-09-15-j2-v207-shardleaf-cov-id-column-rerun/`）。🔴 该校验目前依赖注入的 `fetchLandedGenesisTx`（M0a 手法）——生产接线还没有对应的 relay IPC 命令（现有命令只按地址查 UTXO，没有"按 txid 查完整交易结构"这一条，需要新增），不传时退化为跳过校验（过渡期兼容），这是如实记录的待办，不是被忽略的缺口。落链确认(`REORG_SAFE_MIN_DEPTH`=20, `pool-shard-register.mjs:93`)后 `status` 推进到既有的 `'betting'` 值（= "market 可下注"，复用既有语义不新造 `'active'`），同时写 `shardleaf_txid`/`shardleaf_vout`。`genesis_ambiguous` 是终态，同 (1102) F2-R 规则不 abandon 不重建，只能人工清。实现见 `src/lib/proto-market-intent.mjs`。**外键风险已实测修复**（`proto_bets.market_id REFERENCES proto_markets(id)`，重建表时 `PRAGMA foreign_keys=OFF` 必须在事务外，否则真实数据存在时 `DROP TABLE` 会被 SQLite 拒绝——见 `docs/provenance/2026-09-15-j2-v207-foreignkey-rebuild-fix/`）。§6 KAS 资金来源已裁定 (B′)：专属 `proto-` 前缀 relay 身份 + 既有 relay IPC 通道（新命令 `covenant_broadcast`），不新造签名/密钥路径，下面"已知限制"段那句"待 Owner 定"已过期，见 `docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md` §6。**当前 leaf State（`local_yes`/`local_no`/`count`/`pool_value`）不单独存储**（账本1428 Bettor 裁定：加冗余列会漂移，且"tx_json 构造成功就更新"违反 NO TX NO STATE CHANGE）——每次构造 `register_append` 前从 `proto_bets WHERE market_id=? AND status='confirmed'` 现算（`src/lib/proto-leaf-state.mjs` 的 `deriveLeafState`），并在构造前用 `assertLeafStateMatchesChain` 核对推算出的 P2SH 与链上 `shardleaf_txid:shardleaf_vout` 这个 UTXO 实际的 scriptPubKey 一致、且未被花费，不一致直接拒绝（`leaf_state_drift`），不静默用错的状态构造交易。
  > 📌 **状态注记（2026-09-15 · J2 · 账本1468/1469 · v209）**：新增列 `shardleaf_own_redeem_len INTEGER`（允许 NULL，无 DEFAULT，同上 K-18 纪律：缺列不该被默认值掩盖）。根因：`ShardLeaf_direct.sil` 的 `register_append` 自续约校验需要知道"裸编译 redeem 脚本自身的字节长度"（从完整 sigScript 里定位 redeem 脚本相对 action 见证的真实起点）——这个长度原来是 `.sil` 里的硬编码 `constant`，账本1468 实测证实它会随 `seal_count`/`min_bet` 的 magnitude 变化（minimal-push 编码宽度门槛）而变化，硬编码单一常量只对某个特定市场配置成立，换一组 `seal_count`/`min_bet` 就会错——不能是全局常量，必须是每个市场 genesis 时按自己的 `seal_count`/`min_bet` 做不动点收敛（`computeMarketGenesisArtifacts`，编译→量长度→以此值再编→直到长度不再变化，限4轮不收敛则拒绝 genesis）算出、烤进那个市场自己的 ShardLeaf_direct ctor（新增 ctor 字段 `own_redeem_len`，`state_layout`/`local_yes` 等 state 字段不受影响——账本1468矩阵实测证实 state 区四个 `init_*` 字段不影响编译产物长度，只有 `seal_count`/`min_bet` 这两个纯 ctor 常量会）。`register_append` 重建 leaf redeem 时必须从这一列原样读回（`computeShardLeafRedeemScript` 新增必填参数），不能重新猜/重新收敛——genesis 时的收敛结果是唯一真值来源，同 `shardleaf_cov_id` 一类"一次性事实，之后不变"的字段。两个 builder（genesis 收敛后 / register_append 读回后）都加了 fail-closed 断言：真实编译出的 redeem 长度必须等于 ctor 里烤的 `own_redeem_len`，不等即拒绝返回。详见 `docs/provenance/2026-09-15-j2-shardleaf-direct-self-splice-offset-fix/`。
- **`proto_bets`**：下注记录，对应"铸筹码 genesis + `register_append` spend"两步复合动作的最终态。`status` CHECK 含 `orphaned_chip` 终态——`ShardLeaf_direct.count` 字段可被并发下注耗尽，导致已铸筹码永久孤儿化（T-ORPHAN-CHIP-RECOVERY-ENTRY，当前 9 个主网合约无回收入口，v0 不修，如实展示不假装能恢复）。写入方 `POST /api/proto/markets/:id/bet`（待落码）。
- **`proto_bet_intents`**：A（铸筹码）/B（`register_append`）两步各自的 `pending/prepared/submitted/landed/ambiguous` 状态机，照抄 `submit-intent.mjs`（`src/lib/submit-intent.mjs`）的 NO-TX-NO-STATE 设计哲学（prepared 只能同字节重播、无正向落链证据不得自动重建）——**但不复用 `submit_intents` 表本身**：该表 schema（`target_address`+`amount_kas`）围绕生产 relay `transfer` plain-address 语义设计，装不下 genesis 输出/entry-spend 原始交易的形状，故新建独立表。`bet_id` FK 指向 `proto_bets`；`depends_on` 供 B 行指向对应 A 行的 `intent_key`（B 只在 A `landed` 后才允许从 pending 转 prepared）。NWT MUST-FIX（ledger 1336）落码要求。
- **`proto_claims`**：赢家/退款人 claim + `KanetTokenClaim.spend` 提现状态。`side` CHECK 区分 `win`/`refund`。写入方 `POST /api/proto/markets/:id/claim`、`POST /api/proto/markets/:id/withdraw`（待落码）。
- **`proto_settlement_intents`**（v210，2026-09-16，J2 · Owner D-022 批准结算实现，账本1491，实现计划 `docs/2026-09-16-j2-proto-v0-settlement-implementation-plan-v0.1.md` v0.2）：`market_seal`/`close_commit`/`convert_to_claim`/`claim_draw`/`withdraw`/输家 ticket 自我回收六步各自的 `pending/prepared/submitted/landed/ambiguous` 状态机，照抄 `proto_bet_intents` 的既有哲学（NO-TX-NO-STATE，prepared 只能同字节重播）——**独立 schema，不改 `proto_bet_intents`/`proto_markets` 既有表**。`subject_type` CHECK 区分 `market`/`claim`/`ticket` 三种归属（`market` = seal/resolve，`subject_id`=`proto_markets.id`；`claim` = convert_to_claim/claim_draw/withdraw，`subject_id`=`proto_claims.id`；`ticket` = 输家自我回收，`subject_id`=`proto_bets.id`）。`step` CHECK 目前只列 `(seal,resolve,convert_to_claim,claim_draw,withdraw,reclaim)`——Bettor 裁定"本轮只实现已批准的六个 builder 对应的 step，不预留未实现分支的死代码"，`convert_to_refundclaim`/`refund_payout` 等 refund 相关 step 本轮范围外，等对应 builder 落码时再扩 CHECK。`intent_key` 统一格式 `settle:<subject_type>:<subject_id>:<step>`——relay 侧**不新增命令**，六步全部复用现有 `covenant_broadcast`（Bettor 裁定：`covenant-broadcast-relay.mjs` 本就 kind-无关，per-kind 校验在 console 侧，relay 不需要知道 kind），回执落表靠 `/ingest/proto-bet-intent-phase` 端点新增的 `intentKey.startsWith('settle:')` 分派分支（同既有 `'genesis:'` 前缀分支同一模式，不新开 ingest 端点）。`claim_draw`/`withdraw`/ticket 自我回收三步需要 bettor 签名（`PoolSideTicket.authorize_spend`/`KanetTokenClaim.spend` 的 `sig` 参数）——v0 阶段用市场自己的委员 keypair 代替（`proto_markets.committee_pubkeys_json[0]`/`committee_privkey_enc`，console 侧 `decryptCommitteePrivkey` 解出即用即弃，不落日志/不进响应体/不写库），**留 `T-PROTO-BETTORPK-BINDING` 观察票**：这个简化只在 v0 单操作员场景成立，真实多用户场景需要重新设计签名获取方式。

- **v214（2026-09-21，J2 · R-a 驱动退款路，设计 `docs/2026-09-21-j2-driver-refund-path-design-v0.2.md` §3.2 / NWT M2）——`proto_settlement_intents.step` 的 CHECK 加 `refund_flip` / `convert_to_refundclaim` / `refund_payout`（一次放入三个，R-a 只接线 `refund_flip`；`market`/`market`/`claim` 归属见 `proto-settlement-intent.mjs` STEP_SUBJECT_TYPE）。** 表重建迁移，**不能用 v207 的"建 _vN → INSERT SELECT → DROP 旧 → RENAME"朴素配方**（NWT 实测失败：v212 起 `proto_markets` 的触发器 `trg_pm_ws_r1_delete_guard` 在 EXISTS 子查询里引用本表，RENAME 时 `error in trigger …: no such table: main.proto_settlement_intents`）。做法：同一事务内先用 `sqlite_master` 枚举所有引用本表的触发器（不手写清单）并记原文 → DROP → 重建表 → 重建索引 → 按原文重建触发器；重建前后核对触发器集合（名+sql）/ 索引集合 / 行数，事务外再核 `foreign_key_check` + `integrity_check`，不一致回滚并抛错（LOUD 拒启动）。幂等：CHECK 已含 `refund_flip` ⇒ 跳过。测试 `kasia-console/src/db/proto-settlement-intents-v214.test.mjs`（含"朴素配方失败"对照）。**部署前必须先 `.backup` 主网库，并在 `.backup` 副本上先跑一遍**；迁移失败的回退 = 还原备份 + 回退部署提交。同批：`proto_claims.side='refund'` 行的 id 为确定性 sha256(market_id‖ticket_txid‖ticket_vout‖'refund')（`refundClaimIdFor`，不加列）；`refund_flip` landed 后市场 `sealed→cancelled`（前态谓词，主网手置 `cancelled` 遗留行不受影响）。

- **v212（2026-09-20，J2 · oracle→winning_side 整合批 A，设计 `docs/2026-09-20-bettor-oracle-to-proto-winning-side-integration-design-v0.1.md` §3.1/§7-A/§10 R1·R4，NWT 复核 GREEN dff2d8ba）——`proto_markets.winning_side` 的 DB 层防御（纯 schema，不含 adapter）**：
  - **新表 `proto_market_verdicts`**（append-only：UPDATE/DELETE 触发器拒；**对已存在 id 的任何 INSERT 变体——含 OR REPLACE/upsert——也 ABORT**，堵 REPLACE 隐式删旧行绕过，B1）：`id` AUTOINCREMENT、`market_id` FK、`source_kind` ∈ extractor|uma|llm|human、`relay_id`（可空）、`outcome` ∈ {0,1} 或 **NULL（弃权/异议，一等公民；NULL 判定永远不能被引用提升）**、`confidence`（可空，0..1）、`evidence_ref`（非空白）、`created_at`。是 winning_side 的可引用判定记录；写入方=（未来的）oracle adapter / 人工入口，**当前无写入方**。
  - **`proto_markets` 新列**（全可空，老行全 NULL）：审计 `winning_side_source` ∈ operator|extractor|uma|human、`winning_side_set_at`、`winning_side_verdict_id`（FK→verdicts）；判定题 `outcome_oracle_relay_ids`、`resolution_rule_spec`、`outcome_market_source`、`outcome_condition_id`、`outcome_end_ms`。"有判定题"判据 = 前四列任一非 NULL（含空串，fail-safe 取宽）。
  - **触发器（共 17 个：verdicts 3 个 `trg_pmv_*` + `proto_markets` 14 个 = R1 的 13 个 `trg_pm_ws_r1_*` + R4 的 1 个 `trg_pm_r4_*`）**：INSERT 必 NULL 且**对已存在 id 的任何 INSERT 变体（含 OR REPLACE/OR IGNORE/upsert）一律 ABORT**（recursive_triggers 默认关，REPLACE 不会隐式触发 DELETE 触发器，所以在 INSERT 侧堵）；UPDATE winning_side：OLD 非空拒（写一次即终局，含同值/清空）、值∈{0,1}、OLD 与 NEW 的 status 都必须 sealed、必带 source + set_at、`operator` 禁写有判定题的市场且不得带 verdict 引用、`extractor|uma|human` 必须引用**同市场同值同类**的 verdict（`llm` 判定永远不能提升）；审计列不可脱离值单写、写后不可改；DELETE 拒（有值 / genesis 已广播或落链 / 有下注·claim·结算意图·verdict·genesis submit_intent 的市场）。
  - **触发器（R4）`trg_pm_r4_question_immutable`**：题面列（`question` + 判定题 4 列 + `outcome_end_ms`）在 genesis 已广播（status 出了 genesis_pending/prepared，或有 genesis_submitted_txid / shardleaf_txid）或已有任一下注后一律拒改（含 NULL↔值）。
  - 🔴 **operator 受控写路径要点**：主网首轮那种受控 SQL 从此必须同时写 `winning_side_source='operator'` + `winning_side_set_at`（例：`UPDATE proto_markets SET winning_side=?, winning_side_source='operator', winning_side_set_at=?, updated_at=? WHERE id=? AND status='sealed' AND winning_side IS NULL`）；旧写法（不带 source）会被触发器拒。有判定题的市场 operator 直写被拒。
  - 🟡 **诚实边界**：触发器防应用/运维失误与手写 SQL，**不防能 DROP TRIGGER / 伪造 verdict 行的机器写权**（设计 §10 R1 末句）。已存在的老行（如主网首轮市场 a59c，winning_side 已有值而审计列 NULL）照常运转：值不可再改、不可删、status 照常推进；**其审计列（source/set_at/verdict_id）因"有值后审计列不可改"而永远停在 NULL，不可补写——runbook 已知事项，不是缺陷**。
  - **测试/变异**：`kasia-console/src/db/proto-winning-side-triggers-v212.test.mjs`（22 例）+ `docs/provenance/2026-09-20-j2-oracle-batchA-db-defense/`（65 个变异全杀）。同笔改的 6 个测试夹具（winning_side 写法 / INSERT OR IGNORE 重复播种）见该目录 NOTE。

- **v213（2026-09-20，J2 · oracle 整合批 D，设计 `docs/2026-09-20-bettor-oracle-batchD-grace-refundflip-budget-design-v0.1.md` v0.3 §3/§7/§8 N1·N5，NWT 设计审两轮 GREEN）——冻结列 + verdicts.pmt_at + 触发器**：
  - **`proto_markets.settlement_frozen_at INTEGER` + `frozen_reason TEXT`**（可空，老行 NULL）：冻结 = 该市场结算不再前进（close_commit 三入口 fail-closed：`listWork` 选行 / `dependenciesLanded` 重读 / 核心广播前闸重读；已 prepared 的意图不受影响）。冻结时刻取 pmt，pmt 无效退墙钟毫秒；`frozen_reason` 恒为 `<reason>|clock=<pmt|wall>`（非空、不可改）。**单向不可撤**；冻结后 `winning_side` 永不可写 ⇒ 判定题市场唯一出口 = 自然 refund_flip（N5b，refund 执行批未接线前有价值市场不得上主网）。
  - **`proto_market_verdicts.pmt_at INTEGER`**（N1）：verdict 写入时刻的 pmt（毫秒，INSERT 写，批 A append-only 保写后不可改）；**NULL 的 verdict 不计一致性、不可被 `winning_side_verdict_id` 引用**（`trg_pm_ws_r1_verdict_ref` 在 v213 重建，加 `v.pmt_at IS NOT NULL`）。
  - **触发器（7 个新 + 1 个重建）**：`trg_pm_d_frozen_insert_null`（INSERT 必 NULL）/ `_frozen_domain`（正整数）/ `_frozen_one_way`（不可改不可清，reason 同）/ `_frozen_reason_required`（冻结必带非空白 reason）/ `_reason_needs_frozen`（reason 不脱离冻结）/ `_frozen_no_winning_side`（D2：冻结市场——或同一语句冻结——禁写 winning_side）/ `trg_pmv_d_pmt_at_domain`（pmt_at 正整数或 NULL）。🟡 冻结可发生在 winning_side 已写之后（应急停 close_commit，不撤已写值）——批 D 不禁；D2 只禁"冻结之后写 winning_side"。
  - **写入方 / 读取方**：`lib/proto-settlement-freeze.mjs`（freezeMarket / applyLateSealGuard / promoteWinningSide，db 注入）；读：store.listWork / dependenciesLanded、核心广播前闸、批 B adapter（未来）。`lib/proto-settlement-budget.mjs` 是纯逻辑（预算常量 / pmt 有效性 / promote 门 / 晚 seal / 受理门）。"有判定题"的唯一定义在 `db/proto-judged.mjs`（批 A 触发器 SQL 与批 D JS 判据共用）。
  - **受理点门**：HTTP bet 路由受理时刻，判定题 ∧ outcome_end 有限 ∧ **max(墙钟, pmt) ≥ outcome_end ⇒ 拒（409）**（pmt 落后墙钟 2.3–10 分钟，只看 pmt 会在墙钟已过 outcome_end 后继续收注；偏差只多拒不多收）；判定题 ∧ outcome_end 空 ⇒ 拒（409）；判定题受理时 pmt 无效 / 读不到 ⇒ 拒（503，fail-closed）；无判定题豁免且不读 pmt。**不在驱动**：已受理注的 append 不受影响（N4）。
  - **运行时依赖**：pmt 有效性要 relay 的 `get_past_median_time` 回 `isSynced`（批 D 在 relay 侧加了这一个布尔字段）——**relay 未升级时判定题受理一律 fail-closed（`is_synced_missing`），无判定题市场与既有 close_commit 门不受影响**。
  - **测试/变异**：`db/proto-settlement-freeze-v213.test.mjs`（13 例）、`lib/proto-settlement-budget.test.mjs`（19 例）、`lib/proto-bet-intake.test.mjs`（5）、`api/proto-bet-intake-route.test.mjs`（路由接线）+ 扩展 core / store / service / relay 测试；`docs/provenance/2026-09-20-j2-oracle-batchD/`（115 变异 114 杀 + 1 个记录在案的等价变异）。
  - **批 B（2026-09-20，J2 · oracle adapter，无 schema 变更，设计 `docs/2026-09-20-bettor-oracle-batchB-adapter-verdict-promote-design-v0.1.md` v0.3）——新增写入方，不新增表 / 列**：① `proto_market_verdicts` 的**唯一自动写入方** = `lib/proto-oracle-adapter-core.mjs`（`services/proto-oracle-adapter.mjs` 定时调用；默认关，`PROTO_ORACLE_ADAPTER_ENABLED=1` 才启动，翻开须 Owner）：`relay_id` 恒 NULL，`source_kind` 只由 `lib/proto-oracle-verdict.mjs::classifyDerivation` 单一贴标（仅 `judgeline-deterministic` ⇒ extractor；仅过 UMA 定稿窗的 polymarket ok ⇒ uma；其余含未知 ⇒ llm），实质 ABSTAIN / 异议写 `outcome NULL` 或相反票（pmt 无效时 `pmt_at` 也写 NULL，冻结集不漏），赞成只在 pmt 有效且 pmt ≥ outcome_end 时写（M1：否则 pmt_at < oe 永久失格于赞成集 ⇒ 必冻结退款；下 tick 再写）；候选只取墙钟 ≥ outcome_end 的市场并按 outcome_end 升序，spec 坏 / 数据源未登记的永久不可处理市场直接冻结（M2）；同 (市场, source_kind, evidence_ref) 至多一条。② `proto_markets.winning_side*` 的**唯一自动写入方** = adapter 经批 D `promoteWinningSide`（`PROMOTE_UPDATE_SQL` 现带 `NOT EXISTS(异议 verdict)` 子查询——B7，与写值同一条语句）。③ 判定题列（`resolution_rule_spec / outcome_market_source / outcome_condition_id / outcome_oracle_relay_ids / outcome_end_ms`）的**唯一写入方** = `POST /api/proto-markets/create`（`ensureMarketPending` 同一条 INSERT，三个新请求字段 `resolutionRuleSpec / outcomeEnd / outcomeConditionId` 全可选，缺省 = 旧流程行逐字节不变）；`outcome_oracle_relay_ids` 服务端恒写 `'[]'`，请求体带任何 relay 类字段 ⇒ 400。`resolution_rule_spec` JSON 新增内部键 `side_map`（label→side 双射）/ `polymarket_outcome_side`（UMA 极性）/ `resolution_predicate`，被批 A 的 R4 题面不可改触发器一并锁住。读：公开 GET 对判定题附 `judged{…}` 块、内部列不外露（旧市场响应键集合不变）。④ **N5b**：主网上判定题只允许 `PROTO_ORACLE_VALUELESS_TOKEN_IDS` 白名单里的零价值代币（`lib/proto-oracle-policy.mjs::judgedMarketAllowedHere`，创建 / 受理 / adapter 三处调同一个函数）——refund 执行未接线，有价值的判定题市场不得上主网。测试 / 变异见 `docs/provenance/2026-09-20-j2-oracle-batchB/`。

**已知限制（不得漂成"已处理"，任何引用本条目须原样带走）**：① T-PROTO-BETTORPK-BINDING——`register_append` 的 `bettorPk` witness 参数与被消费的代币输入之间无签名绑定，v0 单操作员场景接受，**任何第二方参与前必须先修**；② T-ORPHAN-CHIP-RECOVERY-ENTRY——见上 `proto_bets` 说明，合约层缺口非本轮范围。
  > 📌 **状态注记（2026-09-15 · J2 · 账本1435/1436 bet_mint 步骤A落码 · 并入②不改原文）**：bet_mint 步骤A新铸 stake 筹码的 `owner` 字段裁定为 `STAKE_CHIP_OWNER_UNBOUND`（全零32字节，见 `kasia-console/src/lib/proto-covenant-builder.mjs`）——起因是"owner=它自己的covenant_id(自持有)"被证明是自指不动点方程无解（真实 rusty-kaspa `consensus/core/src/hashing/covenant_id.rs` 把输出完整脚本字节喂进哈希，含 owner 自身，见 `docs/provenance/2026-09-15-j2-stake-chip-owner-unbound-verification/`）。代价：步骤A落链后、步骤B广播前的窗口，任何人可用任意非covenant输入冒充在场把这枚筹码花掉，导致孤儿化——但攻击者所得与自己免费铸一份等价，无真实损失路径，**并入本条 T-ORPHAN-CHIP-RECOVERY-ENTRY**，v0 接受。🔴 该取舍只在"KTT是零价值测试币"前提下成立，KTT 若承载真实价值必须重做。
  > 📌 **状态注记（2026-09-15 · J2 · D-020 账本1446/1448/a4878d7d · v208 · 上面①③④段大量内容因此过期，不改原文，补此条）**：上面 ① `proto_bets`/② `proto_bet_intents` 两段描述的"铸筹码 genesis + `register_append` spend 两步复合动作"、③段的 `STAKE_CHIP_OWNER_UNBOUND` 设计、以及紧邻上方的孤儿化代价说明，**全部被 D-020 取代**——NWT 用真实 cli-debugger 证明 `STAKE_CHIP_OWNER_UNBOUND`（ZERO32）owner 的筹码不只是"能被孤儿化"，而是**能被任意第三方连本带锁定的真实 KAS 一起偷走**（推翻账本1436"无损失"判断，见 `docs/provenance/2026-09-15-j2-d020-register-append-single-tx-verification/`），Owner 裁定取消步骤A、下注改单笔交易（v208 迁移）：
  > - `proto_bets`：**删列** `mint_txid`/`mint_vout`；`status` CHECK 从 `(pending,chip_minted_pending_stake,confirmed,orphaned_chip)` 收窄到 `(pending,confirmed)`——不再有铸筹码中间态，下注直接 `pending`→`confirmed`。
  > - `proto_bet_intents`：**删列** `depends_on`（链式依赖机制随两步设计一起消失）；`step` CHECK 从 `(mint,append)` 收窄到只剩 `(append)`——不再有 A/B 两步区分，`register_append` 是唯一动作。
  > - **T-ORPHAN-CHIP-RECOVERY-ENTRY 关闭**：不是"修好了"，是场景结构性消失——没有独立 stake 筹码就没有"步骤A落链、步骤B未广播"这个窗口，孤儿化这件事本身不再可能发生。
  > - **T-PROTO-BETTORPK-BINDING 继续成立，与 D-020 无关**：`register_append` 的 `bettorPk` witness 参数与代币输入之间无签名绑定这件事在单笔交易下没有变化（票据本身是本笔交易的输出，不涉及"消费一个独立筹码输入"这条被 D-020 改掉的路径），仍然是"任何第二方参与前必须先修"的开放限制。
  > - 迁移前置 real-data guard：v208 若发现任何 `proto_bets.status='chip_minted_pending_stake'` 或 `proto_bet_intents.step='mint'` 的真实行，直接 `throw` 拒绝迁移（需要人工先判断如何处理这些卡在旧两步中间态的行），不静默丢弃/不猜测转换——真实 console.db 副本核对结果是这两类行数为 0（`PROTO_DRIVER_ENABLED` 全程未开，两步设计从未在生产库真正跑起来过）。
  > - 详见 `docs/provenance/2026-09-15-j2-d020-register-append-single-tx-verification/`（6条真实构造交易向量 + witness 编码逐字节验证）与 `docs/DECISIONS.md` D-020。
> 📌 **状态注记（2026-09-15 · J2）**：KAS 侧资金/签名来源那句"待 Owner 定"已过期——**已裁定 (B′)**：专属 `proto-` 前缀 relay 身份（`PROTO_RELAY_ID` env 钉死+`name` 前缀/余额上限双重 fail-closed 断言）+ 既有 relay IPC 通道（`sendCommand`/`sendCommandAsync`）+ 新 relay 命令 `covenant_broadcast`（`kasia-relay/src/lib/covenant-broadcast.mjs`/`covenant-broadcast-relay.mjs`，含 `GENESIS_OUTPUT_SOMPI`/`CONTINUATION_OUTPUT_SOMPI`=20,000,000 sompi 签名前强制校验），不新造密钥存储/不违反 Console-不碰链。见 `docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md` §6/§9。

### watch_accounts（v211, 0 条, 登记前）
只读/冷存账户注册表（2026-09-20，KANet-UI，D-028 Owner 铁令"所有资产必须在主网 console 全部可见"；设计 `docs/2026-09-20-kanetui-d028-watch-only-accounts-design-v0.2.md`，NWT 设计审 `60420ed4`/`a74c7a6a` GREEN）。
- **用途**：让"console 不持钥的地址"也出现在资产页——例如 9/14 迁移被冷名单拒导入的两个冷存账号。**它不是账户，是"要看的地址"**。
- **字段**：`id`（PK，uuid）/`name`（保留原名）/`chain`（默认 `kaspa`）/`network`（默认 `mainnet`）/`address`（入库前统一成 `kaspa-wasm` `Address.toString()` 规范形式）/`custody`（**CHECK 只允许 `'cold_no_key'`**）/`note`（一句话来历，不含金额）/`created_at`/`updated_at`；`UNIQUE(chain, network, address)`（原文唯一，规范化由登记脚本做）。
- **🔴 没有任何密钥列**（无 mnemonic/privkey/hint）——"不持钥"由 schema 承担，不是约定。将来有人想复用此表存有钥账户，必须改迁移（会红）。
- **🔴 它不是 `relay_nodes`**：`relay_nodes` 有约 50 处"这是本地 agent"语义的消费者（anti-spam `isSibling`、autoTaker 自接单跳过、交易任务遍历、exchange 候选执行 agent、Mind 调度 …），无钥行插进去默认被卷入；独立表 = 默认不可见。**新增读取这张表的代码只许出现在白名单文件**（迁移 `src/db/migrate.js`、`src/api/watch-accounts.js`、`src/lib/watch-account-register.mjs`、`kasia-console/scripts/watch-account-register.mjs`、测试；余额读取模块 `src/services/watch-balance.js` 与 `src/api/portfolio.js` 不出现该标识符，经 `watch-accounts.js` 取行），由 `src/services/watch-accounts.static.test.mjs` 的静态扫描守（用共享扫描器 `test-fixtures/source-scan/`，扫描根含 `kasia-console/scripts`）。
- **写入方**：只有一次性登记脚本 `kasia-console/scripts/watch-account-register.mjs`（默认 dry-run，`--apply` 才写；输入走 `--from-file`/stdin，不接受命令行地址/名字；**不开 HTTP 写口**，`api/backup.js` **不含**此表）。
- **读取方**：`GET /api/watch-accounts[/:id]`、`GET /api/portfolio/unified`（无 `relayId` 时并入 `watchAccounts` 与 `totals.watchKas/kasAll/grandTotalKasWithWatch`）。余额读取见 `src/services/watch-balance.js`（`KASPA_RPC_LOCAL_ONLY=1` 时零 REST 外发；不可读 ⇒ `unavailable`，**绝不显示 0**）。
- **陷阱**：登记脚本拒绝已存在于 `relay_nodes`/`agent_wallets`/`watch_accounts` 的地址（规范化后比，防"热+冷"重复计入总额）；"改成可花" ≠ 改这张表——需走正规 relay 导入并另获 Owner 钱路批准（D-028 §4）。

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

**当前最新版本：v205（2026-09-14 D-019 迁移第 5a 笔 · payout_shards/market_shards 代币化 ctor-only 列）**
（v199-v204 本文件changelog未逐条回填，见上方既有说明"以 migrate.js 实际为准"——本行只保证指向 migrate.js
真实末尾版本号，不代表 v199-v204 都已在下方逐条记录。）

> 🔵 **库路径解析（`src/db/client.js`, 2026-08-28 入口感知）**: `DB_PATH` 有 ⇒ 用之（不拒建）; 无 ⇒ 仅 console 入口（`argv[1]` = `kasia-console/src/index.js` 或 `KANET_CONSOLE_ENTRY=1`）锚定 `<repo>/kasia-console/data/console.db`（与 cwd 无关）并回写 env; **其它入口无 `DB_PATH` ⇒ throw**。加载时打印 `[db] path=<abs> source=…`。脚本要读 live 须显式 `DB_PATH=<绝对路径>`（ANTI-PATTERNS 规则 74）。

> 🔴 **本行 2026-08-12 由 J2 修正时发现它已经陈了一版**：v195（`u1_domain_assignment`，2026-08-11）建表后**没有回填本文件**，本行一直停在 v194。
> 补记在下方版本历史里。**判据：改表与改本文件必须同一批 commit** —— 否则「当前最新版本」这一行会变成一个**读起来很权威、但会骗人的数**，而下一个人正是靠它决定新 migration 接哪个号。

> 注：v125–v156 尚未在本表逐条回填（r281 scope 外）；新增 migration 接 v157 之后。v176-v183、v185-v186 未逐条回填（各自设计稿/COORD-LEDGER 有账），本行版本号以 migrate.js 实际为准。

## 版本历史（近期）

- **v213 (2026-09-20, J2 · oracle 整合批 D)**: `proto_markets` 加 `settlement_frozen_at` / `frozen_reason`，`proto_market_verdicts` 加 `pmt_at`；冻结单向 / D2（冻结禁写 winning_side）/ pmt_at 域 触发器 7 个 + 重建 verdict_ref（加 pmt_at 非空）。纯 schema + 冻结三入口 + 受理点门，无 promote 调用方（批 B）。

- **v212 (2026-09-20, J2 · oracle 整合批 A)**: 新表 `proto_market_verdicts`（append-only）+ `proto_markets` 加审计列 3 + 判定题列 5 + winning_side 写一次 / operator 禁写判定题 / verdict 引用 / DELETE 守卫 / 题面不可改 触发器 17 个（详见上文 proto 段 v212 条目）。纯 schema，无写入方、无 adapter。

- **v211 (2026-09-20, KANet-UI · D-028 只读账户可见)**: 新表 `watch_accounts`（只读/冷存账户注册表，**无任何密钥列**，`custody` CHECK 只允许 `'cold_no_key'`，`UNIQUE(chain,network,address)`）。用途：让 console 不持钥的地址（9/14 迁移被冷名单拒导入的两个冷存账号）也出现在资产页。前提确认：新表，不改任何既有表，无存量数据，迁移幂等（`CREATE TABLE IF NOT EXISTS`）。写入方：一次性登记脚本 `kasia-console/scripts/watch-account-register.mjs`（默认 dry-run；不开 HTTP 写口）。读取方：`GET /api/watch-accounts[/:id]` 与 `GET /api/portfolio/unified`（无 `relayId` 时）。设计 `docs/2026-09-20-kanetui-d028-watch-only-accounts-design-v0.2.md`（NWT 设计审 `60420ed4`/`a74c7a6a` GREEN）。

- **v205 (2026-09-14 D-019 迁移第 5a 笔·PayoutShard/ShardLeaf 代币化 ctor-only 列)**: `payout_shards` 加
  `token_tmpl_hash`/`claim_tmpl_hash`/`market_suffix_hash`（TEXT，允许 NULL）+ `market_shards` 加
  `shard_token_tmpl_hash`（TEXT，允许 NULL）。用途：`PayoutShard.sil`/`PayoutShardV2.sil`/`ShardLeaf.sil`
  T3 代币化（ledger 1183/1188）给 ctor 新增的字面量常量——`compilePayoutShardRedeem`/`compileShardLeafRedeem`
  迁移到当前 25/12 参数 shape 后，结算/重编译路径需要从 DB 读回创世时真实烤入的值（K-18"谁编译谁 declare"
  纪律：不能假设现在的全局配置还是创世时那个值）。前提确认（Bettor 只读查生产库）：`pool_markets=0`、
  `payout_shards=0`，主网零存量市场、零旧 shape 实例，不做新旧 shape 兼容分支，直接加列。写入方：创世时由
  T4 单源产物写入（`ensurePayoutShard`/`ensurePayoutShardV2`/`registerBettorOnShard` 'open_new' 分支）。
  读取方：`bshard-auto-settler.mjs`/`bshard-settle-daemon.mjs`/`bshard-payout-family-coherence.mjs`（缺列/
  缺值 fail-loud 拒结算，不猜值）。见 `docs/2026-09-14-j2-d019-silverc-v100-migration-inventory-v0.1.md`。
  > 📌 **状态注记（2026-09-14 · T-LEGACY-NULL-COLS · ledger 1267/1268 · 不改上方原话）**：J2 一度误读旧网
  > 遗留库（`data/console.db`，无进程服务）当成主网库，以为 701 个既存市场会撞上这三列 NULL——**Bettor
  > 只读实测主网真库 `data/console.mainnet.db` 纠正：`pool_markets=0`、`payout_shards=0`，上方"主网零存量"
  > 前提在 2026-09-14 仍然成立**，不是虚惊一场的巧合，是真核对过。**裁定不加 legacy 豁免**——NULL 被
  > `eafc7e91`（`bshard-payout-family-coherence.mjs` 步骤(c)）拒绝正是设计意图，不是要绕过的 bug。为防
  > 未来真出现"旧市场撞 NULL"这类情况被悄悄放过，`migrate.js` 每次启动新增一条纯观测性 T-LEGACY-NULL-COLS
  > 诊断：统计 `v1_committee` 且三列任一 NULL 的行数，>0 才 LOUD `console.warn`（只含计数，不点名
  > marketId），不 throw、不放行、不回填。
- **v198 (2026-08-27 §10 跨节点 pubkey 身份表 · register-only)**: `u1_relay_identity` 新表。用途：§10 v1 的**身份权威表**——跨节点判断只认 canonical `relayPubkeyXOnly`（D-013 §1 "§10 GO"；设计 `docs/2026-08-19-s10-pubkey-identity-design.md`@847bcf22 L1/L4/§4；切片计划 `docs/2026-08-27-j2-s10-commit-slice-plan-v0.1.md` C2）。字段：`relay_pubkey_xonly`(**PK**，`CHECK length=64 ∧ NOT GLOB '*[^0-9a-f]*'` = 恰 64 位**小写** hex，与验证器 L1 同口径；写法是全串 hex，**不是** `GLOB '[0-9a-f]*'` 只挡首字符、也**不是** `[!...]` 字面集错形) / `network`(NOT NULL，**CHECK IN ('testnet-12','mainnet')** 表级闭枚举 = 验证器 `S10_NETWORKS` 同集，④-8 机械比对；Codex MSG-285 SHOULD-FIX，C6 就地改 DDL——live 从未跑过 v198，`IF NOT EXISTS` 对 live 等价首次) / `operation`(NOT NULL，**CHECK = 'register'**，v1 硬白名单在表层再钉一次) / `epoch`(NOT NULL，**UNIQUE**：同一 challenge 只承载一次 S10 注册) / `signature`(留证不作键) / `registered_at`。**🔴 主键是 pubkey 不是 relay_id**：抢 pubkey X 必须签得出 X 的私钥 ⇒ first-squatter 攻击对 pubkey 主键天然失效。**🔴 陷阱：没有 `local_relay_id` 列、没有任何按 relay_id / `relay_nodes.ecdsa_pubkey_xonly` 的回退索引（NWT 裁，P5）**——relay_id→pubkey 的本地便利映射一律**活算** `XOnlyPublicKey.fromAddress(relay_nodes.address)`（`feedback.js:18` 先例），**别加回退列**：列不存在 = 结构上无法被当权威读；谁为便利加回来就是把"relay_id 变身份"的滑回面重开（ANTI-PATTERNS 一条随 C5）。**写入方：今日无**（C3 起 `registerIdentity` 事务内 INSERT，与 A2 INSERT 同一 `.immediate` 事务、S10 失败整笔回滚）。读取方：C3 起 `u1-registration.mjs`（PK 冲突 = 该 pubkey 已注册）。验收 `src/lib/u1-v198-migration-acceptance.mjs`（④-1..④-7，**跑真 migration + 临时库**；④-3 含 `'a'+'z'×63` 向量专防弱 GLOB 假绿）。对 live 即时影响零（additive、IF NOT EXISTS、无写入方）；**代码入库 ≠ live**，生产库迁移 = D-005 独立迁移 Owner 另拍。
- **v197 (2026-08-18 u1 A2 一次性挑战表)**: `u1_identity_challenge` 新表。用途：承载 A2 注册的**一次性挑战**（N8 PoP 的防重放载体）。字段：`challenge`(**PK**) / `used_at`(可空，**NULL = 未消费**) / `expires_at`(**NOT NULL**)；另建**部分索引** `idx_u1_challenge_unused ON (expires_at) WHERE used_at IS NULL`。**🔴 `challenge` 作主键不是"顺手"**：一次性消费走 CAS —— `UPDATE … SET used_at=? WHERE challenge=? AND used_at IS NULL` 判 `changes===1`，**该 CAS 走主键**；两个并发请求只会有一个拿到 1。**🔵 那条部分索引【不参与 CAS 正确性】，只服务清理/巡检**（"还有多少未消费且已过期"）——明写于此免得下一个人当它是闸；而且这不是一句声明：验收 ③-4 **删掉该索引后重跑并发 CAS 必须仍全绿**，那才是"它不承重"的正向证据。**`expires_at NOT NULL`** 比旧测试夹具那份收紧一格（缺过期时间的挑战不该存在）。**🔴 它是 §6-1 LIVE wiring 的真阻塞**：`registerIdentity` 要求 `challengeStore` 必传，而 `createChallengeStore` 的工厂**校验表存在** ⇒ 本表不在时注册入口**根本接不上线**，且是 fail-closed 的"不能半工作"（直接 throw，无静默降级）——这也是 ③→① 顺序的由来。**写入方：今日无**（注册入口尚未接线，等 ①）。读取方/权威：`kasia-console/src/lib/u1-challenge-store.mjs`（动词式导出，不交 ops 对象）。验收 `src/lib/u1-v197-migration-acceptance.mjs`（③-1..③-7，**跑真 migration + 临时库**）。设计 `docs/2026-08-17-j2-s61-live-wiring-design.md` §3 + §9-bis。
- **v196 (2026-08-12 u1 A2 同源判定登记表)**: `u1_identity_registration` 新表。用途：记录**委员身份 ↔ 登记根（账户层 xpub）的绑定证据**，A2「两个身份是不是同一份 mnemonic 派生的」靠它判。字段：`relay_id`(PK) / `root_fingerprint`(**UNIQUE**) / `root_xpub` / `identity_index`(**CHECK = 0**) / `identity_pubkey_xonly` / `custody`(**CHECK = 'mnemonic'**) / `registered_at`。**🔴 三条 CHECK/UNIQUE 是把规范条款升成【写入时结构约束】**：`UNIQUE(root_fingerprint)`=N3（identities-per-account 锁死 1，Bettor 2026-08-12 裁）⇒ 同根第二身份**写不进来**；`CHECK(identity_index=0)` 同源；`CHECK(custody='mnemonic')`=N4（privkey-only 不入委员，ledger (159) §8.3）。理由是在册那条：**扫描器只有有人跑它时才说话，约束不依赖任何人记得跑**。**⚠ 约束挡不住的**：只挡**同一张表内**同根重复，**挡不住同一 seed 的另一个硬化账户**（两个不同的根 = 两条各自合法的行）——那是 spec §1 的 C 边界（仪式域），**别读成"数据库保证了不同源"**。**⚠ 轮换（R5 换钥不搬钥）会撞 `relay_id` 主键 ⇒ 旧行必须先归档/删除**。**写入方：今日无**（注册入口尚未落码，等 A-2 余下部分 + N8 PoP 接线）。读取方：`kasia-console/src/lib/u1-same-origin.mjs`（判定库，已落码）。结构约束用例 `src/lib/u1-identity-registration.schema.test.mjs`（7 格，**跑真 migration 不跑抄本**）。规范 `docs/2026-08-12-u1-a2-same-origin-spec-v1.0.md`（v1.1-rc），设计 `docs/2026-08-12-j2-a2-registration-storage-design-v0.1.md`。
- **v195 (2026-08-11 u1 域→relay 映射记录 · 补回填)**: `u1_domain_assignment` 新表（`domain` CHECK 1..5 / `relay_id` **UNIQUE** / `host_label` / `assigned_at`，PK `(domain, relay_id)`）。u1 密钥隔离施工的域归属记录。**🔴 定位写死：纯记录表，不参与任何签名/授权判定**（spec I2：永不进授权语句）；故意不加 `relay_nodes` 外键/触发器——一旦接进签名路径，写错一行就从"记账麻烦"升级成"某 relay 静默获得/失去签名资格"。`UNIQUE(relay_id)` 是对 runbook §1a 原文的**有意偏离**（原文复合 PK 允许同一 relay 同时挂两域，而那正是"隔离域"要排除的）。写入方：今日无。**本条为 2026-08-12 补回填**（建表当时漏更本文件）。
- **v194 (2026-07-29 broker_onboarding 移除 vestigial status 列)**: `ALTER TABLE broker_onboarding DROP COLUMN status`。`status` 唯一写入恒 `'pending'`、无路径产生别的值 ⇒ 留着 = gate 陷阱（谁加 `AND status='approved'` ⇒ 对恒 pending 列静默返回空 ⇒ 全 broker 永不 fork，SQL 不报错）。注释/CHECK 挡不住（注释靠人读、CHECK 只防写而陷阱在读）；唯 DROP 让列不存在 ⇒ 任何 `b.status` 引用当场 `no such column`（fail-loud，静默锁死变启动即崩）。前置断言（NWT 加固）：DROP 前证无 `status != 'pending' OR status IS NULL` 的行（设计时全表 0，`OR IS NULL` 兜住未来 schema 若变 nullable 的漂移）。消费侧同批改：`kanet-broker.js` 3 处 SELECT + 1 处 INSERT 删 status 字段（均死读/恒 pending 写）。四面独立核（逻辑依赖 KANet-UI + 响应面 Bettor + 历史数据三路一致 + DROP 可行性 NWT），regression `test/broker-onboarding-status-drop.test.mjs` 5 case。设计 `docs/2026-07-29-broker-onboarding-status-vestigial-drop-design.md`。
- **v193 (2026-07-24 Codex MSG-125 E 项·pilot 钱包 durable 隔离)**: `tg_custodial_wallets` 加 `access_mode TEXT DEFAULT 'normal'` 新列。用途：legacy `POST /api/tg-wallet/:tg_user_id/send` 路径原本靠 `process.env.PILOT_WALLET_ADDRESSES` 这个 env allowlist 隔离 M0c-1 Path B pilot 托管钱包（env 缺失/畸形/重启未加载 = fail-open，legacy 路径会静默对 pilot 钱包重新开放）——这条列是权威、durable 的隔离判据：pilot 钱包建行时（`m0c1-pilot-custodial-insert.mjs`）显式设 `access_mode='capability_only'`，legacy `/send` 查出行后按这一列 fail-closed 拒绝（env allowlist 降级为纵深防御早拒层，非唯一权威）。默认 `'normal'`——既有 `tg-wallet.js` `/create` 走的自助注册钱包不受影响，行为不变。写入方：`m0c1-pilot-custodial-insert.mjs`（INSERT 时显式设值，非留 default）。读取方：`tg-wallet.js` `/send` 隔离检查。见 `docs/2026-07-24-m0c1-pilot-codex-msg125-rectification.md` E 项。
- **v190 (2026-07-23 M0c-1 app provision grant registry)**: `m0c1_app_grants` 新表（见上「m0c1_app_grants」节）。migrate 只建表零数据写入；写入仅 operator 离线脚本（M1-5）；relay 侧 readonly fresh 读（吊销即时可见）。v188-v189（spc_prune_capture_heartbeat / payout_shards.covenant_family）未逐条回填，见 migrate.js 注释与 COORD-LEDGER。
- **v187 (2026-07-16 spc_daa_index 常驻写入器补落码)**: `spc_tip_heartbeat` 新表（单行，`id INTEGER PRIMARY KEY CHECK (id=1)` + `daa_score` + `updated_at`）。用途：relay 侧 tip 心跳落地，供 console 完整性巡检判定 `spc_daa_index` 写入器是否停更，不给 console 开 kaspad RPC 口子（Relay 唯一链上出口）。写入方：`kasia-console/src/api/ingest.js` `/ingest/spc-tip-heartbeat`（relay 每 60s `ingestSpcTipHeartbeat` 上报本地已见最大 daaScore）。读取方：`kasia-console/src/services/spc-daa-index-monitor.mjs`（5min tick 对比 `spc_tip_heartbeat.daa_score` vs `MAX(spc_daa_index.daa_score)`，落后超阈值写 `events` 表触发既有告警管道）。见 `docs/2026-07-08-backward-walk-daa-index-design.md` §2.2 note①。
- **v184 (2026-07-12 B线落2 feeRules 上链锚定)**: `pool_markets.fee_rules` 新列（TEXT，分润规则全文 JSON，spec `docs/2026-06-22-modular-fee-split-component-spec.md` v1.3 + 设计 `docs/2026-07-12-fee-split-phase2-commit-anchor-design.md`）。**write-once**：`trg_pool_markets_fee_rules_write_once` trigger——已有值的行 UPDATE 改写/清空 = RAISE(ABORT)，NULL→值允许一次，等值 UPDATE 放行（settler 整行 UPDATE 不误伤）。写入方：`pool.js` create-v07（仅非 zk_native 且有 broker 的新市场，`buildPredictionV1InterimRules`）。读取方：`deriveMarketPredicateCommit`（三处 register 烤点）/ `computeSettlePlan`+`deriveResumePlanFromEvidence`（driver fee 叶）/ 委员侧**不读本列**（Bettor 注1：列不跨节点同步，enforce 只吃 attest 载荷携带的全文 + 链上 commit hash-bind）。陷阱：⚠ 老市场 NULL = 全走既有路径字节不动；⚠ 本列是 committed 承诺，丢失 = 该市场 fail-closed 不可 settle（标准 preset 盘可从 broker_pk + `prediction-v1-interim` 常量确定性重构，dry-run diff 报 Bettor 后写回）。
- **v183 (2026-07-11 MAX_WALK 老盘根治)**: `spc_daa_index` + `spc_daa_index_coverage` 新表（SPC 块 DAA→hash 持久索引 + 覆盖区间防洞）。见 `docs/2026-07-08-backward-walk-daa-index-design.md`。
- **v175 (2026-06-27 escrow_states 新表)**: `escrow_states` 新表（Silverscript P2SH 三方托管合约，15 列）。路由 escrow.js create/lock/execute 挂 verifyIngestRequest 鉴权。见「escrow_states」节。
- **v174 (2026-06-27 tg custodial wallet)**: `tg_custodial_wallets` 新表（TG 托管钱包，私钥加密存储）。见 tg-wallet 相关节。
- **v173 (2026-06-22 玩家→轻路 broker onboarding 骨架)**: `broker_onboarding` 新表（地址制自助申请，bot_token 加密落库，审批门复用 identities.trust）。Owner 钦定，KANet-UI task#4 骨架（存+审批）。见上「broker_onboarding」节 + `src/api/kanet-broker.js` onboard 端点 + `broker-home.eta`。
- **v172 (2026-06-21 bshard 生产 register wiring (b))**: `market_shards` 新加 `current_leaf_outpoint` (txid:idx 当前 ShardLeaf 续约 UTXO) + `current_leaf_state` (JSON count/local_yes/local_no/pool_value)。(A) 自包含模型 ShardLeaf covenant 每 register 续约地址变（count 烤进 state），buildRegisterCommand 下一笔 register 要当前续约 UTXO + state 重算 redeem（spliceLeafState byte-equal，不存全 redeem_hex）。每笔 register landed 后 `onBettorRegistered` 原子更新。见 `docs/2026-06-21-bshard-production-register-wiring-design.md` (b) + `src/lib/shard-allocator.mjs`。
- **v171 (2026-06-15 bshard 无限押注)**: `market_shards` 新表（滚动分片注册表：logical_market_id ↔ shard_market_id 映射 + UNIQUE(logical,index) 注册竞态锁 + 封片状态）。Owner #1 directive 分片+自取。见「预测市场分片层」节 + `src/lib/shard-allocator.mjs`。
- **v157 (2026-05-30 r281 私钥型 relay)**: `relay_nodes` 新加 `privkey_encrypted` + `privkey_hint`（裸 kaspa 私钥型 relay 支持，幂等 additive，不破助记词型）。详见 `KANet-Knowledge-Base/architecture/2026-05-30-privkey-relay-spec.md`
- **v124 (2026-05-20 r211 Phase 3a v3 oracle)**: `exchange_offers` 新加 `outcome_oracle_relay_id` + `resolution_rule_spec` (= Path D maker 自选 oracle + 5 字段 structured 判定规则); `relay_nodes` 新加 `is_oracle` + `oracle_capabilities` + `oracle_stake_locked_kas` + `oracle_reputation_score` + `broker_referral_code/broker_stake_locked_kas/broker_stake_lock_until/broker_approved_by/broker_approved_at` (broker treasury 字段同 line 出 v124)
- v122 (2026-05-19 r177 Phase 2 prediction market): exchange_offers 新加 outcome_* 字段 (= polymarket-style prediction market on Kaspa) + `maker_kaspa_addr` + `maker_relay_id`
- v69 (2026-04-22 T6): retail_dex_orders.agent_pay_addr + mid_price_at_quote
- v68 (2026-04-22 T2): retail_dex_orders 新表 + relay_nodes.is_dex_broker
- v67: is_bot_autoreply on relay_nodes
- v64: social_spend_log
