/**
 * OAuth API — OpenAI Codex OAuth flow.
 *
 * Flow:
 *   1. GET /api/oauth/openai/start?adapter_id=xxx  → redirect to auth.openai.com
 *   2. OpenAI redirects back → GET /api/oauth/openai/callback?code=xxx&state=xxx
 *   3. Console exchanges code for tokens, stores in agent_connections
 *   4. Browser shows success page / closes
 *
 * Uses PKCE (S256) as required by OpenAI.
 * Client ID is the public Codex CLI client (no client_secret needed).
 */
import { randomBytes, createHash } from 'crypto';
import http from 'node:http';
import { updateConnectionOAuth, getConnection, getConnectionByAdapter, createConnection, updateConnectionStatus } from '../services/connection-manager.js';

// ── OpenAI Codex OAuth config ──────────────────────────────────────────────

const OPENAI_CLIENT_ID     = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_TOKEN_URL     = 'https://auth.openai.com/oauth/token';
const OPENAI_SCOPES        = 'openid profile email offline_access';
const CODEX_BASE_URL       = 'https://chatgpt.com/backend-api';
const CALLBACK_PORT        = 1455;  // Must match OpenAI's registered redirect_uri for this client_id
const CALLBACK_PATH        = '/auth/callback';
const REDIRECT_URI         = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

// In-flight PKCE state (keyed by state param, TTL 5 min)
const _pendingFlows = new Map();

function _cleanupFlows() {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [key, val] of _pendingFlows) {
    if (val.createdAt < cutoff) _pendingFlows.delete(key);
  }
}

// ── PKCE helpers ───────────────────────────────────────────────────────────

function generateCodeVerifier() {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ── Routes ─────────────────────────────────────────────────────────────────

export async function registerOAuthRoutes(fastify) {

  /**
   * GET /api/oauth/openai/start?adapter_id=xxx
   * Initiates the OAuth flow. Opens in browser.
   */
  fastify.get('/api/oauth/openai/start', async (request, reply) => {
    const { adapter_id } = request.query;
    if (!adapter_id) {
      return reply.code(400).send({ error: 'adapter_id is required' });
    }

    _cleanupFlows();

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = randomBytes(16).toString('hex');

    // Store PKCE verifier for callback
    _pendingFlows.set(state, {
      codeVerifier,
      adapterId: adapter_id,
      createdAt: Date.now(),
    });

    const params = new URLSearchParams({
      client_id: OPENAI_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: OPENAI_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      codex_cli_simplified_flow: 'true',
    });

    // Start temporary callback server on port 1455 (OpenAI's registered redirect port)
    _startCallbackServer(state);

    const authUrl = `${OPENAI_AUTHORIZE_URL}?${params.toString()}`;
    console.log(`[oauth] OpenAI auth flow started for adapter ${adapter_id}`);
    return reply.redirect(authUrl);
  });

  // Callback is handled by the temporary server on port 1455 (see _startCallbackServer)
  // No Fastify route needed — OpenAI redirects to localhost:1455, not localhost:3100

  /**
   * POST /api/oauth/openai/refresh/:connectionId
   * Manual token refresh (Phase 3 — automatic refresh will be in connection-manager).
   */
  fastify.post('/api/oauth/openai/refresh/:connectionId', async (request, reply) => {
    const conn = getConnection(request.params.connectionId);
    if (!conn) return reply.code(404).send({ error: 'Connection not found' });
    if (conn.auth_mode !== 'oauth') return reply.code(400).send({ error: 'Not an OAuth connection' });

    if (!conn.refresh_token_enc) {
      updateConnectionStatus(conn.id, 'reauth_required', 'No refresh token');
      return reply.send({ ok: false, status: 'reauth_required' });
    }

    try {
      const { decrypt } = await import('../services/crypto.js');
      const refreshToken = decrypt(conn.refresh_token_enc);

      const tokenRes = await fetch(OPENAI_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: OPENAI_CLIENT_ID,
          refresh_token: refreshToken,
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text().catch(() => '');
        updateConnectionStatus(conn.id, 'refresh_failed', `Refresh failed: ${tokenRes.status}`);
        return reply.send({ ok: false, status: 'refresh_failed', error: errBody.slice(0, 200) });
      }

      const tokens = await tokenRes.json();
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : new Date(Date.now() + 3600 * 1000).toISOString();

      updateConnectionOAuth(conn.id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt,
      });

      console.log(`[oauth] Token refreshed for connection ${conn.id}`);
      return reply.send({ ok: true, status: 'connected', expiresAt });

    } catch (err) {
      updateConnectionStatus(conn.id, 'refresh_failed', err.message);
      return reply.send({ ok: false, status: 'refresh_failed', error: err.message });
    }
  });
}

