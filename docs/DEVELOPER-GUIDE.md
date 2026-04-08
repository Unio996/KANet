# KANet Developer Guide

> **修改任何代码前必读。** 一个文件，覆盖全系统。唯一权威开发者文档。
> 初版 2026-03-31（合并 12 个 dev-*.md），最近更新 2026-04-06。
> 4/6 更新：技术债清零（v46/v47 DROP 两张表） + DATABASE.md 数据字典 + exchange 交割全流程（manual/cross_chain_tx/超时/争议/套利链路）。cross-chain-verify.mjs 独立模块。
> 4/5 更新：pending_actions 意图队列（v44）— 意图与事实分离，修复 catch-up 重复握手双花。陷阱 #24-27。花费账本页 /ledger。IB Gateway 不随启动。
> 4/4 下午更新：做市三层架构（market-scanner + order-executor + 自动对冲）、activity-log 改读 messages、contacts.eta 时间本地化、PLACE_ORDER free_market 指向 /exchange。
> 4/4 更新：陷阱 #18-21（alias 链路/ingestMessage null 保护/Scout 检查点/历史 comm 补全），新增消息补全文件速查表，Scout light mode。
> 4/3 更新：社交缺陷 #13 已修（迟回复警告）、陷阱 #13-17。第十五章 API 速查表（~200 个端点）。

---

## 第零条：不猜代码，查了再写

列名用 `PRAGMA table_info`，函数名用 grep，参数名看调用方。
记忆不可信，代码是唯一真相。每次引用前先验证，零例外。

---

## 一、系统架构

```
┌──────────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│   Console    │  │   Relay   │  │   Scout   │  │   Mind    │  │  Adapter  │
│  数据中枢+UI  │  │ 链上代理人  │  │ 链上观察者  │  │ Agent灵魂  │  │ AI大脑桥接 │
│  port 3100   │  │ 每Agent一个 │  │   单进程   │  │ Console库  │  │ 每Agent一个│
└──────────────┘  └───────────┘  └───────────┘  └───────────┘  └───────────┘
 25+表 SQLite      持有私钥        无私钥         五核架构        多provider
 ~100 API          加解密          被动扫描       Context Builder  OpenAI/Grok
 .eta UI           签名TX         发现+记录       Action Executor  Deepseek
 Mind Manager      IPC上报        discovery API   Skill Registry   ASCII-safe
```

**关键边界：**
- Console 不碰链（kaspa-wasm 仅用于地址派生）
- Relay 是唯一能签名和解密的模块
- Scout 只读不写（无私钥）
- Mind 通过 Console API 间接操作
- Adapter 纯透传，不持久化

**环境变量：** `KANET_ROOT` 在 kanet.env 中定义，部署只改这一处。

---

## 二、消息管道（5 条发出路径）

### 发出路径完整表

| # | 触发 | 执行 | 记录 |
|---|------|------|------|
| 1 | AI 回复 DM | rpc-listener.mjs → sendKaspa | ingestTx + ingestMessage + ingestReply |
| 2 | AI 广播回复 | chat.js → sendCommandAsync(send_broadcast) | broadcast_messages + chain_events(comm_sent) |
| 3 | IPC send_message | relay.mjs case 'send_message' → sendKaspa | ingestTx + ingestMessage |
| 4 | 握手 | relay.mjs initiateHandshake → sendKaspa | ingestHandshake + ingestTx |
| 5 | IPC send_broadcast | relay.mjs case 'send_broadcast' → sendKaspa | broadcast_messages |

### 必须遵守的调用顺序

```
const sent = await sendKaspa(...);          // 1. 发TX，拿txId
ingestTx({ txid: sent.txId, ... });         // 2. 记TX
ingestMessage({ txid: sent.txId, ... });    // 3. 记消息内容
ingestReply({ sentTxid: sent.txId, ... });  // 4. 记AI回复（仅AI路径）
```

### chain_events 数据合约

| event_type | 谁写 | 何时 | 谁读 |
|------------|------|------|------|
| `handshake` | ingest-service | 收到/发出握手 | anti-spam, episode-builder, conversations |
| `text` | ingest-service | DM 消息（messageType 默认值） | anti-spam, conversations |
| `comm` | ingest-service | comm 类型消息 | anti-spam, conversations |
| `comm_sent` | chat.js | Agent 发广播 | anti-spam, conversations |
| `comm_received` | ingest-service | 收到 comm | anti-spam（回复检测） |
| `tx` | ingest-service | 链上交易 | — |
| `payment` | trade-protocol-filter | 订单付款 | agent-health |
| `payment_failed` | trading.js | 付款失败 | agent-health |
| `payment_verified` | trading.js | 付款验证通过 | — |
| `payment_underpayment` | trading.js | 付款金额不足 | — |
| `kas_delivery` | order-machine / protocol-filter | KAS 交割 | — |
| `kas_delivery_failed` | trading.js | KAS 发送失败 | — |
| `verify_failed` | trading.js | 验证异常 | — |
| `withdraw` | trading.js | 提现 | — |

