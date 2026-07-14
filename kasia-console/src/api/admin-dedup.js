// #27 (Owner 钦定 2026-07-03 公测门面): 重复盘 refund-cleanup admin endpoint.
// localhost-only, operator-triggered — 批量/单个把指定 market_id 走真退款路径 (dispatchRefund),
// 绝不裸 UPDATE protocol_status='cancelled' (会断 settler 退款路, 见记忆
// feedback-pool-market-status-cancel-breaks-settler-refund)。
import { sqlite } from '../db/client.js';
import { dispatchRefund } from '../services/pool-market-settler.js';
import { verifyIngestRequest } from '../services/ingest-auth.js';
import { getSidesByLogicalMarket } from '../lib/pool-bettor-sides-query.mjs';
import { reclaimBshardMakerBond } from '../services/bshard-auto-settler.mjs';
import { buildCtx, clearRepeatOffenderMarker } from '../services/bshard-settle-daemon.mjs';
import { listZ20CircuitBroken, clearZ20Circuit } from '../services/broker-intake-watcher.js';

const HEX64 = /^[0-9a-fA-F]{64}$/;

// 🔴 容器①/②普适口径(2026-07-12, 7pori 撞见, Bettor 裁"(a)带交叉核验"+NWT 加固 #hnppoc.2 后续):
// dispatchRefund 本体只退 maker(见上方注释), 对"bettor 已经通过独立机制(容器②/cancelMarketLive)全额
// 安全退完"的终态盘(status='refunded')原逻辑会双重拒(status 不在白名单 + betCount>0)——但这类盘
// 恰恰是唯一还差 maker bond 没收口的情况, 反而被现有 guard 挡死, 逼人手动碰未审计的临时调用点。
// 本函数判定"是否已有可信的容器②完成证据"——不只查字段存在(caller 可摆布的裸 flag), 而是交叉核对
// refund_evidence.refunds[] 与该市场【实际 pool_bettor_sides 行】逐笔 pk+amount 双向吻合(bijective,
// 无多无少), 且 cancel_txid 是真 64-hex(非占位符)。任一环节不吻合 → 视为"没有可信证据", 照旧拒绝
// (fail-closed, 不猜)。
export function hasVerifiedContainer2Evidence(market, sides) {
  let meta = {};
  try { meta = JSON.parse(market.metadata || '{}'); } catch { return false; }
  const ev = meta.refund_evidence;
  if (!ev || typeof ev !== 'object') return false;
  if (ev.complete !== true) return false;
  if (typeof ev.cancel_txid !== 'string' || !HEX64.test(ev.cancel_txid)) return false;
  if (!Array.isArray(ev.refunds) || ev.refunds.length !== sides.length) return false;
  const sidesByPk = new Map(sides.map((s) => [String(s.bettor_pk).toLowerCase(), String(s.stake_amount)]));
  const seenPks = new Set();
  for (const r of ev.refunds) {
    if (!r || typeof r.pk !== 'string') return false;
    const pk = r.pk.toLowerCase();
    if (seenPks.has(pk)) return false;   // 防重复条目虚报覆盖度
    seenPks.add(pk);
    const expectedStake = sidesByPk.get(pk);
    if (expectedStake === undefined) return false;   // refund 里有条目对不上任何一行真实 bettor_pk
    if (String(r.amount) !== expectedStake) return false;   // 金额必须逐位吻合(非"差不多")
  }
  return seenPks.size === sides.length;   // 双向: 每一行真实 bettor 都被覆盖, 无遗漏
}

export async function registerAdminDedupRoutes(fastify) {
  // POST /api/admin/dedup-refund { marketIds: [...], reason: '...' }
  fastify.post('/api/admin/dedup-refund', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    const { marketIds, reason } = request.body || {};
    if (!Array.isArray(marketIds) || !marketIds.length) {
      return reply.code(400).send({ ok: false, error: 'marketIds must be a non-empty array' });
    }
    const results = [];
    for (const id of marketIds) {
      const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(id);
      if (!market) { results.push({ id, ok: false, error: 'not_found' }); continue; }
      const sides = getSidesByLogicalMarket(id, sqlite);
      const betCount = sides.length;
      const isStandardStatus = ['pending_bettors', 'verifying', 'pending_oracle_deposits'].includes(market.protocol_status);
      const isPostContainer2 = market.protocol_status === 'refunded' && betCount > 0 && hasVerifiedContainer2Evidence(market, sides);
      if (!isStandardStatus && !isPostContainer2) {
        results.push({ id, ok: false, error: `unexpected status ${market.protocol_status}, refused (safety)` });
        continue;
      }
      // dispatchRefund = maker-only "0-bet market" refund path (refund_maker_unjoined). A market
      // with real bettor stakes needs the all-bettor refund mechanism instead — calling dispatchRefund
      // on it would refund the maker and silently strand the bettors' funds. Refuse, don't guess.
      // isPostContainer2 例外: bettor 侧已经过独立机制(容器②)交叉验证完全退完, betCount>0 不再是
      // "会 strand bettor 资金"的信号, 而是"maker bond 还没收口"的信号——两种情形要区分对待。
      if (betCount > 0 && !isPostContainer2) {
        results.push({ id, ok: false, error: `market has ${betCount} real bettor side(s) — dispatchRefund is maker-only, refused (safety)` });
        continue;
      }
      try {
        await dispatchRefund(market, { reason: reason || (isPostContainer2 ? 'container1 maker bond recovery (post-container2 verified refund)' : '#27 dedup cleanup') });
        const after = sqlite.prepare('SELECT protocol_status FROM pool_markets WHERE id = ?').get(id);
        results.push({ id, ok: after?.protocol_status === 'refunding', status: after?.protocol_status });
      } catch (e) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    return reply.send({ ok: true, results });
  });
}

