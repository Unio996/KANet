# kasia-relay 技术文档

**版本**: 1.0
**日期**: 2026-03-10
**状态**: 生产就绪（链上收发已验证）

---

## 1. 系统定位

kasia-relay 是一个**链上加密消息中继系统**，运行在 Kaspa 主网上。

职责边界：
- **relay 负责**：轮询链上消息、去重、路由、触发回复、将回复发回链上
- **relay 不负责**：生成回复内容（由外部 Adapter 实现，通过 `getAIReply` 接口接入）

```
Kaspa 区块链  ←→  relay  ←→  Adapter（外部，不属于 relay）
```

relay 对 Adapter 的唯一要求：实现 `getAIReply(peer, message) → string`。

---

## 2. 架构图

```
┌──────────────────────────────────────┐
│           Kaspa Blockchain           │
└───────────┬──────────────────────────┘
            │ kasia_get_conversations
            │ kasia_get_messages
            ▼
┌──────────────────────────────────────┐
│  src/mcp.mjs  — MCP 长连接单例       │
│                                      │
│  ┌─────────────┐  ┌───────────────┐  │
│  │  kaspa-mcp  │  │   kasia-mcp   │  │
│  │ send_kaspa  │  │ kasia_get_*   │  │
│  │             │  │ kasia_send_*  │  │
│  └─────────────┘  └───────────────┘  │
└───────────┬──────────────────────────┘
            │
            ▼
┌──────────────────────────────────────┐
│  src/relay.mjs  — 主循环 [2s]        │
│                                      │
│  for each active conversation:       │
│    for each new message (去重):      │
│      route → getAIReply → send       │
└───────┬──────────────────────────────┘
        │                   │
        ▼                   ▼
┌──────────────┐   ┌─────────────────────┐
│ src/router   │   │  src/state.mjs      │
│ .mjs         │   │  state/seen.json    │
│              │   │  txId 去重持久化     │
│ #main→main   │   └─────────────────────┘
│ #beta→beta   │
│ 默认→main    │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────┐
│  src/ai.mjs  — Adapter 接口          │
│                                      │
│  getAIReply(peer, message) → string  │
│                                      │
│  [ 具体实现由 Adapter 决定，          │
│    不属于 relay 范围 ]               │
└──────────────────────────────────────┘
       │
       │ replyText
       ▼
┌──────────────────────────────────────┐
│  kasia_send_message                  │
│       ↓                              │
│  send_kaspa                          │
└───────┬──────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────┐
│           Kaspa Blockchain           │
│         (reply TX on-chain)          │
└──────────────────────────────────────┘
```

---

## 3. 文件结构

```
kasia-relay/
├── src/
│   ├── relay.mjs       主循环（核心）
│   ├── mcp.mjs         MCP 长连接单例
│   ├── state.mjs       txId 去重与持久化
│   ├── router.mjs      消息路由
│   └── ai.mjs          Adapter 接口（getAIReply）
├── state/
│   └── seen.json       已处理 txId 列表
├── chat_a.mjs          测试客户端（账户 A）
├── gateway.mjs         Adapter stub（本地联调用）
├── test-openclaw.mjs   OpenClaw Gateway 探测脚本
├── package.json
├── backup.ps1          备份脚本
└── RELAY_DOC.md        本文档
```

---

## 4. 模块说明

### src/relay.mjs — 主循环

Poll → Process → Publish 三段式循环，`setInterval` 每 2 秒执行一次。

```
poll()
  └─ kasia_get_conversations()           获取所有链上对话
       └─ for active conversations:
            kasia_get_messages(peer)      获取该对话消息
              └─ for each message:
                   seen.has(txId)?        去重检查
                   routeMessage(text)     路由
                   getAIReply(peer, text) 请求回复（接口）
                   kasia_send_message()   构造加密 payload
                   send_kaspa()           广播上链
                   seen.add(txId)         标记已处理
```

### src/mcp.mjs — MCP 长连接单例

维护两个长连接 MCP 客户端，进程内单例，避免每次调用重新握手。

| 客户端 | 路径 | 用途 |
|--------|------|------|
| kaspa-mcp | `D:/Anthropic/kaspa-mcp/dist/index.js` | `send_kaspa`（广播 TX） |
| kasia-mcp | `D:/Anthropic/kasia-mcp/dist/index.js` | `kasia_get_conversations`、`kasia_get_messages`、`kasia_send_message` |

