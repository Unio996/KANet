# Task: PZ-INFRA-llm-health-watchdog

**Version**: v1.0
**Phase**: Phase 2 第一 ship (post Phase 1 close r159)
**Scope**: KI-16 sediment 实施 — Health 必区分 alive vs functioning + LLM upstream silent 盲区 fix
**Owner**: J2 (implementor) → NWT (reviewer hat) → operator (system self-verify)
**ETA**: ~3-5 hr ship + 1 hr cross-review + auto-verify
**LOC budget**: ~150 LOC (60 endpoint + 40 indicator + 50 daemon)

---

## 起源

5/2 21:17 UTC LLM infra silent 崩 — agent-health.js `adapter=green` for all 7 agents, 但 LLM upstream (LiteLLM port 4000 + llama-server port 8000) 真 DOWN。 NWT 5/3 早 06:51 才 catch (~9.5h), via cron baseline drift 间接暴露。

per KI-16 (Phase 1 sediment): "Health 必区分 alive vs functioning"。 silent 盲区比反模式更严重 — 反模式有人撞才暴露, silent 盲区可能多月不撞。

INVARIANTS v0.1 §4.1 (alive vs functioning) + r140 sketch X.1+X.2+X.3 三件全要 (Owner 5/3 钦定)。

---

## 真目标

修 KI-16 silent 盲区: **anything kill LLM upstream 都 detect within 60s + auto recover**。

### Acceptance (system auto-verify, KI-8 守)

| # | check | metric |
|---|---|---|
| 1 | `/api/system/llm-health` endpoint 真返回 functioning status | curl returns 200 + `{ llama_server: { alive, functioning }, litellm: { alive, functioning } }` |
| 2 | agent-health.js `llm_upstream` indicator 真集成 | `/api/health/agents` returns 7 agents 含 `indicators.llm_upstream` 字段 |
| 3 | watchdog 真 detect process death within 60s | manual kill llama-server → watchdog respawn within 60s + broadcast on chain |
| 4 | T1 + T2 + INVARIANTS test 全 pass (0 regression) | `node scripts/test.mjs --domain=broker` 全 pass |
| 5 | 0 false alarm | 正常 LLM running 时 watchdog 0 spurious restart |

5/5 全过 = T1 真 done.

---

## Out of scope (T1 严禁)

撞这些立即暂停 + broadcast architect:

1. ❌ 不修 LLM crash 真因 (5/3 forensic 没 catch crash signature, defer Phase 3 OR 撞再调查)
2. ❌ 不改 qclaude.bat (Owner manual tool, NWT/J2 不擅自动 modifier)
3. ❌ 不加 Slack/Email alert (本地 broadcast 上链 audit trail 即足)
4. ❌ 不改 Console main loop OR Relay child (watchdog independent process)
5. ❌ 不动 GPU config (driver / VRAM 等 OS 层不动)

---

## 5 Subtask 顺序

| # | 名 | mode | LOC | 时长 |
|---|---|---|---|---|
| T1.0 | grep KANet 现有 health infra 真签名 | implementor | 0 | 15 min |
| T1.1 | `/api/system/llm-health` endpoint | implementor | ~40 | 30 min |
| T1.2 | agent-health.js `llm_upstream` indicator | implementor | ~40 | 30 min |
| T1.3 | daemon watchdog (silent death detect + auto-restart) | implementor | ~50 | 1-2 hr |
| T1.4 | tests + invariant assertion | QA | ~30 | 30 min |
| T1.5 | system auto-verify | operator | 0 | 15 min |

总 ETA: ~3-5 hr.

---

## 详细 spec

### T1.0 — grep KANet 现有 health infra 真签名 (KI-2/3/4/5 防复刻硬纪律)

**硬纪律, 不可跳过**。 per Phase 1 KI-2/3/4/5 sediment + T2 v1.0/v1.1/v1.2/v1.3 4 cycles 实证: architect 起任务卡时 spec 部分凭印象, J2 grep verify 真签名 catch。

#### Action