// 2026-07-13 (docs/2026-07-13-bshard-poolspine-maker-bond-reclaim-design.md §3.4, Bettor 派工#i2vns2
// 落码GO): bshard 市场容器①(PoolSpine maker bond) 收口——上面 /api/admin/dedup-refund 走 dispatchRefund
// 是 legacy 专属(7pori 撞见的入口不辨材质病根，本条镜像修法：新端点单独收 bshard 材质，不再让一个
// 端点兼两种机制)。dryRun:true(默认) 只跑四闸判定 + preimage 构建，不签名广播——§6.1 交付定义要求的
// "12盘三闸判定清单"就靠这个模式跑，逐盘结果显式打印 makerAddress 供 Bettor+NWT 肉眼核对(同 7pori
// 链验惯例，NWT verify-value-source 观察点)。真实执行仍需调用方显式传 dryRun:false + 走频道"明确批
// 字样"纪律(钱路铁律不因为有 admin 端点降级)。
export async function registerBshardBondReclaimRoutes(fastify) {
  // POST /api/admin/reclaim-bshard-maker-bond { marketIds: [...], dryRun: true }
  fastify.post('/api/admin/reclaim-bshard-maker-bond', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    const { marketIds, dryRun = true } = request.body || {};
    if (!Array.isArray(marketIds) || !marketIds.length) {
      return reply.code(400).send({ ok: false, error: 'marketIds must be a non-empty array' });
    }
    const ctx = { ...buildCtx(), dryRun };
    const results = [];
    for (const id of marketIds) {
      try {
        const r = await reclaimBshardMakerBond(id, ctx);
        results.push({ id, ...r });
      } catch (e) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    return reply.send({ ok: true, dryRun, results });
  });

  // 🔴 精度补丁②(Bettor #j8p6gn, 2026-07-13): repeat-offender pre-gate 不能只进不出——人工 probe 确认
  // 某盘已自愈(如卡住的 UTXO 后来自己落地)后, 显式清 marker(clearRepeatOffenderMarker 自带 tripwire
  // guard: 非 gate 状态返回幂等 no-op, 不会误清)。纯调度层, 不动钱不改 protocol_status。
  // POST /api/admin/clear-repeat-offender { marketIds: [...], reason: '...' }
  fastify.post('/api/admin/clear-repeat-offender', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    const { marketIds, reason } = request.body || {};
    if (!Array.isArray(marketIds) || !marketIds.length) {
      return reply.code(400).send({ ok: false, error: 'marketIds must be a non-empty array' });
    }
    const results = marketIds.map((id) => ({ id, ...clearRepeatOffenderMarker(id, sqlite, reason) }));
    return reply.send({ ok: true, results });
  });
}

// 2026-07-14 (Bettor 语义裁定 #k7xxxx, ff67936d Z20 熔断闸续): 挂账清单查询入口——"熔断=停调度重试
// ≠ 放弃这笔钱"这条语义边界要成立, 必须有人能随时查到"哪些 offer 被熔断了、为什么、多少钱、归谁",
// 否则熔断就从"止血"退化成"静默丢弃"(NWT 复审抓出的风险)。纯读 GET, 无需 body。
export async function registerZ20CircuitRoutes(fastify) {
  // GET /api/admin/z20-circuit-broken — 挂账清单: 谁被熔断/为什么/多少钱/归谁
  fastify.get('/api/admin/z20-circuit-broken', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    const results = listZ20CircuitBroken();
    return reply.send({ ok: true, count: results.length, results });
  });

  // POST /api/admin/clear-z20-circuit { offerIds: [...], reason: '...' }
  // 人工确认卡死原因已处置后复位, 让下一轮 Z20 tick 重新尝试。纯调度层, 不动钱。
  fastify.post('/api/admin/clear-z20-circuit', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    const { offerIds, reason } = request.body || {};
    if (!Array.isArray(offerIds) || !offerIds.length) {
      return reply.code(400).send({ ok: false, error: 'offerIds must be a non-empty array' });
    }
    const results = offerIds.map((id) => ({ id, ...clearZ20Circuit(id, reason) }));
    return reply.send({ ok: true, results });
  });
}