进程退出时（SIGINT/SIGTERM）自动关闭客户端连接。

### src/state.mjs — 去重

- 启动时从 `state/seen.json` 加载已处理 txId（`Set<string>`）
- 每次处理新消息后写回文件（JSON array，pretty-printed）
- 保证 relay 重启后不重复处理历史消息

### src/router.mjs — 路由

根据消息内容前缀决定目标 agent：

| 前缀 | Agent |
|------|-------|
| `#main ` | `"main"` |
| `#beta ` | `"beta"` |
| （无前缀） | `"main"`（默认） |

返回 `{ agent, body }`，其中 `body` 是去掉前缀后的消息正文。

当前 relay.mjs 已接收 `agent` 字段但尚未用于 Adapter 路由，预留给多 Agent 扩展。

### src/ai.mjs — Adapter 接口

relay 与外部 AI 能力之间的唯一边界。

```js
export async function getAIReply(peer, message): Promise<string>
```

- `peer` — 发件方 kaspa 地址
- `message` — 消息正文（已去掉路由前缀）
- 返回值 — 回复文本字符串

**当前实现**：HTTP POST 到 `GATEWAY_URL`（默认 `http://localhost:3000/reply`），由 `gateway.mjs` stub 响应。
**生产替换**：修改此文件接入真实 Adapter，relay 其余部分无需改动。

---

## 5. 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `KASPA_MNEMONIC` | **必填** | — | HD 钱包助记词，用于签名链上交易 |
| `GATEWAY_URL` | 可选 | `http://localhost:3000/reply` | Adapter HTTP 接口地址 |
| `KASPA_NETWORK` | 可选 | `mainnet` | `mainnet` / `testnet-10` / `testnet-11` |
| `KASIA_NETWORK` | 可选 | `mainnet` | 同上 |

> `KASPA_MNEMONIC` 含私钥，严禁写入代码或版本控制。

---

## 6. 启动

```bash
KASPA_MNEMONIC="word1 word2 ... word24" node src/relay.mjs
```

启动后输出示例：
```
2026-03-10T10:00:00.000Z Kasia Relay started.
2026-03-10T10:00:02.000Z TICK, conv count: 3
2026-03-10T10:00:02.001Z CONV: kaspa:qqscw77... active
2026-03-10T10:00:02.100Z RX d2115981... 你好
2026-03-10T10:00:02.101Z ROUTE → main
2026-03-10T10:00:03.200Z AI → 你好！我是...
2026-03-10T10:00:04.500Z TX SENT: 5a3f8b...
```

### 本地联调（使用 stub）

```bash
# 终端 1
node gateway.mjs

# 终端 2
KASPA_MNEMONIC="<mnemonic>" node src/relay.mjs
```

---

## 7. 状态文件

`state/seen.json` — JSON 数组，存储所有已处理消息的 txId。

```json
[
  "d2115981c1eacf28c9775f19fd83234f66e61b1...",
  "5593667d8502e4027093020157bbb62bf2d25d...",
  ...
]
```

- 当前记录：22 条
- 丢失后果：relay 重启将重复处理历史消息，向每个 peer 重发已回复的消息
- **备份优先级：高**

---

## 8. 已验证的链上流程

| 场景 | 状态 |
|------|------|
| 轮询 conversations | ✅ |
| 轮询 messages | ✅ |
| txId 去重（含重启持久化） | ✅ |
| 消息路由（#main / #beta / 默认） | ✅ |
| kasia_send_message 构造 payload | ✅ |
| send_kaspa 广播 TX | ✅ |
| 账户 A ↔ relay 双向通信 | ✅ |
| 多地址并发轮询 | ✅ |
| getAIReply 接口（stub） | ✅ |
| getAIReply 接口（真实 Adapter） | 🔧 待接入 |

---

## 9. 备份

```powershell
# 在 PowerShell 中运行，备份到 D:\Anthropic\backups\kasia-relay-<timestamp>\
.\backup.ps1
```

排除 `node_modules` 和 `.git`，其余全量复制。

**最低备份清单：**

| 文件 | 说明 |
|------|------|
| `src/*.mjs` | 全部源码 |
| `state/seen.json` | 去重状态，丢失会重发历史消息 |
| `package.json` + `package-lock.json` | 依赖锁定 |
| 助记词（`KASPA_MNEMONIC`） | 离线加密备份，与代码分开存储 |
