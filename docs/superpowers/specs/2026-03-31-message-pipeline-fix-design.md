# Agent 消息发送链路全面修复

## 问题本质

Agent 发出的消息有 5 条路径，其中 3 条的消息内容没有完整入库。导致通讯录看不到 Agent 说了什么。

## 5 条路径现状

| # | 路径 | 触发场景 | 消息内容记录 | 问题 |
|---|------|---------|-------------|------|
| 1 | AI 回复 DM | 对方发消息→Mind回复 | replies 表有，messages 表无 outbound | **13,095 条回复在 messages 表无记录** |
| 2 | AI 广播回复 | 聊天室→Mind回复 | replies 表 + broadcast_messages 表 | 分散两张表，但内容不丢 |
| 3 | IPC send_message | 通讯录手动发 / Mind 主动 send_message | 全无 | **内容、目标地址全丢** |
| 4 | 握手 | 主动/被动 | messages 有 outbound handshake | 正常 |
| 5 | IPC send_broadcast | Console 广播 | 同路径 2 | 同路径 2 |

## 根因

Relay 发消息后只调 `ingestTx()`（记交易），不调 `ingestMessage()`（记消息内容）。这个遗漏存在于：
- `relay.mjs` line 290: `send_message` case
- `relay.mjs` line 148-153: DM 回复路径（调了 `ingestReply` 但不调 `ingestMessage`）
- `rpc-listener.mjs` line 604-607: 同上

`ingestReply()` 把回复内容写进 replies 表，但 replies 表和 messages 表没有关联 — messages 表缺少 outbound 方向的记录，导致通讯录行为明细只能显示 inbound（对方说的），看不到 outbound（Agent 说的）。

## 修复方案

### 统一原则

**每条 Agent 发出的消息，必须同时写入：**
1. `chain_events`（链上事实，event_type = 'comm_sent'）
2. `messages` 表 outbound（消息内容，可查可展示）

### Fix 1: Relay send_message 补 ingestMessage

**文件：** `kasia-relay/src/relay.mjs` 约 line 288-292

`case 'send_message'` 的 `ingestTx()` 之后加 `ingestMessage()`：

```javascript
ingestMessage({
  traceId: `msg-out:${sent?.txId || Date.now()}`,
  direction: 'outbound',
  localAddress: localAddress,
  remoteAddress: cmd.target,
  txid: sent?.txId,
  messageType: 'text',
  contentText: cmd.message || '',
});
```

### Fix 2: Relay DM 回复补 ingestMessage

**文件：** `kasia-relay/src/relay.mjs` 约 line 148-155（DM 回复发送成功后）
**文件：** `kasia-relay/src/rpc-listener.mjs` 约 line 604-607（同上）

在 `ingestReply()` 之后加 `ingestMessage()`：

```javascript
ingestMessage({
  traceId: `reply-out:${sent?.txId || msg.txId}`,
  direction: 'outbound',
  localAddress: localAddress,  // 或 _myAddress
  remoteAddress: peer,         // 或 senderAddress
  txid: sent?.txId,
  messageType: 'text',
  contentText: text,           // 实际发出的文本（可能被截断）
});
```

注意：`text` 变量是经过截断重试后的实际发送文本，不是原始 `replyText`。

### Fix 3: send-command API 改 async

**文件：** `kasia-console/src/api/relay.js` 约 line 991-997

`sendCommand` 改 `sendCommandAsync`，返回 `{ ok, txId }` 给前端。

### Fix 4: 通讯录发消息反馈

**文件：** `kasia-console/src/ui/contacts.eta` 的 `sendMsg` 方法

发送后显示"已发送 ✓"或错误提示。

## ingestMessage 去重保护

`ingest-service.js` 的 `handleIngestMessage` 已有 traceId 去重（line 27-29）。新增的 `ingestMessage` 调用使用唯一的 traceId 前缀（`msg-out:` / `reply-out:`），不会和 Scout 的 inbound 记录冲突。

但同一条消息的 replies 表和 messages 表 outbound 会各一条记录 — 这是正确的：
- replies 表记的是 AI 的决策过程（prompt → reply）
- messages 表记的是链上事实（outbound message）

## 防止未来再发生

### 规则：Relay 发出任何链上 TX，必须同时调 ingestMessage

在 `kasia-relay/src/relay.mjs` 和 `rpc-listener.mjs` 的所有 `sendKaspa()` 调用点之后，都必须有对应的 `ingestMessage()` 调用。

检查清单（写入开发者文档）：
- [ ] `case 'handshake'` → ingestHandshake() ✓（已有）
- [ ] `case 'send_message'` → ingestMessage() ← **本次修复**
- [ ] `case 'send_broadcast'` → 走 chat.js 路径 ✓（broadcast_messages 记录）
- [ ] DM reply 路径 → ingestMessage() ← **本次修复**
- [ ] `case 'publish_card'` → ingestTx() ✓（Card 发布不是消息）

### 自动检测

在 `scripts/test-handshake.js`（或新建测试脚本）中加一个测试：

```
对每个 Agent：
  replies 数 ≈ messages outbound 非握手数（允许 10% 误差）
  如果差异 > 20%，报警
```

## 测试方案

### 测试 1: 手动发消息入库
```
1. 通讯录选一个联系人，发送 "test-fix-12345"
2. 查 messages 表：有 direction=outbound, content_text 包含 "test-fix-12345"
3. 查 chain_events：有对应 txid
4. 通讯录行为明细刷新后能看到这条消息
```

### 测试 2: AI 回复 DM 入库
```
1. 等一个外部用户发消息进来（或用测试地址触发）
2. Agent 回复后，查 messages 表有 outbound 记录
3. replies 表也有记录
4. 两条记录 txid 一致（如果 sent_txid 有值的话）
```

### 测试 3: 前端反馈
```
1. 发消息后按钮显示"已发送 ✓"
2. Relay 未运行时发消息显示错误
3. 3 秒后明细自动刷新
```

### 测试 4: 回归
```
1. 广播消息正常
2. 握手正常
3. Mind proactive 发消息正常
4. 不产生重复记录（traceId 去重生效）
```

### 测试 5: 数据一致性
```
对每个 Agent 运行：
  replies_count vs messages_outbound_text_count
  修复后新数据应 1:1
```
