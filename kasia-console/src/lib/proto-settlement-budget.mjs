// proto-settlement-budget.mjs — oracle 整合批 D: 时间预算 / pmt 有效性 / promote 门 / 晚 seal / 受理点 outcome_end 门 的【纯逻辑】。
// 设计 docs/2026-09-20-bettor-oracle-batchD-grace-refundflip-budget-design-v0.1.md v0.3 §1–§6 + N1–N6。
// 🔴 纯函数(常量解析 / pmt 有效性 / 各门): 无 DB / 无 IO / 无 process.env 直读(env 由调用方传入); 唯一的"IO"是 readValidatedPmt 里对注入的 sendCmd 的一次只读调用。
// 🔴 本批【不接 promote 的调用方】(promote 写值属批 B); 这里的 evaluatePromoteGate 只给批 B 铺闸, 单测覆盖 N 边界。
// 所有时间量按 pmt 域(毫秒)算; pmt 无效时 promote 推迟(过 cutoff 一律冻结, 方向安全); 冻结写入不依赖 pmt 有效(N5a, 见 chooseFreezeClock)。
import { REFUND_FLIP_GRACE_MS } from './proto-close-commit-gate.mjs';
import { isJudgedMarket } from '../db/proto-judged.mjs';

// ── §2 常量(N2 校准; env 可覆盖带启动校验) ──
export const DEFAULTS = Object.freeze({
  PROMOTION_SAFETY_MS: 1_200_000,        // 20 min
  GRACE_MS: 1_800_000,                   // 30 min
  GRACE_MIN_MS: 300_000,                 // 5 min
  LAG_MAX_MS: 600_000,                   // 10 min: pmt 落后墙钟的可接受上限(实测稳态 133–149 s, 风险在未同步 / 落后 / 重启)
  CLOSE_PIPELINE_MARGIN_MS: 120_000,     // 2 min: close_commit 流水线余量(实测写值→landed ≈30 s, 这里按 2 tick + 深度保守取)
});
export const SAFETY_RANGE_MS = Object.freeze({ min: 900_000, max: 3_600_000 });   // [15 min, 60 min](N2 有效区间)
const RANGES = Object.freeze({
  GRACE_MS: [60_000, REFUND_FLIP_GRACE_MS],
  GRACE_MIN_MS: [60_000, REFUND_FLIP_GRACE_MS],
  LAG_MAX_MS: [60_000, 1_800_000],
  CLOSE_PIPELINE_MARGIN_MS: [30_000, 1_800_000],
});
export const ENV_NAMES = Object.freeze({
  PROMOTION_SAFETY_MS: 'PROTO_PROMOTION_SAFETY_MS', GRACE_MS: 'PROTO_GRACE_MS', GRACE_MIN_MS: 'PROTO_GRACE_MIN_MS',
  LAG_MAX_MS: 'PROTO_PMT_LAG_MAX_MS', CLOSE_PIPELINE_MARGIN_MS: 'PROTO_CLOSE_PIPELINE_MARGIN_MS',
});

export class BudgetConfigError extends Error { constructor(m) { super(m); this.name = 'BudgetConfigError'; } }

/**
 * 解析 + 校验预算常量。env 里没写 ⇒ 默认; 写了但非法(非正整数 / 越区间)⇒ 回默认并在 warnings 里 LOUD(调用方必须打日志);
 * N2: PROMOTION_SAFETY_MS 必须 ∈ [15min, 60min] 且 ≥ LAG_MAX + CLOSE_PIPELINE_MARGIN + tickMs(否则本机 pmt 落后 LAG_MAX 时 SAFETY 太小, promote 白写); 违则回默认 + warning;
 * 默认值本身也过不了动态下界(如 tick / LAG_MAX 被配得很大)⇒ 抛 BudgetConfigError(拒启动, 不带着一套自相矛盾的预算跑钱路)。
 * @returns {{config: object, warnings: string[]}}
 */
