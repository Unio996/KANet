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

function notImplemented(reply, kind, err) {
  return reply.code(501).send({
    ok: false,
    error: `${kind} 暂未实现`,
    detail: err.message,
    ref: 'docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md §6/§9',
  });
}

export async function registerProtoRoutes(fastify) {
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
    const rows = sqlite.prepare('SELECT * FROM proto_token_defs ORDER BY created_at DESC').all();
    return reply.send({ ok: true, tokens: rows });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 建市场壳 —— ShardLeaf_direct genesis。校验/查询真实; 广播占位(§6/§9 未定案)。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto-markets/create', async (request, reply) => {
    const { tokenId, title, deadline, resolutionNote } = request.body || {};
    if (!tokenId) return reply.code(400).send({ ok: false, error: 'tokenId required' });
    const tokenDef = sqlite.prepare('SELECT * FROM proto_token_defs WHERE id = ?').get(tokenId);
    if (!tokenDef) return reply.code(404).send({ ok: false, error: 'token definition not found' });
    if (!title?.trim()) return reply.code(400).send({ ok: false, error: 'title required' });
    // 前端 <input type="datetime-local"> 送来的是本地时间字符串(如 "2026-09-20T15:30")，服务端转 unix-ms。
    const deadlineMs = Date.parse(deadline);
    if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) {
      return reply.code(400).send({ ok: false, error: 'deadline must be a valid future datetime' });
    }
    const minBet = 1; // v0 不在创建表单上暴露，后端给个不挡门槛的默认值(设计稿 §2 最少字段清单)
    const sealCount = 2; // v0 固定(depth-1 payoutRoot merkle cap, 设计稿 §2.2/§5)，不接受调用方覆盖

    // NO-TX-NO-STATE: 广播占位阶段, 不写任何 proto_markets 行。定案后这里换成:
    //   ① 生成一次性委员会 keypair(§5, 5 槽同一把 pubkey) → crypto.encrypt 存 committee_privkey_enc
    //   ② 编译一份携带真实 committee_hash/deadline_ms/token_tmpl_hash 的 RootClose 模板 → rootclose_tmpl_hash
    //   ③ compileSilV100(ShardLeaf_direct.sil) genesis 输出 + buildAndBroadcast('market_genesis', ...)
    //   ④ 广播成功后才 INSERT proto_markets(shardleaf_txid/vout 已知, question=title, resolutionNote 存 metadata)
    try {
      await buildAndBroadcast('market_genesis', { tokenDef, deadlineMs, minBet, sealCount, title, resolutionNote });
    } catch (err) {
      return notImplemented(reply, 'market_genesis', err);
    }
  });

  fastify.get('/api/proto-markets', async (request, reply) => {
    const rows = sqlite.prepare(`
      SELECT m.*, t.name AS token_name, t.ticker AS token_ticker
      FROM proto_markets m JOIN proto_token_defs t ON t.id = m.token_def_id
      ORDER BY m.created_at DESC
    `).all();
    return reply.send({ ok: true, markets: rows });
  });

  fastify.get('/api/proto-markets/:id', async (request, reply) => {
    const market = sqlite.prepare(`
      SELECT m.*, t.name AS token_name, t.ticker AS token_ticker
      FROM proto_markets m JOIN proto_token_defs t ON t.id = m.token_def_id
      WHERE m.id = ?
    `).get(request.params.id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    const bets = sqlite.prepare('SELECT * FROM proto_bets WHERE market_id = ? ORDER BY created_at ASC').all(market.id);
    const claims = sqlite.prepare('SELECT * FROM proto_claims WHERE market_id = ? ORDER BY created_at ASC').all(market.id);
    return reply.send({ ok: true, market, bets, claims });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 下注 —— 复合动作(铸筹码 genesis + register_append spend, 两步各自 proto_bet_intents 状态机)。
  // 响应形状 {ok, steps:[{step,ok,txId,error}]}(前端已按这个形状写好渲染逻辑, 见 proto-market-detail.eta)——
  // 未落地阶段直接走 501(无 steps 字段), 前端"没有 steps 数组"分支会显示通用错误, 已兼容。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto-markets/:id/bet', async (request, reply) => {
    const market = sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(request.params.id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.status !== 'betting') return reply.code(409).send({ ok: false, error: `market status is ${market.status}, not accepting bets` });
    const { direction, amount } = request.body || {};
    if (direction !== 0 && direction !== 1) return reply.code(400).send({ ok: false, error: 'direction must be 0 (YES) or 1 (NO)' });
    const stakeAmount = Number(amount);
    if (!Number.isFinite(stakeAmount) || stakeAmount < market.min_bet) {
      return reply.code(400).send({ ok: false, error: `amount must be a number >= min_bet(${market.min_bet})` });
    }
    // NO-TX-NO-STATE: 不写 proto_bets 行, 等步骤A(铸筹码)真实广播确认后才写(见设计稿 §2.3 失败态矩阵)。
    // bettor_pk 不从请求体读——复用本市场 committee_privkey_enc 解出的那把 keypair 兼任(文件头注,
    // Bettor 1354 裁定), 不为每笔下注新造。
    try {
      await buildAndBroadcast('bet_mint', { market, direction, stakeAmount });
    } catch (err) {
      return notImplemented(reply, 'bet_mint', err);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // 委员宣布结果 —— RootClose.close_commit(v0: §5 单 keypair 模拟 5 委员)。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto-markets/:id/resolve', async (request, reply) => {
    const market = sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(request.params.id);
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
    const market = sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(request.params.id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.status !== 'resolved' && market.status !== 'cancelled') {
      return reply.code(409).send({ ok: false, error: `market status is ${market.status}, must be resolved or cancelled before claim` });
    }
    const candidates = market.status === 'resolved'
      ? sqlite.prepare('SELECT * FROM proto_bets WHERE market_id = ? AND side = ? AND status = ?').all(market.id, market.winning_side, 'confirmed')
      : sqlite.prepare('SELECT * FROM proto_bets WHERE market_id = ? AND status = ?').all(market.id, 'confirmed');
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
    const market = sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(request.params.id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    const claim = sqlite.prepare('SELECT * FROM proto_claims WHERE market_id = ? AND withdrawn_at IS NULL ORDER BY created_at ASC LIMIT 1').get(market.id);
    if (!claim) return reply.code(404).send({ ok: false, error: 'no un-withdrawn claim found in this market' });
    try {
      await buildAndBroadcast('withdraw', { market, claim });
    } catch (err) {
      return notImplemented(reply, 'withdraw', err);
    }
  });
}
