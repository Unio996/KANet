// proto.js — 原型 v0 代币/市场 API 端点(J2, 设计 docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md v0.1)。
//
// 范围稿 §3 硬边界: 本文件不得新增读取/导出私钥、调用 startRelay()、碰 ADMIN_SECRET_* 相关路由,
// 不复用/暴露 /relays/* /api/relay/* 系列私钥端点。所有链上操作走 §6/§9 定案后的 covenant_broadcast
// 命令(专属 proto relay,§6 (B′)),不经过 relay 热钱包持仓管理那一套。
//
// 🔴 当前状态(骨架阶段, ledger 1348): §6 KAS 资金来源(B′/(B)/(C))与 §9 新 relay 命令 covenant_broadcast
// 均未定案(与 Owner 决策同批)。凡涉及"构造+签名+广播链上交易"的端点(市场创建/下注/结算/claim/提现),
// 请求校验与 DB 读取部分是真实可用的, 但最终广播那一步走 `buildAndBroadcast()` 占位函数——它**总是
// 抛错**, 不假装能跑(NO-TX-NO-STATE: 没有真实广播就绝不写任何"已创建/已下注"的 DB 状态)。§6/§9 定案后
// 只需要把 `buildAndBroadcast` 换成真实实现, 端点其余部分(校验/查询/响应形状)不需要跟着改。

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

const nowIso = () => new Date().toISOString();

