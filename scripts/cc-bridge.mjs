// scripts/cc-bridge.mjs
// Claude Code Bridge — makes Claude Code an Agent's AI brain via Adapter.
//
// Architecture:
//   Adapter (openai provider) → POST /v1/chat/completions → this server → queue
//   Claude Code               → GET  /cc/pending          → reads queue
//   Claude Code               → POST /cc/respond/:id      → submits response → unblocks Adapter
//   channel-bridge            → POST /v1/chat/completions + X-Queue → route to agent queue
//
// No fallback. No degradation. Claude Code IS the brain, or there is no brain.
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

// ── State ────────────────────────────────────────────────────────────────

let _lastPollAt = 0;   // timestamp of last Claude Code poll
let _totalServed = 0;  // total requests served by Claude Code

function isClaudeCodeActive() {
  return (Date.now() - _lastPollAt) < 30_000;  // active if polled in last 30s
}

// ── Request Queue (multi-queue) ──────────────────────────────────────────

const _queues = new Map(); // queueName → Map<id, entry>

function _getQueue(name) {
  if (!_queues.has(name)) _queues.set(name, new Map());
  return _queues.get(name);
}

function enqueue(system, user, model, queueName = 'default') {
  const id = randomUUID().slice(0, 8);
  const q = _getQueue(queueName);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      q.delete(id);
      reject(new Error('Bridge timeout: Claude Code did not respond within 5 minutes'));
    }, TIMEOUT_MS);

    q.set(id, { id, system, user, model, resolve, reject, timer, createdAt: Date.now(), queue: queueName });
    const status = isClaudeCodeActive() ? 'CC online' : 'CC offline — waiting';
    log(`queued [${id}] queue=${queueName} ${status} sys=${system?.length || 0}c usr=${user?.length || 0}c`);
  });
}

function respond(id, text) {
  // Search all queues (id is global UUID)
  for (const [, entries] of _queues) {
    const entry = entries.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      entries.delete(id);
      entry.resolve(text);
      _totalServed++;
      log(`responded [${id}] queue=${entry.queue} ${text.length}c (${Date.now() - entry.createdAt}ms)`);
      return true;
    }
  }
  return false;
}

function getNextPending(queueName) {
  const q = _getQueue(queueName || 'default');
  for (const [, entry] of q) {
    return { id: entry.id, system: entry.system, user: entry.user, model: entry.model, age_ms: Date.now() - entry.createdAt, queue: entry.queue };
  }
  return null;
}

function queueStatus(queueName) {
  const q = _getQueue(queueName || 'default');
  const pending = [];
  for (const [, e] of q) {
    pending.push({ id: e.id, model: e.model, queue: e.queue, age_ms: Date.now() - e.createdAt, user_preview: e.user?.slice(0, 100) });
  }
  return pending;
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
  const { method, url, headers } = req;

  // ── Adapter / channel-bridge → Bridge: OpenAI-compatible chat completions ──
  if (method === 'POST' && url === '/v1/chat/completions') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
    const messages = body.messages || [];
    const system = messages.find(m => m.role === 'system')?.content || '';
    const user = messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
    const model = body.model || 'claude-code';
    const queueName = (headers['x-queue'] || '').toString().trim() || 'default';

    try {
      const reply = await enqueue(system, user, model, queueName);
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
  if (method === 'GET' && url?.startsWith('/cc/pending')) {
    const urlObj = new URL(url, `http://127.0.0.1:${PORT}`);
    _lastPollAt = Date.now();
    const queueName = urlObj.searchParams.get('queue') || 'default';
    const next = getNextPending(queueName);
    if (!next) {
      res.writeHead(204).end();
    } else {
      json(res, 200, next);
    }
    return;
  }

  // ── Claude Code → Bridge: submit response ──
  if (method === 'POST' && url?.startsWith('/cc/respond/')) {
    const id = url.split('/').pop();
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
    const text = body.text || body.reply || '';
    if (!text) { json(res, 400, { error: 'text is required' }); return; }
    const ok = respond(id, text);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'request not found or already responded' });
    return;
  }

  // ── Status (per-queue) ──
  if (method === 'GET' && url === '/cc/status') {
    const urlObj = new URL(url, `http://127.0.0.1:${PORT}`);
    const filterQueue = urlObj.searchParams.get('queue') || null;

    const allQueues = {};
    for (const [name, entries] of _queues) {
      if (filterQueue && name !== filterQueue) continue;
      allQueues[name] = {
        pending_count: entries.size,
        pending: Array.from(entries.values()).map(e => ({
          id: e.id, queue: e.queue, model: e.model,
          age_ms: Date.now() - e.createdAt,
          user_preview: e.user?.slice(0, 100),
        })),
      };
    }
    json(res, 200, {
      cc_active: isClaudeCodeActive(),
      last_poll_ago_ms: _lastPollAt ? Date.now() - _lastPollAt : null,
      total_served: _totalServed,
      queues: allQueues,
    });
    return;
  }

  // ── Health ──
  if (method === 'GET' && (url === '/health' || url === '/')) {
    const totalPending = Array.from(_queues.values()).reduce((s, q) => s + q.size, 0);
    json(res, 200, {
      ok: true,
      provider: 'claude-code-bridge',
      cc_active: isClaudeCodeActive(),
      total_served: _totalServed,
      pending: totalPending,
    });
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
  log(`No fallback. Claude Code IS the brain, or there is no brain.`);
  log(`Claude Code:  GET  http://localhost:${PORT}/cc/pending`);
  log(`              POST http://localhost:${PORT}/cc/respond/:id`);
  log('Waiting for Claude Code...');
});
