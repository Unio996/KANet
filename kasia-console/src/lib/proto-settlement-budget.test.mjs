// proto-settlement-budget.test.mjs — oracle 整合批 D: 预算常量 / pmt 有效性 / 冻结时钟 / 晚 seal / 受理门 / promote 门 的纯逻辑测试(N1–N6 各边界)。
// 设计 docs/2026-09-20-bettor-oracle-batchD-grace-refundflip-budget-design-v0.1.md v0.3。零 DB / 零 IO / 零链。Run: cd kasia-console && node src/lib/proto-settlement-budget.test.mjs
import assert from 'node:assert/strict';
import {
  DEFAULTS, SAFETY_RANGE_MS, ENV_NAMES, BudgetConfigError, resolveBudgetConfig, promotionCutoffPmt, createPmtValidator, readValidatedPmt, sharedPmtValidator, resetSharedPmtValidatorState,
  chooseFreezeClock, frozenReasonText, evaluateLateSeal, intakeNeedsPmt, evaluateBetIntakeGate, evaluatePromoteGate, PROMOTE_UPDATE_SQL,
} from './proto-settlement-budget.mjs';
import { REFUND_FLIP_GRACE_MS } from './proto-close-commit-gate.mjs';
import { JUDGED_COLUMNS, judgedSqlPredicate, isJudgedMarket } from '../db/proto-judged.mjs';

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const TICK = 20_000;
const cfg = resolveBudgetConfig({}, { tickMs: TICK }).config;
const D = 10_000_000_000_000;                                 // covenant deadline_ms
const CUTOFF = D + REFUND_FLIP_GRACE_MS - cfg.promotionSafetyMs;   // = D + 6,000,000
const OE = D - 3_600_000;                                     // outcome_end_ms

