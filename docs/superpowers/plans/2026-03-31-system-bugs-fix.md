# 系统性 Bug 修复 + 链上行为标签编辑

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复三个数据断链 Bug，让链上行为页面能看到完整双向对话内容，并支持对地址进行标签编辑。

**Architecture:**
- Bug 1 (sent_txid NULL): Relay 发消息后 IPC 返回 txid，Console 侧在 chat.js 的 triggerAutoReply 和 DM 回复路径中回填 replies.sent_txid
- Bug 2 (Agent 外发不入 chain_events): 在 Console 侧收到 Relay 的发送确认后，主动调用 recordChainEvent 写一条 out 事件
- Bug 3 (comm+text 双重记录): 不删数据，在查询时用 DISTINCT txid 去重计数
- 标签编辑: audit.eta 展开行加编辑按钮，调用已有的 /api/contacts/update

**Tech Stack:** Node.js, better-sqlite3, Alpine.js, Eta templates

---

## 文件清单

| 动作 | 文件 | 职责 |
|------|------|------|
| 修改 | `kasia-console/src/api/chat.js` | Bug 1+2: triggerAutoReply 发送后回填 sent_txid + 写 chain_event |
| 修改 | `kasia-console/src/services/ingest-service.js` | Bug 1: handleIngestReply 接收 sentTxid 参数 |
| 修改 | `kasia-relay/src/relay.mjs` | Bug 1+2: DM 回复路径 ingestReply 传 txid |
| 修改 | `kasia-console/src/services/anti-spam.js` | Bug 3: getActivityByPeer 去重计数 |
| 修改 | `kasia-console/src/ui/audit.eta` | 标签编辑 + 地址完整显示 |
| 测试 | `scripts/test-system-bugs.js` | 系统性测试脚本 |

---

### Task 1: Bug 1 修复 — chat.js 广播回复路径回填 sent_txid

**Files:**
- Modify: `kasia-console/src/api/chat.js` (triggerAutoReply 函数，约 line 260-319)
- Modify: `kasia-console/src/data/state/replies.js` (updateReplyStatus 函数)

**根因:** chat.js triggerAutoReply 里：
1. line 270 调用 getReply() 拿到回复文本
2. line 290 调用 sendCommandAsync() 拿到 result.txId
3. line 313-316 把 txId 存进 broadcast_messages.tx_hash
4. **但从未调用 updateReplyStatus() 把 txId 写回 replies.sent_txid**

- [ ] **Step 1: 找到 triggerAutoReply 中回复发送成功的位置**

在 chat.js 中，sendCommandAsync 成功后、存 broadcast_messages 之后，需要找到对应的 reply ID。
问题：当前 getReply() 只返回文本，不返回 reply ID。

查 mind-manager.js 的 getReply 返回值，确认是否能改为返回 { text, replyId }。

- [ ] **Step 2: 修改 mind-manager.js getReply 返回 replyId**

在 mind-manager.js `_processQueue` 函数中，handleMessage 返回后，查 replies 表找到刚创建的 reply 记录的 ID。

```javascript
// _processQueue 中，reply 生成后
const replyRow = sqlite.prepare(
  "SELECT id FROM replies WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1"
).get(convId);
task.resolve({ text: reply, replyId: replyRow?.id || null });
```

注意：如果改 getReply 返回类型会影响所有调用方。更安全的方式是在 chat.js 侧通过 traceId 查 reply。

**替代方案（更安全）：** 在 chat.js 发送成功后，通过时间窗口找到刚创建的 reply，回填 txid：

```javascript
// chat.js triggerAutoReply, sendCommandAsync 成功后
if (result.txId) {
  // 找到最近的 reply（5 秒内创建的，对应这个 conversation）
  const recentReply = sqlite.prepare(
    "SELECT id FROM replies WHERE conversation_id = ? AND created_at > datetime('now', '-5 seconds') ORDER BY created_at DESC LIMIT 1"
  ).get(convId);
  if (recentReply) {
    sqlite.prepare("UPDATE replies SET sent_txid = ?, status = 'sent', updated_at = ? WHERE id = ?")
      .run(result.txId, new Date().toISOString(), recentReply.id);
  }
}
```

- [ ] **Step 3: 在 chat.js triggerAutoReply 中实现回填**

在 `sendCommandAsync` 成功返回后，`sqlite.prepare("INSERT ... broadcast_messages")` 之后添加：

