import Fastify from 'fastify';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

// DB setup
import { runMigrations } from './db/migrate.js';
import { sqlite as _sqlite } from './db/client.js';

// Config
import { getConfig, setConfig } from './data/settings/configs.js';

// Route registrations
import { registerIngestRoutes } from './api/ingest.js';
import { registerConversationRoutes } from './api/conversations.js';
import { registerRelayRoutes } from './api/relay.js';
import { registerAdapterRoutes } from './api/adapter.js';
import { registerEventRoutes } from './api/events.js';
import { registerHealthRoutes } from './api/health.js';
import { registerContextRoutes } from './api/context.js';
import { registerSettingsRoutes } from './api/settings.js';
import { registerIdentityRoutes } from './api/identities.js';
import { registerSkillRoutes } from './api/skills.js';
import { registerDiscoveryRoutes } from './api/discovery.js';
import { registerChatRoutes } from './api/chat.js';
import { registerTradingRoutes } from './api/trading.js';
import { registerChainDataRoutes } from './api/chain-data.js';
import { registerStockRoutes } from './api/stocks.js';
import { registerBrokerRoutes } from './api/broker.js';
import { registerAuthRoutes } from './api/auth.js';
import { registerOAuthRoutes } from './api/oauth.js';
import { registerExchangeRoutes } from './api/exchange.js';
import { parseLang, getT, isRtl, LANG_NAMES } from './i18n/index.js';
import { autoStartIfEnabled } from './services/scanner.js';
import { startAllAdapters, stopAllAdapters } from './services/adapter-launcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Validate encryption key
if (!process.env.CONSOLE_ENCRYPTION_KEY || process.env.CONSOLE_ENCRYPTION_KEY.length !== 64) {
  console.error('[ERROR] CONSOLE_ENCRYPTION_KEY must be set as a 64-char hex string.');
  console.error('Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

// Run migrations
runMigrations();

// Auto-generate INGEST_SECRET if not configured
async function ensureIngestSecret() {
  let secret = await getConfig('ingest_secret');
  if (!secret) {
    secret = process.env.INGEST_SECRET || randomBytes(32).toString('hex');
    await setConfig('ingest_secret', secret, { category: 'system', isSensitive: true, hint: secret.slice(0, 8) + '...' });
    console.log('\n========================================');
    console.log('[SETUP] INGEST_SECRET generated:');
    console.log(`  ${secret}`);
    console.log('Copy this to relay and adapter env as:');
    console.log(`  INGEST_SECRET=${secret}`);
    console.log(`  CONSOLE_URL=http://localhost:${process.env.PORT || 3100}`);
    console.log('========================================\n');
  }
  // 确保进程内其他模块（scanner.js 等）能通过 env 读到
  process.env.INGEST_SECRET = secret;
  return secret;
}

const PORT = parseInt(process.env.PORT || '3100');

const fastify = Fastify({ logger: false });

// Plugins
await fastify.register(import('@fastify/formbody'));
await fastify.register(import('@fastify/static'), {
  root: join(__dirname, '..', 'public'),
  prefix: '/public/',
});
await fastify.register(import('@fastify/view'), {
  engine: { eta: new (await import('eta')).Eta() },
  root: join(__dirname, 'ui'),
  viewExt: 'eta',
  defaultContext: { appName: 'Kasia Console' },
  options: { useWith: true },
});

// Error handler
fastify.setErrorHandler((error, request, reply) => {
  console.error('[ERROR]', error.message);
  reply.code(error.statusCode || 500).send({ error: error.message });
});

// Register routes
await registerHealthRoutes(fastify);
await registerIngestRoutes(fastify);
await registerConversationRoutes(fastify);
await registerRelayRoutes(fastify);
await registerAdapterRoutes(fastify);
await registerEventRoutes(fastify);
await registerContextRoutes(fastify);
await registerSettingsRoutes(fastify);
await registerIdentityRoutes(fastify);
await registerSkillRoutes(fastify);
await registerDiscoveryRoutes(fastify);
await registerChatRoutes(fastify);
await registerTradingRoutes(fastify);
await registerChainDataRoutes(fastify);
await registerStockRoutes(fastify);
await registerBrokerRoutes(fastify);
await registerAuthRoutes(fastify);
await registerOAuthRoutes(fastify);
await registerExchangeRoutes(fastify);

// Exchange: expire stale offers + timeout stuck verifications (every 5min)
import { expireStale, timeoutVerifying } from './services/exchange-machine.js';
try { expireStale(); timeoutVerifying(); } catch (err) { console.error('[exchange] startup expire/timeout:', err.message); }
setInterval(() => {
  try { expireStale(); timeoutVerifying(); } catch (err) { console.error('[exchange] expire/timeout error:', err.message); }
}, 5 * 60 * 1000);

// Anti-spam API endpoints
import { checkOutboundAllowed, getActivityLog, getActivityByPeer, getOutboundStats, detectStopRequest, getMergedContacts } from './services/anti-spam.js';
import { listRelayNodes as _listRelayNodes } from './data/settings/relay-nodes.js';

// Agent 外发消息检查 — action-executor 每次发送前调用
fastify.get('/api/agent/outbound-check', async (request, reply) => {
  const { agent_address, peer_address } = request.query;
  if (!agent_address || !peer_address) return reply.code(400).send({ allowed: false, reason: 'missing params' });
  const result = checkOutboundAllowed(agent_address, peer_address);
  if (!result.allowed) console.log(`[anti-spam] BLOCKED: ${agent_address.slice(-8)} → ${peer_address.slice(-8)} (${result.reason})`);
  return reply.send(result);
});

// Agent 全部链上行为（和 chain_events 总数对得上）
fastify.get('/api/agent/activity-log', async (request, reply) => {
  const { relay_node_id, peer_address, limit, offset } = request.query;
  if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
  const relayNodes = _listRelayNodes();
  const node = relayNodes.find(r => r.id === relay_node_id);
  if (!node?.address) return reply.code(404).send({ error: 'relay not found' });
  return reply.send(getActivityLog(node.address, parseInt(limit) || 200, parseInt(offset) || 0, peer_address || null));
});

// Agent 按 peer 聚合行为统计
fastify.get('/api/agent/activity-by-peer', async (request, reply) => {
  const { relay_node_id } = request.query;
  if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
  const relayNodes = _listRelayNodes();
  const node = relayNodes.find(r => r.id === relay_node_id);
  if (!node?.address) return reply.code(404).send({ error: 'relay not found' });
  return reply.send(getActivityByPeer(node.address));
});

// Agent 外发统计摘要 — 按 peer 聚合
fastify.get('/api/agent/outbound-stats', async (request, reply) => {
  const { relay_node_id } = request.query;
  if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
  const relayNodes = _listRelayNodes();
  const node = relayNodes.find(r => r.id === relay_node_id);
  if (!node?.address) return reply.code(404).send({ error: 'relay not found' });
  return reply.send(getOutboundStats(node.address));
});

// 握手去重查询 — Relay 在接受握手前调用
fastify.get('/api/relation/status', async (request, reply) => {
  const { local, peer } = request.query;
  if (!local || !peer) return reply.send({ status: null });
  const rs = _sqlite.prepare('SELECT status FROM relation_states WHERE local_address = ? AND peer_address = ?').get(local, peer);
  return reply.send({ status: rs?.status || null });
});

// 合并通讯录 API
fastify.get('/api/contacts/merged', async (request, reply) => {
  const { relay_node_id } = request.query;
  if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
  const relayNodes = _listRelayNodes();
  const node = relayNodes.find(r => r.id === relay_node_id);
  if (!node?.address) return reply.code(404).send({ error: 'relay not found' });
  return reply.send(getMergedContacts(node.address));
});

// 握手报告 API
fastify.get('/api/agent/handshake-report', async (request, reply) => {
  const relayNodes = _listRelayNodes();
  const agentSet = new Set(relayNodes.map(r => r.address).filter(Boolean));
  const report = [];
  for (const r of relayNodes) {
    if (!r.address) continue;
    const sent = _sqlite.prepare(`
      SELECT ce.to_address as peer, ce.observed_at, ce.txid, i.display_name as peer_name
      FROM chain_events ce LEFT JOIN identities i ON i.address = ce.to_address
      WHERE ce.from_address = ? AND ce.event_type = 'handshake' ORDER BY ce.observed_at DESC
    `).all(r.address);
    const recv = _sqlite.prepare(`
      SELECT ce.from_address as peer, ce.observed_at FROM chain_events ce
      WHERE ce.to_address = ? AND ce.event_type = 'handshake'
    `).all(r.address);
    const recvSet = new Set(recv.map(x => x.peer));
    const details = [];
    const peerSeen = {};
    for (const s of sent) {
      if (!peerSeen[s.peer]) peerSeen[s.peer] = { count: 0, name: s.peer_name, replied: recvSet.has(s.peer), is_local: agentSet.has(s.peer), first: s.observed_at, last: s.observed_at };
      peerSeen[s.peer].count++;
      peerSeen[s.peer].last = s.observed_at;
    }
    for (const [peer, info] of Object.entries(peerSeen)) {
      details.push({ peer, ...info });
    }
    details.sort((a, b) => (b.last || '').localeCompare(a.last || ''));
    report.push({
      agent: r.name, agent_id: r.id, address: r.address,
      sent_total: sent.length, recv_total: recv.length,
      cost_kas: (sent.length * 0.2).toFixed(1),
      external_sent: sent.filter(s => !agentSet.has(s.peer)).length,
      no_reply: details.filter(d => !d.replied && !d.is_local).length,
      details,
    });
  }
  return reply.send(report);
});

// 握手报告页面
fastify.get('/handshakes', async (request, reply) => {
  const lang = parseLang(request.headers.cookie);
  const t = getT(lang);
  const relayNodes = _listRelayNodes();
  return reply.viewAsync('handshakes', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', relayNodes, _page: 'handshakes' });
});

// /audit → redirect to /contacts
fastify.get('/audit', async (request, reply) => {
  const agent = request.query.agent ? `?agent=${request.query.agent}` : '';
  return reply.redirect(`/contacts${agent}`);
});

// /settings → redirect to /relays (node config is there now)
fastify.get('/settings', async (request, reply) => reply.redirect('/relays'));


// POST /lang — set language cookie
fastify.post('/lang', (request, reply) => {
  const { lang } = request.body;
  if (LANG_NAMES[lang]) {
    reply.header('Set-Cookie', `kanet_lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`);
  }
  const back = request.headers.referer || '/';
  return reply.redirect(back);
});

// Start
await ensureIngestSecret();
await fastify.listen({ port: PORT, host: '127.0.0.1' });
console.log(`[kasia-console] running at http://localhost:${PORT}`);

// Auto-register Mind skills from agent-mind/src/skills/
import { registerMindSkills } from './data/settings/skills.js';
const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
await registerMindSkills(`${KANET_ROOT}/agent-mind/src/skills`);

// Auto-start all adapter processes FIRST — Minds need adapterUrl at init time
await startAllAdapters();

// Pre-warm all Agent Minds (identity + skills + memory loaded at startup)
import { init as initMinds, startScheduler } from './services/mind-manager.js';
await initMinds();
startScheduler();

// Auto-start all relay processes (per-account)
import { startAll as startAllRelays, stopAll as stopAllRelays } from './services/relay-manager.js';
await startAllRelays();

// Pre-split UTXOs via Relay IPC (after relays are running)
import { autoSplitAll } from './services/utxo-splitter.js';
await autoSplitAll();

// Auto-start scanner if it was enabled before restart
await autoStartIfEnabled();

// Start OAuth token refresh worker
import { startRefreshWorker } from './services/connection-manager.js';
startRefreshWorker();

// Graceful shutdown — stop all child processes
async function shutdown() {
  console.log('[kasia-console] shutting down...');
  await stopAllRelays();
  await stopAllAdapters();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
