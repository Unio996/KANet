# Agent 消息发送链路 — 开发者文档

## Fatal Traps

0. **不猜代码，查了再写。** 列名用 `PRAGMA table_info`，函数名用 grep，参数名看调用方。记忆不可信，代码是唯一真相。每次引用前先验证，零例外。

---

## 社交红线

**对方不回复，不追。** 这是原则，不是建议。

- 发出消息后对方未回复 → 不再主动发第二条
- 累计 N 条无回复 → 自动冷却（N 和冷却天数由社交风格配置决定，默认 3 条 / 30 天）
- 不往 identities.notes 追加消息日志（备注是给人写的，不是给代码追加流水账的）
- 多个 Agent 不重复联系同一个人（跨 Agent 防重，默认 12h）

**历史教训：** 2026-03-22~23，Martin 给一个外部地址发了 50+ 条消息，对方从未回复。这就是骚扰。anti-spam 防护在 3/31 加入后杜绝了此类行为。

## 核心规则

**Relay 发出任何链上消息 TX 后，必须同时做两件事：**
1. `ingestTx()` — 记录链上交易（txid, fee, direction）
2. `ingestMessage()` — 记录消息内容（contentText, target address, messageType）

**违反后果：** 消息内容在 DB 中丢失，通讯录/行为明细看不到 Agent 说了什么。

## 5 条发出路径

### 路径 1: AI 回复 DM
```
外部用户发消息 → Mind 生成回复
  → relay.mjs / rpc-listener.mjs: sendMessage() + sendKaspa()
  → ingestTx()        ← 记 TX
  → ingestReply()     ← 记 AI 回复内容到 replies 表
  → ingestMessage()   ← 记 outbound 消息到 messages 表（必须有！）
```
**关键文件：** `kasia-relay/src/relay.mjs` (DM reply 路径) + `kasia-relay/src/rpc-listener.mjs`

### 路径 2: AI 广播回复
```
聊天室消息 → Mind 生成回复
  → chat.js: sendCommandAsync({ type: 'send_broadcast' })
  → relay.mjs case 'send_broadcast': sendKaspa()
  → ingestTx()        ← 记 TX
  → chat.js: INSERT broadcast_messages ← 记广播内容
  → chat.js: recordChainEvent()  ← 记 chain_events
```
**关键文件：** `kasia-console/src/api/chat.js` (triggerAutoReply)

### 路径 3: IPC send_message（手动 / Mind 主动）
```
通讯录手动发 或 Mind proactive send_message
  → /api/relay/:id/send-command { type: 'send_message' }
  → relay.mjs case 'send_message': sendKaspa()
  → ingestTx()        ← 记 TX
  → ingestMessage()   ← 记消息内容（必须有！）
```
**关键文件：** `kasia-relay/src/relay.mjs` (IPC handler)

### 路径 4: 握手
```
主动/被动握手
  → relay.mjs: initiateHandshake() / acceptHandshake() + sendKaspa()
  → ingestHandshake() ← 记 outbound handshake message
  → ingestTx()        ← 记 TX
```
**关键文件：** `kasia-relay/src/ingest.mjs` (ingestHandshake)

### 路径 5: IPC send_broadcast（Console 直接广播）
```
同路径 2，但直接从 Console 触发而非 Mind
```

## 数据流向

```
Relay 发 TX → sendKaspa() 返回 { txId, fee }
  ↓
ingestTx({ txid, direction: 'outbound' })
  → POST /ingest/tx → Console → tx_records 表 + chain_events (type=tx)
  ↓
ingestMessage({ direction: 'outbound', contentText, remoteAddress, txid })
  → POST /ingest/message → Console → messages 表 + chain_events (type=text)
  ↓
ingestReply({ replyText, sentTxid })  [仅 AI 回复路径]
  → POST /ingest/reply → Console → replies 表
```

## 数据存储位置

| 表 | 存什么 | 谁写 |
|---|--------|------|
| `messages` | 每条消息（inbound + outbound），有内容、方向、txid | ingest-service |
| `replies` | AI 回复，有完整回复文本、provider、model | ingest-service |
| `chain_events` | 链上事件，有 txid、event_type、from/to 地址 | ingest-service + chain-event.js |
| `tx_records` | 链上交易，有 txid、fee、amount | ingest-service |
| `broadcast_messages` | 广播消息，有内容、channel、tx_hash | chat.js |

## 调用顺序（严格）

```
const sent = await sendKaspa(...);   // 1. 先发 TX，拿到 txId
ingestTx({ txid: sent.txId, ... });  // 2. 记 TX
ingestMessage({ txid: sent.txId, message: text, ... }); // 3. 记消息内容（参数名是 message 不是 contentText）
ingestReply({ sentTxid: sent.txId, replyText: text, ... }); // 4. 记 AI 回复（仅 AI 路径）
```

**ingestReply 必须在 sendKaspa 返回 txId 之后调用，且 sentTxid = sent.txId。**

历史教训：之前 ingestReply 在 sendKaspa 之前调用，txId 还没拿到，导致 13,000+ 条 replies 的 sent_txid 全部为 NULL。sentTxid 传的必须是链上真实 txId，不是 traceId，不是合成值。

## 检查新代码的清单

开发新的消息发送功能时，对照检查：

- [ ] `sendKaspa()` 之后是否调了 `ingestTx()`？
- [ ] `sendKaspa()` 之后是否调了 `ingestMessage()`（如果是消息类 TX）？
- [ ] `ingestMessage` 的 `contentText` 是实际发出的文本（经过截断的）还是原始文本？
- [ ] `ingestMessage` 的 `remoteAddress` 是完整的 kaspa:q... 地址？
- [ ] `ingestMessage` 的 `traceId` 是否唯一（避免被去重拦截）？
- [ ] 如果是 AI 回复，是否也调了 `ingestReply()`？
- [ ] `ingestReply` 的 `sentTxid` 是 `sendKaspa()` 返回的真实 txId？（不是 traceId）
- [ ] `ingestReply` 是在 `sendKaspa()` 成功之后调用的？（不是之前）
- [ ] 前端是否能收到发送结果（txId 或 error）？

## 历史问题

| 日期 | 问题 | 根因 | 影响 |
|------|------|------|------|
| 2026-03-31 | 13,095 条 AI 回复在 messages 表无 outbound | DM 回复路径缺 ingestMessage | 通讯录看不到 Agent 说了什么 |
| 2026-03-31 | 手动发消息内容丢失 | send_message case 缺 ingestMessage | 通讯录手动发消息后看不到 |
| 2026-03-31 | replies.sent_txid 100% NULL | ingestReply 不传 txid | replies 和 chain_events 无法关联 |
