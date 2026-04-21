// channel-bridge.mjs — Channel ↔ Bridge Dispatcher
//
// Bridges 7 KANet dev channels into cc-bridge.mjs multi-queue.
//   [→ TARGET] tagged messages → route to agent queue → Bridge reply → back to chain
//
// Usage:
//   node scripts/channel-bridge.mjs                  (uses default config)
//   node scripts/channel-bridge.mjs --config path.json
//   node scripts/channel-bridge.mjs status
//   node scripts/channel-bridge.mjs stop
//
// Config: scripts/channel-bridge.config.json

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ───────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  consoleUrl: 'http://127.0.0.1:3100',
  bridgeUrl:  'http://127.0.0.1:9100',
  relayId:    '5b236c08-03d0-456c-953d-e10001610938',
  senderTag:  '[NWT auto]',
  pollMs:     4000,
  queues: {
    'QCLAUDE-NWT': 'qclaude-nwt',
    'NWT':         'qclaude-nwt',
    'OPUS':        'opus',
  },
  channels: ['dev-coord','kanet-dev','kanet-arch','kanet-frontend','kanet-backend','kanet-review','kanet-alert'],
};

function loadConfig() {
  const cfgPath = process.argv.find(a => a.startsWith('--config='))
    || process.argv.find(a => a.startsWith('--config'));
  if (cfgPath) {
    const p = cfgPath.split('=')[1] || cfgPath.split(' ')[1];
    if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  const defaultPath = path.join(__dirname, 'channel-bridge.config.json');
  if (fs.existsSync(defaultPath)) return JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
  return DEFAULT_CONFIG;
}

const CFG = loadConfig();

// ── Processed log (anti-loop) ────────────────────────────────────────────

const PROCESSED_FILE = path.join(__dirname, 'channel-bridge.processed.jsonl');
const processedSet = new Set();
const inflight = new Set(); // tx_hash currently being processed (prevents dedup race during long bridge waits)

if (fs.existsSync(PROCESSED_FILE)) {
  const lines = fs.readFileSync(PROCESSED_FILE, 'utf8').split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      // Skip entries older than 2 hours on startup
      if (Date.now() - new Date(entry.ts).getTime() < 2 * 3600 * 1000) {
        processedSet.add(entry.tx_hash);
      }
    } catch {}
  }
}

