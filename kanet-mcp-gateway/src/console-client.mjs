import { randomUUID } from 'node:crypto';

export class ConsoleApiError extends Error {
  constructor(message, { status = 500, code = 'console_api_error' } = {}) {
    super(message);
    this.name = 'ConsoleApiError';
    this.status = status;
    this.code = code;
  }
}

export class KanetConsoleClient {
  constructor({ baseUrl, internalToken, timeoutMs = 30_000, fetchFn = globalThis.fetch }) {
    if (typeof fetchFn !== 'function') throw new Error('A fetch implementation is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.internalToken = internalToken;
    this.timeoutMs = timeoutMs;
    this.fetchFn = fetchFn;
  }

  async request(path, { method = 'GET', body, requestId = randomUUID() } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-kanet-mcp-internal-token': this.internalToken,
          'x-kanet-mcp-request-id': requestId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = { error: `Console returned non-JSON HTTP ${response.status}` };
      }

      if (!response.ok) {
        throw new ConsoleApiError(
          String(payload?.detail || payload?.reason || payload?.error || `Console HTTP ${response.status}`).slice(0, 500),
          { status: response.status, code: payload?.error || 'console_http_error' },
        );
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new ConsoleApiError('Console request timed out', { status: 504, code: 'console_timeout' });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  listChannels() {
    return this.request('/api/internal/mcp/channels');
  }

  readMessages({ channel, after, limit }) {
    const query = new URLSearchParams({ channel });
    if (after) query.set('after', after);
    if (limit) query.set('limit', String(limit));
    return this.request(`/api/internal/mcp/messages?${query}`);
  }

  sendMessage({ channel, message }) {
    return this.request('/api/internal/mcp/messages', {
      method: 'POST',
      body: { channel, message },
    });
  }

  getStatus() {
    return this.request('/api/internal/mcp/status');
  }
}
