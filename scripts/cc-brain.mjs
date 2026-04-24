#!/usr/bin/env node
// cc-brain.mjs — Real Claude Code brain polling Bridge.
// Each pending → spawn `claude --print` headless → reply → POST back.
// Test-phase daemon. Stateless per-request. Serial by default.

import { spawn } from 'node:child_process';

const BRIDGE = process.env.CC_BRIDGE_URL || 'http://localhost:9100';
const POLL_MS = Number(process.env.CC_POLL_MS || 2500);
const CLAUDE_CLI_JS = process.env.CLAUDE_CLI_JS
  || 'D:\\Dev\\npm-global\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
const MODEL = process.env.CC_MODEL || 'sonnet';
const CLAUDE_TIMEOUT_MS = Number(process.env.CC_TIMEOUT_MS || 150000);

async function poll() {
  try {
    const res = await fetch(`${BRIDGE}/cc/pending`);
    if (res.status === 204) return null;
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function respond(id, text) {
  try {
    const res = await fetch(`${BRIDGE}/cc/respond/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function thinkWithClaude(system, user) {
  return new Promise((resolve, reject) => {
    const args = [
      CLAUDE_CLI_JS,
      '--print',
      '--tools', '',
      '--model', MODEL,
    ];
    if (system && system.length > 0) {
      args.push('--system-prompt', system);
    }
    const env = { ...process.env };
    if (process.platform === 'win32' && !env.CLAUDE_CODE_GIT_BASH_PATH) {
      env.CLAUDE_CODE_GIT_BASH_PATH = 'D:\\Program Files\\Git\\bin\\bash.exe';
    }
    const proc = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env,
    });
    let out = '';
    let err = '';
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      fn();
    };
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      finish(() => {
        if (code === 0) resolve(out.trim());
        else reject(new Error(`claude exit ${code}: ${err.slice(0, 300)}`));
      });
    });
    proc.on('error', (e) => finish(() => reject(e)));
    try {
      proc.stdin.write(user || '');
      proc.stdin.end();
    } catch (e) {
      finish(() => reject(e));
    }
    setTimeout(() => {
      if (!done) {
        try { proc.kill('SIGKILL'); } catch {}
        finish(() => reject(new Error('claude timeout')));
      }
    }, CLAUDE_TIMEOUT_MS);
  });
}

async function handleOne(req) {
  const started = Date.now();
  const isReflection = /=== REFLECTION MODE ===/.test(req.system || '');
  const isProactive = /--- TASK ---/.test(req.user || '');
  const tag = isReflection ? 'REFLECT' : (isProactive ? 'PROACT ' : 'REACT  ');
  try {
    const reply = await thinkWithClaude(req.system || '', req.user || '');
    const ok = await respond(req.id, reply);
    const ms = Date.now() - started;
    const preview = reply.slice(0, 90).replace(/\s+/g, ' ');
    console.log(`[${req.id}] ${tag} ${ok ? 'OK  ' : 'FAIL'} ${(ms / 1000).toFixed(1)}s → ${preview}`);
  } catch (e) {
    console.error(`[${req.id}] ${tag} ERR ${e.message}`);
    await respond(req.id, '[SILENT]');
  }
}

async function run() {
  console.log(`cc-brain: polling ${BRIDGE} every ${POLL_MS}ms (model=${MODEL})`);
  while (true) {
    const req = await poll();
    if (req) {
      await handleOne(req);
      continue;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

run().catch((err) => {
  console.error('cc-brain fatal:', err);
  process.exit(1);
});