// ══ C 系列: 常量 + 启动校验(N2) ═══════════════════════════════════════════════════════════════
await t('C1 默认值 = 设计 §2(SAFETY 20min / GRACE 30min / GRACE_MIN 5min / LAG_MAX 10min / MARGIN 2min); cutoff = deadline + 7,200,000 − SAFETY(= deadline + 100min)', () => {
  assert.deepEqual({ ...cfg }, { promotionSafetyMs: 1_200_000, graceMs: 1_800_000, graceMinMs: 300_000, lagMaxMs: 600_000, closePipelineMarginMs: 120_000, tickMs: TICK });
  assert.equal(REFUND_FLIP_GRACE_MS, 7_200_000); assert.equal(CUTOFF, D + 6_000_000); assert.equal(promotionCutoffPmt(D, cfg), CUTOFF);
  assert.throws(() => promotionCutoffPmt(0, cfg), RangeError); assert.throws(() => promotionCutoffPmt(1.5, cfg), RangeError); assert.throws(() => promotionCutoffPmt('x', cfg), RangeError);
  assert.equal(resolveBudgetConfig({}, { tickMs: TICK }).warnings.length, 0);
});
await t('C2 env 覆盖: 合法值生效; 非正整数 / 越区间 ⇒ 回默认 + LOUD warning(不静默)', () => {
  const ok = resolveBudgetConfig({ [ENV_NAMES.PROMOTION_SAFETY_MS]: '1500000', [ENV_NAMES.GRACE_MS]: '900000', [ENV_NAMES.GRACE_MIN_MS]: '120000', [ENV_NAMES.LAG_MAX_MS]: '300000', [ENV_NAMES.CLOSE_PIPELINE_MARGIN_MS]: '60000' }, { tickMs: TICK });
  assert.equal(ok.warnings.length, 0); assert.deepEqual({ ...ok.config }, { promotionSafetyMs: 1_500_000, graceMs: 900_000, graceMinMs: 120_000, lagMaxMs: 300_000, closePipelineMarginMs: 60_000, tickMs: TICK });
  for (const bad of ['abc', '-1', '0', '1.5', ' ']) { const r = resolveBudgetConfig({ [ENV_NAMES.GRACE_MS]: bad }, { tickMs: TICK }); assert.equal(r.config.graceMs, DEFAULTS.GRACE_MS, bad); if (bad.trim()) assert.equal(r.warnings.length, 1, bad); }
  const lo = resolveBudgetConfig({ [ENV_NAMES.LAG_MAX_MS]: '59999' }, { tickMs: TICK }); assert.equal(lo.config.lagMaxMs, DEFAULTS.LAG_MAX_MS); assert.equal(lo.warnings.length, 1);
  const hi = resolveBudgetConfig({ [ENV_NAMES.LAG_MAX_MS]: '1800001' }, { tickMs: TICK }); assert.equal(hi.config.lagMaxMs, DEFAULTS.LAG_MAX_MS);
  const gm = resolveBudgetConfig({ [ENV_NAMES.GRACE_MS]: '120000', [ENV_NAMES.GRACE_MIN_MS]: '300000' }, { tickMs: TICK }); assert.equal(gm.config.graceMs, DEFAULTS.GRACE_MS); assert.equal(gm.config.graceMinMs, DEFAULTS.GRACE_MIN_MS); assert.equal(gm.warnings.length, 1, 'GRACE_MIN > GRACE ⇒ 两者回默认 + warning');
  assert.throws(() => resolveBudgetConfig({}, { tickMs: 0 }), BudgetConfigError); assert.throws(() => resolveBudgetConfig({}, {}), BudgetConfigError);
});
await t('C3 ▲ N2 SAFETY 边界: 区间 [15min, 60min] 两端各 ±1; 动态下界 SAFETY ≥ LAG_MAX + MARGIN + tick(恰等接受 / 差 1 拒); 违则回默认 + warning; 默认也过不了 ⇒ 抛(拒启动)', () => {
  const S = ENV_NAMES.PROMOTION_SAFETY_MS;
  assert.equal(resolveBudgetConfig({ [S]: String(SAFETY_RANGE_MS.min) }, { tickMs: TICK }).config.promotionSafetyMs, SAFETY_RANGE_MS.min, '15min 恰好接受');
  assert.equal(resolveBudgetConfig({ [S]: String(SAFETY_RANGE_MS.max) }, { tickMs: TICK }).config.promotionSafetyMs, SAFETY_RANGE_MS.max, '60min 恰好接受');
  for (const bad of [SAFETY_RANGE_MS.min - 1, SAFETY_RANGE_MS.max + 1]) { const r = resolveBudgetConfig({ [S]: String(bad) }, { tickMs: TICK }); assert.equal(r.config.promotionSafetyMs, DEFAULTS.PROMOTION_SAFETY_MS, String(bad)); assert.equal(r.warnings.length, 1); }
  // 动态下界: LAG_MAX 1,000,000 + MARGIN 200,000 + tick 100,000 = 1,300,000 > 默认 1,200,000
  const base = { [ENV_NAMES.LAG_MAX_MS]: '1000000', [ENV_NAMES.CLOSE_PIPELINE_MARGIN_MS]: '200000' };
  assert.equal(resolveBudgetConfig({ ...base, [S]: '1300000' }, { tickMs: 100_000 }).config.promotionSafetyMs, 1_300_000, '恰等于下界 ⇒ 接受');
  assert.throws(() => resolveBudgetConfig({ ...base, [S]: '1299999' }, { tickMs: 100_000 }), BudgetConfigError, '差 1 ⇒ 回默认 1.2M, 默认也 < 下界 1.3M ⇒ 抛');
  // 下界只压 env 值(默认足够大)⇒ 回默认 + warning 而不抛: LAG_MAX 700,000 + MARGIN 120,000 + tick 20,000 = 840,000 < 15min 下界 ⇒ 下界取 900,000
  const r = resolveBudgetConfig({ [ENV_NAMES.LAG_MAX_MS]: '700000', [S]: '899999' }, { tickMs: TICK }); assert.equal(r.config.promotionSafetyMs, DEFAULTS.PROMOTION_SAFETY_MS); assert.equal(r.warnings.length, 1);
  // 极端: tick / LAG_MAX / MARGIN 全拉满, 默认 SAFETY 也压不住 ⇒ 抛
  assert.throws(() => resolveBudgetConfig({ [ENV_NAMES.LAG_MAX_MS]: '1800000', [ENV_NAMES.CLOSE_PIPELINE_MARGIN_MS]: '1800000' }, { tickMs: 60_000 }), /拒绝启动/);
  // 变异防线: tick 进入下界公式(tick 大到把下界推过默认)
  assert.throws(() => resolveBudgetConfig({}, { tickMs: 600_000 }), BudgetConfigError, 'LAG_MAX 600000 + MARGIN 120000 + tick 600000 = 1,320,000 > 默认 1.2M ⇒ 抛');
});

