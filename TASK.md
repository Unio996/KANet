# TASK: channel-monitor.mjs 审核修复

> 指派：QClaude
> 优先级：P0
> 日期：2026-04-20

## 交付铁律

**自己测试，全部通过才能交付。**

## Opus 审核发现 5 个问题，按优先级修

### P0-1：每条消息都花 KAS 回复（严重）

第 141-144 行，每条外部消息都调 `sendMessage` → `POST /api/chat/send` → 链上广播花 gas。
大部分回复是无意义的 `[NWT ack] xxx — 收到。`

**修法**：
- 默认不回复。只在消息明确需要 NWT 回应时才回复（比如包含 "NWT" 或 "@NWT" 或直接提问）
- 对于只需要确认的消息，用 `POST /api/chat/local`（不上链，不花 KAS）代替 `POST /api/chat/send`
- 只有需要让链上其他人看到的回复才用 send（上链）

### P0-2：监听所有频道

第 169 行从 API 拿全部频道然后全部监听。`kanet-exchange` 里全是协议 JSON 消息，每条都触发处理。

**修法**：
- 白名单，只监听这些频道：`['dev-coord', 'kanet-dev', 'kanet-arch', 'kanet-frontend', 'kanet-backend', 'kanet-review', 'kanet-alert']`
- 不要监听：`kanet-exchange`（协议消息）、`kanet-public`（闲聊）、`general`（闲聊）、`kanet-status`（只读汇报）

### P1：防循环

`shouldSkip` 只跳过 J2 和 NWT 两个地址后缀。如果其他 Agent（KANet、Trader-A、Trader-B）也发了消息，monitor 会回复，可能引发循环。

**修法**：
- 从 Console API 拉所有本地 relay 地址：`GET http://localhost:3100/relays` 页面或直接查 DB
- 简单方式：跳过所有 `sender_address` 以 `owner:` 开头的 + 所有本地 Agent 地址
- 或者更简单：在启动时从 `/api/chat/channels` 旁边加一个本地地址列表，hardcode 现有 5 个 Agent 的地址后缀

现有 Agent 地址后缀（加到 shouldSkip）：
```
pqqqe78fjev3  — J2
z2w7ktl95grm  — NWT  
7y7err0tz9    — KANet
```
Trader-A 和 Trader-B 还没有地址，暂时不用管。

### P2：tick 日志刷屏

每 5 秒打一条 `tick N`，一小时 720 行无用日志。

**修法**：
- 去掉每 tick 的日志
- 只在有新消息时打日志
- 每 5 分钟打一次心跳（`heartbeat: N ticks, M messages processed`）

### P3：回复逻辑

`answerJ1Question` 硬编码关键词匹配，暂时可以接受。等路由器做好后会被 Mind 替代。

**本轮不改，保持现状。**

## 测试路径

1. 启动 monitor → 只监听白名单频道（不含 kanet-exchange）
2. 用 curl 往 dev-coord 发一条测试消息 → monitor 看到但**不自动回复**（因为没提到 NWT）
3. 发一条包含 "NWT" 的消息 → monitor 回复（用 local 不上链）
4. 检查 kanet-exchange 最近 5 分钟 → 没有 NWT ack 消息
5. 日志文件里没有每 5 秒的 tick 刷屏
6. 跑 5 分钟 → 无异常、无循环、日志干净