export function resolveBudgetConfig(env = {}, { tickMs } = {}) {
  if (!Number.isSafeInteger(tickMs) || tickMs <= 0) throw new BudgetConfigError('resolveBudgetConfig: tickMs 必须是正整数(N2 校验要用)');
  const warnings = [];
  const pick = (key, dflt, lo, hi) => {
    const name = ENV_NAMES[key], raw = env[name];
    if (raw === undefined || raw === null || raw === '') return dflt;
    const v = Number(raw);
    if (!Number.isSafeInteger(v) || v <= 0) { warnings.push(`${name}=${JSON.stringify(raw)} 不是正整数 ⇒ 回默认 ${dflt}`); return dflt; }
    if (v < lo || v > hi) { warnings.push(`${name}=${v} 越出有效区间 [${lo}, ${hi}] ⇒ 回默认 ${dflt}`); return dflt; }
    return v;
  };
  const lagMaxMs = pick('LAG_MAX_MS', DEFAULTS.LAG_MAX_MS, ...RANGES.LAG_MAX_MS);
  const marginMs = pick('CLOSE_PIPELINE_MARGIN_MS', DEFAULTS.CLOSE_PIPELINE_MARGIN_MS, ...RANGES.CLOSE_PIPELINE_MARGIN_MS);
  const safetyFloor = Math.max(SAFETY_RANGE_MS.min, lagMaxMs + marginMs + tickMs);      // N2 动态下界
  let safetyMs = pick('PROMOTION_SAFETY_MS', DEFAULTS.PROMOTION_SAFETY_MS, SAFETY_RANGE_MS.min, SAFETY_RANGE_MS.max);
  if (safetyMs < safetyFloor) {
    warnings.push(`${ENV_NAMES.PROMOTION_SAFETY_MS}=${safetyMs} < LAG_MAX(${lagMaxMs}) + MARGIN(${marginMs}) + tick(${tickMs}) = ${lagMaxMs + marginMs + tickMs} ⇒ 回默认 ${DEFAULTS.PROMOTION_SAFETY_MS}`);
    safetyMs = DEFAULTS.PROMOTION_SAFETY_MS;
  }
  if (safetyMs < safetyFloor || safetyMs > SAFETY_RANGE_MS.max) throw new BudgetConfigError(`预算自相矛盾: 默认 PROMOTION_SAFETY_MS(${safetyMs}) < LAG_MAX(${lagMaxMs}) + MARGIN(${marginMs}) + tick(${tickMs}) 或超出 [${SAFETY_RANGE_MS.min}, ${SAFETY_RANGE_MS.max}] ⇒ 拒绝启动(调小 tick / LAG_MAX / MARGIN)`);
  let graceMs = pick('GRACE_MS', DEFAULTS.GRACE_MS, ...RANGES.GRACE_MS);
  let graceMinMs = pick('GRACE_MIN_MS', DEFAULTS.GRACE_MIN_MS, ...RANGES.GRACE_MIN_MS);
  if (graceMinMs > graceMs) { warnings.push(`GRACE_MIN(${graceMinMs}) > GRACE(${graceMs}) ⇒ 两者回默认(${DEFAULTS.GRACE_MIN_MS} / ${DEFAULTS.GRACE_MS})`); graceMinMs = DEFAULTS.GRACE_MIN_MS; graceMs = DEFAULTS.GRACE_MS; }
  return { config: Object.freeze({ promotionSafetyMs: safetyMs, graceMs, graceMinMs, lagMaxMs, closePipelineMarginMs: marginMs, tickMs }), warnings };
}

/** promotion_cutoff_pmt = deadline_ms + 7,200,000 − PROMOTION_SAFETY_MS(pmt 域, 毫秒)。deadline 非法 ⇒ 抛。 */
export function promotionCutoffPmt(deadlineMs, cfg) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) throw new RangeError(`promotionCutoffPmt: deadlineMs 非法: ${deadlineMs}`);
  return deadlineMs + REFUND_FLIP_GRACE_MS - cfg.promotionSafetyMs;
}

