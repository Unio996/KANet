# 消息链路修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent 发出消息不入 messages 表的 3 条路径，让通讯录能显示 Agent 说了什么。

**Architecture:** 在 Relay 的 3 个发送点（IPC send_message、DM reply polling、DM reply RPC）添加 ingestMessage() 调用。Console 的 send-command API 改 async 返回 txId。前端加发送反馈。严格遵守调用顺序：sendKaspa → ingestTx → ingestMessage → ingestReply。

**Tech Stack:** Node.js, kasia-relay (ESM), kasia-console (Fastify + Alpine.js)

**必读文档：** `docs/dev-message-pipeline.md` — 调用顺序规则和检查清单

---

## 文件清单

| 动作 | 文件 | 改什么 |
|------|------|--------|
| Modify | `kasia-relay/src/relay.mjs:288-292` | Fix 1: send_message 加 ingestMessage |
| Modify | `kasia-relay/src/relay.mjs:148-152` | Fix 2: DM reply polling 加 ingestMessage |
| Modify | `kasia-relay/src/rpc-listener.mjs:614-618` | Fix 2: DM reply RPC 加 ingestMessage |
| Modify | `kasia-console/src/api/relay.js:991-998` | Fix 3: send-command 改 async |
| Modify | `kasia-console/src/ui/contacts.eta` | Fix 4: 发消息反馈 |
| Create | `scripts/test-message-pipeline.js` | 测试脚本 |

---

### Task 1: Fix 1 — IPC send_message 加 ingestMessage

**Files:**
- Modify: `kasia-relay/src/relay.mjs:288-292`

- [ ] **Step 1: 修改 send_message case**

当前代码（line 288-292）：
```javascript
          draft = await sendMessage({ address: cmd.target, message: cmd.message });
          sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
          ingestTx({ traceId: sent?.txId, txid: sent?.txId, direction: 'outbound', fee: sent?.fee });
          log(`MESSAGE → ${cmd.target?.slice(-12)} TX: ${sent?.txId || '?'} fee: ${sent?.fee || '?'}`);
          break;
```

改为：
```javascript
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
          log(`MESSAGE → ${cmd.target?.slice(-12)} TX: ${sent?.txId || '?'} fee: ${sent?.fee || '?'}`);
          break;
```

`ingestMessage` 已在 line 6 import：`import { ingestMessage, ingestReply, ingestTx, ingestHandshake } from "./ingest.mjs";`

---

### Task 2: Fix 2 — DM reply 两处加 ingestMessage

**Files:**
- Modify: `kasia-relay/src/relay.mjs:148-152`
- Modify: `kasia-relay/src/rpc-listener.mjs:614-618`

- [ ] **Step 1: relay.mjs DM reply 路径**

当前代码（line 148-152）：
```javascript
        const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
        log("TX SENT:", sent?.txId || sent);
        ingestTx({ traceId: msg.txId, txid: sent?.txId, direction: "outbound", fee: sent?.fee });
        ingestReply({ traceId: msg.txId, replyText, sentTxid: sent?.txId || null });
        if (attempts > 0) log(`Reply sent after ${attempts + 1} attempts (${text.length} chars)`);
```

改为（在 ingestTx 和 ingestReply 之间插入 ingestMessage）：
```javascript
        const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
        log("TX SENT:", sent?.txId || sent);
        ingestTx({ traceId: msg.txId, txid: sent?.txId, direction: "outbound", fee: sent?.fee });
        ingestMessage({
          traceId: `reply-out:${sent?.txId || msg.txId}`,
          direction: 'outbound',
          localAddress: localAddress,
          remoteAddress: peer,
          txid: sent?.txId,
          messageType: 'text',
          contentText: text,
        });
        ingestReply({ traceId: msg.txId, replyText, sentTxid: sent?.txId || null });
        if (attempts > 0) log(`Reply sent after ${attempts + 1} attempts (${text.length} chars)`);
```

注意：`contentText: text`（不是 `replyText`）— `text` 是经过截断重试后实际发出的文本。

- [ ] **Step 2: rpc-listener.mjs DM reply 路径**

当前代码（line 614-618）：
```javascript
      const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
      log('TX SENT:', sent?.txId || sent, 'fee:', sent?.fee);
      ingestTx({ traceId: txId, txid: sent?.txId, direction: 'outbound', fee: sent?.fee });
      ingestReply({ traceId: txId, replyText, sentTxid: sent?.txId || null });
      if (attempts > 0) log(`Reply sent after ${attempts + 1} attempts (${text.length} chars)`);
```

