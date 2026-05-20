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
import { registerBettorRoutes } from './api/bettor.js';
import { registerBrokerRoutes } from './api/broker.js';
import { registerAuthRoutes } from './api/auth.js';
import { registerOAuthRoutes } from './api/oauth.js';
import { registerExchangeRoutes } from './api/exchange.js';
import { registerDefiRoutes } from './api/defi.js';
import { registerPortfolioRoutes } from './api/portfolio.js';
import { registerBackupRoutes } from './api/backup.js';
import { registerBudgetRoutes } from './api/budget.js';
import { registerAdminRoutes } from './api/admin.js';
import { registerTreasuryRoutes } from './api/treasury.js';
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

// N19.34 P0 (J2 #533 / NWT counter Q2 共识 5/19): boot-time double-check防 production deploy 忘 unset KANET_TEST_MODE.
// 现 kanet-start.sh 默认 KANET_TEST_MODE=1 (dev script). production 部署忘 override → broker 自接 own offer (left-hand-right-hand) production. 严训 [[feedback_silent_skip_pattern_invariant_test]] enforce.
// 双 layer fail-closed: production 显 set NODE_ENV=production → refuse; NODE_ENV undefined → 也 refuse (paranoid, dev script 必显 set NODE_ENV=development).
if (process.env.KANET_TEST_MODE === '1') {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] KANET_TEST_MODE=1 with NODE_ENV=production — refuse start (防 broker self-deal production).');
    process.exit(1);
  }
  if (!process.env.NODE_ENV) {
    console.error('[FATAL] KANET_TEST_MODE=1 but NODE_ENV unset — refuse start (paranoid: dev script 必显 set NODE_ENV=development; production deploy 必显 set NODE_ENV=production + KANET_TEST_MODE unset).');
    process.exit(1);
  }
  console.log(`[startup] KANET_TEST_MODE=1 active (NODE_ENV=${process.env.NODE_ENV}). own_offer + same-org skip bypass for multi-actor real-chain test.`);
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

// T-J2-23: encoding guard for /api/agent/reply (Owner 编码 RCA, 2026-04-26)
// PZ-BROKER-DM-ENCODING extend (2026-05-05): cover /api/relay/:id/send-command DM 路径
// (Phase 4 Priority 2, NWT r200 钦定, 4/26 fix scope 扩 — KI-29 复刻第 3 次 sediment).
//
// curl -d / PowerShell Invoke-RestMethod 默认非 UTF-8 → message CJK 字节 corrupt → _detectIntent 返 null
// → 走 LLM → Qwen confused. 这条 hook 在 preHandler 层验 message 字段, 含 U+FFFD / lone surrogate.
// 友好 400 提示用 --data-binary / Node fetch.
// 生产 (Kasia client → 链上 → relay ingest) 走严格 UTF-8 不 hit; 仅 dev/测试客户端撞.
//
// send-command body schema { type, target, message, params, channel, amount } —
// 只有 type='send_message' (DM) 和 type='send_broadcast' (channel 广播) 时 message 是 user-supplied 文本;
// type='transfer'/'handshake'/'wallet*'/'split*' 等不含 user 中文, skip check.
const SEND_COMMAND_RE = /^\/api\/relay\/[^\/]+\/send-command$/;
const ENCODING_BAD_RE = /[�]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const ENCODING_ERR_BODY = {
  error: 'message contains invalid UTF-8 (replacement char or lone surrogate). Likely client encoding bug. Use Node fetch / curl --data-binary @file / Python requests json= for testing. PowerShell Invoke-RestMethod default UTF-16 BOM corrupts CJK — use [System.Text.Encoding]::UTF8.GetBytes($body).',
  hint: 'docs/broker-test-guide.md',
};

