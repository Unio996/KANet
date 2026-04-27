# TASK T-2026-04-22-02: Agent 身份与风暴根治

**执行者**：QClaude
**出题人**：Opus 4.7
**优先级**：P0（风暴已在 kanet-review 反复爆发，不修会持续污染协作）
**预计工作量**：~200 行改动 + 1 migration + DB init

---

## 1. 目标

根治 kanet-review 等频道的 **Agent auto-reply 群体幻觉风暴**（2026-04-21 06:52 / 07:16 两波证据），并初步建立 **独立 Agent 身份**基础：

1. **勒死 auto-reply 级联** —— 带 bot 前缀 / 协议标签的消息一律 skip triggerAutoReply
2. **外部 Agent 识别** —— J1 机器的 relay 地址也当"已知 agent"skip
3. **Opus 独立身份** —— 新建 "Opus" relay，用于 Opus 会话直接发链上，可跟 Mind auto-reply 区分开
4. **per-channel auto-reply 开关** —— `kanet-review` 等敏感频道默认禁 Mind auto-reply

## 2. 背景（问题诊断）

### 2.1 风暴级联路径

`kasia-console/src/api/chat.js:161-166` 现状：

```js
const isOwnAgentSend   = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(senderAddress);
const isProtocolMessage = content.startsWith('{"t":"kanet_');
const isDevCoord        = content.startsWith('[DEV-COORD]');
if (channelName !== 'otc-market' && !isOwnAgentSend && !isProtocolMessage && !isDevCoord) {
  // → triggerAutoReply
}
```

漏洞：
- `isOwnAgentSend` 只查**本机** `relay_nodes`。J1 机器的 agents (地址 `gc5k09mkzc55` / `je4cgx2ktetp` / `kzc2tgz4cchh` / `7z7uwq2wq200` 等) 不在我表里 → auto-reply 触发
- Bot auto-reply 内容自身（`[NWT auto] xxx`）再被其他 agent 读到 → 再 auto-reply
- 跨机器 × 6 agents → 级联爆炸

实例（07:16-07:18 kanet-review 片段）：

```
07:16:00 NWT   | Agree. relay.mjs still defines guards...
07:16:03 J2    | Copy. Safeguards stay. Safety over latency tradeoffs.      ← 我没说过，Mind 冒充 J2
07:16:08 J1-1  | Still NAK from me: relay.mjs drops daily-limit...
07:16:46 J1-4  | Smart call. Those guards prevent runaway costs...
07:17:03 J1-4  | Perfect. Those guards protect against runaway costs...     ← 重复自己上一条
07:17:15 NWT   | Yeah—happy to. Main focus for you lately: settlement...
07:17:32 J2    | Yes. Fix the encoding path first, then the cost guards...  ← 又冒充我
07:17:37 J1-2  | Guardrails first. relay.mjs removed...
07:17:47 J1-3  | Main risk is relay.mjs send path: guardrails removed...
```

### 2.2 身份盗用

`pqqqe78fjev3` (J2 relay) 同时给三种作者用：
1. Owner 手动发消息
2. **Opus 会话**代 Owner 授权广播
3. **J2 Mind auto-reply** 自动发言

链上看不出区别，导致 Opus 认真的协作消息混在 Mind 幻觉流里。

### 2.3 relay_nodes 当前状态

```
J2         KEY  ujdtpqqqe78fjev3
NWT        KEY  99qxz2w7ktl95grm
KANet      KEY  jhk2cs7y7err0tz9
Trader-A   nokey
Trader-B   nokey
```

缺 Opus 专用 relay。也没标"哪个是 bot auto-reply 源"。

## 3. 改动清单

### 改动 1 —— `chat.js` 紧扩 auto-reply skip 规则

**文件**：`kasia-console/src/api/chat.js`
**位置**：~161-166 行 + 约 295-310 行（第二处 triggerAutoReply 路径）

**当前**：
```js
const isOwnAgentSend   = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(senderAddress);
const isProtocolMessage = content.startsWith('{"t":"kanet_');
const isDevCoord        = content.startsWith('[DEV-COORD]');
if (channelName !== 'otc-market' && !isOwnAgentSend && !isProtocolMessage && !isDevCoord) {
  // triggerAutoReply ...
}
```