**关键：** anti-spam 查询 `IN ('comm', 'comm_sent', 'text', 'handshake')`。新增发送路径必须确保 event_type 在此列表中。

---

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

## 五、Health Monitor + Self-Healing

### 7 项指标

| 指标 | 绿 | 黄 | 红 |
|------|-----|-----|-----|
| Relay/Adapter 进程 | 运行中 | — | 未运行 |
| 最近事件 | <30min | 30min-2h | >2h |
| Proactive 周期 | <间隔×2 | <间隔×4 | >间隔×4 |
| Reflection 周期 | <间隔×2 | <间隔×4 | >间隔×4 |
| 错误 (2h) | <3 | 3-10 | >10 |
| 拦截 (2h) | <3 | 3-10 | >10 |
| 支付失败 (24h) | 0 | 1-2 | >=3 |

### 行为

- 绿 → 正常（如果之前红 → 解除 _healthPaused）
- 黄 → silentRepair（触发 reflection / 清理目标）
- 红 → emergencyRepair + 暂停 proactive + 同伴互助通知（4h 冷却）
- Relay down → 短路（不查其他指标）

---

## 六、UI 组件系统

### 技术栈

Fastify + Eta 模板 + Tailwind CSS + Alpine.js

### 新页面 boilerplate

```html
<%~ include('partials/page-open', { _page: 'mypage', pageTitle: '标题', ...it }) %>
<div class="p-6" x-data="{ }">
  <!-- 内容 -->
</div>
<%~ include('partials/page-close', it) %>
```

### 设计系统 v2 色板

```
背景: warm-50 #faf9f7 → warm-300 #e4e2dc
文字: ink-400 #6b6d7b → ink-700 #1a1a2e
品牌: brand-500 #3b82f6 → brand-700 #1d4ed8
语义: success #16a34a | warning #d97706 | error #dc2626
```

### 核心 CSS 类

badge / card / btn / tab-bar / status-dot / approval-card / skeleton / verify-layer-1/2/3

### KANet.js 全局工具

shortAddr / copy / relativeTime / **formatTime** / formatKas / statusLabel / statusColor / healthDot / sideLabel / chainName

### 页面路由表（2026-04-02 更新）

**独立页面（新设计系统）：**

| 路由 | 模板 | 说明 |
|------|------|------|
| `/chat` | chat-v3.eta | 广播聊天 |
| `/contacts` | contacts.eta | 通讯录 |
| `/agent` | agent-v2.eta | Agent 概览（含 tab: wallet/card/goals/skills/history/status） |
| `/agent/status` | agent-status.eta | Agent 健康监控（独立页） |
| `/agent/history` | agent-history.eta | Episode 历史（独立页） |
| `/skills` | skills.eta | 技能管理 |
| `/graph` | graph.eta | 关系图谱 |
| `/explore` | explore.eta | 网络探索 |
| `/discovered` | discovered.eta | 发现的地址 |
| `/market-overview` | market-overview.eta | 市场概览 |
| `/stocks` | stocks.eta | 股票 |
| `/predictions` | predictions.eta | 预测市场 |
| `/handshakes` | handshakes.eta | 握手报告 |
| `/story` | story.eta | Episode 视图 |
| `/exchange` | exchange.eta | 协议级自由市场（Market / My Deals / Arbitrage 三 Tab） |

**保留页面（已调色融合，功能完整）：**

| 路由 | 模板 | 说明 |
|------|------|------|
| `/trading` | trading.eta | 交易所（ink 色调，2906 行） |
| `/market` | market.eta | 自由市场（深色主题，1049 行） |
| `/events` | events.eta | 事件日志 |
| `/conversations` | conversations.eta | 会话列表 |
| `/identities` | identities.eta | 地址簿 |
| `/network` | network.eta | 网络分析 |
| `/relays` | relays.eta | 账户管理 |
| `/adapters` | adapters.eta | AI 引擎 |
| `/dashboard` | dashboard.eta | 仪表盘 |

**新设计框架（待调通）：** `/trading-v2`, `/market-v2`

**GitHub 仓库：** https://github.com/Unio996/KANet （私有）

---

## 七、Conversational Ops

### 架构

```
User input → parseIntent(message)
  ├── Match → executeQuery() → buildQueryTask() → Brain 解读 → 返回
  ├── Execute → confirm card (30s token) → click → 执行
  └── No match → 正常 Brain reactive 流程
```

