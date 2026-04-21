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

// ── Main ask function ───────────────────────────────────────────────────

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
  log("→", idempotencyKey.slice(0, 16), `[${model}]${isCodex ? ' [codex]' : ''}`, hasSystem ? `sys=${options.system.length}c` : '', JSON.stringify(message).slice(0, 50));

  // Build request based on API format
  let url, body;
  if (isCodex) {
    url = `${baseUrl}/codex/responses`;
    body = _buildCodexBody(model, message, options?.system);
  } else {
    url = `${baseUrl}/chat/completions`;
    const messages = [];
    if (hasSystem) messages.push({ role: "system", content: sanitizeForApi(options.system) });
    messages.push({ role: "user", content: sanitizeForApi(message) });
    body = asciiSafeStringify({ model, messages });
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
    reply = msg?.content || msg?.reasoning_content || "";
  }

  if (!reply) throw new Error("AI returned empty response");

  log("←", reply.slice(0, 80));
  return reply;
}
