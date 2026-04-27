# TASK T-2026-04-22-01: Channel ↔ Bridge Dispatcher

**执行者**：QClaude (Qwen3.6 本地脑)
**出题人**：Opus 4.7
**优先级**：P0（解锁跨系统跨机器全自动化）
**预计工作量**：约 250 行新增 + 40 行 Bridge 小改

---

## 1. 目标

把 7 个 KANet 开发频道接入现有 `cc-bridge.mjs`，消息流变成：

```
频道 [→ TARGET] 消息 → channel-bridge → Bridge 多队列 → 目标 brain 处理 → 回写链上
```

从此：
- Owner 不再当"消息中继"
- QClaude / Opus / J1 Agent 等都按链上消息驱动
- 每台机器只处理指定队列，天然跨机器分工

## 2. 背景（当前资产）

### 已有的拼图（别重造）

| 文件 | 状态 | 用途 |
|---|---|---|
| `scripts/cc-bridge.mjs` | 运行中 :9100 | OpenAI 协议 queue，Mind/Adapter 入，Claude Code 出 |
| `scripts/qwen-bridge-worker.js` | 本机在盘（git 已被 J1 删） | 自动 poll Bridge，用 QClaude 回答 |
| `scripts/channel-monitor.mjs` | 已跑 | 频道轮询 + 关键词 auto-reply（正交，不要碰）|
| `scripts/watch-dev-channels.mjs` | 刚写 | 只读 watcher（给 Owner 看的）|
| Console `/api/chat/send` / `/api/chat/messages` | 稳定 | 链上广播 / 拉消息 |
| 7 个 whitelisted 频道 | `channels` 表 | dev-coord / kanet-dev / arch / frontend / backend / review / alert |

### 缺的只是"频道 → Bridge"的桥

## 3. 改动清单（4 点）

### 改动 1 —— Bridge 多队列化

**文件**：`scripts/cc-bridge.mjs`
**预计**：+40 行，保持向后兼容

**当前**：单 `_pending: Map<id, entry>`，所有任务进一个队列，Claude Code 抢哪个就是哪个。

**改造**：
- `_queues: Map<string, Map<id, entry>>`，默认队列名 `'default'`
- `POST /v1/chat/completions`：读 HTTP header `X-Queue`，进对应队列；无 header 进 `'default'`（保持 Adapter 现有行为）
- `GET /cc/pending`：读 query `?queue=<name>`，默认 `'default'`
- `POST /cc/respond/:id`：遍历所有队列找 id（因为 id 是全局 UUID）
- `GET /cc/status`：列出每队列的 pending 数和明细
- `enqueue(system, user, model, queueName='default')` 签名扩展

**验收**：
```bash
# 无 X-Queue header 的请求仍进 default，老 Adapter 不受影响
curl -X POST :9100/v1/chat/completions -d '{"messages":[{"role":"user","content":"hi"}]}'
# 带 X-Queue: opus 进 opus 队列
curl -X POST :9100/v1/chat/completions -H "X-Queue: opus" -d '...'
# 状态端点分队列显示
curl :9100/cc/status | jq
```

### 改动 2 —— `channel-bridge.mjs`（新建）

**文件**：`scripts/channel-bridge.mjs`
**预计**：~150 行

**功能**：链 ↔ Bridge 双向桥

```
频道轮询（7 个）
  → 过滤 after=<lastTs> 新消息
  → 解析 recipient 标签：[→ TARGET] 或 [SENDER → TARGET]
  → 匹配本机 config 里声明负责的 queue
  → POST http://127.0.0.1:9100/v1/chat/completions with X-Queue: <queue>
  → 收到 Bridge response（可能等 1-5 分钟）
  → POST http://127.0.0.1:3100/api/chat/send 把回复发回原频道
  → 记录 processed.jsonl
```

**配置文件** `scripts/channel-bridge.config.json`：
```json
{
  "consoleUrl": "http://127.0.0.1:3100",
  "bridgeUrl":  "http://127.0.0.1:9100",
  "relayId":    "5b236c08-03d0-456c-953d-e10001610938",
  "senderTag":  "[NWT auto]",
  "pollMs":     4000,
  "queues": {
    "QCLAUDE-NWT": "qclaude-nwt",
    "NWT":         "qclaude-nwt",
    "OPUS":        "opus"
  },
  "channels": ["dev-coord","kanet-dev","kanet-arch","kanet-frontend","kanet-backend","kanet-review","kanet-alert"]
}
```

（J1 机器上 config 里 relayId 写 J1 的 relay，queues 映射不同 tag，互不干扰。）

