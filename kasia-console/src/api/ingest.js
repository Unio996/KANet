import { verifyIngestRequest } from '../services/ingest-auth.js';
import { handleIngestMessage, handleIngestReply, handleIngestTx, handleIngestEvent } from '../services/ingest-service.js';
import { getPendingHandshakes, getUnrepliedMessages } from '../services/catchup-service.js';

export async function registerIngestRoutes(fastify) {
  // All ingest routes require PSK auth
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/ingest/')) {
      await verifyIngestRequest(request, reply);
    }
  });

  fastify.post('/ingest/message', async (request, reply) => {
    const result = await handleIngestMessage(request.body);
    return reply.code(201).send({ ok: true, ...result });
  });

  fastify.post('/ingest/reply', async (request, reply) => {
    const result = await handleIngestReply(request.body);
    return reply.code(201).send({ ok: true, ...result });
  });

  fastify.post('/ingest/tx', async (request, reply) => {
    const result = await handleIngestTx(request.body);
    return reply.code(201).send({ ok: true, ...result });
  });

  fastify.post('/ingest/event', async (request, reply) => {
    const result = await handleIngestEvent(request.body);
    return reply.code(201).send({ ok: true, ...result });
  });

  // ── POST /ingest/submit-intent — (c) F2 两阶段回执 (J2 2026-09-13, 设计 v0.3 F2/F2-R) ──
  //   relay 在【广播之前】POST phase='prepared'{txid, txJson=已签名交易字节}, 拿到 2xx 才 submitTransaction(fail-closed:
  //   console 不可达 ⇒ 不广播); 广播后 POST phase='submitted'{txid}。console 侧 lib/submit-intent.mjs 单调落表(不会把
  //   submitted 退回 prepared)。未知 intent_key ⇒ 409(relay 只对 console 先 INSERT 的意图回执)。
  fastify.post('/ingest/submit-intent', async (request, reply) => {
    const { intentKey, phase, txid, txJson = null } = request.body || {};
    if (!intentKey || !phase || !txid) return reply.code(400).send({ ok: false, error: 'intentKey, phase, txid required' });
    const { recordIntentPhase } = await import('../lib/submit-intent.mjs');
    const r = recordIntentPhase({ intentKey, phase, txid, txJson });
    if (!r.ok) return reply.code(409).send({ ok: false, error: r.error });
    return reply.code(201).send({ ok: true, status: r.intent.status });
  });

  // ── POST /ingest/proto-bet-intent-phase — covenant_broadcast 两阶段回执 (J2 2026-09-14, 设计
  //    docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md §9.5, ledger 1366, Bettor 四条硬条件)。
  //
  //   relay 在【广播之前】POST phase='prepared'{txid, txJson=已签名交易字节}, 拿到 2xx 才 submitTransaction
  //   (fail-closed: console 不可达 ⇒ 不广播); 广播后 POST phase='submitted'{txid}。
  //
  //   与 /ingest/submit-intent(TRANSFER 专属, 写 submit_intents 表)不共用一张表——proto_bet_intents
  //   是独立表(proto-bet-intent.mjs 文件头原话"不复用 submit_intents 表")。🔴 D-020(账本1446/1448):
  //   原来这里还提到"多一个 depends_on 链式依赖字段"(两步设计的产物)——步骤A已取消, depends_on 列
  //   已随 v208 迁移删除, 现在是单步, 无链式依赖。
  //
  //   🔴 relay 身份限定(硬条件①): body 必须带 relay_id, 且必须等于 process.env.PROTO_RELAY_ID——
  //   不等(含 PROTO_RELAY_ID 未配置的情况, fail-closed 方向: 未配置 = 无人被授权, 不是全部放行)
  //   ⇒ 403 + LOUD 日志。生产 relay 即使拿到了 ingest 共享密钥(PSK, 上面 preHandler 已经过了那一关),
  //   也永远打不进这张表——PSK 只证明"这是一个合法 relay 进程", relay_id 匹配才证明"是那一个被
  //   授权碰这套原型资金逻辑的 relay"，两层鉴权职责不同, 不能互相替代。
  //
  //   幂等+单调(硬条件②): 直接复用既有 recordBetIntentPhase + markBetIntent 的 RANK 单调机制,
  //   不新写幂等逻辑——重复调用同一 phase、或试图倒退到更早 phase, 都是 no-op(不报错)。
  //
  //   未知 intentKey(console 还没 ensureBetIntent 建过这一行) ⇒ 409, 同 /ingest/submit-intent
  //   现有的"relay 只对 console 先 INSERT 的意图回执"契约一致, 不新造语义。
  fastify.post('/ingest/proto-bet-intent-phase', async (request, reply) => {
    const { relay_id, intentKey, phase, txid, txJson = null } = request.body || {};
    const PROTO_RELAY_ID = process.env.PROTO_RELAY_ID;
    if (!PROTO_RELAY_ID || relay_id !== PROTO_RELAY_ID) {
      console.error(`[ingest] proto-bet-intent-phase DENIED: relay_id=${relay_id || '(missing)'} != PROTO_RELAY_ID(${PROTO_RELAY_ID ? 'configured' : 'NOT SET'}) — intentKey=${intentKey || '(missing)'}`);
      return reply.code(403).send({ ok: false, error: 'relay_id mismatch: only PROTO_RELAY_ID may call this endpoint' });
    }
    if (!intentKey || !phase || !txid) return reply.code(400).send({ ok: false, error: 'intentKey, phase, txid required' });
    // 🔴 market_genesis 分派(账本1425硬条件①): market_genesis 不进 proto_bet_intents(FK 是
    // bet_id, 市场创世没有 bet 行)——covenant_broadcast 命令本身与 kind 无关, 同一个端点靠
    // intent_key 前缀区分该回执落进哪张表/哪个状态机模块, 不是新开一个端点。'genesis:' 前缀
    // 见 marketIntentKeyFor(proto-market-intent.mjs); 其余(如 'proto-bet:') 走既有
    // recordBetIntentPhase(proto-bet-intent.mjs)。
    if (intentKey.startsWith('genesis:')) {
      const { recordMarketIntentPhase } = await import('../lib/proto-market-intent.mjs');
      const r = recordMarketIntentPhase({ intentKey, phase, txid, txJson });
      if (!r.ok) return reply.code(409).send({ ok: false, error: r.error });
      return reply.code(201).send({ ok: true, status: r.market.status });
    }
    // 🔴 结算六步分派(账本1491, Owner D-022批准, Bettor裁定⑤): market_seal/close_commit/
    // convert_to_claim/claim_draw/withdraw/输家ticket自我回收——同上一条 'genesis:' 分支同一模式
    // (relay侧仍是同一个covenant_broadcast命令, 不新增命令), 落进独立的 proto_settlement_intents
    // 表(见 proto-settlement-intent.mjs), 不是 proto_bet_intents(FK 是 bet_id, 语义不匹配)。
    // 'settle:' 前缀见 settlementIntentKeyFor(proto-settlement-intent.mjs)。
    if (intentKey.startsWith('settle:')) {
      const { recordSettlementIntentPhase } = await import('../lib/proto-settlement-intent.mjs');
      const r = recordSettlementIntentPhase({ intentKey, phase, txid, txJson });
      if (!r.ok) return reply.code(409).send({ ok: false, error: r.error });
      return reply.code(201).send({ ok: true, status: r.intent.status });
    }
    const { recordBetIntentPhase } = await import('../lib/proto-bet-intent.mjs');
    const r = recordBetIntentPhase({ intentKey, phase, txid, txJson });
    if (!r.ok) return reply.code(409).send({ ok: false, error: r.error });
    return reply.code(201).send({ ok: true, status: r.intent.status });
  });

  // ── POST /ingest/kaspa-tx — Relay reports an observed Kaspa TX ──
  //
  // Relay pre-filters blocks against watched-addresses set and only posts matches.
  // Console writes to kaspa_tx_log for later verification queries. Idempotent.
  //
  // Body: { txId, blockHash, blockTime, fromAddress, toAddress, amount, outputs, network }
  fastify.post('/ingest/kaspa-tx', async (request, reply) => {
    const { txId, blockHash, blockTime, fromAddress, toAddress, amount, outputs, network } = request.body || {};
    if (!txId || !toAddress || amount === undefined) {
      return reply.code(400).send({ error: 'txId, toAddress, amount required' });
    }
    try {
      const { sqlite } = await import('../db/client.js');
      const now = new Date().toISOString();
      sqlite.prepare(`
        INSERT OR IGNORE INTO kaspa_tx_log
          (tx_id, block_hash, block_time, from_address, to_address, amount, outputs_json, observed_at, network)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        txId,
        blockHash || null,
        blockTime || null,
        fromAddress || null,
        toAddress,
        parseFloat(amount),
        outputs ? JSON.stringify(outputs) : null,
        now,
        network || 'mainnet',
      );
      return reply.code(201).send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /ingest/spc-daa-block — Relay reports a finality-safe SPC block ──
  // (docs/2026-07-08-backward-walk-daa-index-design.md §2.2, J1tn 2026-07-16 补落码)
  //
  // Relay only calls this once a block is SPC_INDEX_FINALITY_DEPTH deep (see rpc-listener.mjs) —
  // by the time Console sees it, the (daaScore, blockHash) binding is GHOSTDAG-final and cannot be
  // reorg'd out, so INSERT OR IGNORE is safe (NWT attack-surface review #o0056j MUST-FIX closed by
  // the finality gate living on the write side, not here).
  //
  // §2.5 覆盖区间维护: 判定新块是否与当前最新区间"相邻"——阈值(SPC_INDEX_ADJACENCY_PLACEHOLDER)是
  // 占位值(NWT note: 宁紧勿松, 明天用 backfill 实数据的相邻 daa_score 差值分布校准, 不是最终值)。
  //
  // Body: { daaScore, blockHash, timestampMs, network }
  const SPC_INDEX_ADJACENCY_PLACEHOLDER = 10; // TODO(J1tn, 明天): 用 spc_daa_index 实数据分布校准
  fastify.post('/ingest/spc-daa-block', async (request, reply) => {
    const { daaScore, blockHash, timestampMs } = request.body || {};
    if (!Number.isFinite(daaScore) || !blockHash) {
      return reply.code(400).send({ error: 'daaScore (number), blockHash required' });
    }
    try {
      const { sqlite } = await import('../db/client.js');
      sqlite.prepare(`
        INSERT OR IGNORE INTO spc_daa_index (daa_score, block_hash, timestamp_ms)
        VALUES (?, ?, ?)
      `).run(daaScore, blockHash, timestampMs || 0);

      const latest = sqlite.prepare(`
        SELECT id, start_daa, end_daa FROM spc_daa_index_coverage ORDER BY end_daa DESC LIMIT 1
      `).get();
      if (latest && (daaScore - latest.end_daa) >= 0 && (daaScore - latest.end_daa) <= SPC_INDEX_ADJACENCY_PLACEHOLDER) {
        sqlite.prepare(`UPDATE spc_daa_index_coverage SET end_daa = ? WHERE id = ?`).run(daaScore, latest.id);
      } else if (!latest || daaScore > latest.end_daa) {
        // 不相邻(relay 重启/console backoff 造成的洞)或首条区间——开新区间，旧区间原样保留(诚实标注洞)。
        sqlite.prepare(`
          INSERT INTO spc_daa_index_coverage (start_daa, end_daa) VALUES (?, ?)
        `).run(daaScore, daaScore);
      }
      // daaScore <= latest.end_daa（乱序到达）: 已在某区间内或早于当前覆盖起点, INSERT OR IGNORE 已处理数据本身, 覆盖区间不用动。

      return reply.code(201).send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /ingest/spc-tip-heartbeat — Relay reports its locally-observed tip daaScore ──
  // Console 完整性巡检据此判断 spc_daa_index 写入器是否停更(§2.2 note①, 9ez2u 同族根因防线)，
  // 不直连 kaspad RPC(Relay 唯一链上出口, docs/KANet-Positioning.md)。
  //
  // Body: { daaScore, network }
  fastify.post('/ingest/spc-tip-heartbeat', async (request, reply) => {
    const { daaScore } = request.body || {};
    if (!Number.isFinite(daaScore)) {
      return reply.code(400).send({ error: 'daaScore (number) required' });
    }
    try {
      const { sqlite } = await import('../db/client.js');
      sqlite.prepare(`
        INSERT INTO spc_tip_heartbeat (id, daa_score, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET daa_score = excluded.daa_score, updated_at = excluded.updated_at
      `).run(daaScore, new Date().toISOString());
      return reply.code(201).send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── GET /api/indexer/watched-addresses — Relay polls this to know what to index ──
  // (Note: this route is under /api, not /ingest, because it's a read not a write)
  //
  // Returns a flat array of Kaspa addresses that Relay should watch block outputs for.
  // Source: (1) local relay_nodes addresses, (2) exchange counterparties (makers/takers),
  // (3) identities observed recently.
  fastify.get('/api/indexer/watched-addresses', async (request, reply) => {
    const { sqlite } = await import('../db/client.js');
    const network = request.query?.network || 'mainnet';
    const addrs = new Set();

    // Local agents
    sqlite.prepare('SELECT address FROM relay_nodes WHERE address IS NOT NULL').all()
      .forEach(r => addrs.add(r.address));

    // Exchange counterparties (makers + takers from last 30 days)
    sqlite.prepare(`
      SELECT DISTINCT maker as addr FROM exchange_offers WHERE maker IS NOT NULL
      UNION SELECT DISTINCT taker as addr FROM exchange_offers WHERE taker IS NOT NULL
    `).all().forEach(r => addrs.add(r.addr));

    // Recent identities
    try {
      sqlite.prepare(`SELECT address FROM identities WHERE last_seen_at > datetime('now','-30 days')`).all()
        .forEach(r => addrs.add(r.address));
    } catch {}

    return reply.send({
      addresses: [...addrs].filter(Boolean),
      network,
      count: addrs.size,
    });
  });

  // Catch-up endpoints: relay queries these on startup to find work it missed
  fastify.get('/ingest/pending-handshakes', async (request, reply) => {
    const { claim } = request.query;

    // Optimistic lock: claim a specific pending action by id
    if (claim) {
      const { claimPendingAction } = await import('../services/catchup-service.js');
      const claimed = claimPendingAction(claim);
      return reply.send({ claimed });
    }

    // Atomic create + claim: write pending_action and lock it in one step
    // Used by realtime path (Relay) and Mind (action-executor) before spending KAS
    const { create_and_claim, local_address, target_address, trigger_txid,
            action_type: reqActionType, direction: reqDirection, source: reqSource } = request.query;
    if (create_and_claim && local_address && target_address) {
      const { claimPendingAction } = await import('../services/catchup-service.js');
      const { randomUUID } = await import('crypto');
      const { sqlite } = await import('../db/client.js');
      const now = new Date().toISOString();
      const id = randomUUID();
      const actionType = reqActionType || 'handshake_accept';
      const direction = reqDirection || 'inbound';
      const source = reqSource || 'relay';
      const key = `${actionType}:${local_address}:${target_address}`;

      // 2026-04-23 修复: 原 guard 用 handshake_observed_at 导致 inbound 握手首次也被拦,
      // accept 动作永远不触发. 改为 handshake_accepted_at 才是"我已接受过"的真实语义.
      if (actionType === 'handshake_accept' || actionType === 'handshake_init') {
        const already = sqlite.prepare(`
          SELECT 1 FROM relation_states
          WHERE local_address = ? AND peer_address = ?
            AND (handshake_accepted_at IS NOT NULL
              OR status IN ('accepted','confirmed','active'))
          LIMIT 1
        `).get(local_address, target_address);
        if (already) {
          console.log(`[ingest] reject ${actionType}: already active with ${target_address.slice(-12)}`);
          return reply.send({ claimed: false, reason: 'already_active' });
        }
      }

      // INSERT OR IGNORE — if already exists, this is a no-op
      sqlite.prepare(`
        INSERT OR IGNORE INTO pending_actions
          (id, action_type, direction, local_address, target_address, source, idempotent_key, status, trigger_txid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(id, actionType, direction, local_address, target_address, source, key, trigger_txid || null, now, now);

      // Claim — works whether we just inserted or record already existed
      const existing = sqlite.prepare(
        `SELECT id FROM pending_actions WHERE idempotent_key = ? AND status = 'pending'`
      ).get(key);
      const claimed = existing ? claimPendingAction(existing.id) : false;

      return reply.send({ claimed, actionId: existing?.id || id });
    }

    // Normal: return pending actions list
    const network = request.query.network || 'mainnet';
    const localAddress = request.query.address || null;
    const results = getPendingHandshakes(network, localAddress);
    return reply.send({ handshakes: results });
  });

  fastify.get('/ingest/unreplied-messages', async (request, reply) => {
    const network = request.query.network || 'mainnet';
    const limit = parseInt(request.query.limit) || 50;
    const results = getUnrepliedMessages(network, limit);
    return reply.send({ messages: results });
  });

}
