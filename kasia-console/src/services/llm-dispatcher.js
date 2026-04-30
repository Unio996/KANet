// T-J2-2026-04-30 RFC 阶段 4 (Phase Y r49 共识 lock 14/14):
// LLM call 走框架 adapter (Owner 钦定 跳框架 = 严重错误).
// 删 hardcoded QWEN_URL / OPUS_BRIDGE_URL / chat_template_kwargs (adapter 自管 R11 conditional).
// 走 POST {adapter_url}/reply, adapter discovery via adapter_nodes.ai_model match.
//
// signature 不变 (D11 caller 0 regression): callLlm({backend, system, user, maxTokens, temperature})
// max_tokens / temperature 当前 adapter ask() 不接受, phase Z follow-up 加 options 字段 (PZ-LLM-T1).
//
// RFC chain ref: NWT r49 f83f8a03 + J2 r58 vote (A) 08690651 + NWT r65 71dc5acb9 (broker swap pattern)

import { sqlite } from '../db/client.js';

/**
 * adapter discovery — query adapter_nodes 找 backend 对应 adapter http_port.
 * 'qwen' → ai_model LIKE '%Qwen%' / 'opus' → ai_model LIKE '%opus%' / '%claude-code%'.
 */
function _getAdapterUrl(backend) {
  const pattern = backend === 'opus' ? '%claude-code%' : '%Qwen%';
  const a = sqlite.prepare(
    `SELECT http_port FROM adapter_nodes WHERE ai_model LIKE ? LIMIT 1`
  ).get(pattern);
  if (!a?.http_port) {
    throw new Error(`[llm-dispatcher] no adapter found for backend=${backend} (pattern=${pattern})`);
  }
  return `http://127.0.0.1:${a.http_port}/reply`;
}

/**
 * LLM 调用抽象. 阶段 4 swap → adapter HTTP. backend qwen/opus 经 adapter discovery 路由.
 * caller signature 不变 (market-rules-parser 等 0 改动 D11).
 */
export async function callLlm({ backend = 'qwen', system, user, maxTokens = 2500, temperature = 0.2 }) {
  try {
    const url = _getAdapterUrl(backend);
    const traceId = `dispatcher:${backend}:${Date.now()}`;
    const body = {
      peer: 'dispatcher-internal',
      message: user,
      system,                       // J2 r66 push back: body.system field (adapter dual-name accept)
      trace_id: traceId,
      txId: traceId,
      // note: max_tokens / temperature 当前 adapter ask() 不接收, phase Z PZ-LLM-T1 follow-up 加.
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`adapter HTTP ${res.status}`);
    const data = await res.json();
    return { ok: true, backend, text: data.reply || '' };
  } catch (err) {
    if (backend === 'opus') {
      console.warn(`[llm-dispatcher] opus failed: ${err.message}, falling back to qwen`);
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
