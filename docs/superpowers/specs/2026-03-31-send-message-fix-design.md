# 手动发消息链路修复

## 问题

通讯录快捷发消息框发消息后：
1. Relay 的 `send_message` IPC 只调 `ingestTx()`，不记消息内容和目标地址 → messages 表无记录，行为明细看不到
2. 前端 fire-and-forget，用户无反馈（不知道成功没）
3. 历史握手数据有 `-accept` 后缀（旧数据，不回溯修复）

## 链路分析

当前路径：
```
通讯录 sendMsg()
  → POST /api/relay/:id/send-command { type: 'send_message', target, message }
    → relay.mjs line 288: sendMessage() → sendKaspa() → TX 上链
    → relay.mjs line 290: ingestTx({ txid }) → 只记 TX，不记内容
    → 前端收到 { ok: true }，2 秒后刷新明细 → 看不到（messages 没记录）
```

应该的路径：
```
通讯录 sendMsg()
  → POST /api/relay/:id/send-command { type: 'send_message', target, message }
    → relay.mjs: sendMessage() → sendKaspa() → TX 上链
    → relay.mjs: ingestTx({ txid }) + ingestMessage({ direction: 'outbound', contentText: message, txid })
    → chain_events 记一条 comm_sent
    → messages 表记一条 outbound
    → 前端收到 { ok: true, txId } → 显示"已发送" → 刷新明细能看到
```

## 修复方案

### Fix 1: Relay send_message 补 ingestMessage

**文件：** `kasia-relay/src/relay.mjs` line 288-292

在 `ingestTx()` 之后加一行 `ingestMessage()`，把消息内容、目标地址、txid 都传给 Console。

现有代码：
```javascript
case 'send_message': {
  ...
  draft = await sendMessage({ address: cmd.target, message: cmd.message });
  sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
  ingestTx({ traceId: sent?.txId, txid: sent?.txId, direction: 'outbound', fee: sent?.fee });
  log(`MESSAGE → ${cmd.target?.slice(-12)} TX: ${sent?.txId || '?'}`);
  break;
}
```

改为：
```javascript
case 'send_message': {
  ...
  draft = await sendMessage({ address: cmd.target, message: cmd.message });
  sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
  ingestTx({ traceId: sent?.txId, txid: sent?.txId, direction: 'outbound', fee: sent?.fee });
  ingestMessage({
    traceId: `msg-out:${sent?.txId || Date.now()}`,
    direction: 'outbound',
    localAddress: localAddress,
    remoteAddress: cmd.target,
    txid: sent?.txId,
    messageType: 'text',
    contentText: cmd.message || '',
  });
  log(`MESSAGE → ${cmd.target?.slice(-12)} TX: ${sent?.txId || '?'}`);
  break;
}
```

`ingestMessage` 已经在 relay.mjs 顶部 import 过了（line 6）。

### Fix 2: send-command API 改为 async，返回 txId

**文件：** `kasia-console/src/api/relay.js` line 991-997

现有代码用 `sendCommand`（fire-and-forget），改为 `sendCommandAsync`（等 Relay 回应）。

现有：
```javascript
fastify.post('/api/relay/:id/send-command', async (request, reply) => {
  const { type, target, message, params, channel, amount } = request.body || {};
  if (!type) return reply.code(400).send({ error: 'type is required' });
  const sent = sendCommand(request.params.id, { type, target, message, params, channel, amount });
  if (!sent) return reply.code(503).send({ error: 'Relay not running' });
  return reply.send({ ok: true });
});
```

改为：
```javascript
fastify.post('/api/relay/:id/send-command', async (request, reply) => {
  const { type, target, message, params, channel, amount } = request.body || {};
  if (!type) return reply.code(400).send({ error: 'type is required' });
  try {
    const result = await sendCommandAsync(request.params.id, { type, target, message, params, channel, amount });
    return reply.send({ ok: true, ...result });
  } catch (err) {
    return reply.code(503).send({ error: err.message || 'Relay command failed' });
  }
});
```

需要确认 `sendCommandAsync` 已 import。

注意：Relay 的 `send_message` case 需要在最后通过 `process.send({ requestId, result })` 返回结果。检查 relay.mjs 末尾的通用 response handler（line 327-330）是否覆盖了 send_message case。

### Fix 3: 通讯录发消息反馈

**文件：** `kasia-console/src/ui/contacts.eta` 的 sendMsg 方法

现有：发完清空输入框，2 秒后静默刷新。
改为：发完显示"已发送 ✓"提示 3 秒，然后刷新明细。如果失败显示错误。

## 测试方案

### 测试 1: 消息入库验证
```
1. 打开通讯录，选一个已握手的联系人
2. 在快捷发消息框输入 "test message 12345"
3. 点发送
4. 查 DB：
   - messages 表有一条 direction=outbound, content_text="test message 12345", message_type=text
   - chain_events 表有对应 txid 的记录
5. 刷新行为明细 → 看到这条消息
```

### 测试 2: 前端反馈
```
1. 发消息后，按钮显示"已发送 ✓"（不是一直停在"发送中..."）
2. 3 秒后行为明细自动刷新，能看到刚发的消息
3. 如果 Relay 没运行，显示错误提示
```

### 测试 3: 回归验证
```
1. Agent Mind 的 proactive 发消息仍然正常
2. 广播消息仍然正常
3. 握手仍然正常
```
