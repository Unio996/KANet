## 三、Agent Mind

### 架构

```
Console DB (6张表)          Agent Mind                    Adapter
─────────────────    ─────────────────────────    ──────────────────
relation_states  ──→  Perception Kernel   ──┐
identities       ──→  (30s 缓存)            │
messages         ──→  Memory Kernel     ──→ Context Builder ──→ Brain (AI)
events           ──→                        │                    │
conversations    ──→  Intent Kernel     ──┘                    │
                      Evolution Kernel  ←── 反思结果 ←──────────┘
                                            │
minds/*/intent.json ←── 目标持久化         │
minds/*/memory.json ←── peerNotes缓存     │
minds/*/reflections.json ←── 反思持久化       │
                                            │
                      Action Executor  ←── 候选动作 ←───────────┘
                          │
                     Console API → Relay IPC → 链上
```

### 三道门（不可绕过）

| 门 | 位置 | 职责 |
|----|------|------|
| Gate 1 | mind-manager.js:evaluateSenderGate | 身份识别 + 速率限制 |
| Gate 2 | context-builder.mjs:_buildIdentityGateSection | 身份注入 prompt（仅 reactive） |
| Gate 3 | action-executor.mjs:_checkAuthority | ACTION 权限校验 |

### 三种任务

| 类型 | 触发 | Brain 输出 |
|------|------|-----------|
| reactive | 收到消息 | 纯文本 或 [SILENT] 或 [ACTION:...] |
| proactive | 定时60min / 事件 / 价格±3% | ACTION 标签（max 3 per cycle） |
| reflect | 每12h | JSON: { insight, patterns, suggestedGoals } |

### Proactive 上下文（Brain 看到什么）

```
=== IDENTITY === (cached 30min)
=== CAPABILITIES === (cached)
=== WORLD STATE === (goals 不含 founding-vision, reflections, network)

--- YOUR RECENT OUTBOUND (DO NOT REPEAT) ---      ← DM + 广播历史
--- RECENT ACTIVITY ---                             ← events 最近 10 条
--- YOUR CONNECTIONS (from relation_states) ---     ← ACTIVE/ACCEPTED/OBSERVED 三桶
    ⚠ SENT 3 REPLIED 0 — STOP CONTACTING          ← >=3 无回复警告
--- SKILL DATA ---
--- ECONOMIC AWARENESS ---
--- TASK ---
```

### 社交认知链（防骚扰的设计，不是强制拦截）

**原则：Agent 看到自己的发送历史，自然不会重复。**

| 层 | 机制 | 位置 |
|----|------|------|
| 认知 | Brain 看到自己最近发了什么 DM/广播 | context-builder.mjs YOUR RECENT OUTBOUND |
| 认知 | Brain 看到"我发了 N 条，对方 0 回复" | context-builder.mjs YOUR CONNECTIONS |
| 认知 | Brain 看到"对方 N 天前发消息，你没回" | context-builder.mjs ⚠ PEER MESSAGED YOU |
| 安全网 | sendMessage 本地去重（同目标相似度） | action-executor.mjs |
| 安全网 | anti-spam 查 chain_events（per-peer/跨Agent/无回复退避） | anti-spam.js via /api/agent/outbound-check |
| 安全网 | anti-spam fail-closed（API 不可达→拒绝） | action-executor.mjs |
| 兜底 | Relay 30min 窗口 85% 相似度去重 | relay.mjs shouldBlockOutbound |
| 兜底 | 每次 proactive max 3 ACTION | mind.mjs |

### 已知社交缺陷（待修）

13. **~~迟回复比不回更尴尬~~（2026-04-03 已修）。** context-builder.mjs 对外部 peer（identity_type≠local）计算时间差：peer_last_sent_at 之后我方无回复且间隔≥1天 → 注入 `⚠ PEER MESSAGED YOU N DAYS AGO — NO REPLY YET. Acknowledge the delay before anything else.` Brain 看到后自然先道歉再说事。同时修复了 messages 表计数偏差（query_card 系统消息+handshake 被计入 DM 统计 → discovery/list SQL 加 message_type='text' 过滤 + Relay 写入端标记 query_card）。

14. **~~Agent 信息泄露：系统诊断发给陌生人~~（2026-04-03 已修）。** 三层修复：(a) system-status.mjs 禁止 proactive 激活（系统诊断只在 owner reactive 时注入），(b) action-executor.mjs 内容敏感度门控（14 种模式：端口号/服务名/文件路径/主机名/API端点 × 目标非owner→拦截，sibling agent 免检），(c) self-awareness.mjs proactive 模式模糊化财务数据（'sufficient' 替代精确余额，'funded' 替代钱包地址和金额）。历史泄露证据：Martin 泄露主机名+OS版本，Qwen 泄露完整代码结构，Kasia_1 泄露服务文件名。