**标签解析规则（正则）**：
1. `/\[→\s*([A-Z][A-Z0-9-]*)\]/` 匹配 `[→ QCLAUDE-NWT]`（preferred）
2. `/\[[A-Z0-9-]+\s*→\s*([A-Z][A-Z0-9-]*)\]/` 匹配 `[OPUS → QCLAUDE-NWT]`（legacy）
3. 取第一个 capture group 作为 target；查 `config.queues[target]` 拿 queue name；没匹配就 skip

**防循环**：
- `processed.jsonl`：每处理一条写一行 `{tx_hash, channel, ts}`，启动时 load 成 Set
- 启动时读最后 50 条，跳过 2 小时前的
- 本机自己发出去的消息（sender_address 是配置的 relayId） skip

**CLI**：
```
node scripts/channel-bridge.mjs                  # 前台跑
node scripts/channel-bridge.mjs --config path.json
node scripts/channel-bridge.mjs status           # 查 PID + 处理统计
node scripts/channel-bridge.mjs stop             # 停
```

**回复格式**：
Bridge 返回 reply 文本 → 发链上时加前缀：
```
[NWT auto] <reply text>
```
让频道读者一眼知道是 Bridge 回的（非人工）。

### 改动 3 —— `qwen-bridge-worker.js` 复活升级

**文件**：`scripts/qwen-bridge-worker.js`（已存在，git 未 tracked）

**改造**：
- 加 `--queue=<name>` CLI 参数，默认 `'qclaude-nwt'`
- Poll 改为 `GET :9100/cc/pending?queue=<name>`
- 用 `claude -p "<user>"` headless 模式（走本机 LiteLLM，不走官方 API）
  - 需要 `ANTHROPIC_BASE_URL=http://127.0.0.1:4000` + `ANTHROPIC_AUTH_TOKEN=sk-local-qwen36`
  - `--dangerously-skip-permissions` 别忘带
- 拿到 stdout → `POST :9100/cc/respond/:id` body `{text: stdout}`
- 失败日志 + 不 crash（连续 5 次失败才退出）

**多实例**：
```
node scripts/qwen-bridge-worker.js --queue=qclaude-nwt
node scripts/qwen-bridge-worker.js --queue=qclaude-kanet
```
（将来多 Agent 时各开一实例）

### 改动 4 —— Opus 端（零代码，文档即可）

**文件**：`docs/DEVELOPER-GUIDE.md` 加一小节

**内容**：
```
## Opus 会话入队检查（T-2026-04-22-01 协议）

Opus Claude Code session 启动时，首个动作执行：
  curl http://127.0.0.1:9100/cc/pending?queue=opus

如有 task，处理后：
  curl -X POST http://127.0.0.1:9100/cc/respond/<id> \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"<reply>\"}"

处理完可再 poll 一次，直到队列空才开始用户对话。
```

**将来（非本任务）**：写一个 `claude-opus-worker.mjs` 装 `claude-code-sdk` 自动 poll，用官方 Opus API（有预算控制）。P2 再做。

## 4. 验收标准

1. ✅ Bridge 带 X-Queue header 入指定队列，不带保持 default
2. ✅ `/cc/status` 分队列列出 pending
3. ✅ channel-bridge 启动后，发 `[→ QCLAUDE-NWT] 2+2=?` 到 kanet-dev → 30s 内看到 `[NWT auto] 4` 回到 kanet-dev
4. ✅ `[→ OPUS]` 消息入队但**不**被 qwen-worker 抢走（worker 只 drain 自己那队）
5. ✅ Opus 手动 `curl /cc/pending?queue=opus` 拿到该消息
6. ✅ 重启 channel-bridge 不重复回复老消息（processed.jsonl 生效）
7. ✅ 本机发出的消息不触发 echo（sender 过滤）
8. ✅ 老的 Adapter → Bridge 路径（无 X-Queue）仍工作，Mind 不受影响

**Edge cases**：
- 消息里没有 `[→ X]` 标签 → skip，不入队
- 标签对应 queue 不在配置里 → skip，打 warn log
- Bridge 超时（5 min）→ channel-bridge 收 504，发 `[NWT auto] (timeout)` 到原频道
- Console 挂了 → channel-bridge 重试 5s，不 crash

## 5. 自测脚本

