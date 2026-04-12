# Claude Code Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bridge server that lets Claude Code become an Agent's AI brain through the Adapter, enabling direct Claude-Code-to-Claude-Code collaboration across KANet nodes.

**Architecture:** A lightweight Node.js HTTP server (`cc-bridge.mjs`) acts as an OpenAI-compatible AI provider. The Adapter connects to it like any other provider. Incoming Mind tasks are queued; Claude Code polls for pending tasks, processes them with full codebase access, and submits responses. The bridge returns responses to the Adapter, completing the Mind → Adapter → Claude Code → Agent loop.

**Tech Stack:** Node.js (native http module, no dependencies), existing Adapter OpenAI provider, existing Console adapter_nodes DB.

```
Agent Mind → Adapter (openai provider) → Bridge (localhost:9100)
                                              ↕ HTTP poll/respond
                                         Claude Code (via Bash/scripts)
```

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/cc-bridge.mjs` | **Create** | Bridge HTTP server: OpenAI endpoint + Claude Code poll/respond API |
| `scripts/cc-poll.mjs` | **Create** | Claude Code helper: poll for pending request, display context |
| `scripts/cc-respond.mjs` | **Create** | Claude Code helper: submit response for a pending request |
| `agent-adapter/src/providers/index.mjs` | **No change** | Already supports openai provider pointing to any URL |
| `kasia-console/src/services/adapter-launcher.js` | **No change** | Already passes `AI_PROVIDER_URL` to adapter process |

**Key design decision:** We do NOT create a new Adapter provider. The existing `openai` provider already talks to any OpenAI-compatible endpoint (llama-server, Ollama, vLLM — all proven). The bridge exposes `POST /v1/chat/completions` and the openai provider handles it natively. Zero Adapter code changes.

---

### Task 1: Bridge Server Core

**Files:**
- Create: `scripts/cc-bridge.mjs`

The bridge is a standalone HTTP server (~120 lines) with three endpoints:
1. `POST /v1/chat/completions` — receives Adapter requests, queues them, waits for response
2. `GET /cc/pending` — Claude Code polls for next pending request
3. `POST /cc/respond/:id` — Claude Code submits response

- [ ] **Step 1: Create the bridge server**

```javascript
// scripts/cc-bridge.mjs
// Claude Code Bridge — makes Claude Code an Agent's AI brain via Adapter.
//
// Architecture:
//   Adapter (openai provider) → POST /v1/chat/completions → this server → queue
//   Claude Code               → GET  /cc/pending          → reads queue
//   Claude Code               → POST /cc/respond/:id      → submits response → unblocks Adapter
//
// Usage:
//   node scripts/cc-bridge.mjs [port]       (default: 9100)
//
// Adapter config:
//   AI_PROVIDER=openai  AI_PROVIDER_URL=http://localhost:9100/v1  AI_MODEL=claude-code

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = parseInt(process.argv[2] || '9100');
const TIMEOUT_MS = 300_000; // 5 min — Claude Code may need time to think

// ── Request Queue ────────────────────────────────────────────────────────

const _pending = new Map();  // id → { system, user, model, resolve, reject, createdAt }

function enqueue(system, user, model) {
  const id = randomUUID().slice(0, 8);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _pending.delete(id);
      reject(new Error('Bridge timeout: Claude Code did not respond within 5 minutes'));
    }, TIMEOUT_MS);

    _pending.set(id, { id, system, user, model, resolve, reject, timer, createdAt: Date.now() });
    log(`📥 queued [${id}] model=${model} sys=${system?.length || 0}c usr=${user?.length || 0}c`);
  });
}

function respond(id, text) {
  const entry = _pending.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  _pending.delete(id);
  entry.resolve(text);
  log(`📤 responded [${id}] ${text.length}c`);
  return true;
}

function getNextPending() {
  for (const [id, entry] of _pending) {
    return { id, system: entry.system, user: entry.user, model: entry.model, age_ms: Date.now() - entry.createdAt };
  }
  return null;
}

