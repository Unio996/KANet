// llm-mock-engine — LLM caller for mock user persona.
// Reuses Qwen3.6 server (broker-llm-agent same backend) but with persona system prompt.
// R11: chat_template_kwargs.enable_thinking=false (kill think tokens).

const QWEN_URL = process.env.LLM_BASE_URL || 'http://192.168.1.138:8000/v1';

export async function callLlm({ messages, chat_template_kwargs, max_tokens = 200, temperature = 0.7 }) {
  try {
    // R11: Qwen3.6 caller 必 chat_template_kwargs.enable_thinking=false. /no_think 真不 work.
    // ANTI-PATTERNS docs/QWEN-RULES.md
    const res = await fetch(`${QWEN_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.6-q4-km',
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