```bash
# 假设 llama-server + LiteLLM + Console 都已跑

# 1. 启 Bridge (改造后)
node scripts/cc-bridge.mjs 9100 > logs/cc-bridge.log 2>&1 &

# 2. 启 worker
node scripts/qwen-bridge-worker.js --queue=qclaude-nwt > logs/qwen-worker.log 2>&1 &

# 3. 启 channel-bridge
node scripts/channel-bridge.mjs > logs/channel-bridge.log 2>&1 &

# 4. 状态
curl -s http://127.0.0.1:9100/cc/status | jq

# 5. 链上发测试
curl -s -X POST http://127.0.0.1:3100/api/chat/send \
  -H "Content-Type: application/json" \
  -d '{"relayId":"<OWNER_RELAY_ID>","channel":"kanet-dev","message":"[→ QCLAUDE-NWT] 说一下 KANet 定位"}'

# 6. 等 30s，拉 kanet-dev 最新
curl -s "http://127.0.0.1:3100/api/chat/messages?channel=kanet-dev&limit=5" | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);j.messages.slice(-3).forEach(m=>console.log(m.sender_address.slice(-12),m.content.slice(0,100)))})"
# 应该看到 [NWT auto] ... 答复

# 7. Opus 手动入队测试
curl -s -X POST http://127.0.0.1:3100/api/chat/send \
  -H "Content-Type: application/json" \
  -d '{"relayId":"<OWNER_RELAY_ID>","channel":"kanet-dev","message":"[→ OPUS] test opus queue"}'

# 8. 等 10s，查 opus 队列
curl -s "http://127.0.0.1:9100/cc/pending?queue=opus"
# 应该返回那条 task (不被 worker 抢走)

# 9. Owner 手动 respond 模拟 Opus 处理
curl -s -X POST http://127.0.0.1:9100/cc/respond/<id> -d '{"text":"opus replying"}'
# 链上应该看到 [NWT auto] opus replying
```

## 6. 陷阱 / 注意事项

1. **`processed.jsonl` 位置** 固定 `scripts/channel-bridge.processed.jsonl`，别放 /tmp
2. **UTF-8**：所有字符串处理走 Node 原生 Buffer/String，别碰 encoding conversion
3. **qwen-bridge-worker.js** 跑之前必须确认 llama-server + LiteLLM 都活着（否则 claude -p 挂）
4. **channel-bridge 和 channel-monitor 并存**：两个都订阅 7 频道，各干各的。channel-monitor 负责 NWT 硬编码 ack/reply（现有行为）；channel-bridge 负责 tag 路由到 Bridge。用 tag 区分：channel-monitor 看 `[DEV-COORD]` / `NWT`，channel-bridge 看 `[→ X]`。不要合并两者。
5. **别监听 `kanet-exchange`**：那是协议消息频道，channel-bridge 的白名单只有 7 个 dev 频道
6. **防循环**：`[NWT auto]` 前缀消息 sender=本机 relay → 必然 skip（双保险）
7. **消息长度**：Kaspa 每条硬顶 5000 字符（memory 记忆），reply 超长要截断 + `...（truncated）`
8. **并发控制**：Bridge 队列本身是串行 drain，一个 worker 同时只处理一个 task。多 task 并发要多开 worker 实例
9. **Mind 原有行为**：Adapter → Bridge 那条路径**不能变**（Mind 里每个 Agent 在等脑子回答）。Mind 的请求**不带 X-Queue**，走 default 队列，跟以前一样

## 7. 不要做的事

- ❌ 不要改 `cc-bridge.mjs` 的 OpenAI 协议
- ❌ 不要改 `channel-monitor.mjs`（正交）
- ❌ 不要改 `/api/chat/send` / `/api/chat/messages` 端点
- ❌ 不要加新 DB 表 / migrate
- ❌ 不要实现 Opus 自动 spawn（P2）
- ❌ 不要把 Owner 的其他手动消息也 hijack 入 Bridge（除非有 `[→ X]` 标签）
- ❌ 不要在 Bridge 里加"智能路由"（哪个队列空就放哪）—— 明确 recipient 好审计

## 8. 完成后报告格式

发到 `kanet-review` 频道（链上），格式：

```
[QCLAUDE] [DONE] T-2026-04-22-01 Channel-Bridge Dispatcher
Files:
  - scripts/cc-bridge.mjs (+X -Y)
  - scripts/channel-bridge.mjs (+X new)
  - scripts/qwen-bridge-worker.js (+X -Y)
  - scripts/channel-bridge.config.json (new, sample)
Acceptance 8/8 PASS (逐条 ✅/❌)
Edge cases 4/4 PASS
Cross-machine: 已测 / 未测 (本机跑通，J1 侧需他那边对称部署)
Issues: <列任何发现>
```

Owner 审核（Opus 负责）→ commit → 生 bundle 发 J1。

## 9. 交付铁律

**自己测试，全部通过才能交付。不让 Owner 当测试员。**
