#!/usr/bin/env node
/**
 * qwen-bridge-worker.js — Qwen3.6 自动轮询 Bridge，替代 Claude Code 手动 poll
 *
 * 架构：
 *   Agent Mind → Adapter → cc-bridge.mjs (9100) → 请求队列
 *   本脚本    → GET /cc/pending          → 拿请求
 *             → Qwen3.6 (localhost:8000)  → 思考
 *             → POST /cc/respond/:id      → 提交回复
 *
 * 用法：
 *   node scripts/qwen-bridge-worker.js
 *
 * 环境变量：
 *   BRIDGE_URL    — Bridge 地址（默认 http://localhost:9100）
 *   QWEN_URL      — llama-server 地址（默认 http://localhost:8000）
 *   POLL_INTERVAL — 轮询间隔毫秒（默认 2000）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:9100';
const QWEN_URL = process.env.QWEN_URL || 'http://localhost:8000';
const POLL_MS = parseInt(process.env.POLL_INTERVAL || '2000');
const MAX_TOKENS = 4096;

// Load QWEN-RULES if available
let RULES_PREFIX = '';
const rulesPath = path.join(__dirname, '..', 'QWEN-RULES.md');
if (fs.existsSync(rulesPath)) {
  RULES_PREFIX = '\n\n## Development Rules:\n' + fs.readFileSync(rulesPath, 'utf8');
  log(`Loaded QWEN-RULES.md (${RULES_PREFIX.length} chars)`);
}

function log(...args) {
  console.log(new Date().toLocaleString(undefined, { hour12: false }), '[qwen-worker]', ...args);
}

// ── HTTP helpers ──

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    http.get({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
      hostname: parsed.hostname, port: parsed.port, path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 180000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

// ── Qwen3.6 call ──

async function askQwen(system, user) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system + RULES_PREFIX });
  messages.push({ role: 'user', content: user });

  const body = JSON.stringify({
    model: 'Qwen3.6-35B-A3B',
    messages,
    max_tokens: MAX_TOKENS,
    temperature: 0.3
  });

  const startMs = Date.now();
  const res = await httpPost(`${QWEN_URL}/v1/chat/completions`, body);
  const data = JSON.parse(res.body);
  const elapsed = Date.now() - startMs;

  let content = data.choices?.[0]?.message?.content || '';
  // Fallback to reasoning_content
  if (!content && data.choices?.[0]?.message?.reasoning_content) {
    content = data.choices[0].message.reasoning_content;
  }
  // Strip thinking tags
  content = content.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

  const tokens = data.usage?.completion_tokens || 0;
  log(`Qwen replied: ${tokens} tok, ${elapsed}ms, ${content.length} chars`);

  return content;
}

// ── Main poll loop ──

let running = true;
let busyCount = 0;
let idleCount = 0;

async function pollOnce() {
  try {
    const { status, body } = await httpGet(`${BRIDGE_URL}/cc/pending`);

    if (status === 204) {
      // No pending requests
      idleCount++;
      if (idleCount % 30 === 0) log(`idle (${idleCount} polls, ${busyCount} served)`);
      return;
    }

    if (status !== 200) {
      log(`Bridge returned ${status}: ${body.slice(0, 100)}`);
      return;
    }

    const task = JSON.parse(body);
    log(`Got task [${task.id}] age=${task.age_ms}ms sys=${(task.system || '').length}c usr=${(task.user || '').length}c`);

    // Ask Qwen3.6
    const reply = await askQwen(task.system, task.user);

    if (!reply) {
      log(`WARNING: Qwen returned empty for [${task.id}], sending fallback`);
      const fallback = 'I apologize, but I was unable to generate a response. Please try again.';
      await httpPost(`${BRIDGE_URL}/cc/respond/${task.id}`, { text: fallback });
      return;
    }

    // Submit response to Bridge
    const respondRes = await httpPost(`${BRIDGE_URL}/cc/respond/${task.id}`, { text: reply });
    if (respondRes.status === 200) {
      busyCount++;
      log(`Delivered [${task.id}] ✓ (total: ${busyCount})`);
    } else {
      log(`Deliver failed [${task.id}]: ${respondRes.status} ${respondRes.body.slice(0, 100)}`);
    }

  } catch (err) {
    if (err.message !== 'timeout') {
      log(`Poll error: ${err.message}`);
    }
  }
}

async function mainLoop() {
  log('Starting Qwen3.6 Bridge Worker');
  log(`Bridge: ${BRIDGE_URL}`);
  log(`Qwen:   ${QWEN_URL}`);
  log(`Poll:   every ${POLL_MS}ms`);
  log('');

  while (running) {
    await pollOnce();
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

process.on('SIGINT', () => { running = false; log('Shutting down...'); });
process.on('SIGTERM', () => { running = false; log('Shutting down...'); });

mainLoop().catch(err => { log('FATAL:', err.message); process.exit(1); });