/**
 * 占位: §6/§9 定案前, 任何真实链上构造+广播都从这里抛出统一的"未实现"错误——调用方(下面的 handler)
 * 捕获后回 501, 不写任何 DB 状态。定案后把这个函数换成真实实现(调用 computeXxxArtifact 编译 + 走
 * covenant_broadcast 命令), 上层 handler 的调用点/参数形状已经按最终契约设计好, 不需要跟着改。
 * @param {string} kind 用于错误信息里标注具体是哪个动作卡住了(token_genesis/market_genesis/bet_mint/
 *   bet_append/market_resolve/claim/withdraw), 方便调用方(前端)展示明确的"这块还没做"而不是泛泛的 500。
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
  // §2.1 代币定义 —— 纯 DB, 不上链, 不产生任何可花费余额(Owner"代币属性配置需要界面互动"落这一层)。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto/tokens', async (request, reply) => {
    const { name, ticker, description, default_denomination } = request.body || {};
    if (!name?.trim()) return reply.code(400).send({ ok: false, error: 'name required' });
    if (!ticker?.trim()) return reply.code(400).send({ ok: false, error: 'ticker required' });
    const id = randomUUID();
    const ts = nowIso();
    sqlite.prepare(`
      INSERT INTO proto_token_defs (id, name, ticker, description, default_denomination, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), ticker.trim(), description || null, Number.isFinite(Number(default_denomination)) ? Number(default_denomination) : null, ts);
    return reply.send({ ok: true, id, name: name.trim(), ticker: ticker.trim(), created_at: ts });
  });

  fastify.get('/api/proto/tokens', async (request, reply) => {
    const rows = sqlite.prepare('SELECT * FROM proto_token_defs ORDER BY created_at DESC').all();
    return reply.send({ ok: true, tokens: rows });
  });

  // ══════════════════════════════════════════════════════════════════════
  // §2.2 建市场壳 —— ShardLeaf_direct genesis。校验/查询真实; 广播占位(§6/§9 未定案)。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto/markets', async (request, reply) => {
    const { token_def_id, question, deadline_ms, min_bet, seal_count } = request.body || {};
    if (!token_def_id) return reply.code(400).send({ ok: false, error: 'token_def_id required' });
    const tokenDef = sqlite.prepare('SELECT * FROM proto_token_defs WHERE id = ?').get(token_def_id);
    if (!tokenDef) return reply.code(404).send({ ok: false, error: 'token_def not found' });
    const deadlineMs = Number(deadline_ms);
    if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) {
      return reply.code(400).send({ ok: false, error: 'deadline_ms must be a future unix-ms timestamp' });
    }
    const minBet = Number.isFinite(Number(min_bet)) ? Number(min_bet) : 1;
    // v0 固定 2(depth-1 payoutRoot merkle cap, 设计稿 §2.2/§5) —— 界面可给选项但上限先钉 2, 不接受更大的值。
    const sealCount = Number.isFinite(Number(seal_count)) ? Math.min(2, Number(seal_count)) : 2;

    // NO-TX-NO-STATE: 广播占位阶段, 不写任何 proto_markets 行。定案后这里换成:
    //   ① 生成一次性委员会 keypair(§5, 5 槽同一把 pubkey) → crypto.encrypt 存 committee_privkey_enc
    //   ② 编译一份携带真实 committee_hash/deadline_ms/token_tmpl_hash 的 RootClose 模板 → rootclose_tmpl_hash
    //   ③ compileSilV100(ShardLeaf_direct.sil) genesis 输出 + buildAndBroadcast('market_genesis', ...)
    //   ④ 广播成功后才 INSERT proto_markets(shardleaf_txid/vout 已知)
    try {
      await buildAndBroadcast('market_genesis', { tokenDef, deadlineMs, minBet, sealCount, question });
    } catch (err) {
      return notImplemented(reply, 'market_genesis', err);
    }
  });

  fastify.get('/api/proto/markets', async (request, reply) => {
    const rows = sqlite.prepare(`
      SELECT m.*, t.name AS token_name, t.ticker AS token_ticker
      FROM proto_markets m JOIN proto_token_defs t ON t.id = m.token_def_id
      ORDER BY m.created_at DESC
    `).all();
    return reply.send({ ok: true, markets: rows });
  });

  fastify.get('/api/proto/markets/:id', async (request, reply) => {
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
  // §2.3 下注 —— 复合动作(铸筹码 genesis + register_append spend, 两步各自 proto_bet_intents 状态机)。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto/markets/:id/bet', async (request, reply) => {
    const market = sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(request.params.id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.status !== 'betting') return reply.code(409).send({ ok: false, error: `market status is ${market.status}, not accepting bets` });
    const { bettor_pk, side, stake } = request.body || {};
    if (!/^[0-9a-fA-F]{64}$/.test(bettor_pk || '')) return reply.code(400).send({ ok: false, error: 'bettor_pk must be 64 hex chars (32B x-only pubkey)' });
    if (side !== 0 && side !== 1) return reply.code(400).send({ ok: false, error: 'side must be 0 (YES) or 1 (NO)' });
    const stakeAmount = Number(stake);
    if (!Number.isFinite(stakeAmount) || stakeAmount < market.min_bet) {
      return reply.code(400).send({ ok: false, error: `stake must be a number >= min_bet(${market.min_bet})` });
    }
    // NO-TX-NO-STATE: 不写 proto_bets 行, 等步骤A(铸筹码)真实广播确认后才写(见设计稿 §2.3 失败态矩阵)。
    try {
      await buildAndBroadcast('bet_mint', { market, bettorPk: bettor_pk, side, stakeAmount });
    } catch (err) {
      return notImplemented(reply, 'bet_mint', err);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // §2.4 委员宣布结果 —— RootClose.close_commit(v0: §5 单 keypair 模拟 5 委员)。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto/markets/:id/resolve', async (request, reply) => {
    const market = sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(request.params.id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.status !== 'sealed') return reply.code(409).send({ ok: false, error: `market status is ${market.status}, must be sealed before resolve` });
    const { winning_side } = request.body || {};
    if (winning_side !== 0 && winning_side !== 1) return reply.code(400).send({ ok: false, error: 'winning_side must be 0 (YES) or 1 (NO)' });
    try {
      await buildAndBroadcast('market_resolve', { market, winningSide: winning_side });
    } catch (err) {
      return notImplemented(reply, 'market_resolve', err);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // §2.5 赢家/退款人领取 —— RootClaim.claim_draw 或 RefundClaim.refund_payout, 落地新建 KanetTokenClaim。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto/markets/:id/claim', async (request, reply) => {
    const market = sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(request.params.id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.status !== 'resolved' && market.status !== 'cancelled') {
      return reply.code(409).send({ ok: false, error: `market status is ${market.status}, must be resolved or cancelled before claim` });
    }
    const { bettor_pk } = request.body || {};
    if (!/^[0-9a-fA-F]{64}$/.test(bettor_pk || '')) return reply.code(400).send({ ok: false, error: 'bettor_pk must be 64 hex chars' });
    const bet = sqlite.prepare('SELECT * FROM proto_bets WHERE market_id = ? AND bettor_pk = ? AND status = ?').get(market.id, bettor_pk, 'confirmed');
    if (!bet) return reply.code(404).send({ ok: false, error: 'no confirmed bet found for this bettor_pk in this market' });
    const kind = market.status === 'resolved' ? 'claim_draw' : 'claim_refund';
    try {
      await buildAndBroadcast(kind, { market, bet });
    } catch (err) {
      return notImplemented(reply, kind, err);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // §2.6 从 claim covenant 提到自己名下 —— KanetTokenClaim.spend(需要 bettor 自己签名, §0 已知限制
  // T-PROTO-BETTORPK-BINDING 适用: v0 单操作员场景接受)。
  // ══════════════════════════════════════════════════════════════════════
  fastify.post('/api/proto/markets/:id/withdraw', async (request, reply) => {
    const market = sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(request.params.id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    const { bettor_pk } = request.body || {};
    if (!/^[0-9a-fA-F]{64}$/.test(bettor_pk || '')) return reply.code(400).send({ ok: false, error: 'bettor_pk must be 64 hex chars' });
    const claim = sqlite.prepare('SELECT * FROM proto_claims WHERE market_id = ? AND bettor_pk = ? AND withdrawn_at IS NULL').get(market.id, bettor_pk);
    if (!claim) return reply.code(404).send({ ok: false, error: 'no un-withdrawn claim found for this bettor_pk in this market' });
    try {
      await buildAndBroadcast('withdraw', { market, claim });
    } catch (err) {
      return notImplemented(reply, 'withdraw', err);
    }
  });
}