// ══ P 系列: pmt 有效性(§5) ═══════════════════════════════════════════════════════════════════
const NOW = 1_790_000_000_000;
await t('P1 pmt 有效 ⇔ isSynced===true ∧ |读取墙钟 − pmt| ≤ LAG_MAX ∧ 单调不减: 三个条件各自破坏; 边界 skew == LAG_MAX 有效 / +1 无效(落后与超前两个方向)', () => {
  const mk = () => createPmtValidator({ lagMaxMs: 600_000, now: () => NOW });
  for (const bad of [false, null, undefined, 'true', 1, 0]) assert.deepEqual(mk().validate({ pmtMs: NOW - 140_000, isSynced: bad }), { valid: false, reason: 'not_synced' }, String(bad));
  assert.equal(mk().validate({ pmtMs: NOW - 140_000, isSynced: true }).valid, true);
  assert.equal(mk().validate({ pmtMs: NOW - 600_000, isSynced: true }).valid, true, '落后恰 LAG_MAX ⇒ 有效');
  assert.equal(mk().validate({ pmtMs: NOW - 600_001, isSynced: true }).reason, 'pmt_wall_skew_exceeds_lag_max');
  assert.equal(mk().validate({ pmtMs: NOW + 600_000, isSynced: true }).valid, true, '超前恰 LAG_MAX ⇒ 有效(绝对值)'); assert.equal(mk().validate({ pmtMs: NOW + 600_001, isSynced: true }).valid, false);
  for (const bad of [0, -1, 1.5, NaN, undefined, null, '1', 2 ** 60]) assert.equal(mk().validate({ pmtMs: bad, isSynced: true }).valid, false, String(bad));
  const v = mk(); assert.equal(v.validate({ pmtMs: NOW - 100_000, isSynced: true }).valid, true);
  assert.equal(v.validate({ pmtMs: NOW - 100_000, isSynced: true }).valid, true, '相等 ⇒ 单调不减 ⇒ 有效');
  assert.deepEqual(v.validate({ pmtMs: NOW - 100_001, isSynced: true }), { valid: false, reason: 'pmt_regressed', lastMs: NOW - 100_000 }, '回退 1ms ⇒ 无效');
  assert.equal(v.peekLast(), NOW - 100_000, '无效读数不动基线'); v.reset(); assert.equal(v.peekLast(), null);
  assert.equal(v.validate({ pmtMs: NOW - 200_000, isSynced: true }).valid, true, '重置(=重启)后无基线, 第一次有效读数建立基线');
  assert.equal(createPmtValidator({ lagMaxMs: 600_000, now: () => NOW }).validate({ pmtMs: NOW - 700_000, isSynced: true, observedAtMs: NOW - 200_000 }).valid, true, '优先用 relay 的 observedAtMs 作读取时墙钟');
  assert.throws(() => createPmtValidator({ lagMaxMs: 0 }), TypeError);
});
await t('P2 readValidatedPmt: 缺 isSynced(旧 relay)⇒ is_synced_missing(fail-closed); relay 抛错 / ok:false ⇒ read_failed; 永不抛; 有效读数过校验器; 共享单例首次按 lagMax 建', async () => {
  const validator = createPmtValidator({ lagMaxMs: 600_000, now: () => NOW });
  const rd = (r) => readValidatedPmt({ sendCmd: async () => { if (r instanceof Error) throw r; return r; }, relayId: 'r', validator });
  assert.equal((await rd({ ok: true, pastMedianTimeMs: NOW - 140_000, observedAtMs: NOW })).reason, 'is_synced_missing');
  for (const bad of ['true', 1, null, undefined]) assert.equal((await rd({ ok: true, pastMedianTimeMs: NOW - 140_000, observedAtMs: NOW, isSynced: bad })).reason, 'is_synced_missing', String(bad));
  assert.equal((await rd(new Error('ipc timeout'))).reason, 'read_failed'); assert.equal((await rd({ ok: false })).reason, 'read_failed'); assert.equal((await rd(null)).reason, 'read_failed');
  assert.equal((await rd({ ok: true, pastMedianTimeMs: NOW - 140_000, observedAtMs: NOW, isSynced: false })).reason, 'not_synced');
  assert.deepEqual(await rd({ ok: true, pastMedianTimeMs: NOW - 140_000, observedAtMs: NOW, isSynced: true }), { valid: true, pmtMs: NOW - 140_000, observedAtMs: NOW });
  resetSharedPmtValidatorState(); const a = sharedPmtValidator(600_000), b = sharedPmtValidator(1); assert.equal(a, b, '单例'); resetSharedPmtValidatorState(); assert.notEqual(sharedPmtValidator(600_000), a);
});

