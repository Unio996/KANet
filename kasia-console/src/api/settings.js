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

  // ── TG Bot Broker (S4, Owner v1.3 §8) ──
  // Which broker relay the TG bot represents (broker X). UI-settable DB config (0-restart),
  // replaces env BROKER_RELAY_ID — the bot fetches this at runtime so Owner can switch broker
  // from the Settings page without editing kanet.env or restarting.
  fastify.get('/api/config/tg-bot-broker', async (request, reply) => {
    const { sqlite } = await import('../db/client.js');
    const brokerRelayId = await getConfig('tg_bot_broker_relay_id') || '';
    const brokers = sqlite.prepare(
      "SELECT id, name, address, role FROM relay_nodes WHERE role='broker' OR is_dex_broker=1 OR name LIKE 'broker%' ORDER BY name"
    ).all();
    return reply.send({ broker_relay_id: brokerRelayId, brokers });
  });

  fastify.post('/api/config/tg-bot-broker', async (request, reply) => {
    const { broker_relay_id } = request.body || {};
    if (!broker_relay_id) return reply.code(400).send({ ok: false, error: 'broker_relay_id required' });
    const { sqlite } = await import('../db/client.js');
    const relay = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE id = ?').get(broker_relay_id);
    if (!relay) return reply.code(404).send({ ok: false, error: 'relay not found' });
    await setConfig('tg_bot_broker_relay_id', broker_relay_id, { category: 'tg_bot' });
    return reply.send({ ok: true, broker_relay_id, broker_name: relay.name });
  });

  // ── TG Bot lifecycle (KANet-UI, Bettor r945 接通最小路 ②) ──
  // start/stop/status over the bot process (separate 0-key process, supervised by tg-bot-manager).
  fastify.post('/api/tg-bot/start', async (request, reply) => {
    const { startTgBot } = await import('../services/tg-bot-manager.js');
    const r = await startTgBot();
    if (r.ok) await setConfig('tg_bot_enabled', '1', { category: 'tg_bot' });  // remembered across restarts
    return reply.send(r);
  });

  fastify.post('/api/tg-bot/stop', async (request, reply) => {
    const { stopTgBot } = await import('../services/tg-bot-manager.js');
    await setConfig('tg_bot_enabled', '0', { category: 'tg_bot' });  // manual stop is remembered → no auto-start on boot
    return reply.send(await stopTgBot());
  });

  fastify.get('/api/tg-bot/status', async (request, reply) => {
    const { tgBotStatus } = await import('../services/tg-bot-manager.js');
    return reply.send(await tgBotStatus());
  });
}