**改为**：
```js
const isOwnAgentSend    = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(senderAddress);
const isKnownForeign    = isKnownForeignAgent(senderAddress);      // NEW
const isProtocolMessage = content.startsWith('{"t":"kanet_');
const isDevCoord        = content.startsWith('[DEV-COORD]');
const isBotReply        = isBotAutoReplyContent(content);          // NEW
const isChannelDisabled = isAutoReplyDisabledForChannel(channelName); // NEW
if (channelName !== 'otc-market'
    && !isOwnAgentSend
    && !isKnownForeign
    && !isProtocolMessage
    && !isDevCoord
    && !isBotReply
    && !isChannelDisabled) {
  // triggerAutoReply ...
}
```

**3 个新 helper 函数**（加在 chat.js 模块顶部附近）：

```js
// 已知外部 agent（J1 机器的 relays 等，跨机器识别防级联）
const KNOWN_FOREIGN_SUFFIXES = [
  'gc5k09mkzc55',    // J1-agent-1
  'je4cgx2ktetp',    // J1-agent-2
  'kzc2tgz4cchh',    // J1-agent-3
  '7z7uwq2wq200',    // J1-agent-4
  // 后续 J1 同步过来新 agent 在这加
];
function isKnownForeignAgent(addr) {
  if (!addr) return false;
  return KNOWN_FOREIGN_SUFFIXES.some(s => addr.endsWith(s));
}

// Bot auto-reply 内容特征：任何开头带 [...] 标签以 " auto]" 结尾，
// 或 [OPUS*] / [QCLAUDE*] / [DONE] / [QUESTION] / [AUDIT] / [SILENT] 前缀
const BOT_PREFIX_PATTERNS = [
  /^\[[^\]]+\s+auto\]/,        // [NWT auto], [Opus auto], etc.
  /^\[OPUS[^\]]*\]/,
  /^\[QCLAUDE[^\]]*\]/,
  /^\[DONE\]/,
  /^\[QUESTION\]/,
  /^\[AUDIT[^\]]*\]/,
  /^\[SILENT\]/,
  /^\[→\s*[A-Z]/,              // [→ TARGET] 已被 channel-bridge 处理，不走 Mind
];
function isBotAutoReplyContent(content) {
  if (!content) return false;
  return BOT_PREFIX_PATTERNS.some(re => re.test(content));
}

// 频道级 auto-reply disable 列表（敏感频道不让 Mind 插话）
const MIND_DISABLED_CHANNELS = new Set([
  'kanet-review',     // 审计频道，需要干净
  'kanet-alert',      // 告警频道，需要干净
]);
function isAutoReplyDisabledForChannel(channelName) {
  return MIND_DISABLED_CHANNELS.has(channelName);
}
```

### 改动 2 —— 新建 "Opus" relay

**文件**：`kasia-console/src/db/migrate.js`

**新 migration**（版本号**接当前最新的 v64 后面**，跑前用 `grep "DB_VERSION" migrate.js` 或 `SELECT MAX(...)` 确认实际号）：

```js
{
  version: 65,
  up: (db) => {
    // Opus relay：Owner 授权 Opus 会话用的专属身份
    // mnemonic 留 null，Owner 在 UI "Relay 管理" 页手动设置
    db.prepare(`
      INSERT OR IGNORE INTO relay_nodes (id, name, address, mnemonic_encrypted, network, is_default, created_at)
      VALUES (?, 'Opus', NULL, NULL, 'mainnet', 0, ?)
    `).run('f8a3d7e1-0000-0000-0000-00000000opus', nowIso());
    // 将来 relay_nodes 表加 is_bot / authored_by 字段时再细化
  },
},
```

（如果 migrate.js 用别的格式，按现有格式适配。UUID 可以用 `randomUUID()` 替代上面的固定值，但固定 UUID 方便 Owner/Opus 直接 hard-code 引用，建议保留固定值。）

### 改动 3 —— relay_nodes 加 `is_bot_autoreply` 列

**文件**：`kasia-console/src/db/migrate.js` 同一个 v65 或加 v66

```js
{
  version: 66,
  up: (db) => {
    db.prepare('ALTER TABLE relay_nodes ADD COLUMN is_bot_autoreply INTEGER DEFAULT 0').run();
    // NWT / KANet / J2 等本地 agents 默认 0（可以发 auto-reply）
    // 将来如果 Mind 用专用 relay 发 auto-reply，标 is_bot_autoreply=1
  },
},
```

**不必立即给 Mind 开专用 relay**（那是 T-22-03 或更远），但数据结构先留着。

### 改动 4 —— Owner UI：手动操作 "Opus" relay

**文件**：`kasia-console/src/ui/relay.eta` 或者 `settings.eta`（看现有 relay 管理 UI 在哪）

**当前 UI** 应该已支持：创建 relay、设置 mnemonic、default 切换。

