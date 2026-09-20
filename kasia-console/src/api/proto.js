// proto.js — 原型 v0 代币/市场 API 端点(J2, 设计 docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md v0.1)。
// 路由/字段对照 KANet-UI 已推前端(df9ffab9/52a35de0, kasia-console/src/ui/{tokens,proto-market}-*.eta)
// 直接互发对齐(J2/KANet-UI 2026-09-14)——本文件路由/字段名以前端已测过的实际调用为准, 不要求前端改。
//
// 范围稿 §3 硬边界: 本文件不得新增读取/导出私钥、调用 startRelay()、碰 ADMIN_SECRET_* 相关路由,
// 不复用/暴露 /relays/* /api/relay/* 系列私钥端点。所有链上操作走 §6/§9 定案后的 covenant_broadcast
// 命令(专属 proto relay,§6 (B′)),不经过 relay 热钱包持仓管理那一套。
//
// 🔴 当前状态(骨架阶段, ledger 1347+): §6 KAS 资金来源(B′/(B)/(C))与 §9 新 relay 命令 covenant_broadcast
// 均未定案(与 Owner 决策同批)。凡涉及"构造+签名+广播链上交易"的端点(市场创建/下注/结算/claim),
// 请求校验与 DB 读取部分是真实可用的, 但最终广播那一步走 `buildAndBroadcast()` 占位函数——它**总是
// 抛错**, 不假装能跑(NO-TX-NO-STATE: 没有真实广播就绝不写任何"已创建/已下注"的 DB 状态)。§6/§9 定案后
// 只需要把 `buildAndBroadcast` 换成真实实现, 端点其余部分(校验/查询/响应形状)不需要跟着改。
//
// bettor_pk(押注方身份): v0 单操作员模型下前端从不收集/传递这个值(下注/claim 请求体里都没有它)。
// 🔴 Bettor 裁定(ledger 1354): **不为每笔下注新造一把 bettor keypair**——v0 复用该市场 §5 那把
// 操作员委员会 keypair 兼任 bettor 身份(同一市场内一把即可), 私钥走 crypto.js 既有 encrypt/decrypt
// (CONSOLE_ENCRYPTION_KEY), 落 proto_markets.committee_privkey_enc 这同一份加密存储, 不落明文、不进
// relay_nodes、不被 relay-hotwallet-monitor 扫到。claim 端点相应地不接收 bettor_pk 参数, 自动在该
// 市场里找"状态匹配可以 claim 的那一笔"——**候选必须恰好 1 条才动手, 0 条或 >1 条一律 fail-loud
// 返回明确错误, 不允许任意挑一条**(v0 假设一个市场里最多一个相关操作员走完整个流程——KANet-UI 已
// 确认这个假设, 见回执; 未来若要支持同市场多方各自 claim 需要加筛选参数, 到时候另开一版)。

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';
import { rejectRelayIdInBody } from '../lib/proto-relay-guard.mjs';
import { rejectExternalMarketIdentityInBody, logProtoSingleOperatorMode } from '../lib/proto-single-operator-guard.mjs';

const nowIso = () => new Date().toISOString();

/**
 * 占位: §6/§9 定案前, 任何真实链上构造+广播都从这里抛出统一的"未实现"错误——调用方(下面的 handler)
 * 捕获后回 501, 不写任何 DB 状态。定案后把这个函数换成真实实现(调用 computeXxxArtifact 编译 + 走
 * covenant_broadcast 命令), 上层 handler 的调用点/参数形状已经按最终契约设计好, 不需要跟着改。
 * @param {string} kind 用于错误信息里标注具体是哪个动作卡住了(market_genesis/bet_mint/bet_append/
 *   market_resolve/claim_draw/claim_refund/withdraw), 方便调用方(前端)展示明确的"这块还没做"。
 */
