import Fastify from 'fastify';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

// J2-tn r429 (Bettor r467 P0 Console crash 根治): defensive top-level handlers.
// 防 Console 反复 crash 真因 — uncaught exception / unhandledRejection 自 child relay /
// adapter spawn / scout RPC / LLM 调用. 保进程活, log 异常 (= supervisor 不再每次拉起).
process.on('uncaughtException', (err) => {
  console.error('[kanet:uncaught]', err?.stack || err?.message || String(err));
});
process.on('unhandledRejection', (reason) => {
  console.error('[kanet:unhandled-rejection]', reason?.stack || reason?.message || String(reason));
});

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
import { registerLinkRoutes } from './api/link.js';
import { registerHealthRoutes } from './api/health.js';
import { registerContextRoutes } from './api/context.js';
import { registerSettingsRoutes } from './api/settings.js';
import { registerIdentityRoutes } from './api/identities.js';
import { registerSkillRoutes } from './api/skills.js';
import { registerDiscoveryRoutes } from './api/discovery.js';
import { registerChatRoutes } from './api/chat.js';
import { registerDevChannelV1Routes } from './api/dev-channel-v1.js';
import { registerPeerCoordRoutes } from './api/peer-coord.js';
import { registerTradingRoutes } from './api/trading.js';
import { registerChainDataRoutes } from './api/chain-data.js';
import { registerStockRoutes } from './api/stocks.js';
import { registerBettorRoutes } from './api/bettor.js';
import { registerPoolRoutes } from './api/pool.js';
import { registerAdminDedupRoutes } from './api/admin-dedup.js'; // #27 dedup 存量清理 admin endpoint
import { registerKanetBrokerRoutes } from './api/kanet-broker.js';
import { registerTgWalletRoutes } from './api/tg-wallet.js'; // TG custodial wallet (Owner 钦定, Bettor 审)
import { registerKanetMakerRoutes } from './api/kanet-maker.js';
import { registerOraclePoolRoutes } from './api/oracle-pool.js';
import { registerTestOracleRoutes } from './api/test-oracle.js';
import { registerBrokerRoutes } from './api/broker.js';
import { registerAuthRoutes } from './api/auth.js';
import { registerOAuthRoutes } from './api/oauth.js';
import { registerExchangeRoutes } from './api/exchange.js';
import { registerAuditPredictionRoutes } from './api/audit-prediction.js';
import { registerDefiRoutes } from './api/defi.js';
import { registerPortfolioRoutes } from './api/portfolio.js';
import { registerBackupRoutes } from './api/backup.js';
import { registerBudgetRoutes } from './api/budget.js';
import { registerAdminRoutes } from './api/admin.js';
import { registerEscrowRoutes } from './api/escrow.js';
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

// ignoreDuplicateSlashes: //welcome-dev → /welcome-dev (= Owner 2026-05-28 撞双斜杠 404 修).
// ignoreTrailingSlash: /faucet/ → /faucet (= 顺手防尾斜杠 404).
// gap-A: trustProxy scoped to the reverse proxy (127.0.0.1) so request.ip resolves to the REAL client
// from X-Forwarded-For ONLY when the hop is the trusted local proxy (the faucet per-IP 24h×3 limit in
// chat.js:585 reads request.ip — without this it sees 127.0.0.1 for every external user behind the proxy
// → per-IP limit collapses to one shared bucket). Never `trustProxy: true` (unscoped = X-Forwarded-For
// spoofable). Harmless pre-proxy: Console is localhost-bound, only localhost (trusted) can reach it.
const fastify = Fastify({ logger: false, ignoreDuplicateSlashes: true, ignoreTrailingSlash: true, trustProxy: '127.0.0.1' });

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
await registerLinkRoutes(fastify);
await registerContextRoutes(fastify);
await registerSettingsRoutes(fastify);
await registerIdentityRoutes(fastify);
await registerSkillRoutes(fastify);
await registerDiscoveryRoutes(fastify);
await registerChatRoutes(fastify);
registerDevChannelV1Routes(fastify);
registerPeerCoordRoutes(fastify);
await registerTradingRoutes(fastify);
await registerChainDataRoutes(fastify);
await registerStockRoutes(fastify);
await registerBrokerRoutes(fastify);
await registerAuthRoutes(fastify);
await registerOAuthRoutes(fastify);
await registerExchangeRoutes(fastify);
await registerAuditPredictionRoutes(fastify);
await registerBettorRoutes(fastify);
await registerPoolRoutes(fastify);
await registerAdminDedupRoutes(fastify);
await registerKanetBrokerRoutes(fastify);
await registerTgWalletRoutes(fastify);
await registerKanetMakerRoutes(fastify);
await registerOraclePoolRoutes(fastify);
await registerTestOracleRoutes(fastify);
await registerDefiRoutes(fastify);
await registerPortfolioRoutes(fastify);
await registerBackupRoutes(fastify);
await registerBudgetRoutes(fastify);
await registerAdminRoutes(fastify);
await registerEscrowRoutes(fastify);

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

