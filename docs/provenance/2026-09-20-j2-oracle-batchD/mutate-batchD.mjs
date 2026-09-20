// oracle 批 D——变异对照。用法(仓库根): node docs/provenance/2026-09-20-j2-oracle-batchD/mutate-batchD.mjs > mutation-raw.txt
// 两类变异: ① 源码级(改被测文件的一个片段, 跑对应测试, 必须变红, 无论如何还原并逐字校验) ② 触发器级(freeze 测试的 MUT_* 钩子: 迁移后就地 DROP / 改写触发器)。
// SURVIVED = 测试缺口; ERROR = 片段命中次数 ≠ 1(脚本错)。
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CON = path.join(ROOT, 'kasia-console'), REL = path.join(ROOT, 'kasia-relay');
const T = {
  budget: [CON, 'src/lib/proto-settlement-budget.test.mjs'], freeze: [CON, 'src/db/proto-settlement-freeze-v213.test.mjs'], store: [CON, 'src/lib/proto-settlement-store.test.mjs'],
  core: [CON, 'src/lib/proto-settlement-driver-core.test.mjs'], intake: [CON, 'src/lib/proto-bet-intake.test.mjs'], route: [CON, 'src/api/proto-bet-intake-route.test.mjs'],
  service: [CON, 'src/services/proto-settlement-driver.test.mjs'], relay: [REL, 'src/lib/utxo-facts.test.mjs'],
};
const run = (tk, env = {}) => { const [cwd, test] = T[tk]; const r = spawnSync(process.execPath, [test], { cwd, encoding: 'utf8', timeout: 400000, maxBuffer: 1 << 26, env: { ...process.env, ...env } }); const out = (r.stdout || '') + (r.stderr || ''); return { status: r.status, last: out.match(/\d+ passed, \d+ (?:failed|fail)/)?.[0] || (/ALL PASS/.test(out) ? 'ALL PASS' : '?'), err: /MUTATION ERROR/.test(out) ? out.match(/MUTATION ERROR[^\n]*/)[0] : null }; };
const M = [];
const S = (id, file, from, to, tk, why) => M.push({ kind: 'src', id, file, from, to, tk, why });
const TR = (id, trig, from, to, why) => M.push({ kind: 'trig', id, trig, from, to, tk: 'freeze', why });
const B = 'kasia-console/src/lib/proto-settlement-budget.mjs', FR = 'kasia-console/src/lib/proto-settlement-freeze.mjs', ST = 'kasia-console/src/lib/proto-settlement-store.mjs', CO = 'kasia-console/src/lib/proto-settlement-driver-core.mjs';
const IN = 'kasia-console/src/lib/proto-bet-intake.mjs', SV = 'kasia-console/src/services/proto-settlement-driver.mjs', RT = 'kasia-console/src/api/proto.js', JD = 'kasia-console/src/db/proto-judged.mjs', RL = 'kasia-relay/src/lib/utxo-facts.mjs';
// ── budget.mjs ──
S('B01', B, 'PROMOTION_SAFETY_MS: 1_200_000,', 'PROMOTION_SAFETY_MS: 1_000_000,', 'budget', '默认 SAFETY 改动');
S('B02', B, 'GRACE_MS: 1_800_000,', 'GRACE_MS: 1_700_000,', 'budget', '默认 GRACE 改动');
S('B03', B, 'lagMaxMs + marginMs + tickMs);', 'lagMaxMs + marginMs);', 'budget', 'N2 动态下界漏掉 tick');
S('B04', B, 'if (safetyMs < safetyFloor) {', 'if (safetyMs <= safetyFloor) {', 'budget', 'N2 下界恰等也拒(边界)');
S('B05', B, 'if (v < lo || v > hi) {', 'if (v < lo || v >= hi) {', 'budget', '区间上端恰好也拒');
S('B06', B, "if (isSynced !== true) return", "if (isSynced === false) return", 'budget', 'isSynced 只拒显式 false(null / undefined 放行)');
S('B07', B, 'Math.abs(wall - pmtMs) > lagMaxMs', 'Math.abs(wall - pmtMs) >= lagMaxMs', 'budget', 'skew 恰 LAG_MAX 也拒(边界)');
S('B08', B, 'Math.abs(wall - pmtMs) > lagMaxMs', '(wall - pmtMs) > lagMaxMs', 'budget', 'pmt 超前墙钟不检查');
S('B09', B, 'if (last !== null && pmtMs < last)', 'if (last !== null && pmtMs <= last)', 'budget', '单调: 相等也拒(边界)');
S('B10', B, '      last = pmtMs;\n      return { valid: true', '      return { valid: true', 'budget', '不更新单调基线');
S('B11', B, "if (typeof r.isSynced !== 'boolean') return", 'if (false) return', 'budget', '缺 isSynced 放行');
S('B12', B, 'if (pmt && pmt.valid === true && Number.isSafeInteger(pmt.pmtMs) && pmt.pmtMs > 0)', 'if (pmt && Number.isSafeInteger(pmt.pmtMs) && pmt.pmtMs > 0)', 'budget', '冻结时钟不看 valid 标志(无效 pmt 也写 pmt)');
S('B13', B, "if (clock !== 'pmt' && clock !== 'wall') throw", 'if (false) throw', 'budget', 'frozen_reason 不校验 clock 标');
S('B14', B, 'return { late: upperMs < cfg.graceMinMs,', 'return { late: upperMs <= cfg.graceMinMs,', 'budget', '晚 seal 边界 <= (N6)');
S('B15', B, 'const upperMs = cutoff - decisionMs - cfg.closePipelineMarginMs;', 'const upperMs = cutoff - decisionMs;', 'budget', '晚 seal 漏掉 MARGIN');
S('B16', B, 'return deadlineMs + REFUND_FLIP_GRACE_MS - cfg.promotionSafetyMs;', 'return deadlineMs + REFUND_FLIP_GRACE_MS;', 'budget', 'cutoff 漏掉 SAFETY');
S('B17', B, 'if (pmt.pmtMs >= market.outcome_end_ms) return', 'if (pmt.pmtMs > market.outcome_end_ms) return', 'budget', '受理门: pmt 恰等 outcome_end 仍受理(边界)');
S('B18', B, "if (!isJudgedMarket(market)) return { accept: true, code: 'not_judged_exempt' };", '', 'budget', '受理门无豁免');
S('B19', B, 'if (!pmt || pmt.valid !== true) return { accept: false, code: \'pmt_unavailable_fail_closed\'', 'if (!pmt) return { accept: false, code: \'pmt_unavailable_fail_closed\'', 'budget', '受理门: pmt.valid=false 不拒(fail-open)');
S('B20', B, "if (!isFiniteNum(market.outcome_end_ms)) return { accept: false, code: 'outcome_end_missing', http: 409", "if (market.outcome_end_ms == null) return { accept: false, code: 'outcome_end_missing', http: 409", 'budget', '受理门: NaN / 字符串 outcome_end 放行(N3 isFinite)');
S('B21', B, 'if (now >= cutoff) return { action: \'freeze\'', 'if (now > cutoff) return { action: \'freeze\'', 'budget', 'promote 门 cutoff 边界(恰等仍放行)');
S('B22', B, 'if (now < oe) return { action: \'wait\', reason: \'outcome_not_known\' };', 'if (now <= oe) return { action: \'wait\', reason: \'outcome_not_known\' };', 'budget', '结果已知边界');
S('B23', B, 'Number.isSafeInteger(v.pmt_at) && v.pmt_at >= oe)', 'Number.isSafeInteger(v.pmt_at) && v.pmt_at > oe)', 'budget', 'verdict.pmt_at 恰等 outcome_end 不计(边界)');
S('B24', B, 'Number.isSafeInteger(v.pmt_at) && v.pmt_at >= oe)', 'v.pmt_at >= oe)', 'budget', 'NULL / 非整数 pmt_at 计入(N1)');
S('B25', B, 'if (upperMs < cfg.graceMinMs) return { action: \'freeze\', reason: \'late_seal\'', 'if (upperMs <= cfg.graceMinMs) return { action: \'freeze\', reason: \'late_seal\'', 'budget', 'promote 门晚 seal 边界(N6)');
S('B26', B, 'const effectiveGraceMs = Math.min(cfg.graceMs, upperMs);', 'const effectiveGraceMs = cfg.graceMs;', 'budget', 'effective_grace 不受 upper 限制(N6)');
S('B27', B, 'if (now < consistencyMetAt + effectiveGraceMs) return', 'if (now <= consistencyMetAt + effectiveGraceMs) return', 'budget', '宽限窗边界(恰满不放行)');
S('B28', B, 'if (kinds.size >= 2)', 'if (kinds.size >= 1)', 'budget', '单源即算一致(R2)');
S('B29', B, 'if (outcomes.size > 1) return', 'if (outcomes.size > 2) return', 'budget', '不一致不冻');
S('B30', B, "if (eligible.some((v) => v.outcome === null || v.outcome === undefined)) return", 'if (false) return', 'budget', '弃权 / 异议不冻');
S('B31', B, 'if (winnerBets.length !== 1 || !(pool > 0))', 'if (winnerBets.length < 1 || !(pool > 0))', 'budget', 'R5: 胜方多条也放行');
S('B32', B, 'if (winnerBets.length !== 1 || !(pool > 0))', 'if (winnerBets.length !== 1)', 'budget', 'R5: 不查奖池 > 0');
S('B33', B, "if (market.settlement_frozen_at !== null && market.settlement_frozen_at !== undefined) return { action: 'stop', reason: 'already_frozen' };", '', 'budget', 'promote 门不检查已冻结');
S('B34', B, "if (!isJudgedMarket(market)) return { action: 'stop', reason: 'not_judged' };", '', 'budget', 'promote 门不检查判定题');
S('B35', B, 'wallMs >= cutoff) return', 'wallMs > cutoff) return', 'budget', 'pmt 无效 ∧ 墙钟恰 cutoff: 不冻(边界)');
S('B36', B, "const AUTO_KINDS = Object.freeze(['extractor', 'uma']);", "const AUTO_KINDS = Object.freeze(['extractor', 'uma', 'llm']);", 'budget', 'llm 判定计入自动路径');
S('B37', B, 'const ref = eligible.find((v) => v.source_kind === \'extractor\') || metVerdict;', 'const ref = metVerdict;', 'budget', '不优先引用 extractor');
S('B38', B, ' AND settlement_frozen_at IS NULL";', '";', 'budget', 'promote UPDATE 谓词漏冻结条件(D2)');
S('B39', B, "if (market.status !== 'sealed') return { action: 'wait', reason: 'not_sealed' };", '', 'budget', 'promote 门不检查 sealed');
S('B40', B, "if (market.winning_side !== null && market.winning_side !== undefined) return { action: 'stop', reason: 'already_decided' };", '', 'budget', 'promote 门不检查已判');
// ── freeze.mjs ──
S('F01', FR, 'WHERE id = ? AND settlement_frozen_at IS NULL\'', 'WHERE id = ?\'', 'freeze', '二次冻结覆盖首次(去掉 IS NULL 守卫; 触发器兜底也应报错)');
S('F02', FR, "if (!isJudgedMarket(m)) return { applied: false, reason: 'not_judged' };", '', 'freeze', '晚 seal 守卫不区分判定题(operator 市场也被冻)');
S('F03', FR, 'if (!v.late) return', 'if (false) return', 'freeze', '晚 seal 守卫不判 late 一律冻');
S('F04', FR, 'const decisionMs = pmt && pmt.valid === true ? pmt.pmtMs : wall;', 'const decisionMs = wall;', 'freeze', '守卫不用 pmt(永远墙钟)');
S('F05', FR, 'try { pmt = await readPmt(); } catch { pmt = null; }', 'pmt = await readPmt();', 'freeze', 'readPmt 抛错 ⇒ 守卫放弃而不是退墙钟');
S('F06', FR, "if (m.settlement_frozen_at != null) return { applied: false, reason: 'already_frozen' };", '', 'freeze', '守卫不看已冻');
S('F07', FR, "if (!r) throw new Error(`isMarketFrozen: 市场 ${marketId} 不存在(fail-closed)`);", 'if (!r) return false;', 'freeze', '市场不存在按未冻(fail-open)');
S('F08', FR, "decision.action !== 'promote'", 'false', 'freeze', 'promote 写值不校验决定');
S('F09', FR, "if (m.winning_side != null) return { applied: false, reason: 'already_decided' };", '', 'freeze', '守卫不看已判');
// ── store / core ──
S('T01', ST, '        AND m.settlement_frozen_at IS NULL   -- 批 D D1 入口①', '        -- (mutated)   -- 批 D D1 入口①', 'store', 'listWork 选行不排除冻结(入口①)');
S('T02', ST, "if (m.settlement_frozen_at !== null && m.settlement_frozen_at !== undefined) return { ok: false, reason: 'settlement_frozen' };", '', 'store', 'dependenciesLanded 不重读冻结(入口②)');
S('T03', ST, 'const isSettlementFrozen = async (marketId) => isMarketFrozen(db, marketId);', 'const isSettlementFrozen = async (marketId) => false;', 'store', '冻结端口恒 false');
S('K01', CO, 'if (frozen !== false) {', 'if (frozen === true) {', 'core', '入口③非严格 fail-closed(只拦 true)');
S('K02', CO, 'catch (fe) { frozen = true;', 'catch (fe) { frozen = false;', 'core', '冻结读失败按未冻(fail-open)');
S('K03', CO, 'frozen = await deps.isSettlementFrozen(marketId);', 'frozen = false;', 'core', '入口③不读冻结端口');
// K04(已移除): 从 REQUIRED_DEPS 列表里删 isSettlementFrozen 是等价变异——第二处类型检查列表(必须是函数)仍会因缺该依赖抛 DriverDepsError, 核心构造照样拒。
// ── intake / route / service / judged / relay ──
S('N01', IN, 'if (intakeNeedsPmt(row)) {', 'if (true) {', 'intake', '无判定题也读 pmt');
S('N02', IN, "catch (e) { pmt = { valid: false, reason: `read_pmt_threw: ${e && e.message ? e.message : e}` }; }", 'catch (e) { pmt = { valid: true, pmtMs: 1 }; }', 'intake', 'readPmt 抛错 fail-open');
S('N03', IN, "if (!row) return { accept: false, code: 'market_not_found', http: 404, detail: 'market not found' };", '', 'intake', '市场不存在不返回 404');
S('R01', RT, 'if (!gate.accept) return reply.code(gate.http).send({ ok: false, error: gate.code, detail: gate.detail });', 'if (false) return reply.code(gate.http).send({ ok: false, error: gate.code, detail: gate.detail });', 'route', '路由不执行受理门拒绝');
S('R02', RT, 'db: sqlite, marketId: market.id,\n        readPmt:', 'db: sqlite, marketId: \'no-such-market-id\',\n        readPmt:', 'route', '路由给门传错市场 id');
S('V01', SV, "if (step === 'seal' && budget) await applyLateSealGuard(", "if (true && budget) await applyLateSealGuard(", 'freeze', 'makeMarkLanded 对所有步跑晚 seal 守卫');
S('V02', SV, "if (step === 'seal' && budget) await applyLateSealGuard(", "if (false) await applyLateSealGuard(", 'freeze', 'makeMarkLanded 不跑晚 seal 守卫');
S('V03', SV, "catch (e) { log.error(`[proto-settlement-driver] REFUSED to start: ${e.message}`); return; }\n  _started = true;", "catch (e) { log.error(`[proto-settlement-driver] REFUSED to start: ${e.message}`); }\n  _started = true;", 'service', '预算校验失败仍启动');
S('V04', SV, "for (const w of r.warnings) log.error(`[proto-settlement-driver] BUDGET CONFIG (LOUD): ${w}`);", '', 'service', '非法 env 回默认但不 LOUD');
S('J01', JD, "export const JUDGED_COLUMNS = Object.freeze(['resolution_rule_spec', 'outcome_market_source', 'outcome_condition_id', 'outcome_oracle_relay_ids']);", "export const JUDGED_COLUMNS = Object.freeze(['resolution_rule_spec', 'outcome_market_source', 'outcome_condition_id']);", 'budget', '判定题定义少一列(单一来源)');
S('L01', RL, "return { ok: true, pastMedianTimeMs: pmt, observedAtMs, isSynced };", "return { ok: true, pastMedianTimeMs: pmt, observedAtMs };", 'relay', 'relay 不回 isSynced');
S('L02', RL, "if (typeof si?.isSynced === 'boolean') isSynced = si.isSynced;", 'isSynced = si?.isSynced;', 'relay', 'relay 不校验 isSynced 类型');
// ── 触发器级(freeze 测试的 MUT_* 钩子) ──
for (const n of ['trg_pm_d_frozen_insert_null', 'trg_pm_d_frozen_domain', 'trg_pm_d_frozen_one_way', 'trg_pm_d_frozen_reason_required', 'trg_pm_d_reason_needs_frozen', 'trg_pm_d_frozen_no_winning_side', 'trg_pmv_d_pmt_at_domain', 'trg_pm_ws_r1_verdict_ref']) TR(`D_${n}`, n, null, '__DROP__', `删掉整个触发器 ${n}`);
TR('X01', 'trg_pm_d_frozen_insert_null', 'NEW.settlement_frozen_at IS NOT NULL OR ', '', 'INSERT 检查少 frozen_at');
TR('X02', 'trg_pm_d_frozen_insert_null', ' OR NEW.frozen_reason IS NOT NULL', '', 'INSERT 检查少 frozen_reason');
TR('X03', 'trg_pm_d_frozen_domain', 'NEW.settlement_frozen_at <= 0', 'NEW.settlement_frozen_at < 0', '域: 0 也放行');
TR('X04', 'trg_pm_d_frozen_domain', "typeof(NEW.settlement_frozen_at) <> 'integer' OR ", '', '域: 小数 / 文本放行');
TR('X05', 'trg_pm_d_frozen_one_way', 'NEW.settlement_frozen_at IS NOT OLD.settlement_frozen_at OR ', '', '单向: 时刻可改');
TR('X06', 'trg_pm_d_frozen_one_way', ' OR NEW.frozen_reason IS NOT OLD.frozen_reason', '', '单向: reason 可改');
TR('X07', 'trg_pm_d_frozen_reason_required', 'NEW.frozen_reason IS NULL OR ', '', 'reason NULL 放行(N5a)');
TR('X08', 'trg_pm_d_frozen_reason_required', ' OR length(trim(NEW.frozen_reason)) = 0', '', 'reason 空白放行(N5a)');
TR('X09', 'trg_pm_d_reason_needs_frozen', 'NEW.frozen_reason IS NOT NULL', 'NEW.frozen_reason IS NOT NULL AND 0', 'reason 可脱离冻结单写');
TR('X10', 'trg_pm_d_frozen_no_winning_side', 'OLD.settlement_frozen_at IS NOT NULL OR ', '', 'D2: 已冻市场可写 winning_side');
TR('X11', 'trg_pm_d_frozen_no_winning_side', ' OR NEW.settlement_frozen_at IS NOT NULL', '', 'D2: 同语句冻结 + 写值放行');
TR('X12', 'trg_pmv_d_pmt_at_domain', 'NEW.pmt_at <= 0', 'NEW.pmt_at < 0', 'pmt_at 域: 0 放行');
TR('X13', 'trg_pmv_d_pmt_at_domain', "typeof(NEW.pmt_at) <> 'integer' OR ", '', 'pmt_at 域: 小数 / 文本放行');
TR('X14', 'trg_pm_ws_r1_verdict_ref', ' AND v.pmt_at IS NOT NULL', '', 'N1: NULL pmt_at 的 verdict 可被引用');

