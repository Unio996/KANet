// proto-oracle-spec.mjs — oracle 整合批 B / B6·C1·C2: 判定题市场【创建入口】的输入校验 + 公开读的判定题呈现。纯函数(依赖可注入), 无 DB / 无 IO。
// 设计 docs/2026-09-20-bettor-oracle-batchB-adapter-verdict-promote-design-v0.1.md §7 / §10 B3·B6 / §11 C1·C2。
// 🔴 这是批 B 最大的输入面: data_source_canonical 只接受 findExtractor(url) 命中的白名单源(host 锚定 + 仅 https + 拒私网 / 回环, 复用不另写);
//    C2: 判定题无任何人工 resolve 出口(批 A 禁 operator 写判定题 + 批 D 冻结市场 winning_side 永不可写 + human 只能冻), 唯一出口 = refund(未接线, N5b)
//    ⇒ 缺"确定性抽取器源(带 resolution_predicate)"或缺"UMA 条件"的判定题 = 下注即死胡同 ⇒ **只保留创建时拒**。
// 🔴 v0 自动 promote 只支持 ESPN(唯一有结构化字段 + judgeLine 确定性算术的源; coingecko 命中 findExtractor 但无 predicate 路 ⇒ 创建时拒)。
import { findExtractor } from './oracle-evidence-extractors.mjs';
import { judgeLine, validateResolutionPredicate } from './judgeline.mjs';
import { normalizeSideMap, assertUmaWindowSafe } from './proto-oracle-verdict.mjs';
import { JUDGED_COLUMNS, isJudgedMarket } from '../db/proto-judged.mjs';

export const REQUIRED_SPEC_FIELDS = Object.freeze(['data_source_canonical', 'secondary_sources', 'ambiguity_handler', 'dispute_keywords', 'edge_case_examples']);   // 同老系统 bettor.js 的 5 必填
export const ALLOWED_SPEC_KEYS = Object.freeze([...REQUIRED_SPEC_FIELDS, 'resolution_predicate', 'side_map', 'polymarket_outcome_side', 'title', 'resolution_criteria']);
export const CONDITION_ID_RE = /^0x[0-9a-fA-F]{64}$/;
export const JUDGED_BODY_KEYS = Object.freeze(['resolutionRuleSpec', 'outcomeEnd', 'outcomeConditionId']);   // 任一出现即触发全套判定题校验
const MAX_URL = 500, MAX_TEXT = 500, MAX_LIST = 20;

const isPlainObject = (x) => x && typeof x === 'object' && !Array.isArray(x);
const reject = (code, error) => ({ ok: false, code, error });

/** 请求体里出现 relay 类字段一律拒(outcome_oracle_relay_ids 服务端定): 任何键名含 relay(不分大小写)⇒ 拒。 */
export function findRelayKeyInBody(body) {
  if (!isPlainObject(body)) return null;
  for (const k of Object.keys(body)) if (/relay/i.test(k)) return k;
  return null;
}
/** 创建请求是否带了任一判定题字段(半套 = 400, 全缺省 = 今天的旧流程)。 */
export function hasJudgedInput(body) { return !!isPlainObject(body) && JUDGED_BODY_KEYS.some((k) => body[k] !== undefined); }

/**
 * 建市时对 resolution_predicate 干跑(C2): 合成字段喂 judgeLine, 至少一组返回 YES/NO; 全部 ABSTAIN ⇒ 拒建
 * (非法 predicate 运行时 = 实质 ABSTAIN ⇒ 写 NULL ⇒ 冻结, 等于放进必然退款的市场)。
 */
export function dryRunPredicate(predicate, judge = judgeLine) {
  const subject = typeof predicate?.subject === 'string' && predicate.subject ? predicate.subject : 'HOME';
  const operand = typeof predicate?.operand === 'string' ? predicate.operand : 'WIN';
  const sets = [
    { winner_side: operand, home_team: subject, away_team: 'AWAY', home_score: 3, away_score: 1 },
    { winner_side: `${operand}_OTHER`, home_team: subject, away_team: 'AWAY', home_score: 1, away_score: 3 },
    { winner_side: operand, home_team: 'AWAY', away_team: subject, home_score: 1, away_score: 3 },
  ];
  const seen = [];
  for (const f of sets) { let v; try { v = judge(predicate, f); } catch { v = 'ABSTAIN'; } seen.push(v); if (v === 'YES' || v === 'NO') return { ok: true, verdicts: seen }; }
  return { ok: false, reason: `resolution_predicate 干跑全部 ABSTAIN(${seen.join(',')}): 非法 / 不可判 predicate 不能建市`, verdicts: seen };
}