```bash
cd /c/kanet

# 1. 现有 health endpoints 真签名
grep -nE "fastify\\.(get|post)\\(['\"]/health" /c/kanet/kasia-console/src/api/health.js | head -10

# 2. agent-health.js 真 structure (indicators object shape + computeAgentHealth signature)
grep -nE "^export|indicators\\s*=|function _intervalLight|function _countLight" /c/kanet/kasia-console/src/services/agent-health.js | head -20

# 3. llama-server / LiteLLM 真 health endpoints
curl -s -m 3 http://127.0.0.1:8000/health
curl -s -m 3 http://127.0.0.1:4000/health/liveliness

# 4. qclaude.bat 真 process spawn args (watchdog 复用)
grep -E "LLAMA_EXE|LITELLM_EXE|LLAMA_MODEL|LITELLM_CONFIG|--port|--host" /c/kanet/qclaude.bat | head -15

# 5. Console 现有 service spawn pattern (e.g. relay-manager.js)
grep -nE "fork|spawn|child_process" /c/kanet/kasia-console/src/services/relay-manager.js | head -10
```

#### 报告

每条 grep 真结果列:
- file:line 真 endpoint / function / signature
- 真 expected fields (request body / response shape)
- 跟此任务卡 spec 比对 (一致 / 部分 / 不一致)

撞 ⚠/❌ → broadcast architect 决策, 不擅自实施。

#### Verdict

- ✅ `api_verified` → T1.1 进
- ⚠ `partial_mismatch` → architect 修任务卡 spec
- ❌ `major_mismatch` → 暂停, architect 重审

---

### T1.1 — `/api/system/llm-health` endpoint

#### 目标

Console 暴露 LLM upstream functioning status — alive (process listening port) AND functioning (200 OK on health probe)。

#### Spec

```js
// kasia-console/src/api/health.js (extend existing)

fastify.get('/api/system/llm-health', async (request, reply) => {
  // Probe llama-server (port 8000) /health
  let llama = { alive: false, functioning: false, latency_ms: null };
  try {
    const t0 = Date.now();
    const res = await fetch('http://127.0.0.1:8000/health', { signal: AbortSignal.timeout(3000) });
    llama.alive = true;
    llama.latency_ms = Date.now() - t0;
    llama.functioning = res.ok;
  } catch (err) {
    // alive=false, functioning=false (port unreachable)
  }

  // Probe LiteLLM (port 4000) /health/liveliness
  let litellm = { alive: false, functioning: false, latency_ms: null };
  try {
    const t0 = Date.now();
    const res = await fetch('http://127.0.0.1:4000/health/liveliness', { signal: AbortSignal.timeout(3000) });
    litellm.alive = true;
    litellm.latency_ms = Date.now() - t0;
    litellm.functioning = res.ok;
  } catch (err) {}

  return reply.send({
    ts: new Date().toISOString(),
    llama_server: llama,
    litellm: litellm,
    overall: llama.functioning && litellm.functioning ? 'green' : (llama.alive || litellm.alive ? 'yellow' : 'red'),
  });
});
```

#### Anti-pattern

- ❌ 不长 timeout (≤3s, fail fast)
- ❌ 不 probe path 凭印象 (T1.0 grep 实证)
- ❌ 不 cache result (real-time check)

#### Acceptance

- ✅ curl /api/system/llm-health 返回 200 + correct shape
- ✅ kill llama-server → endpoint reflects alive=false within 3s
- ✅ kill LiteLLM but llama up → llama.alive=true, litellm.alive=false, overall=yellow

#### LOC: ~40

---

### T1.2 — agent-health.js `llm_upstream` indicator

#### 目标

集成 LLM upstream status 进 agent-health.js indicators (alive vs functioning 区分)。

#### Spec

```js
// kasia-console/src/services/agent-health.js (extend computeAgentHealth)

// 加 llm_upstream indicator (per agent, 但 query 全局 /api/system/llm-health)
async function computeAgentHealthWithLlm(agent) {
  const base = computeAgentHealth(agent); // existing T1 logic
  
  // Query LLM upstream functioning (cached 5s 减压)
  const llmStatus = await getLlmUpstreamStatus();
  
  base.indicators.llm_upstream = llmStatus.overall; // 'green' | 'yellow' | 'red'
  
  // Adjust overall status (if LLM down, agent functioning=false even if adapter alive)
  if (llmStatus.overall === 'red') {
    base.status = 'red';
    base.reason = 'llm_upstream_down';
  } else if (llmStatus.overall === 'yellow' && base.status === 'green') {
    base.status = 'yellow';
    base.reason = 'llm_upstream_degraded';
  }
  
  return base;
}

// Cache LLM status 5s (减少重复 probe 压力)
let _llmCache = null;
async function getLlmUpstreamStatus() {
  if (_llmCache && Date.now() - _llmCache.ts < 5000) return _llmCache.status;
  try {
    const res = await fetch('http://127.0.0.1:3100/api/system/llm-health', { signal: AbortSignal.timeout(3000) });
    const status = await res.json();
    _llmCache = { ts: Date.now(), status };
    return status;
  } catch {
    return { overall: 'red' };
  }
}
```

