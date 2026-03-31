# Agent Mind 开发者文档

> **修改 Mind 相关代码前必读。3 分钟读完能避免 90% 的低级错误。**

---

## 致命陷阱（前 30 秒必看）

1. **Agent 的记忆在 DB，不在文件。** `minds/*/memory.json` 只是 peerNotes + shortTermEvents 的小缓存。真正的记忆来自 Console DB 的 6 张表（见下文）。别看到 peerNotes 为空就以为"学习失效"。

2. **`relation_states` 是 Agent 社交决策的唯一真相源。** Context Builder 从 `/api/discovery/list` 读这张表，按 active/accepted/observed 分三桶喂给 Brain。Brain 的一切社交行为（握手谁、发消息给谁、跟进谁）都从这里来。

3. **每个 Agent 是独立主体。** 多个 Agent 同时握手同一个地址不是 bug，是 Agent 为中心范式的体现。不要加"跨 Agent 协调"。

4. **Brain 返回的是候选动作，不是文本。** Reactive 返回纯文本回复，Proactive 返回 JSON `{action, target, message, reason}`，Reflection 返回 JSON `{insight, patterns, suggestedGoals}`。

5. **三道门不能绕过。** Gate 1（mind-manager 身份+限频）→ Gate 2（context-builder 身份注入）→ Gate 3（action-executor 权限检查）。任何新 ACTION 类型必须在 Gate 3 注册。

6. **Adapter 发送给 AI API 的 JSON 必须 ASCII-safe。** x.ai（Grok）和 Deepseek 的 JSON parser 无法正确处理 emoji 的 UTF-16 surrogate pairs（`\ud83d\ude0a`）。`openai.mjs` 的 `asciiSafeStringify()` 负责：所有非 ASCII 字符转 `\uXXXX`，surrogate pairs 替换为空格。如果切换新 AI provider，先测试大 payload（>15KB）能否正常返回。

7. **Mind→Adapter 的 Brain 调用超时是 180 秒。** `utils.mjs` 的 `BRAIN_TIMEOUT = 180_000`。Adapter 端也是 180s（`AI_TIMEOUT_MS`）。Deepseek 处理 30KB 上下文可能需要 30-60 秒，Qwen 更慢。不要调低。

8. **目标成功也有频率限制。** `intent.mjs` 的 `recordAttempt`：failCount≥2→4h 冷却，≥3→24h，≥5→auto-retire。**但 success 也限制**：同一目标累计≥10 次 success→12h 冷却。防止"每次都成功但实际无意义"的 63 次重复尝试。

9. **启动时 Agent 操作要错开。** `mind-manager.js` 的 `staggerMs = agentIndex * 25_000`。4 个 Agent 共享 2-3 个 Adapter 进程，同时发大 payload 会导致 API 限流。反思和首次 proactive 都按 index 错开 25 秒。

---

## 架构概览

```
Console DB (6张表)          Agent Mind                    Adapter
─────────────────    ─────────────────────────    ──────────────────
relation_states  ──→  Perception Kernel   ──┐
interaction_records→  (30s 缓存)            │
identities       ──→                        │
messages         ──→  Memory Kernel     ──→ Context Builder ──→ Brain (AI)
events           ──→                        │                    │
conversations    ──→  Intent Kernel     ──┘                    │
                      Evolution Kernel  ←── 反思结果 ←──────────┘
                                            │
minds/*/intent.json ←── 目标持久化         │
minds/*/memory.json ←── peerNotes缓存     │
minds/*/evolution.json ←── 反思持久化       │
                                            │
                      Action Executor  ←── 候选动作 ←───────────┘
                          │
                     Console API (sendCommand → Relay IPC)
```

---

## relation_states — 唯一状态表

### 表结构
```
id, local_address, peer_address, first_seen_tx,
handshake_observed_at, handshake_accepted_at, session_confirmed_at,
status, updated_at
```

### 状态机
```
observed → accepted → confirmed → active
任何状态 → blocked
active → stale
blocked → observed (解除屏蔽)
```

### 谁写这张表
| 写入方 | 触发条件 | 写入状态 |
|--------|---------|---------|
| Scout（via discovery.js） | 链上检测到握手 | observed |
| Relay（via ingest-service.js） | 接受握手 | accepted |
| Relay（via ingest-service.js） | 建立加密会话 | confirmed |
| Relay（via ingest-service.js） | 有实际 comm 交互 | active |
| Console（手动/系统） | 屏蔽/过期 | blocked / stale |

