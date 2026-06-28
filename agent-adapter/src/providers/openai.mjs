// providers/openai.mjs — OpenAI-compatible provider
//
// Works with: OpenAI, DeepSeek, Ollama, vLLM, Groq, Together, Mistral,
//             LM Studio, and any service exposing /v1/chat/completions
//
// Config:
//   AI_PROVIDER_URL  — base URL (e.g. https://api.openai.com/v1, http://localhost:11434/v1)
//   AI_PROVIDER_KEY  — API key (set to "ollama" or any string for local services)
//   AI_MODEL         — model name (e.g. gpt-4o, deepseek-chat, llama3, claude-sonnet-4-20250514)

/**
 * JSON.stringify that escapes all non-ASCII characters to \uXXXX.
 * Some API parsers (x.ai, Deepseek) have bugs with literal UTF-8 multi-byte
 * characters in large payloads. ASCII-safe JSON avoids the issue entirely.
 */
function asciiSafeStringify(obj) {
  // Force ASCII-safe JSON for API parsers that choke on UTF-8 or surrogate pairs.
  // 1. JSON.stringify (may produce literal UTF-16 surrogates for emoji)
  // 2. Replace literal non-ASCII chars with \uXXXX, strip surrogate pairs
  // 3. Remove any textual \ud800-\udfff surrogate escapes that snuck in from data
  const json = JSON.stringify(obj);
  let result = '';
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    if (code <= 0x7F) {
      result += json[i];
    } else if (code >= 0xD800 && code <= 0xDBFF) {
      i++; // skip low surrogate
      result += ' ';
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      // lone low surrogate — skip
    } else {
      result += '\\u' + code.toString(16).padStart(4, '0');
    }
  }
  // Final pass: remove textual surrogate escapes (\ud800-\udfff) that came from pre-encoded data
  return result.replace(/\\ud[89a-f][0-9a-f]{2}/gi, ' ');
}

import { getAuth, recover401, isLegacyMode } from './resolve-auth.mjs';

// Legacy env vars (used only when ADAPTER_ID is not set)
const _LEGACY_BASE_URL = (process.env.AI_PROVIDER_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const _LEGACY_API_KEY  = process.env.AI_PROVIDER_KEY  || "";
const _LEGACY_MODEL    = process.env.AI_MODEL         || "gpt-4o";
const TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || "180000");

function log(...args) {
  console.log(new Date().toISOString(), "[openai]", ...args);
}

export const name = "openai";

/**
 * @param {string} message        - user message (or full prompt if no system)
 * @param {string} idempotencyKey - unique key per request
 * @param {object} [options]      - { system?: string } for layered context
 * @returns {Promise<string>}     - AI reply text
 */
/**
 * Sanitize text for strict API parsers (e.g. Grok/xAI).
 * Some providers treat lone backslash sequences like \x, \u as hex/unicode escapes
 * even inside JSON strings, causing "unexpected end of hex escape" errors.
 * Replace problematic lone backslashes with safe alternatives.
 */
function sanitizeForApi(text) {
  if (!text || typeof text !== 'string') return text;
  // Replace lone backslash sequences that some providers (Grok/xAI) choke on.
  // Note: x.ai has a deeper JSON parser bug with large payloads (>15KB) — this
  // doesn't fully fix it. Use Deepseek/OpenAI for agents with large context.
  return text
    .replace(/\\x(?![0-9a-fA-F]{2})/g, '\\\\x')
    .replace(/\\u(?![0-9a-fA-F]{4})/g, '\\\\u')
    .replace(/\\0(?![0-7])/g, '\\\\0');
}

// ── Codex Responses API adapter ─────────────────────────────────────────
// OAuth tokens use chatgpt.com/backend-api/codex/responses (different format)

function _isCodexEndpoint(baseUrl) {
  return baseUrl && baseUrl.includes('chatgpt.com/backend-api');
}