// ══ F 系列: 冻结时钟(N5a) ═════════════════════════════════════════════════════════════════════
await t('F1 ▲ N5a 冻结写入不依赖 pmt 有效: pmt 有效写 pmt(clock=pmt); 无效 / null / 读失败 一律退墙钟(clock=wall); frozen_reason 恒非空且带 clock 标; 墙钟也非法才抛', () => {
  assert.deepEqual(chooseFreezeClock({ pmt: { valid: true, pmtMs: 123 }, wallMs: 999 }), { at: 123, clock: 'pmt' });
  for (const pmt of [null, undefined, { valid: false, reason: 'not_synced' }, { valid: false, pmtMs: 123 }, { valid: true }, { valid: true, pmtMs: 0 }, { valid: true, pmtMs: 1.5 }]) assert.deepEqual(chooseFreezeClock({ pmt, wallMs: 999 }), { at: 999, clock: 'wall' }, JSON.stringify(pmt));
  assert.throws(() => chooseFreezeClock({ pmt: null, wallMs: 0 }), RangeError); assert.throws(() => chooseFreezeClock({ pmt: null, wallMs: NaN }), RangeError);
  assert.equal(frozenReasonText('late_seal', 'wall'), 'late_seal|clock=wall'); assert.equal(frozenReasonText('past_cutoff', 'pmt'), 'past_cutoff|clock=pmt');
  for (const bad of ['', 'Late Seal', 'late-seal', 'x|clock=wall', null, undefined]) assert.throws(() => frozenReasonText(bad, 'pmt'), RangeError, String(bad));
  assert.throws(() => frozenReasonText('a', 'clock'), RangeError);
});

// ══ L 系列: 晚 seal(§4 / N6) ═════════════════════════════════════════════════════════════════
await t('L1 ▲ N6 晚 seal 边界: effective_upper = cutoff − 决策时刻 − MARGIN; upper = GRACE_MIN−1 ⇒ late; = GRACE_MIN ⇒ 不 late; 之间 / 之上不 late; 决策时刻越过 cutoff ⇒ upper 为负 ⇒ late', () => {
  const at = (upper) => CUTOFF - cfg.closePipelineMarginMs - upper;      // 令 upper 恰为给定值的决策时刻
  const r0 = evaluateLateSeal({ deadlineMs: D, decisionMs: at(cfg.graceMinMs - 1), cfg }); assert.equal(r0.late, true); assert.equal(r0.upperMs, cfg.graceMinMs - 1);
  const r1 = evaluateLateSeal({ deadlineMs: D, decisionMs: at(cfg.graceMinMs), cfg }); assert.equal(r1.late, false); assert.equal(r1.upperMs, cfg.graceMinMs);
  assert.equal(evaluateLateSeal({ deadlineMs: D, decisionMs: at(cfg.graceMinMs + 1), cfg }).late, false);
  assert.equal(evaluateLateSeal({ deadlineMs: D, decisionMs: at(cfg.graceMs), cfg }).late, false);
  assert.equal(evaluateLateSeal({ deadlineMs: D, decisionMs: CUTOFF + 1, cfg }).late, true);
  assert.equal(evaluateLateSeal({ deadlineMs: D, decisionMs: D - 10_000_000, cfg }).cutoffPmt, CUTOFF);
  assert.throws(() => evaluateLateSeal({ deadlineMs: D, decisionMs: 0, cfg }), RangeError);
});