13 个意图（8 query + 3 execute + 1 trigger + 1 reputation）。
权限：owner 全权 / trusted 仅 query / stranger 仅 query / blocked 拒绝。

### 包式技能格式

```
skills/conversational-ops/
  skill.json + intents.json + executor.mjs
```

registry.mjs 自动扫描，单文件和包式并存。

---

## 八、市场系统（8 数据源 + 券商 + 预测市场）

### 数据源（market-data.js，10 分钟缓存，独立失败互不影响）

| # | 数据源 | API 端点 | 提供什么 | Brain 感知 |
|---|--------|---------|---------|-----------|
| 1 | MEXC | `/api/market/crypto` | KAS/BTC/ETH 价格+涨跌 | trade_sense |
| 2 | Yahoo Finance | `/api/stocks/*` | 自选股行情 + 52周高低 | stock_tracker |
| 3 | Polymarket | `/api/predictions/markets` | 1000 个预测市场 | prediction_sense |
| 4 | Yahoo Finance | `/api/market/commodities` | 黄金/原油/白银 | stock_tracker |
| 5 | Binance | `/api/market/funding` | BTC 资金费率 | stock_tracker |
| 6 | Alternative.me | `/api/market/sentiment` | 恐贪指数 | stock_tracker |
| 7 | **CoinGecko** | `/api/market/crypto-global` | 总市值/BTC市占率/活跃币种 | **stock_tracker** |
| 8 | **Forex Factory** | `/api/market/calendar` | 经济日历/今日高影响力事件 | **stock_tracker** |

**Agent 怎么看到这些？** stock_tracker.mjs 在 gatherContext 中并行 fetch overview + crypto + crypto-global + calendar，formatForBrain 输出：
```
Crypto macro (CoinGecko): Total $2.41T (-0.1%) | BTC dominance 56.2%
Crypto prices: BTC $68,344 +2.5% | KAS $0.033

TODAY'S HIGH-IMPACT EVENTS (4):
  08:15 USD ADP Non-Farm Employment Change (exp 41K)
  08:30 USD Core Retail Sales m/m (exp 0.3%)
  ...
```

### 预测市场（Polymarket）

**数据流：** Gamma API → market-data.js（1000 条，两页并行拉取）→ predictions.eta（分类+分页+到期过滤）

**持仓查询：** `/api/predictions/positions` → CLOB SDK getTrades → 聚合成持仓 → 从 CLOB API 解析 market question（带缓存）→ 返回人话标题而非 hex ID

**Agent 下注：** `[ACTION:POLYMARKET_ORDER market=<conditionId> outcome=yes side=BUY price=0.15 size=50]`
- 执行在 action-executor.mjs:executePolymarketOrder
- 护栏：单笔 ≤ $50，必须有 Polygon 钱包 + CLOB Key
- 下单后写 memory event `polymarket_order`

**UI 功能：**
- 排序：热门/即将到期/争议最大/最新
- 分类标签：Crypto/Politics/Economy/Sports/Tech/Other
- 分页：每页 20 条
- 到期过滤：默认隐藏已过期，"含历史"开关
- **"问 Agent"按钮：** 每个市场卡片可请求 Agent 分析，支持多轮对话

### Agent 资产感知（self_awareness.mjs）

Brain 在每次 proactive/reactive 看到完整资产画像：
```
KAS Balance: 21.5 KAS
Multi-chain wallets: BNB 6.67 USDT | Polygon 0.84 USDC + 34.38 MATIC

Prediction market positions (2):
  "Crude Oil $105 by March" → No 38 shares @ $0.849 (cost $32.26) [CLOSED — pending settlement]
  "Iranian regime fall" → Yes 70 shares @ $0.002 (cost $0.14)

Stock positions (盈透证券):
  TSLA: 11 shares @ $413.31 → ... (-39.9%)
  QS: 88 shares @ $54.98 → ... (-87.6%)

Active OTC orders: 0
```

### 券商（broker.js）

统一 BrokerAdapter 接口：IBKR / Alpaca / Tradier / Tiger。
凭证 AES-256 加密存储。

**IBKR 特殊处理：**
- 使用 `@stoqey/ib`（TWS API socket 协议），不是 REST
- 默认端口 4001（Live），4002（Paper）
- `kanet-start.sh` 自动检测 IB Gateway 并启动（用户只需在弹出窗口登录）
- keepAlive 60s tickle 保活
- Gateway 死连接会导致 socket 满 → 需重启 Gateway 清理

---

## 九、Episode 系统

