# 社交规则强制执行 — 架构重设计

> **P0 级别。当前社交规则形同虚设。必须在代码层强制执行，不能依赖 Brain prompt。**

---

## 问题本质

规则存在 ≠ 规则生效。

当前架构把社交规则的执行权交给了最不可靠的组件 — Brain（LLM）。
规则写在 system prompt 里，Brain 想遵守就遵守，不想遵守也没人拦。
结果：Sophie 对同一个人发了 8+ 条几乎相同的消息，跨 6 小时，所有"规则"全部失效。

```
当前架构（坏的）：
  规则写在哪？ → Brain 的 system prompt 里（文字建议）
  谁执行规则？ → Brain（LLM，不可靠）
  谁检查违规？ → 没人
  违规后果？   → 没有

正确架构（要改成的）：
  规则写在哪？ → Mind 层的代码里（确定性逻辑）
  谁执行规则？ → Mind（代码，100% 可靠）
  谁检查违规？ → Relay 发送前（最后一道门）
  违规后果？   → 消息被拦截，不发出，记录事件
```

## 核心原则

**社交规则必须是代码强制的，不是 prompt 建议的。**
**Brain 说什么不重要，Mind 层代码决定发不发。**

这和"Mind 执行 Brain 汇报"是同一个原则的延伸：
- Brain 不能可靠执行 ACTION → Mind 执行
- Brain 不能可靠遵守社交规则 → Mind 强制

## 根因分析

### 为什么 Sophie 能连发 8 条？

```
Proactive 循环（每 15 分钟）：
  1. Context Builder 组装上下文（包含历史消息）
  2. Brain 看到 owner 之前问过"转 U"
  3. Brain 决定：要回复这个问题
  4. Brain 输出 [ACTION:SEND_MESSAGE target=owner message="关于转USDT..."]
  5. action-executor 执行发送
  6. Relay shouldBlockOutbound 检查（60s 去重窗口）→ 放行（距上次 > 15min）
  7. 消息发出
  
  15 分钟后，回到第 1 步。Brain 又看到同一个上下文，又做同一个决定。
  **因为 Brain 没有"我已经回复过这个"的记忆。**
```

### 三道防线全部失效

| 防线 | 设计 | 实际 | 为什么失效 |
|------|------|------|-----------|
| Brain prompt 规则 | "不回复就不追" | 无效 | Brain 每次都是"第一次"看到这个问题 |
| anti-spam 检查 | 检查对方有没有回复 | 未检查 | anti-spam 只在 reactive 路径上，proactive 不走这条路 |
| Relay 去重 | 60s 窗口 85% 相似度 | 放行 | 15min 间隔远超 60s 窗口 |

## 解决方案

### 第一层：Mind 出口硬检查（最关键）

**位置**：`agent-mind/src/mind.mjs` 的 `executeTradeAction` 或独立函数

在 `SEND_MESSAGE` / `SEND_BROADCAST` 执行前，查 Console DB：

```javascript
async function socialGateCheck(config, target, message) {
  const consoleUrl = config.consoleUrl;
  
  // 1. 最近 24h 对这个人发了几条？
  const recent = await fetchJson(`${consoleUrl}/api/agent/outbound-count?` + 
    `relay_node_id=${config.relayNodeId}&target=${target}&hours=24`);
  if (recent.count >= 3) {
    return { blocked: true, reason: `24h 内已发 ${recent.count} 条给 ${target}` };
  }
  
  // 2. 对方有没有回复过？
  const replied = await fetchJson(`${consoleUrl}/api/agent/peer-replied?` +
    `relay_node_id=${config.relayNodeId}&target=${target}&hours=48`);
  if (recent.count > 0 && !replied.hasReply) {
    return { blocked: true, reason: `对方未回复，不追` };
  }
  
  // 3. 和最近发的消息相似度
  const similar = await fetchJson(`${consoleUrl}/api/agent/similar-outbound?` +
    `relay_node_id=${config.relayNodeId}&target=${target}&message=${encodeURIComponent(message)}`);
  if (similar.similarity > 0.6) {
    return { blocked: true, reason: `和 ${similar.hours}h 前的消息 ${Math.round(similar.similarity*100)}% 相似` };
  }
  
  return { blocked: false };
}
```

### 第二层：Context Builder 注入发送历史

**位置**：`agent-mind/src/context-builder.mjs` 的 proactive user prompt

```
YOUR RECENT OUTBOUND MESSAGES TO THIS PEER:
  - 2h ago: "你好！我看到你之前问过关于转U的问题..."
  - 4h ago: "你好！我注意到你之前问过关于转账的问题..."
  ⚠ You already sent 5 messages on this topic. DO NOT send more.
  ⚠ Peer has NOT replied. STOP contacting.
```

这样 Brain 至少知道自己发过什么。即使 Brain 忽略，第一层代码会强制拦截。

### 第三层：Relay 去重窗口扩大

**位置**：`kasia-relay/src/relay.mjs` 的 `shouldBlockOutbound`

```
DEDUP_WINDOW_MS: 60_000 → 86_400_000 (24h)
_recentOutbound 限制: 50 → 500
```

这是兜底，不是主力。主力是第一层 Mind 硬检查。

### 第四层：founding-vision 目标类型区分

**位置**：`agent-mind/src/kernels/intent.mjs`

```javascript
// proactive 循环获取目标时，跳过 principle 类型
getActionableGoals() {
  return this.goals.filter(g => 
    g.status === 'active' && 
    g.type !== 'principle' &&  // "诚实守信"这种不是可执行目标
    !g.isFoundingVision        // founding vision 也不执行
  );
}
```

## API 需要新增

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/agent/outbound-count` | GET | 查最近 N 小时对某人发了几条 |
| `/api/agent/peer-replied` | GET | 查对方最近有没有回复 |
| `/api/agent/similar-outbound` | GET | 查最近发给某人的消息和当前消息的相似度 |

数据源：`messages` 表（direction=outbound）

## 文件改动清单

| 文件 | 改动 |
|------|------|
| `agent-mind/src/mind.mjs` | SEND_MESSAGE 前加 socialGateCheck |
| `agent-mind/src/context-builder.mjs` | proactive prompt 注入 outbound 历史 |
| `agent-mind/src/kernels/intent.mjs` | getActionableGoals 跳过 principle |
| `kasia-console/src/api/conversations.js` | 3 个新 API 端点 |
| `kasia-console/src/services/anti-spam.js` | outbound-count / peer-replied / similar-outbound 查询 |
| `kasia-relay/src/relay.mjs` | DEDUP_WINDOW 60s → 24h |

## 验证标准

改完后必须通过：
1. Sophie 对同一个人 24h 内最多发 3 条 → 第 4 条被 Mind 拦截
2. 对方没回复 → 第 2 条就被拦截
3. 内容和之前 60% 以上相似 → 被拦截
4. founding-vision "诚实守信" → proactive 不执行
5. 以上全部在代码层强制，不依赖 Brain 判断