// ── HTTP Server ──────────────────────────────────────────────────────────

function log(...args) {
  console.log(new Date().toLocaleString(undefined, { hour12: false }), '[cc-bridge]', ...args);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 2_000_000) reject(new Error('too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

async function handleRequest(req, res) {
  const { method, url } = req;

  // ── Adapter → Bridge: OpenAI-compatible chat completions ──
  if (method === 'POST' && url === '/v1/chat/completions') {
    const body = JSON.parse(await readBody(req));
    const messages = body.messages || [];
    const system = messages.find(m => m.role === 'system')?.content || '';
    const user = messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
    const model = body.model || 'claude-code';

    try {
      const reply = await enqueue(system, user, model);
      // Return OpenAI-compatible response
      json(res, 200, {
        id: `chatcmpl-${randomUUID().slice(0, 8)}`,
        object: 'chat.completion',
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    } catch (err) {
      json(res, 504, { error: { message: err.message, type: 'timeout' } });
    }
    return;
  }

  // ── Claude Code → Bridge: poll for pending request ──
  if (method === 'GET' && url === '/cc/pending') {
    const next = getNextPending();
    if (!next) {
      json(res, 204, null);  // No pending requests
    } else {
      json(res, 200, next);
    }
    return;
  }

  // ── Claude Code → Bridge: submit response ──
  if (method === 'POST' && url?.startsWith('/cc/respond/')) {
    const id = url.split('/').pop();
    const body = JSON.parse(await readBody(req));
    const text = body.text || body.reply || '';
    if (!text) { json(res, 400, { error: 'text is required' }); return; }
    const ok = respond(id, text);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'request not found or already responded' });
    return;
  }

  // ── Status ──
  if (method === 'GET' && url === '/cc/status') {
    const pending = [];
    for (const [id, e] of _pending) {
      pending.push({ id, model: e.model, age_ms: Date.now() - e.createdAt, user_preview: e.user?.slice(0, 100) });
    }
    json(res, 200, { pending_count: _pending.size, pending });
    return;
  }

  // ── Health (Adapter checks this) ──
  if (method === 'GET' && (url === '/health' || url === '/')) {
    json(res, 200, { ok: true, provider: 'claude-code-bridge', pending: _pending.size });
    return;
  }

  json(res, 404, { error: 'not found' });
}

// ── Start ────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    log('ERROR', err.message);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  log(`Bridge server listening on port ${PORT}`);
  log(`Adapter config: AI_PROVIDER=openai AI_PROVIDER_URL=http://localhost:${PORT} AI_MODEL=claude-code`);
  log(`Claude Code:    GET  http://localhost:${PORT}/cc/pending`);
  log(`                POST http://localhost:${PORT}/cc/respond/:id`);
  log('');
  log('Waiting for requests...');
});
```

- [ ] **Step 2: Test bridge starts successfully**

Run: `node scripts/cc-bridge.mjs &`
Expected: Output shows "Bridge server listening on port 9100"

Run: `curl -s http://localhost:9100/health`
Expected: `{"ok":true,"provider":"claude-code-bridge","pending":0}`

- [ ] **Step 3: Test OpenAI-compatible endpoint responds**

Run (in a new terminal):
```bash
curl -s -X POST http://localhost:9100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"test","messages":[{"role":"system","content":"You are helpful"},{"role":"user","content":"Hello"}]}' &

# Bridge should queue the request. Check pending:
sleep 1 && curl -s http://localhost:9100/cc/pending
```
Expected: `{"id":"<8-char>","system":"You are helpful","user":"Hello","model":"test","age_ms":...}`

Respond:
```bash
# Use the id from above
curl -s -X POST http://localhost:9100/cc/respond/<id> \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from Claude Code!"}'
```
Expected: The curl process from step 1 completes with `{"choices":[{"message":{"content":"Hello from Claude Code!"}}...]}`

- [ ] **Step 4: Commit**