查询时聚合 chain_events + mm_orders + execution_states → Episode 列表。
不改底层表，纯视图层。

四个内 tab：故事线 / 通讯录 / 会话 / 链上凭证。
Agent 决策理由从 execution_states.display_summary 注入。

---

## 十、关键文件速查

### 核心服务

| 文件 | 职责 |
|------|------|
| kasia-console/src/services/mind-manager.js | 调度器 + Gate 1 + health loop + proactive/reflect 定时 |
| kasia-console/src/services/anti-spam.js | 社交防护（per-peer/跨Agent/无回复退避）+ 行为统计 |
| kasia-console/src/services/order-machine.js | 交易状态机 + auto-advance + 三模式 |
| kasia-console/src/services/market-data.js | 8 数据源聚合（MEXC/Yahoo/Polymarket/CoinGecko/ForexFactory/Binance/Alternative.me） |
| kasia-console/src/services/ingest-service.js | Relay 上报→DB 写入（messages/chain_events/relation_states） |
| kasia-console/src/services/agent-health.js | 7 项指标 + 红绿灯 |
| kasia-console/src/services/broker-ibkr.js | 盈透证券适配器（@stoqey/ib TWS API socket） |

### Agent Mind

| 文件 | 职责 |
|------|------|
| agent-mind/src/mind.mjs | handleMessage + runProactive(max 3 actions) + runReflection |
| agent-mind/src/context-builder.mjs | 四层 prompt + YOUR RECENT OUTBOUND + CONNECTIONS + founding-vision 过滤 |
| agent-mind/src/action-executor.mjs | Gate 3 + sendMessage(去重+fail-closed) + POLYMARKET_ORDER + MAKE_MARKET + CANCEL_OFFERS + 交易 |
| agent-mind/src/kernels/intent.mjs | 目标 + recordAttempt + cooldown + auto-retire |
| agent-mind/src/skills/self-awareness.mjs | KAS余额 + 多链钱包 + Polymarket持仓 + broker持仓 + OTC订单 |
| agent-mind/src/skills/stock-tracker.mjs | 自选股 + 大宗 + CoinGecko大盘 + 经济日历 + 恐贪 → Brain宏观视野 |
| agent-mind/src/skills/prediction-sense.mjs | Polymarket 热门事件 → Brain 情绪信号 |
| agent-mind/src/skills/market-scanner.mjs | 8 CEX + KANet 价差扫描（1h proactive / reactive 关键词）|
| agent-mind/src/skills/order-executor.mjs | KANet 做市指令生成（MAKE_MARKET ACTION + 对冲参考）|

### 链上通信

| 文件 | 职责 |
|------|------|
| kasia-relay/src/relay.mjs | IPC 命令处理 + shouldBlockOutbound(30min/85%/幻觉模式) |
| kasia-relay/src/rpc-listener.mjs | 链上事件处理 + AI 回复 + 握手 |

### 共享模块

| 文件 | 职责 |
|------|------|
| shared/lib/event-types.mjs | chain_events event_type 枚举（写入方和查询方统一引用） |
| shared/lib/rpc-utils.mjs | Relay/Scout 共用 resolveRpcUrl + backoffDelay |

### 消息补全与索引

| 文件 | 职责 |
|------|------|
| kaspa-scout/src/light-scanner.mjs | 无本地节点降级模式（subscribeUtxosChanged + blockAdded 双订阅） |
| kaspa-scout/src/message-indexer.mjs | 扫链时为认识的地址写 kanet_message_index + 检查点持久化 |
| kaspa-scout/src/history-fetcher.mjs | 启动时按地址查 api.kaspa.org 补全停机期间历史 TX |

### 协议级自由市场

| 文件 | 职责 |
|------|------|
| kasia-console/src/api/exchange.js | 8 API 端点 + /exchange 页面路由 |
| kasia-console/src/services/exchange-machine.js | 状态机（open→matched→verifying→completed） |
| kasia-console/src/services/exchange-verifiers.js | 可插拔验证器（manual/cross_chain_tx/kaspa_tx） |
| kasia-console/src/services/exchange-orders.js | 8 交易所统一下单（placeOrder/cancelOrders/getOpenOrders） |
| kasia-console/src/services/trade-protocol-filter.js | 链上协议→本地索引 + matched 自动 CEX 对冲 |
| kasia-console/src/ui/exchange.eta | 协议级自由市场 UI |

### 测试与文档

| 文件 | 职责 |
|------|------|
| test/smoke.mjs | 21 项关键路径 smoke test（`node test/smoke.mjs`） |
| docs/DEVELOPER-GUIDE.md | 本文件 — 唯一权威开发者文档 |
| docs/ALPHA-CHECKLIST.md | Alpha 达标标准（4 条） |

