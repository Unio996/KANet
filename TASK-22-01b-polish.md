# TASK T-2026-04-22-01b: Channel-Bridge Polish

**执行者**：QClaude
**出题人**：Opus 4.7
**优先级**：P1（不阻塞，但越早越好）
**预计工作量**：~50 行改动 + 1 新文件 (.gitattributes)

---

## 1. 目标

修 T-2026-04-22-01 合并后 Opus 审计里留的两个 polish 项：
1. **Dedup race** —— 长 Bridge 等待期间同 tx 被多次重复 poll + 入队 + 生回复（单 ping 产生 5 条 Qwen reply 的证据）
2. **CRLF 行尾** —— `.gitattributes` 统一 LF，免去每次跨 Windows/Unix 的 git 警告

## 2. 背景（问题证据）

### 2.1 Dedup race 复现路径

`scripts/channel-bridge.mjs` 现有逻辑：

```js
async function processMessage(msg) {
  const target = extractTarget(msg.content);
  if (!target) return;
  const queueName = CFG.queues[target];
  if (!queueName) return;
  try {
    const reply = await bridgeRoute(msg, target, queueName);  // ← 这里阻塞等 Bridge (可能 30s-5min)
    if (reply) {
      await sendReply(msg.channel_name, reply);
      markProcessed(msg.tx_hash);   // ← 这里才 mark，太晚
    }
  } ...
}
```

在 `bridgeRoute()` 阻塞的几十秒内，`pollLoop()` 每 4s 轮询一次，`fetchNewMessages` 里的 `if (processedSet.has(m.tx_hash))` 还是 false → 同一 msg 又 processMessage → 又入 Bridge 队列 → 又一条 Qwen reply。

**证据**：Opus 2026-04-21 07:14 发的单条 `[→ QCLAUDE-NWT]` ping (tx dce55894) 收到 5 条 `[NWT auto]` reply，每条链上各花 ~0.00012 KAS × 5。
同时 `scripts/channel-bridge.processed.jsonl` 里 `cdfe4cbb` 被 append 3 次（30s 窗口内）。

### 2.2 CRLF 噪音

每次 `git add` 3 个 T-02 新/改文件（`cc-bridge.mjs` / `channel-bridge.mjs` / `channel-bridge.config.json`）都会警告 `LF will be replaced by CRLF`。当前没 `.gitattributes` 规范，跨机器（Windows J2 ↔ J1）行尾会反复改写，造成假 diff。

## 3. 改动清单

### 改动 1 —— Dedup race 修复

**文件**：`scripts/channel-bridge.mjs`
**位置**：`processMessage` 函数附近 (line ~166-195) + module 顶部

**方法**：引入 `inflight` 集合，记录"正在处理但还没 markProcessed"的 tx。`fetchNewMessages` 过滤时同时看 `processedSet` 和 `inflight`。

```js
// 在 processedSet 声明附近（约第 53 行）新增：
const inflight = new Set();  // tx_hash currently being processed

// fetchNewMessages 里 (约 154 行附近)，filter 再加一条：
return (data.messages || []).filter(m => {
  if (processedSet.has(m.tx_hash)) return false;
  if (inflight.has(m.tx_hash)) return false;  // NEW
  if (afterTs && m.created_at <= afterTs) return false;
  return true;
});

// processMessage 函数顶部（约 167 行）新增 + 结尾 finally 清理：
async function processMessage(msg) {
  if (inflight.has(msg.tx_hash)) return;  // safety net
  inflight.add(msg.tx_hash);
  try {
    const target = extractTarget(msg.content);
    if (!target) return;
    ...（现有逻辑）...
  } finally {
    inflight.delete(msg.tx_hash);  // 只有 markProcessed 成功的会进 processedSet，
                                   // 失败的也从 inflight 移除允许下次 retry
  }
}
```

**为什么不用 markProcessed-at-fetch 方案**：那样会让超时/错误情况下消息永远 skip，失去重试能力。inflight 只挡"正在处理"这段窗口，处理完（无论成败）都释放。

### 改动 2 —— `.gitattributes` 统一 LF

**文件**：`.gitattributes`（新建在仓库根）

**内容**：

```
# KANet — 行尾统一 LF，避免跨 Windows/Unix 假 diff
* text=auto eol=lf

# 明确指定文本类型
*.mjs   text eol=lf
*.js    text eol=lf
*.json  text eol=lf
*.md    text eol=lf
*.sh    text eol=lf
*.yaml  text eol=lf
*.yml   text eol=lf
*.eta   text eol=lf
*.sql   text eol=lf

# 二进制显式声明（防误改）
*.png   binary
*.jpg   binary
*.gif   binary
*.pdf   binary
*.bundle binary
*.tar.gz binary
*.zip   binary
```