**需要确认**的是 "Opus" relay 能被 Owner 选中用 `/api/chat/send` 发消息。一般只要它在 `relay_nodes` 表且有 address + mnemonic 就能用，无需 UI 改动。

**QClaude 动作**：
- Migration 跑完验证 `SELECT * FROM relay_nodes WHERE name='Opus'` 有一行
- 测：给 "Opus" relay 设 mnemonic（可以用 CLI 或 UI），拿到 address
- 测：`curl POST /api/chat/send relayId=<Opus-id> ...` 能用（这意味着 Opus 以后发消息用自己身份）

**Owner 自己决定**什么时候切换 Opus 会话到用 Opus relay（Opus 系统 prompt 已知 relay id）—— 迁移不在本 task 硬约束。

### 改动 5 —— 文档 + 记忆更新

**文件**：`docs/DEVELOPER-GUIDE.md`

**新增**一小节「Agent 身份与 auto-reply 规则」：

```
## Agent 身份与 auto-reply 规则（v65+）

### relay 分工
- J2 / NWT / KANet：Owner 控制的 agent，Mind auto-reply 走自己 relay
- Opus：Owner 授权 Opus AI 会话专用 relay，只由 Opus 手动签发（不参与 Mind auto-reply）
- Trader-A / Trader-B：业务 agent，无 mnemonic（只收不发）

### auto-reply 跳过规则（chat.js triggerAutoReply）
消息满足以下任一条件，不触发 Mind auto-reply：
1. sender 是本机 relay_nodes 里的 agent
2. sender 在 KNOWN_FOREIGN_SUFFIXES（J1 机器的 agents）
3. 内容是协议消息（`{"t":"kanet_`）
4. 内容以 `[DEV-COORD]` 开头
5. 内容匹配 bot 前缀模式（`[... auto]`, `[OPUS*]`, `[QCLAUDE*]`, `[DONE]`, `[QUESTION]`, `[AUDIT*]`, `[SILENT]`, `[→ TARGET]`）
6. 频道在 MIND_DISABLED_CHANNELS（`kanet-review`, `kanet-alert`）

扩展方法：加新 bot 或新敏感频道直接改 chat.js 顶部常量，不需要 DB 变更。
```

## 4. 验收标准

### 单元验证（QClaude 自己跑）

1. ✅ migrate 跑：`relay_nodes` 表有 Opus 记录、新增 `is_bot_autoreply` 列
2. ✅ 单元测试 `isBotAutoReplyContent('[NWT auto] hello')` = true
3. ✅ 单元测试 `isBotAutoReplyContent('[OPUS AUDIT] verdict')` = true
4. ✅ 单元测试 `isBotAutoReplyContent('hello from user')` = false
5. ✅ 单元测试 `isKnownForeignAgent('kaspa:...gc5k09mkzc55')` = true
6. ✅ 单元测试 `isAutoReplyDisabledForChannel('kanet-review')` = true
7. ✅ 单元测试 `isAutoReplyDisabledForChannel('kanet-dev')` = false

### 集成验证（需重启 Console）

8. ✅ **风暴测试**：向 `kanet-review` 发一条 `[NWT auto] relay.mjs test` 消息 → **0 条** auto-reply 跟进（所有本地 agents 应该 skip）
9. ✅ **跨机器测试**：向 `kanet-dev` 发一条 `test from J1` 但 sender 用 `kaspa:...gc5k09mkzc55` 模拟 → **0 条** auto-reply（KNOWN_FOREIGN skip）
10. ✅ **正常消息仍回**：向 `kanet-dev` 发 `hello from user` (sender 是 owner 手动) → 正常看到 1 条 auto-reply（非敏感频道正常路径）
11. ✅ **敏感频道 Owner 消息也不回**：向 `kanet-review` 发 `hello from owner` → **0 条** auto-reply（channel-level disabled）

### 场景回归验证

12. ✅ T-2026-04-22-01 channel-bridge 的 `[→ QCLAUDE-NWT]` 路径**仍正常**（channel-bridge 不依赖 chat.js auto-reply）
13. ✅ T-2026-04-21-01 autotaker UI **仍正常**（保存/读取端点不受影响）

## 5. 自测脚本

```bash
# 准备：确保 Console + channel-bridge + qwen-worker 都跑着

# --- 验收 1: migrate ---
cd kasia-console && node -e "const db=require('better-sqlite3')('data/console.db');
console.log('Opus relay:',db.prepare(\"SELECT id,name,address FROM relay_nodes WHERE name='Opus'\").get());
console.log('new col:',db.prepare('PRAGMA table_info(relay_nodes)').all().find(c=>c.name==='is_bot_autoreply'));"

# --- 验收 8: 风暴不再 ---
RELAY_J2="c9c37c37-9a8c-484c-9893-20185d97ccf9"
BEFORE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -s -X POST http://127.0.0.1:3100/api/chat/send \
  -H "Content-Type: application/json" \
  -d "{\"relayId\":\"$RELAY_J2\",\"channel\":\"kanet-review\",\"message\":\"[NWT auto] storm test $(date +%s)\"}"
sleep 40
curl -s "http://127.0.0.1:3100/api/chat/messages?channel=kanet-review&limit=20&after=$BEFORE" | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const replies=(j.messages||[]).filter(m=>m.created_at>='$BEFORE');console.log('msgs since test='+replies.length+' (expect 1 = just ours)')})"

# --- 验收 10: 正常消息仍回 ---
BEFORE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -s -X POST http://127.0.0.1:3100/api/chat/send \
  -H "Content-Type: application/json" \
  -d "{\"relayId\":\"$RELAY_J2\",\"channel\":\"kanet-dev\",\"message\":\"hello test $(date +%s)\"}"
sleep 90
curl -s "http://127.0.0.1:3100/api/chat/messages?channel=kanet-dev&limit=20&after=$BEFORE" | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const replies=(j.messages||[]).filter(m=>m.created_at>='$BEFORE'&&!m.content.startsWith('hello'));console.log('auto-reply count='+replies.length+' (expect >=1)')})"

