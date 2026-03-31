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
export async function resolveRpcUrl(consoleUrl) {
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
