// mainnet-pm.mjs — 电报口子在主网的预测市场(押注/我的押注/结算通知)的【纯逻辑层】。D-036(取代 D-024): Owner 2026-10-05 "批，恢复电报接线"。
// 数据源 = pool v0.7 现成路由(不新造): GET /api/pool/markets、POST /api/pool/market/:id/bettor/register-v07(不收 KAS 的一步网关代付)、GET /api/pool/my-positions。
//
// 🔴 单位: 1 筹码 = 1e8 单位(KTT)。my-positions 的 stake_kas / actual_payout_kas 虽叫 *_kas, 值本身就是【筹码数】(单位/1e8); payout_pending_units 是单位(字符串)。
// 🔴 下注体: { linked_addr, direction(0=YES/1=NO), stake_ktt = 筹码×1e8 的整数字符串 }。bot 不碰密钥、不推导公钥(服务端用 my-positions 同一个 deriveXOnlyPubkey 从 linked_addr 推)。
// 🔴 只含逻辑, 所有可见字符串经 t(lang, 'pm_*'); 措辞等 Owner 定稿(铁律 0)。
import { truncate } from './readonly-shell.mjs';

export const CHIP_UNITS = 100000000;
export const MIN_CHIPS = 1;
const MAX_SAFE_CHIPS = Math.floor(Number.MAX_SAFE_INTEGER / CHIP_UNITS);   // 服务端 parseStakeKtt 要 safe integer
export const DEADLINE_BUFFER_SEC = 300;   // 与控制台页面一致: 截止前 5 分钟不再收押注

function parseSpec(s) { try { const o = JSON.parse(s || '{}'); return o && typeof o === 'object' ? o : null; } catch { return null; } }

/** 能押的盘: v0.7 + zk_native + pending_bettors + 截止未到(留 5 分钟缓冲)。 */
export function isBettablePoolRow(row, nowMs = Date.now()) {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) return false;
  if (row.protocol_version !== 'v0.7' || row.protocol_status !== 'pending_bettors') return false;
  const spec = parseSpec(row.resolution_rule_spec);
  if (!spec || spec.zk_native !== true) return false;
  const dl = Number(row.deadline);
  if (Number.isFinite(dl) && dl > 0 && dl * 1000 < nowMs + DEADLINE_BUFFER_SEC * 1000) return false;
  return true;
}

export function toPoolBotMarket(row) {
  const spec = parseSpec(row.resolution_rule_spec) || {};
  const dl = Number(row.deadline);
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return { id: row.id, title: truncate(spec.title || '', 300) || row.id, deadlineSec: Number.isFinite(dl) && dl > 0 ? dl : null, yesChips: n(row.yes_pool_kas), noChips: n(row.no_pool_kas), bettors: n(row.bettor_count) };
}

/** 列表: 可押盘, 截止近的在前, 最多 limit。 */
export function visiblePoolMarkets(rows, { limit = 8, nowMs = Date.now() } = {}) {
  const ms = (Array.isArray(rows) ? rows : []).filter((r) => isBettablePoolRow(r, nowMs)).map(toPoolBotMarket);
  ms.sort((a, b) => (a.deadlineSec ?? Infinity) - (b.deadlineSec ?? Infinity));
  return ms.slice(0, Math.max(0, limit));
}

/** 该盘是否"无人下注、到期被取消"(metadata.cancel_reason=no_bets; 旧口径 min_pot_undersize 且池为 0 同义)。 */
export function isNoBetsCancel(mk) {
  if (!mk || mk.protocol_status !== 'cancelled') return false;
  const md = (mk.metadata && typeof mk.metadata === 'object') ? mk.metadata : {};
  return md.cancel_reason === 'no_bets' || (md.cancel_reason === 'min_pot_undersize' && String(md.cancel_pool_sompi) === '0');
}

/** 回调数据 ≤64 字节(Telegram 限制): 'pm:b:' + id + ':0'。超长 id 的盘不进列表(返回 null)。 */
export function cbData(kind, id, extra = '') {
  const s = `pm:${kind}:${id}${extra ? ':' + extra : ''}`;
  return Buffer.byteLength(s) <= 64 ? s : null;
}

export function chipsLabel(n) { const v = Number(n); return Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '?'; }
export function unitsToChips(u) { return (u == null || u === '') ? null : Number(u) / CHIP_UNITS; }

/** 用户输入的筹码数: 只接受正整数(≥1)。{ok, chips} | {ok:false, reason: 'format'|'min'|'max'} */
export function parseChips(text) {
  const s = String(text == null ? '' : text).trim();
  if (!/^[0-9]{1,12}$/.test(s)) return { ok: false, reason: 'format' };
  const n = Number(s);
  if (n < MIN_CHIPS) return { ok: false, reason: 'min' };
  if (n > MAX_SAFE_CHIPS) return { ok: false, reason: 'max' };
  return { ok: true, chips: n };
}
export function chipsToStakeKtt(chips) { return (BigInt(chips) * BigInt(CHIP_UNITS)).toString(); }

// ── 每个 Telegram 用户每日押注上限(bot 侧, env TG_BET_MAX_PER_USER_DAY, 默认 5; 按 UTC 日) ──
export const utcDayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const nextUtcMidnightIso = (ms) => { const d = new Date(ms); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString(); };
/** load()/save(obj) 注入(测试可纯内存); 状态 {day, counts:{tgUser:n}}。只在服务端确认下注成功后 increment。 */
export function createCapTracker({ max = 5, load = () => null, save = () => {}, now = Date.now } = {}) {
  let st = null;
  const cur = () => { const day = utcDayKey(now()); if (!st) { const l = load(); st = l && typeof l === 'object' && l.counts ? { day: l.day, counts: { ...l.counts } } : { day, counts: {} }; } if (st.day !== day) st = { day, counts: {} }; return st; };
  return {
    max,
    used: (tg) => cur().counts[String(tg)] || 0,
    allowed: (tg) => (cur().counts[String(tg)] || 0) < max,
    increment: (tg) => { const s = cur(); s.counts[String(tg)] = (s.counts[String(tg)] || 0) + 1; save(s); },
    resetsAt: () => nextUtcMidnightIso(now()),
  };
}