fastify.addHook('preHandler', async (request, reply) => {
  if (request.method !== 'POST') return;
  const url = request.url;
  let m = null;
  if (url.startsWith('/api/agent/reply')) {
    m = request.body?.message;
  } else if (SEND_COMMAND_RE.test(url)) {
    const t = request.body?.type;
    if (t === 'send_message' || t === 'send_broadcast') {
      m = request.body?.message;
    }
  } else {
    return;
  }
  if (typeof m !== 'string') return;
  if (ENCODING_BAD_RE.test(m)) {
    return reply.code(400).send(ENCODING_ERR_BODY);
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
await registerBettorRoutes(fastify);
await registerDefiRoutes(fastify);
await registerPortfolioRoutes(fastify);
await registerBackupRoutes(fastify);
await registerBudgetRoutes(fastify);
await registerAdminRoutes(fastify);
await registerTreasuryRoutes(fastify);

// NWT-V3 / Qclaude monitor 系统 — route 必须在 fastify.listen 之前注册
import { registerMonitorRoutes } from './api/monitor-dashboard.js';
await registerMonitorRoutes(fastify);

// Exchange: expire stale offers + timeout stuck verifications + stale dispute check
// + cleanup orphan accepts.
// T-J1-19e (J2 RCA 修案 1): 5min tick → 30s. 缩窄 race 窗口 (offer expired 但仍 'open',
// user 付款 → 进 verifying → 资金事故). 修案 2 (lazy check) 在 exchange-machine 关键路径补刀.
import { expireStale, timeoutVerifying, checkMatchedTimeout, checkStaleDisputes, cleanupStaleOrphanAccepts } from './services/exchange-machine.js';
// V5 fix: timeoutVerifying 改 async (emit timeout_v1 chain TX before transition, KI-20 严守).
// 真 .catch pattern 跟 checkMatchedTimeout 同款 (NOT throw 阻 cron tick).
try { expireStale(); checkStaleDisputes(); cleanupStaleOrphanAccepts(); } catch (err) { console.error('[exchange] startup expire:', err.message); }
timeoutVerifying().catch(err => console.error('[exchange] startup timeoutVerifying:', err.message));
setInterval(() => {
  try { expireStale(); checkStaleDisputes(); cleanupStaleOrphanAccepts(); } catch (err) { console.error('[exchange] expire error:', err.message); }
  timeoutVerifying().catch(err => console.error('[exchange] timeoutVerifying error:', err.message));
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

// Bettor scanner cron — Phase 3a (6h cron, top 10 推荐写入 bettor_recommendations)
// 5/14 Owner pivot: 数学 Kelly 路线 deprecated, 新 scavenger 接管. 老 scanner 暂保留留 fallback.
// import { startCron as startBettorCron } from './services/bettor-scanner.js';
// startBettorCron();

// Bettor SCAVENGER cron — Owner 5/14 14:50 钦定 (rules+trajectory+流动性 filter, 弃 LLM-pMid+Kelly)
import { startScavengerCron } from './services/bettor-scavenger.js';
startScavengerCron();

// Bettor resolver cron — Phase 3d (1h cron, 拉 Polymarket 已结算市场算战绩)
import { startResolverCron as startBettorResolver } from './services/bettor-resolver.js';
startBettorResolver();

// Bettor position tracker — Phase 3e-0 (1h cron, snapshot open sim_positions)
import { startTrackerCron as startBettorTracker } from './services/bettor-position-tracker.js';
startBettorTracker();

// Bettor reactor — Phase 3e-1 (1h cron, 反向 drift / 浮亏 触发调仓建议)
import { startReactorCron as startBettorReactor } from './services/bettor-reactor.js';
startBettorReactor();

// MN-01 broker metrics snapshotter — Phase 0 v6 真测 5/15 Owner 钦定 (1h cron, broker pool + escrow activity hourly snapshot).
import { startBrokerMetricsCron } from './services/broker-metrics-snapshotter.js';
startBrokerMetricsCron();

// Phase B 持仓自动保护 (Owner 5/16 钦定 "你们先搞" + Bettor r139 spec) — Phase 1 SKELETON, 1 min cron.
// detect new accepted positions → INSERT pending_owner_ack rule + audit log per check.
// Phase 3 will add firing logic (HMAC owner_ack_token verify + fire /api/predictions/order).
import { startPositionProtectorCron as startBettorPositionProtector } from './services/bettor-position-protector.js';
startBettorPositionProtector();

// Position Watcher (Owner 5/17 钦定 mode 1+2 组合 + UI 可设置) — 30 min cron, alert-only.
// Reads position_watch_rules, fetches Polymarket book midpoint, broadcasts threshold alerts to dev-coord.
// R-DAEMON-DRY-RUN守: NO auto-fire, Owner ACK 才动手.
import { startPositionWatcherCron } from './services/bettor-position-watcher.js';
startPositionWatcherCron();

// Fossa-stable scanner (Owner 5/17 钦定 + Bettor r173 + r178 ack) — 1h cron, due-diligence enforced.
// Strict criteria: 5-15% upside + ≤15d settle + ≥$50k vol24 + ≥$50k liq.
// Results pinned status='pending_due_diligence', Owner final ack gate at /api/bettor/recommendation/:id/accept.
import { startFossaStableScannerCron } from './services/bettor-fossa-stable-scanner.js';
startFossaStableScannerCron();

// r177 Phase 2c — prediction_outcome_share settlement detector (Owner 5/19 钦定 "go phase 2 直 fire
// 2c 不 UAT" + Bettor r197 0 push back). 5min cron, settle expired prediction offers
// via verifyPredictionOutcome → mark protocol_status='completed' + metadata + reputation log.
// 真链 KAS payout 待 Phase 2b exchange-machine.transition delivering→completed 集成.
import { startPredictionSettlerCron } from './services/bettor-prediction-settler.js';
startPredictionSettlerCron();

// Phase 3a r211 O-6 — prediction oracle voter daemon (Bettor r211 v3 + J1 #318 PB consensus).
// 5min cron, scan host-local is_oracle=1 relays + vote offers via Polymarket gamma (Phase 3a MVP).
// Vote DM to maker_relay (PB-D aggregator), 1-to-1 不上链 broadcast (PB-C, 5x fee 省).
// kanet_oracle_vote_v1 JSON + evidence_hash sha256 (PB-B). Phase 3a 仅 polymarket_uma_mirror,
// Phase 4 加 LLM consensus + multi-source diversity.
import { startPredictionVoterCron } from './services/bettor-prediction-voter.js';
startPredictionVoterCron();

// Phase B Variant Expander 3-tier (Owner 5/16 钦定 "B" + Bettor r141 spec) — 30 min cron.
// per scanner rec → auto-find related markets → 3 档 variant (激进/适中/保守) INSERT.
// Phase 1 skeleton + UI surface, Phase 2 will integrate depth-500 /book API real-time.
import { startVariantExpanderCron as startBettorVariantExpander } from './services/bettor-variant-expander.js';
startBettorVariantExpander();

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

// P2 broker treasury monitor (Owner 5/18 自主运营 #3 钦定 + NWT N19.6 verdict).
// 5min cron snapshot broker 多链 USDT/USDC/KAS balance, alert via chain_event 'treasury_alert'.
// 不动钱 (read-only), auto-rebalance 排日 Phase 2.
import { startTreasuryMonitor } from './services/broker-treasury-monitor.js';
startTreasuryMonitor();

// C2 Cross-Match Engine (J2 #519/523 / NWT N19.11/N19.17 三方共识 5/19, Owner 钦定 "C 是骨架").
// 30s cron 扫 open exchange_offers, 找 BUY+SELL 数学有交集 pair (oracle ±3% + chain align + same-org skip + qty ±5%).
// emit chain_event 'kanet_cross_match_v1' Brain visible. Phase 1 audit-only, Phase 2 active match-settle.
import { startCrossMatchEngine } from './services/cross-match-engine.js';
startCrossMatchEngine();

// P0c hedge invariant self-test (J2 #520 / NWT N19.12 三方共识 5/19, KI 第 16 次 silent skip 修).
// 启动时 verify SQL 字段 + chain_event hedge_failed 路径存在, 防 KI 第 17 次复刻.
try {
  const { sqlite } = await import('./db/client.js');
  // Layer A: verify exchange_offers.metadata 存在 (历史 KI 16 真因 SELECT meta typo 30 day silent dead).
  sqlite.prepare('SELECT metadata FROM exchange_offers WHERE 1=0').get();
  // Layer B: verify chain_events table 接受 hedge_failed event_type (post-completed audit 用).
  const { recordChainEvent } = await import('./services/chain-event.js');
  if (typeof recordChainEvent !== 'function') throw new Error('recordChainEvent not exported');
  console.log('[hedge-invariant] self-test PASS: exchange_offers.metadata exists + chain-event.js loaded');
} catch (err) {
  console.error(`[hedge-invariant] 🚨 self-test FAIL: ${err.message} — hedge 路径可能 silent dead, 立查!`);
}

// J1-3 (Phase E v3 Step 1c, J1 #55 propose + NWT 01:15 ack): _sweepStaleAligning cron 5min
// — broker-intake-watcher refund tick 仅 process 'awaiting_payment', 'aligning' rows 永不 sweep.
// J2 Step 1b setConvoStateLock 入口 INSERT 'aligning' row 后必 cleanup pattern.
import { startStaleAligningSweep } from './services/broker-state-authority.js';
startStaleAligningSweep();

// SA-5b (J2 Phase Y+1 Ship A): reconcileStaleOrders 15min cron tick + 1h startup grace.
// 找 awaiting_payment 30min+ 老 + 0 paid evidence + checkBrokerEscrow=false (broker 真没持) → force-fail.
// 1h grace 防 5 Agent stagger restart 期 第 1 cycle 误判 historical row.
import { startReconcileCron } from './services/broker-state-machine.js';
startReconcileCron();

// J1 #72 Wire 2 (vote b — territory clean split per NWT 04:08 propose):
// broker-state-reconciler 5min cron — chain-truth audit + retry-able 'expired'/'refund_send_failed' detect + Phase 3 backfill via advanceToRefunded(reason='reconciler_retry').
// NWT territory file (broker-state-reconciler.js), J1 territory startup wire (index.js).
import { startStateReconciler } from './services/broker-state-reconciler.js';
startStateReconciler();

// Phase 4 (T-J2-09): broker-buy-completion-watcher — BUY 闭环, broker 代 accept 后 DM user KAS 到账
import { startCompletionWatcher } from './services/broker-buy-completion-watcher.js';
startCompletionWatcher();

// Phase A.2 (J2 #336 per NWT spec ffcd4778, Owner 5/13 钦定纯菜单模式):
// bsc-incoming-watcher archived — 跟 broker-buy-handler (in-memory _pendingAccepts) 强耦合,
// LLM bot 路径死. broker-v3 menu mode 走协议层 cross-chain-verify (Phase 2 β multichain), 不需此 watcher.

// NWT-V3 / Qclaude (2026-04-27): monitor 服务启动 (route 在 fastify.listen 前已注册, 见 line 137)
// NWT 19:50 修 3 个 bug:
//   1. monitor-service.js:216 lastTs 重复声明 → rename latestTs
//   2. monitor-dashboard.js inline HTML template literal 嵌套 backtick 解析错 → 抽出 monitor-dashboard.html
//   3. registerMonitorRoutes 调用位置错 (在 fastify.listen 之后) → 上移到 line 137 跟其他 routes 一起
import { startMonitor, stopMonitor } from './services/monitor-service.js';
// R-NWT-2026-04-29: Owner 01:09 钦定 NWT host 仅跑 Claude Code Monitor (Anthropic CLI 内置), 不跑 KANet monitor-service.
// 原因: KANet monitor-service 累积 events_today 70k + cooldown semantic 跟 NWT Claude Code Monitor 监 dev-coord 重复.
// 修: disable startMonitor() — events 表 frontend dashboard 不再累积 spam.
// J1/J2 host 不受影响 (各自 host 各自 startMonitor 决策).
// startMonitor();  // disabled per Owner 01:09 钦定

// Graceful shutdown — stop all child processes
async function shutdown() {
  console.log('[kasia-console] shutting down...');
  await stopAllRelays();
  await stopAllAdapters();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