function markProcessed(txHash) {
  processedSet.add(txHash);
  const line = JSON.stringify({ tx_hash: txHash, channel: '', ts: new Date().toISOString() }) + '\n';
  fs.appendFileSync(PROCESSED_FILE, line, 'utf8');
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

function httpPost(url, body, timeout = 300000) {
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

// ── Tag parsing ──────────────────────────────────────────────────────────

// 1. [→ TARGET]  (preferred) — handle both real arrow and garbled → ?
const TAG_PATTERN1 = /\[→?\s*([A-Z][A-Z0-9-]*)\]/;
// 2. [SENDER → TARGET]  (legacy) — handle both real arrow and garbled
const TAG_PATTERN2 = /\[[A-Z0-9-]+\s*→?\s*([A-Z][A-Z0-9-]*)\]/;
// 3. Fallback: garbled arrow ? (UTF-8 corruption of →)
const TAG_PATTERN1_GARBLED = /\[\?\s*([A-Z][A-Z0-9-]*)\]/;
const TAG_PATTERN2_GARBLED = /\[[A-Z0-9-]+\s*\?\s*([A-Z][A-Z0-9-]*)\]/;

function extractTarget(message) {
  if (!message) return null;
  const m1 = message.match(TAG_PATTERN1);
  if (m1) return m1[1];
  const m2 = message.match(TAG_PATTERN2);
  if (m2) return m2[1];
  const m3 = message.match(TAG_PATTERN1_GARBLED);
  if (m3) return m3[1];
  const m4 = message.match(TAG_PATTERN2_GARBLED);
  if (m4) return m4[1];
  return null;
}

// ── Message fetching ─────────────────────────────────────────────────────

const lastTsMap = {}; // channel → ISO timestamp

function loadLastTimestamps() {
  const stateFile = path.join(__dirname, 'channel-bridge.lastts.json');
  if (fs.existsSync(stateFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      Object.assign(lastTsMap, data);
    } catch {}
  }
}

function saveLastTimestamps() {
  const stateFile = path.join(__dirname, 'channel-bridge.lastts.json');
  fs.writeFileSync(stateFile, JSON.stringify(lastTsMap, null, 2), 'utf8');
}

async function fetchNewMessages(channel, afterTs) {
  const url = `${CFG.consoleUrl}/api/chat/messages?channel=${encodeURIComponent(channel)}&limit=30`;
  try {
    const { status, body } = await httpGet(url);
    if (status !== 200) return [];
    const data = JSON.parse(body);
    return (data.messages || []).filter(m => {
      if (processedSet.has(m.tx_hash)) return false;
      if (inflight.has(m.tx_hash)) return false; // NEW: prevent dedup race during bridge wait
      if (afterTs && m.created_at <= afterTs) return false;
      return true;
    });
  } catch {
    return [];
  }
}

// ── Process single message ──────────────────────────────────────────────

async function processMessage(msg) {
  if (inflight.has(msg.tx_hash)) return; // safety net: already processing same tx
  inflight.add(msg.tx_hash);
  try {
    const target = extractTarget(msg.content);
    if (!target) return; // skip non-targeted messages

    const queueName = CFG.queues[target];
    if (!queueName) {
      console.log(new Date().toLocaleString(undefined, { hour12: false }), '[ch-bridge]',
        `WARN: no queue for target ${target}, skipping`);
      return;
    }

    console.log(new Date().toLocaleString(undefined, { hour12: false }), '[ch-bridge]',
      `routing [${msg.tx_hash?.slice(0, 8)}] to queue=${queueName} target=${target} channel=${msg.channel_name}`);

    try {
      const reply = await bridgeRoute(msg, target, queueName);
      if (reply) {
        await sendReply(msg.channel_name, reply);
        markProcessed(msg.tx_hash);
      }
    } catch (err) {
      console.error(new Date().toLocaleString(undefined, { hour12: false }), '[ch-bridge]',
        `ERROR processing [${msg.tx_hash?.slice(0, 8)}]:`, err.message);
      if (err.message.includes('timeout')) {
        await sendReply(msg.channel_name, '(timeout)');
        markProcessed(msg.tx_hash);
      }
    }
  } finally {
    inflight.delete(msg.tx_hash); // always release; failed ones can retry next poll
  }
}

async function bridgeRoute(msg, target, queueName) {
  const system = `You are an automated assistant on the KANet Agent Network Layer. Reply concisely to the user's question.`;
  const user = msg.content;

  const url = `${CFG.bridgeUrl}/v1/chat/completions`;
  const payload = JSON.stringify({
    model: 'claude-code',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const req = await new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const r = http.request({
      hostname: parsed.hostname, port: parsed.port, path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Queue': queueName,
      },
      timeout: 300000,
    }, (res) => resolve(res));
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.write(payload);
    r.end();
  });

  let data = '';
  req.on('data', c => data += c);
  await new Promise((resolve, reject) => {
    req.on('end', resolve);
    req.on('error', reject);
    req.setTimeout(300000, () => { reject(new Error('timeout')); });
  });

  const parsed = JSON.parse(data);
  return parsed.choices?.[0]?.message?.content;
}

async function sendReply(channel, text) {
  const prefix = CFG.senderTag;
  const content = text.length > 5000 ? text.slice(0, 4997) + '...' : text;
  const message = `${prefix} ${content}`;

  const url = `${CFG.consoleUrl}/api/chat/send`;
  const payload = JSON.stringify({
    relayId: CFG.relayId,
    channel,
    message,
  });

  const res = await httpPost(url, payload);
  const data = JSON.parse(res.body);
  console.log(new Date().toLocaleString(undefined, { hour12: false }), '[ch-bridge]',
    `reply sent to ${channel}: ${message.slice(0, 80)}...`);
  return data;
}

// ── Main poll loop ──────────────────────────────────────────────────────

let running = true;
let processedCount = 0;

loadLastTimestamps();

async function pollLoop() {
  console.log(new Date().toLocaleString(undefined, { hour12: false }), '[ch-bridge]',
    `starting on ${CFG.channels.length} channels, poll=${CFG.pollMs}ms`);

  while (running) {
    for (const channel of CFG.channels) {
      if (!running) break;
      const after = lastTsMap[channel] || null;
      const messages = await fetchNewMessages(channel, after);

      for (const msg of messages) {
        if (!running) break;
        try {
          await processMessage(msg);
          processedCount++;
        } catch (err) {
          console.error('[ch-bridge] processMessage error:', err.message);
        }
      }

      if (messages.length > 0) {
        const last = messages[messages.length - 1].created_at;
        if (!after || last > after) {
          lastTsMap[channel] = last;
          saveLastTimestamps();
        }
      }
    }

    await new Promise(r => setTimeout(r, CFG.pollMs));
  }
}

// ── CLI commands ─────────────────────────────────────────────────────────

async function cliMain() {
  if (process.argv.includes('status')) {
    const { status, body } = await httpGet(`${CFG.bridgeUrl}/cc/status`);
    if (status === 200) console.log(JSON.stringify(JSON.parse(body), null, 2));
    else console.error(`Bridge status failed: ${status}`);
    process.exit(0);
  }

  if (process.argv.includes('stop')) {
    const pidFile = path.join(__dirname, 'channel-bridge.pid');
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`Sent SIGTERM to PID ${pid}`);
      } catch {
        console.log(`Process ${pid} not found`);
      }
    }
    process.exit(0);
  }

  fs.writeFileSync(path.join(__dirname, 'channel-bridge.pid'), String(process.pid), 'utf8');

  process.on('SIGINT', () => { running = false; console.log('[ch-bridge] Shutting down...'); });
  process.on('SIGTERM', () => { running = false; console.log('[ch-bridge] Shutting down...'); });

  pollLoop().catch(err => { console.error('[ch-bridge] FATAL:', err.message); process.exit(1); });
}

cliMain();