// ── Temporary callback server on port 1455 ────────────────────────────────

let _callbackServer = null;

function _startCallbackServer(expectedState) {
  // Already running
  if (_callbackServer) return;

  _callbackServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);

    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDesc = url.searchParams.get('error_description');

    // Shut down callback server after handling
    _shutdownCallbackServer();

    if (error) {
      console.log(`[oauth] Authorization denied: ${error} — ${errorDesc}`);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(_resultPage(false, errorDesc || error));
      return;
    }

    if (!code || !state) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(_resultPage(false, 'Missing code or state'));
      return;
    }

    const flow = _pendingFlows.get(state);
    if (!flow) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(_resultPage(false, 'Invalid or expired state. Please try again.'));
      return;
    }
    _pendingFlows.delete(state);

    // Exchange code for tokens
    try {
      const tokenRes = await fetch(OPENAI_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: OPENAI_CLIENT_ID,
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: flow.codeVerifier,
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text().catch(() => '');
        console.log(`[oauth] Token exchange failed (${tokenRes.status}): ${errBody.slice(0, 300)}`);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(_resultPage(false, `Token exchange failed: ${tokenRes.status}`));
        return;
      }

      const tokens = await tokenRes.json();
      const { access_token, refresh_token, expires_in } = tokens;

      if (!access_token) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(_resultPage(false, 'No access token received'));
        return;
      }

      const expiresAt = expires_in
        ? new Date(Date.now() + expires_in * 1000).toISOString()
        : new Date(Date.now() + 3600 * 1000).toISOString();

      // Find or create OAuth connection for this adapter
      let conn = getConnectionByAdapter(flow.adapterId);
      if (conn && conn.auth_mode === 'oauth') {
        updateConnectionOAuth(conn.id, { accessToken: access_token, refreshToken: refresh_token, expiresAt });
      } else {
        const connId = createConnection({
          adapterNodeId: flow.adapterId,
          provider: 'openai',
          authMode: 'oauth',
          baseUrl: CODEX_BASE_URL,
          model: 'gpt-5.4',
        });
        updateConnectionOAuth(connId, { accessToken: access_token, refreshToken: refresh_token, expiresAt });
      }

      console.log(`[oauth] OpenAI OAuth connected for adapter ${flow.adapterId} (expires: ${expiresAt})`);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(_resultPage(true, 'Connected to OpenAI via ChatGPT subscription'));

    } catch (err) {
      console.log(`[oauth] Token exchange error: ${err.message}`);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(_resultPage(false, err.message));
    }
  });

  _callbackServer.listen(CALLBACK_PORT, () => {
    console.log(`[oauth] Callback server listening on port ${CALLBACK_PORT}`);
  });

  _callbackServer.on('error', (err) => {
    console.log(`[oauth] Callback server error: ${err.message}`);
    _callbackServer = null;
  });

  // Auto-shutdown after 5 minutes (in case user abandons flow)
  setTimeout(() => _shutdownCallbackServer(), 5 * 60_000);
}

function _shutdownCallbackServer() {
  if (_callbackServer) {
    _callbackServer.close();
    _callbackServer = null;
    console.log('[oauth] Callback server closed');
  }
}

// ── Result page HTML ──────────────────────────────────────────────────────

function _resultPage(success, message) {
  const color = success ? '#16a34a' : '#dc2626';
  const icon = success ? '&#10003;' : '&#10007;';
  const title = success ? 'Connected!' : 'Connection Failed';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>KANet — ${title}</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { text-align: center; max-width: 400px; padding: 40px; }
  .icon { font-size: 48px; color: ${color}; margin-bottom: 16px; }
  h2 { margin: 0 0 8px; }
  p { color: #9ca3af; font-size: 14px; margin: 0; }
  .close { margin-top: 24px; color: #6b7280; font-size: 12px; }
</style></head>
<body><div class="card">
  <div class="icon">${icon}</div>
  <h2>${title}</h2>
  <p>${message}</p>
  <p class="close">You can close this tab now.</p>
</div></body></html>`;
}