/**
 * 判定题创建输入校验。
 * @param {object} o
 * @param {string} o.title
 * @param {number} o.deadlineMs                 covenant deadline(毫秒, 已校验为未来)
 * @param {*} o.resolutionRuleSpec              对象(或 JSON 串)
 * @param {*} o.outcomeEndMs                    毫秒整数(或可转数的串)
 * @param {*} o.outcomeConditionId              Polymarket condition id(0x + 64 hex)
 * @param {{graceMs:number, closePipelineMarginMs:number}} o.budgetCfg  批 D resolveBudgetConfig().config
 * @param {number} o.umaWindowMs                voter 导出的 UMA_FINALIZATION_WINDOW_MS 生效值
 * @param {number} [o.adapterTickMs=300000]
 * @param {number} [o.nowMs]
 * @param {(url:string)=>object|null} [o.finder]  测试注入; 默认 findExtractor
 * @param {(predicate:object, fields:object)=>string} [o.judge]  测试注入(干跑用); 默认 judgeLine——与 validateResolutionPredicate 同契约, 生产不传
 * @returns {{ok:true, normalized:{resolution_rule_spec:string, outcome_market_source:'polymarket', outcome_condition_id:string, outcome_oracle_relay_ids:'[]', outcome_end_ms:number, minDeadlineMs:number}}|{ok:false, code:string, error:string}}
 */
