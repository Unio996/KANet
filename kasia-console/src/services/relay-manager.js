/**
 * Relay Manager — spawns/stops relay child processes per account.
 *
 * Same pattern as scanner.js but per-account:
 *   startRelay(relayNodeId) — spawn one relay process
 *   stopRelay(relayNodeId)  — kill one relay process
 *   startAll()              — start relays for all accounts with mnemonic + adapter
 *   stopAll()               — kill all relay processes
 *   getStatus()             — which relays are running
 */

import { fork } from 'child_process';
import { resolve } from 'path';
import { sqlite } from '../db/client.js';
import { getConfig } from '../data/settings/configs.js';
import { getRelayMnemonic } from '../data/settings/relay-nodes.js';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const RELAY_DIR = resolve(process.env.RELAY_DIR || `${KANET_ROOT}/kasia-relay`);
const CONSOLE_PORT = process.env.PORT || '3100';

// relayNodeId → { child, pid, startedAt, lastLog }
const _relays = {};

/**
 * Start a relay process for a specific account.
 */
export async function startRelay(relayNodeId) {
  if (_relays[relayNodeId]?.child) {
    return { ok: false, reason: 'already_running', pid: _relays[relayNodeId].pid };
  }

  // Load account data
  const account = sqlite.prepare(
    `SELECT r.id, r.name, r.address, r.network, r.poll_ms, r.is_service, a.http_port as adapter_port
     FROM relay_nodes r
     LEFT JOIN adapter_nodes a ON a.id = r.adapter_node_id
     WHERE r.id = ?`
  ).get(relayNodeId);

  if (!account) return { ok: false, reason: 'account_not_found' };
  if (!account.address) return { ok: false, reason: 'no_address' };

  // Ensure this agent's address is registered as 'local' identity
  // Without this, Scout won't recognize handshakes to this agent, and relation_states won't be created
  const existingId = sqlite.prepare('SELECT id, identity_type FROM identities WHERE address = ? AND network = ?').get(account.address, account.network || 'mainnet');
  if (!existingId) {
    const { randomUUID } = await import('crypto');
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO identities (id, network, address, display_name, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, 'local', ?, ?)").run(randomUUID(), account.network || 'mainnet', account.address, account.name, now, now);
    console.log(`[relay-manager] Created local identity for ${account.name}`);
  } else if (existingId.identity_type !== 'local') {
    sqlite.prepare("UPDATE identities SET identity_type = 'local' WHERE id = ?").run(existingId.id);
    console.log(`[relay-manager] Fixed identity type for ${account.name}: ${existingId.identity_type} → local`);
  }

  const mnemonic = getRelayMnemonic(relayNodeId);
  if (!mnemonic) return { ok: false, reason: 'no_mnemonic' };

  // Resolve config
  const rpcUrl = await getConfig('rpc_url') || process.env.KASPA_RPC_URL || '';
  const relayMode = await getConfig('relay_mode') || process.env.RELAY_MODE || 'rpc';
  const ingestSecret = await getConfig('ingest_secret') || process.env.INGEST_SECRET || '';
  const adapterPort = account.adapter_port || 3010;

  const env = {
    ...process.env,
    KASPA_MNEMONIC: mnemonic,
    CONSOLE_URL: `http://localhost:${CONSOLE_PORT}`,
    INGEST_SECRET: ingestSecret,
    RELAY_NODE_ID: relayNodeId,
    NETWORK: account.network || 'mainnet',
    KASPA_NETWORK: account.network || 'mainnet',
    KASPA_RPC_URL: rpcUrl,
    RELAY_MODE: relayMode,
    POLL_MS: String(account.poll_ms || 2000),
    IS_SERVICE: account.is_service ? '1' : '0',  // R5 T-J2-16: Service 模式 relay (broker) 跳 anti-spam dedup
  };

  try {
    const child = fork('src/relay.mjs', [], {
      cwd: RELAY_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    const state = {
      child,
      pid: child.pid,
      name: account.name,
      startedAt: new Date().toISOString(),
      lastLog: '',
    };

    child.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line) console.log(`[relay:${account.name}] ${line}`);
      }
      state.lastLog = lines.pop() || state.lastLog;
    });
    child.stderr.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line) console.log(`[relay:${account.name}] ${line}`);
      }
      state.lastLog = lines.pop() || state.lastLog;
    });

    child.on('exit', (code) => {
      console.log(`[relay-manager] ${account.name} relay exited (code ${code})`);
      delete _relays[relayNodeId];
    });

    child.on('error', (err) => {
      console.error(`[relay-manager] ${account.name} relay error: ${err.message}`);
      delete _relays[relayNodeId];
    });

    _relays[relayNodeId] = state;
    console.log(`[relay-manager] Started ${account.name} relay (PID ${child.pid})`);

    return { ok: true, pid: child.pid, name: account.name };
  } catch (err) {
    console.error(`[relay-manager] Failed to start ${account.name}: ${err.message}`);
    return { ok: false, reason: 'spawn_failed', error: err.message };
  }
}