// ══ I 系列: 受理点门(§6 / N3 / N4) ═══════════════════════════════════════════════════════════
const mkMarket = (o = {}) => ({ status: 'sealed', winning_side: null, settlement_frozen_at: null, deadline_ms: D, outcome_end_ms: OE, resolution_rule_spec: 'r', outcome_market_source: null, outcome_condition_id: null, outcome_oracle_relay_ids: null, ...o });
const plain = (o = {}) => mkMarket({ resolution_rule_spec: null, ...o });
await t('I1 判定题定义唯一来源(N3): 四个判定题列任一非 NULL(含空串)即判定题; 全 NULL / 仅 outcome_end_ms 不算; 缺列 ⇒ 抛; SQL 谓词文本与 JS 判据一致', () => {
  for (const c of JUDGED_COLUMNS) { assert.equal(isJudgedMarket(plain({ [c]: 'x' })), true, c); assert.equal(isJudgedMarket(plain({ [c]: '' })), true, c + ' 空串'); }
  assert.equal(isJudgedMarket(plain()), false); assert.equal(isJudgedMarket(plain({ outcome_end_ms: 5 })), false);
  const { resolution_rule_spec, ...missing } = plain(); assert.throws(() => isJudgedMarket(missing), /缺列/); assert.throws(() => isJudgedMarket(null), TypeError);
  assert.equal(judgedSqlPredicate('NEW'), '(NEW.resolution_rule_spec IS NOT NULL OR NEW.outcome_market_source IS NOT NULL OR NEW.outcome_condition_id IS NOT NULL OR NEW.outcome_oracle_relay_ids IS NOT NULL)');
  assert.throws(() => judgedSqlPredicate('x; DROP'), TypeError);
});
await t('I2 ▲ 受理门矩阵: 无判定题 ⇒ 豁免(pmt 缺失也放行, 且 intakeNeedsPmt=false); 判定题 ∧ outcome_end 空 / NaN / 字符串 ⇒ 409 outcome_end_missing(不需要 pmt); 判定题 ∧ pmt 无效 / 缺失 ⇒ 503 fail-closed; pmt ≥ outcome_end ⇒ 409(恰等于也拒); pmt = outcome_end−1 ⇒ 受理', () => {
  assert.deepEqual(evaluateBetIntakeGate({ market: plain(), pmt: null }), { accept: true, code: 'not_judged_exempt' }); assert.equal(intakeNeedsPmt(plain()), false);
  assert.equal(evaluateBetIntakeGate({ market: plain({ outcome_end_ms: null }) }).accept, true, '无判定题 ∧ outcome_end 空也豁免');
  for (const bad of [null, undefined, NaN, Infinity, '123', {}]) { const m = mkMarket({ outcome_end_ms: bad }); const g = evaluateBetIntakeGate({ market: m, pmt: { valid: true, pmtMs: 1 } }); assert.deepEqual([g.accept, g.code, g.http], [false, 'outcome_end_missing', 409], String(bad)); assert.equal(intakeNeedsPmt(m), false); }
  assert.equal(intakeNeedsPmt(mkMarket()), true);
  for (const pmt of [null, undefined, { valid: false, reason: 'not_synced' }, { valid: false }, {}, { pmtMs: 1 }]) { const g = evaluateBetIntakeGate({ market: mkMarket(), pmt }); assert.deepEqual([g.accept, g.code, g.http], [false, 'pmt_unavailable_fail_closed', 503], JSON.stringify(pmt)); }
  const g1 = evaluateBetIntakeGate({ market: mkMarket(), pmt: { valid: true, pmtMs: OE } }); assert.deepEqual([g1.accept, g1.code, g1.http], [false, 'outcome_end_passed', 409]);
  assert.equal(evaluateBetIntakeGate({ market: mkMarket(), pmt: { valid: true, pmtMs: OE + 1 } }).accept, false);
  assert.deepEqual(evaluateBetIntakeGate({ market: mkMarket(), pmt: { valid: true, pmtMs: OE - 1 } }), { accept: true, code: 'ok' });
  for (const c of JUDGED_COLUMNS) assert.equal(evaluateBetIntakeGate({ market: plain({ [c]: 'x' }), pmt: { valid: true, pmtMs: OE } }).accept, false, c + ' 单独即判定题');
});