#### Anti-pattern

- ❌ 不 break existing indicators API (添加, NOT 替换)
- ❌ 不 LLM probe 每 agent 1 次 (cache 5s)
- ❌ 不 silent fail (cache miss = red, NOT green)

#### Acceptance

- ✅ /api/health/agents 返回 7 agents 含 `indicators.llm_upstream` 字段
- ✅ kill llama-server → agents status 全 'red' reason='llm_upstream_down' within 5s cache TTL
- ✅ T1 existing tests (per CLAUDE.md test-framework) 仍 pass

#### LOC: ~40

---

### T1.3 — daemon watchdog (silent death detect + auto-restart)

#### 目标

independent daemon process detect llama-server / LiteLLM silent death + auto-respawn (per qclaude.bat spawn pattern)。

#### Spec

```js
// kanet/scripts/llm-watchdog.mjs (NEW file, daemon mode)

import { spawn } from 'node:child_process';
import path from 'node:path';

const KANET_ROOT = process.env.KANET_ROOT || 'C:/kanet';
const LLAMA_EXE = `${KANET_ROOT}/tools/llama-server/llama-server.exe`;
const LLAMA_MODEL = `${KANET_ROOT}/models/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf`;
const LITELLM_EXE = 'C:/Users/ADMIN/AppData/Local/Programs/Python/Python310/Scripts/litellm.exe';
const LITELLM_CONFIG = `${KANET_ROOT}/tools/litellm-config.yaml`;
const PROBE_INTERVAL_MS = 60_000; // 1 min
const PROBE_TIMEOUT_MS = 3_000;
const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';

async function probe(url, timeoutMs = PROBE_TIMEOUT_MS) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch { return false; }
}

function spawnLlama() {
  const proc = spawn(LLAMA_EXE, [
    '--model', LLAMA_MODEL,
    '--host', '0.0.0.0', '--port', '8000',
    '--n-gpu-layers', '99',
    '--ctx-size', '262144',
    '--threads', '8',
    '--flash-attn', 'on',
  ], { detached: true, stdio: 'ignore', cwd: `${KANET_ROOT}/tools/llama-server` });
  proc.unref();
  console.log(`[watchdog] llama-server spawned PID ${proc.pid}`);
  return proc.pid;
}

function spawnLitellm() {
  const proc = spawn(LITELLM_EXE, [
    '--config', LITELLM_CONFIG,
    '--port', '4000', '--host', '0.0.0.0',
  ], { detached: true, stdio: 'ignore' });
  proc.unref();
  console.log(`[watchdog] litellm spawned PID ${proc.pid}`);
  return proc.pid;
}

async function broadcastAlarm(message) {
  try {
    await fetch('http://127.0.0.1:3100/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId: NWT_RELAY_ID, channel: 'dev-coord', message }),
    });
  } catch (err) {
    console.error('[watchdog] broadcast failed:', err.message);
  }
}

async function watchdogTick() {
  const llamaOk = await probe('http://127.0.0.1:8000/health');
  const litellmOk = await probe('http://127.0.0.1:4000/health/liveliness');
  
  if (!llamaOk) {
    const pid = spawnLlama();
    await broadcastAlarm(`[watchdog] 🔴 llama-server DOWN detected, respawned PID ${pid} @ ${new Date().toISOString()}`);
  }
  if (!litellmOk) {
    const pid = spawnLitellm();
    await broadcastAlarm(`[watchdog] 🔴 LiteLLM DOWN detected, respawned PID ${pid} @ ${new Date().toISOString()}`);
  }
}

console.log(`[watchdog] starting, probe interval ${PROBE_INTERVAL_MS}ms`);
setInterval(watchdogTick, PROBE_INTERVAL_MS);
watchdogTick(); // boot tick
```

启动方式: `node scripts/llm-watchdog.mjs &` OR Windows scheduled task at boot OR nodemon-style supervisor。

#### Anti-pattern

- ❌ 不 watchdog 自身 hard-code paths (env var override 守)
- ❌ 不 watchdog 0 broadcast (silent restart = silent 盲区 复刻)
- ❌ 不 spawn 不 detach (parent kill cascade)
- ❌ 不重试无 cap (deterministic crash → infinite respawn loop)

