// providers/index.mjs — Provider router
//
// Selects AI backend based on AI_PROVIDER env var.
// Each provider exports: { name, ask(message, idempotencyKey) → Promise<string> }
//
// Supported values:
//   openclaw  — OpenClaw Gateway (WebSocket, default for backward compat)
//   openai    — OpenAI-compatible API (OpenAI, DeepSeek, Ollama, vLLM, Groq, etc.)
//   anthropic — Anthropic Claude API

const PROVIDER_NAME = (process.env.AI_PROVIDER || "openclaw").toLowerCase();

let _provider = null;

export async function loadProvider() {
  switch (PROVIDER_NAME) {
    case "openclaw":
      _provider = await import("./openclaw.mjs");
      break;
    case "openai":
      _provider = await import("./openai.mjs");
      break;
    case "anthropic":
      _provider = await import("./anthropic.mjs");
      break;
    default:
      throw new Error(`Unknown AI_PROVIDER: "${PROVIDER_NAME}". Supported: openclaw, openai, anthropic`);
  }

  console.log(new Date().toISOString(), `[provider] loaded: ${_provider.name}`);
  return _provider;
}

/**
 * Send message to the configured AI provider.
 * @param {string} message        - user message / full prompt
 * @param {string} idempotencyKey - unique key per request
 * @param {object} [options]      - { system?: string } for layered context
 * @returns {Promise<string>}     - AI reply text
 */
export async function ask(message, idempotencyKey, options) {
  if (!_provider) await loadProvider();
  return _provider.ask(message, idempotencyKey, options);
}

export function getProviderName() {
  return PROVIDER_NAME;
}