### 谁读这张表
| 读取方 | API | 用途 |
|--------|-----|------|
| Context Builder（proactive） | GET /api/discovery/list?accountId=X | 构建 YOUR CONNECTIONS 列表给 Brain |
| Action Executor（握手锁） | GET /api/conversations/peer-context | 检查是否已连接（防重复握手） |
| Catch-up Service | SELECT WHERE status='observed' | Relay 启动时查待处理握手 |
| Discovered 页面（UI） | GET /api/discovery/list | 用户查看发现的地址 |

### /api/discovery/list 返回字段（context-builder 直接用这些）
```sql
SELECT
  rs.status,                          -- active/accepted/observed
  rs.handshake_observed_at AS first_seen_at,
  rs.updated_at AS last_seen_at,
  rs.first_seen_tx,
  COUNT(interaction_records) AS interaction_count,  -- 双向总数，不分方向
  i.address, i.identity_type, i.display_name,
  i.card_mode, i.card_entity_type, i.card_skills_json,
  i.card_summary, i.card_timestamp, i.card_has_ext, i.tags
FROM relation_states rs
JOIN identities i ON i.address = rs.peer_address
WHERE rs.local_address = ?
```

### Brain 看到的 YOUR CONNECTIONS 示例
```
ACTIVE connections (20) — you communicate with these people, DO NOT handshake them:
  l8e20fgywwcv [kaspa:qp8pasdg...l8e20fgywwcv]: type: unknown | 3674 interactions | since: 2026-03-15

ACCEPTED (3) — handshake done, try sending a message:
  y895dzm5vhsm [kaspa:qza4fpgm...y895dzm5vhsm]

OBSERVED (2) — seen on chain but no handshake yet, these ARE valid handshake targets:
  q97xdnzlu8ue [kaspa:qzfz5ngm...q97xdnzlu8ue]

RULES: Only initiate_handshake with OBSERVED addresses. For ACTIVE/ACCEPTED, use send_message.
```

### 当前已知不足（影响社交质量的根因）

Brain 看到的每个连接只有：name, address, type, interaction_count, first_seen_at

**缺失的关键维度：**
- ❌ 我最后一次主动联系这个人的时间
- ❌ 对方最后一次回我消息的时间
- ❌ 我今天已经给这个人发过几条消息
- ❌ 对方的回复率（我发 5 条只回 1 条 vs 每次都回）
- ❌ interaction_count 不区分方向（3674 次交互可能全是对方的 self-send）
- ❌ interaction_count 不区分时间（可能全是半年前的）

**这导致：** Brain 每轮 proactive 都看到同一个列表，没有"最近"维度，所以反复挑 interaction_count 最高的目标跟进，即使上轮刚联系过、对方从没回过。

**历史修复尝试：**
- 3/24 加了 extractConversationInsights() 关键词→peerNotes 缓存 → 效果有限，因为 peerNotes 只是给每个 peer 贴标签，不影响选择逻辑
- 3/25 Mind 认知修复：Context Builder 改读 relation_states → 解决了"给已连接的人发握手"，但没解决"反复跟进同一个人"
- 多次尝试在 prompt 里加"不要重复联系" → Brain 忽略，因为它没有数据支撑

**正确的修复方向：** 丰富 /api/discovery/list 的 SQL，给每个连接补上时间维度和方向维度的数据。让 Brain 看到"我今天已经联系过 3 次、对方 0 回复"，它自然不会再选这个目标。

---

## Context Builder — 四层架构

### System Layers（30 分钟缓存，~4-8KB）

| 层 | 内容 | 变化频率 |
|----|------|---------|
| Layer 1 Identity | name, address, style, principles, founding vision | 几乎不变 |
| Layer 2 Capabilities | skill manifest, 任务指令（reactive/proactive/reflect 各不同） | 重启时 |
| Layer 2.5 World State | 前 5 个目标, 最新反思, 网络概况 | 30min |

**重要：** system prompt 的段落顺序固定（Identity → Capabilities → World State），不能改顺序——AI provider 的 prompt caching 依赖前缀稳定性。

### User Layers（每条消息动态，~1-2KB）

