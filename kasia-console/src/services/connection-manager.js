/**
 * Connection Manager — dynamic credential management for AI providers.
 *
 * Core principle: Console owns all credentials. Adapter only consumes RequestAuthContext.
 * resolveRequestAuth() is the single entry point — Adapter calls it before each AI request.
 *
 * Phase 1: API Key + Gateway work through the new connection model.
 * Phase 3: OAuth + refresh will be added here.
 */
import { sqlite } from '../db/client.js';
import { encrypt, decrypt, makeTokenHint } from './crypto.js';
import { nowIso } from '../lib/time.js';
import { randomUUID } from 'crypto';

// ── CRUD ──────────────────────────────────────────────────────────────────

export function getConnection(id) {
  return sqlite.prepare('SELECT * FROM agent_connections WHERE id = ?').get(id);
}

export function getConnectionByAdapter(adapterNodeId) {
  return sqlite.prepare(
    'SELECT * FROM agent_connections WHERE adapter_node_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).get(adapterNodeId);
}

export function deleteConnection(id) {
  sqlite.prepare('DELETE FROM agent_connections WHERE id = ?').run(id);
}

export function getConnectionsByAdapter(adapterNodeId) {
  return sqlite.prepare('SELECT * FROM agent_connections WHERE adapter_node_id = ? ORDER BY updated_at DESC').all(adapterNodeId);
}

export function listConnections() {
  return sqlite.prepare(`
    SELECT c.*, a.name as adapter_name, a.http_port as adapter_port
    FROM agent_connections c
    LEFT JOIN adapter_nodes a ON c.adapter_node_id = a.id
    ORDER BY c.updated_at DESC
  `).all();
}

export function createConnection({ adapterNodeId, provider, authMode, baseUrl, model, apiKey, gatewayToken }) {
  const id = randomUUID();
  const now = nowIso();
  sqlite.prepare(`
    INSERT INTO agent_connections (id, adapter_node_id, provider, auth_mode, status, base_url, model,
      api_key_enc, gateway_token_enc, credential_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'connected', ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, adapterNodeId, provider, authMode, baseUrl || null, model || null,
    apiKey ? encrypt(apiKey) : null,
    gatewayToken ? encrypt(gatewayToken) : null,
    now, now
  );
  return id;
}

export function updateConnectionOAuth(id, { accessToken, refreshToken, expiresAt }) {
  const now = nowIso();
  const conn = getConnection(id);
  if (!conn) return;
  const newVersion = (conn.credential_version || 0) + 1;
  // refresh_after = 5 minutes before expiry
  const refreshAfter = expiresAt
    ? new Date(new Date(expiresAt).getTime() - 5 * 60_000).toISOString()
    : null;
  sqlite.prepare(`
    UPDATE agent_connections
    SET access_token_enc = ?, refresh_token_enc = COALESCE(?, refresh_token_enc),
        expires_at = ?, refresh_after = ?, status = 'connected',
        last_refresh_at = ?, last_refresh_error = NULL,
        credential_version = ?, updated_at = ?
    WHERE id = ?
  `).run(
    encrypt(accessToken),
    refreshToken ? encrypt(refreshToken) : null,
    expiresAt || null, refreshAfter,
    now, newVersion, now, id
  );
}

export function updateConnectionStatus(id, status, errorMsg) {
  sqlite.prepare(`
    UPDATE agent_connections SET status = ?, last_refresh_error = ?, updated_at = ? WHERE id = ?
  `).run(status, errorMsg || null, nowIso(), id);
}

// ── resolveRequestAuth (the architectural divide) ──────────────────────────

/**
 * Resolve current auth context for a connection.
 * Adapter calls this before each AI request.
 *
 * @param {string} connectionId
 * @param {boolean} forceRefresh - true after 401, triggers refresh attempt
 * @returns {object} RequestAuthContext
 */
export function resolveRequestAuth(connectionId, forceRefresh = false) {
  const conn = getConnection(connectionId);
  if (!conn) {
    return {
      connectionId,
      status: 'error',
      errorCode: 'AUTH_INVALID_CREDENTIAL',
      errorMessage: 'Connection not found',
    };
  }

  // ── API Key mode: always valid, no expiry ──
  if (conn.auth_mode === 'api_key') {
    const key = conn.api_key_enc ? decrypt(conn.api_key_enc) : '';
    return _buildContext(conn, _buildHeaders(conn.provider, key));
  }

  // ── Gateway mode: token doesn't expire (Phase 1) ──
  if (conn.auth_mode === 'gateway') {
    const token = conn.gateway_token_enc ? decrypt(conn.gateway_token_enc) : '';
    return {
      ..._buildContext(conn, {}),
      credentials: { token },
    };
  }

  // ── OAuth mode: check expiry, refresh if needed ──
  if (conn.auth_mode === 'oauth') {
    // Check if reauth is required (no refresh token, or previously marked)
    if (conn.status === 'reauth_required' || conn.status === 'revoked') {
      return {
        connectionId,
        provider: conn.provider,
        status: conn.status,
        errorCode: 'AUTH_REAUTH_REQUIRED',
        errorMessage: conn.last_refresh_error || 'Re-authorization required',
      };
    }

    const now = Date.now();
    const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : Infinity;
    const isExpired = expiresAt <= now;
    const isExpiring = expiresAt - now < 5 * 60_000; // < 5 min

    // If expired or force_refresh requested, attempt refresh
    if ((isExpired || forceRefresh) && conn.refresh_token_enc) {
      // Phase 3 will implement actual refresh here.
      // For now, mark as needing reauth if expired.
      if (isExpired) {
        updateConnectionStatus(conn.id, 'expired', 'Token expired — refresh not yet implemented');
        return {
          connectionId,
          provider: conn.provider,
          status: 'expired',
          errorCode: 'AUTH_EXPIRED',
          errorMessage: 'Token expired',
        };
      }
    }

    // Token still valid — return it
    if (conn.access_token_enc) {
      const accessToken = decrypt(conn.access_token_enc);
      const headers = _buildHeaders(conn.provider, accessToken);
      return {
        ..._buildContext(conn, headers),
        expiresAt: conn.expires_at,
        ...(isExpiring ? { warning: 'token_expiring_soon' } : {}),
      };
    }

    // No access token at all
    return {
      connectionId,
      provider: conn.provider,
      status: 'reauth_required',
      errorCode: 'AUTH_REAUTH_REQUIRED',
      errorMessage: 'No access token — authorization required',
    };
  }

  return {
    connectionId,
    status: 'error',
    errorCode: 'AUTH_PROVIDER_MISCONFIGURED',
    errorMessage: `Unknown auth_mode: ${conn.auth_mode}`,
  };
}

// ── Internal helpers ────────────────────────────────────────────────────────

function _buildHeaders(provider, key) {
  if (!key) return {};
  switch (provider) {
    case 'anthropic':
      return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    case 'openclaw':
      return {}; // OpenClaw uses WS frame auth, not HTTP headers
    default:
      // openai and all OpenAI-compatible providers
      return { 'Authorization': `Bearer ${key}` };
  }
}

function _buildContext(conn, headers) {
  return {
    connectionId: conn.id,
    provider: conn.provider,
    status: conn.status || 'connected',
    authScheme: conn.provider === 'anthropic' ? 'api_key' : 'bearer',
    baseUrl: conn.base_url || null,
    model: conn.model || null,
    headers,
    credentialVersion: conn.credential_version,
    errorCode: null,
    errorMessage: null,
  };
}

// ── Sync helper: ensure connection exists for adapter ──────────────────────

/**
 * Ensure an adapter_node has a corresponding agent_connection.
 * Called during adapter creation and startup.
 * If connection already exists, returns its id. Otherwise creates one.
 */
export function ensureConnection(adapterNodeId) {
  const existing = getConnectionByAdapter(adapterNodeId);
  if (existing) return existing.id;

  // Don't create empty api_key if an OAuth connection already exists for this adapter
  const all = getConnectionsByAdapter(adapterNodeId);
  const hasOAuth = all.some(c => c.auth_mode === 'oauth');
  if (hasOAuth) return all.find(c => c.auth_mode === 'oauth').id;

  // Read adapter_node to create connection from its current config
  const a = sqlite.prepare('SELECT * FROM adapter_nodes WHERE id = ?').get(adapterNodeId);
  if (!a) return null;

  const provider = a.ai_provider || 'openclaw';
  const authMode = (provider === 'openclaw') ? 'gateway' : 'api_key';
  const baseUrl = (provider === 'openclaw')
    ? (a.gateway_ws_url || 'ws://127.0.0.1:18789')
    : (a.ai_provider_url || null);

  return createConnection({
    adapterNodeId,
    provider,
    authMode,
    baseUrl,
    model: a.ai_model || null,
    apiKey: a.ai_provider_key_encrypted ? decrypt(a.ai_provider_key_encrypted) : null,
    gatewayToken: a.token_encrypted ? decrypt(a.token_encrypted) : null,
  });
}

// ── Refresh Worker (Phase 3) ──────────────────────────────────────────────

const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REFRESH_CHECK_INTERVAL = 60_000; // check every 60s
let _refreshTimer = null;

/**
 * Start background refresh worker.
 * Scans OAuth connections, refreshes tokens that are nearing expiry.
 */
export function startRefreshWorker() {
  if (_refreshTimer) return;
  _refreshTimer = setInterval(_checkAndRefresh, REFRESH_CHECK_INTERVAL);
  // Run once immediately after a short delay
  setTimeout(_checkAndRefresh, 5000);
  console.log('[connection-manager] Refresh worker started (60s interval)');
}

async function _checkAndRefresh() {
  const rows = sqlite.prepare(`
    SELECT * FROM agent_connections
    WHERE auth_mode = 'oauth'
      AND status IN ('connected', 'expiring')
      AND refresh_token_enc IS NOT NULL
      AND refresh_after IS NOT NULL
      AND refresh_after <= datetime('now')
  `).all();

  for (const conn of rows) {
    try {
      await _refreshConnection(conn);
    } catch (err) {
      console.log(`[connection-manager] Refresh failed for ${conn.id}: ${err.message}`);
    }
  }
}

async function _refreshConnection(conn) {
  // Single-flight: mark as refreshing to prevent concurrent refreshes
  const current = getConnection(conn.id);
  if (!current || current.status === 'refreshing') return;

  updateConnectionStatus(conn.id, 'refreshing', null);

  try {
    const refreshToken = decrypt(conn.refresh_token_enc);

    const res = await fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: OPENAI_CLIENT_ID,
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const failCount = (conn.credential_version || 0);
      // After 3 consecutive failures, mark as needing reauth
      if (failCount >= 3) {
        updateConnectionStatus(conn.id, 'reauth_required', `Refresh failed ${failCount} times: ${res.status}`);
      } else {
        updateConnectionStatus(conn.id, 'refresh_failed', `Refresh failed: ${res.status} ${errBody.slice(0, 100)}`);
      }
      return;
    }

    const tokens = await res.json();
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString();

    updateConnectionOAuth(conn.id, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresAt,
    });

    console.log(`[connection-manager] Refreshed token for connection ${conn.id} (expires: ${expiresAt})`);
  } catch (err) {
    updateConnectionStatus(conn.id, 'refresh_failed', err.message);
  }
}