### 致命陷阱

1. **relation_states 是社交决策唯一真相源。** Context Builder 从 /api/discovery/list 读这张表。
2. **Agent 的记忆在 DB，不在文件。** minds/*/memory.json 只是 peerNotes 小缓存。
3. **Adapter JSON 必须 ASCII-safe。** openai.mjs 的 asciiSafeStringify 处理 surrogate pairs。
4. **Brain 超时 180 秒。** 不要调低。
5. **目标 success 也有频率限制。** ≥10 次 success → 12h 冷却。founding-vision 目标失败 50 次也会退役。
6. **启动时 Agent 操作要错开。** staggerMs = agentIndex * 25_000。
7. **Agent 目录名保留下划线。** 正则必须是 `[^a-z0-9_]`（保留下划线），不是 `[^a-z0-9]`。Kasia_1 → minds/kasia_1/（不是 kasia1）。涉及文件：relay.js（创建/Goals）、agent-health.js、mind-manager.js。
8. **reflection lastReflectionTime 必须始终更新。** 不管 JSON 解析成功与否。反思文件名是 `reflections.json`（不是 evolution.json）。
9. **RPC 节点 TCP 可达 ≠ 数据可用。** rpc-health.js 用 getBlockDagInfo() 验证 blockCount > 0 && headerCount > 0，防止未同步节点返回空 UTXO 导致 Agent 余额显示为 0 并自我瘫痪。
10. **Eta 模板 x-data 属性不能包含 > < 字符。** 浏览器会把 `>` 当 HTML 标签结束符，导致 JS 泄露为可见文本。超过 10 行的 x-data 必须提取到 `<script>` 里的命名函数（如 `x-data="agentApp()"`）。
11. **graph.eta 必须跳过自己的地址。** 如果 Agent 地址出现在联系人列表中，nodeMap.set 会覆盖中心节点。用 `if (c.address === myAddr) return` 跳过。

12. **技能注册走统一链路。** Console `registerMindSkills()` 启动时扫描 `.mjs` 文件和子目录 `skill.json`，写入 skills 表。Mind `registry.autoDiscover()` 查 Console skills 表 `isActive` 后加载。**一条链路，一个开关。** 新 Agent 自动继承已有 Agent 的 category 分类。中文正则不能用 `\b`（word boundary 对中文无效）。

13. **messages 表 message_type 必须正确。** `message_type='text'` 才是真正的 DM 消息。query_card（Conversational Ops 系统响应）写入时必须标记 `messageType='query_card'`。discovery/list SQL 的 4 个统计子查询只计 `message_type='text'`。handshake 已有独立 message_type。新增系统消息类型时在 Relay ingest.mjs 写入端标记，不需要改统计 SQL。

14. **Relay comm 消息的 self-send 检测必须覆盖 sender=null。** 广播（comm）是自发自收协议，extractSender 对 self-send TX 可能返回 null。rpc-listener.mjs processComm 的 self-send 检查：`senderAddress === _myAddress || (!senderAddress && plaintext?.startsWith('bcast:'))`。漏掉会导致自己的广播被当成 unknown 来源的 inbound 消息写入。

15. **OAuth 创建 Agent 时 adapter_nodes 表必须回填 url 和 model。** create-adapter 预创建时只有 name+provider，OAuth 回调成功后 oauth.js 必须 updateAdapterNode 写入 ai_provider_url 和 ai_model。否则 UI 显示"未设置"。

16. **proactive SEND_MESSAGE 内容敏感度门控。** action-executor.mjs 的 `_checkContentSensitivity()` 只拦截 proactive（`!_senderMeta`）对外部 peer 的消息。Sibling agent（`siblingAddresses`）不拦。新增敏感模式时在 `SENSITIVE_PATTERNS` 数组添加 `[/regex/, 'category']`。

17. **mm_orders.payment_txhash 有 UNIQUE 索引。** v40 迁移添加了 `idx_mm_orders_payment_txhash_unique`（partial，WHERE NOT NULL）。同一 TX hash 不能绑定两个订单。并发 verify_payment 请求中第二个会被 SQLite UNIQUE 约束拒绝。EVM 验证时还会从 Transfer event 日志提取 sender 地址与预期买方钱包比对，mismatch 写 chain_events + events（Brain 可见）。

18. **握手 alias 必须沿链路传递，不能丢弃。** Relay 解密握手后 `parsed.alias` 是对方的 comm 通信别名。必须传给 `ingestHandshake({ theirAlias })`，Console 存入 `relation_states.their_alias`。`findAddressByAlias` 查这个字段匹配 comm 消息的发送方。丢弃 alias = 所有跨钱包用户的 comm 消息永远找不到发送方。

19. **ingestMessage 的 remoteAddress 不能是 null 或 'unknown'。** `processComm` 和 `processPayment` 必须先判断 `senderAddress` 有效性再调 `ingestMessage`。null/unknown 会导致 `ensureConversation` 创建孤立 conversation（`remote_identity_id = NULL`），违反唯一真相源原则。

20. **Scout 不持久化扫描进度 = 停机期间消息丢失。** `subscribeBlockAdded` 只收新块。`scout_checkpoint` 表记录 `last_block_time`，`message-indexer.mjs` 每 30s flush 一次。`history-fetcher.mjs` 启动时读检查点，按地址从 `api.kaspa.org` 查历史 TX 补全。

21. **历史 comm 消息必须走 processComm（和实时完全相同的路径）。**
22. **activity-log（getActivityLog）必须以 messages 表为主查询。** chain_events 只作为补充（payment/kas_delivery/self_stash）。messages 是 DM 消息的唯一真相源，chain_events 可能漏记（如历史补全场景）。query_card 必须排除。位置：`anti-spam.js:getActivityLog()`。
23. **registerMindSkills 的 category 不能传 null。** skills 表 category 列有 NOT NULL 约束。新技能没有 sibling 时 fallback 到 `'other'`，不是 `null`。位置：`skills.js:221`。

24. **context-builder YOUR CONNECTIONS 必须过滤 do_not_contact 和 blocked 标签。** 否则迟回复检测会对这些 peer 触发 `⚠ PEER MESSAGED YOU N DAYS AGO` 警告，Brain 每个 proactive cycle 都生成无效道歉 ACTION。Anti-spam 会拦截但浪费 AI token。位置：`context-builder.mjs:743`。与 `kbeam_user` 同等过滤。

25. **agent-health lastEvent 黄色阈值必须跟随 proactive 间隔。** 硬编码 30min 对 60min 间隔的 Agent 会每小时误触发 `health_yellow` + `silent repair`。用 `Math.max(T.eventYellow, proIntervalMs)` 让阈值自适应。位置：`agent-health.js:149`。

26. **catch-up 不能读 relation_states 决定行为。** `status='observed'` 同时承载 inbound（别人发来）和 outbound（我已发出）两种语义，catch-up 无法区分，导致对已发出的握手重复发送（双花 0.2 KAS）。改用 `pending_actions` 表（v44）作为意图队列，catch-up 只消费 `action_type='handshake_accept'` + `status='pending'` 的记录。所有花钱操作必须先写 pending_actions 再执行 sendKaspa，通过乐观锁（`UPDATE WHERE status='pending'`）防止并发重复执行。

27. **花钱路径必须先写意图再花钱。** 四条握手路径（Brain 主动、Relay 自动接受、catch-up、Scout 观察）都必须先在 `pending_actions` 写入记录并 claim 成功，才能调 sendKaspa。claim 失败 = 别的消费者已在处理，直接跳过。`pending_actions` 的写入统一用 `INSERT OR IGNORE`（`idempotent_key` UNIQUE 约束去重），状态推进用乐观锁。

28. **triggerProactiveAll 必须过滤自发握手事件。** newHandshake.from = 当前 Agent 地址时跳过 proactive 触发。否则 Agent 发出的握手被 Scout 扫到后反触发自己的 proactive → Brain 把自己的地址当成外部 peer → 循环自发握手（Sophie 4/4 28 笔）。实际只浪费 fee（amount 回到自己），但噪音大。位置：`mind-manager.js:triggerProactiveAll`。context-builder.mjs RECENT ACTIVITY 也标注自身地址 `[THIS IS YOUR OWN ADDRESS — DO NOT CONTACT]`。

29. **tx_records 必须有 local_address 字段（v45）。** 握手 TX 没有 conversation_id，无法通过 conversations JOIN 归属 Agent。`local_address` 在 ingestTx 时由 Relay 传入（16 个调用处全部补传）。ledger 查询握手分支用 `WHERE local_address = ?` 过滤。历史补填 60/207 条（29%），剩余为历史缺口不影响金额统计。

### pending_actions 架构（v44）

**意图与事实分离：**
```
意图层                    执行层               事实层
pending_actions 表  →   Relay sendKaspa  →   relation_states
(谁该做什么)            (实际花钱)            messages / chain_events
                                              (链上事实记录)
```

**表结构：** `id, action_type, direction, local_address, target_address, source, idempotent_key(UNIQUE), status, retry_count, max_retries, trigger_txid, result_txid, error, created_at, updated_at`

**状态机：** `pending → executing → done` / `pending → executing → failed(→pending 重试) → expired`

**四条路径的写入和消费：**

| 路径 | 谁写 pending_actions | 谁消费 | idempotent_key |
|------|---------------------|--------|----------------|
| Brain 主动握手 | action-executor（source=mind） | action-executor claim + Relay IPC | handshake_init:{local}:{peer} |
| Relay 自动接受 | rpc-listener create_and_claim（source=relay）| 自己（实时执行） | handshake_accept:{local}:{peer} |
| catch-up | 不写（消费 ingest/scout 写的） | catch-up claim → sendKaspa | — |
| Scout 观察 | discovery.js（source=scout） | catch-up 消费 | handshake_accept:{local}:{peer} |
| ingest 上报 | ingest-service.js（source=ingest） | Relay 实时或 catch-up | handshake_accept:{local}:{peer} |

**关键文件：**

| 文件 | 职责 |
|------|------|
| kasia-console/src/db/migrate.js | v44: pending_actions 表 |
| kasia-console/src/services/catchup-service.js | getPendingHandshakes（查 pending_actions）+ claim/complete/fail |
| kasia-console/src/services/ingest-service.js | inbound 写 pending_actions，outbound 标 done |
| kasia-console/src/api/ingest.js | ?claim= 乐观锁 + ?create_and_claim= 原子创建+锁定 |
| kasia-console/src/api/discovery.js | Scout 上报 inbound 时写 pending_actions |
| kasia-relay/src/rpc-listener.mjs | 实时 create_and_claim + catch-up 消费 |
| agent-mind/src/action-executor.mjs | Brain 握手前写 pending_actions(handshake_init) |

 Relay catch-up 从 `kanet_message_index` 取未处理 comm TX → 按 txid 从链上取 payload → `processComm(txid, payload, null)` → `findAddressByAlias` 查 `relation_states.their_alias`。不新建任何函数或端点。`processed_at` 字段做幂等保护。

### Skill 系统架构

**两种技能格式（同一条注册链路）：**

| 格式 | Console 注册 | Mind 加载 | 示例 |
|------|-------------|----------|------|
| 单文件 `.mjs` | registerMindSkills 扫描 super('name','desc') | registry.autoDiscover 查 isActive | self-awareness.mjs |
| 包式 `skill.json` | registerMindSkills 扫描子目录 skill.json | registry.autoDiscover 查 isActive | conversational-ops/, code-ops/ |

**包式技能结构：**
```
skills/my-skill/
  skill.json       ← 元数据（id, name, version）
  intents.json     ← 意图注册（可选，conversational-ops 模式）
  tools.json       ← 工具定义（可选，code-ops 模式）
  executor.mjs     ← 执行器
```

**注册链路（唯一）：**
```
Console 启动 → registerMindSkills()
  ├─ 扫描 .mjs 文件 → super('name','desc') 提取 → 写入 skills 表
  └─ 扫描子目录 skill.json → meta.id 提取 → 写入 skills 表
  └─ 新 Agent 自动继承 sibling 的 category/trust/side_effect

Mind 启动 → registry.autoDiscover()
  ├─ 查 Console /api/agent/mind-skills → activeNames
  ├─ .mjs 文件 → isActive 检查 → 加载
  └─ 子目录 skill.json → isActive 检查 → 加载
```

### code-ops: 行为分层模型

Agent 根据上下文在四个行为层之间切换：

| 层级 | 名称 | 工具 | 激活条件 |
|------|------|------|---------|
| L1 | 社交态 | 无 | 默认 |
| L2 | 任务态 | 无（输出文本方案） | owner 请求方案 |
| L3 | 观察态 | read_file, search_code, http_get | owner 请求诊断（二段确认） |
| L4 | 行动态 | write_file, run_command, http_mutate | owner 请求执行（二段确认） |

**关键规则：** 默认 L1，Agent 不主动升级。L4 idle 5min / 最长 30min 自动降回 L1。Self-healing L4 屏蔽 write_file 和变更 HTTP。非 owner 最高 L3。

**文件：** `agent-mind/src/skills/code-ops/`（layer-engine.mjs + intent-detector.mjs + executor.mjs + tools.json）

**实现关键点：**
- 工具执行在 `mind.mjs:executeTradeAction()` 的 switch 里（和交易 ACTION 同一个 dispatch）
- Brain context 注入在 `context-builder.mjs:_buildReactiveUser()` 的 sections 最前面（确保 Brain 优先看到工具）
- 包式技能注册在 `skills.js:registerMindSkills()` 扫描子目录 skill.json（与 .mjs 同一条路径）
- intent-detector 中文正则不能用 `\b`（word boundary 对中文无效）

**2026-04-02 验证通过：** Eric 通过 code-ops L3 读取 relay.log，分析 200 行日志，识别出 MCP server 重复启动问题。

详见设计文档：`docs/code-ops-design.md`

---