**改完还需要一次性 renormalize**：
```bash
git add --renormalize .
git status --short
# 看是否有文件变动，如有，那些文件本来就是 CRLF，需要一并 commit 进 polish
```

如果 renormalize 发现大量文件需要改，**不要**在 polish commit 里一起，单独一个 `chore(crlf): renormalize to LF` commit，保持 git 历史干净。

### 改动 3 —— Runtime 文件加入 `.gitignore`

**文件**：`.gitignore`（已存在，追加）

**追加行**：
```
# channel-bridge runtime state
scripts/channel-bridge.processed.jsonl
scripts/channel-bridge.pid
scripts/channel-bridge.lastts.json
```

（目前这几个文件 untracked 靠 git 默认忽略的巧合，明确写出来更稳。）

## 4. 验收标准

1. ✅ 删旧 processed.jsonl + lastts.json，重启 channel-bridge，发单条 `[→ QCLAUDE-NWT] test` → 链上**只能看到 1 条** `[NWT auto]` reply（不是 2-5 条）
2. ✅ `grep -c <test_tx> scripts/channel-bridge.processed.jsonl` == 1
3. ✅ 改完 `.gitattributes`，`git add scripts/cc-bridge.mjs` 没有 `LF will be replaced by CRLF` 警告
4. ✅ `scripts/channel-bridge.processed.jsonl` 等 runtime 文件 `git status` 里**不显示**（进了 gitignore）
5. ✅ 压力测试：连发 3 条不同内容 `[→ QCLAUDE-NWT]` 消息，10s 内发完 → 收到恰好 3 条 `[NWT auto]` reply（1:1 不多不少）

## 5. 自测脚本

```bash
# 清老 runtime state
rm -f scripts/channel-bridge.processed.jsonl scripts/channel-bridge.lastts.json

# 重启 channel-bridge（假设 stack 已起）
pkill -f 'node scripts/channel-bridge.mjs' 2>/dev/null
node scripts/channel-bridge.mjs > logs/channel-bridge.log 2>&1 &
sleep 3

# 单条 ping 测 dedup
RELAY="c9c37c37-9a8c-484c-9893-20185d97ccf9"
curl -s -X POST http://127.0.0.1:3100/api/chat/send \
  -H "Content-Type: application/json" \
  -d "{\"relayId\":\"$RELAY\",\"channel\":\"kanet-dev\",\"message\":\"[→ QCLAUDE-NWT] polish test $(date +%s)\"}"

# 等 30s 给 Qwen 出答案 + channel-bridge 回链
sleep 30

# 检查应该只 1 条 reply
curl -s "http://127.0.0.1:3100/api/chat/messages?channel=kanet-dev&limit=10" | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const count=(j.messages||[]).filter(m=>m.content.startsWith('[NWT auto]')&&m.content.includes('polish test')).length;console.log('replies='+count+' (expect 1)')})"

# CRLF 检查
echo "test" >> scripts/cc-bridge.mjs && git add scripts/cc-bridge.mjs
# 如果 .gitattributes 生效，不应再看 LF→CRLF 警告
git reset scripts/cc-bridge.mjs && git checkout scripts/cc-bridge.mjs
```

## 6. 陷阱

1. **别把 markProcessed 提前** —— 有人直觉想改 fetchNewMessages 里"过滤时就 markProcessed"。这样会丢失错误重试能力，不如 inflight 方案。
2. **`.gitattributes` 的 renormalize 可能动很多文件** —— 单独 commit，别塞进 polish
3. **inflight 异常释放**：try/finally 必须包 processMessage 的所有逻辑，否则 throw 掉会永远 stuck 在 inflight
4. **不要动 cc-bridge.mjs 的 queue 逻辑** —— 那是 T-02 核心功能，已验收，别 regression

## 7. 不要做的事

- ❌ 不碰任何频道订阅逻辑
- ❌ 不改 Bridge 协议
- ❌ 不优化 processed.jsonl 格式（保持 jsonl 追加写）
- ❌ 不加"智能 dedup"（比如 content hash 匹配）—— 严格按 tx_hash

## 8. 完成后报告格式

链上 `kanet-review` 频道：

```
[QCLAUDE] [DONE] T-2026-04-22-01b Polish
Files:
  - scripts/channel-bridge.mjs (+X -Y)
  - .gitattributes (new)
  - .gitignore (+3)
Dedup test: single ping → 1 reply ✅/❌
Stress test: 3 pings → 3 replies ✅/❌
CRLF: no warnings ✅/❌
```

## 9. 交付铁律

**自己 run 全套验证，8 条全绿才发 DONE。**
`[DONE]` 前必须贴上面"自测脚本"的实际输出（replies=1, replies=3 的真实数字）。