```bash
git add scripts/cc-bridge.mjs
git commit -m "feat: Claude Code Bridge server — makes Claude Code an Agent brain via Adapter"
```

---

### Task 2: Claude Code Helper Scripts

**Files:**
- Create: `scripts/cc-poll.mjs`
- Create: `scripts/cc-respond.mjs`

These are thin wrappers Claude Code calls via Bash to interact with the bridge.

- [ ] **Step 1: Create poll script**

```javascript
// scripts/cc-poll.mjs
// Poll the Claude Code Bridge for the next pending Mind task.
// Usage: node scripts/cc-poll.mjs [bridge-url]
// Returns: JSON with { id, system, user, model } or empty if none pending.

const BRIDGE = (process.argv[2] || 'http://localhost:9100').replace(/\/+$/, '');

try {
  const res = await fetch(`${BRIDGE}/cc/pending`);
  if (res.status === 204) {
    console.log('No pending requests.');
    process.exit(0);
  }
  const data = await res.json();
  console.log(`\n=== PENDING REQUEST [${data.id}] (${data.age_ms}ms ago) ===`);
  console.log(`Model: ${data.model}`);
  if (data.system) {
    console.log(`\n--- SYSTEM (${data.system.length} chars) ---`);
    console.log(data.system.slice(0, 2000));
    if (data.system.length > 2000) console.log(`\n... (${data.system.length - 2000} more chars)`);
  }
  console.log(`\n--- USER (${data.user.length} chars) ---`);
  console.log(data.user.slice(0, 3000));
  if (data.user.length > 3000) console.log(`\n... (${data.user.length - 3000} more chars)`);
  console.log(`\n=== To respond: node scripts/cc-respond.mjs ${data.id} "your response" ===`);
} catch (err) {
  console.error('Bridge unreachable:', err.message);
  process.exit(1);
}
```

- [ ] **Step 2: Create respond script**

```javascript
// scripts/cc-respond.mjs
// Submit a response to the Claude Code Bridge for a pending Mind task.
// Usage: node scripts/cc-respond.mjs <request-id> <response-text>
//    or: echo "response" | node scripts/cc-respond.mjs <request-id> -

const BRIDGE = (process.env.CC_BRIDGE_URL || 'http://localhost:9100').replace(/\/+$/, '');

const id = process.argv[2];
let text = process.argv.slice(3).join(' ');

if (!id) {
  console.error('Usage: node cc-respond.mjs <request-id> <response-text>');
  console.error('   or: echo "text" | node cc-respond.mjs <request-id> -');
  process.exit(1);
}

// Read from stdin if "-" is the text argument
if (text === '-' || !text) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  text = Buffer.concat(chunks).toString('utf8').trim();
}

if (!text) {
  console.error('Error: empty response text');
  process.exit(1);
}

try {
  const res = await fetch(`${BRIDGE}/cc/respond/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (data.ok) {
    console.log(`Response submitted for [${id}] (${text.length} chars)`);
  } else {
    console.error('Error:', data.error);
    process.exit(1);
  }
} catch (err) {
  console.error('Bridge unreachable:', err.message);
  process.exit(1);
}
```

- [ ] **Step 3: Test poll → respond round-trip**

Terminal 1 (simulate Adapter):
```bash
curl -s -X POST http://localhost:9100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-code","messages":[{"role":"system","content":"Test system"},{"role":"user","content":"Test user message"}]}'
```

Terminal 2 (simulate Claude Code):
```bash
node scripts/cc-poll.mjs
# Note the request id from output
node scripts/cc-respond.mjs <id> "This is my response from Claude Code"
```

Expected: Terminal 1 receives the OpenAI-compatible response with "This is my response from Claude Code"

- [ ] **Step 4: Commit**

```bash
git add scripts/cc-poll.mjs scripts/cc-respond.mjs
git commit -m "feat: Claude Code poll/respond helper scripts for bridge interaction"
```

---

### Task 3: Configure Adapter to Use Bridge

**Files:**
- No code changes — configuration only via Console DB

This task connects a real Agent's Adapter to the bridge. We use the existing `openai` provider pointing to `localhost:9100`.

- [ ] **Step 1: Identify a test Agent's adapter**

```bash
# List current adapter nodes
node -e "
  const Database = require('better-sqlite3');
  const db = new Database('D:/Anthropic/kasia-console/data/console.db');
  const rows = db.prepare('SELECT id, name, http_port, ai_provider, ai_provider_url, ai_model, is_enabled FROM adapter_nodes').all();
  console.table(rows);