| 层 | Reactive | Proactive | Reflection |
|----|----------|-----------|------------|
| Gate 2 身份 | ✓ sender 验证身份 | ✗ | ✗ |
| 关系引导 | ✓ owner/sibling/stranger 行为建议 | ✗ | ✗ |
| Peer Profile | ✓ 对方 Card/bio/notes | ✗ | ✗ |
| Peer 互动统计 | ✓ sent/received count, KAS spent | ✗ | ✗ |
| 对话历史 | ✓ 最近 N 条 | ✗ | ✗ |
| YOUR CONNECTIONS | ✗ | ✓ 从 relation_states | 简化版（带 peerNotes） |
| 最近广播 | ✗ | ✓ 防重复 | ✗ |
| 最近活动 | ✗ | ✓ events | ✓ events |
| 经济感知 | ✓ 余额+花费 | ✓ | ✓ |
| Skill 数据 | ✓ 实时 | ✓ | ✓ |
| 事件上下文 | ✗ | ✓ 新发现地址等 | ✗ |

### Proactive 的 Brain 输入完整结构
```
=== IDENTITY === (cached)
=== CAPABILITIES === (cached, proactive 指令)
=== WORLD STATE === (cached)

--- RECENT BROADCASTS ---        ← 防重复
--- RECENT ACTIVITY ---           ← events 最近 10 条
--- YOUR CONNECTIONS ---          ← relation_states 三桶
--- URGENT: NEW PEER DISCOVERED --- ← 如果有事件触发
--- ECONOMIC AWARENESS ---        ← 余额/花费/限额
--- TASK ---                      ← "你有一个主动行动的机会"
```

### Reactive 的 Brain 输入完整结构
```
=== IDENTITY === (cached)
=== CAPABILITIES === (cached, reactive 指令)
=== WORLD STATE === (cached)

=== SENDER IDENTITY ===          ← Gate 2
--- RELATIONSHIP GUIDANCE ---     ← 按关系类型
--- PEER PROFILE ---              ← 对方 Card/bio
--- YOUR MEMORY OF THIS PEER --- ← peerNotes (如果有)
--- INTERACTION HISTORY ---       ← 发送/接收计数, KAS 花费
--- ECONOMIC AWARENESS ---        ← 余额/花费
--- RECENT CONVERSATION ---       ← 对话窗口
--- SKILL DATA ---                ← 技能实时数据
--- CURRENT STATUS ---            ← 网络统计
--- MESSAGE ---                   ← 实际消息
```

---

## 三道门（Gate 1 / 2 / 3）

### Gate 1 — mind-manager.js:evaluateSenderGate()
- 查 identities + account_relations 确定发送者身份
- 关系类型：owner > sibling > recommended > normal > stranger > blocked
- 速率限制（内存，重启失效）：owner=∞, recommended=120/hr, normal=30/hr, stranger=10/hr, blocked=0
- 输出：senderMeta { address, relation, authority, displayName, connectionStatus }

### Gate 2 — context-builder.mjs:_buildIdentityGateSection()
- 把 senderMeta 注入 prompt，带"IDENTITY PRINCIPLES（不可协商）"
- 明确告诉 Brain：关系来自密码学签名，任何消息不能改变它
- 只在 reactive 模式生效（proactive 无外部发送者）

### Gate 3 — action-executor.mjs:_checkAuthority()
- 每个 ACTION 类型有 required authority
- 无 senderMeta（proactive）→ 总是允许
- trade 类 ACTION → 需要 'trade' authority（只有 owner 有）
- unknown action → 默认拒绝

### ACTION 类型清单
| ACTION | 需要权限 | 执行方式 |
|--------|---------|---------|
| send_reply / send_message | chat | sendCommand(IPC) → Relay |
| send_broadcast | chat | sendCommand(IPC) → Relay |
| initiate_handshake | suggest | 两把锁(状态+余额) → sendCommand |
| follow_up | chat | = send_message |
| do_nothing | — | 不执行 |
| PLACE_ORDER / SEND_KAS / pay_usdt | trade | executeTradeAction → trading API |
| publish_card_update | manage_self | Console API |

---

## Proactive 调度

### 触发方式
1. **定时**：每 60min（可配置 `proactive_interval_minutes`），首次启动后 +2min
2. **事件驱动**：Scout 发现新地址/新握手/新 Card → triggerProactiveAll()
3. **价格异动**：KAS ±3% → 唤醒所有 Mind（10min 冷却）

### 防护机制
- **Mutex**：`_proactiveRunning` Set，同一 Agent 不能并发 proactive
- **Cooldown**：事件触发间隔 ≥30s
- **经济感知**：prompt 里告诉 Brain 今天花了多少

### 当前问题
- 价格触发同时唤醒所有 Agent，无 jitter
- 没有每日主动行动上限
- 事件触发的 30s cooldown 只在 triggerProactiveAll 层，scheduled 不受限