function _buildCodexBody(model, message, system) {
  // Codex Responses API format: { model, instructions (required), input (array of {role, content}) }
  const body = { model };
  body.instructions = sanitizeForApi(system || 'You are a helpful AI assistant.');
  body.input = [{ role: 'user', content: sanitizeForApi(message) }];
  body.store = false;
  body.stream = true;
  return JSON.stringify(body);
}

function _parseCodexSSE(text) {
  // Parse SSE stream: collect output_text.delta events into full text
  let fullText = '';
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const evt = JSON.parse(line.slice(6));
      if (evt.type === 'response.output_text.delta') fullText += evt.delta;
    } catch {}
  }
  return fullText;
}

// ── Idempotency cache (D5 hash + 5min TTL + max 1000 entries lazy GC) ──
// T-NWT-2026-04-30 RFC r49-r52 D5: 防 retry 同 content 重复 LLM call.
// hash key = JSON of {model, system, message, tools} via crypto SHA-256.
// max 1000 entries防 memory leak; lazy GC sweep 过期 + FIFO 满时 oldest evict.
const _idempotencyCache = new Map();
const CACHE_MAX = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function _cacheKey({ model, system, message, messages, tools, tool_choice, peer }) {
  const { createHash } = await import('node:crypto');
  const h = createHash('sha256');
  // J2 r54 fix: 加 tool_choice; J2 r58 dimension: 加 messages (multi-turn history) — 同 model+system 不同 messages
  // 行为不同, 不可 cache hit 错位. messages || single-message fallback 统一形式.
  // T-J2-2026-05-10 SC6a (triage T3): 加 peer — 防 cross-peer cache pollution。
  // baseline trace 实证 5 fresh peer 同 user msg ('我想卖一点 kas') → 同 hash → 5min TTL cache hit
  // 拿别 peer cached reply → broker dialog reply 错位 (owner_88kas_verbatim Step 1 1ms cache hit signature)。
  // 加 peer 后 per-peer 隔离, Mind/Brain (per-agent peer 固定) cache hit 不破。
  const normalizedMessages = messages || (message ? [{ role: 'user', content: message }] : []);
  h.update(JSON.stringify({ model, system: system || '', messages: normalizedMessages, tools: tools || null, tool_choice: tool_choice || null, peer: peer || null }));
  return h.digest('hex');
}

// J2 r58 dimension: messages array sanitize 策略
// - messages[i].content (user/system/assistant text) — sanitize 必 apply (ASCII safety)
// - messages[i].tool_calls[j].function.arguments (JSON 字符串) — 不 sanitize (D2 raw passthrough)
// - messages[i].tool_call_id / name — schema field 不动
function _sanitizeMessage(m) {
  if (!m || typeof m !== 'object') return m;
  if (m.role === 'tool') {
    // tool response message — content 是 tool execution 结果 JSON, 不 sanitize 防 strip
    return m;
  }
  if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
    // assistant with tool_calls — content sanitize, tool_calls 数组 raw passthrough
    return {
      ...m,
      content: m.content ? sanitizeForApi(m.content) : null,
      tool_calls: m.tool_calls,
    };
  }
  // user/system/assistant plain text — content sanitize
  return { ...m, content: sanitizeForApi(m.content || '') };
}

function _cacheGet(key) {
  const e = _idempotencyCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { _idempotencyCache.delete(key); return null; }
  return e.result;
}

