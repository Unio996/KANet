/**
 * Chain Scanner — discovers active Kasia addresses on-chain.
 * Controls kaspa-scout as a child process in RPC mode (direct node connection).
 *
 * Scanner is a system-level resource — discovery data is shared across all agents.
 * Uses the first relay node's address as seed (for scout to identify local addresses).
 *
 * Scout reports discoveries back to Console via HTTP API:
 *   POST /api/discovery/register
 *   POST /api/discovery/interaction
 */
import { spawn } from 'child_process';
import { resolve } from 'path';
import { sqlite } from '../db/client.js';
import { getConfig, setConfig } from '../data/settings/configs.js';
import { getDiscoveryStats } from '../data/discovery/discovery.js';
import { isLocalNode } from './rpc-health.js';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const SCOUT_DIR = resolve(process.env.SCOUT_DIR || `${KANET_ROOT}/kaspa-scout`);
const CONSOLE_PORT = process.env.PORT || '3100';

let _child = null;
let _running = false;
let _seedAddress = null;
let _startedAt = null;
let _lastLog = '';

/**
 * Start the scanner (system-level).
 * Launches kaspa-scout as a child process in RPC mode.
 * Auto-picks the first relay node's address as seed for local address detection.
 */
export async function startScanner() {
  if (_child) return { ok: false, reason: 'already_running' };

  // Scout 只在本地节点可用时运行——远程节点扛不住全链扫描
  if (!await isLocalNode()) {
    console.log('[scanner] Scout 需要本地节点 (127.0.0.1:17110)，当前无本地节点，不启动');
    return { ok: false, reason: 'no_local_node' };
  }

  // Pick first relay node as seed (for local address identification)
  const account = sqlite.prepare(
    "SELECT id, name, address FROM relay_nodes WHERE address IS NOT NULL AND length(address) >= 60 LIMIT 1"
  ).get();
  if (!account) return { ok: false, reason: 'no_relay_node' };

  _seedAddress = account.address;
  _startedAt = new Date().toISOString();
  _lastLog = '';

  // Resolve RPC URL and ingest secret from DB config
  const rpcUrl = await getConfig('rpc_url') || process.env.KASPA_RPC_URL || '';
  const ingestSecret = await getConfig('ingest_secret') || process.env.INGEST_SECRET || '';

  // Spawn kaspa-scout as child process — system-level, no account binding
  const env = {
    ...process.env,
    SCAN_MODE: 'rpc',
    KASPA_RPC_URL: rpcUrl,
    KASPA_NETWORK: 'mainnet',
    CONSOLE_URL: `http://localhost:${CONSOLE_PORT}`,
    INGEST_SECRET: ingestSecret,
    SCOUT_SEED_ADDRESS: _seedAddress,
  };

  try {
    _child = spawn('node', ['src/index.mjs'], {
      cwd: SCOUT_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    _running = true;

    // Capture last log line for status display
    _child.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      _lastLog = lines[lines.length - 1] || _lastLog;
    });

    _child.stderr.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      _lastLog = lines[lines.length - 1] || _lastLog;
    });

    _child.on('exit', (code) => {
      console.log(`[scanner] scout exited with code ${code}`);
      _running = false;
      _child = null;
    });

    _child.on('error', (err) => {
      console.error(`[scanner] scout spawn error: ${err.message}`);
      _running = false;
      _child = null;
    });

    // Save enabled flag for auto-restart
    await setConfig('scanner_enabled', 'true', { category: 'scanner' });

    console.log(`[scanner] started scout (RPC) seed=${_seedAddress.slice(-8)} PID ${_child.pid}`);

    // Write PID file so kanet-stop.sh can kill orphaned scout processes
    try {
      const fs = await import('node:fs/promises');
      await fs.mkdir(`${KANET_ROOT}/logs/pids`, { recursive: true });
      await fs.writeFile(`${KANET_ROOT}/logs/pids/scout.pid`, String(_child.pid));
    } catch {}

    return { ok: true, pid: _child.pid };
  } catch (err) {
    console.error(`[scanner] failed to start scout: ${err.message}`);
    _running = false;
    _child = null;
    return { ok: false, reason: 'spawn_failed', error: err.message };
  }
}

/**
 * Stop the scanner (kill scout child process).
 */
export async function stopScanner() {
  if (!_child) return { ok: false, reason: 'not_running' };

  try {
    _child.kill('SIGTERM');
    // Give it 3s to exit gracefully, then force kill
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (_child) { try { _child.kill('SIGKILL'); } catch {} }
        resolve();
      }, 3000);
      if (_child) {
        _child.on('exit', () => { clearTimeout(timer); resolve(); });
      } else {
        clearTimeout(timer);
        resolve();
      }
    });
  } catch {}

  await setConfig('scanner_enabled', 'false', { category: 'scanner' });

  console.log(`[scanner] stopped scout`);

  _child = null;
  _running = false;
  _seedAddress = null;
  _startedAt = null;

  return { ok: true };
}

/**
 * Get scanner status.
 * Combines process state with discovery stats from DB.
 * Returns fields compatible with UI: discovered, interactions, cycles.
 */
export function getScannerStatus() {
  const discovery = getDiscoveryStats();

  const interactionCount = sqlite.prepare(
    "SELECT COUNT(*) as n FROM interaction_records"
  ).get()?.n || 0;

  return {
    running: _running,
    startedAt: _startedAt,
    pid: _child?.pid || null,
    lastLog: _lastLog,
    discovered: discovery.total,
    interactions: interactionCount,
    ...discovery,
  };
}

/**
 * Auto-start if scanner was enabled before Console restart.
 */
export async function autoStartIfEnabled() {
  const enabled = await getConfig('scanner_enabled');
  if (enabled && enabled !== 'false') {
    if (!await isLocalNode()) {
      console.log('[scanner] auto-start skipped: Scout 需要本地节点，当前无本地节点');
      return;
    }
    console.log('[scanner] auto-starting (was enabled before restart)');
    await startScanner();
  }
}
