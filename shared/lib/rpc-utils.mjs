/**
 * Shared RPC utilities — used by both kasia-relay and kaspa-scout.
 *
 * Extracted 2026-03-27 to eliminate duplicate code.
 * Changes here affect both Relay and Scout.
 */

/**
 * Resolve Kaspa RPC URL.
 * Priority: env var → Console config API → null (use resolver).
 *
 * @param {string} consoleUrl — Console base URL (e.g. http://localhost:3100)
 * @returns {string|null} — WebSocket URL or null
 */
/**
 * strict local-only (KASPA_RPC_LOCAL_ONLY=1, 2026-09-13 设计 docs/2026-09-13-j2-local-only-strict-rpc-design-v0.1.md v0.2 S6/C7/C8):
 * relay/scout 子进程只信 env KASPA_RPC_URL; 未设 ⇒ throw(启动即暴露, 与 kasia-console rpc-health.js:19 同形), 不拉 console 配置、不进 Resolver。
 */
export function isStrictLocalOnly(env = process.env) { return env.KASPA_RPC_LOCAL_ONLY === '1'; }
export function assertStrictRpcEnv(env = process.env) {
  if (isStrictLocalOnly(env) && !env.KASPA_RPC_URL) {
    throw new Error('KASPA_RPC_URL not set under KASPA_RPC_LOCAL_ONLY=1 (strict local-only: no console-config / Resolver fallback)');
  }
}

export async function resolveRpcUrl(consoleUrl) {
  if (isStrictLocalOnly()) { assertStrictRpcEnv(); return process.env.KASPA_RPC_URL; }
  if (process.env.KASPA_RPC_URL) return process.env.KASPA_RPC_URL;
  if (consoleUrl) {
    try {
      const res = await fetch(`${consoleUrl}/api/config/rpc-url`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const { url } = await res.json();
        if (url) return url;
      }
    } catch {}
  }
  return null;
}

/**
 * Calculate exponential backoff delay for reconnection.
 *
 * @param {number} attempt — current attempt number (0-based)
 * @param {number} baseMs — base delay in ms (default 5000)
 * @param {number} maxMs — max delay in ms (default 60000)
 * @returns {number} — delay in ms
 */
export function backoffDelay(attempt, baseMs = 5000, maxMs = 60000) {
  return Math.min(baseMs * Math.pow(2, attempt), maxMs);
}
