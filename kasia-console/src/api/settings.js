import { getConfig, setConfig } from '../data/settings/configs.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import { fork } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function registerSettingsRoutes(fastify) {

  // POST /settings/node — save node config (form submit, redirects to /relays)
  fastify.post('/settings/node', async (request, reply) => {
    const { mode, custom_url, discovered_url } = request.body;

    let url = '';
    if (mode === 'custom') {
      url = (custom_url || '').trim();
    } else if (mode === 'discovered') {
      url = (discovered_url || '').trim();
    } else if (mode === 'local') {
      url = 'ws://127.0.0.1:17110';
    }
    // mode === 'public' keeps url empty (will fall back to resolver in relay)

    await setConfig('rpc_mode', mode, { category: 'node' });
    await setConfig('rpc_url', url, { category: 'node' });

    return reply.redirect('/settings');
  });

  // POST /settings/node/test — test node connection (API, returns JSON)
  fastify.post('/settings/node/test', async (request, reply) => {
    const { url } = request.body || {};
    if (!url) return reply.send({ ok: false, error: 'No URL provided' });

    const net = await import('net');
    const { URL } = await import('url');

    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      const port = parseInt(parsed.port) || (parsed.protocol === 'wss:' ? 443 : 80);

      const start = Date.now();
      const connected = await new Promise((resolve) => {
        const socket = net.default.createConnection({ host, port, timeout: 5000 }, () => {
          const latency = Date.now() - start;
          socket.destroy();
          resolve({ ok: true, latency });
        });
        socket.on('error', (err) => {
          socket.destroy();
          resolve({ ok: false, error: err.message });
        });
        socket.on('timeout', () => {
          socket.destroy();
          resolve({ ok: false, error: 'Connection timed out' });
        });
      });

      return reply.send(connected);
    } catch (err) {
      return reply.send({ ok: false, error: err.message });
    }
  });

  // POST /settings/node/discover — discover public nodes via Resolver
  fastify.post('/settings/node/discover', async (request, reply) => {
    const script = join(__dirname, '..', '..', 'scripts', 'discover-nodes.mjs');
    try {
      const result = await new Promise((resolve, reject) => {
        const child = fork(script, ['20'], { silent: true });
        let out = '';
        child.stdout.on('data', d => out += d);
        child.on('error', e => reject(e));
        child.on('close', code => code === 0 ? resolve(out) : reject(new Error('exit ' + code)));
        setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 30000);
      });
      return reply.send(JSON.parse(result));
    } catch (err) {
      console.error('[discover] failed:', err.message);
      return reply.send([]);
    }
  });

  // GET /api/config/rpc-url — API for relay to fetch configured RPC URL
  fastify.get('/api/config/rpc-url', async (request, reply) => {
    const mode = await getConfig('rpc_mode') || 'local';
    const url = await getConfig('rpc_url') || '';
    return reply.send({ mode, url });
  });

  // GET /api/config/rpc-status — 配置 vs 实际连接状态
  fastify.get('/api/config/rpc-status', async (request, reply) => {
    const { getWorkingRpc } = await import('../services/rpc-health.js');
    const mode = await getConfig('rpc_mode') || 'local';
    const configuredUrl = await getConfig('rpc_url') || '';
    const actual = await getWorkingRpc();
    const configuredReachable = actual.url === configuredUrl
      || (mode === 'local' && actual.url === 'ws://127.0.0.1:17110');
    const source = actual.isLocal && actual.url === 'ws://127.0.0.1:17110' ? 'local'
      : actual.isLocal ? 'lan'
      : actual.url ? 'resolver'
      : 'none';
    return reply.send({
      configured: { mode, url: configuredUrl },
      actual: { url: actual.url, isLocal: actual.isLocal, source },
      configured_reachable: configuredReachable,
    });
  });

  // ── System Repair（Agent 自检自配）──

  // GET /api/system/diagnose — 诊断全系统
  fastify.get('/api/system/diagnose', async (request, reply) => {
    const { diagnose } = await import('../services/system-repair.js');
    return reply.send(await diagnose());
  });

  // POST /api/system/repair — 执行修复
  fastify.post('/api/system/repair', async (request, reply) => {
    const { fixId, fixData } = request.body || {};
    if (!fixId) return reply.code(400).send({ ok: false, message: 'fixId required' });
    const { applyFix } = await import('../services/system-repair.js');
    return reply.send(await applyFix(fixId, fixData || {}));
  });
}