function _cacheSet(key, result) {
  if (_idempotencyCache.size >= CACHE_MAX) {
    // lazy GC: sweep expired first
    for (const [k, v] of _idempotencyCache) {
      if (Date.now() > v.expiresAt) _idempotencyCache.delete(k);
      if (_idempotencyCache.size < CACHE_MAX) break;
    }
    // 满时 FIFO oldest evict
    if (_idempotencyCache.size >= CACHE_MAX) {
      _idempotencyCache.delete(_idempotencyCache.keys().next().value);
    }
  }
  _idempotencyCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Main ask function ───────────────────────────────────────────────────
//
// T-NWT-2026-04-30 RFC r49-r52 阶段 1 (D1-D14 共识 lock):
// - D1 backward-compat: ask() 返 string (mind brain 不变), askWithTools 别名返 {content, tool_calls?}
// - D2 双向 raw passthrough: tools/tool_calls.arguments 不经 sanitizeForApi
// - D5 idempotency cache: hash + 5min TTL + max 1000 lazy GC
// - D6 ask({system}): caller 不感知 OpenAI message format, system + sysPromptAppend merge 单 system role
// - D7 trace_id propagation: options.trace_id 透传 (broker jsonl audit 用, brain 不用)

export async function ask(message, idempotencyKey, options) {
  // Resolve auth: dynamic (Console) or legacy (env vars)
  let baseUrl, authHeaders, model;
  if (isLegacyMode()) {
    baseUrl = _LEGACY_BASE_URL;
    authHeaders = _LEGACY_API_KEY ? { "Authorization": `Bearer ${_LEGACY_API_KEY}` } : {};
    model = _LEGACY_MODEL;
  } else {
    const auth = await getAuth();
    baseUrl = (auth.baseUrl || _LEGACY_BASE_URL).replace(/\/+$/, "");
    authHeaders = auth.headers || {};
    model = auth.model || _LEGACY_MODEL;
  }

  const isCodex = _isCodexEndpoint(baseUrl);
  const hasSystem = options?.system;
  // D1 + D2: tools optional; if present, returnAsObject = true (caller receives {content, tool_calls?})
  // tools/tool_choice 不经 sanitizeForApi (D2 raw passthrough); user message + system text 仍 sanitize.
  const tools = options?.tools;
  const tool_choice = options?.tool_choice;
  const returnAsObject = Array.isArray(tools) && tools.length > 0;
  const traceId = options?.trace_id;  // D7 propagation, 可空
  // J2 r58: options.messages 优先 (broker multi-turn path), 否则 fallback single message + options.system (mind brain unchanged)
  const callerMessages = Array.isArray(options?.messages) ? options.messages : null;
  log("→", idempotencyKey.slice(0, 16), `[${model}]${isCodex ? ' [codex]' : ''}${returnAsObject ? ' [tools]' : ''}${callerMessages ? ` [msgs=${callerMessages.length}]` : ''}${traceId ? ` [trace=${traceId.slice(0, 8)}]` : ''}`, hasSystem ? `sys=${options.system.length}c` : '', callerMessages ? `(history)` : JSON.stringify(message).slice(0, 50));

  // D5 idempotency cache check — pre-fetch
  // T-J2-2026-05-10 SC6a: peer 透传 _cacheKey (防 cross-peer cache pollution)。
  const cacheKey = await _cacheKey({ model, system: options?.system, message, messages: callerMessages, tools, tool_choice, peer: options?.peer });
  const cached = _cacheGet(cacheKey);
  if (cached) {
    log("← [cache hit]", typeof cached === 'string' ? cached.slice(0, 80) : JSON.stringify(cached).slice(0, 80));
    return cached;
  }

  // Build request based on API format
  let url, body;
  if (isCodex) {
    if (returnAsObject) throw new Error('Codex endpoint does not support tools — use OpenAI-compatible endpoint');
    if (callerMessages) throw new Error('Codex endpoint does not support raw messages array — use OpenAI-compatible endpoint');
    url = `${baseUrl}/codex/responses`;
    body = _buildCodexBody(model, message, options?.system);
  } else {
    url = `${baseUrl}/chat/completions`;
    let messages;
    if (callerMessages) {
      // J2 r58 broker multi-turn path — caller-supplied messages array, system 仍 prepend
      // J2 r60 dimension defensive guard: callerMessages 不可含 role:system (D6 共识 lock).
      // assert error 让 caller bug 暴 (loud fail) 防 dual-prepend system → R37 双 sysmsg 撞 Qwen Jinja 拒.
      if (callerMessages.length > 0 && callerMessages[0]?.role === 'system') {
        throw new Error('callerMessages 不可含 role:system (D6 共识) — pass via options.system instead');
      }
      messages = [];
      if (hasSystem) messages.push({ role: "system", content: sanitizeForApi(options.system) });
      for (const m of callerMessages) messages.push(_sanitizeMessage(m));
    } else {
      // legacy single-message path (mind brain unchanged) — D11 0 regression
      messages = [];
      if (hasSystem) messages.push({ role: "system", content: sanitizeForApi(options.system) });
      messages.push({ role: "user", content: sanitizeForApi(message) });
    }
    // Qwen3 kill switch (QWEN-RULES.md Rule 11): 关 reasoning, /no_think 无效.
    // 仅在 model 名含 Qwen 时加, 防止非 Qwen provider 报字段错.
    const payload = { model, messages };
    if (/qwen|qwythos/i.test(model || "")) {
      payload.chat_template_kwargs = { enable_thinking: false };
    }
    // D2 双向 raw passthrough: tools/tool_choice 不 sanitize (JSON schema fragment 完整传)
    if (returnAsObject) {
      payload.tools = tools;
      if (tool_choice) payload.tool_choice = tool_choice;
    }
    body = asciiSafeStringify(payload);
  }

  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // 401 recovery: clear cache, force refresh, retry once
  if (res.status === 401 && !isLegacyMode()) {
    log("401 — attempting auth recovery");
    const newAuth = await recover401();
    if (newAuth) {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(newAuth.headers || {}) },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    }
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    if (res.status === 400 && errBody.includes('hex')) {
      try {
        const fs = await import('fs');
        const dumpPath = `${process.env.KANET_ROOT || 'D:/Anthropic'}/failing-payload.json`;
        fs.writeFileSync(dumpPath, body);
        log(`DUMPED failing payload (${body.length} bytes) to ${dumpPath}`);
      } catch {}
    }
    throw new Error(`AI API error ${res.status}: ${errBody.slice(0, 200)}`);
  }

  let reply;
  if (isCodex) {
    const sseText = await res.text();
    reply = _parseCodexSSE(sseText);
  } else {
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    // reasoning 模型（glm4.7, qwen-thinking）有时 content 为空, reasoning_content 里才是真输出
    const content = msg?.content || msg?.reasoning_content || "";
    if (returnAsObject) {
      // D1 + D2: tools mode 返 {content, tool_calls?}.
      // tool_calls.arguments 是 JSON 字符串 — 不 sanitize (D2 双向 raw passthrough).
      const tool_calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : null;
      if (!content && !tool_calls) throw new Error("AI returned empty response");
      reply = { content, ...(tool_calls ? { tool_calls } : {}) };
    } else {
      reply = content;
    }
  }

  // Codex / non-tools path 仍要求 reply 非空 string
  if (!returnAsObject && !reply) throw new Error("AI returned empty response");

  // D5 idempotency cache set
  _cacheSet(cacheKey, reply);

  log("←", returnAsObject ? `[content=${(reply.content || '').length}c, tool_calls=${reply.tool_calls?.length || 0}]` : reply.slice(0, 80));
  return reply;
}

// D1 askWithTools 别名 — broker 业务调用入口, 类型契约: 必返 {content, tool_calls?}
// (即使 caller 没传 tools, 仍包成 object — 保 type-safe contract for broker callers).
// implementation: 共享 ask() 主体, askWithTools 强制 returnAsObject=true.
export async function askWithTools(message, idempotencyKey, options = {}) {
  const result = await ask(message, idempotencyKey, options);
  // 兼容: 如 caller 没传 tools 但走 askWithTools (e.g. dialog without tool calling),
  // ask() 返 string → 包成 {content: string} 保契约.
  if (typeof result === 'string') return { content: result };
  return result;
}