async function buildAndBroadcast(kind, _params) {
  throw new Error(`buildAndBroadcast(${kind}): 未实现 —— 等 §6 KAS资金来源(B′/(B)/(C)) + §9 covenant_broadcast 命令定案(docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md §6/§9),与 Owner 决策同批。`);
}

// 🔴 MUST(KANet-UI 隔离联调发现·Bettor 1356 升级为 MUST): GET 端点原来用 `SELECT m.*` 把
// proto_markets.committee_privkey_enc(加密后的委员会/bettor 兼任 keypair, §5/1354)原样吐进无鉴权
// 响应体——密文不等于安全(密钥泄露/算法弱化/离线爆破分析都靠它), 这是"读端点把私钥列带出去"这一族的
// 模式问题, 不是这一处的孤立小事。所有 proto 读端点一律改显式列清单, 永不 SELECT *。
// PUBLIC_MARKET_COLS 是单一来源(两处 GET 共用, 避免各写一份将来漏改一处)——明确不含任何 *_enc /
// *privkey* / *mnemonic* 列; committee_pubkeys_json 是公开信息, 保留。
// 🔴 shardleaf_cov_id(账本1429/1431, D-020 bet 端点直接需要——buildRegisterAppendAndBroadcast 的
// 前置 fail-closed 核对靠它): 公开可推算值(genesis 交易 input[0] outpoint 决定的 covenant_id), 不是
// *_enc/*privkey*/*mnemonic* 类敏感列, 放进公开列清单不违反上面的 MUST。
const PUBLIC_MARKET_COLS = `
  m.id, m.token_def_id, m.question, m.deadline_ms, m.min_bet, m.seal_count,
  m.committee_pubkeys_json, m.rootclose_tmpl_hash, m.shardleaf_own_redeem_len,
  m.shardleaf_txid, m.shardleaf_vout, m.rootclose_txid, m.rootclose_vout, m.shardleaf_cov_id,
  m.status, m.winning_side, m.payout_root, m.created_at, m.updated_at
`;
// proto_token_defs 当前没有任何 *_enc/*privkey*/*mnemonic* 列, 但同一条 MUST 的字面要求是"所有 proto
// 读端点一律显式列清单, 永不 SELECT *"——不是"只在已知有敏感列时才写", 这样将来给这张表加了敏感列,
// 老代码也不会因为忘记回来改这个查询而悄悄泄露。
const PUBLIC_TOKEN_DEF_COLS = 'id, name, ticker, description, default_denomination, created_at';
// proto_bets/proto_claims 目前的全部列本身就都不敏感(bettor_pk 是公钥不是私钥；没有任何 *_enc 列)，
// 但同样按above的"永不 SELECT *"要求显式列出，不依赖"当前没有敏感列"这个会随 schema 演进而失效的前提。
const PUBLIC_BET_COLS = 'id, market_id, bettor_pk, side, stake, ticket_txid, ticket_vout, stake_tx_id, status, created_at, confirmed_at';
const PUBLIC_CLAIM_COLS = 'id, market_id, bettor_pk, side, amount, claim_txid, claim_vout, claimed_at, withdraw_txid, withdrawn_at, created_at';

function notImplemented(reply, kind, err) {
  return reply.code(501).send({
    ok: false,
    error: `${kind} 暂未实现`,
    detail: err.message,
    ref: 'docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md §6/§9',
  });
}