// ── §5 pmt 有效性 ──
/**
 * pmt 有效当且仅当 isSynced===true ∧ |读取时墙钟 − pmt| ≤ LAG_MAX ∧ 与上次接受的 pmt 单调不减; 否则读失败(promote 推迟; 过 cutoff 一律冻结)。
 * 单调基线只在内存(重启后无基线 ⇒ 第一次有效读数建立基线; 设计 SHOULD 票: 基线存放 / 重启处理)。
 */
export function createPmtValidator({ lagMaxMs, now = Date.now } = {}) {
  if (!Number.isSafeInteger(lagMaxMs) || lagMaxMs <= 0) throw new TypeError('createPmtValidator: lagMaxMs 必须是正整数');
  let last = null;
  return {
    validate({ pmtMs, isSynced, observedAtMs } = {}) {
      if (isSynced !== true) return { valid: false, reason: 'not_synced' };
      if (!Number.isSafeInteger(pmtMs) || pmtMs <= 0) return { valid: false, reason: 'pmt_not_positive_integer' };
      const wall = Number.isSafeInteger(observedAtMs) && observedAtMs > 0 ? observedAtMs : now();
      if (Math.abs(wall - pmtMs) > lagMaxMs) return { valid: false, reason: 'pmt_wall_skew_exceeds_lag_max', skewMs: wall - pmtMs };
      if (last !== null && pmtMs < last) return { valid: false, reason: 'pmt_regressed', lastMs: last };
      last = pmtMs;
      return { valid: true, pmtMs, observedAtMs: wall };
    },
    peekLast: () => last,
    reset() { last = null; },
  };
}

let _sharedValidator = null;
/** 进程内共享的校验器(驱动的晚 seal 守卫与 HTTP 受理门共用同一条单调基线); 首次调用按传入的 lagMaxMs 建。 */
export function sharedPmtValidator(lagMaxMs) { if (!_sharedValidator) _sharedValidator = createPmtValidator({ lagMaxMs }); return _sharedValidator; }
export function resetSharedPmtValidatorState() { _sharedValidator = null; }

/**
 * 经 relay 的只读 get_past_median_time 读 pmt 并过校验器。relay 须回 {ok, pastMedianTimeMs, observedAtMs, isSynced}; 缺 isSynced(旧 relay)⇒ 按无效(fail-closed)。
 * 永不抛: 任何异常 ⇒ { valid:false, reason:'read_failed' }。
 */
export async function readValidatedPmt({ sendCmd, relayId, validator, timeoutMs = 15_000 }) {
  let r;
  try { r = await sendCmd(relayId, { type: 'get_past_median_time' }, timeoutMs, 'internal'); }
  catch (e) { return { valid: false, reason: 'read_failed', message: e && e.message ? e.message : String(e) }; }
  if (!(r && r.ok === true)) return { valid: false, reason: 'read_failed', message: `回执不合法(ok=${r && r.ok})` };
  if (typeof r.isSynced !== 'boolean') return { valid: false, reason: 'is_synced_missing' };
  return validator.validate({ pmtMs: r.pastMedianTimeMs, isSynced: r.isSynced, observedAtMs: r.observedAtMs });
}

// ── N5a 冻结时钟 ──
/** 冻结写入【不依赖 pmt 有效性】: pmt 有效写 pmt, 否则退墙钟毫秒并标 clock=wall。 */
export function chooseFreezeClock({ pmt, wallMs }) {
  if (pmt && pmt.valid === true && Number.isSafeInteger(pmt.pmtMs) && pmt.pmtMs > 0) return { at: pmt.pmtMs, clock: 'pmt' };
  if (!Number.isSafeInteger(wallMs) || wallMs <= 0) throw new RangeError('chooseFreezeClock: pmt 无效且 wallMs 也非法——无从记冻结时刻');
  return { at: wallMs, clock: 'wall' };
}
/** frozen_reason 文本(必非空, N5a): `<reason>|clock=<pmt|wall>`; reason 限 [a-z0-9_]+ 便于机读 / 将来枚举化。 */
export function frozenReasonText(reason, clock) {
  if (typeof reason !== 'string' || !/^[a-z0-9_]+$/.test(reason)) throw new RangeError(`frozenReasonText: reason 必须是 [a-z0-9_]+: ${JSON.stringify(reason)}`);
  if (clock !== 'pmt' && clock !== 'wall') throw new RangeError('frozenReasonText: clock 必须是 pmt|wall');
  return `${reason}|clock=${clock}`;
}