---

## 十一、时间显示规范

**所有时间显示必须使用用户本地时区，不硬编码语言/时区。**

| 场景 | 正确做法 | 错误做法 |
|------|---------|---------|
| 服务端格式化 | `toLocaleString(undefined, { hour12: false })` | `toISOString()` / `toLocaleString('zh-CN')` |
| 客户端绝对时间 | `KANet.formatTime(iso)` | `.slice(5,16)` 截取 ISO 字符串 |
| 客户端相对时间 | `KANet.relativeTime(iso)` | 手写差值计算 |
| Relay 日志 | `toLocaleString(undefined, { hour12: false })` | `toISOString()` |
| DB 存储 | `toISOString()`（UTC，这是正确的） | 本地时间字符串 |

**kanet-ui.js 工具函数：**
- `KANet.formatTime(iso)` — 绝对时间，本地时区，格式 `MM/DD HH:MM:SS`
- `KANet.relativeTime(iso)` — 相对时间，"3 分钟前"、"昨天"

**致命陷阱：** `new Date(iso).toISOString()` 永远输出 UTC。如果把它显示在 UI 上，用户看到的时间会偏移。必须用 `toLocaleString()` 或 `KANet.formatTime()`。

---

## 十二、已知局限（不修，记录在案）

| # | 问题 | 原因 |
|---|------|------|
| 1 | Perception 30s 缓存 + 50 peer 上限 | 当前规模足够 |
| 2 | Gate 1 速率限制纯内存（重启重置） | 危害有限 |
| 3 | tx_records.status 永远 broadcasted | 改 Relay listener 链路长风险高 |
| 4 | catch-up 限制 100 握手 + 50 消息 | 当前规模下不触发 |
| 5 | 双重 whale alert（scanner + whale-alert.mjs） | 阈值已统一，架构重复 P3 |
| 6 | Adapter 遗留 <<SKILL:annotate:...>> 系统 | 和 Mind Skill Registry 两套并存 P3 |
| 7 | protocol.mjs Relay/Scout 各一份 | shared/ 可合并 P3 |
| 8 | ~~kaspa-scout/package.json 硬编码 file: 路径~~ | **已解决（2026-04-08，kaspa-wasm → shared/vendor/kaspa-wasm v1.0.1）** |
| 9 | ~~account_relations 双写~~ | **已解决（v46 DROP TABLE, 2026-04-06）** |
| 10 | ~~interaction_records 残留读取~~ | **已解决（v47 DROP TABLE, 2026-04-06，17 处迁移到 chain_events）** |
| 11 | ~~replies.sent_txid 盲匹配 hack~~ | **已解决（2026-04-06，chain_events 是真相源）** |

> **数据库字典：** 改表前必查 `docs/DATABASE.md`，34 张活跃表全覆盖。migrate.js 当前最新版本 v50。
>
> **2026-04-08 新增：**
> - v50: `adapter_nodes.is_enabled` — 记住用户手动停止状态，重启后不自动拉起
> - `rpc-health.js`: 局域网私有 IP（10.x/172.16-31.x/192.168.x）视同本地节点，Scout 自动切换全量 RPC 模式
> - `whale-signal.js`: 价格源从仅 mm_quotes 扩展到 market-data 缓存（getCachedKasPrice）
> - `kaspa-wasm` 改为 `shared/vendor/kaspa-wasm`（v1.0.1，file: 引用）。**注意：npm @onetokenfe/kaspa-wasm-node@1.0.2 的 sign() 有 sighash 缺陷（payload 不纳入签名），1.0.1 正常。**
> - Adapter UI: 三态状态显示（绿=AI可用/黄=AI错误/灰=离线）+ Ollama 模型自动发现
> - OAuth 回调自动清理空 api_key 连接
> - Mind adapter 动态切换：UI 换 AI 引擎后 30s 内自动生效，无需重启
> - Ollama 本地模型接入：openai provider + localhost:11434/v1，支持 qwen3:30b / qwen2.5vl:32b 等

---

## 十三、认证系统（agent_connections）

### 架构原则

> **Console 拥有凭证，Adapter 消费凭证。resolveRequestAuth 是唯一入口。**

```
Console (凭证所有者)              Adapter (凭证消费者)
─────────────────               ─────────────────
agent_connections 表             resolve-auth.mjs 本地缓存
  api_key / oauth / gateway      ↓
Connection Manager               GET /api/auth/resolve-by-adapter/:id
  resolveRequestAuth()           ↓
  refresh worker (60s)           拿到 { headers, baseUrl, model }
  OAuth callback (port 1455)     ↓
                                 发 AI 请求（401 → 重试一次）
```

