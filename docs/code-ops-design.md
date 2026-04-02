# code-ops Skill — 设计文档

> Agent 行为分层模型 + 工具执行引擎。让 Agent 从"会聊天"到"能干活"。
> 2026-04-02 设计确认。

---

## 1. 核心定位

code-ops 不是普通 skill，是 Agent 的**行为层级切换引擎**。管理 L1→L4 的升降级，控制工具的解锁和回收。

**三层能力目标（用户排序）：**
1. 修系统查问题 — 读日志、跑命令、看代码、重启服务、修 bug
2. 对接陌生 API — 读文档、写集成代码、测试调通
3. 顶尖交易员 — 多维分析、多步策略、动态调仓（后续阶段）

**实现路径：** 先用 ACTION 标签（A 路线）跑通闭环，稳定后升级到 Codex 原生 tool-use（C 路线）。

---

## 2. 四层行为模型

| 层级 | 名称 | 能力 | 工具 |
|------|------|------|------|
| L1 | 社交态 | 纯对话、解释、推理、建议 | 无 |
| L2 | 任务态 | 任务拆解、生成方案/patch/command（文本） | 无（输出文本不执行） |
| L3 | 观察态 | 读取系统信息，不产生副作用 | read_file, search_code, http_request(GET) |
| L4 | 行动态 | 对系统产生实际影响 | write_file, run_command, http_request(POST/PUT) |

**默认状态为 L1。Agent 不主动升级层级。**

### L4 self-healing 限制

Self-healing 触发的 L4 屏蔽 write_file 和变更类 http_request，仅允许白名单命令（restart 等）。

---

## 3. 层级切换规则

### 3.1 Owner 触发（意图识别，非关键词）

| 意图语义 | 目标层级 | 示例 |
|---------|---------|------|
| 普通聊天 | L1 | "你好"、"你觉得呢" |
| 任务请求 | L2 | "帮我写修复方案"、"如何对接这个 API" |
| 诊断/查看 | L3（二段确认） | "帮我看看怎么回事"、"这个好像挂了" |
| 修改/执行 | L4（二段确认） | "修一下"、"部署这个"、"执行" |

**二段式激活：**
1. Agent 判断需要更高层级
2. 向用户请求确认（"需要我检查日志吗？"）
3. 用户确认后升级

### 3.2 L2→L4 跳转（关键路径）

L2 是 code-ops 最常用入口：

```
用户: "帮我写修复方案"
  → L2: Agent 输出 diff/patch（文本，不执行）
用户: "就这样改" / "确认"
  → L4: Agent 执行 write_file（显示 diff 确认）
  → 完成后自动降回 L1
```

### 3.3 Self-healing 触发

| 健康状态 | 自动层级 | 限制 |
|---------|---------|------|
| 黄灯 | L3（只读诊断） | 无 |
| 红灯 | L4（受限执行） | 屏蔽 write_file + 变更 HTTP，仅白名单命令 |

### 3.4 非 Owner

最高 L3（只读），不可进 L4。

### 3.5 Proactive

- 随机主动：禁止升级
- 任务驱动：允许（受 self-healing 规则约束）

---

## 4. 状态管理

### 4.1 混合模型

- **主状态**：per-conversation（会话级）
- **安全校验**：per-message（逐条校验身份+权限）
- **降级机制**：idle 驱动（非固定 TTL）

### 4.2 状态字段

```javascript
{
  currentLayer: 'L1' | 'L2' | 'L3' | 'L4',
  activatedBy: 'owner' | 'system',
  activatedAt: number,        // 进入当前层级的时间戳
  lastSensitiveActionAt: number,  // 最后一次执行 ACTION 的时间戳
  noToolCallCount: number     // 连续无工具调用的消息数
}
```

### 4.3 状态更新规则

**每次 ACTION 成功执行：**
```
lastSensitiveActionAt = now
noToolCallCount = 0
```

**每条无工具调用消息：**
```
noToolCallCount += 1
```

### 4.4 降级触发（满足任一）

| 条件 | 描述 |
|------|------|
| L4 idle 5min | `now - lastSensitiveActionAt > 5min` |
| L3 idle 10min | `now - lastSensitiveActionAt > 10min` |
| L4 最长 30min | `now - activatedAt > 30min`（安全上限） |
| 语义漂移 | `noToolCallCount >= 3`（连续 3 条消息无工具调用） |

**降级结果：** `currentLayer = 'L1'`

**活跃执行保护：** Agent 持续执行 ACTION 时不降级、不重新确认。

---

## 5. 工具集（5 个）

| 工具 | 解锁层级 | 确认策略 |
|------|---------|---------|
| read_file | L3+ | 自动执行 |
| search_code | L3+ | 自动执行 |
| http_request GET | L3+ | 自动执行 |
| http_request POST/PUT | L4 | 需确认 |
| write_file | L4 | 需确认（显示 diff） |
| run_command | L4 | 白名单内自动，白名单外需确认 |