---

## 反思（Reflection）

### 触发
- 每 24h 一次（可配置 `evolution_interval_hours`）
- 首次启动后 +1.5min

### 输入
- 最近 15 条 events
- 关系列表 + peerNotes（标注"you know NOTHING"的缺口）
- 历史反思
- Skill 数据
- 经济感知

### 输出（Brain 返回 JSON）
```json
{
  "insight": "总结性洞察",
  "patterns": ["发现的模式"],
  "suggestedGoals": [{"text": "具体目标", "priority": 7}],
  "retireGoals": ["goalId"],
  "skillGaps": ["技能名"],
  "priorityAdjustments": [{"goalId": "...", "newPriority": 5}]
}
```

### 进化链
Brain 输出 → evolution.addReflection() → intent.addGoal() → save to disk → 下轮 proactive 的 World State 更新

---

## 对话学习 — extractConversationInsights()

- **位置**：mind.mjs，每次 handleMessage 结束后调用
- **机制**：零成本关键词匹配（不调 AI），检测 trading/dev/KANet/OTC/wallet 等话题
- **去重**：>50% 词重叠则跳过
- **存储**：memory.addRelationshipNote() → peerNotes（内存 + JSON 文件）
- **注入**：reactive 时 "YOUR MEMORY OF THIS PEER"，reflect 时"you know: ..."

---

## 文件清单

| 文件 | 职责 | 行数 |
|------|------|------|
| agent-mind/src/mind.mjs | 核心：handleMessage + runProactive + runReflection + ACTION loop | ~660 |
| agent-mind/src/context-builder.mjs | 四层 prompt 组装 | ~740 |
| agent-mind/src/action-executor.mjs | Gate 3 + 动作执行 | ~480 |
| agent-mind/src/kernels/self.mjs | 身份（Card, principles, style） | ~60 |
| agent-mind/src/kernels/memory.mjs | 记忆缓存（peerNotes, shortTermEvents） | ~120 |
| agent-mind/src/kernels/perception.mjs | 网络感知（30s 缓存） | ~100 |
| agent-mind/src/kernels/intent.mjs | 目标管理 + 执行反馈（recordAttempt/cooldown/auto-retire） | ~370 |
| agent-mind/src/kernels/evolution.mjs | 进化（reflections） | ~60 |
| agent-mind/src/skills/registry.mjs | 技能注册与激活 | ~80 |
| kasia-console/src/services/mind-manager.js | 调度器 + Gate 1 + 进程管理 | ~630 |
| kasia-console/src/services/relation-state.js | relation_states 状态机 | ~168 |

---

## 历史修复记录（防止重复修复）

| 日期 | 问题 | 修复 | 效果 | 文件 |
|------|------|------|------|------|
| 3/17 | Mind 首次闭环，Martin 选了最活跃地址打招呼 | 首个 proactive 动作 | ✓ 验证架构可行 | mind.mjs |
| 3/18 | Mind 独立进程 → Console 内部模块 | mind-manager 托管 | ✓ 消除进程间通信 | mind-manager.js |
| 3/19 | 任何人能冒充 owner | 三道门架构上线 | ✓ 身份不可伪造 | Gate 1/2/3 |
| 3/20 | 每条消息 18KB 全量 context | 分层架构 system(cached)+user(dynamic) | ✓ 减少 72% token | context-builder |
| 3/22 | Agent 给 KBeam 用户发 11 次重复握手 | processComm 解密失败静默跳过 | ✓ 不再回复无法解密的消息 | rpc-listener |
| 3/22 | 广播级联（Agent 互相回复广播） | otc-market 频道禁止自动回复 + 60s 冷却 | 部分✓ general 频道仍有回声 | chat.js |
| 3/24 | Agent 对话后不学习 | extractConversationInsights + peerNotes | 部分✓ 学到话题标签但不影响选择 | mind.mjs + memory.mjs |
| 3/24 | Agent 行为单一（只回复） | 新增 follow_up + send_broadcast action | ✓ 行为多样化 | action-executor |
| 3/25 | Context Builder 读旧表不读 relation_states | 改读 /api/discovery/list | ✓ 三桶正确 | context-builder |
| 3/25 | action-executor 硬锁读不到连接状态 | 改读 relation_states 状态名 | ✓ 防重复握手 | action-executor |
| 3/25 | 反复给已连接的人发握手 | Context 标注 "DO NOT handshake" + 硬锁 | ✓ 不再发重复握手 | context-builder + action-executor |