// ── §4 晚 seal ──
/** seal landed 时的晚 seal 判据: effective_upper = cutoff − 决策时刻 − MARGIN; < GRACE_MIN ⇒ late。决策时刻取 pmt, pmt 无效退墙钟(墙钟 ≥ pmt ⇒ 更早判 late, 方向保守)。 */
export function evaluateLateSeal({ deadlineMs, decisionMs, cfg }) {
  const cutoff = promotionCutoffPmt(deadlineMs, cfg);
  if (!Number.isSafeInteger(decisionMs) || decisionMs <= 0) throw new RangeError('evaluateLateSeal: decisionMs 非法');
  const upperMs = cutoff - decisionMs - cfg.closePipelineMarginMs;
  return { late: upperMs < cfg.graceMinMs, upperMs, cutoffPmt: cutoff };
}

// ── §6 受理点 outcome_end 门(D6 + N3 + N4) ──
const isFiniteNum = (x) => typeof x === 'number' && Number.isFinite(x);
/** 受理前是否需要读 pmt: 只有【判定题 ∧ outcome_end 有限】才需要; 无判定题(operator 市场)豁免、判定题∧outcome_end 空直接拒(不读 pmt)。 */
export function intakeNeedsPmt(market, wallMs) { return isJudgedMarket(market) && isFiniteNum(market.outcome_end_ms) && !(Number.isFinite(wallMs) && wallMs >= market.outcome_end_ms); }
/**
 * 受理点门(HTTP bet 路由, 受理时刻 pmt)——不是驱动对已受理注的 append(N4: 已受理未上链的注必须仍能上链, 否则永不 seal)。
 * @param {{market: object, pmt?: {valid:boolean, pmtMs?:number, reason?:string}|null, wallMs?: number|null}} o  market 须含四个判定题列 + outcome_end_ms; pmt = readValidatedPmt 的结果(仅 intakeNeedsPmt 为真时才需要)
 * @returns {{accept: boolean, code?: string, http?: number, detail?: string}}
 */
export function evaluateBetIntakeGate({ market, pmt = null, wallMs = null }) {
  if (!isJudgedMarket(market)) return { accept: true, code: 'not_judged_exempt' };
  if (!isFiniteNum(market.outcome_end_ms)) return { accept: false, code: 'outcome_end_missing', http: 409, detail: '判定题市场必须有有限的 outcome_end_ms(N3), 否则拒受理下注' };
  // M2(NWT 批 D 复核, Bettor 拍): pmt 落后墙钟 2.3–10 min ⇒ 墙钟已过 outcome_end 而 pmt 还没过的这段窗内, 只看 pmt 会继续收下注。取 max(墙钟, pmt): 偏差只会多拒、不会多收。
  //   墙钟已过即拒(不依赖 pmt 是否有效——结果已可知是墙钟就能确定的事实, 也就不需要再读 pmt)。
  if (Number.isFinite(wallMs) && wallMs >= market.outcome_end_ms) return { accept: false, code: 'outcome_end_passed', http: 409, detail: `墙钟(${wallMs}) ≥ outcome_end_ms(${market.outcome_end_ms}): 结果已可知, 拒受理下注(取 max(墙钟, pmt))` };
  if (!pmt || pmt.valid !== true) return { accept: false, code: 'pmt_unavailable_fail_closed', http: 503, detail: `判定题受理时 pmt 无效 / 读不到 ⇒ 拒受理(N4 fail-closed): ${pmt && pmt.reason ? pmt.reason : 'no_pmt'}` };
  if (pmt.pmtMs >= market.outcome_end_ms) return { accept: false, code: 'outcome_end_passed', http: 409, detail: `pmt(${pmt.pmtMs}) ≥ outcome_end_ms(${market.outcome_end_ms}): 结果已可知, 拒受理下注` };
  return { accept: true, code: 'ok' };
}

