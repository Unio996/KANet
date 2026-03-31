# 去掉 GATEWAY_URL fallback

## 问题

`ai.mjs` 的 `getAIReply()` 有两级调用：
1. Console Mind（`/api/agent/reply`）— 有 Gate 0 stop 检测、Gate 1 blocked/rate_limit、社交原则、anti-spam
2. Adapter 直连（`GATEWAY_URL`）— 无任何防护

当 Console 的 Gate 故意返回 null（"不要回复这个人"），`ai.mjs` 误以为是故障，走 Level 2 直连 Adapter，绕过所有防护。

后果：被 block 的人还能得到回复，说了"不再联系"还继续回复，rate limit 无效，社交原则无效。

## 根因

`/api/agent/reply` 把 null 转成空字符串 `{ reply: '' }`。`ai.mjs` 把空字符串当失败，走 fallback。

## 方案

**去掉 fallback。Mind 是唯一回复路径。Console 返回空就不回复。**

### 改动 1: ai.mjs — 去掉 GATEWAY_URL fallback

改前：
```javascript
export async function getAIReply(peer, message, txId) {
  if (CONSOLE_URL) {
    try {
      const res = await fetch(CONSOLE_URL + '/api/agent/reply', { ... });
      if (res.ok) {
        const { reply } = await res.json();
        if (reply?.trim()) return reply;
      }
    } catch (err) {
      console.log('[ai] Mind reply failed, trying adapter:', err.message);
    }
  }
  // Fallback: direct adapter call
  if (GATEWAY_URL) { ... }
  throw new Error("No CONSOLE_URL or GATEWAY_URL configured");
}
```

改后：
```javascript
export async function getAIReply(peer, message, txId) {
  if (!CONSOLE_URL) {
    console.log('[ai] No CONSOLE_URL — cannot reply');
    return null;
  }
  try {
    const res = await fetch(CONSOLE_URL + '/api/agent/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayNodeId: RELAY_NODE_ID, peer, message, txId }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.log('[ai] Console returned', res.status);
      return null;
    }
    const { reply } = await res.json();
    return reply?.trim() || null;
  } catch (err) {
    console.log('[ai] Console unreachable:', err.message);
    return null;
  }
}
```

关键变化：
- Console 返回空 → return null（不回复）
- Console 不可达 → return null（不回复）
- 不再 fallback 到 GATEWAY_URL
- 不再 throw Error（调用方已处理 null）

### 改动 2: relay-manager.js — 不再设 GATEWAY_URL

`relay-manager.js:69` 删掉：
```javascript
GATEWAY_URL: `http://localhost:${adapterPort}/reply`,
```

这样即使 ai.mjs 里残留 GATEWAY_URL 逻辑（被删了，但防御性考虑），也因为环境变量为空而不生效。

### 改动 3: Relay 调用方处理 null

`rpc-listener.mjs:595` 和 `relay.mjs:131` 调 `getAIReply` 后已经有 null 处理：

rpc-listener.mjs:
```javascript
replyText = await getAIReply(senderAddress, messageText, txId);
// 后面有 if (!replyText) 的处理
```

relay.mjs:
```javascript
replyText = await getAIReply(peer, msg.message, msg.txId);
// 后面有 replyText fallback 到 "AI 暂时不可用"
```

需要确认：当 `getAIReply` 返回 null 时，不应该发"AI 暂时不可用"给对方。Gate 故意拦截 = 静默，不是"不可用"。

检查 relay.mjs:131 之后的逻辑：

### 改动 4: relay.mjs — null 时不发"不可用"

如果 `getAIReply` 返回 null，**不回复**，不发任何消息。当前代码如果 replyText 为空会发"AI 暂时不可用" — 这要改成静默。

### 日志区分

两种静默场景必须在日志里可区分：
- Gate 拦截 → `[mind-manager] Message dropped (blocked/stop/rate_limited): ...`（已有，在 Console 侧）
- Console 不可达 → `[ai] Console unreachable: ...`（在 Relay ai.mjs 侧）

行为一致（都不回复），但运维能从日志看出是哪种。

### 执行顺序

1 → 2 → 4 → 3。先断掉 fallback 通道（ai.mjs + relay-manager），再处理调用方（relay.mjs + rpc-listener），不留窗口期。

### 不改的

- Console 的 `getReply` / Gate 逻辑不动
- `/api/agent/reply` 端点不动
- adapter-launcher.js 的 `OPENCLAW_GATEWAY_URL` 不动（那是 OpenClaw provider 自己的 WebSocket，跟这个无关）

## 测试

### 测试 1: Gate 拦截时不回复
```
1. 确保某个地址被 block
2. 用该地址发消息给 Agent
3. 验证：Agent 不回复（不是回复"不可用"，是完全静默）
4. 验证日志：Console 有 "[mind-manager] Message dropped (blocked)" 日志
5. 验证：没有 "[ai] Mind reply failed, trying adapter" 日志（fallback 已去掉）
```

### 测试 2: Stop 关键词时不回复
```
1. 发送包含"滚"/"别发了"的消息
2. 验证：Agent 不回复
3. 验证日志：有 "[anti-spam] STOP detected"，无 adapter fallback
```

### 测试 3: 正常对话不受影响
```
1. 用正常地址发正常消息
2. 验证：Agent 正常回复（走 Console Mind）
3. 验证回复有 Mind 的身份/技能特征（不是裸 Adapter 回复）
```

### 测试 4: Console 不可达时静默
```
1. 停掉 Console，保持 Relay 运行
2. 发消息给 Agent
3. 验证：Agent 不回复（不是回复"不可用"）
4. 日志有 "[ai] Console unreachable"
```
