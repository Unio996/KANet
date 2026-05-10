// llm-mock-engine — LLM caller for mock user persona.
// Reuses Qwen3.6 server (broker-llm-agent same backend) but with persona system prompt.
// R11: chat_template_kwargs.enable_thinking=false (kill think tokens).

// T-J2-2026-05-10 SC7 (triage T3): default URL 改 127.0.0.1:8000 (local Qwen worker), env override 保留。
// 旧默认 192.168.1.138:8000 是 LAN 节点专属, 在非-138 节点跑 timeout → empty reply → llm_mock_dialogue 全 turn 空。
const QWEN_URL = process.env.LLM_BASE_URL || 'http://127.0.0.1:8000/v1';
// 自动 fetch model name from /v1/models (默认 server first model), env override 保留。
let _cachedModel = null;
async function _resolveModel() {
  if (_cachedModel) return _cachedModel;
  if (process.env.LLM_MODEL) { _cachedModel = process.env.LLM_MODEL; return _cachedModel; }
  try {
    const r = await fetch(`${QWEN_URL}/models`, { signal: AbortSignal.timeout(5_000) });
    const d = await r.json();
    _cachedModel = d.data?.[0]?.id || d.models?.[0]?.name || 'qwen3.6-q4-km';
  } catch {
    _cachedModel = 'qwen3.6-q4-km';
  }
  return _cachedModel;
}

export async function callLlm({ messages, chat_template_kwargs, max_tokens = 200, temperature = 0.7 }) {
  try {
    const model = await _resolveModel();
    // R11: Qwen3.6 caller 必 chat_template_kwargs.enable_thinking=false. /no_think 真不 work.
    // ANTI-PATTERNS docs/QWEN-RULES.md
    const res = await fetch(`${QWEN_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_tokens,
        temperature,
        chat_template_kwargs: chat_template_kwargs || { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { text: '', error: `LLM HTTP ${res.status}` };
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { text, usage: data.usage };
  } catch (e) {
    return { text: '', error: e.message };
  }
}