// ══ G 系列: promote 门(§1 六前置 + N1/N3/N6) ═════════════════════════════════════════════════
const V = (id, kind, outcome, pmt_at) => ({ id, source_kind: kind, outcome, pmt_at });
const BETS = [{ side: 0, status: 'confirmed', stake: 100 }, { side: 1, status: 'confirmed', stake: 900 }];
const CMA_OK = OE + 60_000;                                   // 两源一致时刻(远早于 cutoff)
const GOOD = [V(1, 'extractor', 1, CMA_OK - 1000), V(2, 'uma', 1, CMA_OK)];
const pm = (n) => ({ valid: true, pmtMs: n });
const gate = (o = {}) => evaluatePromoteGate({ market: mkMarket(), verdicts: GOOD, bets: BETS, pmt: pm(CMA_OK + cfg.graceMs), wallMs: CMA_OK + cfg.graceMs + 140_000, cfg, ...o });
await t('G1 快乐路径: 六前置全过 ⇒ promote{winningSide, source(extractor 优先), verdictId, consistencyMetAt, effectiveGraceMs=GRACE_MS}', () => {
  const r = gate(); assert.equal(r.action, 'promote'); assert.equal(r.winningSide, 1); assert.equal(r.source, 'extractor'); assert.equal(r.verdictId, 1); assert.equal(r.consistencyMetAt, CMA_OK); assert.equal(r.effectiveGraceMs, cfg.graceMs);
  const onlyUmaFirst = gate({ verdicts: [V(2, 'uma', 1, CMA_OK - 1000), V(1, 'extractor', 1, CMA_OK)] }); assert.equal(onlyUmaFirst.source, 'extractor', '两源一致时引用 extractor 那条(与到达顺序无关)'); assert.equal(onlyUmaFirst.consistencyMetAt, CMA_OK, 'consistency_met_at = 第二个源(使≥2 源一致首次成立)那条的 pmt_at');
});
await t('G2 前置 1: 已冻 / 已判 / 无判定题 ⇒ stop; 非 sealed ⇒ wait; 各自优先于其余检查(冻结优先于已判)', () => {
  assert.deepEqual([gate({ market: mkMarket({ settlement_frozen_at: 1 }) }).action, gate({ market: mkMarket({ settlement_frozen_at: 1 }) }).reason], ['stop', 'already_frozen']);
  assert.equal(gate({ market: mkMarket({ winning_side: 0 }) }).reason, 'already_decided'); assert.equal(gate({ market: mkMarket({ settlement_frozen_at: 5, winning_side: 0 }) }).reason, 'already_frozen');
  assert.equal(gate({ market: plain() }).reason, 'not_judged');
  for (const st of ['betting', 'resolved', 'cancelled', 'genesis_pending']) assert.deepEqual([gate({ market: mkMarket({ status: st }) }).action, gate({ market: mkMarket({ status: st }) }).reason], ['wait', 'not_sealed'], st);
  assert.equal(gate({ mode: 'human' }).reason, 'mode_not_supported_in_batch_D');
});
await t('G3 ▲ N3 outcome_end: 判定题 ∧ 空 / 非有限 / 非数字 ⇒ reject(拒 promote + 记因, 不冻结); deadline 非法 ⇒ reject', () => {
  for (const bad of [null, undefined, NaN, '1', {}]) { const r = gate({ market: mkMarket({ outcome_end_ms: bad }) }); assert.deepEqual([r.action, r.reason], ['reject', 'outcome_end_missing'], String(bad)); }
  for (const bad of [0, -1, null, 1.5, '1']) assert.deepEqual([gate({ market: mkMarket({ deadline_ms: bad }) }).action, gate({ market: mkMarket({ deadline_ms: bad }) }).reason], ['reject', 'deadline_invalid'], String(bad));
});
await t('G4 ▲ 前置 3 cutoff 边界(N2): pmt = cutoff−1 ⇒ 仍可 promote; pmt = cutoff ⇒ freeze(past_cutoff); pmt > cutoff ⇒ freeze——且过 cutoff 优先于 结果未知 / 不一致 / 缺第二源(一律冻结, 方向安全)', () => {
  const base = { verdicts: [V(1, 'extractor', 1, OE + 1), V(2, 'uma', 1, OE + 2)] };
  assert.equal(gate({ ...base, pmt: pm(CUTOFF - 1) }).action, 'promote', 'cma 极早, 宽限窗早已满 ⇒ cutoff−1 仍 promote');
  assert.deepEqual([gate({ ...base, pmt: pm(CUTOFF) }).action, gate({ ...base, pmt: pm(CUTOFF) }).reason], ['freeze', 'past_cutoff']);
  assert.equal(gate({ ...base, pmt: pm(CUTOFF + 5) }).reason, 'past_cutoff');
  for (const v of [[], [V(1, 'extractor', 1, OE + 1)], [V(1, 'extractor', 1, OE + 1), V(2, 'uma', 0, OE + 2)], [V(1, 'extractor', null, OE + 1)]]) assert.equal(gate({ verdicts: v, pmt: pm(CUTOFF) }).reason, 'past_cutoff');
  assert.equal(gate({ market: mkMarket({ outcome_end_ms: CUTOFF + 10 }), pmt: pm(CUTOFF) }).reason, 'past_cutoff', 'pmt ≥ cutoff 也先于"结果未知"');
});
await t('G5 ▲ 前置 2 结果已知(N1): pmt < outcome_end ⇒ wait(outcome_not_known); pmt = outcome_end 起可继续; verdict.pmt_at < outcome_end / NULL / 非整数 ⇒ 不计入(既不构成一致, 也不触发不一致 / 弃权冻结)', () => {
  assert.deepEqual([gate({ pmt: pm(OE - 1) }).action, gate({ pmt: pm(OE - 1) }).reason], ['wait', 'outcome_not_known']);
  assert.equal(gate({ pmt: pm(OE) }).reason, 'in_grace', 'pmt = outcome_end 起越过结果未知门(此处 verdict 的 pmt_at 在 pmt 之后, 宽限窗自然未满 ⇒ in_grace)');
  const stale = [V(1, 'extractor', 1, OE - 1), V(2, 'uma', 1, OE - 1)];
  assert.deepEqual([gate({ verdicts: stale }).action, gate({ verdicts: stale }).reason], ['wait', 'awaiting_second_source'], 'pmt_at = outcome_end−1 的一致 verdict 不计入');
  for (const bad of [null, undefined, 1.5, '9', NaN, String(CMA_OK), CMA_OK + 0.5]) assert.equal(gate({ verdicts: [V(1, 'extractor', 1, CMA_OK - 1000), V(2, 'uma', 1, bad)] }).reason, 'awaiting_second_source', 'pmt_at=' + String(bad) + ' 不计入(含字符串数字 / 非整数——须是安全整数才算)');
  assert.equal(gate({ verdicts: [V(1, 'extractor', 1, OE), V(2, 'uma', 1, OE)] }).consistencyMetAt, OE, 'pmt_at = outcome_end 计入(边界含等号)');
  assert.equal(gate({ verdicts: [V(1, 'extractor', 1, CMA_OK - 1000), V(2, 'uma', 0, OE - 1), V(3, 'uma', null, null)] }).reason, 'awaiting_second_source', '不合格 verdict(哪怕不一致 / 弃权)不触发冻结, 也不计一致');
});
await t('G6 ▲ 前置 5 R2 一致: 单源 ⇒ wait; 同类型两条(extractor+extractor)不算独立来源 ⇒ wait; extractor+uma 一致 ⇒ 通过; 任一不一致 ⇒ freeze(inconsistent_verdicts); 任一 outcome NULL(弃权 / 异议)⇒ freeze(abstain_or_dispute); llm / human 不计入自动路径', () => {
  assert.equal(gate({ verdicts: [V(1, 'extractor', 1, CMA_OK)] }).reason, 'awaiting_second_source');
  assert.equal(gate({ verdicts: [V(1, 'extractor', 1, CMA_OK - 1), V(2, 'extractor', 1, CMA_OK)] }).reason, 'awaiting_second_source', '同类型不算独立来源');
  assert.equal(gate({ verdicts: [V(1, 'extractor', 1, CMA_OK - 1), V(2, 'uma', 0, CMA_OK)] }).reason, 'inconsistent_verdicts');
  assert.equal(gate({ verdicts: [V(1, 'extractor', 1, CMA_OK - 1), V(2, 'extractor', 0, CMA_OK), V(3, 'uma', 1, CMA_OK + 1)] }).reason, 'inconsistent_verdicts', '两源一致之外还有不一致的第三条 ⇒ 仍冻结("全部 extractor/uma 类一致")');
  assert.equal(gate({ verdicts: [...GOOD, V(3, 'uma', null, CMA_OK + 5)] }).reason, 'abstain_or_dispute');
  assert.equal(gate({ verdicts: [V(1, 'extractor', null, CMA_OK)] }).reason, 'abstain_or_dispute', '第二源未到时的弃权也立刻冻结');
  assert.equal(gate({ verdicts: [...GOOD, V(9, 'llm', 0, CMA_OK), V(10, 'human', 0, CMA_OK)] }).action, 'promote', 'llm / human 的不同意见不影响自动路径');
  assert.equal(gate({ verdicts: [V(9, 'llm', 1, CMA_OK), V(10, 'human', 1, CMA_OK)] }).reason, 'awaiting_second_source', 'llm / human 不构成 ≥2 独立来源');
});
await t('G7 ▲ N6 宽限窗边界: consistency_met_at + effective_grace ≤ pmt < cutoff; pmt = 该和 −1 ⇒ wait(in_grace); = 该和 ⇒ 通过; effective_upper = GRACE_MIN−1 ⇒ freeze(late_seal); = GRACE_MIN ⇒ 不冻(eg=GRACE_MIN); 之间 ⇒ eg=upper(< GRACE_MS 时被 upper 限住); 之上 ⇒ eg=GRACE_MS', () => {
  const at = (cma, extra = {}) => ({ verdicts: [V(1, 'extractor', 1, cma - 1), V(2, 'uma', 1, cma)], ...extra });
  // 之上: eg = GRACE_MS
  let r = gate({ ...at(CMA_OK), pmt: pm(CMA_OK + cfg.graceMs - 1) }); assert.deepEqual([r.action, r.reason, r.graceEndsAtPmt], ['wait', 'in_grace', CMA_OK + cfg.graceMs]);
  assert.equal(gate({ ...at(CMA_OK), pmt: pm(CMA_OK + cfg.graceMs) }).action, 'promote');
  // 之间: upper = 1,000,000 < GRACE_MS ⇒ eg = 1,000,000
  const cmaMid = CUTOFF - cfg.closePipelineMarginMs - 1_000_000;
  r = gate({ ...at(cmaMid), pmt: pm(cmaMid + 1_000_000 - 1) }); assert.deepEqual([r.action, r.reason, r.effectiveGraceMs], ['wait', 'in_grace', 1_000_000]);
  r = gate({ ...at(cmaMid), pmt: pm(cmaMid + 1_000_000) }); assert.deepEqual([r.action, r.effectiveGraceMs], ['promote', 1_000_000]);
  // 上界 == GRACE_MIN: 不冻, eg = GRACE_MIN; 通过点 = cutoff − MARGIN(< cutoff)
  const cmaEdge = CUTOFF - cfg.closePipelineMarginMs - cfg.graceMinMs;
  r = gate({ ...at(cmaEdge), pmt: pm(cmaEdge + cfg.graceMinMs - 1) }); assert.deepEqual([r.action, r.reason], ['wait', 'in_grace']);
  r = gate({ ...at(cmaEdge), pmt: pm(cmaEdge + cfg.graceMinMs) }); assert.deepEqual([r.action, r.effectiveGraceMs], ['promote', cfg.graceMinMs]); assert.ok(cmaEdge + cfg.graceMinMs < CUTOFF);
  // 上界 == GRACE_MIN−1: 晚 seal 冻结(N6)
  const cmaLate = cmaEdge + 1;
  r = gate({ ...at(cmaLate), pmt: pm(cmaLate + 1) }); assert.deepEqual([r.action, r.reason, r.upperMs], ['freeze', 'late_seal', cfg.graceMinMs - 1]);
  assert.equal(gate({ ...at(cmaLate + 1_000), pmt: pm(cmaLate + 1_000) }).reason, 'late_seal');
  // promote 永远严格早于 cutoff(SAFETY 的意义): 任何 promote 结果的 pmt < cutoff − MARGIN
  for (const cma of [OE + 1, cmaMid, cmaEdge]) { const rr = gate({ ...at(cma), pmt: pm(cma + Math.min(cfg.graceMs, CUTOFF - cfg.closePipelineMarginMs - cma)) }); assert.equal(rr.action, 'promote'); }
});
await t('G8 前置 6 R5 预检: 胜方侧确认注数 0 / ≥2 / pending 不计 / 奖池 ≤ 0 ⇒ freeze(r5_precheck_failed); 恰 1 且奖池 > 0 ⇒ 通过; 胜方按 verdict 的 outcome 定(side 匹配)', () => {
  const R = (bets) => gate({ bets });
  assert.equal(R([{ side: 0, status: 'confirmed', stake: 5 }]).reason, 'r5_precheck_failed', '胜方 side=1 没有确认注');
  assert.equal(R([{ side: 1, status: 'confirmed', stake: 5 }, { side: 1, status: 'confirmed', stake: 5 }]).reason, 'r5_precheck_failed', '胜方 2 条');
  assert.equal(R([{ side: 1, status: 'pending', stake: 5 }, { side: 0, status: 'confirmed', stake: 5 }]).reason, 'r5_precheck_failed', 'pending 不计');
  assert.equal(R([{ side: 1, status: 'confirmed', stake: 0 }]).reason, 'r5_precheck_failed', '奖池 0');
  assert.equal(R([]).reason, 'r5_precheck_failed');
  assert.equal(R([{ side: 1, status: 'confirmed', stake: 1 }]).action, 'promote', '恰 1 条 ∧ 奖池 1 > 0');
  assert.equal(R([{ side: 0, status: 'confirmed', stake: 5 }, { side: 0, status: 'confirmed', stake: 5 }, { side: 1, status: 'confirmed', stake: 5 }]).action, 'promote', '败方多条不影响');
  const g0 = gate({ verdicts: [V(1, 'extractor', 0, CMA_OK - 1), V(2, 'uma', 0, CMA_OK)], bets: [{ side: 0, status: 'confirmed', stake: 5 }, { side: 1, status: 'confirmed', stake: 5 }] }); assert.deepEqual([g0.action, g0.winningSide], ['promote', 0]);
});
await t('G9 ▲ pmt 无效(D5): 未过 cutoff ⇒ wait(pmt_invalid, promote 推迟); 墙钟(≥ pmt)已过 cutoff ⇒ freeze(pmt_invalid_past_cutoff, 方向安全); 墙钟缺失按未过', () => {
  for (const pmt of [null, undefined, { valid: false, reason: 'not_synced' }, { valid: true }, { valid: true, pmtMs: 1.5 }]) {
    const w = gate({ pmt, wallMs: CUTOFF - 1 }); assert.deepEqual([w.action, w.reason], ['wait', 'pmt_invalid'], JSON.stringify(pmt));
    assert.deepEqual([gate({ pmt, wallMs: CUTOFF }).action, gate({ pmt, wallMs: CUTOFF }).reason], ['freeze', 'pmt_invalid_past_cutoff']);
  }
  assert.equal(gate({ pmt: null, wallMs: undefined }).action, 'wait'); assert.equal(gate({ pmt: null, wallMs: NaN }).action, 'wait');
});
await t('G10 PROMOTE_UPDATE_SQL: 谓词同语句带 status=sealed ∧ winning_side IS NULL ∧ settlement_frozen_at IS NULL(D2); 六个占位符', () => {
  for (const frag of ["status = 'sealed'", 'winning_side IS NULL', 'settlement_frozen_at IS NULL', 'winning_side_source = ?', 'winning_side_set_at = ?', 'winning_side_verdict_id = ?']) assert.ok(PROMOTE_UPDATE_SQL.includes(frag), frag);
  assert.equal((PROMOTE_UPDATE_SQL.match(/\?/g) || []).length, 6);
});

console.log(`\nproto-settlement-budget.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
