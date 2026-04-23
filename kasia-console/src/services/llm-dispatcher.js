import { sqlite } from '../db/client.js';

const QWEN_URL = 'http://192.168.1.123:8000/v1/chat/completions';
const OPUS_BRIDGE_URL = 'http://localhost:9100/v1/chat/completions';
const TIMEOUT_MS = 20000;

/**
 * LLM 调用抽象. Phase 1 默认 qwen 实装, opus 走 cc-bridge 失败 fallback qwen.
 */
export async function callLlm({ backend = 'qwen', system, user, maxTokens = 2500, temperature = 0.2 }) {
  const url = backend === 'opus' ? OPUS_BRIDGE_URL : QWEN_URL;
  const model = backend === 'opus' ? 'claude-code' : 'Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf';
  try {
    const body = {
      model, max_tokens: maxTokens, temperature,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    };
    // Qwen3.6 kill switch: chat_template_kwargs 关 reasoning, /no_think 无效.
    // 不加这个 Qwen 会在 reasoning_content 吃光 tokens, content 空, 延迟 8x.
    // (实测 4/23: reasoning=0c content 163c ↔ reasoning=2756c content 0c).
    if (backend === 'qwen') {
      body.chat_template_kwargs = { enable_thinking: false };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const j = await res.json();
    // content 应该非空 (kill switch 生效后). fallback reasoning_content 仅作保险.
    const content = j.choices?.[0]?.message?.content || '';
    const reasoning = j.choices?.[0]?.message?.reasoning_content || '';
    const text = content || reasoning;
    return { ok: true, backend, text };
  } catch (err) {
    if (backend === 'opus') {
      console.warn(`[llm] opus failed: ${err.message}, falling back to qwen`);
      return callLlm({ backend: 'qwen', system, user, maxTokens, temperature });
    }
    return { ok: false, backend, error: err.message };
  }
}

export function extractJson(text) {
  if (!text) return null;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[1] || m[0]); } catch { return null; }
}