```javascript
// 回填 replies.sent_txid（Bug 1 修复）
if (result.txId) {
  const conv = sqlite.prepare(
    "SELECT c.id FROM conversations c JOIN identities li ON li.id = c.local_identity_id WHERE li.address = (SELECT address FROM relay_nodes WHERE id = ?)"
  ).get(responder.relay_id);
  if (conv) {
    const recentReply = sqlite.prepare(
      "SELECT id FROM replies WHERE conversation_id = ? AND sent_txid IS NULL ORDER BY created_at DESC LIMIT 1"
    ).get(conv.id);
    if (recentReply) {
      sqlite.prepare("UPDATE replies SET sent_txid = ?, status = 'sent', updated_at = ? WHERE id = ?")
        .run(result.txId, new Date().toISOString(), recentReply.id);
    }
  }
}
```

- [ ] **Step 4: 测试 Bug 1 修复**

```bash
# 发送一条测试消息
curl -X POST http://127.0.0.1:3100/api/chat/send -H "Content-Type: application/json" \
  -d '{"relayId":"b236f45f-15df-440a-b0b7-991aeef9b1a4","channel":"general","message":"test bug1 fix"}'

# 等待 5 秒让 Agent 回复
sleep 5

# 检查最新的 reply 是否有 sent_txid
cd kasia-console && node -e "
const db = require('better-sqlite3')('data/console.db');
const r = db.prepare('SELECT id, sent_txid, reply_text, created_at FROM replies ORDER BY created_at DESC LIMIT 1').get();
console.log('最新 reply:');
console.log('  sent_txid:', r.sent_txid || 'NULL ← 仍然是 bug');
console.log('  text:', r.reply_text?.slice(0,60));
console.log('  time:', r.created_at);
"
```

Expected: sent_txid 不为 NULL

- [ ] **Step 5: Commit**

```bash
git add kasia-console/src/api/chat.js
git commit -m "fix: backfill replies.sent_txid after broadcast send (bug1)"
```

---

### Task 2: Bug 1 修复 — Relay DM 回复路径传 txid

**Files:**
- Modify: `kasia-relay/src/relay.mjs` (DM reply 路径，约 line 130-155)

**根因:** relay.mjs 的 DM 回复路径（send_message case）调用 ingestReply() 但不传 txid：
```javascript
ingestReply({ traceId: msg.txId, replyText }); // ← 没传 txid
```

- [ ] **Step 1: 修改 relay.mjs DM reply 路径**

找到 relay.mjs 中 `case 'send_message'` 的处理逻辑，在 ingestReply 调用后，添加：

```javascript
// 发送成功后，通知 Console 回填 sent_txid
if (sent?.txId) {
  ingestReply({ traceId: msg.txId, replyText, sentTxid: sent.txId });
}
```

- [ ] **Step 2: 修改 Relay 的 ingestReply 函数接收 sentTxid**

File: `kasia-relay/src/ingest.mjs`

```javascript
export function ingestReply({ traceId, replyText, status = "sent", sentTxid = null }) {
  post("/ingest/reply", {
    traceId,
    replyType: "ai",
    provider: "openclaw",
    replyText,
    status,
    sentTxid,  // 新增
  });
}
```

- [ ] **Step 3: Console 侧 handleIngestReply 接收 sentTxid**

File: `kasia-console/src/services/ingest-service.js`

在 handleIngestReply 中，insertReply 时传入 sentTxid：

```javascript
const replyId = await insertReply({
  ...existingParams,
  sentTxid: payload.sentTxid || null,  // 新增
});
```

- [ ] **Step 4: 测试**

通过 Relay 发一条 DM，检查 replies.sent_txid 是否有值。

- [ ] **Step 5: Commit**

```bash
git add kasia-relay/src/relay.mjs kasia-relay/src/ingest.mjs kasia-console/src/services/ingest-service.js
git commit -m "fix: pass sent_txid through Relay→Console ingest path (bug1 DM)"
```

---

### Task 3: Bug 2 修复 — Agent 外发消息写入 chain_events

**Files:**
- Modify: `kasia-console/src/api/chat.js` (triggerAutoReply)
- Use: `kasia-console/src/services/chain-event.js` (recordChainEvent)

**根因:** Agent 发出消息后，Scout 只从 Agent 地址的收件箱扫，扫不到 Agent 发给外部人的 TX。需要在 Console 侧主动记录。

- [ ] **Step 1: 在 chat.js 导入 recordChainEvent**

```javascript
import { recordChainEvent } from '../services/chain-event.js';
```

- [ ] **Step 2: triggerAutoReply 发送成功后写 chain_event**

在 sendCommandAsync 成功后添加：

```javascript
// Bug 2 修复：Agent 外发消息写入 chain_events
if (result.txId) {
  const relayAddr = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(responder.relay_id)?.address;
  if (relayAddr) {
    recordChainEvent({
      txid: result.txId,
      eventType: 'comm_sent',
      fromAddress: relayAddr,
      toAddress: null, // 广播没有特定目标
      observedBy: 'console',
      payload: JSON.stringify({ channel: channelName, length: broadcastText.length }),
    });
  }
}
```

