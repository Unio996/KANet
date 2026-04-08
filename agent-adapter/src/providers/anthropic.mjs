// providers/anthropic.mjs — Anthropic Claude API provider
//
// Config:
//   AI_PROVIDER_URL  — base URL (default: https://api.anthropic.com)
//   AI_PROVIDER_KEY  — Anthropic API key
//   AI_MODEL         — model name (e.g. claude-sonnet-4-20250514)

import { getAuth, recover401, isLegacyMode } from './resolve-auth.mjs';

const _LEGACY_BASE_URL = (process.env.AI_PROVIDER_URL || "https://api.anthropic.com").replace(/\/+$/, "");
const _LEGACY_API_KEY  = process.env.AI_PROVIDER_KEY  || "";
const _LEGACY_MODEL    = process.env.AI_MODEL         || "claude-sonnet-4-20250514";
const TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || "120000");
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || "1024");

function log(...args) {
  console.log(new Date().toISOString(), "[anthropic]", ...args);
}

export const name = "anthropic";

/**
 * @param {string} message        - user message (or full prompt if no system)
 * @param {string} idempotencyKey - unique key per request
 * @param {object} [options]      - { system?: string } for layered context
 * @returns {Promise<string>}     - AI reply text
 */
export async function ask(message, idempotencyKey, options) {
  // Resolve auth: dynamic (Console) or legacy (env vars)
  let baseUrl, authHeaders, model;
  if (isLegacyMode()) {
    baseUrl = _LEGACY_BASE_URL;
    authHeaders = { "x-api-key": _LEGACY_API_KEY, "anthropic-version": "2023-06-01" };
    model = _LEGACY_MODEL;
  } else {
    const auth = await getAuth();
    baseUrl = (auth.baseUrl || _LEGACY_BASE_URL).replace(/\/+$/, "");
    authHeaders = auth.headers || { "anthropic-version": "2023-06-01" };
    model = auth.model || _LEGACY_MODEL;
  }

  const url = `${baseUrl}/v1/messages`;
  const hasSystem = options?.system;
  log("→", idempotencyKey.slice(0, 16), `[${model}]`, hasSystem ? `sys=${options.system.length}c` : '', JSON.stringify(message).slice(0, 50));

  const reqBody = {
    model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: message }],
  };

  if (hasSystem) {
    reqBody.system = [
      { type: "text", text: options.system, cache_control: { type: "ephemeral" } },
    ];
  }

  const payload = JSON.stringify(reqBody);

  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: payload,
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
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    }
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const reply = data.content?.[0]?.text || "";

  if (!reply) throw new Error("Anthropic returned empty response");

  log("←", reply.slice(0, 80));
  return reply;
}
