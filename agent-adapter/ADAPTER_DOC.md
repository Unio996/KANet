# agent-adapter 技术文档

**版本**: 0.1.0
**日期**: 2026-03-10
**状态**: WebSocket 协议验证完成，待端到端联调

---

## 1. 系统定位

agent-adapter 是 relay 与 AI Agent 之间的适配层，**完全独立于 relay**。

职责边界：
- **接收** relay 发来的 `POST /reply`（peer 地址 + 消息文本）
- **转发** 到 OpenClaw Gateway（WebSocket RPC）
- **返回** Agent 回复文本给 relay

```
kasia-relay  →  POST /reply  →  agent-adapter  →  ws://127.0.0.1:18789  →  OpenClaw HC_main
```

---

## 2. 架构图

```
┌──────────────────────────────────────────────────────┐
│  kasia-relay  (src/ai.mjs)                           │
│  POST http://localhost:3000/reply                    │
│  Body: { peer, message, txId }                       │
└───────────────────────┬──────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│  agent-adapter  (src/index.mjs)  port 3000           │
│                                                      │
│  POST /reply → parseBody → askAgent() → { reply }   │
└───────────────────────┬──────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│  src/openclaw.mjs  — WebSocket 客户端                 │
│                                                      │
│  连接: ws://127.0.0.1:18789                          │
│  认证: token (OPENCLAW_TOKEN)                        │
│  方法: agent                                         │
│  Session: agent:main:main                           │
└───────────────────────┬──────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│  OpenClaw Gateway  (本地运行)                         │
│  Agent: HC_main (main)                               │
│  Model: 已切换（2026-03-10 速率限制后更新）           │
└──────────────────────────────────────────────────────┘
```

---

## 3. 文件结构

```
agent-adapter/
├── src/
│   ├── index.mjs       HTTP server，POST /reply 入口
│   └── openclaw.mjs    OpenClaw Gateway WebSocket 客户端
├── test.mjs            端到端测试（直接调 askAgent）
├── debug*.mjs          调试脚本（协议探测用，可删）
├── package.json
└── ADAPTER_DOC.md      本文档
```

---

## 4. OpenClaw WebSocket 协议（已验证）

### 连接握手

```
1. Client  →  WebSocket 连接 ws://127.0.0.1:18789
2. Server  →  { type:"event", event:"connect.challenge", payload:{nonce,ts} }
3. Client  →  { type:"req", id:<uuid>, method:"connect",
                params:{ minProtocol:3, maxProtocol:3,
                  client:{id:"cli", version:"1.0.0", platform:"win32", mode:"cli"},
                  auth:{token:<GATEWAY_TOKEN>},
                  scopes:["operator.admin"] } }
4. Server  →  { type:"res", id:<same-uuid>, ok:true, payload:{type:"hello-ok", ...} }
```

### Agent 请求

```
5. Client  →  { type:"req", id:<reqId>, method:"agent",
                params:{ message:<text>,
                  agentId:"main",
                  sessionKey:"agent:main:main",
                  idempotencyKey:<唯一key，用txId> } }
6. Server  →  { type:"res", id:<reqId>, ok:true,
                payload:{runId:<id>, status:"accepted", acceptedAt:<ts>} }
```

### 流式回复

```
7. Server  →  { type:"event", event:"agent",
                payload:{ runId:<id>, stream:"lifecycle",
                  data:{phase:"start"}, seq:1 } }

8. Server  →  { type:"event", event:"agent",
                payload:{ runId:<id>, stream:"assistant",
                  data:{text:"累积全文", delta:"新增token"}, seq:N } }
            （重复多次，text 为累积，delta 为增量）

9. Server  →  { type:"event", event:"agent",
                payload:{ runId:<id>, stream:"lifecycle",
                  data:{phase:"end", endedAt:<ts>}, seq:M } }
```

**取回复文本**：最后一个 `stream:"assistant"` 事件的 `data.text`（累积全文）。

### 错误情形

```
lifecycle end 事件:
  data.isError: true
  data.error: "错误信息"
```

---

## 5. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ADAPTER_PORT` | `3000` | HTTP server 监听端口 |
| `OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | OpenClaw Gateway WebSocket 地址 |
| `OPENCLAW_TOKEN` | *(required, no default)* | Gateway 鉴权 token — 从环境变量传入，不要写在代码里 |
| `OPENCLAW_AGENT_ID` | `main` | 目标 Agent ID |
| `OPENCLAW_SESSION_KEY` | `agent:main:main` | 会话 key |
| `OPENCLAW_TIMEOUT_MS` | `120000` | 请求超时（毫秒） |

---

## 6. 启动方式

```bash
node D:\Anthropic\agent-adapter\src\index.mjs
```

relay 对应配置：
```bash
GATEWAY_URL=http://localhost:3000/reply node src/relay.mjs
```

---

## 7. 验证状态

| 项目 | 状态 |
|------|------|
| WebSocket 连接 | ✅ |
| Token 认证（hello-ok） | ✅ |
| agent 请求发送 | ✅ |
| runId 获取（accepted） | ✅ |
| 流式 assistant 事件接收 | ✅ |
| lifecycle end 检测 | ✅ |
| 完整回复文本提取 | ✅ |
| HTTP server POST /reply | ✅ 代码完成，待联调 |
| relay + adapter 端到端 | 🔧 明日联调 |
| 链上消息触发全流程 | 🔧 明日联调 |

### 已验证回复示例

```
问：你好，这是来自 agent-adapter 的测试消息。
答：收到 agent-adapter 测试，一切正常。准备好生产了！😊
```

---

## 8. 明日联调步骤

1. 启动 OpenClaw Gateway（确认运行）
2. 启动 agent-adapter：`node src/index.mjs`
3. 启动 relay（指向 adapter）：
   ```bash
   KASPA_MNEMONIC="..." GATEWAY_URL="http://localhost:3000/reply" node src/relay.mjs
   ```
4. 用账户 B（qrtr00）发一条链上消息给 relay（qptg465n）
5. 观察 relay 日志：RX → ROUTE → AI → TX SENT
6. 在账户 B 验证收到 AI 回复

---

## 9. 备份

```powershell
# 备份到 D:\Anthropic\backups\agent-adapter-<timestamp>\
.\backup.ps1
```