注意：对于 DM（非广播），toAddress 应该是 peer 地址。需要区分广播和 DM。

- [ ] **Step 3: Relay send-command 的 DM 路径也写 chain_event**

在 relay.mjs 的 send_message case，发送成功后通过 ingestTx 已经在写（line 152），但 eventType 是 'tx'。
改为在 Console 侧写更精确的 'comm_sent' 事件。

方案：在 Console 的 `/api/relay/:id/send-command` 路由处理中，收到 Relay 返回的 txId 后写 chain_event。

- [ ] **Step 4: 测试**

```bash
# 触发一条外发消息，检查 chain_events 是否有 comm_sent 记录
cd kasia-console && node -e "
const db = require('better-sqlite3')('data/console.db');
const recent = db.prepare(\"SELECT * FROM chain_events WHERE event_type = 'comm_sent' ORDER BY observed_at DESC LIMIT 3\").all();
console.log('comm_sent 记录:', recent.length);
for (const r of recent) console.log(r.observed_at, r.from_address?.slice(-8), '→', r.to_address?.slice(-8));
"
```

- [ ] **Step 5: Commit**

```bash
git add kasia-console/src/api/chat.js
git commit -m "fix: write chain_event for Agent outbound messages (bug2)"
```

---

### Task 4: Bug 3 处理 — comm+text 去重计数

**Files:**
- Modify: `kasia-console/src/services/anti-spam.js` (getActivityByPeer)

**说明:** comm 和 text 是设计如此（Scout 记 comm，Relay 记 text），不需要删数据。但在 UI 统计时要去重。

- [ ] **Step 1: getActivityByPeer 用 DISTINCT txid 去重**

```javascript
// 修改 getActivityByPeer 的 SQL
const stats = sqlite.prepare(`
  SELECT
    CASE WHEN ce.from_address = ? THEN ce.to_address ELSE ce.from_address END as peer,
    SUM(CASE WHEN ce.from_address = ? THEN 1 ELSE 0 END) as out_count,
    SUM(CASE WHEN ce.to_address = ? THEN 1 ELSE 0 END) as in_count,
    COUNT(*) as total,
    COUNT(DISTINCT ce.txid) as unique_total,
    MIN(ce.observed_at) as first_ts,
    MAX(ce.observed_at) as last_ts,
    GROUP_CONCAT(DISTINCT ce.event_type) as types
  FROM chain_events ce
  WHERE ...
`);
```

返回时用 `unique_total` 替代 `total`，或者两个都返回让前端决定。

- [ ] **Step 2: audit.eta 显示去重后的数字**

前端显示 `unique_total` 而非 `total`。

- [ ] **Step 3: 测试**

对比 Martin 的去重前后数字：去重前 ~7300，去重后应该 ~3800。

- [ ] **Step 4: Commit**

```bash
git add kasia-console/src/services/anti-spam.js kasia-console/src/ui/audit.eta
git commit -m "fix: deduplicate comm+text counts in activity stats (bug3)"
```

---

### Task 5: 链上行为页面 — 地址标签编辑

**Files:**
- Modify: `kasia-console/src/ui/audit.eta`

- [ ] **Step 1: 每个联系人摘要行加编辑按钮**

在展开的联系人行右侧加一个编辑图标，点击展开标签+备注编辑区。

- [ ] **Step 2: 编辑区 UI**

```html
<!-- 在展开内容区顶部加编辑栏 -->
<div class="flex items-center gap-2 px-4 py-2 bg-warm-50 border-b border-warm-100">
  <input x-model="editTag" placeholder="添加标签..." class="text-xs border border-warm-300 rounded px-2 py-1 w-32"
    @keydown.enter.prevent="saveTag(p)" />
  <button @click="saveTag(p)" class="btn btn-primary btn-sm text-[10px]">保存标签</button>
  <input x-model="editNote" placeholder="备注..." class="text-xs border border-warm-300 rounded px-2 py-1 flex-1"
    @keydown.enter.prevent="saveNote(p)" />
  <button @click="saveNote(p)" class="btn btn-ghost btn-sm text-[10px]">保存备注</button>
</div>
```

- [ ] **Step 3: JS 方法调用 /api/contacts/update**

```javascript
async saveTag(p) {
  if (!this.editTag.trim() || !p.identity_id) return;
  const newTags = p.tags ? p.tags + ',' + this.editTag.trim() : this.editTag.trim();
  await fetch('/api/contacts/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: p.identity_id, tags: newTags }),
  });
  this.editTag = '';
  await this.load();
}
```

- [ ] **Step 4: getActivityByPeer 返回 identity_id**

anti-spam.js 的 getActivityByPeer 补充返回 identity.id，让前端能调 /api/contacts/update。

- [ ] **Step 5: 地址完整显示**