### 5.1 run_command 白名单（初版）

```
cat, head, tail, ls, find, grep, wc,
node --check, npm test,
git status, git log, git diff,
systemctl status, pm2 list, pm2 restart,
curl (GET only), ping
```

**curl 校验（重要）：** curl 本身不区分 GET/非 GET。executor.mjs 必须解析命令参数，检测 `-X POST`、`-X PUT`、`-X DELETE`、`-d`、`--data`、`-F`、`--form` 等写入标志。包含任何写入标志的 curl 命令归为白名单外，需要确认。

### 5.2 沙箱规则

- **目录白名单**：KANET_ROOT 下 + /tmp
- **危险命令拦截**：`rm -rf`、`git push --force`、`git reset --hard`、`DROP TABLE` 等
- **命令超时**：单命令最长 30 秒
- **输出截断**：单命令输出最长 10KB

---

## 6. Skill 包结构

```
agent-mind/src/skills/code-ops/
  skill.json           ← 技能元数据 + 层级定义
  tools.json           ← 5 工具定义（名称/参数/描述/层级）
  layer-engine.mjs     ← 层级状态机（升级/降级/校验/二段确认）
  executor.mjs         ← 工具执行（沙箱 + 确认 + curl 参数校验）
  intent-detector.mjs  ← 意图识别（语义分类 → 目标层级）
```

### 6.1 与现有系统的集成点

| 集成点 | 方式 |
|--------|------|
| Skill Registry | 包式技能，autoDiscover 自动加载 |
| Context Builder | L3/L4 时注入可用工具到 SKILL DATA |
| Action Executor | 新增 ACTION 类型：READ_FILE, WRITE_FILE, RUN_COMMAND, HTTP_REQUEST, SEARCH_CODE |
| Mind action loop | 复用现有 10 轮循环 |
| execution_states | L4 确认走 pending → approved → executed |
| conversations | 扩展字段存储层级状态 |

---

## 7. 执行流程

```
用户消息
  ↓
Mind.handleMessage()
  ↓
读取会话层级状态（layer-engine.getState()）
  ↓
per-message 校验（身份 + 权限）
  ↓
intent-detector: 识别意图 → 目标层级
  ↓
如需升级且当前 < 目标层级:
  L2: 直接升级（无工具，安全）
  L3: Agent 问"需要我检查吗？" → 等确认
  L4: Agent 问"需要我执行吗？" → 等确认
  L2→L4: Agent 已输出方案，用户说"改" → 升级
  ↓
降级检查（idle / max time / drift）
  ↓
Context Builder 注入:
  L1/L2: 无工具注入
  L3: 注入只读工具定义 + 当前层级说明
  L4: 注入全部工具定义 + 确认规则说明
  ↓
Brain 输出 ACTION（READ_FILE / WRITE_FILE / RUN_COMMAND / ...）
  ↓
Executor 执行:
  - 层级校验（工具是否在当前层级解锁）
  - 确认校验（需确认的操作走 pending 流程）
  - 沙箱校验（路径/命令/超时）
  - 执行 + 返回结果
  ↓
更新状态（lastSensitiveActionAt / noToolCallCount）
  ↓
结果反馈 Brain → 下一轮循环（最多 10 轮）
  ↓
返回最终结果 + 降级检查
```

---

## 8. 实现阶段

| 阶段 | 内容 | 交付物 | 依赖 |
|------|------|--------|------|
| **Phase A** | layer-engine + intent-detector + 状态管理 | 层级状态机、意图识别、会话状态字段 | 无 |
| **Phase B** | executor（5 工具 + 沙箱 + 确认 + curl 校验） | 工具执行层、白名单、diff 展示 | Phase A |
| **Phase C** | Mind 集成（action loop 对接 + context 注入 + ACTION 类型注册） | 完整闭环可测试 | Phase B |
| **Phase D** | 升级到 Codex 原生 tool-use（C 路线） | 结构化 function_call 替代 ACTION 文本 | Phase C 验证后 |

Phase D 独立升级，不阻塞前三阶段。

---

## 9. 设计原则

1. **默认保守** — 不需要执行时不执行
2. **读写分离** — 观察（L3）与修改（L4）必须区分
3. **分层优先** — 行为控制优于简单权限控制
4. **层级感知** — Agent 必须知道自己当前层级
5. **活跃优先** — 执行中的任务不被打断
6. **空闲收敛** — 无操作自动降级
7. **行为驱动** — 用行为模式替代语义分析判断降级

---

## 10. 一句话总结

> L4 是一个"任务执行窗口"，而不是持久权限状态：只要 Agent 持续行动，就保持能力；一旦停止，就自动收回。
