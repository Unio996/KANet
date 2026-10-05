// zk-bet-cost-gate.mjs — 账本1861 / D-036: 不收 KAS 模式下 register-v07 的服务端成本闸(下注由网关用自己的 KAS 代付 ⇒ 每笔下注都在烧系统钱包)。
//
// 两个按 UTC 日的上限(只在 noKasMode 生效, 由调用方判断):
//   ZK_BET_MAX_PER_PK_DAY   同一 bettor_pk 一个 UTC 日内最多几笔, 默认 5
//   ZK_BET_MAX_GLOBAL_DAY   全系统一个 UTC 日内最多几笔, 默认 50
//   未设/非整数/<1/超上界 ⇒ 默认值(fail-closed: 宁小勿大)。
// 计数 = 现成 pool_bettor_sides 行(zk_native 盘 + 其 shard 克隆行, created_at 为 UTC 文本)+ 进程内【在途预留】。
//   为什么要在途预留: 行是在链上动作(铸票/上 leaf)之后才由 recordBettor 写入, 分钟级; 只数行则并发请求都先过闸、后写行 ⇒ 突破上限。
//   所以闸 = 同步【查数 + 预留】(中间无 await, 同 liveMarketCapReached 的原子模式), 请求结束(成功/失败)在 finally 释放。
//   进程重启时在途预留丢失——但进程已死, 在途请求也一起死了, 之后落的行会被下一次查数数到。
// 不新增表。被拒的请求在任何链上动作之前返回 429 ⇒ 零 KAS。
export const BET_CAP_PK_CODE = 'bet_cap_pk_day';
export const BET_CAP_GLOBAL_CODE = 'bet_cap_global_day';
export const DEFAULT_BET_MAX_PER_PK_DAY = 5;
export const DEFAULT_BET_MAX_GLOBAL_DAY = 50;
const CAP_UPPER = 100000;

function _capFromEnv(raw, dflt) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= CAP_UPPER ? n : dflt;
}
export function resolveBetCaps(env = process.env) {
  return { perPk: _capFromEnv(env.ZK_BET_MAX_PER_PK_DAY, DEFAULT_BET_MAX_PER_PK_DAY), global: _capFromEnv(env.ZK_BET_MAX_GLOBAL_DAY, DEFAULT_BET_MAX_GLOBAL_DAY) };
}

const _inflight = new Map();   // `${YYYY-MM-DD}|pk:<pk>` / `${YYYY-MM-DD}|global` → 在途预留数
const _k = (day, scope) => `${day}|${scope}`;
const _get = (k) => _inflight.get(k) || 0;
function _release(k) { const n = _get(k) - 1; if (n > 0) _inflight.set(k, n); else _inflight.delete(k); }

/** UTC 日起点(文本, 与 SQLite CURRENT_TIMESTAMP 同格式)与次日 0 点。 */
export function utcDayBounds(nowMs = Date.now()) {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const next = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000);
  return { day, start: `${day} 00:00:00`, resetsAt: next.toISOString(), retryAfterSec: Math.max(1, Math.ceil((next.getTime() - nowMs) / 1000)) };
}

/** 今日(UTC)已落库的 zk_native 盘下注行数(含 shard 克隆行)。pk 给定则按 bettor_pk(小写)过滤。 */
export function countBetsToday(db, { pk = null, nowMs = Date.now() } = {}) {
  const { start } = utcDayBounds(nowMs);
  const base = `SELECT COUNT(*) c FROM pool_bettor_sides s JOIN pool_markets m ON m.id = s.market_id
    WHERE s.created_at >= ? AND json_valid(m.resolution_rule_spec) AND json_extract(m.resolution_rule_spec, '$.zk_native') = 1`;
  return pk ? db.prepare(base + ' AND lower(s.bettor_pk) = ?').get(start, String(pk).toLowerCase()).c
            : db.prepare(base).get(start).c;
}

/**
 * 同步(无 await): 查数 + 预留。超限 ⇒ {ok:false, http:429, body}; 通过 ⇒ {ok:true, release()}(调用方必须在 finally 里 release)。
 * 先判 pk 再判 global(同一请求两者都超时回 pk 码)。
 */
export function reserveBetSlot(db, bettorPk, { env = process.env, nowMs = Date.now() } = {}) {
  const caps = resolveBetCaps(env);
  const pk = String(bettorPk).toLowerCase();
  const { day, resetsAt, retryAfterSec } = utcDayBounds(nowMs);
  const kPk = _k(day, `pk:${pk}`), kG = _k(day, 'global');
  const usedPk = countBetsToday(db, { pk, nowMs }) + _get(kPk);
  if (usedPk >= caps.perPk) {
    return { ok: false, http: 429, retryAfterSec, body: { ok: false, code: BET_CAP_PK_CODE, error: `每个地址每个 UTC 日最多 ${caps.perPk} 笔下注(今日已 ${usedPk})`, cap: caps.perPk, used: usedPk, resets_at: resetsAt } };
  }
  const usedG = countBetsToday(db, { nowMs }) + _get(kG);
  if (usedG >= caps.global) {
    return { ok: false, http: 429, retryAfterSec, body: { ok: false, code: BET_CAP_GLOBAL_CODE, error: `全系统每个 UTC 日最多 ${caps.global} 笔下注(今日已 ${usedG})`, cap: caps.global, used: usedG, resets_at: resetsAt } };
  }
  _inflight.set(kPk, _get(kPk) + 1); _inflight.set(kG, _get(kG) + 1);
  let done = false;
  return { ok: true, release() { if (done) return; done = true; _release(kPk); _release(kG); } };
}

/** 仅测试用。 */
export function _resetBetGateForTest() { _inflight.clear(); }
export function _inflightSnapshotForTest() { return Object.fromEntries(_inflight); }