"
```

Pick one Agent to test with (e.g., Martin's adapter). Note its `id` and current settings.

- [ ] **Step 2: Update adapter to point to bridge**

```bash
# Save original settings first (for rollback)
node -e "
  const Database = require('better-sqlite3');
  const db = new Database('D:/Anthropic/kasia-console/data/console.db');
  const id = '<ADAPTER_ID>';  // from step 1
  const row = db.prepare('SELECT ai_provider, ai_provider_url, ai_model FROM adapter_nodes WHERE id = ?').get(id);
  console.log('ORIGINAL:', JSON.stringify(row));
  console.log('Save this for rollback!');
"

# Update to use bridge
node -e "
  const Database = require('better-sqlite3');
  const db = new Database('D:/Anthropic/kasia-console/data/console.db');
  const id = '<ADAPTER_ID>';
  db.prepare('UPDATE adapter_nodes SET ai_provider = ?, ai_provider_url = ?, ai_model = ? WHERE id = ?')
    .run('openai', 'http://localhost:9100', 'claude-code', id);
  // Also update the connection record
  db.prepare('UPDATE agent_connections SET base_url = ?, model = ?, provider = ? WHERE adapter_node_id = ?')
    .run('http://localhost:9100', 'claude-code', 'openai', id);
  console.log('Updated. Restart adapter from Console UI or restart KANet.');
"
```

- [ ] **Step 3: Restart the adapter**

From Console UI: go to `/adapters`, click restart on the test Agent's adapter.
Or restart KANet: `bash kanet-stop.sh && bash kanet-start.sh`

Verify adapter connects to bridge:
```bash
curl -s http://localhost:9100/cc/status
```
Expected: `{"pending_count":0,"pending":[]}`

- [ ] **Step 4: Document rollback procedure**

To revert the adapter back to its original provider:
```bash
node -e "
  const Database = require('better-sqlite3');
  const db = new Database('D:/Anthropic/kasia-console/data/console.db');
  const id = '<ADAPTER_ID>';
  db.prepare('UPDATE adapter_nodes SET ai_provider = ?, ai_provider_url = ?, ai_model = ? WHERE id = ?')
    .run('<ORIGINAL_PROVIDER>', '<ORIGINAL_URL>', '<ORIGINAL_MODEL>', id);
  db.prepare('UPDATE agent_connections SET base_url = ?, model = ?, provider = ? WHERE adapter_node_id = ?')
    .run('<ORIGINAL_URL>', '<ORIGINAL_MODEL>', '<ORIGINAL_PROVIDER>', id);
  console.log('Reverted. Restart adapter.');
"
```

---

### Task 4: End-to-End Verification

**Files:** None — verification only

Verify the complete loop: someone sends a message to the Agent → Mind builds context → Adapter sends to bridge → Claude Code reads and responds → Agent replies.

- [ ] **Step 1: Ensure bridge is running**

```bash
node scripts/cc-bridge.mjs &
```

- [ ] **Step 2: Send a test message to the Agent**

From Console UI chat (or via API):
```bash
# Send a DM to the test Agent (simulating an external user)
curl -s -X POST http://localhost:3100/api/chat/send \
  -H "Content-Type: application/json" \
  -d '{"relayId":"<RELAY_NODE_ID>","channel":"kanet-public","message":"Hello Agent, this is a bridge test"}'