### agent_connections 表

| 字段 | 说明 |
|------|------|
| auth_mode | api_key / oauth / gateway |
| status | connected / expiring / refreshing / expired / refresh_failed / reauth_required / revoked |
| credential_version | 每次 token 更新 +1，Adapter 缓存据此失效 |

### 三种连接模式

| 模式 | 用户体验 | token 生命周期 |
|------|---------|---------------|
| api_key | 填 API Key | 永久 |
| oauth | 浏览器登录授权 | access_token ~1h-10d，refresh_token 自动续期 |
| gateway | 填 gateway token | 永久（OpenClaw 管理） |

### OAuth 流程（OpenAI Codex）

1. Console 生成 PKCE code_verifier + code_challenge
2. 浏览器跳转 auth.openai.com/oauth/authorize
3. 用户登录 ChatGPT 账号授权
4. OpenAI 回调 localhost:1455/auth/callback
5. Console 用 authorization_code 换 access_token + refresh_token
6. 加密存入 agent_connections
7. Adapter 通过 resolveRequestAuth 拿到 Bearer token

**关键：** OAuth token 调的是 `chatgpt.com/backend-api/codex/responses`（Codex Responses API），不是 `api.openai.com/v1/chat/completions`。openai.mjs 自动检测 baseUrl 切换请求格式。

### Adapter 请求流程

```
1. 检查本地缓存（未过期 && >5min margin && 未 401）
2. 无缓存 → GET /api/auth/resolve-by-adapter/:adapterId
3. 用返回的 headers + baseUrl 发请求
4. 成功 → 返回
5. 401 → 清缓存 → resolve(force_refresh=true)
   status=connected → 重试一次
   其他 → 直接失败
6. 每个请求最多重试一次
```

### 关键文件

| 文件 | 职责 |
|------|------|
| kasia-console/src/services/connection-manager.js | resolveRequestAuth + CRUD + refresh worker |
| kasia-console/src/api/auth.js | resolve / connections 端点 |
| kasia-console/src/api/oauth.js | OAuth start/callback + 临时 1455 端口监听 |
| agent-adapter/src/providers/resolve-auth.mjs | 共享 auth 缓存 + 401 恢复 |

---

## 十四、协议级自由市场（/exchange）

> 2026-04-03 上线。设计文档：`自由市场设计决策文档 v1.1`，哲学文档：`kanet-free-market.md`。

### 核心哲学

**协议不是规则，协议是格式。** 规则说"你只能交易这些资产"，协议说"你要交易什么，填在这个字段里"。KANet 自由市场是 Kaspa 底层哲学（转账不可干预）在应用层的延伸：交易本身不可干预。

### 与现有交易系统的关系

```
/trading  — KAS/USDT 专用交易所接口（保留，不碰）
/market   — KAS/USDT OTC（保留，不碰）
/exchange — 协议级自由市场（新建，从这里开始长）
```

三条路线独立运行。`/exchange` 不依赖 order-machine.js 或 trading.js。

### 数据模型（exchange_offers 表，v38）

```sql
exchange_offers:
  id                  — UUID（本地生成或从广播 msg.id 取）
  broadcast_tx_id     — 链上广播 TX hash（乐观写入时为 pending_xxx）
  message_index       — 同一 TX 多条广播时的序号

  give_asset          — 我给什么（自由字符串：KAS / BTC / "代码审计10h"）
  give_amount         — 数量（字符串存储，避免跨精度炸弹）
  give_chain          — 资产所在链（kaspa / bitcoin / null）

  want_asset          — 我要什么（自由字符串）
  want_amount         — 数量（字符串存储）
  want_chain          — 期望对方用哪条链

  maker               — 挂单方地址
  broadcast_at        — 广播时间
  expires_at          — 过期时间

  verification        — 验证类型：manual / cross_chain_tx / kaspa_tx
  verification_meta   — 验证参数 JSON

  protocol_status     — open / matched / completed / cancelled / expired / timed_out
  is_fully_observed   — 本节点是否观测到完整生命周期（0/1）
  market_key          — 派生分组键（字母排序：[give,want].sort().join('|')）
```

**关键设计：**
- `give_asset` / `want_asset` 是**自由字符串**，不是枚举。协议不审判标的。
- `market_key` 不进链上协议，只是本地索引派生。
- `give_amount` / `want_amount` 用字符串存储（KAS sompi 精度、跨链精度、服务类无标准单位）。

### 协议消息（3 种）

| 消息类型 | JSON `t` 值 | 作用 |
|---------|-------------|------|
| 发布报价 | `kanet_exchange_v1` | 广播 give/want/verification 等 |
| 接单 | `kanet_exchange_accept_v1` | 引用 offer_id |
| 取消 | `kanet_exchange_cancel_v1` | 引用 offer_id，仅 maker 可取消 |

