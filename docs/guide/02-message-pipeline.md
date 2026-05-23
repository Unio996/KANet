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