#### Acceptance

- ✅ kill llama-server → watchdog respawn within 60s + broadcast on chain
- ✅ kill LiteLLM → watchdog respawn within 60s + broadcast
- ✅ 正常 running 时 watchdog 0 spurious restart
- ✅ watchdog 自身 die → manual restart (Phase 3 candidate: PM2 OR systemd)

#### LOC: ~50

---

### T1.4 — tests + invariant assertion

#### 单元测试

```js
// kasia-console/test-framework/cases/system/llm-health.test.mjs

test('/api/system/llm-health returns correct shape', async () => {
  const res = await fetchJson('http://127.0.0.1:3100/api/system/llm-health');
  assert.ok(res.llama_server);
  assert.ok(typeof res.llama_server.alive === 'boolean');
  assert.ok(typeof res.llama_server.functioning === 'boolean');
  assert.ok(['green', 'yellow', 'red'].includes(res.overall));
});

test('agent-health.js indicators 含 llm_upstream', async () => {
  const res = await fetchJson('http://127.0.0.1:3100/api/health/agents');
  for (const a of res.agents) {
    assert.ok(['green', 'yellow', 'red'].includes(a.indicators.llm_upstream));
  }
});

test('watchdog probe 函数正确', async () => {
  // mock-style unit, watchdog.mjs export probe + check return type
});
```

#### Invariant assertion (per CLAUDE.md test-framework)

加 1 source-level invariant: `agent-health.js` 必含 'llm_upstream' indicator (防 future 误删)

#### LOC: ~30

---

### T1.5 — system auto-verify

operator hat 跑 verify:

```bash
# 1. /api/system/llm-health endpoint live
curl -s http://127.0.0.1:3100/api/system/llm-health

# 2. agent-health 集成 llm_upstream
curl -s http://127.0.0.1:3100/api/health/agents | head -c 500

# 3. watchdog daemon 真 detect (manual kill test)
powershell -Command "Stop-Process -Name 'llama-server' -Force"
sleep 70
curl -s http://127.0.0.1:8000/health  # 真 alive (watchdog respawned)

# 4. broadcast verify
# Query broadcast_messages last 2 min, find watchdog 🔴 alarm
```

5/5 全过 → T1 close.

---

## Anti-pattern (per Owner 钦定 + Phase 1 sediment)

- ❌ 不 silent failure (per KI-9 outer try/catch silent swallow)
- ❌ 不 alive-only check (per KI-16 alive vs functioning 区分)
- ❌ 不 fork qclaude.bat (Owner manual tool, NWT/J2 不动)
- ❌ 不 watchdog 0 broadcast (per KI-9 反模式)
- ❌ 不擅自设计修法 (per Anti-pattern, J2 grep verify + spec follow)

---

## RFC ref

- Owner 5/3 钦定 KI-16 + r140 sketch X.1+X.2+X.3 三件全要
- Phase 1 KI-16 (LLM health alive vs functioning) sediment
- INVARIANTS v0.1 §4.1 (alive vs functioning) + 4.3 (sediment 三阶段)
- Owner 5/3 KI-20 (0-user 加速) — Phase 2 第一 ship 优先 #1

---

## 接位 SOP (J2 接此任务)

1. 读 docs/INVARIANTS.md v0.1 §4
2. 读本任务卡
3. **先跑 T1.0 grep, broadcast 验 KANet API 真签名**
4. NWT cross-review verdict 后进 T1.1
5. 每 subtask commit 后等 cross-review

撞 Definition of NOT Done → 暂停 + broadcast architect.

---

## Definition of NOT Done

撞这些立即暂停:

1. T1.0 grep 发现 KANet API spec 跟任务卡严重不一致 → architect 修
2. /api/system/llm-health 撞 path 已存在不同 owner → architect 决路径 rename
3. agent-health.js 现有 indicators 跟 spec 不一致 → architect 重审
4. watchdog spawn 撞 Windows 权限 OR PATH 问题 → broadcast operator 决
5. T1 + T2 测试任 1 fail → revert + 重审 watchdog hook
6. watchdog 自身 silent crash → KI-9 复刻, broadcast architect 重审

---

*v1.0 — 2026-05-03 NWT cross-hat architect (per Owner 5/3 全自动 0 干预 authorize). Phase 2 第一 ship 候选 (per retro §4 backlog NWT 倾顺序 #1). KI-16 真 silent 盲区 fix 实施.*