消息流经 `onBroadcastWritten()` → switch dispatch → `handleExchange()` 等处理器（trade-protocol-filter.js）。

### 乐观更新

publish/accept/cancel 操作**先写本地 DB，再异步广播到链上**。链上广播是锚定确认，不阻塞 UI 显示。广播失败（如 Relay 同步中）不影响本地操作。

### 验证器注册表（可扩展）

```
"cross_chain_tx"  → 现有 cross-chain-verify.mjs（BNB/ETH/SOL/TRON USDT）
"kaspa_tx"        → Kaspa TX 确认
"manual"          → 双方手动确认（服务类交易、无链资产）
"btc_tx"          → BTC TX 确认（待建）
"oracle"          → 第三方预言机（未来）
```

每个报价自带 `verification` 字段。新资产 = 新验证器实现，状态机代码不变。

### 节点索引机制

**参与即索引，缺席即空白。** 没有中心索引服务器。每个节点只索引自己启动后观测到的广播。节点间数据不一致是设计，不是 bug。

### API 端点

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/exchange/offers` | 报价列表（支持 market_key/status/maker 过滤） |
| GET | `/api/exchange/offers/:id` | 单个报价详情 |
| GET | `/api/exchange/markets` | 活跃市场对列表 |
| GET | `/api/exchange/agents` | 可用 Agent 列表 |
| POST | `/api/exchange/publish` | 发起报价（乐观写 DB + 异步广播） |
| POST | `/api/exchange/accept` | 接单（乐观更新 + 异步广播） |
| POST | `/api/exchange/cancel` | 取消（乐观更新 + 异步广播） |

### 关键文件

| 文件 | 职责 |
|------|------|
| kasia-console/src/api/exchange.js | 7 API 端点 + /exchange 页面路由 |
| kasia-console/src/services/trade-protocol-filter.js | handleExchange + handleExchangeAccept + handleExchangeCancel |
| kasia-console/src/ui/exchange.eta | 协议级自由市场 UI（广播流 + 分组 + 发布表单） |
| kasia-console/src/db/migrate.js | v38: exchange_offers 表 |

### 做市与对冲（2026-04-04）

**三层架构**：

| 层 | 职责 | 文件 |
|----|------|------|
| L1 扫描 | 8 CEX + KANet 价差矩阵 | market-scanner.mjs |
| L2 指令 | MAKE_MARKET ACTION 生成 | order-executor.mjs → action-executor.mjs |
| L3 对冲 | offer matched → CEX 反向单 | trade-protocol-filter.js → exchange-orders.js |

**MAKE_MARKET 流程**：
```
Brain: [ACTION:MAKE_MARKET amount=500 sell_price=0.03135 buy_price=0.03117 hedge_cex=Gate]
  → action-executor.mjs:executeMakeMarket()
  → POST /api/exchange/publish × 2（卖单 + 买单）
  → execution_states 记录
```

**自动对冲流程**：
```
KANet offer matched（kanet_exchange_accept_v1）
  → trade-protocol-filter.js:handleExchangeAccept()
  → 判断 maker 是本地 Agent
  → _executeHedge()：exchange_accounts 凭证 → exchange-orders.js:placeOrder()
  → chain_events 记录（hedge_placed / hedge_failed / hedge_skipped）