/**
 * Stop a specific relay process.
 */
export async function stopRelay(relayNodeId) {
  const state = _relays[relayNodeId];
  if (!state?.child) return { ok: false, reason: 'not_running' };

  try {
    state.child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { state.child.kill('SIGKILL'); } catch {}
        resolve();
      }, 3000);
      state.child.on('exit', () => { clearTimeout(timer); resolve(); });
    });
  } catch {}

  delete _relays[relayNodeId];
  console.log(`[relay-manager] Stopped ${state.name} relay`);
  return { ok: true };
}

/**
 * Start relays for all accounts that have mnemonic + adapter configured.
 */
export async function startAll() {
  const accounts = sqlite.prepare(
    `SELECT r.id FROM relay_nodes r
     JOIN adapter_nodes a ON a.id = r.adapter_node_id
     WHERE r.address IS NOT NULL AND r.mnemonic_encrypted IS NOT NULL`
  ).all();

  let started = 0;
  for (const a of accounts) {
    if (_relays[a.id]?.child) continue; // already running
    const result = await startRelay(a.id);
    if (result.ok) started++;
  }

  console.log(`[relay-manager] ${started}/${accounts.length} relays started`);
  return { started, total: accounts.length };
}

/**
 * Stop all relay processes.
 */
export async function stopAll() {
  const ids = Object.keys(_relays);
  for (const id of ids) {
    await stopRelay(id);
  }
  console.log(`[relay-manager] All relays stopped`);
}

/**
 * Get status of all relay processes.
 */
export function getStatus() {
  return Object.entries(_relays).map(([id, state]) => ({
    relayNodeId: id,
    name: state.name,
    pid: state.pid,
    startedAt: state.startedAt,
    lastLog: state.lastLog,
  }));
}

/**
 * Send a command to a Relay child process.
 *
 * Architecture rule:
 *   Console → Relay: IPC (commands)
 *   Relay → Console: HTTP (reports)
 *
 * Supported commands:
 *   { type: 'handshake', target: 'kaspa:...' }
 *   { type: 'send_message', target: 'kaspa:...', message: '...' }
 *   { type: 'publish_card', params: { name, entityType, skills, ... } }
 *   { type: 'send_broadcast', channel: '...', message: '...' }
 *   { type: 'transfer', target: 'kaspa:...', amount: '0.2' }
 */
export function sendCommand(relayNodeId, command) {
  const state = _relays[relayNodeId];
  if (!state?.child?.send) return false;
  state.child.send(command);
  return true;
}

/**
 * 发送命令并等待 Relay 回传结果（请求-响应模式）。
 * 用于需要 txId 等执行结果的操作（transfer, handshake）。
 * @param {string} relayNodeId
 * @param {object} command - { type, target, amount, ... }
 * @param {number} [timeoutMs=30000] - 超时毫秒
 * @returns {Promise<{txId?, fee?, error?}>}
 */
/**
 * Wait until a relay child is running and ready to receive IPC commands.
 * Polls every 500ms up to timeoutMs. Returns when ready, throws on timeout.
 * Used by broker-action-queue to hold pump during console-restart relay race
 * (T-J2-24, J1 a242bfd5 R5: NWT 报 console restart ~10s 内 accept_v1 全 FAIL '
 * Relay not running' 因 retry 6s/12s/18s 总 36s 仍可能 race).
 */
export async function waitForRelay(relayNodeId, timeoutMs = 60000) {
  const POLL_MS = 500;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = _relays[relayNodeId];
    if (state?.child?.send) return;
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error(`waitForRelay: ${relayNodeId.slice(0, 8)} not ready after ${timeoutMs / 1000}s`);
}

export function sendCommandAsync(relayNodeId, command, timeoutMs = 30000) {
  const state = _relays[relayNodeId];
  if (!state?.child?.send) return Promise.reject(new Error('Relay not running'));

  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.child.removeListener('message', handler);
      reject(new Error('Relay command timeout after ' + (timeoutMs / 1000) + 's'));
    }, timeoutMs);

    function handler(msg) {
      if (msg?.requestId === requestId) {
        clearTimeout(timer);
        state.child.removeListener('message', handler);
        resolve(msg.result || {});
      }
    }
    state.child.on('message', handler);
    state.child.send({ ...command, requestId });
  });
}

