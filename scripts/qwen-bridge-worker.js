#!/usr/bin/env node
/**
 * qwen-bridge-worker.js — Qwen3.6 auto-poll Bridge, replaces manual Claude Code poll
 *
 * Architecture:
 *   Agent Mind → Adapter → cc-bridge.mjs (9100) → request queue
 *   This script → GET /cc/pending?queue=<name>  → picks up requests
 *               → Qwen3.6 (localhost:8000)       → thinks
 *               → POST /cc/respond/:id           → submits response
 *
 * Usage:
 *   node scripts/qwen-bridge-worker.js                   (default: qclaude-nwt queue)
 *   node scripts/qwen-bridge-worker.js --queue=opus      (opus queue)
 *   node scripts/qwen-bridge-worker.js --queue=qclaude-kanet
 *
 * Environment:
 *   BRIDGE_URL    — Bridge address (default http://127.0.0.1:9100)
 *   QWEN_URL      — llama-server address (default http://127.0.0.1:8000)
 *   POLL_INTERVAL — Poll interval ms (default 2000)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:9100';
const QWEN_URL = process.env.QWEN_URL || 'http://127.0.0.1:8000';
const POLL_MS = parseInt(process.env.POLL_INTERVAL || '2000');
const MAX_TOKENS = 4096;

// Parse --queue argument
const queueArg = process.argv.find(a => a.startsWith('--queue='));
const QUEUE_NAME = queueArg ? queueArg.split('=')[1] : 'qclaude-nwt';

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

// ── HTTP helpers ─────────────────────────────────────────────────────────

function httpGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.get({
      hostname: parsed.hostname, port: parsed.port,
      path: parsed.pathname + parsed.search, timeout,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(url, body, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
      hostname: parsed.hostname, port: parsed.port, path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout,
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

// ── Qwen3.6 call via Ollama ─────────────────────────────────────────────

async function askQwen(system, user) {
  return new Promise((resolve, reject) => {
    const systemMsg = system ? system + RULES_PREFIX : '';
    const userInput = user;

    // Use claude headless via LiteLLM (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN)
    const messages = [];
    if (systemMsg) messages.push({ role: 'system', content: systemMsg });
    messages.push({ role: 'user', content: userInput });

    const body = JSON.stringify({
      model: 'Qwythos-9B-Claude-Mythos-5-1M-Q4_K_M.gguf',
      messages,
      max_tokens: MAX_TOKENS,
      temperature: 0.3,
      // kill switch: Qwen3.6 /no_think 前缀无效, 必须 body 加 chat_template_kwargs
      // 关了 reasoning 后: content 直接返, 速度 8x (8s → 1s), 不再浪费 tokens 在推理过程
      chat_template_kwargs: { enable_thinking: false },
    });

    const startMs = Date.now();
    httpPost(`${QWEN_URL}/v1/chat/completions`, body, 300000)
      .then(({ status, body: resBody }) => {
        if (status !== 200) return reject(new Error(`Qwen returned ${status}: ${resBody.slice(0, 100)}`));
        const data = JSON.parse(resBody);
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
        resolve(content);
      })
      .catch(reject);
  });
}

// ── Main poll loop ──────────────────────────────────────────────────────

let running = true;
let busyCount = 0;
let idleCount = 0;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

async function pollOnce() {
  try {
    const { status, body } = await httpGet(`${BRIDGE_URL}/cc/pending?queue=${QUEUE_NAME}`);

    if (status === 204) {
      // No pending requests
      idleCount++;
      if (idleCount % 30 === 0) log(`idle (${idleCount} polls, ${busyCount} served)`);
      consecutiveFailures = 0;
      return;
    }

    if (status !== 200) {
      log(`Bridge returned ${status}: ${body.slice(0, 100)}`);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        log(`FATAL: ${consecutiveFailures} consecutive failures, exiting`);
        running = false;
      }
      return;
    }

    consecutiveFailures = 0;
    const task = JSON.parse(body);
    log(`Got task [${task.id}] queue=${task.queue} age=${task.age_ms}ms sys=${(task.system || '').length}c usr=${(task.user || '').length}c`);

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
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      log(`FATAL: ${consecutiveFailures} consecutive failures, exiting`);
      running = false;
    }
  }
}

async function mainLoop() {
  log(`Starting Qwen3.6 Bridge Worker`);
  log(`Queue:  ${QUEUE_NAME}`);
  log(`Bridge: ${BRIDGE_URL}`);
  log(`Qwen:   ${QWEN_URL}`);
  log(`Poll:   every ${POLL_MS}ms`);
  log(`Failures before exit: ${MAX_CONSECUTIVE_FAILURES}`);
  log('');

  while (running) {
    await pollOnce();
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

process.on('SIGINT', () => { running = false; log('Shutting down...'); });
process.on('SIGTERM', () => { running = false; log('Shutting down...'); });

mainLoop().catch(err => { log('FATAL:', err.message); process.exit(1); });