```

**对冲断路器**：1h 内 ≥3 次 hedge_failed → 停止对冲，写 hedge_skipped 事件。

**market-scanner 8 家交易所**：

| 交易所 | 类型 | 端点 |
|--------|------|------|
| MEXC | 现货 | api.mexc.com bookTicker |
| Gate | 现货 | api.gateio.ws tickers |
| KuCoin | 现货 | api.kucoin.com level1 |
| Bybit | 现货 | api.bybit.com tickers |
| Bitget | 现货 | api.bitget.com tickers |
| HTX | 现货 | api.huobi.pro merged |
| Binance | **永续合约** | fapi.binance.com bookTicker |
| Kraken | 现货 | api.kraken.com Ticker |

全部公开 API，无需认证。30s 缓存。proactive 每小时一次，reactive 关键词触发。

**Brain 输出格式**：无机会（<0.3%）→ 4 行摘要 + "observation only"；有机会（≥0.3%）→ 展开⚡机会 + 完整价格表 + MAKE_MARKET 授权提示。

### 交割流程（2026-04-06 补完）

**manual 验证路径：**
```
open → matched → awaiting_manual_confirm → maker confirm + taker confirm → completed
```
POST `/api/exchange/confirm` { relayNodeId, offer_id, role:'maker'|'taker' }
processManualConfirm：验证 confirmer_address 是 maker/taker → 写 maker/taker_confirmed_at → 双方都确认 → completed。

**cross_chain_tx 验证路径：**
```
open → matched → verifying → taker submit-payment → 异步验证 → completed
```
POST `/api/exchange/submit-payment` { relayNodeId, offer_id, payment_tx, payment_chain }
processPaymentSubmit → 写 verification_meta.payment_tx → _verifyAndComplete 异步验证（verifyCrossChainTx）→ confirmed → completed。失败最多重试 3 次（60s 间隔），3 次后自动 disputed。

**cross-chain-verify.mjs**（新模块）：
```
verifyCrossChainTx({ txHash, chain, expectedAmount, expectedTo, expectedFrom })
→ { confirmed, confirmations, required, actualAmount, recipient, sender, error?, underpayment? }
```
支持 BNB/ETH（ethers.js Transfer log）、SOL（SPL token balance delta）、TRON（TRC20 log 解析）。trading.js 也已改用此模块。

**争议处理：**
POST `/api/exchange/dispute` { relayNodeId, offer_id, reason }
processDispute：只允许 maker/taker，只允许 verifying/awaiting_manual_confirm/matched 状态。

**超时处理：**
index.js 启动时 + 每 5 分钟：expireStale()（open 过期→expired）+ timeoutVerifying()（verifying/awaiting 超时→timed_out）。

**对冲：**
handleExchangeAccept 按 verification 分叉：manual → log + return，verifying → _executeHedge。
_executeHedge 支持 preferredCex 参数 + HEDGE_CEX_MAP（scanner 显示名→DB exchange 字段映射）。

### 关键文件（exchange 补充）

| 文件 | 职责 |
|------|------|
| kasia-console/src/services/cross-chain-verify.mjs | 跨链 USDT 验证（BNB/ETH/SOL/TRON 统一接口） |
| kasia-console/src/services/exchange-machine.js | 状态机 + processPaymentSubmit + processDispute |
| kasia-console/src/api/exchange.js | 10 个 API 端点（含 submit-payment、dispute） |

### 致命陷阱（exchange 补充）

30. **handleExchangeAccept 必须按 verification 分叉。** manual → awaiting_manual_confirm（不触发对冲），cross_chain_tx → verifying（触发对冲）。单一条件 `!== 'awaiting_manual_confirm'` 会让 cross_chain_tx 报价卡死。

31. **HEDGE_CEX_MAP 名称映射。** scanner venue 名是大写显示名（Gate/MEXC/Bybit），exchange_accounts 表存小写 ID（gateio/mexc/bybit）。_executeHedge 必须用 HEDGE_CEX_MAP 转换后查 DB。

32. **_executeHedge 价格源必须从实际对冲交易所取。** 曾硬编码 MEXC ticker，导致对 Gate/Bybit/KuCoin 下 LIMIT 单时价格偏差，可能永远不成交。已修复为 _fetchHedgePrice(account.exchange, side)，从目标交易所取 bid/ask。新增对冲交易所时必须在 TICKER_MAP 补充对应公开 ticker URL。位置：trade-protocol-filter.js:494。

33. **exchange accept 路径不触发对冲。** accept 只把 offer 推到 verifying，此时 Taker 尚未履约。对冲在 completed 后触发（见 #34）。handleExchangeAccept 里只打日志 "hedge deferred to completed"。

34. **Hedge 必须在 completed（交割确认后）触发，不能在 verifying 触发。** verifying 阶段 Taker 尚未履约，此时 CEX 对冲 = 裸空仓。Taker timed_out 则 CEX 侧已成交、KAS 未收到，造成实亏。触发点两处：(a) exchange.js confirm 端点 processManualConfirm 返回 completed 后，(b) exchange-machine.js _verifyAndComplete 验证通过 transition('completed') 后。幂等锁（chain_events WHERE txid=offerId AND event_type LIKE 'hedge%'）保留防重。教训来源：2026-04-07 Live 测试。

### 待实现

- 信誉系统接入（reputation.js 骨架在，probe_address 未实现）
- Binance/Kraken exchange_accounts 添加（用户有 API Key，待配置）
- ✅ Arbitrage Tab 已上线（CEX Overview / Live Spreads / Active Offers / Hedge History）

---

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
| POST | `/api/relay/:id/wallets/:walletId/withdraw` | 钱包提现 | relay.js |
| POST | `/api/relay/:id/wallets/:walletId/swap` | 钱包换币 | relay.js |

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
| GET | `/api/stocks/fundamentals` | 基本面数据 | stocks.js |

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
