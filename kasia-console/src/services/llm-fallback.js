/**
 * LLM Fallback Chain — 3 tiers for resilience.
 *
 *   Tier 1: agent adapter (per-agent URL; default resolved adapter_nodes->env->:3031)
 *   Tier 2: cc-bridge (port 9100)                  — Claude Code if active
 *   Tier 3: llama-server (port 8000, Qwen3.6-35B)  — local always-available
 *
 * Owner 5/9 钦定: GLM 挂了 → Claude code 桥补上 → 本地兜底.
 * All three speak OpenAI /v1/chat/completions.
 */

// tier-1 default adapter URL (cron/无-agent 路径, 未传 adapterUrl 时用)。解析顺序(首次调用时定, 缓存+打日志来源):
//   ① adapter_nodes 里 is_enabled=1 的 http_port(多条取最近 updated_at) ② env KANET_DEFAULT_ADAPTER_URL ③ 常量 :3031。
// :3020 = stale since 2026-06-27(adapter_nodes 无此条、无 launcher 起、GLM4.7 从未上线)——保留仅作历史记号, 不再用。
const STALE_ADAPTER_URL_3020 = 'http://127.0.0.1:3020'; // stale since 2026-06-27, 不再用(见上)
const FALLBACK_ADAPTER_URL   = 'http://127.0.0.1:3031'; // adapter_nodes 唯一实配(Qwythos-9B, is_enabled=1, ->llama :8000/v1)
let _resolvedDefaultAdapterUrl = null; // 首次解析后缓存
const CC_BRIDGE_URL = 'http://127.0.0.1:9100';
const LLAMA_URL = 'http://127.0.0.1:8000';

const TIMEOUT_MS = 60_000; // 1 min per tier (fast fail to avoid stuck markets)

async function postJson(url, body, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveDefaultAdapterUrl() {
  if (_resolvedDefaultAdapterUrl) return _resolvedDefaultAdapterUrl;
  let url = null, src = null;
  // ① adapter_nodes is_enabled=1 http_port (懒 import + try/catch: 同进程复用已开连接; 独立脚本/DB 不可用则降级, 不引入 load 期依赖或环)
  try {
    const { sqlite } = await import('../db/client.js');
    const row = sqlite.prepare('SELECT http_port FROM adapter_nodes WHERE is_enabled = 1 AND http_port IS NOT NULL ORDER BY updated_at DESC LIMIT 1').get();
    if (row && row.http_port) { url = `http://127.0.0.1:${row.http_port}`; src = `adapter_nodes(is_enabled=1) http_port=${row.http_port}`; }
  } catch (e) { /* DB 不可用/独立脚本上下文 -> 降级到 env/常量 */ }
  // ② env override (kanet.env 可配, 默认不设)
  if (!url && process.env.KANET_DEFAULT_ADAPTER_URL) { url = process.env.KANET_DEFAULT_ADAPTER_URL; src = 'env KANET_DEFAULT_ADAPTER_URL'; }
  // ③ 常量兜底 :3031 (:3020 stale)
  if (!url) { url = FALLBACK_ADAPTER_URL; src = `constant ${FALLBACK_ADAPTER_URL} (:3020 stale since 2026-06-27)`; }
  _resolvedDefaultAdapterUrl = url;
  console.log(`[llm-fallback] default adapter URL resolved: ${url} (source: ${src})`);
  return url;
}

function extractText(openaiResp) {
  return openaiResp?.choices?.[0]?.message?.content ?? '';
}

async function tier1_agent_adapter(system, user, adapterUrl) {
  // KANet adapter contract: POST /reply { peer, mindUser, mindSystem, mindTask } → { reply }
  // Agent-specific adapter URL passed in (per scan target Agent).
  const url = adapterUrl || await resolveDefaultAdapterUrl();
  const r = await postJson(`${url}/reply`, {
    peer: 'bettor-scanner',
    mindUser: user,
    mindSystem: system,
    mindTask: true,
  });
  return r?.reply ?? '';
}

async function bettorQueueHasPoller() {
  // Heuristic: check if bridge has been polled for bettor-scanner queue recently.
  // Bridge cc/status doesn't expose per-queue poll, so assume false unless explicit.
  // TODO: extend bridge with per-queue poll-stamp; for now fall through to tier 3.
  return false;
}

async function ccBridgeActive() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`${CC_BRIDGE_URL}/cc/status`, { signal: ctrl.signal });
    if (!r.ok) return false;
    const j = await r.json();
    return !!j.cc_active;
  } catch {
    return false;
  }
}

async function tier2_bridge(system, user) {
  // Use bettor-scanner queue so it doesn't crash regular Claude Code chat.
  // Short timeout — if Claude isn't actively serving bettor queue, fall through fast.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(`${CC_BRIDGE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Queue': 'bettor-scanner' },
      body: JSON.stringify({
        model: 'claude-code',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return extractText(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

async function tier3_llama(system, user) {
  const r = await postJson(`${LLAMA_URL}/v1/chat/completions`, {
    model: 'local',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    // Qwen3.6 thinking-disable kill switch (per ANTI-PATTERNS.md Rule 11)
    chat_template_kwargs: { enable_thinking: false },
  });
  return extractText(r);
}

/**
 * Try agent-adapter → cc-bridge (if active) → llama in order.
 * Tier 1 uses the supplied agent's adapter URL (e.g., GLM, Qwen, Claude — whatever Agent uses).
 * Returns { ok, text, tier, error? }.
 *
 * @param {object} input
 * @param {string} input.system
 * @param {string} input.user
 * @param {string} [input.adapterUrl] - Agent-specific adapter URL (defaults to resolved adapter_nodes->env->:3031 if omitted)
 */
export async function callLLMWithFallback({ system = '', user, adapterUrl }) {
  // Tier 1: Agent's own adapter (whatever LLM that Agent is configured with)
  try {
    const text = await tier1_agent_adapter(system, user, adapterUrl);
    if (text && text.length > 0) return { ok: true, text, tier: 'agent' };
  } catch (e) {
    console.log(`[llm-fallback] tier 1 (agent adapter) failed: ${e.message}`);
  }

  // Tier 2: cc-bridge (only if Claude Code online AND bettor-scanner queue has a poller)
  // Without a queue-specific poller, this just hangs — better skip.
  if (await ccBridgeActive() && await bettorQueueHasPoller()) {
    try {
      const text = await tier2_bridge(system, user);
      if (text && text.length > 0) return { ok: true, text, tier: 'bridge' };
    } catch (e) {
      console.log(`[llm-fallback] tier 2 (cc-bridge) failed: ${e.message}`);
    }
  }

  // Tier 3: llama (last resort)
  try {
    const text = await tier3_llama(system, user);
    if (text && text.length > 0) return { ok: true, text, tier: 'llama' };
  } catch (e) {
    console.log(`[llm-fallback] tier 3 (llama) failed: ${e.message}`);
    return { ok: false, error: `all tiers failed; last: ${e.message}` };
  }

  return { ok: false, error: 'all tiers returned empty' };
}
