import { listConversations, getConversation, getDashboardStats } from '../data/state/conversations.js';
import { updateIdentity, getIdentityById, getIdentityByAddress, upsertIdentity, setTrustLevel, listIdentities } from '../data/settings/identities.js';
import { getMessagesByConversation } from '../data/state/messages.js';
import { getRepliesByConversation } from '../data/state/replies.js';
import { getTxsByConversation } from '../data/state/tx-records.js';
import { getEventStats, listEvents } from '../data/state/events.js';
import { listRelayNodes } from '../data/settings/relay-nodes.js';
import { fmtDate, relativeTime } from '../lib/time.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import { sqlite } from '../db/client.js';
import { getReply, resolveRelayNodeId } from '../services/mind-manager.js';
import { getStatus as getRelayStatus } from '../services/relay-manager.js';
import { buildEpisodes, getEpisodeDetail, buildMindSummary } from '../services/episode-builder.js';

export async function registerConversationRoutes(fastify) {
  // Home → welcome if no agents, otherwise chat (partner-first, not dashboard-first)
  fastify.get('/', async (request, reply) => {
    const hasAgents = listRelayNodes().length > 0;
    return reply.redirect(hasAgents ? '/chat' : '/welcome');
  });

  // Agent profile page — v2 (design system)
  fastify.get('/agent', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const tab = request.query.tab || '';
    return reply.view('agent-v2', { title: '我的 Agent', t, lang, dir, langs, _page: 'agent', _agentTab: tab });
  });

  // Agent profile page — legacy (for rollback if needed)
  fastify.get('/agent-legacy', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    return reply.view('agent', { title: '我的 Agent', t, lang, dir, langs });
  });

  // Page: /approvals — standalone pending approvals page
  fastify.get('/approvals', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    return reply.view('approvals', { title: '审批', t, lang, dir, langs });
  });

  // Agent profile API — returns all relay agents with card/stats
  // v28: reads from relation_states (unified protocol state layer)
  fastify.get('/api/agent/profile', async (request, reply) => {
    const relays = listRelayNodes();
    const relayStatuses = getRelayStatus();
    const relayRunningSet = new Set(relayStatuses.map(rs => rs.relayNodeId));
    const agents = [];
    for (const r of relays) {
      const identity = sqlite.prepare('SELECT * FROM identities WHERE address = ?').get(r.address);

      // Stats from relation_states (single source of truth)
      const relStats = sqlite.prepare(
        'SELECT status, COUNT(*) as c FROM relation_states WHERE local_address = ? GROUP BY status'
      ).all(r.address);
      const statusMap = {};
      relStats.forEach(s => statusMap[s.status] = s.c);

      const contactCount = Object.values(statusMap).reduce((s, v) => s + v, 0);
      const handshakeCount = (statusMap.active || 0) + (statusMap.confirmed || 0) + (statusMap.accepted || 0);
      const interactionCount = sqlite.prepare(
        'SELECT COUNT(*) as c FROM chain_events WHERE from_address = ? OR to_address = ?'
      ).get(r.address, r.address)?.c || 0;
      const firstActive = sqlite.prepare(
        'SELECT MIN(handshake_observed_at) as t FROM relation_states WHERE local_address = ?'
      ).get(r.address)?.t || null;
      const lastActive = sqlite.prepare(
        'SELECT MAX(updated_at) as t FROM relation_states WHERE local_address = ?'
      ).get(r.address)?.t || null;

      // Adapter info from DB
      const adapter = r.adapter_node_id
        ? sqlite.prepare('SELECT id, name, http_port, ai_provider, ai_model FROM adapter_nodes WHERE id = ?').get(r.adapter_node_id)
        : null;

      agents.push({
        id: r.id,
        name: r.name,
        address: r.address,
        focus: r.focus || 'balanced',
        // T-J2-2026-05-11 Phase 2 η.3: 加 role 字段 (Owner 5/11 钦定 + NWT #16)
        role: r.role || null,
        is_dex_broker: r.is_dex_broker || 0,
        is_service: r.is_service || 0,
        adapter_node_id: r.adapter_node_id || null,
        adapterName: adapter?.name || null,
        adapterPort: adapter?.http_port || null,
        adapterProvider: adapter?.ai_provider || null,
        adapterModel: adapter?.ai_model || null,
        relayRunning: relayRunningSet.has(r.id),
        card: identity ? {
          mode: identity.card_mode,
          entityType: identity.card_entity_type,
          skills: identity.card_skills_json ? JSON.parse(identity.card_skills_json) : [],
          summary: identity.card_summary,
          version: identity.card_version,
        } : null,
        stats: { contactCount, interactionCount, handshakeCount, firstActive, lastActive, ...statusMap },
      });
    }
    return agents;
  });

  // R-NWT-2026-04-28 (d) B phase 4: test-only — clear broker per-peer Map state.
  // Gated by KANET_TEST_MODE env. Production console (no env) → 404.
  // Used by test framework cleanup_peer_broker_state action for race-condition tests.
  if (process.env.KANET_TEST_MODE === '1') {
    fastify.post('/api/test/reset_peer', async (request, reply) => {
      const { peers } = request.body || {};
      if (!Array.isArray(peers) || peers.length === 0) return reply.code(400).send({ error: 'peers array required' });
      const { resetConvoState } = await import('../services/broker-state-authority.js');
      const { _testClearPeerState } = await import('../services/broker-buy-handler.js');
      const { _testClearPending } = await import('../services/broker-sell-handler.js');
      const { _testClearPendingFields } = await import('../services/broker-llm-agent.js');
      const { _testClearUserActions } = await import('../services/broker-action-queue.js');
      for (const peer of peers) {
        try { resetConvoState(peer, 'test_cleanup'); } catch (e) { /* may not exist */ }
        _testClearPeerState(peer);
        _testClearPending(peer);
        _testClearPendingFields(peer);
        _testClearUserActions(peer);
      }
      return { cleared: peers.length, peers: peers.map(p => p.slice(-12)) };
    });

    // R-NWT-2026-04-28 (d) lifecycle infra (J2 d6022b59 propose): seed broker _pendingAccepts
    // for paid-cannot-cancel probe. test-only, env-gated.
    // bug 8 fix (J2 r25 vote (c) dual-write): broker-v2 SQL state machine 不见 v1 _pendingAccepts
    // in-memory state. INSERT retail_dex_orders state='paid' 让 broker-v2 router cancel intent path
    // 进 'state==paid' 拒 cancel 分支 (router L61). 向后兼容 v1 测.
    fastify.post('/api/test/seed_pending_accept', async (request, reply) => {
      const { peer, data } = request.body || {};
      if (!peer || !data) return reply.code(400).send({ error: 'peer + data required' });
      const { _testSetPendingAccept } = await import('../services/broker-buy-handler.js');
      _testSetPendingAccept(peer, { ...data, expires_at: data.expires_at || (Date.now() + 30 * 60 * 1000) });
      // dual-write retail_dex_orders state='paid' for broker-v2 visibility
      try {
        const { sqlite } = await import('../db/client.js');
        const totalKas = data.total_kas || data.picks?.reduce((s, p) => s + (p.qty_kas || 0), 0) || 0;
        const id = `bv2_seed_${peer.slice(-12)}_${Date.now()}`;
        sqlite.prepare(`
          INSERT INTO retail_dex_orders
            (id, user_kasia_address, side, state, order_type, qty, pay_chain,
             created_at, updated_at, expires_at)
          VALUES (?, ?, 'buy_kas', 'paid', 'limit', ?, ?,
                  datetime('now'), datetime('now'),
                  datetime('now', '+30 minutes'))
        `).run(id, peer, String(totalKas), data.pay_chain || 'bnb');
      } catch (err) {
        console.warn(`[seed_pending_accept] dual-write retail_dex_orders failed: ${err.message}`);
      }
      return { seeded: true, peer: peer.slice(-12) };
    });

    // R-NWT-2026-04-28 (d) lifecycle infra: force state.expires_at backdate for expire-boundary probe.
    fastify.post('/api/test/force_state_expire', async (request, reply) => {
      const { peer } = request.body || {};
      if (!peer) return reply.code(400).send({ error: 'peer required' });
      const { _testForceExpire } = await import('../services/broker-state-authority.js');
      const result = _testForceExpire(peer);
      return result;
    });

    // T-J2-2026-04-29 Track B Track E test infra (NWT 8271dc4d ask J2 expose):
    // double_refund_idempotency.test.mjs trigger_refund_sweep custom action 真 endpoint.
    // 直接调 broker-intake-watcher._scanExpiredBrokerOffers (cron 5min tick path) sync.
    fastify.post('/api/test/trigger-refund-sweep', async (_request, _reply) => {
      const { _scanExpiredBrokerOffers } = await import('../services/broker-intake-watcher.js');
      const result = await _scanExpiredBrokerOffers();
      return { ok: true, ...result };
    });

    // T-J2-2026-04-29 (J1 #81 e6de8625 fundamental fix + J1 #86 双 vote A1' fail-closed + (a) export _defaultExecute):
    // sendKas mock cross-process isolation + production user 真 protect.
    // 真 fail-closed peer registry Set: empty Set OR action.peer ∉ Set → real chain TX (production user 不 mock).
    // 仅 explicit registered test peer 真 inject 真 fakeTxId fire.
    const _testPeerSet = new Set();

    fastify.post('/api/test/inject-send-kas-mock', async (request, _reply) => {
      const { peer_addr } = request.body || {};
      if (peer_addr) {
        if (Array.isArray(peer_addr)) peer_addr.forEach(p => _testPeerSet.add(p));
        else _testPeerSet.add(peer_addr);
      }
      const { _testInjectExecute, _defaultExecute } = await import('../services/broker-action-queue.js');
      const { randomUUID } = await import('node:crypto');
      _testInjectExecute(async (action) => {
        // T-J2-2026-04-29 (J1 #91 + NWT bd08e518 propose debug log): trace mock callback invocation
        // 真 confirm hypothesis 3 peer string mismatch OR _testPeerSet state.
        console.log(`[mock-debug] kind=${action.kind} peer=${(action.peer || '').slice(-16)} peer.length=${action.peer?.length || 0} setSize=${_testPeerSet.size} has=${_testPeerSet.has(action.peer)}`);
        // J1 #86 vote Q1 fail-closed: empty Set OR peer 不 registered → real chain TX (production protect).
        if (!_testPeerSet.has(action.peer)) {
          return await _defaultExecute(action);
        }
        if (action.kind === 'sendKas') {
          // 64-hex fake hash (post-v83 trigger length=64 + hex-only PASS)
          const fakeTxId = (randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')).slice(0, 64);
          // 同时 INSERT kaspa_tx_log mock row 真 Track A chain-truth dedup query 真 hit
          const peer = action.peer;
          const amount = parseFloat(action.payload?.amount_kas || 0);
          if (peer && amount > 0) {
            try {
              const { sqlite } = await import('../db/client.js');
              sqlite.prepare(`
                INSERT OR IGNORE INTO kaspa_tx_log (tx_id, block_time, to_address, amount, observed_at, network)
                VALUES (?, ?, ?, ?, datetime('now'), 'test')
              `).run(fakeTxId, Math.floor(Date.now() / 1000), peer, amount);
            } catch (e) { /* silent fail OK, mock continues */ }
          }
          return { ok: true, txId: fakeTxId, fee: '0.001' };
        }
        // 别 kind (test peer registered 真 non-sendKas action) → default execute
        return await _defaultExecute(action);
      });
      return { ok: true, mocked: true, registered_peers: [..._testPeerSet] };
    });

    fastify.post('/api/test/reset-send-kas-mock', async (_request, _reply) => {
      const { _testResetExecute } = await import('../services/broker-action-queue.js');
      _testPeerSet.clear();
      _testResetExecute();
      return { ok: true, reset: true };
    });

    // T-J2-2026-04-30 Phase β NWT vote (C) — inject_paid_mock for real-chain RC-01.
    // 暴露 broker-buy-handler._testInjectScan via HTTP. RC-01 BUY case 模拟 user 真付 USDT
    // BSC 但不真烧钱 — broker.verifyPaymentForPeer 用此 _scanOverride 返 fake event match
    // pick.take_usdt → broker fires _enqueuePaid → paid_v1 chain DM 真 broadcast.
    // 注意: 仅 broker-side payment detection mock. exchange-machine processPaymentSubmit 真链验
    // 仍走 cross-chain-verify (fake tx hash → fail), 因此此 mock 仅 cover broker-side state
    // transition, 不 cover full e2e settlement.
    fastify.post('/api/test/inject-scan-mock', async (request, _reply) => {
      const { events } = request.body || {};
      if (!Array.isArray(events)) {
        return { ok: false, error: 'events must be array of {tx_hash, amount, from?, to}' };
      }
      const { _testInjectScan } = await import('../services/broker-buy-handler.js');
      _testInjectScan(async ({ chain, recipient, span_blocks }) => {
        return { ok: true, events: events.map(e => ({
          tx_hash: e.tx_hash || `0x${'a'.repeat(64)}`,
          amount: parseFloat(e.amount),
          from: e.from || null,
          to: e.to || recipient,
          chain: chain || 'bnb',
        })) };
      });
      return { ok: true, mocked: true, event_count: events.length };
    });

    fastify.post('/api/test/reset-scan-mock', async (_request, _reply) => {
      const { _testResetScan } = await import('../services/broker-buy-handler.js');
      _testResetScan();
      return { ok: true, reset: true };
    });

    // T-NWT-2026-04-29 broker-v2 阶段 2 task 5/7 — LLM mock injection endpoint.
    // FIFO queue: inject 一次 → 下一次 _callLlm 调入口消费 → 空队列回真 Qwen.
    // body: { mock: { content?: 'text', tool_calls?: [{ function: { name, arguments } }] } }
    // 多次 inject 排队按顺序消费. 用于 broker-v2 6-turn case mock LLM tool_calls.
    fastify.post('/api/test/inject-llm-mock', async (request, _reply) => {
      const { mock } = request.body || {};
      if (!mock || typeof mock !== 'object') {
        return _reply.code(400).send({ error: 'mock object required, e.g. { content: "...", tool_calls: [...] }' });
      }
      const { _testInjectLlmMock } = await import('../services/broker-llm-agent.js');
      return _testInjectLlmMock(mock);
    });

    fastify.post('/api/test/reset-llm-mock', async (_request, _reply) => {
      const { _testResetLlmMock } = await import('../services/broker-llm-agent.js');
      return _testResetLlmMock();
    });
  }

  // R34 (J1 R26 territory, P1 race anti-spam): in-process dedup cache 防 console-direct 入口
  // duplicate spam. Production user typical 走 relay → seen.json txId dedup. console-direct caller
  // (test framework, direct API call, broken Mind retry) bypass relay 真**真**真 dedup hole.
  // 5s 窗 exact-match → silent skip + skip_reason='recent_duplicate'. matches probe race-rapid-retry-anti-spam.
  // Window choice: 5s 跟 broker-action-queue R4 anti-spam 同 (5s rapid duplicate); production user
  // legitimate retry (network hiccup) typically > 5s 后 retry, 不 false-block.
  const _inboundDedup = new Map();  // peer → { msg, ts_ms }
  const INBOUND_DEDUP_WINDOW_MS = 5000;
  function _checkInboundDedup(peer, msg) {
    const cached = _inboundDedup.get(peer);
    if (cached && cached.msg === msg && (Date.now() - cached.ts_ms) < INBOUND_DEDUP_WINDOW_MS) {
      return { dup: true, age_ms: Date.now() - cached.ts_ms };
    }
    _inboundDedup.set(peer, { msg, ts_ms: Date.now() });
    return { dup: false };
  }

  // Agent Mind reply — unified entry point for relay and external callers.
  // All AI replies go through mind-manager. No adapter fallback.
  fastify.post('/api/agent/reply', async (request, reply) => {
    const { relayNodeId, peer, message, txId, channel } = request.body || {};
    if (!peer || !message) return reply.code(400).send({ error: 'peer and message required' });

    // R34 P1 race anti-spam (J1 territory, NWT 7a-2 ε surveillance dataset 抓的 product gap):
    // 5s 内同 peer 同 message → silent skip. /api/agent/reply 入口 hook, 跟 broker-action-queue R4 同 5s 窗.
    // 不 channel-scoped (channel msgs 真**真**真**真 dedup, channel 可 legitimate replay).
    if (!channel) {
      const dedup = _checkInboundDedup(peer, message);
      if (dedup.dup) {
        console.warn(`[api/agent/reply] R34 recent_duplicate ${peer.slice(-12)} age=${dedup.age_ms}ms → skip`);
        return reply.send({ reply: null, skip_reason: 'recent_duplicate' });
      }
    }

    const resolved = resolveRelayNodeId(relayNodeId);

    // R6 (T-J1-18): broker = LLM Bot 上层 + protocol Service 下层. 双层架构.
    // 现:
    //   1. 先 broker-buy/sell-handler 看精确 #cmd:* / 命中协议格式 (LLM 触发 hint)
    //   2. handler null → fall to broker-llm-agent (LLM 销售客服 + role prompt + history)
    //   3. broker-llm-agent.handle 必返回 reply (含 fallback 友好 DM, 永不 silent)
    // 修 R5 T-J2-16 silent fallback (Owner 实证: 真人 DM "想买点 KAS" → silent → 没办法用)
    // Sub 12.x prediction agent dispatch (NWT R2 r78 hotfix — move OUT of broker block to top-level).
    // Bettor r100 final spec + r75/r76 refined: single relay 复用 prediction + broker, env-gated, chain truth canonical disambiguation.
    // 0 relays have is_dex_broker=1/is_service=1 in current DB → broker block 不 enters → original placement dead code (r78 catch).
    // Dispatch IF: "/" prefix (= explicit prediction command) OR pure digit + active prediction (chain truth OR mid-flow session).
    // null return → fall through to broker block (= broker-v3 / v2 / mind LLM in existing chain).
    if (!channel) {
      const _p1Flag = process.env.PREDICTION_AGENT_ENABLED === '1';
      const _p1Peers = (process.env.PREDICTION_AGENT_ENABLED_PEERS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (_p1Flag || _p1Peers.includes(peer)) {
        const _trimmed = (message || '').trim();
        let _p1Dispatch = _trimmed.startsWith('/');
        if (!_p1Dispatch && /^[1-9]\d*$/.test(_trimmed)) {
          const _activePred = sqlite.prepare(`
            SELECT id FROM exchange_offers
            WHERE (maker_kaspa_addr = ? OR taker = ?)
              AND (give_asset = 'prediction_outcome_share' OR want_asset = 'prediction_outcome_share')
              AND protocol_status IN ('open_awaiting_taker_stake','matched','verifying','collecting_sigs','pending_handshake','pending_taker','handshake_done')
            LIMIT 1
          `).get(peer, peer);
          const _activeSession = !_activePred ? sqlite.prepare(`
            SELECT 1 FROM prediction_dm_session
            WHERE sender_address = ?
              AND last_action IS NOT NULL
              AND last_action NOT IN ('STATE:IDLE','STATE:COMPLETED','STATE:CANCELLED')
              AND updated_at > datetime('now', '-1 hour')
            LIMIT 1
          `).get(peer) : null;
          _p1Dispatch = !!(_activePred || _activeSession);
        }
        if (_p1Dispatch) {
          try {
            const { handleDmMessage } = await import('../services/prediction-agent-mind.mjs');
            const p1Reply = await handleDmMessage(peer, message, { relayId: resolved });
            if (p1Reply !== null && p1Reply !== undefined) {
              console.log(`[api/agent/reply] prediction-v1 routed peer=${peer.slice(-12)} dispatch=${_trimmed.startsWith('/') ? 'cmd' : 'digit-active'} relay=${resolved?.slice(0,8)}`);
              return reply.send({ reply: p1Reply });
            }
            console.log(`[api/agent/reply] prediction-v1 dispatched but returned null, fall through`);
          } catch (err) {
            console.error(`[api/agent/reply] prediction-v1 err for ${peer?.slice(0,8)}: ${err.message} — fall through`);
          }
        }
      }
    }

    if (!channel) {
      const broker = sqlite.prepare('SELECT is_dex_broker, is_service FROM relay_nodes WHERE id = ?').get(resolved);
      if (broker?.is_service === 1 || broker?.is_dex_broker === 1) {
        // T-NWT-2026-04-27 EMERGENCY broker-broker runaway 真 fix (Owner 09:34+ 真测发现):
        // sibling broker peer 真**绝不**走 broker handler — 真避免 LLM 真 echo amplify cycle.
        // 真 trace: Trader-A 02:54:06 unprompted DM Trader-B → broker handler 真 process → cycle 30+ → 真烧 0.03 KAS gas.
        // exchange protocol DM (handshake/accept/paid etc) 真走 trade-protocol-filter 真不影响.
        const peerIsBroker = sqlite.prepare(
          'SELECT 1 FROM relay_nodes WHERE address=? AND (is_dex_broker=1 OR is_service=1) LIMIT 1'
        ).get(peer);
        if (peerIsBroker) {
          console.warn(`[api/agent/reply] sibling broker peer ${peer.slice(-12)} → skip broker handler (anti-runaway)`);
          return reply.send({ reply: null, skip_reason: 'sibling_broker' });
        }
        // T-J2-R19-extend (J1 1bc2132d 真测撞): broker reply 含 EVM 地址必经 R19 assert.
        // LLM 自由路径绕过 broker-action-queue, 这里 final guard. 含 fake 地址 → 拒回兜底.
        // T-J2-2026-04-27 v1.1 SELL flow R19 false positive fix (Owner 09:34 真测撞):
        // 真 user 真 SELL 真 supply EVM addr → broker LLM 真 echo → R19 false positive 拒.
        // 真 fix: 真 pass user message context, 真 whitelist user-supplied EVM addr (broker echo OK).
        const _r19Guard = async (replyText, source) => {
          if (!replyText) return replyText;
          try {
            // T-J2-2026-04-27 Bug-Z11 fix (replaces Bug-Z8 history widen, attack vector 真撞):
            // userContext 真**仅** current msg + active locked addrs from _pendingPreview/_pendingFields.
            // 真 attacker plant new addr in history 真**不再** widen R19 allow-set (R31 sediment lifecycle-bound).
            // 真 turn 1 user supplied addr 真在 current msg, 真 lock 后 turn 2+ broker echo 真**真**仅 echo locked addr.
            const lockedAddrs = [];
            try {
              const { _getPendingPreview } = await import('../services/broker-buy-handler.js');
              const pp = _getPendingPreview(peer);
              if (pp?.receive_address) lockedAddrs.push(pp.receive_address);
            } catch { /* module load 兜底 */ }
            try {
              const { _getPendingFieldsAddr } = await import('../services/broker-llm-agent.js');
              const a = _getPendingFieldsAddr(peer);
              if (a) lockedAddrs.push(a);
            } catch { /* module load 兜底 */ }
            // R33 b iter13 (J2 81f588ae propose long-term): _convoState.recv_address 也作 locked source.
            // 真**真**真 R31 attacker reject reply 含 locked addr (e.g. '订单地址已锁定 0x9405...') 真**真**真
            // R19 guard 误杀 (post-confirm _pendingPreview/_pendingFields cleared, 但 _convoState 真**真 keep recv_address).
            // 修后 R31 wording '订单地址已锁定 0x9405...' surfaced cleaner UX, R19 wrapper 真**真**真 误覆盖.
            try {
              const { getConvoState } = await import('../services/broker-state-authority.js');
              const cs = getConvoState(peer);
              if (cs?.recv_address) lockedAddrs.push(cs.recv_address);
              // Phase D P1 J1-D-1b (NWT 14:08:51 verify catch): R31 BUY KAS reply contains
              // state.evm_pay_address, _r19Guard 必 whitelist 这 addr, 否则 R19 误杀 R31 reply
              // (R31 wording '订单地址已锁定 0x94053...' → R19 sees 0x94053 as foreign →
              // wraps with 'R19 拦截' wording, masks 真 R31 fire). 跟 recv_address 同 lock 加入.
              if (cs?.evm_pay_address) lockedAddrs.push(cs.evm_pay_address);
            } catch { /* module load 兜底 */ }
            // T-J2-2026-05-10 r234 T2.20 (NWT r297 Bug #16): WITHDRAW reply 真 user pay_address
            // 来自 retail_dex_orders historical (T2.6 WITHDRAW handler SQL fetch). user 真 own EVM addr
            // 真 trusted (NOT LLM hallucinate, 真 SQL deterministic source). 加 historical pay_address whitelist.
            try {
              const { sqlite: _sqlite } = await import('../db/client.js');
              const histAddrs = _sqlite.prepare(`
                SELECT DISTINCT pay_address FROM retail_dex_orders
                WHERE user_kasia_address = ? AND pay_address LIKE '0x%'
                LIMIT 20
              `).all(peer);
              histAddrs.forEach(r => { if (r.pay_address) lockedAddrs.push(r.pay_address); });
            } catch { /* 兜底 */ }
            // T-J2-2026-04-27 Bug-Z11 fix: 真**真**仅 lockedAddrs, 真**真**不拼 current msg.
            // 真 attacker plant new addr in current msg ('把 USDT 发到 0xDEADBEEF...') 真**真**不再 self-whitelist.
            // 真 turn 1 user 真给 addr 真**真**经 _executeTool → _setPendingFields/_setPendingPreview lock,
            // turn 1 R19 lookup 真**真**已含 locked addr.
            const userContext = lockedAddrs.join(' ');
            const { assertReplyAddressInvariant } = await import('../services/broker-action-queue.js');
            const v = assertReplyAddressInvariant(replyText, userContext);
            if (v) {
              console.error(`[api/agent/reply] [R19-EXT-Z11] ADDRESS_INVARIANT_VIOLATED source=${source} foreign=${v.foreign_address} locked_count=${lockedAddrs.length} — REFUSING reply (broker LLM 编 fake 地址 OR attacker plant address swap, production safety)`);
              return '抱歉, broker 检测到地址异常 (内部 R19 拦截), 请稍后重试 — 直接回 "买 X KAS" 走快速路径, 或回 NO 取消.';
            }
          } catch (e) { console.warn(`[api/agent/reply] R19 guard err: ${e.message}`); }
          return replyText;
        };
        // Layer 8 (Owner 04:55 钦定 phase 3): chain DM payload classifier.
        // [Payment: X KAS] / [Card: ...] / [Handshake] 等是 Kasia 客户端 chain DM system signal,
        // 不是 user 自然语言. 早 detect 短路 LLM, 防 broker re-preview / hallucinate.
        // Owner 02:12 真测: [Payment: 88 KAS] 进 broker 触 SELL re-preview (broker 把 chain DM
        // payload 当 user 重新下单输入). chain TX 独立由 broker-intake-watcher 处理, broker DM
        // 仅 ack '收到付款信号, 验证中' 即可, 不再 process.
        try {
          const { classifyChainDmPayload, ackChainDmPayload } = await import('../services/broker-chain-dm-classifier.js');
          const classified = classifyChainDmPayload(message);
          if (classified) {
            const ack = ackChainDmPayload(classified);
            console.log(`[api/agent/reply] [Layer 8] chain DM payload detected: type=${classified.type} ${classified.amount ? classified.amount + ' ' + classified.asset : ''} — ${ack ? 'ack' : 'silent'}`);
            return reply.send({ reply: ack || '' });
          }
        } catch (err) {
          console.warn(`[api/agent/reply] chain DM classifier err: ${err.message}`);
        }

        // T-J2-2026-05-06 broker-v3 deterministic 路 A — BROKER_V3_ENABLED flag wire.
        // per v0.6 spec (NWT r217-r227 architect cross-hat) — 选择题 0 LLM, 真用户 entry, 数字驱动.
        // dispatch: BROKER_V3_ENABLED='1' OR peer ∈ BROKER_V3_ENABLED_PEERS → broker-v3.handleMessage
        //   - v3 return string reply → 路 A 命中, return immediately
        //   - v3 return null → 自然语言 (非数字非 0x), 路 B fallback (matcher 在 mind 但 SERVICE MUTE 拦
        //     Trader-B is_dex_broker=1, 实际 fall 进 broker-v2/v1 LLM agent stop-gap 应付)
        //   - v3 throw err → log + fall broker-v2 安全网
        // broker-v3 跟 broker-v2 共存, 默认 broker-v3 优先 (route 路 A 优先尝试).
        const _v3Flag = process.env.BROKER_V3_ENABLED === '1';
        const _v3Peers = (process.env.BROKER_V3_ENABLED_PEERS || '').split(',').map(s => s.trim()).filter(Boolean);
        if (_v3Flag || _v3Peers.includes(peer)) {
          try {
            const { handleMessage: handleV3 } = await import('../services/broker-v3/index.js');
            const v3Reply = await handleV3(peer, message, { relayNodeId: resolved });
            if (v3Reply !== null && v3Reply !== undefined) {
              console.log(`[api/agent/reply] broker-v3 routed peer=${peer.slice(-12)} (flag=${_v3Flag}, listed=${_v3Peers.includes(peer)})`);
              return reply.send({ reply: await _r19Guard(v3Reply, 'broker-v3.handleMessage') });
            }
            console.log(`[api/agent/reply] broker-v3 路 A 不命中 (自然语言), fall to broker-v2/v1 路 B`);
          } catch (err) {
            console.error(`[api/agent/reply] broker-v3 err for ${resolved?.slice(0,8)}: ${err.message} — fall to broker-v2/v1`);
          }
        }

        // T-NWT-2026-04-29 broker-v2 阶段 2 task 6/7 — BROKER_V2_ENABLED flag wire.
        // 三方共识 7e776598dc lock + J2 territory ship 6efc6311 ready.
        // 渐进 rollout:
        //   - BROKER_V2_ENABLED='1' → all peers 走 v2 (全量, post 1 周 gate 才 set)
        //   - BROKER_V2_ENABLED_PEERS='kaspa:abc,kaspa:def' → 仅列表 peer 走 v2 (1 user → 5 → 50 渐进)
        //   - 两 env 全 unset → 老 flow (default 安全)
        // v2 reply null/empty → 不 fallback 老 flow (v2 bug 直接暴, 不掩盖). _r19Guard 兜空 reply.
        const _v2Flag = process.env.BROKER_V2_ENABLED === '1';
        const _v2Peers = (process.env.BROKER_V2_ENABLED_PEERS || '').split(',').map(s => s.trim()).filter(Boolean);
        if (_v2Flag || _v2Peers.includes(peer)) {
          try {
            const { handleMessage } = await import('../services/broker-v2/router.js');
            const v2Reply = await handleMessage(peer, message);
            console.log(`[api/agent/reply] broker-v2 routed peer=${peer.slice(-12)} (flag=${_v2Flag}, listed=${_v2Peers.includes(peer)})`);
            return reply.send({ reply: await _r19Guard(v2Reply || '我刚走神了, 你想买还是卖 KAS?', 'broker-v2.handleMessage') });
          } catch (err) {
            console.error(`[api/agent/reply] broker-v2 err for ${resolved?.slice(0,8)}: ${err.message} (NOT falling back to v1, expose v2 bug)`);
            return reply.send({ reply: '我这边 broker-v2 出问题了, 麻烦你稍后再说一次. (Owner 已通知排查)' });
          }
        }

        try {
          const { handleBuyIntent } = await import('../services/broker-buy-handler.js');
          const buyReply = await handleBuyIntent(peer, message);
          if (buyReply !== null) return reply.send({ reply: await _r19Guard(buyReply, 'handleBuyIntent') });
        } catch (err) {
          console.warn(`[api/agent/reply] broker-buy-handler err for ${resolved?.slice(0,8)}: ${err.message}`);
        }
        try {
          const { handleSellIntent } = await import('../services/broker-sell-handler.js');
          const sellReply = await handleSellIntent(peer, message);
          if (sellReply !== null) return reply.send({ reply: await _r19Guard(sellReply, 'handleSellIntent') });
        } catch (err) {
          console.warn(`[api/agent/reply] broker-sell-handler err for ${resolved?.slice(0,8)}: ${err.message}`);
        }
        // R6: handler null (regex 不命中) → fall to broker-llm-agent 销售客服 LLM
        try {
          const { handleLlmDialog } = await import('../services/broker-llm-agent.js');
          const llmReply = await handleLlmDialog(peer, message);
          return reply.send({ reply: await _r19Guard(llmReply || '我刚走神了, 你想买还是卖 KAS?', 'handleLlmDialog') });
        } catch (err) {
          console.warn(`[api/agent/reply] broker-llm-agent err for ${resolved?.slice(0,8)}: ${err.message}`);
          return reply.send({ reply: '我这边卡了 1 分钟, 麻烦你再说一次?' });
        }
      }
    }

    const aiReply = await getReply(resolved, peer, message, channel);
    return reply.send({ reply: aiReply || '' });
  });

  // One-shot consult channel — UI "Ask Agent" buttons talk to the Agent's Brain
  // DIRECTLY, bypassing Mind's reactive pipeline (peer context, memory, skill
  // mega-dump). Purpose: a user one-off question should not get 94KB of noise
  // appended. System prompt is kept to the Agent's identity + caller-supplied
  // topic context; user prompt is the raw question.
  //
  // Body: { relayNodeId, topic: string, question: string, systemNote?: string }
  // Returns: { reply: string }
  fastify.post('/api/agent/consult', async (request, reply) => {
    const { relayNodeId, topic, question, systemNote } = request.body || {};
    if (!question || !question.trim()) return reply.code(400).send({ error: 'question required' });
    const resolved = resolveRelayNodeId(relayNodeId);
    if (!resolved) return reply.code(400).send({ error: 'relayNodeId required' });

    const relay = sqlite.prepare(`
      SELECT r.name as agent_name, r.address as agent_address, a.http_port as adapter_port
      FROM relay_nodes r
      LEFT JOIN adapter_nodes a ON a.id = r.adapter_node_id
      WHERE r.id = ?
    `).get(resolved);
    if (!relay?.adapter_port) return reply.code(400).send({ error: 'No adapter for this relay' });

    const agentName = relay.agent_name || 'Agent';
    const safeTopic = (topic || 'general').toString().slice(0, 40);
    const mindSystem = [
      `You are ${agentName}, a local AI Agent. The user (owner) is asking you a one-shot question on the topic: "${safeTopic}".`,
      `Answer the question directly using only the information they provide in the user message.`,
      `Do NOT assume prior context from other conversations. Do NOT reference skill data you do not have.`,
      `Keep the reply focused, concrete, and actionable. No greetings, no meta commentary.`,
      systemNote ? `\nAdditional guidance from caller:\n${systemNote}` : '',
    ].filter(Boolean).join('\n');

    try {
      const r = await fetch(`http://localhost:${relay.adapter_port}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peer: `owner:consult:${safeTopic}`,
          mindSystem, mindUser: question, mindTask: true,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) return reply.code(502).send({ error: `adapter returned ${r.status}` });
      const data = await r.json();
      return reply.send({ reply: data.reply || '' });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // Agent Mind skills query — returns active mind skills for a specific account
  fastify.get('/api/agent/mind-skills', async (request, reply) => {
    const { relay_node_id } = request.query;
    let skills;
    if (relay_node_id) {
      // Per-account: return skills owned by this account
      skills = sqlite.prepare(
        "SELECT name, display_name, description FROM skills WHERE action_type = 'mind' AND status = 'active' AND relay_node_id = ?"
      ).all(relay_node_id);
    } else {
      // Fallback: return all active mind skills (backward compat)
      skills = sqlite.prepare(
        "SELECT name, display_name, description FROM skills WHERE action_type = 'mind' AND status = 'active'"
      ).all();
    }
    return reply.send(skills);
  });

  // Chat history + peer profile for Mind context — returns recent conversation with a peer
  fastify.get('/api/agent/peer-context', async (request, reply) => {
    const { my_address, peer_address, limit: rawLimit } = request.query;
    if (!peer_address) return reply.code(400).send({ error: 'peer_address required' });
    const limit = Math.min(parseInt(rawLimit) || 20, 50);

    // 1. Peer identity (who are they?)
    const identity = sqlite.prepare(
      'SELECT address, display_name, card_entity_type, card_skills_json, card_summary, card_mode, trust_level, tags, notes FROM identities WHERE address = ?'
    ).get(peer_address);

    // 2. Recent chat history (messages + replies interleaved)
    //    Find conversation between my_address and peer_address
    let chatHistory = [];
    if (my_address) {
      const conv = sqlite.prepare(`
        SELECT c.id FROM conversations c
        JOIN identities li ON c.local_identity_id = li.id
        JOIN identities ri ON c.remote_identity_id = ri.id
        WHERE li.address = ? AND ri.address = ?
        ORDER BY c.updated_at DESC LIMIT 1
      `).get(my_address, peer_address);

      if (conv) {
        const messages = sqlite.prepare(`
          SELECT 'in' as dir, content_text as text, received_at as ts
          FROM messages WHERE conversation_id = ? AND content_text != ''
          ORDER BY received_at DESC LIMIT ?
        `).all(conv.id, limit);

        const replies = sqlite.prepare(`
          SELECT 'out' as dir, reply_text as text, created_at as ts
          FROM replies WHERE conversation_id = ? AND reply_text != ''
          ORDER BY created_at DESC LIMIT ?
        `).all(conv.id, limit);

        chatHistory = [...messages, ...replies]
          .sort((a, b) => new Date(a.ts) - new Date(b.ts))
          .slice(-limit);
      }
    }

    // 3. Broadcast history (if peer appeared in broadcast channels)
    const broadcasts = sqlite.prepare(`
      SELECT sender_address, content, created_at as ts
      FROM broadcast_messages
      WHERE sender_address = ? OR sender_address = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(peer_address, my_address || '', Math.min(limit, 10));

    // 4. Relation status from relation_states (唯一真相源)
    // v87 (NWT r185 架构钦定 γ): expose classification + last_stranger_reject_at for matcher stranger gate.
    let connectionStatus = null;
    let classification = null;
    let lastStrangerRejectAt = null;
    if (my_address) {
      const rs = sqlite.prepare(
        'SELECT status, classification, last_stranger_reject_at FROM relation_states WHERE local_address = ? AND peer_address = ?'
      ).get(my_address, peer_address);
      connectionStatus = rs?.status || null;
      classification = rs?.classification || null;
      lastStrangerRejectAt = rs?.last_stranger_reject_at || null;
    }

    return reply.send({
      peer: identity ? {
        address: identity.address,
        name: identity.display_name,
        entityType: identity.card_entity_type,
        skills: identity.card_skills_json ? JSON.parse(identity.card_skills_json) : null,
        summary: identity.card_summary,
        mode: identity.card_mode,
        trustLevel: identity.trust_level,
        tags: identity.tags,
        notes: identity.notes,
        connectionStatus,
        classification,
        lastStrangerRejectAt,
      } : { address: peer_address, connectionStatus, classification, lastStrangerRejectAt },
      chatHistory,
      recentBroadcasts: broadcasts.reverse(),
    });
  });

  // P0-1a (NWT r185 γ): mark stranger reject cooldown — matcher 真 detect stranger 真 first reply 后 record timestamp.
  // 30min cooldown 内同 peer 真 skip reply (matcher gatherContext 早 return 空 — 防 spam + 省 LLM).
  fastify.post('/api/agent/peer-relation/mark-stranger-cooldown', async (request, reply) => {
    const { my_address, peer_address } = request.body || {};
    if (!my_address || !peer_address) return reply.code(400).send({ error: 'my_address + peer_address required' });
    const now = new Date().toISOString();
    // UPSERT pattern: INSERT row if not exists, then UPDATE last_stranger_reject_at.
    // 防 race: relation-state.js:51 INSERT 只 in observeHandshake (chain ingest), 真 stranger 真未 handshake → row 不存在.
    const existing = sqlite.prepare(
      'SELECT id FROM relation_states WHERE local_address = ? AND peer_address = ?'
    ).get(my_address, peer_address);
    if (existing) {
      sqlite.prepare(
        'UPDATE relation_states SET last_stranger_reject_at = ?, updated_at = ? WHERE id = ?'
      ).run(now, now, existing.id);
    } else {
      const { randomUUID } = await import('node:crypto');
      sqlite.prepare(`
        INSERT INTO relation_states (id, local_address, peer_address, status, classification, last_stranger_reject_at, updated_at)
        VALUES (?, ?, ?, 'observed', 'seen_candidate', ?, ?)
      `).run(randomUUID(), my_address, peer_address, now, now);
    }
    return reply.send({ ok: true, peer: peer_address, marked_at: now });
  });

  // Agent Mind event reporting — public, no auth (local agent-mind process)
  fastify.post('/api/agent/mind-event', async (request, reply) => {
    const { agentName, eventType, summary, payload } = request.body || {};
    if (!eventType || !summary) return reply.code(400).send({ error: 'eventType and summary required' });

    const { insertEvent } = await import('../data/state/events.js');
    const eventId = await insertEvent({
      eventScope: 'mind',
      eventType,
      source: agentName || 'agent-mind',
      level: 'info',
      summary,
      payloadJson: payload || null,
    });
    return reply.send({ ok: true, eventId });
  });

  // Query recent Mind skill events
  fastify.get('/api/agent/mind-events', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit) || 20, 100);
    const rows = sqlite.prepare(`
      SELECT event_type, source, summary, payload_json, created_at
      FROM events WHERE event_scope = 'mind'
      ORDER BY created_at DESC LIMIT ?
    `).all(limit);
    return reply.send(rows);
  });

  // Agent skill invocation counter — called by Mind after gatherAll()
  fastify.post('/api/agent/skill-invoked', async (request, reply) => {
    const { names, relayNodeId } = request.body || {};
    if (!Array.isArray(names) || names.length === 0) return reply.send({ ok: true });
    const now = new Date().toISOString();
    const stmt = sqlite.prepare(
      `UPDATE skills SET invoke_count = invoke_count + 1, last_invoked_at = ? WHERE name = ? AND (relay_node_id = ? OR relay_node_id IS NULL) AND status = 'active'`
    );
    for (const name of names) {
      stmt.run(now, name, relayNodeId || null);
    }
    return reply.send({ ok: true, updated: names.length });
  });

  // Agent spending summary — breakdown of KAS costs
  fastify.get('/api/agent/spending', async (request, reply) => {
    const { relay_node_id, days = '1' } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });

    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relay_node_id);
    if (!relay) return reply.code(404).send({ error: 'Agent not found' });
    const addr = relay.address;
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    // Count activities — handshakes from relation_states, comms from chain_events (P1 migration 2026-04-06)
    const handshakes = sqlite.prepare(
      "SELECT COUNT(*) as c FROM relation_states WHERE local_address = ? AND handshake_accepted_at > ?"
    ).get(addr, since);
    const comms = sqlite.prepare(
      "SELECT COUNT(*) as c FROM chain_events WHERE from_address = ? AND event_type IN ('comm','comm_sent') AND observed_at > ?"
    ).get(addr, since);
    const bcasts = sqlite.prepare(
      "SELECT COUNT(*) as c FROM broadcast_messages WHERE sender_address = ? AND created_at > ?"
    ).get(addr, since);

    // Actual spending from chain: amount + fee for ALL outbound tx (messages + handshakes)
    const txRows = sqlite.prepare(`
      SELECT t.txid, t.amount, t.fee, t.created_at FROM (
        SELECT txid, amount, fee, created_at
        FROM tx_records
        WHERE direction = 'outbound' AND created_at > ?
          AND conversation_id IN (
            SELECT c.id FROM conversations c
            JOIN identities i ON c.local_identity_id = i.id WHERE i.address = ?
          )
        UNION ALL
        SELECT txid, amount, fee, created_at
        FROM tx_records
        WHERE direction = 'outbound' AND created_at > ?
          AND conversation_id IS NULL
          AND local_address = ?
      ) t ORDER BY t.created_at DESC LIMIT 100
    `).all(since, addr, since, addr);

    const totalSpent = txRows.reduce((s, t) => s + (parseFloat(t.amount) || 0) + (parseFloat(t.fee) || 0), 0);

    return reply.send({
      days: parseInt(days),
      breakdown: {
        handshakes: { count: handshakes?.c || 0 },
        messages: { count: comms?.c || 0 },
        broadcasts: { count: bcasts?.c || 0 },
      },
      total: totalSpent,
      txCount: txRows.length,
      recentTxs: txRows.slice(0, 20),
    });
  });

  // ── Ledger: spending from tx_records (花费真相源) ──
  // UNION ALL: 有 conversation 的（消息+转账）+ 无 conversation 的握手
  fastify.get('/api/agent/ledger', async (request, reply) => {
    const { relay_node_id } = request.query;
    const limit = Math.min(parseInt(request.query.limit) || 500, 5000);

    const agents = sqlite.prepare('SELECT id, name, address FROM relay_nodes WHERE address IS NOT NULL').all();
    const agentByAddr = {};
    agents.forEach(a => { agentByAddr[a.address] = a.name; });

    let convFilter = '';
    let hsFilter = '';
    const convParams = [];
    const hsParams = [];
    if (relay_node_id) {
      const relay = agents.find(a => a.id === relay_node_id);
      if (!relay) return reply.code(404).send({ error: 'Agent not found' });
      convFilter = `AND c.local_identity_id IN (SELECT id FROM identities WHERE address = ?)`;
      convParams.push(relay.address);
      hsFilter = `AND t.local_address = ?`;
      hsParams.push(relay.address);
    }

    const rows = sqlite.prepare(`
      SELECT txid, trace_id, amount, fee, created_at, type, agent_address, peer_address FROM (
        SELECT t.txid, t.trace_id, t.amount, t.fee, t.created_at,
               'conv' AS type,
               li.address AS agent_address,
               ri.address AS peer_address
        FROM tx_records t
        JOIN conversations c ON t.conversation_id = c.id
        JOIN identities li ON c.local_identity_id = li.id
        LEFT JOIN identities ri ON c.remote_identity_id = ri.id
        WHERE t.direction = 'outbound'
          AND (CAST(COALESCE(t.amount, '0') AS REAL) + CAST(COALESCE(t.fee, '0') AS REAL)) > 0
          ${convFilter}

        UNION ALL

        SELECT t.txid, t.trace_id, t.amount, t.fee, t.created_at,
               'handshake' AS type,
               t.local_address AS agent_address,
               ce.to_address AS peer_address
        FROM tx_records t
        LEFT JOIN chain_events ce ON ce.txid = t.txid AND ce.event_type = 'handshake'
        WHERE t.direction = 'outbound'
          AND t.conversation_id IS NULL
          AND (t.trace_id LIKE 'handshake:%' OR t.trace_id LIKE 'handshake-init:%' OR t.trace_id LIKE 'catchup:%')
          ${hsFilter}

        UNION ALL

        SELECT t.txid, t.trace_id, t.amount, t.fee, t.created_at,
               'other' AS type,
               t.local_address AS agent_address,
               NULL AS peer_address
        FROM tx_records t
        WHERE t.direction = 'outbound'
          AND t.conversation_id IS NULL
          AND t.trace_id NOT LIKE 'handshake:%'
          AND t.trace_id NOT LIKE 'handshake-init:%'
          AND t.trace_id NOT LIKE 'catchup:%'
          AND (CAST(COALESCE(t.amount, '0') AS REAL) + CAST(COALESCE(t.fee, '0') AS REAL)) > 0
          ${hsFilter}
      )
      ORDER BY created_at DESC
    `).all(...convParams, ...hsParams, ...hsParams);

    const result = rows.map(r => {
      const agentName = r.agent_address ? (agentByAddr[r.agent_address] || r.agent_address.slice(-12)) : null;
      const peerAddr = r.peer_address || null;
      const peerName = peerAddr ? (agentByAddr[peerAddr] || peerAddr.slice(-12)) : null;
      const amt = parseFloat(r.amount || '0');
      const fee = parseFloat(r.fee || '0');

      let type = 'message';
      if (r.type === 'handshake' || (r.trace_id || '').includes('handshake')) type = 'handshake';
      else if (r.type === 'other') {
        // 只有真·零金额 TX 才是广播（群聊/bcast），有金额一律算 transfer
        // 即使对方不在 identities 里 (conversation_id=NULL)
        type = amt === 0 ? 'broadcast' : 'transfer';
      }
      else if (amt >= 0.15 && amt <= 0.25) type = 'handshake';
      else if (amt > 0.25 && peerAddr && agentByAddr[peerAddr]) type = 'transfer';
      else if (amt > 0.25) type = 'utxo_split';

      return {
        date: r.created_at,
        agent: agentName,
        peer: type === 'handshake' && !peerName ? '(unknown)' : peerName,
        peerAddr,
        type,
        amount: amt,
        fee,
        total: amt + fee,
        txid: r.txid,
      };
    });

    const summary = {};
    result.forEach(r => {
      const name = r.agent || '(unlinked)';
      if (!summary[name]) summary[name] = { count: 0, amount: 0, fee: 0 };
      summary[name].count++;
      summary[name].amount += r.amount;
      summary[name].fee += r.fee;
    });

    return reply.send({ transactions: result, summary, total: result.length });
  });

  // Ledger page
  fastify.get('/ledger', async (request, reply) => {
    return reply.view('ledger.eta', {
      _page: 'ledger',
      pageTitle: 'Spending Ledger',
      agents: sqlite.prepare('SELECT id, name, address FROM relay_nodes WHERE address IS NOT NULL').all(),
    });
  });

  // Agent TX history — returns tx_records associated with a relay node
  fastify.get('/api/agent/tx-history', async (request, reply) => {
    const { relay_node_id } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    const limit = Math.min(parseInt(request.query.limit) || 20, 100);

    const rows = sqlite.prepare(`
      SELECT t.id, t.trace_id, t.conversation_id, t.direction, t.network,
             t.txid, t.amount, t.fee, t.confirmations, t.status,
             t.created_at, t.updated_at,
             m.content_text AS related_message
      FROM tx_records t
      LEFT JOIN messages m ON t.trace_id = m.trace_id
      WHERE t.conversation_id IN (
        SELECT c.id FROM conversations c
        JOIN identities i ON c.local_identity_id = i.id
        WHERE i.address = (SELECT address FROM relay_nodes WHERE id = ?)
      )
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(relay_node_id, limit);

    return reply.send(rows);
  });

  // Episode history — "对话故事线"聚合视图
  fastify.get('/api/history/episodes', async (request, reply) => {
    const { relay_node_id, status } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });

    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relay_node_id);
    if (!relay) return reply.code(404).send({ error: 'relay not found' });

    const limit = Math.min(parseInt(request.query.limit) || 30, 100);
    const episodes = buildEpisodes(relay.address, { limit, status: status || 'all' });
    return reply.send(episodes);
  });

  // Episode detail — lazy-load per tab (通讯录/会话/凭证)
  // Supports both trade episodes (order_id) and social episodes (peer_address)
  fastify.get('/api/history/episode-detail', async (request, reply) => {
    const { order_id, peer_address, relay_node_id } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    if (!order_id && !peer_address) return reply.code(400).send({ error: 'order_id or peer_address required' });

    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relay_node_id);
    if (!relay) return reply.code(404).send({ error: 'relay not found' });

    const detail = getEpisodeDetail(order_id || null, relay.address, peer_address || null);
    return reply.send(detail);
  });

  // Mind summary — structured episode data for Agent reflection + context
  fastify.get('/api/history/mind-summary', async (request, reply) => {
    const { relay_node_id, peer_address, days } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });

    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relay_node_id);
    if (!relay) return reply.code(404).send({ error: 'relay not found' });

    const summary = buildMindSummary(relay.address, {
      days: parseInt(days) || 7,
      peerAddress: peer_address || null,
    });
    return reply.send(summary);
  });

  // ── NEW PAGES: contacts / story / graph ──────────────────────────────

  // API: contacts with episode summary (merged view)
  //
  // 语义: 通讯录 = 已接受握手的对端 (accepted / confirmed / active / stale)
  //   observed  = 单向收到握手但我方未 accept → 属 pending 请求, 不是联系人
  //                用 ?include_observed=1 或走 /api/contacts/pending 获取
  //   blocked   = 主动拉黑 → 默认隐藏, 用 ?include_blocked=1 查看
  //
  // Bug 历史: 2026-04-23 修复. 之前 observed 也返回, 造成 "对端没经 accept 就成联系人".
  fastify.get('/api/contacts/list', async (request, reply) => {
    const { relay_node_id, include_observed, include_blocked } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });

    const relay = sqlite.prepare('SELECT address, name FROM relay_nodes WHERE id = ?').get(relay_node_id);
    if (!relay) return reply.code(404).send({ error: 'relay not found' });

    const allowedStatuses = ['accepted', 'confirmed', 'active', 'stale'];
    if (include_observed === '1' || include_observed === 'true') allowedStatuses.push('observed');
    if (include_blocked === '1' || include_blocked === 'true') allowedStatuses.push('blocked');
    const placeholders = allowedStatuses.map(() => '?').join(',');

    const relations = sqlite.prepare(`
      SELECT rs.peer_address, rs.status, rs.trust_level, rs.handshake_accepted_at, rs.updated_at,
        i.id as identity_id, i.display_name, i.card_entity_type, i.card_summary, i.tags, i.notes
      FROM relation_states rs
      LEFT JOIN identities i ON i.address = rs.peer_address
      WHERE rs.local_address = ?
        AND rs.status IN (${placeholders})
      ORDER BY rs.updated_at DESC
    `).all(relay.address, ...allowedStatuses);

    // Message counts per peer (from chain_events — from_address/to_address)
    const msgSent = sqlite.prepare(`
      SELECT to_address as peer, COUNT(*) as c FROM chain_events
      WHERE from_address = ? AND event_type IN ('comm','comm_sent') AND to_address IS NOT NULL
      GROUP BY to_address
    `).all(relay.address);
    const msgRecv = sqlite.prepare(`
      SELECT from_address as peer, COUNT(*) as c FROM chain_events
      WHERE to_address = ? AND event_type IN ('comm','comm_received') AND from_address IS NOT NULL
      GROUP BY from_address
    `).all(relay.address);
    const msgMap = {};
    for (const m of msgSent) { if (!msgMap[m.peer]) msgMap[m.peer] = {}; msgMap[m.peer].sent = m.c; }
    for (const m of msgRecv) { if (!msgMap[m.peer]) msgMap[m.peer] = {}; msgMap[m.peer].received = m.c; }

    // Get trade stats per peer
    const tradeStats = sqlite.prepare(`
      SELECT peer_address,
        COUNT(*) as trade_count,
        SUM(CASE WHEN status IN ('completed','resolved') THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status IN ('disputed','escalated') THEN 1 ELSE 0 END) as disputed,
        SUM(CASE WHEN status IN ('completed','resolved') THEN kas_amount ELSE 0 END) as total_volume,
        MAX(created_at) as last_trade_at
      FROM mm_orders
      WHERE agent_address = ? AND peer_address IS NOT NULL
      GROUP BY peer_address
    `).all(relay.address);

    const tradeMap = {};
    for (const t of tradeStats) tradeMap[t.peer_address] = t;

    const contacts = relations.map(r => {
      const trades = tradeMap[r.peer_address] || {};
      const msgs = msgMap[r.peer_address] || {};
      return {
        id: r.identity_id || null,
        address: r.peer_address,
        name: r.display_name || null,
        status: r.status,
        trustLevel: r.trust_level || 'normal',
        entityType: r.card_entity_type,
        summary: r.card_summary,
        tags: r.tags || '',
        notes: r.notes || '',
        msgsSent: msgs.sent || 0,
        msgsReceived: msgs.received || 0,
        connectedAt: r.handshake_accepted_at,
        tradeCount: trades.trade_count || 0,
        tradeCompleted: trades.completed || 0,
        tradeDisputed: trades.disputed || 0,
        tradeVolume: trades.total_volume || 0,
        lastTradeAt: trades.last_trade_at,
      };
    });

    return reply.send(contacts);
  });

  // --- Contacts management JSON APIs ---

  const TRUST_LEVELS = ['owner', 'recommended', 'normal', 'blocked'];

  // Update contact: display_name, tags, trust_level, notes, classification
  const CLASSIFICATIONS = ['seen_candidate', 'declared_candidate', 'responsive_agent', 'verified_agent', 'blocked_agent'];
  fastify.post('/api/contacts/update', async (request, reply) => {
    const { id, display_name, tags, trust_level, notes, classification } = request.body || {};
    if (!id) return reply.code(400).send({ ok: false, error: 'id required' });
    await updateIdentity(id, {
      displayName: display_name,
      notes,
      tags,
      trustLevel: TRUST_LEVELS.includes(trust_level) ? trust_level : undefined,
    });
    // Sync trust_level + classification to relation_states (唯一真相源)
    const identity = await getIdentityById(id);
    if (identity?.address) {
      if (TRUST_LEVELS.includes(trust_level)) {
        sqlite.prepare('UPDATE relation_states SET trust_level = ? WHERE peer_address = ?')
          .run(trust_level, identity.address);
      }
      if (CLASSIFICATIONS.includes(classification)) {
        sqlite.prepare('UPDATE relation_states SET classification = ? WHERE peer_address = ?')
          .run(classification, identity.address);
      }
    }
    return reply.send({ ok: true });
  });

  // Add contact manually
  fastify.post('/api/contacts/add', async (request, reply) => {
    const { address, display_name, trust_level, notes } = request.body || {};
    if (!address?.trim()) return reply.code(400).send({ ok: false, error: 'address required' });
    await upsertIdentity({
      network: 'mainnet',
      address: address.trim(),
      displayName: display_name?.trim() || null,
      identityType: 'remote',
    });
    const identity = await getIdentityByAddress('mainnet', address.trim());
    if (identity) {
      const updates = {};
      if (notes?.trim()) updates.notes = notes.trim();
      if (TRUST_LEVELS.includes(trust_level)) updates.trustLevel = trust_level;
      if (Object.keys(updates).length) await updateIdentity(identity.id, updates);
    }
    return reply.send({ ok: true, id: identity?.id });
  });

  // Toggle block/unblock
  fastify.post('/api/contacts/block', async (request, reply) => {
    const { id } = request.body || {};
    if (!id) return reply.code(400).send({ ok: false, error: 'id required' });
    const identity = await getIdentityById(id);
    if (!identity) return reply.code(404).send({ ok: false, error: 'not found' });
    const newLevel = identity.trust_level === 'blocked' ? 'normal' : 'blocked';
    await setTrustLevel(id, newLevel);
    // Sync to relation_states
    if (identity.address) {
      sqlite.prepare('UPDATE relation_states SET trust_level = ? WHERE peer_address = ?')
        .run(newLevel, identity.address);
    }
    return reply.send({ ok: true, trust_level: newLevel });
  });

  // Get all tags with counts
  fastify.get('/api/contacts/tags', async (request, reply) => {
    const all = await listIdentities();
    const tagCounts = {};
    all.forEach(i => {
      if (i.tags) i.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    });
    return reply.send(tagCounts);
  });

  // Delete a tag from all identities
  fastify.post('/api/contacts/tags/delete', async (request, reply) => {
    const { tag } = request.body || {};
    if (!tag?.trim()) return reply.code(400).send({ ok: false, error: 'tag required' });
    const target = tag.trim();
    const rows = sqlite.prepare("SELECT id, tags FROM identities WHERE tags LIKE ?").all(`%${target}%`);
    for (const row of rows) {
      const updated = row.tags.split(',').map(t => t.trim()).filter(t => t && t !== target).join(',');
      sqlite.prepare('UPDATE identities SET tags=? WHERE id=?').run(updated || null, row.id);
    }
    return reply.send({ ok: true });
  });

  // Rename a tag across all identities
  fastify.post('/api/contacts/tags/rename', async (request, reply) => {
    const { old_tag, new_tag } = request.body || {};
    if (!old_tag?.trim() || !new_tag?.trim()) return reply.code(400).send({ ok: false, error: 'old_tag and new_tag required' });
    const oldName = old_tag.trim();
    const newName = new_tag.trim().toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fff]/g, '');
    if (!newName || oldName === newName) return reply.send({ ok: false, error: 'no change' });
    const rows = sqlite.prepare("SELECT id, tags FROM identities WHERE tags LIKE ?").all(`%${oldName}%`);
    for (const row of rows) {
      const tags = row.tags.split(',').map(t => t.trim()).filter(Boolean);
      const updated = [...new Set(tags.map(t => t === oldName ? newName : t))].join(',');
      sqlite.prepare('UPDATE identities SET tags=? WHERE id=?').run(updated || null, row.id);
    }
    return reply.send({ ok: true });
  });

  // Page: /contacts
  fastify.get('/contacts', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const relayNodes = listRelayNodes();
    return reply.viewAsync('contacts', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', relayNodes, _page: 'contacts' });
  });

  // Page: /story
  fastify.get('/story', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const relayNodes = listRelayNodes();
    return reply.viewAsync('story', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', relayNodes, _page: 'story' });
  });

  // Page: /graph
  fastify.get('/graph', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const relayNodes = listRelayNodes();
    return reply.viewAsync('graph', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', relayNodes, _page: 'graph' });
  });

  // Page: /agent/status — standalone health monitor
  fastify.get('/agent/status', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const relayNodes = listRelayNodes();
    return reply.viewAsync('agent-status', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', langs: LANG_NAMES, relayNodes, _page: 'agent-status' });
  });

  // Page: /agent/history — standalone episode history
  fastify.get('/agent/history', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const relayNodes = listRelayNodes();
    return reply.viewAsync('agent-history', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', langs: LANG_NAMES, relayNodes, _page: 'agent-history' });
  });

  // Legacy dashboard (keep for backward compat)
  fastify.get('/dashboard', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const stats = await getDashboardStats();
    const eventStats = await getEventStats();
    const recentEvents = await listEvents({ limit: 10 });
    return reply.view('dashboard', { stats, eventStats, recentEvents, fmtDate, relativeTime, title: 'Dashboard', t, lang, dir, langs });
  });

  // Find conversation by peer address (for Market → Chat jump)
  // Optional `local` param = our agent's address, to find the right perspective
  fastify.get('/api/conversations/find', async (request, reply) => {
    const { peer, local } = request.query;
    if (!peer) return reply.code(400).send({ error: 'peer address required' });

    let conv;
    if (local) {
      // Find conversation where OUR agent is local and peer is remote
      conv = sqlite.prepare(`
        SELECT c.id FROM conversations c
        JOIN identities li ON c.local_identity_id = li.id
        JOIN identities ri ON c.remote_identity_id = ri.id
        WHERE li.address = ? AND ri.address = ?
        ORDER BY c.updated_at DESC LIMIT 1
      `).get(local, peer);
    }

    // Fallback: any conversation where peer is remote
    if (!conv) {
      conv = sqlite.prepare(`
        SELECT c.id FROM conversations c
        JOIN identities ri ON c.remote_identity_id = ri.id
        WHERE ri.address = ?
        ORDER BY c.updated_at DESC LIMIT 1
      `).get(peer);
    }

    return reply.send({ convId: conv?.id || null, peer });
  });

  // Conversation list
  fastify.get('/conversations', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const { search = '', page = '1', account = '' } = request.query;
    const limit = 20;
    const offset = (parseInt(page) - 1) * limit;
    const relayNodes = listRelayNodes();
    // Get selected account's address for filtering
    let localAddress = null;
    if (account) {
      const node = relayNodes.find(r => r.id === account);
      if (node) localAddress = node.address;
    }
    const conversations = await listConversations({ limit, offset, search, localAddress });
    return reply.view('conversations', { conversations, relayNodes, selectedAccount: account, search, page: parseInt(page), fmtDate, relativeTime, title: 'Conversations', t, lang, dir, langs });
  });

  // Conversation detail
  fastify.get('/conversations/:id', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const conv = await getConversation(request.params.id);
    if (!conv) return reply.code(404).send('Not found');

    const messages = await getMessagesByConversation(conv.id);
    const replies = await getRepliesByConversation(conv.id);
    const txs = await getTxsByConversation(conv.id);

    // Build timeline: merge messages + replies + txs sorted by created_at
    const timeline = [
      ...messages.map(m => ({ ...m, _type: 'message' })),
      ...replies.map(r => ({ ...r, _type: 'reply' })),
      ...txs.map(tx => ({ ...tx, _type: 'tx' })),
    ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const adapterUrl = process.env.ADAPTER_URL || 'http://localhost:3000';

    return reply.view('conversation', { conv, timeline, adapterUrl, fmtDate, relativeTime, title: `Conversation`, t, lang, dir, langs });
  });

  // Manual reply API — also through Mind (identity + skills)
  // Stores both user message and AI reply in DB so timeline shows them.
  fastify.post('/conversations/:id/reply', async (request, reply) => {
    const { message, relayNodeId } = request.body;
    const conv = await getConversation(request.params.id);
    if (!conv) return reply.code(404).send({ error: 'Not found' });
    if (!message?.trim()) return reply.code(400).send({ error: 'Message required' });

    const resolved = resolveRelayNodeId(relayNodeId);
    const now = new Date().toISOString();

    // Store the owner's message in messages table
    const { insertMessage } = await import('../data/state/messages.js');
    const { insertReply } = await import('../data/state/replies.js');
    const { updateConversationTimestamps } = await import('../data/state/conversations.js');
    const { randomUUID } = await import('crypto');

    const ownerMsgId = await insertMessage({
      traceId: `manual-${randomUUID()}`,
      conversationId: conv.id,
      direction: 'outbound',
      senderIdentityId: conv.local_identity_id,
      receiverIdentityId: conv.remote_identity_id,
      messageType: 'text',
      contentText: message.trim(),
      receivedAt: now,
    });

    // Get AI reply through Mind
    const aiReply = await getReply(resolved, conv.remote_address, message.trim());

    // Store AI reply in replies table
    if (aiReply) {
      await insertReply({
        traceId: `manual-reply-${randomUUID()}`,
        conversationId: conv.id,
        messageId: ownerMsgId,
        replyType: 'ai',
        provider: 'mind',
        replyText: aiReply,
        status: 'sent',
      });
    }

    await updateConversationTimestamps(conv.id, { lastMessageAt: now, lastReplyAt: now });

    if (!aiReply) return reply.code(502).send({ error: 'Mind unavailable' });
    return reply.send({ ok: true, reply: aiReply });
  });
}
