// tg-bot-manager.js — single owner of the Telegram broker bot process (Owner v1.3 §8, 0-key).
//
// The bot is a separate process that reads chain events and deep-links users to Console/relay for
// any value step; it never holds a key or moves funds. This manager is the SOLE launcher (the old
// kanet-start*.sh launch was removed to avoid two pollers on one token → Telegram 409 Conflict).
// It gives the Settings UI one-click start/stop/status and keeps the bot alive (respawn on crash).
//
// We launch the canonical launcher `kasia-console/_launch_tg_bot.mjs` (NOT tg-bot/bot.mjs directly):
// it reads kanet.env, decrypts ingest_secret in-process, sets the env, then imports the bot. Reusing
// it keeps env resolution in one place and matches the cmdline the dedup-kill targets.

import { fork, execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from '../data/settings/configs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KANET_ROOT = process.env.KANET_ROOT || join(__dirname, '..', '..', '..');
const CONSOLE_DIR = join(KANET_ROOT, 'kasia-console');
const LAUNCHER = '_launch_tg_bot.mjs';   // run from CONSOLE_DIR

const RAPID_CRASH_MS = 15000;
const MAX_RAPID_CRASHES = 3;
const RESPAWN_DELAY_MS = 5000;

let _bot = null;                // { child, pid, startedAt }
let _intentionalStop = false;
let _lastError = null;
let _rapidCrashes = 0;

/** Kill any stray bot process (orphan from a previous Console, or a manual run) so we stay single-poller.
 *  NOTE (Bettor r952): Windows-only (PowerShell Win32_Process). On the current Windows host this is fine;
 *  best-effort try/catch silently degrades elsewhere. TODO when the repo goes cross-platform: switch to
 *  pgrep/pkill so the single-poller guarantee holds on Linux/Mac too. */
function killStrayBots() {
  try {
    execSync(
      `powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match '_launch_tg_bot|tg-bot.bot\\.mjs' }) | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { timeout: 8000, stdio: 'ignore' }
    );
  } catch { /* best-effort */ }
}

/** True only if the tracked child is genuinely alive (guards against a dead pid reported as running). */
function isBotAlive() {
  if (!_bot?.child) return false;
  if (_bot.child.exitCode !== null || _bot.child.signalCode || _bot.child.killed) return false;
  try { process.kill(_bot.pid, 0); return true; } catch { return false; }
}

/** Start the bot. Idempotent. Kills any stray instance first (single-poller guard). */
export async function startTgBot() {
  if (isBotAlive()) return { ok: false, reason: 'already_running', pid: _bot.pid };
  _bot = null;  // clear any stale handle

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    _lastError = 'TELEGRAM_BOT_TOKEN not set (kanet.env — get one from @BotFather)';
    return { ok: false, reason: 'no_token', message: _lastError };
  }

  killStrayBots();  // ensure no other poller on this token (orphans / start-script remnants)

  _intentionalStop = false;
  _lastError = null;
  let child;
  try {
    child = fork(LAUNCHER, [], { cwd: CONSOLE_DIR, env: { ...process.env } });
  } catch (e) {
    _lastError = `spawn failed: ${e.message}`;
    return { ok: false, reason: 'spawn_failed', message: _lastError };
  }
  const startedAt = Date.now();
  _bot = { child, pid: child.pid, startedAt: new Date(startedAt).toISOString() };
  console.log(`[tg-bot-manager] launched bot pid=${child.pid}`);

  child.on('exit', (code, signal) => {
    const ranMs = Date.now() - startedAt;
    const intentional = _intentionalStop;
    console.log(`[tg-bot-manager] bot exited code=${code} signal=${signal} ranMs=${ranMs} intentional=${intentional}`);
    if (_bot?.child === child) _bot = null;
    if (intentional) { _rapidCrashes = 0; return; }
    if (code !== 0) _lastError = `bot exited code ${code}`;
    if (ranMs < RAPID_CRASH_MS) {
      _rapidCrashes += 1;
      if (_rapidCrashes >= MAX_RAPID_CRASHES) {
        _lastError = `bot crashed ${_rapidCrashes}× rapidly — supervisor stopped respawning (check token/config)`;
        console.error(`[tg-bot-manager] ${_lastError}`);
        return;
      }
    } else {
      _rapidCrashes = 0;
    }
    setTimeout(() => { if (!isBotAlive() && !_intentionalStop) startTgBot().catch(() => {}); }, RESPAWN_DELAY_MS);
  });

  return { ok: true, pid: child.pid };
}

/** Stop the bot (intentional — supervisor will not respawn). */
export async function stopTgBot() {
  _intentionalStop = true;
  _rapidCrashes = 0;
  const child = _bot?.child;
  const pid = _bot?.pid || null;
  if (child) {
    try { child.kill('SIGTERM'); } catch {}
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 3000);
      child.on('exit', () => { clearTimeout(t); resolve(); });
    });
  }
  killStrayBots();  // sweep any orphan that escaped the child handle
  _bot = null;
  console.log(`[tg-bot-manager] stopped bot${pid ? ' pid=' + pid : ''}`);
  return { ok: true, pid };
}

/** Current status for the UI. */
export async function tgBotStatus() {
  const alive = isBotAlive();
  if (!alive && _bot) _bot = null;  // reconcile a dead handle
  const brokerRelayId = (await getConfig('tg_bot_broker_relay_id')) || process.env.BROKER_RELAY_ID || '';
  return {
    running: alive,
    pid: alive ? _bot.pid : null,
    started_at: alive ? _bot.startedAt : null,
    username: process.env.TELEGRAM_BOT_USERNAME || 'KANET_Broker_bot',
    broker_relay_id: brokerRelayId,
    token_configured: !!process.env.TELEGRAM_BOT_TOKEN,
    last_error: _lastError,
  };
}

/**
 * Auto-start on Console boot ONLY if the operator previously enabled it (tg_bot_enabled='1', set by
 * the Settings Start button) AND the token is present. This is the `adapter is_enabled` pattern:
 * a manual Stop is remembered across restarts, so the bot doesn't silently go live on its own.
 */
export async function startTgBotIfConfigured() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log('[tg-bot-manager] TELEGRAM_BOT_TOKEN not set — bot not auto-started (configure + start from Settings)');
    return { ok: false, reason: 'no_token' };
  }
  const enabled = (await getConfig('tg_bot_enabled')) === '1';
  if (!enabled) {
    // Not enabled — no fork here, so no need to sweep (a later Start does killStrayBots before forking).
    console.log('[tg-bot-manager] tg_bot_enabled not set — bot not auto-started (Start it from Settings)');
    return { ok: false, reason: 'not_enabled' };
  }
  return startTgBot();  // startTgBot kills strays before forking (single-poller guard)
}
