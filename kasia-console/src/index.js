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
import { registerDefiRoutes } from './api/defi.js';
import { registerPortfolioRoutes } from './api/portfolio.js';
import { registerBackupRoutes } from './api/backup.js';
import { registerBudgetRoutes } from './api/budget.js';
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
  console.error('[ERROR]', error.message, '| URL:', request.method, request.url, '| STACK:', error.stack?.split('\n').slice(0,3).join(' → '));
  reply.code(error.statusCode || 500).send({ error: error.message });
});

// T-J2-23: encoding guard for /api/agent/reply (Owner 编码 RCA)
// curl -d / PowerShell Invoke-RestMethod 默认非 UTF-8 → message CJK 字节 corrupt → _detectIntent 返 null
// → 走 LLM → Qwen confused. 这条 hook 在 preHandler 层验 message 字段, 含 U+FFFD / lone surrogate / 全 ASCII
// 但声明 zh/CJK 上下文 (header X-Test-Lang or query lang=zh) → 友好 400 提示用 --data-binary / Node fetch.
// 生产 (Kasia client → 链上 → relay ingest) 走严格 UTF-8 不 hit; 仅 dev/测试客户端撞.
fastify.addHook('preHandler', async (request, reply) => {
  if (request.method !== 'POST' || !request.url.startsWith('/api/agent/reply')) return;
  const m = request.body?.message;
  if (typeof m !== 'string') return;
  if (/[�]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(m)) {
    return reply.code(400).send({
      error: 'message contains invalid UTF-8 (replacement char or lone surrogate). Likely client encoding bug. Use Node fetch / curl --data-binary @file / Python requests json= for testing. PowerShell Invoke-RestMethod default UTF-16 BOM corrupts CJK — use [System.Text.Encoding]::UTF8.GetBytes($body).',
      hint: 'docs/broker-test-guide.md',
    });
  }
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
await registerDefiRoutes(fastify);
await registerPortfolioRoutes(fastify);
await registerBackupRoutes(fastify);
await registerBudgetRoutes(fastify);

// NWT-V3 / Qclaude monitor 系统 — route 必须在 fastify.listen 之前注册
import { registerMonitorRoutes } from './api/monitor-dashboard.js';
await registerMonitorRoutes(fastify);

// Exchange: expire stale offers + timeout stuck verifications + stale dispute check
// + cleanup orphan accepts.
// T-J1-19e (J2 RCA 修案 1): 5min tick → 30s. 缩窄 race 窗口 (offer expired 但仍 'open',
// user 付款 → 进 verifying → 资金事故). 修案 2 (lazy check) 在 exchange-machine 关键路径补刀.
import { expireStale, timeoutVerifying, checkMatchedTimeout, checkStaleDisputes, cleanupStaleOrphanAccepts } from './services/exchange-machine.js';
try { expireStale(); timeoutVerifying(); checkStaleDisputes(); cleanupStaleOrphanAccepts(); } catch (err) { console.error('[exchange] startup expire/timeout:', err.message); }
setInterval(() => {
  try { expireStale(); timeoutVerifying(); checkStaleDisputes(); cleanupStaleOrphanAccepts(); } catch (err) { console.error('[exchange] expire/timeout error:', err.message); }
  checkMatchedTimeout().catch(err => console.error('[exchange] matched timeout error:', err.message));
}, 30 * 1000);

// Anti-spam API endpoints
import { checkOutboundAllowed, getActivityLog, getActivityByPeer, getOutboundStats, detectStopRequest, getMergedContacts } from './services/anti-spam.js';
import { listRelayNodes as _listRelayNodes } from './data/settings/relay-nodes.js';

// Agent 外发消息检查 — action-executor 每次发送前调用
fastify.get('/api/agent/outbound-check', async (request, reply) => {
  const { agent_address, peer_address, message_type } = request.query;
  if (!agent_address || !peer_address) return reply.code(400).send({ allowed: false, reason: 'missing params' });
  const result = checkOutboundAllowed(agent_address, peer_address, { messageType: message_type || 'text' });
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
// 2026-04-23 修: 默认只返 accepted/confirmed/active/stale, observed (单向握手未接受)
// 不再算联系人. ?include_observed=1 可调. /api/contacts/pending 专门返 observed.
fastify.get('/api/contacts/merged', async (request, reply) => {
  const { relay_node_id, include_observed, include_blocked } = request.query;
  if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
  const relayNodes = _listRelayNodes();
  const node = relayNodes.find(r => r.id === relay_node_id);
  if (!node?.address) return reply.code(404).send({ error: 'relay not found' });
  return reply.send(getMergedContacts(node.address, {
    includeObserved: include_observed === '1' || include_observed === 'true',
    includeBlocked: include_blocked === '1' || include_blocked === 'true',
  }));
});

// 待审批握手请求: observed 状态的对端 (对方发了握手我方未 accept)
fastify.get('/api/contacts/pending', async (request, reply) => {
  const { relay_node_id } = request.query;
  if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
  const relayNodes = _listRelayNodes();
  const node = relayNodes.find(r => r.id === relay_node_id);
  if (!node?.address) return reply.code(404).send({ error: 'relay not found' });
  const pending = _sqlite.prepare(`
    SELECT rs.peer_address as peer, rs.status, rs.handshake_observed_at, rs.first_seen_tx, rs.classification,
      i.id as identity_id, i.display_name, i.card_entity_type, i.card_summary,
      pa.id as pending_action_id, pa.status as action_status, pa.retry_count, pa.error, pa.created_at as action_created_at
    FROM relation_states rs
    LEFT JOIN identities i ON i.address = rs.peer_address
    LEFT JOIN pending_actions pa ON pa.local_address = rs.local_address AND pa.target_address = rs.peer_address
      AND pa.action_type = 'handshake_accept' AND pa.status IN ('pending','executing','failed')
    WHERE rs.local_address = ? AND rs.status = 'observed'
    ORDER BY rs.handshake_observed_at DESC
  `).all(node.address);
  return reply.send(pending);
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
      if (!peerSeen[s.peer]) peerSeen[s.peer] = { count: 0, txids: [], name: s.peer_name, replied: recvSet.has(s.peer), is_local: agentSet.has(s.peer), first: s.observed_at, last: s.observed_at };
      peerSeen[s.peer].count++;
      peerSeen[s.peer].last = s.observed_at;
      if (s.txid) peerSeen[s.peer].txids.push(s.txid);
    }
    for (const [peer, info] of Object.entries(peerSeen)) {
      let peerFee = 0;
      if (info.txids.length) {
        const ph = info.txids.map(() => '?').join(',');
        const f = _sqlite.prepare(`SELECT SUM(CAST(fee AS REAL)) as total FROM tx_records WHERE txid IN (${ph})`).get(...info.txids);
        peerFee = f?.total || 0;
      }
      delete info.txids;
      details.push({ peer, ...info, cost_kas: peerFee.toFixed(4) });
    }
    details.sort((a, b) => (b.last || '').localeCompare(a.last || ''));
    report.push({
      agent: r.name, agent_id: r.id, address: r.address,
      sent_total: sent.length, recv_total: recv.length,
      cost_kas: (() => {
        const txids = sent.map(s => s.txid).filter(Boolean);
        if (!txids.length) return '0';
        const placeholders = txids.map(() => '?').join(',');
        const fees = _sqlite.prepare(`SELECT SUM(CAST(fee AS REAL)) as total FROM tx_records WHERE txid IN (${placeholders})`).get(...txids);
        return (fees?.total || 0).toFixed(4);
      })(),
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

// Start market seeder (auto seed orders on free market)
import { startMarketSeeder, startSeederDepositWatcher, startSeederRefundWorker } from './services/market-seeder.js';
startMarketSeeder();
startSeederDepositWatcher();
startSeederRefundWorker();

// R5 T-J2-16: retail-dex v1 deprecated, deleted. broker is_service Service 模式
// 直走 broker-buy/sell-handler + broker-action-queue. retail_dex_orders 表保留
// (broker-intake-watcher / broker-sell-handler 仍用做用户意图绑定).

// Phase 3 (T-J2-06): broker-intake-watcher — 入账 4 场景兜底 (v2.1 §4.2)
import { startIntakeWatcher } from './services/broker-intake-watcher.js';
startIntakeWatcher();

// J1-3 (Phase E v3 Step 1c, J1 #55 propose + NWT 01:15 ack): _sweepStaleAligning cron 5min
// — broker-intake-watcher refund tick 仅 process 'awaiting_payment', 'aligning' rows 永不 sweep.
// J2 Step 1b setConvoStateLock 入口 INSERT 'aligning' row 后必 cleanup pattern.
import { startStaleAligningSweep } from './services/broker-state-authority.js';
startStaleAligningSweep();

// J1 #72 Wire 2 (vote b — territory clean split per NWT 04:08 propose):
// broker-state-reconciler 5min cron — chain-truth audit + retry-able 'expired'/'refund_send_failed' detect + Phase 3 backfill via advanceToRefunded(reason='reconciler_retry').
// NWT territory file (broker-state-reconciler.js), J1 territory startup wire (index.js).
import { startStateReconciler } from './services/broker-state-reconciler.js';
startStateReconciler();

// Phase 4 (T-J2-09): broker-buy-completion-watcher — BUY 闭环, broker 代 accept 后 DM user KAS 到账
import { startCompletionWatcher } from './services/broker-buy-completion-watcher.js';
startCompletionWatcher();

// T-NWT-V2 (Owner 真测 #2 退场立项): bsc-incoming-watcher — 30s tick 后台扫 broker EVM 收款
// 地址 USDT 入账, 调 J2 verifyPaymentForPeer 自动反查 + 主动 DM user. 双路径互补 J2 lazy LLM tool.
import { start as startBscIncomingWatcher } from './services/bsc-incoming-watcher.js';
startBscIncomingWatcher();

// NWT-V3 / Qclaude (2026-04-27): monitor 服务启动 (route 在 fastify.listen 前已注册, 见 line 137)
// NWT 19:50 修 3 个 bug:
//   1. monitor-service.js:216 lastTs 重复声明 → rename latestTs
//   2. monitor-dashboard.js inline HTML template literal 嵌套 backtick 解析错 → 抽出 monitor-dashboard.html
//   3. registerMonitorRoutes 调用位置错 (在 fastify.listen 之后) → 上移到 line 137 跟其他 routes 一起
import { startMonitor, stopMonitor } from './services/monitor-service.js';
startMonitor();

// Graceful shutdown — stop all child processes
async function shutdown() {
  console.log('[kasia-console] shutting down...');
  await stopAllRelays();
  await stopAllAdapters();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