// ── §1 promote 门 ──
const AUTO_KINDS = Object.freeze(['extractor', 'uma']);
/**
 * promote(verdict → winning_side)的六前置(纯函数; 本批不接调用方——批 B 的 adapter 调它, 再用 PROMOTE_UPDATE_SQL 写值)。
 * @param {object} o
 * @param {object} o.market   proto_markets 行(须含 status / winning_side / settlement_frozen_at / deadline_ms / outcome_end_ms + 四个判定题列)
 * @param {object[]} o.verdicts 该市场的全部 proto_market_verdicts 行(id / source_kind / outcome / pmt_at)
 * @param {object[]} o.bets   该市场的 proto_bets 行(side / status / stake)——R5 预检
 * @param {{valid:boolean, pmtMs?:number}|null} o.pmt  readValidatedPmt 的结果
 * @param {number} o.wallMs   墙钟毫秒(pmt 无效时判"是否已过 cutoff"用, 方向保守)
 * @param {object} o.cfg      resolveBudgetConfig().config
 * @param {'auto'} [o.mode]   本批只实现 'auto'(extractor / uma 一致 + 宽限窗); 'human' 确认路径的语义归批 B
 * @returns {{action:'promote'|'wait'|'freeze'|'stop'|'reject', reason:string, ...}}
 *   promote: { winningSide, source, verdictId, consistencyMetAt, effectiveGraceMs }; freeze: { clock:'pmt'|'wall' 由调用方按 chooseFreezeClock 定 } 只给 reason;
 *   stop = 无事可做(已冻 / 已判 / 无判定题); wait = 条件未到; reject = 输入非法拒 promote 且记因(不冻结)。
 */