// KANet-UI A.1 — B2 pool prediction market maker create UI (= V2 Editorial Dashboard)
// spec: docs/b2-pool-ui-spec-v0.1.md Section 1 A.1, Bettor r443+r449 lock
fastify.get('/predictions/pool/create', async (request, reply) => {
  const lang = parseLang(request.headers.cookie);
  const t = getT(lang);
  const relayNodes = _listRelayNodes();
  return reply.viewAsync('predictions-pool-create', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', relayNodes, _page: 'predictions-pool-create' });
});

// /predictions/oracle-registry — retired (Gap 3 dedup, Bettor r36 GO).
// Subsumed by /oracle home (Owner 钦定 ② independent oracle system UI, Bettor r35 CLOSE).
// 信任系统 tab + 我的 oracle tab 覆盖 registry 全功能 + 池透明 + 每市场信任 + onboarding.
// predictions-oracle-registry.eta fossil retained.
fastify.get('/predictions/oracle-registry', async (request, reply) => {
  return reply.redirect(302, '/oracle');
});

// Oracle UI piece 1+2 (Bettor r128/r129) — pool market detail page (= 填 create 页 dead link + oracle 透明度)
// reads /api/pool/market/:id + /api/oracle/markets/:id/audit. State branch: live vote progress vs settled result.
fastify.get('/predictions/pool/:id', async (request, reply) => {
  const lang = parseLang(request.headers.cookie);
  const t = getT(lang);
  return reply.viewAsync('predictions-pool-detail', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', marketId: request.params.id, _page: 'predictions-pool-detail' });
});

// /audit → redirect to /contacts
fastify.get('/audit', async (request, reply) => {
  const agent = request.query.agent ? `?agent=${request.query.agent}` : '';
  return reply.redirect(`/contacts${agent}`);
});

// /settings → redirect to /relays (node config is there now)
fastify.get('/settings', async (request, reply) => reply.redirect('/relays'));

// Broker home — Gap 1 (Owner UI buildout, Bettor r29 LOCK + r28 role-home 模板).
// Subsume /agent?tab=broker (Iron Rule "建=取代非新增"). Data: J2 r111 kanet-broker endpoints.
fastify.get('/broker', async (request, reply) => {
  const lang = parseLang(request.headers.cookie);
  const t = getT(lang);
  return reply.viewAsync('broker-home', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', _page: 'broker' });
});

// Oracle home — Gap 2 batch 1 (Owner UI buildout, Bettor r29 LOCK). 用同 role-home 5 块模板.
// Subsume /agent?tab=oracle. Data: J1 r137 /api/oracle/income + /api/oracle/max-pot + relay endpoints.
fastify.get('/oracle', async (request, reply) => {
  const lang = parseLang(request.headers.cookie);
  const t = getT(lang);
  return reply.viewAsync('oracle-home', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', _page: 'oracle' });
});

// Maker home — 数据三角色补齐 Lane① (Bettor r639). 我的市场 + 盈亏 (P&L). Data: /api/kanet-maker/*.
fastify.get('/maker', async (request, reply) => {
  const lang = parseLang(request.headers.cookie);
  const t = getT(lang);
  return reply.viewAsync('maker-home', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', _page: 'maker' });
});


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
await fastify.listen({ port: PORT, host: process.env.HOST || '127.0.0.1' });
console.log(`[kasia-console] running at http://localhost:${PORT}`);

// Tier 2.1 pair ingestor — scans broadcast_messages for pair_invite/pair_ack envelopes + writes agent_pairs.
// 30s tick, idempotent re-scan, boot catch-up from id 0.
import { startPeriodicIngest } from './services/pair-ingestor.mjs';
startPeriodicIngest({ interval_ms: 30_000 });

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

// Auto-start the Telegram broker bot if the operator previously enabled it (tg_bot_enabled='1').
// Manual Stop is remembered (adapter is_enabled pattern), so the bot survives Console restarts
// without going live on its own. (KANet-UI, Bettor r945 接通最小路 ①)
import { startTgBotIfConfigured } from './services/tg-bot-manager.js';
await startTgBotIfConfigured();

// 多-bot tg-manager (Owner 钦定 2026-06-22): per-approved-broker bot (地址制). Boots a bot for every
// approved broker_onboarding (trust elevated) + 60s reconcile to pick up new approvals / respawn deaths.
import { startBrokerBotManager } from './services/broker-bot-manager.js';
startBrokerBotManager();

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

// Phase B auto-valve 兜底救命 (Owner 5/16 钦定 "万一我忘记了" + Bettor r137 spec) — 1h cron.
// 4 valves: A redeem / B sim resolved verdict / C -30%pnl 12h / D 90d zombie.
import { startAutoValveCron as startBettorAutoValve } from './services/bettor-auto-valve.js';
startBettorAutoValve();

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

// Track B (production-trustless 自治-enforce): bshard close_attest voter daemon. 30s cron, scan host-local
// is_oracle=1 relays + v0.7 markets in 'collecting_sigs' with metadata.bshard_close_request → each committee
// node INDEPENDENTLY runs enforceCloseAttest (命门①③④ + frozen_evidence 同源 + fix① 链锚 re-derive + C1/C3/D1)
// before its relay signs (replaces relay blind-sign). E1 ctx hooks wired (J2 2026-06-22).
import { startBshardCloseVoterCron } from './services/bshard-close-voter.js';
startBshardCloseVoterCron();

// B2 v0.5 Sub 2d Phase 1 — pool_markets settler (aggregate 3 oracle votes + consensus check).
// Phase 2 (TX construction + sig orchestration + broadcast) deferred.
import { startPoolMarketSettlerCron } from './services/pool-market-settler.js';
startPoolMarketSettlerCron();

// DoD C 收尾 (Bettor r393): 5min cron 自动领 unclaimed bettor refunds for cancelled markets.
// J1 2026-06-20: env gate (BETTOR_REFUND_CLAIM_ENABLED=0 disable). claimAutoDispatcherTick 在 255-market backlog 上每 tick
//   重同步 DB 查(better-sqlite3 native)打满 console CPU(node --prof 钉死, 见记忆 console-restart-storm)→ 100% peg 堵死
//   频道 send/ingest + HTTP。default-on(canonical 无 env 照跑); 我 :3300 kanet.env set 0 止血。
import { startBettorRefundClaimAutoCron } from './services/bettor-refund-claim-auto.mjs';
if (process.env.BETTOR_REFUND_CLAIM_ENABLED !== '0') { startBettorRefundClaimAutoCron(); }
else { console.log('[claimAuto] disabled via BETTOR_REFUND_CLAIM_ENABLED=0 (J1 CPU-hog gate)'); }

// r420 auto-bet (Bettor r433/r436 Owner 钦定 规模化跨域实测): Console-cron 自动押注.
// 取代外部 _nwt_tn_autobet_loop.mjs daemon (= 不 follow Console restart, KANet-UI r656 surface).
// env: AUTO_BET_TICK_MS (60s default), AUTO_BET_PER_TICK (2), MIN/MAX_STAKE_KAS (1/50),
//      MIN_RESERVE_KAS (10), AUTO_BET_RELAYS (= AutoBetter-1/2/3 + tester-1/2/3 default).
import { startAutoBetterCron } from './services/pool-auto-better.js';
startAutoBetterCron();

// #42 (Bettor 2026-07-04 头号2, qzdh7nar 判断源 + KANet-UI 下注执行): house agent 公开判断+真押
// 世界杯淘汰赛盘("击败 Agent" 玩法), 单一固定身份(HouseAgent relay), 每盘只押一次(去重), 方向来自
// judgeWinDir 同源判断(非独立复刻)。env: HOUSE_AGENT_TICK_MS (5min default), HOUSE_AGENT_STAKE_KAS (20).
import { startHouseAgentCron } from './services/pool-house-agent.js';
startHouseAgentCron();

// #42 加大方案·治本 (Bettor 2026-07-04 "别再充一次跑几单又干"): 自动巡检 AutoBetter/HouseAgent
// relay 余额, 低于阈值从 mining 储备(#34 consolidate 出的 faucet reserve)自动补, 不用再手动 curl
// transfer。env: BOT_AUTOFUND_SOURCE_RELAY_ID(必设才启动) / THRESHOLD_KAS(500) / AMOUNT_KAS(3000).
import { startBotAutofundCron } from './services/pool-bot-autofund.js';
startBotAutofundCron();

// J1 #27d (Owner public-testnet hardening sprint 2026-06-14): boot catch-up for market_publishes
// missed by in-mem chunk reassembly (LRU-evicted under sign_req re-broadcast flood, or lost across a
// restart). Rebuilds pre-restart misses from the DURABLE broadcast_messages store (idempotent: the
// handler skips rows that already exist). Runtime misses self-heal via orphan bet/vote signal-triggers
// in trade-protocol-filter (NWT r1166 ④). force=true bypasses the throttle for this one-shot boot pass.
import { catchUpUningestedMarkets } from './services/trade-protocol-filter.js';
catchUpUningestedMarkets({ windowHours: 24, force: true }).catch((e) => console.warn('[index] #27d boot market catch-up fail:', e.message));

// r425 relay-orphan 固化 (Bettor r446 task 2): 30s cron 扫 enrolled relays, dead → startRelay.
// 配合 r424 Console supervisor: supervisor 救 Console 死, monitor 救 relay 死/没起来.
// Restart storm 防护: 3/h cap per relay.
import { startRelayHealthMonitorCron } from './services/relay-health-monitor.js';
startRelayHealthMonitorCron();

// Oracle-voter PRODUCING-health (KANet-UI, Q2 durability hard-req per NWT/Bettor r989/r997): relay-health
// catches a DEAD relay, but Q2 was a SILENT 0-vote stall while the voter cron ran fine (process-alive).
// 2min cron flags verifying markets a LOCAL committee oracle owes a vote on but hasn't cast (>10min) →
// WARN log + events row (Brain/UI visible). Detect+surface only (a vote-routing/quorum bug isn't restart-healable).
import { startOracleVoterHealthMonitorCron } from './services/oracle-voter-health-monitor.js';
startOracleVoterHealthMonitorCron();

// 质押池活化 (Bettor r449): 5min cron 刷 oracle_pool_chain_view 保新鲜.
import { startOraclePoolScannerCron } from './services/oracle-pool-chain-scanner-cron.mjs';
startOraclePoolScannerCron();

// oracle 锁自动续期 (task#13 Bettor 2026-06-30·28h urgency): 1h cron, lock_until_daa 到期前 3M DAA 续 10M.
import { startOraclePoolRenewalCron } from './services/oracle-pool-renewal-cron.mjs';
startOraclePoolRenewalCron();

// bshard 自治结算 daemon (Owner 2026-06-30 钦定 A·SETTLE_DAEMON_ENABLED=1 才跑, 默认 OFF).
// canary: MAX_PER_TICK=1, TICK=60s → 验 → ramp。J1 covenant 是真安全网, DB lease = best-effort。
import { startSettleDaemonCron } from './services/bshard-settle-daemon.mjs';
startSettleDaemonCron();

// design-v2 (B) broadcaster N-medium-UTXO maintainer (KANet-UI, 880 settle-throughput; Bettor r489b APPROVE).
// Proactive cron keeps settle broadcasters (local oracle signers + hot seeder maker) topped at N confirmed
// medium UTXOs → settle sign_req chunks pick the next pre-confirmed UTXO instead of waiting each chunk's
// change to confirm = eliminates inter-chunk confirm-wait (the real 880 bottleneck; NOT parallelism —
// sendKaspa is serial via withSendLock). The rebalance shares that same withSendLock (utxo-split.mjs) so it
// can never double-spend an in-flight settle/sign_req. Hard-gated by load test (before ~33min / after).
import { startBroadcasterUtxoMaintainerCron } from './lib/broadcaster-utxo.mjs';
startBroadcasterUtxoMaintainerCron();

// #34 Direction C (2026-07-04, qzdh7nar design + Bettor/NWT co-verify): mining payout moved off the
// old 294.7万-UTXO address (protocol-level unreadable, GetUtxosByAddresses has no pagination — see
// mining-utxo-consolidate.mjs header) to a fresh address. This cron keeps the NEW address's UTXO
// count bounded so it never regrows into the same wall. No-op until MINING_RELAY_ID is set in kanet.env.
import { startMiningConsolidateCron } from './lib/mining-utxo-consolidate.mjs';
startMiningConsolidateCron();

// 查漏补缺 (NWT 2026-07-04 挖到的 gap, Bettor 裁定 launch 前必补): 公开 FaucetRelay-tn 之前完全没有
// 持续健康监控, 今早 G4 炸过一次(UTXO 碎片化), 退化了会对真实公开用户静默失败。纯只读监控+告警,
// 不做任何自动 consolidate/split(避免跟正在进行的用户 faucet transfer 撞车)。
import { startFaucetHealthCron } from './lib/faucet-utxo-health.mjs';
startFaucetHealthCron();

// 查漏补缺 (Owner 2026-07-04 追问"以后新盘会不会也卡死"·团队诚实答"机制设计本身脆, 靠人工
// review 救但今天证明这个人工环节从没真正发生过"): 不改 daemon 核心逻辑(跨tick自动重试是另一条
// 待 Owner 批的根治线), 只做"一进 settle_failed 立刻告警"这一步, operator 第一时间知道不用等
// 事后翻查/公开用户投诉/Owner 自己撞见。
import { startSettleFailedAlertCron } from './lib/settle-failed-alert.mjs';
startSettleFailedAlertCron();

// 查漏补缺(2026-07-04晚, J2撞见C盘0字节可用·curl全炸): disk full会静默拖垮全系统,之前没有任何
// 监控(全靠J2手动碰见)。跟faucet-health/settle-failed-alert同款模式: 只读监控+告警,不做任何自动
// 清理(删文件风险高,交operator判断哪些安全删)。
import { startDiskSpaceAlertCron } from './lib/disk-space-alert.mjs';
startDiskSpaceAlertCron();

// Phase B Variant Expander 3-tier (Owner 5/16 钦定 "B" + Bettor r141 spec) — 30 min cron.
// per scanner rec → auto-find related markets → 3 档 variant (激进/适中/保守) INSERT.
// Phase 1 skeleton + UI surface, Phase 2 will integrate depth-500 /book API real-time.
import { startVariantExpanderCron as startBettorVariantExpander } from './services/bettor-variant-expander.js';
startBettorVariantExpander();

// #35 世界杯赛程自动开盘 (J2, 2026-07-04, Owner 钦定头号任务·G1 §3).
// ESPN 自己为 QF/SF/3rd/Final 预先发布占位符赛事(真 event id + kickoff), cron 定期检测占位符是否已
// 解析成真队伍(真队伍缩写从不含数字), 解析后按 G1 措辞模板+ #41/R16 验过的安全 create-v07 管线自动建盘。
import { startWorldcupScheduleCron } from './services/worldcup-schedule-cron.mjs';
startWorldcupScheduleCron();

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

// Pool-market seeder (S-A, Bettor r240) — auto-mirror real Polymarket top-volume markets →
// pending_bettors. Opt-in via POOL_SEEDER_ENABLED=1 + POOL_SEEDER_MAKER_RELAY (off = no-op).
import { startPoolMarketSeeder } from './services/pool-market-seeder.js';
startPoolMarketSeeder();

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