改为：
```javascript
      const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
      log('TX SENT:', sent?.txId || sent, 'fee:', sent?.fee);
      ingestTx({ traceId: txId, txid: sent?.txId, direction: 'outbound', fee: sent?.fee });
      ingestMessage({
        traceId: `reply-out:${sent?.txId || txId}`,
        direction: 'outbound',
        localAddress: _myAddress,
        remoteAddress: senderAddress,
        txid: sent?.txId,
        messageType: 'text',
        contentText: text,
      });
      ingestReply({ traceId: txId, replyText, sentTxid: sent?.txId || null });
      if (attempts > 0) log(`Reply sent after ${attempts + 1} attempts (${text.length} chars)`);
```

注意：用 `_myAddress`（rpc-listener 的本地地址变量）和 `senderAddress`（对方地址）。

---

### Task 3: Fix 3 — send-command API 改 async

**Files:**
- Modify: `kasia-console/src/api/relay.js:8,991-998`

- [ ] **Step 1: 加 import sendCommandAsync**

line 8 从：
```javascript
import { sendCommand } from '../services/relay-manager.js';
```
改为：
```javascript
import { sendCommand, sendCommandAsync } from '../services/relay-manager.js';
```

- [ ] **Step 2: send-command 路由改 async**

line 991-998 从：
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
      return reply.code(503).send({ ok: false, error: err.message || 'Relay command failed' });
    }
  });
```

---

### Task 4: Fix 4 — 通讯录发消息反馈

**Files:**
- Modify: `kasia-console/src/ui/contacts.eta`

- [ ] **Step 1: 加 sendStatus 状态变量**

在 contactsPage() return 对象中，找到 `sending: false,`，在后面加：
```javascript
    sendStatus: '',
```

- [ ] **Step 2: 修改 sendMsg 方法**

当前：
```javascript
    async sendMsg(p) {
      if (!this.quickMsg.trim()) return;
      this.sending = true;
      try {
        await fetch('/api/relay/' + this.selectedAgent + '/send-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'send_message', target: p.peer, message: this.quickMsg.trim() }),
        });
        this.quickMsg = '';
        setTimeout(() => this.loadDetail(p.peer), 2000);
      } catch (e) { console.error('send failed:', e); }
      this.sending = false;
    },
```

改为：
```javascript
    async sendMsg(p) {
      if (!this.quickMsg.trim()) return;
      this.sending = true;
      this.sendStatus = '';
      try {
        const res = await fetch('/api/relay/' + this.selectedAgent + '/send-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'send_message', target: p.peer, message: this.quickMsg.trim() }),
        });
        const data = await res.json();
        if (data.ok) {
          this.sendStatus = '已发送 ✓';
          this.quickMsg = '';
          setTimeout(() => { this.loadDetail(p.peer); this.sendStatus = ''; }, 3000);
        } else {
          this.sendStatus = '失败: ' + (data.error || '未知错误');
        }
      } catch (e) {
        this.sendStatus = '发送失败';
      }
      this.sending = false;
    },
```

- [ ] **Step 3: 快捷发消息框加状态显示**

找到快捷发消息的 HTML 区块中的发送按钮：
```html
              <button @click="sendMsg(p)" class="btn btn-primary btn-sm text-[10px]" :disabled="!quickMsg.trim() || sending">
                <span x-text="sending ? '发送中...' : '发送'"></span>
              </button>
```

在这个 `</button>` 后面加：
```html
              <span class="text-[10px] ml-1" :class="sendStatus.includes('✓') ? 'text-green-600' : 'text-red-500'" x-text="sendStatus"></span>
```

---

### Task 5: 测试脚本

**Files:**
- Create: `scripts/test-message-pipeline.js`

- [ ] **Step 1: 编写测试脚本**

```javascript
#!/usr/bin/env node
/**
 * 消息链路测试 — 验证 Agent 发出的消息正确入库
 * 运行: cd D:/Anthropic/kasia-console && NODE_PATH=./node_modules node ../scripts/test-message-pipeline.js
 */
