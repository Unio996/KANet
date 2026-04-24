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

