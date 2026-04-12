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
    log(`queued [${id}] model=${model} sys=${system?.length || 0}c usr=${user?.length || 0}c`);
  });
}

function respond(id, text) {
  const entry = _pending.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  _pending.delete(id);
  entry.resolve(text);
  log(`responded [${id}] ${text.length}c`);
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
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
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
      res.writeHead(204).end();  // No pending requests
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