export function validateJudgedMarketInput({ title, deadlineMs, resolutionRuleSpec, outcomeEndMs, outcomeConditionId, budgetCfg, umaWindowMs, adapterTickMs = 300_000, nowMs = Date.now(), finder = findExtractor, judge = judgeLine }) {
  // 半套判定题输入 = 400(三个字段缺一不可)
  if (resolutionRuleSpec === undefined || resolutionRuleSpec === null) return reject('judged_input_incomplete', '判定题必须同时提供 resolutionRuleSpec / outcomeEnd / outcomeConditionId(缺 resolutionRuleSpec)');
  if (outcomeEndMs === undefined || outcomeEndMs === null || outcomeEndMs === '') return reject('judged_input_incomplete', '判定题必须同时提供 resolutionRuleSpec / outcomeEnd / outcomeConditionId(缺 outcomeEnd)');
  if (outcomeConditionId === undefined || outcomeConditionId === null || outcomeConditionId === '') return reject('judged_input_incomplete', '判定题必须同时提供 resolutionRuleSpec / outcomeEnd / outcomeConditionId(缺 outcomeConditionId: C2 无 UMA 条件的判定题无出口, 只能创建时拒)');
  // spec 解析
  let spec = resolutionRuleSpec;
  if (typeof spec === 'string') { try { spec = JSON.parse(spec); } catch (e) { return reject('spec_json_invalid', `resolutionRuleSpec 不是合法 JSON: ${e.message}`); } }
  if (!isPlainObject(spec)) return reject('spec_not_object', 'resolutionRuleSpec 必须是 JSON 对象');
  for (const k of Object.keys(spec)) if (!ALLOWED_SPEC_KEYS.includes(k)) return reject('spec_unknown_field', `resolutionRuleSpec 含未知字段 ${JSON.stringify(k)}(输入面白名单: ${ALLOWED_SPEC_KEYS.join(', ')})`);
  for (const f of REQUIRED_SPEC_FIELDS) if (spec[f] === undefined || spec[f] === null) return reject('spec_missing_field', `resolutionRuleSpec 缺必填字段 ${f}(5 必填)`);
  // 类型 / 长度
  const url = spec.data_source_canonical;
  if (typeof url !== 'string' || !url || url.length > MAX_URL || /\s/.test(url)) return reject('data_source_invalid', 'data_source_canonical 必须是无空白的 https URL 字符串(≤500)');
  if (!Array.isArray(spec.secondary_sources) || spec.secondary_sources.length > MAX_LIST || spec.secondary_sources.some((s) => typeof s !== 'string' || !s || s.length > MAX_URL || /\s/.test(s))) return reject('secondary_sources_invalid', 'secondary_sources 必须是字符串数组(≤20, 每项无空白 URL)');
  if (typeof spec.ambiguity_handler !== 'string' || spec.ambiguity_handler.length > MAX_TEXT) return reject('ambiguity_handler_invalid', 'ambiguity_handler 必须是字符串(≤500)');
  if (!Array.isArray(spec.dispute_keywords) || spec.dispute_keywords.length > MAX_LIST || spec.dispute_keywords.some((s) => typeof s !== 'string' || s.length > 100)) return reject('dispute_keywords_invalid', 'dispute_keywords 必须是字符串数组(≤20)');
  if (!Array.isArray(spec.edge_case_examples) || spec.edge_case_examples.length > MAX_LIST) return reject('edge_case_examples_invalid', 'edge_case_examples 必须是数组(≤20)');
  for (const k of ['title', 'resolution_criteria']) if (spec[k] !== undefined && (typeof spec[k] !== 'string' || spec[k].length > MAX_TEXT)) return reject('spec_text_invalid', `${k} 必须是字符串(≤500)`);
  // B6(a): 数据源只收 findExtractor 命中的白名单源; v0 确定性 promote 只支持 ESPN(唯一有结构化字段 + judgeLine 的源)
  const ent = finder(url);
  if (!ent) return reject('data_source_not_whitelisted', 'data_source_canonical 未命中已知抽取器白名单(仅 https + 已知 host, 拒 free-text / 任意 URL / 内网; 与 voter 同一份 findExtractor 注册表)');
  if (ent.kind !== 'espn') return reject('data_source_not_deterministic', `data_source_canonical 命中的源(${ent.kind})没有 judgeLine 确定性路——v0 自动 promote 只支持 ESPN(C2: 缺确定性抽取器源的判定题下注即死胡同, 只能创建时拒)`);
  for (const s of spec.secondary_sources) if (!finder(s)) return reject('secondary_source_not_whitelisted', `secondary_sources 含未命中抽取器白名单的 URL: ${s.slice(0, 80)}`);
  // resolution_predicate: 必填 + 结构校验 + 干跑(C2)
  if (!isPlainObject(spec.resolution_predicate)) return reject('predicate_missing', 'resolution_predicate 必填(C2: 缺确定性 predicate 的判定题只能创建时拒)');
  const pv = validateResolutionPredicate(spec.resolution_predicate);
  if (!pv.valid) return reject('predicate_invalid', `resolution_predicate 非法: ${pv.reason}`);
  const dry = dryRunPredicate(spec.resolution_predicate, judge);
  if (!dry.ok) return reject('predicate_dry_run_abstain', dry.reason);
  // B3: side_map(label→side 双射)+ UMA 极性(显式必填, 不静默默认)
  const sm = normalizeSideMap(spec.side_map);
  if (!sm) return reject('side_map_invalid', 'side_map 必填且须为 {"yes":0|1,"no":1|0} 双射(label→side)');
  if (spec.polymarket_outcome_side !== 'YES' && spec.polymarket_outcome_side !== 'NO') return reject('polymarket_outcome_side_invalid', 'polymarket_outcome_side 必填, 取 "YES" | "NO"("NO" = Polymarket 的 YES 对应本市场的 no, 反极性)');
  // UMA 条件
  if (typeof outcomeConditionId !== 'string' || !CONDITION_ID_RE.test(outcomeConditionId)) return reject('condition_id_invalid', 'outcomeConditionId 必须是 Polymarket condition id(0x + 64 位 hex)');
  // outcome_end 与 deadline 的关系(§7 N3 + B6(c): UMA 默认 48h 定稿窗必须算进预算)
  const oe = Number(outcomeEndMs);
  if (!Number.isSafeInteger(oe) || oe <= 0) return reject('outcome_end_invalid', 'outcomeEnd 必须是正整数毫秒(或可解析为它的日期时间)');
  if (oe <= nowMs) return reject('outcome_end_in_past', 'outcomeEnd 必须晚于当前时刻');
  const uma = assertUmaWindowSafe(umaWindowMs);
  if (!uma.ok) return reject('uma_window_unsafe', uma.reason);
  if (!budgetCfg || !Number.isSafeInteger(budgetCfg.graceMs) || !Number.isSafeInteger(budgetCfg.closePipelineMarginMs)) throw new TypeError('validateJudgedMarketInput: budgetCfg 必填(批 D resolveBudgetConfig().config)');
  const voteBudget = 2 * adapterTickMs;                                            // 投票预算: 两个 adapter tick
  const minDeadlineMs = oe + umaWindowMs + budgetCfg.graceMs + budgetCfg.closePipelineMarginMs + voteBudget;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < minDeadlineMs) return reject('deadline_too_early', `deadline(${deadlineMs}) < outcomeEnd + UMA 定稿窗(${umaWindowMs}) + 宽限窗(${budgetCfg.graceMs}) + 余量(${budgetCfg.closePipelineMarginMs}) + 投票预算(${voteBudget}) = ${minDeadlineMs}`);
  return { ok: true, normalized: { resolution_rule_spec: JSON.stringify(spec), outcome_market_source: 'polymarket', outcome_condition_id: outcomeConditionId.toLowerCase(), outcome_oracle_relay_ids: '[]', outcome_end_ms: oe, minDeadlineMs } };
}

