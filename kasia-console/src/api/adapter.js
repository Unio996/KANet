import { listAdapterNodes, getAdapterNode, createAdapterNode, updateAdapterNode, deleteAdapterNode, getAdapterToken, getAdapterProviderKey } from '../data/settings/adapter-nodes.js';
import { startAdapter, stopAdapter, restartAdapter, getAdapterStatus } from '../services/adapter-launcher.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import { getConfig } from '../data/settings/configs.js';
import { syncConnectionFromAdapter } from '../services/connection-manager.js';

// Fast health check (port only, <2s)
async function pingAdapter(port) {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {}
  return null;
}

// Deep API check cache: port → { apiOk, apiError, checkedAt }
const _apiCheckCache = {};

// 端口是可复用的：旧 adapter 删了，新建可能复用同一个 port，会继承旧 cache 的 404 状态
// 因此 create/update/delete 任一改变"port 背后实体"的操作发生时，主动失效该 port 的缓存。
function invalidateApiCheckCache(port) {
  if (port != null) delete _apiCheckCache[port];
}

// Deep check: call AI API, cache result for 2 minutes
// 超时放宽到 45s：推理模型（glm4.7 / qwen thinking 系列）首 token 前思考 10-30s 常见
async function deepCheckAdapter(port) {
  const cached = _apiCheckCache[port];
  if (cached && Date.now() - cached.checkedAt < 120_000) return cached;
  try {
    const res = await fetch(`http://localhost:${port}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // mindTask=true 走短路径，跳过 getContext/SYSTEM_PROMPT，给 reasoning 模型留空间
      body: JSON.stringify({ peer: '_ping', message: 'hi', mindTask: true }),
      signal: AbortSignal.timeout(45000),
    });
    const result = { apiOk: res.ok, apiError: null, checkedAt: Date.now() };
    if (!res.ok) result.apiError = (await res.text().catch(() => '')).slice(0, 100);
    _apiCheckCache[port] = result;
    return result;
  } catch (e) {
    const result = { apiOk: false, apiError: e.message, checkedAt: Date.now() };
    _apiCheckCache[port] = result;
    return result;
  }
}

export async function registerAdapterRoutes(fastify) {
  fastify.get('/adapters', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const adapters = listAdapterNodes();
    // Fast ping only — deep check moved to async frontend fetch
    const withStatus = await Promise.all(adapters.map(async a => {
      const managed = getAdapterStatus(a.id);
      const ping = await pingAdapter(a.http_port);
      const online = managed.running || !!ping;
      // Use cached deep check if available (non-blocking)
      const cached = _apiCheckCache[a.http_port];
      const apiOk = cached ? cached.apiOk : null;
      const apiError = cached ? cached.apiError : null;
      const _apiSt = !online ? 'offline' : (apiOk === true ? 'green' : (apiOk === false ? 'amber' : 'checking'));
      const _apiErr = (apiError || '').replace(/'/g, '');
      return { ...a, online, apiOk, apiError, _apiSt, _apiErr, managed: managed.running, pid: managed.pid, startedAt: managed.startedAt };
    }));
    return reply.view('adapters', { adapters: withStatus, t, lang, dir, langs });
  });

  // Async deep check — frontend fetches this after page load
  fastify.get('/api/adapters/check/:port', async (request, reply) => {
    const port = parseInt(request.params.port);
    if (!port) return reply.code(400).send({ error: 'invalid port' });
    const result = await deepCheckAdapter(port);
    return reply.send(result);
  });

  fastify.post('/adapters', async (request, reply) => {
    const { name, gateway_ws_url, token, agent_id, ai_provider, ai_provider_url, ai_provider_key, ai_model } = request.body;
    if (!name?.trim()) return reply.redirect('/adapters');
    const agentId = agent_id?.trim() || 'main';
    const newId = createAdapterNode({
      name: name.trim(),
      gatewayWsUrl: gateway_ws_url?.trim(),
      token: token?.trim() || null,
      agentId,
      sessionKey: `agent:${agentId}:${agentId}`,
      aiProvider: ai_provider?.trim() || 'openclaw',
      aiProviderUrl: ai_provider_url?.trim() || null,
      aiProviderKey: ai_provider_key?.trim() || null,
      aiModel: ai_model?.trim() || null,
    });
    // 清掉此 port 上任何旧 adapter 残留的 deep-check cache（port 复用会继承 404）
    const created = getAdapterNode(newId);
    if (created) invalidateApiCheckCache(created.http_port);
    return reply.redirect('/adapters');
  });

  // Reveal decrypted adapter token (AJAX, local UI only)
  fastify.get('/adapters/:id/token', async (request, reply) => {
    const token = getAdapterToken(request.params.id);
    return reply.send({ token: token || null });
  });

  // Reveal ingest secret (AJAX, local UI only)
  fastify.get('/adapters/ingest-secret', async (request, reply) => {
    const secret = await getConfig('ingest_secret');
    return reply.send({ secret: secret || null });
  });

  // Start adapter process
  fastify.post('/adapters/:id/start', async (request, reply) => {
    const result = await startAdapter(request.params.id, true);  // userIntent=true
    if (!result.ok) console.log('[adapter] start failed:', result.reason);
    return reply.redirect('/adapters');
  });

  // Stop adapter process
  fastify.post('/adapters/:id/stop', async (request, reply) => {
    await stopAdapter(request.params.id, true);  // userIntent=true
    return reply.redirect('/adapters');
  });

  // Restart adapter — stop old process, start with fresh DB config
  fastify.post('/adapters/:id/restart', async (request, reply) => {
    const result = await restartAdapter(request.params.id);
    if (!result.ok) console.log('[adapter] restart failed:', result.reason);
    return reply.redirect('/adapters');
  });

  // Update adapter
  fastify.post('/adapters/:id', async (request, reply) => {
    const { name, gateway_ws_url, token, agent_id, ai_provider, ai_provider_url, ai_provider_key, ai_model } = request.body;
    const agentId = agent_id?.trim() || undefined;
    updateAdapterNode(request.params.id, {
      name: name?.trim() || undefined,
      gatewayWsUrl: gateway_ws_url?.trim() || undefined,
      token: token?.trim() || null,
      agentId,
      sessionKey: agentId ? `agent:${agentId}:${agentId}` : undefined,
      aiProvider: ai_provider?.trim() || undefined,
      aiProviderUrl: ai_provider_url?.trim() || undefined,
      aiProviderKey: ai_provider_key?.trim() || null,
      aiModel: ai_model?.trim() || undefined,
    });
    // Sync updated model/url to agent_connections table
    syncConnectionFromAdapter(request.params.id);
    // 改了 model / key / url 之后，旧 apiOk/apiError 立即失效
    const updated = getAdapterNode(request.params.id);
    if (updated) invalidateApiCheckCache(updated.http_port);
    return reply.redirect('/adapters');
  });

  fastify.post('/adapters/:id/delete', async (request, reply) => {
    // 删除前先记录 port，用来清 deep-check cache，避免同 port 新 adapter 继承旧错误
    const before = getAdapterNode(request.params.id);
    await stopAdapter(request.params.id);
    deleteAdapterNode(request.params.id);
    if (before) invalidateApiCheckCache(before.http_port);
    return reply.redirect('/adapters');
  });

  // Keep old /adapter route as redirect for backward compat
  fastify.get('/adapter', async (request, reply) => reply.redirect('/adapters'));
  fastify.post('/adapter/config', async (request, reply) => reply.redirect('/adapters'));
}