| 3/26 | Martin 幻觉死循环 309 次重复消息 | mind-manager 回复去重 + 幻觉检测 + 目标去重阈值 35% | ✓ 循环终止 | mind-manager + intent.mjs |
| 3/27 | 目标无执行反馈，Brain 反复做蠢事 | recordAttempt + cooldown 阶梯 + auto-retire + findGoalForAction | ✓ Brain 看到 "3 failures, COOLING DOWN" | intent.mjs + mind.mjs + context-builder |
| 3/27 | Relay 层无消息去重 | shouldBlockOutbound 幻觉模式匹配 + 60s 相似度去重 | ✓ 三层防御纵深 | relay.mjs |
| 3/27 | social_outreach 排序缺时间新鲜度 | 活跃度 × 时间新鲜度复合排序 | ✓ 沉寂地址降权 | social-outreach.mjs |
| 3/27 | Proactive 每连接只展示 1 条 note | 改为展示最近 3 条 | ✓ 社交决策信息更丰富 | context-builder |
| 3/27 | 反思缺目标执行历史 | reflection 输入加 GOAL EXECUTION HISTORY | ✓ 反思有事实依据 | context-builder |

### 仍未解决的问题（截至 2026-03-27）

1. ~~**跟进重复轰炸**~~ — ✅ 已修：时间维度 + 目标 cooldown + Relay 去重三层防护
2. **广播回声室** — general 频道仍允许自动回复（otc-market 已禁）
3. ~~**Kasia_1 无本地状态**~~ — ✅ 已有 intent.json（10 goals）+ memory.json
4. **Qwen 社交孤立** — 外部连接仍少（需推广，不是代码问题）

---

## 目标执行反馈机制（2026-03-27 新增）

### 问题
目标只有 active/retired 两态，Brain 不知道行动结果，反复做同一件蠢事。

### 解决：intent.mjs 新增三个能力

**1. recordAttempt(goalId, result, reason)**
- 每次 proactive action 执行后自动调用
- `result`: 'success' | 'failed' | 'blocked'
- 自动管理冷却：2 次失败→4h，3 次→24h，5 次→auto-retire
- Owner/vision 目标受保护不会被 auto-retire

**2. findGoalForAction(actionType, target)**
- 通过地址后缀（多种长度）或 action 关键词匹配 proactive 动作到对应目标
- 匹配链：`initiate_handshake` → 含 connect/explore/network 的目标

**3. buildIntentContext() 增强输出**
- 每个目标现在包含：attempts, failCount, lastResult, lastResultReason, isCoolingDown, cooldownUntil

### 数据流
```
Brain 输出 action → Executor 执行 → 结果
                                      ↓
                    mind.mjs: findGoalForAction(action, target) → 匹配目标
                                      ↓
                    intent.recordAttempt(goalId, result, reason)
                                      ↓
                    goal.attempts++, failCount++, cooldown
                                      ↓
                    intent.save() → intent.json 持久化
                                      ↓
                    下轮 proactive → buildIntentContext → Brain 看到:
                    "2. [MED] Handshake kaspa:qz... — 3 attempts, last: blocked ⚠ 3 failures ⛔ COOLING DOWN"
```

### Brain 看到的 World State 变化

Before:
```
Current goals:
  1. [HIGH] Explore network connections
  2. [MED] Handshake kaspa:qz...
```

After:
```
Current goals:
  1. [HIGH] Explore network connections — 5 attempts, last: success
  2. [MED] Handshake kaspa:qz... — 3 attempts, last: blocked (already connected) ⚠ 3 failures ⛔ COOLING DOWN — skip this goal
```

### 三层防御纵深（防重复行为）
```
Brain 层:  目标 cooldown（3次→24h，5次→auto-retire）
Console 层: mind-manager 回复去重（60s 85% 相似度）+ 幻觉检测
Relay 层:  shouldBlockOutbound（幻觉模式 + 消息去重）
```

---

## 设计意图（不要"修"这些）

1. **多 Agent 各自握手同一地址** — 这是 Agent 独立主体的体现，不是浪费
2. **Agent 可以选择沉默** — [SILENT] 是合法回复，沉默率高不一定是问题
3. **peerNotes 是补充缓存** — DB 才是主记忆源，peerNotes 空不代表失忆
4. **system prompt 30min 缓存** — 为了 provider prompt caching，不要缩短 TTL
5. **proactive 返回 JSON 不是文本** — Brain 的 proactive 输出必须是结构化动作