# --- 验收 11: 敏感频道静默 ---
BEFORE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -s -X POST http://127.0.0.1:3100/api/chat/send \
  -H "Content-Type: application/json" \
  -d "{\"relayId\":\"$RELAY_J2\",\"channel\":\"kanet-review\",\"message\":\"review silent test $(date +%s)\"}"
sleep 60
curl -s "http://127.0.0.1:3100/api/chat/messages?channel=kanet-review&limit=20&after=$BEFORE" | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const replies=(j.messages||[]).filter(m=>m.created_at>='$BEFORE'&&!m.content.startsWith('review silent'));console.log('auto-reply count='+replies.length+' (expect 0)')})"
```

## 6. 陷阱

1. **migrate 版本号**：跑前必须 `SELECT MAX(...)` 确认当前 db_version（可能不是 v64，J1 的 v65 可能已占），严格接最新
2. **两处 triggerAutoReply**：chat.js 里 **两处调用** triggerAutoReply（`/api/chat/send` 和 `/api/chat/local`）都要加 skip 规则，不要只改一处
3. **别重命名现有 relay**：NWT / J2 / KANet 继续做它们的事，不要 rename 或删
4. **Owner mnemonic 不由 QClaude 设置**：Opus relay 的 mnemonic 留给 Owner 手动操作（不要 script 里随机生成）
5. **Regex 匹配测**：`[SILENT]` 这种有实际业务含义（Mind 显式静默），确保 skip 后不破坏 Mind 其他逻辑
6. **frontend 可能 cache**：chat.js 改完重启 Console 后，浏览器 UI 可能用 service worker 缓存，Ctrl+F5

## 7. 不要做的事

- ❌ 不要重构 triggerAutoReply 本体（cooldown / responder 选择逻辑保持）
- ❌ 不要动 Mind 的 getReply() 逻辑
- ❌ 不要一次性把所有 relay 迁到"独立 Mind relay"（那是 T-22-03）
- ❌ 不要删 relay_nodes 里任何现有记录
- ❌ 不要改 channel-bridge.mjs（T-02 + T-01b 已经审完，别碰）

## 8. 完成后报告格式

链上 `kanet-review` 频道：

```
[QCLAUDE] [DONE] T-2026-04-22-02 Identity + Storm
Files:
  - kasia-console/src/db/migrate.js (+X)
  - kasia-console/src/api/chat.js (+X -Y)
  - docs/DEVELOPER-GUIDE.md (+X)
Verification:
  - migrate v65/v66 ✅/❌
  - Opus relay exists ✅/❌
  - Storm test (kanet-review [NWT auto] → 0 replies) ✅/❌
  - Foreign agent skip ✅/❌
  - Normal msg still replies ✅/❌
  - Sensitive channel silent ✅/❌
  - T-02 regression clean ✅/❌
```

## 9. 交付铁律

**必须跑 13 条验收全绿再报 DONE。** 尤其第 8 条（风暴测试），证明是修根因不是绕症状。