/** register-v07 失败 → { key, vars }。429(J2 契约): code bet_cap_pk_day | bet_cap_global_day, body 带 cap/used/resets_at。 */
export function mapRegisterFailure(r) {
  const j = (r && r.json) || {};
  if (r && r.status === 0) return { key: 'service_busy', vars: {} };
  if (r.status === 429) return { key: 'pm_cap_server', vars: { resets: j.resets_at || '' } };
  if (r.status === 409) return { key: 'pm_closed', vars: {} };
  if (r.status === 403) return { key: 'pm_denied', vars: {} };
  if (r.status === 404) return { key: 'ro_detail_not_found', vars: {} };
  if (r.status === 400) return { key: 'pm_bad_request', vars: {} };
  if (r.status === 503) return { key: 'service_busy', vars: {} };
  return { key: 'pm_bet_fail', vars: {} };
}

// ── 我的押注 ──
/** 一条押注的状态(与控制台页面同口径): lose / win_paid / win_pending / win_unknown / awaiting / open / cancelled。 */
export function positionKind(p) {
  const s = p.status;
  if (s === 'cancelled' || s === 'refunded') return 'cancelled';
  if (p.did_win === false) return 'lose';
  if (p.did_win === true) {
    if (p.actual_payout_kas != null) return 'win_paid';
    if (p.zk_native) {
      const pend = unitsToChips(p.payout_pending_units);
      if (pend != null && pend > 0) return 'win_pending';
      if (p.pool_known === false) return 'win_unknown';
    }
    return 'win_pending_generic';
  }
  if (s === 'collecting_sigs' || s === 'verifying') return 'awaiting';
  return 'open';
}

const marketKey = (p) => p.logical_market_id || p.market_id;
export function titleOf(p) { const o = parseSpec(p.question); return (o && o.title) ? truncate(o.title, 60) : String(marketKey(p) || '').slice(0, 20); }

/** 按 logical_market_id 分组(分片盘的 market_id 是分片 id, 用户看不懂)。同一盘多笔押注合并成一组, 组内保持原顺序; 组按最近一笔 locked_at 倒序。 */
export function groupPositions(positions) {
  const g = new Map();
  for (const p of Array.isArray(positions) ? positions : []) { const k = marketKey(p); if (!g.has(k)) g.set(k, []); g.get(k).push(p); }
  return [...g.entries()].map(([id, rows]) => ({ id, rows, last: Math.max(...rows.map((r) => Number(r.locked_at) || 0)) })).sort((a, b) => b.last - a.last);
}

export function formatMyPositions(positions, lang, { t, limit = 10 } = {}) {
  const groups = groupPositions(positions);
  if (!groups.length) return t(lang, 'pm_mybets_empty');
  const lines = [t(lang, 'pm_mybets_title', { n: groups.length }), ''];
  groups.slice(0, limit).forEach((g, i) => {
    lines.push(`${i + 1}. ${titleOf(g.rows[0])}`);
    for (const p of g.rows) {
      const kind = positionKind(p);
      const vars = { side: p.my_side, stake: chipsLabel(p.stake_kas), payout: chipsLabel(p.actual_payout_kas), pending: chipsLabel(unitsToChips(p.payout_pending_units)) };
      lines.push('   ' + t(lang, `pm_pos_${kind}`, vars));
    }
  });
  if (groups.length > limit) lines.push('', t(lang, 'pm_mybets_more', { n: groups.length - limit }));
  return lines.join('\n');
}

// ── 结算通知 ──
/**
 * 对一个用户的 positions 产出【新】通知。去重键(写进 seen): `<logical_market_id>:result` (did_win 变非空时一次) 与 `<logical_market_id>:paid` (到账落链后一次)。
 * 同一盘同一用户多笔押注只通知一次(按盘汇总: 任一笔赢 ⇒ 赢; 到账额/待领额求和)。
 * 返回 [{ key, kind: 'win'|'lose'|'paid', marketId, title, ... }]。
 */
export function pickNotifications(positions, seen = new Set()) {
  const out = [];
  for (const g of groupPositions(positions)) {
    const rows = g.rows;
    if (rows.some((p) => positionKind(p) === 'cancelled')) continue;
    const decided = rows.filter((p) => p.did_win === true || p.did_win === false);
    if (!decided.length) continue;
    const won = decided.some((p) => p.did_win === true);
    const title = titleOf(rows[0]);
    const rk = `${g.id}:result`;
    if (!seen.has(rk)) out.push({ key: rk, kind: won ? 'win' : 'lose', marketId: g.id, title, side: rows[0].my_side, stake: rows.reduce((s, p) => s + (Number(p.stake_kas) || 0), 0), pendingChips: rows.reduce((s, p) => s + (unitsToChips(p.payout_pending_units) || 0), 0) });
    if (won) {
      const paid = rows.filter((p) => p.did_win === true && p.actual_payout_kas != null);
      const pk = `${g.id}:paid`;
      if (paid.length && !seen.has(pk)) out.push({ key: pk, kind: 'paid', marketId: g.id, title, payoutChips: paid.reduce((s, p) => s + Number(p.actual_payout_kas), 0) });
    }
  }
  return out;
}
