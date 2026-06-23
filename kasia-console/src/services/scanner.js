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
let _scanMode = null;
// ★ root-cure (J1, 2026-06-21 :3200 ingest-gap incident): scanner child died but Console stayed
//   false-alive (on('exit') only logged + cleared, never respawned) → cross-node ingest stalled until
//   manual restart. Auto-respawn on unexpected death, with crash-loop backoff to avoid restart storm.
let _stopping = false;      // true during intentional stopScanner → suppress respawn
let _lastSpawnAt = 0;       // for crash-loop detection (died-quick = back off harder)
let _crashCount = 0;
let _respawnTimer = null;
const RESPAWN_BASE_MS = 5000;
const RESPAWN_MAX_MS  = 60000;
const CRASH_WINDOW_MS = 30000; // died within 30s of spawn = crash (escalate backoff)
// ★ root-cure ② (Bettor proposal): authoritative liveness = scout_checkpoint.last_block_time advancing.
//   Catches every death mode — dead process, WS stall, AND false-alive (running=true but scan stopped,
//   no exit event so on('exit') respawn can't see it). External watchdog beats per-mode detection.
let _watchdogTimer = null;
let _lastWatchdogRestartAt = 0;
const WATCHDOG_INTERVAL_MS = 45000;
const SCAN_STALL_MS = 120000;  // checkpoint not advanced in 120s (TN12 ~1 block/s) = stalled → restart

/**
 * Auto-respawn the scout after an unexpected death (root-cure for the false-alive ingest gap).
 * Suppressed during intentional stopScanner. Crash-loop guard: a scout that dies within
 * CRASH_WINDOW_MS of spawning escalates the backoff (5s→60s) so a hard-failing scout does not storm.
 */
function _maybeRespawn(reason) {
  if (_stopping) return; // intentional stop — do not respawn
  const aliveMs = _lastSpawnAt ? Date.now() - _lastSpawnAt : 0;
  if (aliveMs > 0 && aliveMs < CRASH_WINDOW_MS) _crashCount++; else _crashCount = 0;
  const delay = Math.min(RESPAWN_BASE_MS * Math.pow(2, _crashCount), RESPAWN_MAX_MS);
  console.warn(`[scanner] scout ${reason} — auto-respawn in ${delay / 1000}s (crash#${_crashCount}, aliveMs=${aliveMs})`);
  if (_respawnTimer) clearTimeout(_respawnTimer);
  _respawnTimer = setTimeout(async () => {
    _respawnTimer = null;
    if (_stopping || _child) return; // stopped meanwhile, or already restarted
    const enabled = await getConfig('scanner_enabled');
    if (!enabled || enabled === 'false') return; // operator disabled it
    console.log('[scanner] auto-respawning scout (child died, Console false-alive guard)');
    try { await startScanner(); } catch (e) { console.error(`[scanner] auto-respawn failed: ${e.message}`); _maybeRespawn('respawn-fail'); }
  }, delay);
  if (_respawnTimer.unref) _respawnTimer.unref();
}

/**
 * Start the scanner (system-level).
 * Launches kaspa-scout as a child process in RPC mode.
 * Auto-picks the first relay node's address as seed for local address detection.
 */