console.log('BASELINE');
let allBase = true;
for (const tk of Object.keys(T)) { const b = run(tk); console.log(`  ${tk}: exit=${b.status} ${b.last}`); if (b.status !== 0) allBase = false; }
if (!allBase) { console.log('BASELINE 不绿, 中止'); process.exit(2); }
let killed = 0, surv = 0, err = 0;
for (const m of M) {
  let r;
  if (m.kind === 'trig') r = run(m.tk, { MUT_TRIGGER: m.trig, MUT_FROM: m.from ?? '', MUT_TO: m.to });
  else {
    const abs = path.join(ROOT, m.file); const orig = fs.readFileSync(abs, 'utf8'); const n = orig.split(m.from).length - 1;
    if (n !== 1) { err++; console.log(`${m.id}: ERROR 片段命中 ${n} 次: ${m.from.slice(0, 70)} :: ${m.why}`); continue; }
    try { fs.writeFileSync(abs, orig.replace(m.from, () => m.to)); r = run(m.tk); }
    finally { fs.writeFileSync(abs, orig); if (fs.readFileSync(abs, 'utf8') !== orig) throw new Error('还原失败 ' + m.file); }
  }
  if (r.err) { err++; console.log(`${m.id}: ERROR ${r.err} :: ${m.why}`); continue; }
  if (r.status === 0) { surv++; console.log(`${m.id}: SURVIVED ${r.last} :: ${m.why}`); } else { killed++; console.log(`${m.id}: KILLED exit=${r.status} ${r.last} :: ${m.why}`); }
}
console.log('RESTORED baseline:'); for (const tk of Object.keys(T)) { const b = run(tk); console.log(`  ${tk}: exit=${b.status} ${b.last}`); }
console.log(`SUMMARY mutants=${M.length} killed=${killed} survivors=${surv} errors=${err}`); process.exitCode = surv || err ? 1 : 0;
