// scripts/llm-watchdog.mjs
//
// Independent daemon — silent death detect for llama-server (port 8000) + LiteLLM (port 4000) + auto-respawn.
// KI-16 sediment: 5/2 ~21:00 UTC LLM infra silent crash, 9.5h before catch. Watchdog 60s probe ≤1min recovery.
//
// Run: node scripts/llm-watchdog.mjs
//
// Anti-pattern guards:
//   #1 env var override (KANET_ROOT / LLAMA_EXE / LITELLM_EXE etc) — NOT hard-coded
//   #2 broadcast on respawn — NOT silent (avoid silent 盲区 复刻 KI-9)
//   #3 detached + unref — NOT parent-cascade kill
//   #4 retry counter cap (3/10min) — NOT infinite loop on deterministic crash

import { spawn } from 'node:child_process';

const KANET_ROOT     = process.env.KANET_ROOT     || 'C:/kanet';
const LLAMA_EXE      = process.env.LLAMA_EXE      || `${KANET_ROOT}/tools/llama-server/llama-server.exe`;
const LLAMA_MODEL    = process.env.LLAMA_MODEL    || `${KANET_ROOT}/models/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf`;
const LITELLM_EXE    = process.env.LITELLM_EXE    || 'C:/Users/ADMIN/AppData/Local/Programs/Python/Python310/Scripts/litellm.exe';
const LITELLM_CONFIG = process.env.LITELLM_CONFIG || `${KANET_ROOT}/tools/litellm-config.yaml`;
const CONSOLE_URL    = process.env.CONSOLE_URL    || 'http://127.0.0.1:3100';
const NWT_RELAY_ID   = process.env.NWT_RELAY_ID   || '5b236c08-03d0-456c-953d-e10001610938';

const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS  = 3_000;
const RETRY_CAP         = 3;
const RETRY_WINDOW_MS   = 600_000;  // 10 min

const _retryHistory = { llama: [], litellm: [] };

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

function withinRetryCap(service) {
  const now = Date.now();
  _retryHistory[service] = _retryHistory[service].filter(t => now - t < RETRY_WINDOW_MS);
  return _retryHistory[service].length < RETRY_CAP;
}

function spawnLlama() {
  const proc = spawn(LLAMA_EXE, [
    '--model', LLAMA_MODEL,
    '--host', '0.0.0.0', '--port', '8000',
    '--n-gpu-layers', '99', '--ctx-size', '262144', '--threads', '8', '--flash-attn', 'on',
  ], { detached: true, stdio: 'ignore', cwd: `${KANET_ROOT}/tools/llama-server` });
  proc.unref();
  console.log(`[watchdog] llama-server spawned PID ${proc.pid}`);
  return proc.pid;
}

function spawnLitellm() {
  const proc = spawn(LITELLM_EXE, ['--config', LITELLM_CONFIG, '--port', '4000', '--host', '0.0.0.0'], {
    detached: true, stdio: 'ignore',
  });
  proc.unref();
  console.log(`[watchdog] litellm spawned PID ${proc.pid}`);
  return proc.pid;
}

async function broadcast(message) {
  try {
    await fetch(`${CONSOLE_URL}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId: NWT_RELAY_ID, channel: 'dev-coord', message }),
    });
  } catch (err) {
    console.error('[watchdog] broadcast failed:', err.message);
  }
}

async function handleDown(service, spawnFn) {
  if (!withinRetryCap(service)) {
    await broadcast(`[watchdog] 🚨 ${service} DOWN — retry cap ${RETRY_CAP}/10min EXCEEDED, suspect deterministic crash, manual investigation needed @ ${new Date().toISOString()}`);
    return;
  }
  _retryHistory[service].push(Date.now());
  const pid = spawnFn();
  const count = _retryHistory[service].length;
  await broadcast(`[watchdog] 🔴 ${service} DOWN, respawn PID ${pid} (retry ${count}/${RETRY_CAP} in 10min) @ ${new Date().toISOString()}`);
}

async function watchdogTick() {
  const llamaOk = await probe('http://127.0.0.1:8000/health');
  const litellmOk = await probe('http://127.0.0.1:4000/health/liveliness');
  if (!llamaOk) await handleDown('llama', spawnLlama);
  if (!litellmOk) await handleDown('litellm', spawnLitellm);
}

console.log(`[watchdog] starting, probe ${PROBE_INTERVAL_MS / 1000}s interval, retry cap ${RETRY_CAP}/${RETRY_WINDOW_MS / 60000}min`);
setInterval(watchdogTick, PROBE_INTERVAL_MS);
watchdogTick();