export function evaluatePromoteGate({ market, verdicts, bets, pmt, wallMs, cfg, mode = 'auto' }) {
  if (mode !== 'auto') return { action: 'wait', reason: 'mode_not_supported_in_batch_D' };
  if (market.settlement_frozen_at !== null && market.settlement_frozen_at !== undefined) return { action: 'stop', reason: 'already_frozen' };
  if (market.winning_side !== null && market.winning_side !== undefined) return { action: 'stop', reason: 'already_decided' };
  if (!isJudgedMarket(market)) return { action: 'stop', reason: 'not_judged' };
  if (market.status !== 'sealed') return { action: 'wait', reason: 'not_sealed' };
  const dl = market.deadline_ms;
  if (!Number.isSafeInteger(dl) || dl <= 0) return { action: 'reject', reason: 'deadline_invalid' };
  const oe = market.outcome_end_ms;
  if (!isFiniteNum(oe)) return { action: 'reject', reason: 'outcome_end_missing' };                 // N3: 判定题 ∧ outcome_end 空/非有限 ⇒ 拒 promote + 记因
  const cutoff = promotionCutoffPmt(dl, cfg);
  const pmtOk = !!(pmt && pmt.valid === true && Number.isSafeInteger(pmt.pmtMs));
  if (!pmtOk) {
    // pmt 无效: promote 推迟; 但墙钟(≥ pmt)已过 cutoff ⇒ 一律冻结(方向安全; 冻结写入不依赖 pmt, N5a)
    if (Number.isSafeInteger(wallMs) && wallMs >= cutoff) return { action: 'freeze', reason: 'pmt_invalid_past_cutoff' };
    return { action: 'wait', reason: 'pmt_invalid', detail: pmt && pmt.reason };
  }
  const now = pmt.pmtMs;
  if (now >= cutoff) return { action: 'freeze', reason: 'past_cutoff', cutoffPmt: cutoff };       // §1.3: 过 cutoff 一律冻结
  if (now < oe) return { action: 'wait', reason: 'outcome_not_known' };                            // §1.2: pmt ≥ outcome_end_ms
  // M1(NWT 批 D 复核, Bettor 拍): 【冻结集】= 该市场所有 verdict——extractor / uma / human / llm, 不论 pmt_at 是否为 NULL、不论早晚(adapter 读 pmt 失败时写下的异议 pmt_at 为 NULL, 不能被无视 = fail-open)。
  //   冻结集里出现 outcome 非 0/1(NULL 弃权 / 异议)或彼此不一致(即与将要获批的胜方不同)⇒ freeze。AI(llm)能提异议冻结、不能批准(批准集不含 llm)——fail-safe。SHOULD 票: 监控 llm 噪声致虚假冻结率。
  const allVerdicts = verdicts || [];
  if (allVerdicts.some((v) => v.outcome !== 0 && v.outcome !== 1)) return { action: 'freeze', reason: 'abstain_or_dispute' };
  if (new Set(allVerdicts.map((v) => v.outcome)).size > 1) return { action: 'freeze', reason: 'inconsistent_verdicts' };
  // 赞成集(不变, N1): 仅 pmt_at 为安全整数且 ≥ outcome_end_ms 的 extractor / uma verdict 计入一致性与被引用
  const eligible = allVerdicts.filter((v) => AUTO_KINDS.includes(v.source_kind) && Number.isSafeInteger(v.pmt_at) && v.pmt_at >= oe)
    .sort((a, b) => (a.pmt_at - b.pmt_at) || (a.id - b.id));
  const kinds = new Set();
  let consistencyMetAt = null, metVerdict = null;
  for (const v of eligible) { kinds.add(v.source_kind); if (kinds.size >= 2) { consistencyMetAt = v.pmt_at; metVerdict = v; break; } }   // N1: 行推, 不存列
  if (consistencyMetAt === null) return { action: 'wait', reason: 'awaiting_second_source' };
  const upperMs = cutoff - consistencyMetAt - cfg.closePipelineMarginMs;                           // N6
  if (upperMs < cfg.graceMinMs) return { action: 'freeze', reason: 'late_seal', upperMs };
  const effectiveGraceMs = Math.min(cfg.graceMs, upperMs);
  if (now < consistencyMetAt + effectiveGraceMs) return { action: 'wait', reason: 'in_grace', graceEndsAtPmt: consistencyMetAt + effectiveGraceMs, effectiveGraceMs };
  // §1.6 R5 预检: 胜方侧恰 1 条已确认下注 ∧ 奖池 > 0
  const winningSide = eligible[0].outcome;
  const confirmed = (bets || []).filter((b) => b.status === 'confirmed');
  const winnerBets = confirmed.filter((b) => b.side === winningSide);
  const pool = confirmed.reduce((a, b) => a + Number(b.stake || 0), 0);
  if (winnerBets.length !== 1 || !(pool > 0)) return { action: 'freeze', reason: 'r5_precheck_failed', winnerBets: winnerBets.length, pool };
  const ref = eligible.find((v) => v.source_kind === 'extractor') || metVerdict;                    // 引用确定性最高的一条: extractor 优先
  return { action: 'promote', winningSide, source: ref.source_kind, verdictId: ref.id, consistencyMetAt, effectiveGraceMs };
}

/** promote 的 UPDATE 语句(批 B 用): 谓词与触发器双保险——sealed ∧ 未判 ∧ 未冻结同语句校验(D2); changes==0 ⇒ 已判 / 已冻 / 非 sealed, 停。 */
export const PROMOTE_UPDATE_SQL = "UPDATE proto_markets SET winning_side = ?, winning_side_source = ?, winning_side_set_at = ?, winning_side_verdict_id = ?, updated_at = ? WHERE id = ? AND status = 'sealed' AND winning_side IS NULL AND settlement_frozen_at IS NULL";