export async function startScanner() {
  if (_child) return { ok: false, reason: 'already_running' };

  // 检测本地节点——决定全量模式还是轻量模式
  const hasLocalNode = await isLocalNode();
  const scanMode = hasLocalNode ? 'rpc' : 'light';

  if (!hasLocalNode) {
    console.log('[scanner] 无本地节点，Scout 以轻量模式启动（仅监控本地 Agent 地址）');
  }

  // Pick first relay node as seed (for local address identification)
  const account = sqlite.prepare(
    "SELECT id, name, address FROM relay_nodes WHERE address IS NOT NULL AND length(address) >= 60 LIMIT 1"
  ).get();
  if (!account) return { ok: false, reason: 'no_relay_node' };

  _seedAddress = account.address;
  _startedAt = new Date().toISOString();
  _lastLog = '';

  // Resolve RPC URL and ingest secret
  const rpcUrl = await getConfig('rpc_url') || process.env.KASPA_RPC_URL || '';
  // INGEST_SECRET is set by ensureIngestSecret() in index.js at startup
  const ingestSecret = process.env.INGEST_SECRET || '';

  // 读取 watch 配置（light 模式额外监控的地址和协议信号）
  // 移动端轻量客户端将来会填充这两个字段
  const watchAddressesRaw = await getConfig('scout_watch_addresses');
  const watchSignalsRaw = await getConfig('scout_watch_signals');
  const watchAddresses = watchAddressesRaw ? watchAddressesRaw : '';
  const watchSignals = watchSignalsRaw ? watchSignalsRaw : '';

  // Spawn kaspa-scout as child process — system-level, no account binding
  const env = {
    ...process.env,
    SCAN_MODE: scanMode,
    KASPA_RPC_URL: rpcUrl,
    KASPA_NETWORK: process.env.KASPA_NETWORK || 'mainnet',  // 5/25 hotfix — D 盘 TN12 需 testnet-12, mainnet 硬编无法扫 testnet 链 (同 rpc-health.js 同款 pattern)
    CONSOLE_URL: `http://localhost:${CONSOLE_PORT}`,
    INGEST_SECRET: ingestSecret,
    SCOUT_SEED_ADDRESS: _seedAddress,
    SCOUT_WATCH_ADDRESSES: watchAddresses,
    SCOUT_WATCH_SIGNALS: watchSignals,
  };

  try {
    _child = spawn('node', ['src/index.mjs'], {
      cwd: SCOUT_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    _running = true;
    _scanMode = scanMode;
    _stopping = false;
    _lastSpawnAt = Date.now();
    if (_respawnTimer) { clearTimeout(_respawnTimer); _respawnTimer = null; }

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
      _maybeRespawn(`exit(code=${code})`);
    });

    _child.on('error', (err) => {
      console.error(`[scanner] scout spawn error: ${err.message}`);
      _running = false;
      _child = null;
      _maybeRespawn(`spawn-error(${err.message})`);
    });

    // Save enabled flag for auto-restart
    await setConfig('scanner_enabled', 'true', { category: 'scanner' });

    if (scanMode === 'light') {
      const extraCount = watchAddresses ? watchAddresses.split(',').filter(Boolean).length : 0;
      console.log(`[scanner] Scout 运行模式：轻量（无本地节点）`);
      console.log(`[scanner] 监控地址：本地 Agent + 关注地址 ${extraCount} 个`);
      if (watchSignals) console.log(`[scanner] 关注信号：${watchSignals}`);
    } else {
      console.log(`[scanner] Scout 运行模式：全量（本地节点）`);
    }
    console.log(`[scanner] started scout (${scanMode}) seed=${_seedAddress.slice(-8)} PID ${_child.pid}`);

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
  _stopping = true; // suppress auto-respawn for this intentional stop
  if (_respawnTimer) { clearTimeout(_respawnTimer); _respawnTimer = null; }
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
  _scanMode = null;

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
    "SELECT COUNT(*) as n FROM chain_events"
  ).get()?.n || 0;

  return {
    running: _running,
    mode: _scanMode || null,
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
  startScannerWatchdog(); // run for the Console's lifetime; self-gates on scanner_enabled
  const enabled = await getConfig('scanner_enabled');
  if (enabled && enabled !== 'false') {
    console.log('[scanner] auto-starting (was enabled before restart)');
    await startScanner();
  }
}

/**
 * Scanner watchdog (root-cure ② for the silent-death ingest gap, 2026-06-21 :3200 incident).
 * The authoritative liveness signal is scout_checkpoint.last_block_time advancing. A scout can be
 * dead (no process), WS-stalled, or FALSE-ALIVE (process up, running=true, but scan stopped) — all
 * three surface as a STALE checkpoint. Every WATCHDOG_INTERVAL, if the scanner is enabled and the
 * checkpoint is stale beyond SCAN_STALL_MS, force a clean restart. This catches the false-alive mode
 * that on('exit') respawn (process death) and the scout-internal heartbeat (WS stall) cannot see.
 */
export function startScannerWatchdog() {
  if (_watchdogTimer) return;
  _watchdogTimer = setInterval(async () => {
    try {
      const enabled = await getConfig('scanner_enabled');
      if (!enabled || enabled === 'false') return; // operator disabled — nothing to guard
      let lastBlockMs = null;
      try {
        const row = sqlite.prepare("SELECT last_block_time FROM scout_checkpoint WHERE address = '_global_'").get();
        lastBlockMs = row?.last_block_time ? new Date(row.last_block_time).getTime() : null;
      } catch {}
      if (!lastBlockMs) return; // no checkpoint yet — give a fresh scout time to write one
      const staleMs = Date.now() - lastBlockMs;
      if (staleMs <= SCAN_STALL_MS) return; // healthy — checkpoint advancing
      if (Date.now() - _lastWatchdogRestartAt < SCAN_STALL_MS) return; // debounce restarts
      _lastWatchdogRestartAt = Date.now();
      console.warn(`[scanner:watchdog] scout_checkpoint stale ${Math.round(staleMs / 1000)}s (child=${_child ? 'alive=false-alive/stall' : 'dead'}) — forcing restart`);
      try { await stopScanner(); } catch {}
      await startScanner();
    } catch (e) {
      console.error(`[scanner:watchdog] tick error: ${e.message}`);
    }
  }, WATCHDOG_INTERVAL_MS);
  if (_watchdogTimer.unref) _watchdogTimer.unref();
  console.log(`[scanner:watchdog] started — liveness via scout_checkpoint freshness (check ${WATCHDOG_INTERVAL_MS / 1000}s, stall ${SCAN_STALL_MS / 1000}s)`);
}