audit.eta 中地址只显示了 `...` + 后 14 位。添加点击复制完整地址功能：

```html
<div class="text-[10px] text-ink-300 font-mono cursor-pointer"
  @click.stop="navigator.clipboard.writeText(p.peer)"
  title="点击复制完整地址"
  x-text="'...' + p.peer.slice(-16)"></div>
```

- [ ] **Step 6: 测试**

1. 打开 /audit，展开一个联系人
2. 输入标签，点保存，确认标签出现
3. 输入备注，点保存
4. 刷新页面，确认标签和备注持久化
5. 点击地址，确认剪贴板有完整地址

- [ ] **Step 7: Commit**

```bash
git add kasia-console/src/ui/audit.eta kasia-console/src/services/anti-spam.js
git commit -m "feat: add tag/note editing and full address copy in audit page"
```

---

### Task 6: 系统性测试 + 审计验收

**Files:**
- Create: `scripts/test-system-bugs.js`

- [ ] **Step 1: 编写系统测试脚本**

```javascript
// scripts/test-system-bugs.js
// 自动验证三个 Bug 的修复状态

const Database = require('better-sqlite3');
const db = new Database('kasia-console/data/console.db');

let pass = 0, fail = 0;
function check(name, condition) {
  if (condition) { console.log('✓ ' + name); pass++; }
  else { console.log('✗ FAIL: ' + name); fail++; }
}

// Bug 1: replies.sent_txid 不再全是 NULL
const totalReplies = db.prepare('SELECT COUNT(*) as c FROM replies').get().c;
const withTxid = db.prepare('SELECT COUNT(*) as c FROM replies WHERE sent_txid IS NOT NULL').get().c;
check('Bug1: 有 sent_txid 的 replies > 0', withTxid > 0);
console.log('  replies 总数: ' + totalReplies + ', 有 txid: ' + withTxid);

// Bug 2: chain_events 有 comm_sent（Agent 外发记录）
const commSent = db.prepare("SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'comm_sent'").get().c;
check('Bug2: chain_events 有 comm_sent 记录', commSent > 0);
console.log('  comm_sent 记录数: ' + commSent);

// Bug 3: getActivityByPeer 的去重
const agents = db.prepare('SELECT address FROM relay_nodes WHERE address IS NOT NULL').all();
for (const a of agents) {
  const raw = db.prepare('SELECT COUNT(*) as c FROM chain_events WHERE from_address = ? OR to_address = ?').get(a.address, a.address).c;
  const unique = db.prepare('SELECT COUNT(DISTINCT txid) as c FROM chain_events WHERE from_address = ? OR to_address = ?').get(a.address, a.address).c;
  const dupeRate = ((1 - unique / raw) * 100).toFixed(1);
  console.log('  ' + a.address.slice(-12) + ': raw=' + raw + ' unique=' + unique + ' 重复率=' + dupeRate + '%');
}

// 完整性: 每个外部对话都有双向内容
const externalPeers = db.prepare(`
  SELECT DISTINCT CASE WHEN from_address IN (SELECT address FROM relay_nodes) THEN to_address ELSE from_address END as peer
  FROM chain_events
  WHERE from_address IN (SELECT address FROM relay_nodes) OR to_address IN (SELECT address FROM relay_nodes)
`).all().filter(r => r.peer && !agents.some(a => a.address === r.peer)).map(r => r.peer);

let hasContent = 0, noContent = 0;
for (const peer of externalPeers) {
  // 有 replies 内容的
  const conv = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN identities li ON li.id = c.local_identity_id
    JOIN identities ri ON ri.id = c.remote_identity_id
    WHERE ri.address = ?
  `).get(peer);
  if (conv) {
    const reps = db.prepare('SELECT COUNT(*) as c FROM replies WHERE conversation_id = ? AND reply_text IS NOT NULL').get(conv.id).c;
    if (reps > 0) hasContent++; else noContent++;
  } else noContent++;
}
check('外部对话有 Agent 回复内容', hasContent > 0);
console.log('  有回复内容: ' + hasContent + ', 无: ' + noContent);

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: 运行测试**

```bash
node scripts/test-system-bugs.js
```

修复前预期：Bug1 FAIL, Bug2 FAIL。修复后全部 PASS。

- [ ] **Step 3: 人工验收清单**

1. 打开 /audit 选每个 Agent
2. 确认总数与 Agent 概览页数字一致
3. 点开外部联系人，确认能看到双向对话（Agent 说了什么 + 对方说了什么）
4. 点开内部联系人（Agent 间），确认有内容
5. 编辑某个联系人的标签，刷新确认持久化
6. 确认地址可复制

- [ ] **Step 4: Commit**

```bash
git add scripts/test-system-bugs.js
git commit -m "test: system bug verification script"
```
