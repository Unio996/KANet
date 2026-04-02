/**
 * Adapter Launcher — manages agent-adapter child processes.
 * Each adapter_node in DB can be started/stopped from the Console UI.
 * Follows the same pattern as scanner.js (child process management).
 */
import { spawn } from 'child_process';
import { resolve } from 'path';
import { listAdapterNodes, getAdapterNode, getAdapterToken, getAdapterProviderKey } from '../data/settings/adapter-nodes.js';
import { getConfig } from '../data/settings/configs.js';
import { ensureConnection } from './connection-manager.js';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const ADAPTER_DIR = resolve(process.env.ADAPTER_DIR || `${KANET_ROOT}/agent-adapter`);
const CONSOLE_PORT = process.env.PORT || '3100';

// Map of adapterId → { child, running, startedAt, lastLog }
const _instances = new Map();

function log(...args) {
  console.log(new Date().toISOString(), '[adapter-launcher]', ...args);
}

/**
 * Start an adapter by its DB id.
 */
export async function startAdapter(adapterId) {
  if (_instances.has(adapterId) && _instances.get(adapterId).running) {
    return { ok: false, reason: 'already_running' };
  }

  const node = getAdapterNode(adapterId);
  if (!node) return { ok: false, reason: 'not_found' };

  // Decrypt secrets
  const token = getAdapterToken(adapterId);
  const providerKey = getAdapterProviderKey(adapterId);
  const ingestSecret = await getConfig('ingest_secret') || process.env.INGEST_SECRET || '';

  // Ensure connection record exists for dynamic auth (Phase 2)
  const connectionId = ensureConnection(adapterId);

  // Build env based on provider type
  const env = {
    ...process.env,
    ADAPTER_PORT: String(node.http_port),
    CONSOLE_URL: `http://localhost:${CONSOLE_PORT}`,
    INGEST_SECRET: ingestSecret,
    AI_PROVIDER: node.ai_provider || 'openclaw',
    // Phase 2: adapter uses ADAPTER_ID to resolve auth dynamically from Console
    ADAPTER_ID: adapterId,
  };

  if (node.ai_provider === 'openclaw' || !node.ai_provider) {
    env.OPENCLAW_GATEWAY_URL = node.gateway_ws_url || 'ws://127.0.0.1:18789';
    env.OPENCLAW_AGENT_ID = node.agent_id || 'main';
    env.OPENCLAW_SESSION_KEY = node.session_key || 'agent:main:main';
    if (token) env.OPENCLAW_TOKEN = token;
    // Also set AI_PROVIDER_URL/KEY for the new provider system
    env.AI_PROVIDER_URL = node.gateway_ws_url || 'ws://127.0.0.1:18789';
    if (token) env.AI_PROVIDER_KEY = token;
  } else {
    if (node.ai_provider_url) env.AI_PROVIDER_URL = node.ai_provider_url;
    if (providerKey) env.AI_PROVIDER_KEY = providerKey;
    if (node.ai_model) env.AI_MODEL = node.ai_model;
  }

  try {
    const child = spawn('node', ['src/index.mjs'], {
      cwd: ADAPTER_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const instance = {
      child,
      running: true,
      startedAt: new Date().toISOString(),
      lastLog: '',
      name: node.name,
      port: node.http_port,
    };

    child.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line) console.log(`[adapter:${node.name}] ${line}`);
      }
      instance.lastLog = lines[lines.length - 1] || instance.lastLog;
    });

    child.stderr.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line) console.log(`[adapter:${node.name}] ${line}`);
      }
      instance.lastLog = lines[lines.length - 1] || instance.lastLog;
    });

    child.on('exit', (code) => {
      log(`"${node.name}" exited (code ${code})`);
      instance.running = false;
      instance.child = null;
    });

    child.on('error', (err) => {
      log(`"${node.name}" spawn error: ${err.message}`);
      instance.running = false;
      instance.child = null;
    });

    _instances.set(adapterId, instance);

    log(`started "${node.name}" on port ${node.http_port} (PID ${child.pid})`);
    return { ok: true, pid: child.pid, port: node.http_port };
  } catch (err) {
    log(`failed to start "${node.name}": ${err.message}`);
    return { ok: false, reason: 'spawn_failed', error: err.message };
  }
}

/**
 * Kill a process listening on a given port (for externally-started adapters).
 */
async function killByPort(port) {
  try {
    const { execSync } = await import('child_process');
    const out = execSync(`netstat -ano | findstr ":${port}" | findstr "LISTEN"`, { encoding: 'utf-8' });
    const pid = out.trim().split(/\s+/).pop();
    if (pid && /^\d+$/.test(pid)) {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      log(`killed external process on port ${port} (PID ${pid})`);
      return true;
    }
  } catch {}
  return false;
}

/**
 * Stop an adapter by its DB id.
 * Works for both Console-managed and externally-started adapters.
 */
export async function stopAdapter(adapterId) {
  const instance = _instances.get(adapterId);

  // If not managed by us, try to kill by port
  if (!instance || !instance.child) {
    _instances.delete(adapterId);
    const node = getAdapterNode(adapterId);
    if (node) {
      const killed = await killByPort(node.http_port);
      return killed ? { ok: true } : { ok: false, reason: 'not_running' };
    }
    return { ok: false, reason: 'not_running' };
  }

  try {
    const pid = instance.child.pid;
    // On Windows, SIGTERM may not work — use taskkill as primary
    try {
      const { execSync } = await import('child_process');
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    } catch {
      instance.child.kill('SIGTERM');
    }

    // Wait up to 3s for exit
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (instance.child) { try { instance.child.kill('SIGKILL'); } catch {} }
        resolve();
      }, 3000);
      if (instance.child) {
        instance.child.on('exit', () => { clearTimeout(timer); resolve(); });
      } else {
        clearTimeout(timer); resolve();
      }
    });
  } catch {}

  log(`stopped "${instance.name}"`);
  instance.running = false;
  instance.child = null;
  _instances.delete(adapterId);

  return { ok: true };
}

/**
 * Restart an adapter — stop (kill old process) then start with fresh config from DB.
 */
export async function restartAdapter(adapterId) {
  await stopAdapter(adapterId);
  // Brief pause to let port release
  await new Promise(r => setTimeout(r, 500));
  return startAdapter(adapterId);
}

/**
 * Get status of a specific adapter.
 */
export function getAdapterStatus(adapterId) {
  const instance = _instances.get(adapterId);
  if (!instance) return { running: false };
  return {
    running: instance.running,
    pid: instance.child?.pid || null,
    startedAt: instance.startedAt,
    lastLog: instance.lastLog,
  };
}

/**
 * Get status of all managed adapters.
 */
export function getAllAdapterStatus() {
  const result = {};
  for (const [id, inst] of _instances) {
    result[id] = {
      running: inst.running,
      pid: inst.child?.pid || null,
      startedAt: inst.startedAt,
      port: inst.port,
    };
  }
  return result;
}

/**
 * Start all configured adapters (called on Console boot).
 * Mirrors relay-manager.startAll() pattern.
 */
export async function startAllAdapters() {
  const adapters = listAdapterNodes();

  let started = 0;
  for (const a of adapters) {
    if (_instances.has(a.id) && _instances.get(a.id).running) continue;
    const result = await startAdapter(a.id);
    if (result.ok) started++;
  }

  log(`${started}/${adapters.length} adapters started`);
  return { started, total: adapters.length };
}

/**
 * Stop all running adapters (called on Console shutdown).
 */
export async function stopAllAdapters() {
  for (const [id] of _instances) {
    await stopAdapter(id);
  }
}
