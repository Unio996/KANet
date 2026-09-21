// proto-settlement-freeze.mjs — oracle 整合批 D: 冻结(settlement_frozen_at)的 DB 端口 + 晚 seal 守卫 + promote 写值封装。
// 设计 v0.3 §3 / §4 / D1 / D2 / N5。db 由调用方注入(本文件不 import DB 客户端: M0a 门)。
// 🔴 冻结 = 该市场结算不再前进: close_commit 三入口(listWork / dependenciesLanded / 核心广播前闸)fail-closed; 单向不可撤(DB 触发器保证, migrate v213);
//    冻结后 winning_side 永不可写 ⇒ 判定题市场唯一出口 = 自然 refund_flip(N5b; refund 执行批未接线前有价值市场不得上主网)。
// 🔴 冻结写入不依赖 pmt 有效性(N5a): pmt 有效写 pmt, 否则退墙钟毫秒 + frozen_reason 标 clock=wall。
import { chooseFreezeClock, frozenReasonText, evaluateLateSeal, PROMOTE_UPDATE_SQL } from './proto-settlement-budget.mjs';
import { isJudgedMarket, JUDGED_COLUMNS } from '../db/proto-judged.mjs';

const isDb = (db) => db && typeof db.prepare === 'function';

/** 读冻结列(D1 三入口共用)。市场不存在 ⇒ 抛(fail-closed: 调用方按"冻结 / 不可推进"处理); 列值非 NULL 即冻结。 */
export function isMarketFrozen(db, marketId) {
  if (!isDb(db)) throw new TypeError('isMarketFrozen: db 必填');
  const r = db.prepare('SELECT settlement_frozen_at FROM proto_markets WHERE id = ?').get(marketId);
  if (!r) throw new Error(`isMarketFrozen: 市场 ${marketId} 不存在(fail-closed)`);
  return r.settlement_frozen_at !== null && r.settlement_frozen_at !== undefined;
}

/**
 * 冻结市场(单向)。reason ∈ [a-z0-9_]+; pmt = readValidatedPmt 的结果(无效 / null 也行 ⇒ 退墙钟)。
 * @returns {{frozen: boolean, changes: number, at: number, clock: 'pmt'|'wall', reasonText: string}} changes=0 ⇒ 已冻结(幂等, 不覆盖首次冻结的时刻与原因)
 */
export function freezeMarket({ db, marketId, reason, pmt = null, wallMs = Date.now(), nowIso = () => new Date().toISOString(), log = console }) {
  if (!isDb(db)) throw new TypeError('freezeMarket: db 必填');
  const { at, clock } = chooseFreezeClock({ pmt, wallMs });
  const reasonText = frozenReasonText(reason, clock);
  const res = db.prepare('UPDATE proto_markets SET settlement_frozen_at = ?, frozen_reason = ?, updated_at = ? WHERE id = ? AND settlement_frozen_at IS NULL').run(at, reasonText, nowIso(), marketId);
  if (res.changes === 1) log.warn?.(`[proto-settlement-freeze] market ${marketId} FROZEN (${reasonText}, at=${at}) — 结算不再前进, 唯一出口=自然 refund_flip`);
  return { frozen: true, changes: res.changes, at, clock, reasonText };
}

/**
 * 晚 seal 守卫(§4): seal landed 后由驱动调用。只对【有判定题】的市场生效(无判定题的 operator 市场——如主网首轮 a59c——不冻结, 走受控 write-once 路径)。
 * effective_upper = cutoff − 决策时刻 − MARGIN < GRACE ⇒ 冻结(reason=late_seal; F2: 原判据 GRACE_MIN 已废, 宽限采冻结不压缩)。决策时刻取 pmt, pmt 无效退墙钟(保守)。
 * 永不抛(守卫失败不能阻塞 seal 的 landed 记账; promote 门自己也会在 promote 时再判一次晚 seal, 双覆盖)。
 */
export async function applyLateSealGuard({ db, marketId, readPmt, cfg, wallMs = () => Date.now(), log = console }) {
  try {
    const cols = ['id', 'status', 'winning_side', 'settlement_frozen_at', 'deadline_ms', ...JUDGED_COLUMNS].join(', ');
    const m = db.prepare(`SELECT ${cols} FROM proto_markets WHERE id = ?`).get(marketId);
    if (!m) return { applied: false, reason: 'market_not_found' };
    if (!isJudgedMarket(m)) return { applied: false, reason: 'not_judged' };
    if (m.settlement_frozen_at != null) return { applied: false, reason: 'already_frozen' };
    if (m.winning_side != null) return { applied: false, reason: 'already_decided' };
    let pmt = null;
    try { pmt = await readPmt(); } catch { pmt = null; }   // 读 pmt 抛错 ⇒ 按无效处理(退墙钟判 late, 方向保守; 冻结写入同样退墙钟, N5a)
    const wall = wallMs();
    const decisionMs = pmt && pmt.valid === true ? pmt.pmtMs : wall;
    const v = evaluateLateSeal({ deadlineMs: m.deadline_ms, decisionMs, cfg });
    if (!v.late) return { applied: false, reason: 'not_late', upperMs: v.upperMs };
    const f = freezeMarket({ db, marketId, reason: 'late_seal', pmt, wallMs: wall, log });
    return { applied: f.changes === 1, reason: 'late_seal', upperMs: v.upperMs, clock: f.clock };
  } catch (e) {
    log.error?.(`[proto-settlement-freeze] 晚 seal 守卫失败(不阻塞 seal 记账; promote 门会再判): ${e && e.message ? e.message : e}`);
    return { applied: false, reason: 'guard_error', message: e && e.message ? e.message : String(e) };
  }
}

/** promote 写值(批 B 用; 本批不接调用方)。谓词同语句带 sealed ∧ winning_side IS NULL ∧ settlement_frozen_at IS NULL(D2); changes==0 ⇒ 已判 / 已冻 / 非 sealed, 调用方停。 */
export function promoteWinningSide({ db, marketId, decision, setAtIso = new Date().toISOString(), nowIso = () => new Date().toISOString() }) {
  if (!isDb(db)) throw new TypeError('promoteWinningSide: db 必填');
  if (!decision || decision.action !== 'promote') throw new TypeError('promoteWinningSide: decision 必须是 evaluatePromoteGate 的 promote 结果');
  return db.prepare(PROMOTE_UPDATE_SQL).run(decision.winningSide, decision.source, setAtIso, decision.verdictId, nowIso(), marketId, marketId, decision.winningSide);
}
