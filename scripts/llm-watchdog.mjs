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

import { spawn, execSync } from 'node:child_process';

const KANET_ROOT     = process.env.KANET_ROOT     || 'C:/kanet';
const LLAMA_EXE      = process.env.LLAMA_EXE      || `${KANET_ROOT}/tools/llama-server/llama-server.exe`;
const LLAMA_MODEL    = process.env.LLAMA_MODEL    || `${KANET_ROOT}/models/Qwythos-9B-Claude-Mythos-5-1M-Q6_K.gguf`;
const PROXY_SCRIPT   = process.env.PROXY_SCRIPT   || `${KANET_ROOT}/tools/anthropic-proxy.mjs`;
const CONSOLE_URL    = process.env.CONSOLE_URL    || 'http://127.0.0.1:3100';
const NWT_RELAY_ID   = process.env.NWT_RELAY_ID   || '5b236c08-03d0-456c-953d-e10001610938';

const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS  = 3_000;
const RETRY_CAP         = 3;
const RETRY_WINDOW_MS   = 600_000;  // 10 min
// 内存闸 (探针稿 §0.5·MF-2·fail-closed·Bettor 2026-08-26): llama 类阈值 35GB (私有 commit ~30 + margin)
const LLAMA_MIN_FREE_COMMIT_GB = Number(process.env.LLAMA_MIN_FREE_COMMIT_GB) || 35;

const _retryHistory = { llama: [], proxy: [] };

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

function readFreeCommitGb() {
  try {
    const out = execSync('powershell -NoProfile -Command "[math]::Floor((Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory/1MB)"', { timeout: 8000 }).toString().trim();
    const n = parseInt(out, 10);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

// 内存闸 fail-closed: 读不到(4x backoff 0/2/5/10s 仍失败) 或 < 阈值 ⇒ 拒 spawn. 拒过下 tick 继续重读(不永久放弃).
// 🔴 自动路径【无 force 入口】: watchdog 循环内 spawn 不接受任何覆盖(参数会跟进程活整个生命周期=同 env 继承坑); force 只在手动 one-shot 的 start 脚本 --memgate-force.
async function memGateOk() {
  for (const w of [0, 2, 5, 10]) {
    if (w) await new Promise((r) => setTimeout(r, w * 1000));
    const free = readFreeCommitGb();
    if (free != null) {
      if (free < LLAMA_MIN_FREE_COMMIT_GB) {
        console.log(`[watchdog] refuse-start:low-commit free=${free}GB < ${LLAMA_MIN_FREE_COMMIT_GB}GB (memory gate, no spawn)`);
        return false;
      }
      return true;
    }
  }
  console.log('[watchdog] refuse-start:commit-unknown free=? (FreeVirtualMemory 4x/backoff read failed, fail-closed no spawn)');
  return false;
}

async function spawnLlama() {
  // ctx 单一源 (Owner 2026-08-26 决 ②·禁代码缺省): LLAMA_CTX_SIZE 缺失即拒, 不硬编回退
  const ctx = process.env.LLAMA_CTX_SIZE;
  if (!ctx) { console.log('[watchdog] llama spawn 拒: LLAMA_CTX_SIZE unset (kanet.env 必须显式配, 禁代码缺省)'); return null; }
  // :8000 端口守卫 (NWT ③): 已在服务则不 spawn 第二个 (防 llama 双开 = 8/23 主因)
  if (await probe('http://127.0.0.1:8000/health')) { console.log('[watchdog] llama spawn 跳过: :8000 已在服务 (复用, 不起第二个)'); return null; }
  // 内存闸 fail-closed
  if (!(await memGateOk())) return null;
  const proc = spawn(LLAMA_EXE, [
    '--model', LLAMA_MODEL,
    '--host', '0.0.0.0', '--port', '8000',
    '--n-gpu-layers', '99', '--ctx-size', ctx,
    '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0',
    '--threads', '8', '--flash-attn', 'on',
  ], { detached: true, stdio: 'ignore', cwd: `${KANET_ROOT}/tools/llama-server` });
  proc.unref();
  console.log(`[watchdog] llama-server spawned PID ${proc.pid} (ctx=${ctx})`);
  return proc.pid;
}

function spawnProxy() {
  const proc = spawn('node', [PROXY_SCRIPT], {
    detached: true, stdio: 'ignore',
    env: { ...process.env, PROXY_AUTH_TOKEN: 'sk-local-qwythos', PROXY_PORT: '4000', LLAMA_PORT: '8000' },
  });
  proc.unref();
  console.log(`[watchdog] anthropic-proxy spawned PID ${proc.pid}`);
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
  // spawnFn 可能因守卫(:8000 已服务 / ctx 未设 / 内存 fail-closed)返回 null ⇒ 不计入重试, 下 tick 重试(继续重读, 不永久放弃)
  const pid = await spawnFn();
  if (pid == null) {
    await broadcast(`[watchdog] ⛔ ${service} DOWN 但 spawn 被拒 (见日志: :8000 已服务/ctx 未设/内存 fail-closed), 本 tick 不起, 下 tick 重试 @ ${new Date().toISOString()}`);
    return;
  }
  _retryHistory[service].push(Date.now());
  const count = _retryHistory[service].length;
  await broadcast(`[watchdog] 🔴 ${service} DOWN, respawn PID ${pid} (retry ${count}/${RETRY_CAP} in 10min) @ ${new Date().toISOString()}`);
}

async function watchdogTick() {
  const llamaOk  = await probe('http://127.0.0.1:8000/health');
  const proxyOk  = await probe('http://127.0.0.1:4000/health');
  if (!llamaOk) await handleDown('llama', spawnLlama);
  if (!proxyOk) await handleDown('proxy', spawnProxy);
}

console.log(`[watchdog] starting, probe ${PROBE_INTERVAL_MS / 1000}s interval, retry cap ${RETRY_CAP}/${RETRY_WINDOW_MS / 60000}min`);
setInterval(watchdogTick, PROBE_INTERVAL_MS);
watchdogTick();