```

Or send from another Agent via the chat UI.

- [ ] **Step 3: Check bridge received the Mind task**

```bash
node scripts/cc-poll.mjs
```

Expected: Shows the pending request with:
- `system`: Full Mind context (identity, goals, memory, connections, skills — the complete prompt Mind builds)
- `user`: The message that triggered the reactive task
- `id`: The request ID to respond to

- [ ] **Step 4: Respond as Claude Code**

```bash
node scripts/cc-respond.mjs <id> "Hello! I am Claude Code acting as this Agent's brain through the bridge. The connection is working."
```

Expected:
- The Agent sends this response back to the chat
- The message appears in the broadcast channel or DM conversation
- Bridge log shows `📤 responded [<id>]`

- [ ] **Step 5: Verify the complete chain**

Check the chat UI — the Agent's response should appear as a normal message. Check Console logs for the Mind → Adapter → Bridge → response chain.

```bash
curl -s http://localhost:9100/cc/status
```
Expected: `{"pending_count":0,"pending":[]}` (no stuck requests)

---

### Task 5: Commit and Document

**Files:**
- Modify: `docs/DEVELOPER-GUIDE.md` (add section about Claude Code Bridge)

- [ ] **Step 1: Add bridge documentation to DEVELOPER-GUIDE**

Add after the existing Section 一 (System Architecture), under the Adapter section:

```markdown
### Claude Code Bridge (scripts/cc-bridge.mjs)

**Claude Code 作为 Agent 大脑：** Bridge 让 Claude Code 通过 Adapter 成为 Agent 的 AI 大脑。

```
Mind → Adapter (openai provider) → Bridge (localhost:9100) → 请求队列
                                                                 ↕
                                                Claude Code poll/respond
```

**启动：** `node scripts/cc-bridge.mjs [port]`（默认 9100）

**Adapter 配置：** adapter_nodes 表设置 `ai_provider='openai'`, `ai_provider_url='http://localhost:9100'`, `ai_model='claude-code'`

**Claude Code 端：**
- 查看待处理请求：`node scripts/cc-poll.mjs`
- 提交回复：`node scripts/cc-respond.mjs <id> "response text"`
- 查看状态：`curl http://localhost:9100/cc/status`

**跨节点协作：** 两个 KANet 节点各自运行 bridge + Claude Code。Agent 间通过链上消息通信，每个 Agent 的大脑是 Claude Code。Claude Code 实例通过 Agent 协议自动中转协作。

**回滚：** 在 Console DB 把 adapter_nodes 的 ai_provider/url/model 改回原值，重启 adapter。
```

- [ ] **Step 2: Commit everything**

```bash
git add scripts/cc-bridge.mjs scripts/cc-poll.mjs scripts/cc-respond.mjs scripts/send-dev.mjs
git commit -m "feat: Claude Code Bridge — Claude Code 通过 Adapter 成为 Agent AI 大脑

- cc-bridge.mjs: OpenAI-compatible bridge server (localhost:9100)
- cc-poll.mjs / cc-respond.mjs: Claude Code 交互脚本
- Adapter 零改动，复用 openai provider 指向 bridge
- 跨节点协作：两个 Claude Code 通过 Agent 协议自动中转"
```

---

## Rollback Plan

1. Stop bridge: kill the `node scripts/cc-bridge.mjs` process
2. Revert DB: restore adapter_nodes to original ai_provider/url/model
3. Restart adapter from Console UI
4. Agent resumes using original AI provider (GPT/Qwen/etc.)

No code changes to existing files = zero risk to running system.

## Future Extensions (not in scope today)

- **Auto-poll mode**: Bridge notifies Claude Code when request arrives (WebSocket or file watch)
- **Multi-agent**: Bridge supports multiple concurrent requests with priority queue
- **Context passthrough**: Claude Code helper shows Mind context in structured format
- **Persistent bridge**: Integrate into `kanet-start.sh` as optional component
- **Proactive Claude Code**: Claude Code initiates actions through the Agent (not just responds)