const Database = require('better-sqlite3');
const db = new Database('data/console.db');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}: ${detail || 'FAILED'}`); fail++; }
}

const agents = db.prepare('SELECT name, address FROM relay_nodes WHERE address IS NOT NULL').all();

console.log('=== 测试 1: replies vs messages outbound 数量对比 ===');
for (const a of agents) {
  const replies = db.prepare(`
    SELECT COUNT(*) as c FROM replies r
    JOIN conversations c ON c.id = r.conversation_id
    JOIN identities li ON li.id = c.local_identity_id
    WHERE li.address = ?
  `).get(a.address);
  const msgsOut = db.prepare(`
    SELECT COUNT(*) as c FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN identities li ON li.id = c.local_identity_id
    WHERE li.address = ? AND m.direction = 'outbound' AND m.message_type = 'text'
  `).get(a.address);
  const ratio = replies.c > 0 ? (msgsOut.c / replies.c * 100).toFixed(1) : '0';
  console.log(`  ${a.name}: replies=${replies.c} msgs_out_text=${msgsOut.c} (${ratio}%)`);
  // 修复后新数据应该接近 1:1，但历史数据会拉低比率
}

console.log('\n=== 测试 2: send-command API 返回 txId ===');
// 验证 API 签名（不实际发消息，只检查路由存在）
const http = require('http');
const checkApi = () => new Promise((resolve) => {
  const req = http.request({ hostname: '127.0.0.1', port: 3100, path: '/api/relay/nonexistent/send-command', method: 'POST',
    headers: { 'Content-Type': 'application/json' } }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.write(JSON.stringify({ type: 'send_message', target: 'test', message: 'test' }));
  req.end();
});
checkApi().then(r => {
  // 应返回 503（Relay not running）而非 200 { ok: true }（fire-and-forget）
  check('send-command API 返回错误而非盲目 ok:true', r.status === 503 || r.body.includes('error'), `status=${r.status} body=${r.body.slice(0,60)}`);

  console.log('\n=== 测试 3: ingestMessage traceId 唯一性 ===');
  // 检查 messages 表有无 reply-out: 或 msg-out: 前缀的 traceId（修复后才会有）
  const replyOutMsgs = db.prepare("SELECT COUNT(*) as c FROM messages WHERE trace_id LIKE 'reply-out:%'").get().c;
  const msgOutMsgs = db.prepare("SELECT COUNT(*) as c FROM messages WHERE trace_id LIKE 'msg-out:%'").get().c;
  console.log(`  reply-out: ${replyOutMsgs} 条, msg-out: ${msgOutMsgs} 条`);
  console.log(`  (修复后新消息才会有这些前缀，数量会随时间增长)`);

  console.log('\n=== 测试 4: chain_events comm_sent 记录 ===');
  const commSent = db.prepare("SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'comm_sent'").get().c;
  console.log(`  comm_sent 记录: ${commSent} 条`);

  console.log('\n=== 测试 5: replies.sent_txid 有值比例 ===');
  const total = db.prepare('SELECT COUNT(*) as c FROM replies').get().c;
  const withTx = db.prepare('SELECT COUNT(*) as c FROM replies WHERE sent_txid IS NOT NULL').get().c;
  console.log(`  total=${total} with_txid=${withTx} (${(withTx/total*100).toFixed(1)}%)`);
  console.log(`  (修复后新 replies 应有 sent_txid，历史数据为 NULL)`);

  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail > 0 ? 1 : 0);
}).catch(e => { console.error('API test failed:', e.message); process.exit(1); });
```

- [ ] **Step 2: 运行测试建立基线**

```bash
cd D:/Anthropic/kasia-console && NODE_PATH=./node_modules node ../scripts/test-message-pipeline.js
```

- [ ] **Step 3: 重启系统，再次运行测试**

```bash
cd D:/Anthropic && bash kanet-stop.sh && bash kanet-start.sh
# 等启动完成后
cd D:/Anthropic/kasia-console && NODE_PATH=./node_modules node ../scripts/test-message-pipeline.js
```

- [ ] **Step 4: 手动验证 — 通讯录发消息**

1. 打开 http://127.0.0.1:3100/contacts
2. 选一个已握手的联系人，展开
3. 在快捷发消息框输入 "pipeline test"，点发送
4. 应看到"已发送 ✓"提示
5. 3 秒后行为明细刷新，应看到刚发的消息（→ outbound text "pipeline test"）