/**
 * C1 下注防点错侧: 判定题下注请求必须带显式 side_label('yes'|'no'), 用市场 side_map 换算出的 side 必须 == 请求的 direction, 否则 400。
 * 把"下注方向反"挡在受理点(与 B3 判定方向反同根: 一位之差 = 赢家侧反)。
 * @returns {{ok:true, side:0|1}|{ok:false, code:string, http:400|500, detail:string}}
 */
export function checkSideLabel({ specRaw, direction, sideLabel }) {
  const spec = parseStoredSpec(specRaw);
  const sm = spec ? normalizeSideMap(spec.side_map) : null;
  if (!sm) return { ok: false, code: 'side_map_invalid', http: 500, detail: '市场的 side_map 缺失 / 非法(创建时已校验, 此处不应出现): 拒受理' };
  if (sideLabel !== 'yes' && sideLabel !== 'no') return { ok: false, code: 'side_label_required', http: 400, detail: "判定题下注必须带 side_label: 'yes' | 'no'" };
  const expected = sm[sideLabel];
  if (direction !== expected) return { ok: false, code: 'side_label_mismatch', http: 400, detail: `side_label=${sideLabel} 按本市场 side_map(yes→${sm.yes}, no→${sm.no}) 对应 direction=${expected}, 请求的 direction=${direction}: 拒受理(防下注方向反)` };
  return { ok: true, side: expected };
}

/** 从存储的 resolution_rule_spec(JSON 串)取判定题公开视图所需字段; 解析失败 ⇒ null(不抛)。 */
export function parseStoredSpec(raw) { try { const o = JSON.parse(raw); return isPlainObject(o) ? o : null; } catch { return null; } }

/**
 * 公开读呈现(C1): 行里带 outcome_end_ms / outcome_market_source / outcome_condition_id / resolution_rule_spec 这四个内部列; 这里
 *  ① 判定题 ⇒ 附 `judged: {side_map, outcome_end_ms, data_source_canonical, polymarket_outcome_side, outcome_market_source, outcome_condition_id}`
 *  ② 无论是否判定题都把这四个内部列从输出里删掉 ⇒ 非判定题的响应字节与今天逐字节相同(不出现任何新键)。
 * 注意: 需要 SELECT 出四个判定题列(isJudgedMarket 缺列会抛)——调用方在 SELECT 里补全 JUDGED_COLUMNS。
 */
export function presentProtoMarket(row) {
  if (!row || typeof row !== 'object') return row;
  const judged = isJudgedMarket(row);
  const out = { ...row };
  if (judged) {
    const spec = parseStoredSpec(row.resolution_rule_spec) || {};
    out.judged = { side_map: spec.side_map ?? null, outcome_end_ms: row.outcome_end_ms ?? null, data_source_canonical: spec.data_source_canonical ?? null, polymarket_outcome_side: spec.polymarket_outcome_side ?? null, outcome_market_source: row.outcome_market_source ?? null, outcome_condition_id: row.outcome_condition_id ?? null };
  }
  for (const c of JUDGED_COLUMNS) delete out[c];
  delete out.outcome_end_ms;
  return out;
}
/** presentProtoMarket 需要的额外 SELECT 列(GET 列表 / 详情在 PUBLIC_MARKET_COLS 之外补这些, 输出前由 presentProtoMarket 去掉)。 */
export const JUDGED_PRESENTATION_COLS = ['outcome_end_ms', ...JUDGED_COLUMNS].map((c) => `m.${c}`).join(', ');