export async function registerProtoRoutes(fastify) {
  // 🔴 index.js 的 Fastify 实例是 `logger: false`(fastify.log.* 是 no-op)——用 console.log 直写
  // stdout, 不经过 fastify 的日志器, 否则这行 LOUD 日志会静默消失(同既有 index.js 启动日志惯例)。
  logProtoSingleOperatorMode(console.log);
  // 批 B B5: 启动 LOUD 打印判定题策略生效值(网络 / 零价值代币白名单 / adapter 开关)
  {
    const { resolveOraclePolicy, logOraclePolicy } = await import('../lib/proto-oracle-policy.mjs');
    let net = null; try { net = (await import('../../../shared/lib/kaspa-network.mjs')).configuredNetwork(); } catch { net = null; }
    logOraclePolicy(console, resolveOraclePolicy({ env: process.env, network: net }));
  }
  // ══════════════════════════════════════════════════════════════════════
  // 代币定义 —— 纯 DB, 不上链, 不产生任何可花费余额(Owner"代币属性配置需要界面互动"落这一层)。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/tokens/create', async (request, reply) => {
    const { name, ticker, faceValue, description } = request.body || {};
    if (!name?.trim()) return reply.code(400).send({ ok: false, error: 'name required' });
    if (!ticker?.trim()) return reply.code(400).send({ ok: false, error: 'ticker required' });
    const id = randomUUID();
    const ts = nowIso();
    sqlite.prepare(`
      INSERT INTO proto_token_defs (id, name, ticker, description, default_denomination, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), ticker.trim(), description || null, Number.isFinite(Number(faceValue)) ? Number(faceValue) : null, ts);
    return reply.send({ ok: true, id, name: name.trim(), ticker: ticker.trim(), created_at: ts });
  });

  fastify.get('/api/tokens', async (request, reply) => {
    const rows = sqlite.prepare(`SELECT ${PUBLIC_TOKEN_DEF_COLS} FROM proto_token_defs ORDER BY created_at DESC`).all();
    return reply.send({ ok: true, tokens: rows });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 建市场壳 —— ShardLeaf_direct genesis。校验/查询真实; 广播占位(§6/§9 未定案)。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto-markets/create', async (request, reply) => {
    const relayIdRejection = rejectRelayIdInBody(request.body);
    if (relayIdRejection) return reply.code(400).send({ ok: false, error: relayIdRejection });
    const externalIdentityRejection = rejectExternalMarketIdentityInBody(request.body);
    if (externalIdentityRejection) return reply.code(400).send({ ok: false, error: externalIdentityRejection });
    const { tokenId, title, deadline, resolutionNote, resolutionRuleSpec, outcomeEnd, outcomeConditionId } = request.body || {};
    if (!tokenId) return reply.code(400).send({ ok: false, error: 'tokenId required' });
    const tokenDef = sqlite.prepare(`SELECT ${PUBLIC_TOKEN_DEF_COLS} FROM proto_token_defs WHERE id = ?`).get(tokenId);
    if (!tokenDef) return reply.code(404).send({ ok: false, error: 'token definition not found' });
    if (!title?.trim()) return reply.code(400).send({ ok: false, error: 'title required' });
    // 前端 <input type="datetime-local"> 送来的是本地时间字符串(如 "2026-09-20T15:30")，服务端转 unix-ms。
    const deadlineMs = Date.parse(deadline);
    if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) {
      return reply.code(400).send({ ok: false, error: 'deadline must be a valid future datetime' });
    }
    // ── 批 B B6/C2 判定题创建入口: 三个新字段全可选——【全缺省 = 今天的旧流程(逐字节不变)】; 任一出现 ⇒ 全套判定题校验(半套 400) ──
    let judgedCols = null;
    {
      const { hasJudgedInput, findRelayKeyInBody, validateJudgedMarketInput } = await import('../lib/proto-oracle-spec.mjs');
      if (hasJudgedInput(request.body)) {
        const relayKey = findRelayKeyInBody(request.body);
        if (relayKey) return reply.code(400).send({ ok: false, error: `${relayKey} must not be provided in the request body — outcome_oracle_relay_ids is decided server-side` });
        // B5 三处强制谓词之①: 主网 + 非零价值白名单代币 ⇒ 拒建判定题(N5b); network 未配 ⇒ fail-closed
        const { judgedMarketAllowedHere } = await import('../lib/proto-oracle-policy.mjs');
        let net = null; try { net = (await import('../../../shared/lib/kaspa-network.mjs')).configuredNetwork(); } catch { net = null; }
        const allowed = judgedMarketAllowedHere({ network: net, tokenDefId: tokenId });
        if (!allowed.allowed) return reply.code(403).send({ ok: false, error: 'judged_market_not_allowed_here', detail: allowed.reason });
        let outcomeEndMs = outcomeEnd;
        if (typeof outcomeEnd === 'string' && outcomeEnd.trim()) { const p = Date.parse(outcomeEnd); outcomeEndMs = Number.isFinite(p) ? p : outcomeEnd; }
        const { resolveBudgetConfig } = await import('../lib/proto-settlement-budget.mjs');
        const { settlementIntervalMs } = await import('../services/proto-settlement-driver.mjs');
        const { oracleAdapterIntervalMs } = await import('../services/proto-oracle-adapter.mjs');
        const { UMA_FINALIZATION_WINDOW_MS } = await import('../services/bettor-prediction-voter.js');
        let budgetCfg;
        try { budgetCfg = resolveBudgetConfig(process.env, { tickMs: settlementIntervalMs(process.env) }).config; }
        catch (e) { return reply.code(503).send({ ok: false, error: 'budget_config_invalid', detail: e.message }); }
        const v = validateJudgedMarketInput({ title, deadlineMs, resolutionRuleSpec, outcomeEndMs, outcomeConditionId, budgetCfg, umaWindowMs: UMA_FINALIZATION_WINDOW_MS, adapterTickMs: oracleAdapterIntervalMs(process.env) });
        if (!v.ok) return reply.code(400).send({ ok: false, error: v.code, detail: v.error });
        judgedCols = v.normalized;
      }
    }
    const minBet = 1; // v0 不在创建表单上暴露，后端给个不挡门槛的默认值(设计稿 §2 最少字段清单)
    const sealCount = 2; // v0 固定(depth-1 payoutRoot merkle cap, 设计稿 §2.2/§5)，不接受调用方覆盖
    // 🔴 已知限制(如实记录, 不在本笔范围): resolutionNote 目前无处存(proto_markets 没有对应列),
    // 请求体接受这个字段但当前丢弃——不是本笔引入的新问题, 是既有占位代码就没接的字段。

    // §6/§9 已定案, 真实实现(账本1425/1438): 生成一次性委员会 keypair + 一次性 32 字节 hex marketId →
    // ensureMarketPending 写 genesis_pending 行(NO-TX-NO-STATE: 这一步不是"已广播", 只是必须先于任何
    // IPC 存在的记账行, 同 driveMarketGenesis 硬条件①) → 驱动关闭时 409 不发 IPC; 驱动开启时立即尝试
    // 推进一次(maxAttempts=1, 不阻塞太久), 剩余的重试/落链检测交给后台 proto-driver。
    const { randomBytes } = await import('node:crypto');
    const marketId = randomBytes(32).toString('hex');
    const { computeMarketGenesisArtifacts } = await import('../lib/proto-covenant-builder.mjs');
    let artifacts;
    try {
      artifacts = await computeMarketGenesisArtifacts({ marketId, minBet, deadlineMs });
    } catch (err) {
      return reply.code(500).send({ ok: false, error: `market genesis artifact computation failed: ${err.message}` });
    }
    const { ensureMarketPending, driveMarketGenesis, getMarketRow } = await import('../lib/proto-market-intent.mjs');
    const market = ensureMarketPending({
      id: marketId, token_def_id: tokenId, question: title.trim(), deadline_ms: deadlineMs, min_bet: minBet, seal_count: sealCount,
      committee_pubkeys_json: JSON.stringify([artifacts.committeePubkeyHex]), committee_privkey_enc: artifacts.committeePrivkeyEnvelope,
      rootclose_tmpl_hash: artifacts.rootCloseTmplHash, shardleaf_own_redeem_len: artifacts.shardLeafOwnRedeemLen,
      ...(judgedCols ? { resolution_rule_spec: judgedCols.resolution_rule_spec, outcome_market_source: judgedCols.outcome_market_source, outcome_condition_id: judgedCols.outcome_condition_id, outcome_oracle_relay_ids: judgedCols.outcome_oracle_relay_ids, outcome_end_ms: judgedCols.outcome_end_ms } : {}),
    });

    const { isProtoDriverEnabled } = await import('../services/proto-driver.mjs');
    if (!isProtoDriverEnabled()) {
      return reply.code(409).send({ ok: false, error: 'proto_driver_disabled', id: marketId, status: market.status });
    }

    // 🔴 M0a 门(账本1440/1441, considered amendment #8): 不 bare-import relay-manager——发命令一律
    // 走 lib/proto-relay-ipc.mjs 的 protoSendCmd(全仓唯一裸 import relay-manager 的受控出口)。
    const { buildMarketGenesisAndBroadcast, shardLeafTargetAddress } = await import('../lib/proto-broadcast-ops.mjs');
    const { PROTO_RELAY_ID, assertProtoRelayHealthy } = await import('../lib/proto-relay-guard.mjs');
    const { protoSendCmd } = await import('../lib/proto-relay-ipc.mjs');
    const kaspa = await import('kaspa-wasm');
    const network = process.env.KASPA_NETWORK || 'mainnet';
    try {
      const health = await assertProtoRelayHealthy();
      const targetAddress = shardLeafTargetAddress({ kaspa, network, market });
      await driveMarketGenesis({
        sendCmd: protoSendCmd, relayId: PROTO_RELAY_ID, marketId, targetAddress, maxAttempts: 1, origin: 'http',
        buildAndBroadcast: () => buildMarketGenesisAndBroadcast({ kaspa, network, market, sendCmd: protoSendCmd, relayId: PROTO_RELAY_ID, relayAddress: health.address }),
      });
    } catch (e) {
      // 立即尝试失败/HOLD 都不阻塞响应——这只是"最好情况下立即有进展"的优化, 后台驱动会继续重试/恢复。
    }
    const after = getMarketRow(marketId);
    return reply.code(202).send({ ok: true, id: marketId, status: after.status });
  });

  fastify.get('/api/proto-markets', async (request, reply) => {
    const { presentProtoMarket, JUDGED_PRESENTATION_COLS } = await import('../lib/proto-oracle-spec.mjs');
    const rows = sqlite.prepare(`
      SELECT ${PUBLIC_MARKET_COLS}, t.name AS token_name, t.ticker AS token_ticker, ${JUDGED_PRESENTATION_COLS}
      FROM proto_markets m JOIN proto_token_defs t ON t.id = m.token_def_id
      ORDER BY m.created_at DESC
    `).all();
    return reply.send({ ok: true, markets: rows.map(presentProtoMarket) });
  });

  fastify.get('/api/proto-markets/:id', async (request, reply) => {
    const { presentProtoMarket, JUDGED_PRESENTATION_COLS } = await import('../lib/proto-oracle-spec.mjs');
    const rawMarket = sqlite.prepare(`
      SELECT ${PUBLIC_MARKET_COLS}, t.name AS token_name, t.ticker AS token_ticker, ${JUDGED_PRESENTATION_COLS}
      FROM proto_markets m JOIN proto_token_defs t ON t.id = m.token_def_id
      WHERE m.id = ?
    `).get(request.params.id);
    if (!rawMarket) return reply.code(404).send({ ok: false, error: 'market not found' });
    const market = presentProtoMarket(rawMarket);    // 批 B C1: 判定题公开读带出 side_map / outcome_end / data_source; 非判定题响应与今天逐字节相同
    const bets = sqlite.prepare(`SELECT ${PUBLIC_BET_COLS} FROM proto_bets WHERE market_id = ? ORDER BY created_at ASC`).all(market.id);
    const claims = sqlite.prepare(`SELECT ${PUBLIC_CLAIM_COLS} FROM proto_claims WHERE market_id = ? ORDER BY created_at ASC`).all(market.id);
    return reply.send({ ok: true, market, bets, claims });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 下注 —— register_append 单笔交易(D-020, 账本1446/1448, 取消原两步设计里独立铸stake筹码的步骤A)。
  // proto_bet_intents 只有一个 step='append'。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto-markets/:id/bet', async (request, reply) => {
    const relayIdRejection = rejectRelayIdInBody(request.body);
    if (relayIdRejection) return reply.code(400).send({ ok: false, error: relayIdRejection });
    const externalIdentityRejection = rejectExternalMarketIdentityInBody(request.body);
    if (externalIdentityRejection) return reply.code(400).send({ ok: false, error: externalIdentityRejection });
    const market = sqlite.prepare(`SELECT ${PUBLIC_MARKET_COLS} FROM proto_markets m WHERE m.id = ?`).get(request.params.id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.status !== 'betting') return reply.code(409).send({ ok: false, error: `market status is ${market.status}, not accepting bets` });
    const { direction, amount } = request.body || {};
    if (direction !== 0 && direction !== 1) return reply.code(400).send({ ok: false, error: 'direction must be 0 (YES) or 1 (NO)' });
    const stakeAmount = Number(amount);
    if (!Number.isFinite(stakeAmount) || stakeAmount < market.min_bet) {
      return reply.code(400).send({ ok: false, error: `amount must be a number >= min_bet(${market.min_bet})` });
    }
    // 批 D §6 受理点 outcome_end 门(D6 + N3 + N4): 判定题市场在【受理时刻】pmt ≥ outcome_end_ms(结果已可知)⇒ 拒受理; 判定题受理时 pmt 无效 / 读不到 ⇒ 拒受理(fail-closed);
    //   判定题 ∧ outcome_end 空 ⇒ 拒受理。无判定题(operator 市场)豁免且【不读 pmt】。门在受理点, 不在驱动: 已受理的注的 append 不受影响(N4, 否则已受理未上链的注永上不了链 → 永不 seal → 只能退款)。
    //   所有拒绝发生在任何 DB 写 / IPC 之前(NO STATE 先于门)。
    {
      const { checkBetIntake } = await import('../lib/proto-bet-intake.mjs');
      const gate = await checkBetIntake({
        db: sqlite, marketId: market.id, betRequest: { direction, sideLabel: request.body?.side_label },
        readPmt: async () => {   // 只在判定题 ∧ outcome_end 有限时才被调用; 配置非法 / relay 不可达 ⇒ 抛 ⇒ 按 pmt 无效拒受理(fail-closed)
          const { resolveBudgetConfig, readValidatedPmt, sharedPmtValidator } = await import('../lib/proto-settlement-budget.mjs');
          const { settlementIntervalMs } = await import('../services/proto-settlement-driver.mjs');
          const cfg = resolveBudgetConfig(process.env, { tickMs: settlementIntervalMs(process.env) }).config;
          const { PROTO_RELAY_ID: relayId } = await import('../lib/proto-relay-guard.mjs');
          const { protoSendCmd } = await import('../lib/proto-relay-ipc.mjs');
          return readValidatedPmt({ sendCmd: protoSendCmd, relayId, validator: sharedPmtValidator(cfg.lagMaxMs) });
        },
      });
      if (!gate.accept) return reply.code(gate.http).send({ ok: false, error: gate.code, detail: gate.detail });
    }
    // §6/§9 已定案, 真实实现(账本1425/1438/1442/1446/1448 D-020): pending 行必须先于任何 IPC 存在
    // (同 market_genesis 硬条件①, ensureBetIntent 自己的文档要求)——proto_bets(status='pending')
    // + proto_bet_intents(step='append', status='pending') 两张表都在发命令之前落表。bettor_pk 不从
    // 请求体读——复用本市场委员会 pubkey 兼任(文件头注, Bettor 1354 裁定), 不为每笔下注新造。
    let committeePubkeys;
    try { committeePubkeys = JSON.parse(market.committee_pubkeys_json); } catch { committeePubkeys = []; }
    const bettorPk = committeePubkeys[0];
    if (!bettorPk) return reply.code(500).send({ ok: false, error: 'market has no committee pubkey recorded — cannot derive bettor_pk' });

    const betId = randomUUID();
    sqlite.prepare(`
      INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(betId, market.id, bettorPk, direction, stakeAmount, nowIso());

    const { ensureBetIntent, driveBetIntent } = await import('../lib/proto-bet-intent.mjs');
    ensureBetIntent({ betId, step: 'append' });

    const { isProtoDriverEnabled } = await import('../services/proto-driver.mjs');
    if (!isProtoDriverEnabled()) {
      return reply.code(409).send({ ok: false, error: 'proto_driver_disabled', id: betId, status: 'pending' });
    }

    const { buildRegisterAppendAndBroadcast, registerAppendTargetAddress } = await import('../lib/proto-broadcast-ops.mjs');
    const { PROTO_RELAY_ID, assertProtoRelayHealthy } = await import('../lib/proto-relay-guard.mjs');
    const { protoSendCmd } = await import('../lib/proto-relay-ipc.mjs');
    const kaspa = await import('kaspa-wasm');
    const network = process.env.KASPA_NETWORK || 'mainnet';
    const bet = sqlite.prepare(`SELECT ${PUBLIC_BET_COLS} FROM proto_bets WHERE id = ?`).get(betId);
    try {
      const health = await assertProtoRelayHealthy();
      const targetAddress = registerAppendTargetAddress({ kaspa, network, market, bet });
      await driveBetIntent({
        sendCmd: protoSendCmd, relayId: PROTO_RELAY_ID, betId, step: 'append', targetAddress, maxAttempts: 1, origin: 'http',
        buildAndBroadcast: () => buildRegisterAppendAndBroadcast({ kaspa, network, market, bet, sendCmd: protoSendCmd, relayId: PROTO_RELAY_ID, relayAddress: health.address }),
      });
    } catch (e) {
      // 立即尝试失败/HOLD 都不阻塞响应——这只是"最好情况下立即有进展"的优化, 后台驱动会继续重试/恢复。
    }
    const after = sqlite.prepare(`SELECT ${PUBLIC_BET_COLS} FROM proto_bets WHERE id = ?`).get(betId);
    return reply.code(202).send({ ok: true, id: betId, status: after.status });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 委员宣布结果 —— RootClose.close_commit(v0: §5 单 keypair 模拟 5 委员)。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto-markets/:id/resolve', async (request, reply) => {
    const relayIdRejection = rejectRelayIdInBody(request.body);
    if (relayIdRejection) return reply.code(400).send({ ok: false, error: relayIdRejection });
    const externalIdentityRejection = rejectExternalMarketIdentityInBody(request.body);
    if (externalIdentityRejection) return reply.code(400).send({ ok: false, error: externalIdentityRejection });
    const market = sqlite.prepare(`SELECT ${PUBLIC_MARKET_COLS} FROM proto_markets m WHERE m.id = ?`).get(request.params.id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.status !== 'sealed') return reply.code(409).send({ ok: false, error: `market status is ${market.status}, must be sealed before resolve` });
    const { outcome } = request.body || {};
    if (outcome !== 0 && outcome !== 1) return reply.code(400).send({ ok: false, error: 'outcome must be 0 (YES) or 1 (NO)' });
    try {
      await buildAndBroadcast('market_resolve', { market, winningSide: outcome });
    } catch (err) {
      return notImplemented(reply, 'market_resolve', err);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // Claim —— 前端只有一个按钮/一个 txId(无 bettor 筛选 UI), v0 单操作员模型: 自动找这个市场里状态匹配
  // 可以 claim 的那一笔(resolved ⇒ 赢的那一侧; cancelled ⇒ 任一笔可退款的)。RootClaim.claim_draw /
  // RefundClaim.refund_payout 落地新建 KanetTokenClaim, 响应 {ok, txId}(单值, 非 steps 数组，匹配前端)。
  // 🔴 Bettor 裁定(ledger 1354): 候选必须恰好 1 条才动手——0 条或 >1 条一律 fail-loud, 不允许任意挑
  // 一条(单操作员假设已由 KANet-UI 确认成立, 但假设不成立时必须显式报错, 不能悄悄按 created_at 排序
  // 挑第一个, 那样会在假设被打破的那一刻悄悄 claim 错人)。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto-markets/:id/claim', async (request, reply) => {
    const relayIdRejection = rejectRelayIdInBody(request.body);
    if (relayIdRejection) return reply.code(400).send({ ok: false, error: relayIdRejection });
    const externalIdentityRejection = rejectExternalMarketIdentityInBody(request.body);
    if (externalIdentityRejection) return reply.code(400).send({ ok: false, error: externalIdentityRejection });
    const market = sqlite.prepare(`SELECT ${PUBLIC_MARKET_COLS} FROM proto_markets m WHERE m.id = ?`).get(request.params.id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.status !== 'resolved' && market.status !== 'cancelled') {
      return reply.code(409).send({ ok: false, error: `market status is ${market.status}, must be resolved or cancelled before claim` });
    }
    const candidates = market.status === 'resolved'
      ? sqlite.prepare(`SELECT ${PUBLIC_BET_COLS} FROM proto_bets WHERE market_id = ? AND side = ? AND status = ?`).all(market.id, market.winning_side, 'confirmed')
      : sqlite.prepare(`SELECT ${PUBLIC_BET_COLS} FROM proto_bets WHERE market_id = ? AND status = ?`).all(market.id, 'confirmed');
    if (candidates.length === 0) return reply.code(404).send({ ok: false, error: 'no claimable confirmed bet found in this market' });
    if (candidates.length > 1) {
      return reply.code(409).send({ ok: false, error: `ambiguous: ${candidates.length} claimable bets found in this market — v0 single-operator assumption violated, refusing to auto-pick one (needs a bettor filter param, not built in v0)` });
    }
    const bet = candidates[0];
    const kind = market.status === 'resolved' ? 'claim_draw' : 'claim_refund';
    try {
      await buildAndBroadcast(kind, { market, bet });
    } catch (err) {
      return notImplemented(reply, kind, err);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // 从 claim covenant 提到自己名下 —— KanetTokenClaim.spend。前端目前没有单独的 UI 触发这一步(claim
  // 按钮的语义在 v0 里到"落地新建 KanetTokenClaim"为止即算完成, 见 §0 一句话目标"赢家能在界面上看到并
  // claim")——本端点先按设计稿留着, 不接前端, 需要 bettor 自己签名(§0 已知限制 T-PROTO-BETTORPK-BINDING
  // 适用: v0 单操作员场景接受)。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto-markets/:id/withdraw', async (request, reply) => {
    const relayIdRejection = rejectRelayIdInBody(request.body);
    if (relayIdRejection) return reply.code(400).send({ ok: false, error: relayIdRejection });
    const externalIdentityRejection = rejectExternalMarketIdentityInBody(request.body);
    if (externalIdentityRejection) return reply.code(400).send({ ok: false, error: externalIdentityRejection });
    const market = sqlite.prepare(`SELECT ${PUBLIC_MARKET_COLS} FROM proto_markets m WHERE m.id = ?`).get(request.params.id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    const claim = sqlite.prepare(`SELECT ${PUBLIC_CLAIM_COLS} FROM proto_claims WHERE market_id = ? AND withdrawn_at IS NULL ORDER BY created_at ASC LIMIT 1`).get(market.id);
    if (!claim) return reply.code(404).send({ ok: false, error: 'no un-withdrawn claim found in this market' });
    try {
      await buildAndBroadcast('withdraw', { market, claim });
    } catch (err) {
      return notImplemented(reply, 'withdraw', err);
    }
  });
}
