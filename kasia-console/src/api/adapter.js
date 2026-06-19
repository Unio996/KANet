import { listAdapterNodes, getAdapterNode, createAdapterNode, updateAdapterNode, deleteAdapterNode, getAdapterToken, getAdapterProviderKey } from '../data/settings/adapter-nodes.js';
import { startAdapter, stopAdapter, restartAdapter, getAdapterStatus } from '../services/adapter-launcher.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import { getConfig } from '../data/settings/configs.js';
import { syncConnectionFromAdapter, getConnectionByAdapter } from '../services/connection-manager.js';

// Fast health check (port only, <2s)
async function pingAdapter(port) {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {}
  return null;
}

// Deep API check cache: port → { apiOk, apiError, checkedAt, failStreak }
const _apiCheckCache = {};

// 去抖 (KANet-UI r-debounce, Bettor r480 派工 ③ + J1 #6 参考对齐): 惊群期 llama 瞬时过载让单次
// deep-check 的 fetch 超时 (= Owner 看到的 'fetch failed'), 旧逻辑 (任何 fail → 立即 amber + 缓存 120s)
// 一次抖动就把 adapter 判红卡 2min = 误报噪声。J1 #6 四点对齐:
//   ① ttl 四档 (J1 #9 补红分档): 绿 120s / soft 维持绿 20s / 超时红 30s(惊群症快复绿) /
//      HTTP 错红 120s(确定性 API error 不必快复查);
//   ② failStreak 计连续 fetch-fail, < 阈值 且上次绿 → 维持绿 + soft 20s 复查 (不翻红);
//   ③ 连续 ≥ 阈值, 或 HTTP 响应非 ok (= 确定性 API 错、非瞬时) → 真红 amber;
//   ④ invalidateApiCheckCache 清整条 cache (含 failStreak, 同对象)。
const DEEP_CHECK_GREEN_TTL_MS = 120_000;   // 绿: 长缓存
const DEEP_CHECK_RED_TTL_MS = 30_000;      // 超时红: 短缓存, .105 惊群恢复后快复绿
const DEEP_CHECK_HTTP_RED_TTL_MS = 120_000; // HTTP 错红: 确定性 API error, 不必快复查 (J1 #9)
const DEEP_CHECK_SOFT_TTL_MS = 20_000;     // soft 维持绿(单次抖动): 快复查
const DEEP_CHECK_FAIL_THRESHOLD = 2;       // 连续 fetch-fail 达此值才判红 (单次抖动不判红)

// 端口是可复用的：旧 adapter 删了，新建可能复用同一个 port，会继承旧 cache 的 404 状态
// 因此 create/update/delete 任一改变"port 背后实体"的操作发生时，主动失效该 port 的缓存。
function invalidateApiCheckCache(port) {
  if (port != null) delete _apiCheckCache[port];
}

// Deep check: call AI API, cache result for 2 minutes
// 超时放宽到 45s：推理模型（glm4.7 / qwen thinking 系列）首 token 前思考 10-30s 常见
async function deepCheckAdapter(port) {
  const cached = _apiCheckCache[port];
  // 缓存命中 TTL 四档: soft 维持绿 20s / 绿 120s / HTTP 错红 120s / 超时红·checking 30s
  if (cached) {
    const ttl = cached._soft ? DEEP_CHECK_SOFT_TTL_MS
              : cached.apiOk === true ? DEEP_CHECK_GREEN_TTL_MS
              : cached._httpErr ? DEEP_CHECK_HTTP_RED_TTL_MS
              : DEEP_CHECK_RED_TTL_MS;
    if (Date.now() - cached.checkedAt < ttl) return cached;
  }
  const prevStreak = cached?.failStreak || 0;
  const prevGreen = cached?.apiOk === true;   // 上次是否绿 (含 soft 维持绿)
  try {
    const res = await fetch(`http://localhost:${port}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // mindTask=true 走短路径，跳过 getContext/SYSTEM_PROMPT，给 reasoning 模型留空间
      body: JSON.stringify({ peer: '_ping', message: 'hi', mindTask: true }),
      signal: AbortSignal.timeout(45000),
    });
    if (res.ok) {
      // 成功: 绿, 重置 failStreak
      const result = { apiOk: true, apiError: null, checkedAt: Date.now(), failStreak: 0 };
      _apiCheckCache[port] = result;
      return result;
    }
    // ③ HTTP 响应非 2xx = 确定性 API 错 (服务器活着但报错, 非瞬时) → 不去抖, 立即红; _httpErr → 红 ttl 120s
    const errText = (await res.text().catch(() => '')).slice(0, 100);
    const result = { apiOk: false, apiError: errText, checkedAt: Date.now(), failStreak: prevStreak + 1, _httpErr: true };
    _apiCheckCache[port] = result;
    return result;
  } catch (e) {
    // fetch failed (超时/网络) = 惊群瞬时症状 → 去抖
    const failStreak = prevStreak + 1;
    if (failStreak < DEEP_CHECK_FAIL_THRESHOLD && prevGreen) {
      // ② 单次抖动 且 上次绿 → 维持绿, soft 20s 快复查, 不翻红
      const result = { apiOk: true, apiError: null, checkedAt: Date.now(), failStreak, _soft: true };
      _apiCheckCache[port] = result;
      return result;
    }
    // 连续 ≥ 阈值 → 真红; 首次即 fail 无绿可维持 → checking(null)
    const isRed = failStreak >= DEEP_CHECK_FAIL_THRESHOLD;
    const result = { apiOk: isRed ? false : null, apiError: isRed ? e.message : null, checkedAt: Date.now(), failStreak };
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
      // OAuth token status (if this adapter has an OAuth connection)
      const conn = getConnectionByAdapter(a.id);
      const oauth = conn && conn.auth_mode === 'oauth' ? {
        connId: conn.id,
        status: conn.status,
        expiresAt: conn.expires_at,
        lastRefreshError: (conn.last_refresh_error || '').replace(/'/g, ''),
        canRetry: !!conn.refresh_token_enc,
      } : null;
      return { ...a, online, apiOk, apiError, _apiSt, _apiErr, managed: managed.running, pid: managed.pid, startedAt: managed.startedAt, _oauth: oauth };
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
