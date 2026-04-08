/**
 * resolve-auth.mjs — Shared auth resolution for all providers.
 *
 * All providers call getAuth() before each AI request instead of reading env vars.
 * Console is the single source of truth for credentials.
 *
 * Flow:
 *   1. Check local cache (valid if: not expired, >5min to expiry, no 401)
 *   2. No cache → GET Console /api/auth/resolve-by-adapter/:adapterId
 *   3. Use returned headers + baseUrl + model
 *   4. On 401 → clear cache, resolve(force_refresh=true), retry once
 *
 * Design ref: Adapter升级建议方案.txt §7-§9
 */

const CONSOLE_URL = (process.env.CONSOLE_URL || 'http://localhost:3100').replace(/\/+$/, '');
const ADAPTER_ID  = process.env.ADAPTER_ID || '';

// ── Local cache ───────────────────────────────────────────────────────────

let _cache = null;  // { auth, cachedAt }

const CACHE_TTL_MS   = 55 * 60_000;  // 55 min max cache (API keys don't expire, OAuth ~1h)
const CACHE_MARGIN_MS = 5 * 60_000;  // Must be >5 min from expiry to use cache

function _cacheValid() {
  if (!_cache) return false;
  const now = Date.now();
  // Stale by TTL
  if (now - _cache.cachedAt > CACHE_TTL_MS) return false;
  // Near expiry
  if (_cache.auth.expiresAt) {
    const expiresMs = new Date(_cache.auth.expiresAt).getTime();
    if (expiresMs - now < CACHE_MARGIN_MS) return false;
  }
  return true;
}

function _clearCache() {
  _cache = null;
}

// ── Resolve from Console ──────────────────────────────────────────────────

async function _fetchAuth(forceRefresh = false) {
  const adapterId = ADAPTER_ID;
  if (!adapterId) {
    throw new Error('ADAPTER_ID not set — cannot resolve auth');
  }

  const qs = forceRefresh ? '?force_refresh=true' : '';
  const url = `${CONSOLE_URL}/api/auth/resolve-by-adapter/${adapterId}${qs}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Auth resolve failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const auth = await res.json();

  // Check for error status
  if (auth.errorCode) {
    const err = new Error(auth.errorMessage || auth.errorCode);
    err.authStatus = auth.status;
    err.authErrorCode = auth.errorCode;
    throw err;
  }

  return auth;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Get current auth context. Uses cache when valid, fetches from Console otherwise.
 * @returns {Promise<{headers: object, baseUrl: string, model: string, provider: string, credentials?: object}>}
 */
export async function getAuth() {
  if (_cacheValid()) return _cache.auth;

  const auth = await _fetchAuth(false);
  _cache = { auth, cachedAt: Date.now() };
  return auth;
}

/**
 * Handle a 401 from the AI provider: clear cache, force refresh, return new auth.
 * Caller should retry the request ONCE with the new auth.
 *
 * @returns {Promise<{headers: object, baseUrl: string, ...} | null>}
 *   Returns new auth if recovery succeeded, null if unrecoverable.
 */
export async function recover401() {
  _clearCache();

  try {
    const auth = await _fetchAuth(true);

    // Only retry if status indicates credentials are (now) valid
    if (auth.status === 'connected' || auth.status === 'expiring') {
      _cache = { auth, cachedAt: Date.now() };
      return auth;
    }

    // Unrecoverable: expired, revoked, reauth_required, refresh_failed
    console.log(new Date().toISOString(), '[resolve-auth] 401 recovery failed: status =', auth.status);
    return null;
  } catch (err) {
    console.log(new Date().toISOString(), '[resolve-auth] 401 recovery error:', err.message);
    return null;
  }
}

/**
 * Check if we're in legacy mode (no ADAPTER_ID set, using env vars directly).
 * During Phase 2 migration, adapters that haven't been restarted with ADAPTER_ID
 * will still use env vars.
 */
export function isLegacyMode() {
  return !ADAPTER_ID;
}
