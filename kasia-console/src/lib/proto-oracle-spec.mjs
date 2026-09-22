// proto-oracle-spec.mjs — oracle 整合批 B / B6·C1·C2: 判定题市场【创建入口】的输入校验 + 公开读的判定题呈现。纯函数(依赖可注入), 无 DB / 无 IO。
// 设计 docs/2026-09-20-bettor-oracle-batchB-adapter-verdict-promote-design-v0.1.md §7 / §10 B3·B6 / §11 C1·C2。
// 🔴 这是批 B 最大的输入面: data_source_canonical 只接受 findExtractor(url) 命中的白名单源(host 锚定 + 仅 https + 拒私网 / 回环, 复用不另写);
//    C2: 判定题无任何人工 resolve 出口(批 A 禁 operator 写判定题 + 批 D 冻结市场 winning_side 永不可写 + human 只能冻), 唯一出口 = refund(未接线, N5b)
//    ⇒ 缺"确定性抽取器源(带 resolution_predicate)"或缺"UMA 条件"的判定题 = 下注即死胡同 ⇒ **只保留创建时拒**。
// 🔴 v0 自动 promote 只支持 ESPN(唯一有结构化字段 + judgeLine 确定性算术的源; coingecko 命中 findExtractor 但无 predicate 路 ⇒ 创建时拒)。
import { findExtractor } from './oracle-evidence-extractors.mjs';
import { judgeLine, validateResolutionPredicate } from './judgeline.mjs';
import { normalizeSideMap } from './proto-oracle-verdict.mjs';
import { JUDGED_COLUMNS, isJudgedMarket } from '../db/proto-judged.mjs';

// D-032 v0.2.4(单口径): 判定题只剩一个确定性裁判(ESPN judgeLine),不再接受 Polymarket/UMA 第二裁判输入。
export const REQUIRED_SPEC_FIELDS = Object.freeze(['data_source_canonical', 'secondary_sources', 'ambiguity_handler', 'dispute_keywords', 'edge_case_examples']);   // 同老系统 bettor.js 的 5 必填(判定代码不读取,§5 仅人工存档)
export const ALLOWED_SPEC_KEYS = Object.freeze([...REQUIRED_SPEC_FIELDS, 'resolution_predicate', 'side_map', 'title', 'resolution_criteria']);   // D-032 §2.1 去 polymarket_outcome_side
// D-032 §2.6-5: canonical_event / resolution_statement 只由服务端(建题流程通过身份核对+回签后)写入最终存储的
// spec——不在 ALLOWED_SPEC_KEYS 里,请求体带这两键会被既有 "spec_unknown_field" 通用检查原样拒绝(与 relay 键
// "请求体出现即拒" 同一处理原则),不需要单独的白名单/例外分支。SERVER_ONLY_SPEC_KEYS 只用来给 §2.6 建题流程
// 在校验通过后合并进最终存储 JSON 时确认没有拼错键名(见 attachCanonicalEventToSpec)。
export const SERVER_ONLY_SPEC_KEYS = Object.freeze(['canonical_event', 'resolution_statement']);
export const CONDITION_ID_RE = /^0x[0-9a-fA-F]{64}$/;   // 仍导出:老系统 bettor.js 与既有测试引用,D-032 不动老系统
export const JUDGED_BODY_KEYS = Object.freeze(['resolutionRuleSpec', 'outcomeEnd']);   // D-032 §2.1: 去 outcomeConditionId——任一出现即触发全套判定题校验
const MAX_URL = 500, MAX_TEXT = 500, MAX_LIST = 20;

const isPlainObject = (x) => x && typeof x === 'object' && !Array.isArray(x);
const reject = (code, error) => ({ ok: false, code, error });

/** 请求体里出现 relay 类字段一律拒(outcome_oracle_relay_ids 服务端定): 任何键名含 relay(不分大小写)⇒ 拒。 */
export function findRelayKeyInBody(body) {
  if (!isPlainObject(body)) return null;
  for (const k of Object.keys(body)) if (/relay/i.test(k)) return k;
  return null;
}
/**
 * SHOULD②(NWT 复核): 请求体里任何以 resolution / outcome 开头(不分大小写, 含蛇形 resolution_rule_spec / outcome_end / outcomeMarketSource 等)却不是已识别键的字段 ⇒ 返回该键(路由 400)。
 * 否则这类键会被静默丢弃、建成普通市场(="接受却丢弃")。已识别 = 判定题三键 + 既有的 resolutionNote(既有占位字段, 接受但目前无处存, 见路由注释)。
 */
export const RECOGNIZED_RESOLUTION_OUTCOME_KEYS = Object.freeze(['resolutionRuleSpec', 'outcomeEnd', 'resolutionNote', 'attestStatement']);   // D-032: 去 outcomeConditionId(不再是"识别但丢弃",是"识别且拒绝",见 findDualJudgeKeyInBody);§2.6-4 加 attestStatement(回签)
export function findUnrecognizedJudgedShapedKey(body) {
  if (!isPlainObject(body)) return null;
  for (const k of Object.keys(body)) if (/^(resolution|outcome)/i.test(k) && !RECOGNIZED_RESOLUTION_OUTCOME_KEYS.includes(k)) return k;
  return null;
}
/**
 * D-032 §2.1(单口径): 请求体出现 outcomeConditionId,或任何 polymarket 前缀形状的键 ⇒ 拒(dual_judge_not_allowed)。
 * 与 findUnrecognizedJudgedShapedKey 的区别:那个函数处理"没见过的形状键"(拼写错/新字段试探),
 * 这个函数专门标记"曾经合法、现在明确不再接受的第二裁判输入"——需要一个更明确的错误码告诉调用方
 * "不是拼错了,是这条路已经不通了",不能被 findUnrecognizedJudgedShapedKey 的通用错误信息掩盖。
 * @returns {string|null} 命中的键名,或 null(放行)
 */
export function findDualJudgeKeyInBody(body) {
  if (!isPlainObject(body)) return null;
  for (const k of Object.keys(body)) {
    if (k === 'outcomeConditionId') return k;
    if (/^polymarket/i.test(k)) return k;
  }
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
 * 判定题创建输入校验(D-032 v0.2.4: 单口径,不再接受 outcomeConditionId / polymarket 第二裁判输入)。
 * @param {object} o
 * @param {string} o.title
 * @param {number} o.deadlineMs                 covenant deadline(毫秒, 已校验为未来)
 * @param {*} o.resolutionRuleSpec              对象(或 JSON 串)
 * @param {*} o.outcomeEndMs                    毫秒整数(或可转数的串)
 * @param {{graceMs:number, closePipelineMarginMs:number}} o.budgetCfg  批 D resolveBudgetConfig().config
 * @param {number} [o.adapterTickMs=300000]
 * @param {number} [o.nowMs]
 * @param {(url:string)=>object|null} [o.finder]  测试注入; 默认 findExtractor
 * @param {(predicate:object, fields:object)=>string} [o.judge]  测试注入(干跑用); 默认 judgeLine——与 validateResolutionPredicate 同契约, 生产不传
 * @returns {{ok:true, normalized:{resolution_rule_spec:string, outcome_market_source:'kanet_native', outcome_condition_id:null, outcome_oracle_relay_ids:'[]', outcome_end_ms:number, minDeadlineMs:number}}|{ok:false, code:string, error:string}}
 */
export function validateJudgedMarketInput({ title, deadlineMs, resolutionRuleSpec, outcomeEndMs, budgetCfg, adapterTickMs = 300_000, nowMs = Date.now(), finder = findExtractor, judge = judgeLine }) {
  // 半套判定题输入 = 400(两个字段缺一不可)
  if (resolutionRuleSpec === undefined || resolutionRuleSpec === null) return reject('judged_input_incomplete', '判定题必须同时提供 resolutionRuleSpec / outcomeEnd(缺 resolutionRuleSpec)');
  if (outcomeEndMs === undefined || outcomeEndMs === null || outcomeEndMs === '') return reject('judged_input_incomplete', '判定题必须同时提供 resolutionRuleSpec / outcomeEnd(缺 outcomeEnd)');
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
  // B3: side_map(label→side 双射)。D-032: 不再收 polymarket_outcome_side(已从 ALLOWED_SPEC_KEYS 去掉,
  // 出现即在上面的"未知字段"检查处 spec_unknown_field 拒,这里不需要重复校验它)。
  const sm = normalizeSideMap(spec.side_map);
  if (!sm) return reject('side_map_invalid', 'side_map 必填且须为 {"yes":0|1,"no":1|0} 双射(label→side)');
  // outcome_end 与 deadline 的关系(D-032: 去 UMA 定稿窗,只剩宽限窗 + 余量 + 投票预算)
  const oe = Number(outcomeEndMs);
  if (!Number.isSafeInteger(oe) || oe <= 0) return reject('outcome_end_invalid', 'outcomeEnd 必须是正整数毫秒(或可解析为它的日期时间)');
  if (oe <= nowMs) return reject('outcome_end_in_past', 'outcomeEnd 必须晚于当前时刻');
  if (!budgetCfg || !Number.isSafeInteger(budgetCfg.graceMs) || !Number.isSafeInteger(budgetCfg.closePipelineMarginMs)) throw new TypeError('validateJudgedMarketInput: budgetCfg 必填(批 D resolveBudgetConfig().config)');
  const voteBudget = 2 * adapterTickMs;                                            // 投票预算: 两个 adapter tick
  const minDeadlineMs = oe + budgetCfg.graceMs + budgetCfg.closePipelineMarginMs + voteBudget;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < minDeadlineMs) return reject('deadline_too_early', `deadline(${deadlineMs}) < outcomeEnd + 宽限窗(${budgetCfg.graceMs}) + 余量(${budgetCfg.closePipelineMarginMs}) + 投票预算(${voteBudget}) = ${minDeadlineMs}`);
  return { ok: true, normalized: { resolution_rule_spec: JSON.stringify(spec), outcome_market_source: 'kanet_native', outcome_condition_id: null, outcome_oracle_relay_ids: '[]', outcome_end_ms: oe, minDeadlineMs } };
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

// D-032 §2.4: judgeLine 的平局/push 规则是代码常量(运营者不可改),公开视图原样回显,不由 spec 字段驱动。
const JUDGE_TIE_RULE_TEXT = 'winner: 平局=NO; margin/total/score: 恰等于线(push)=NO';

/**
 * 公开读呈现(C1,D-032 v0.2.4 改单口径): 行里带 outcome_end_ms / outcome_market_source / outcome_condition_id / resolution_rule_spec 这四个内部列; 这里
 *  ① 判定题 ⇒ 附 `judged: {side_map, outcome_end_ms, data_source_canonical, judge:{kind,predicate,tie_rule,value_time}, human_metadata_only:{...}}`
 *     (D-032 去 polymarket_outcome_side / outcome_market_source / outcome_condition_id——单口径下这三个字段不再是判定的一部分,
 *     不放进对外视图误导"这题还有第二个来源可查"; §2.6 落码后这里再补 judge.statement / judge.canonical_event, 置于 question 之前)
 *  ② 无论是否判定题都把这四个内部列从输出里删掉 ⇒ 非判定题的响应字节与今天逐字节相同(不出现任何新键)。
 * 注意: 需要 SELECT 出四个判定题列(isJudgedMarket 缺列会抛)——调用方在 SELECT 里补全 JUDGED_COLUMNS。
 */
export function presentProtoMarket(row) {
  if (!row || typeof row !== 'object') return row;
  const judged = isJudgedMarket(row);
  const out = { ...row };
  if (judged) {
    const spec = parseStoredSpec(row.resolution_rule_spec) || {};
    out.judged = {
      side_map: spec.side_map ?? null,
      outcome_end_ms: row.outcome_end_ms ?? null,
      data_source_canonical: spec.data_source_canonical ?? null,
      judge: { kind: 'espn-judgeline', predicate: spec.resolution_predicate ?? null, tie_rule: JUDGE_TIE_RULE_TEXT, value_time: row.outcome_end_ms ?? null },
      human_metadata_only: {
        secondary_sources: spec.secondary_sources ?? null, ambiguity_handler: spec.ambiguity_handler ?? null,
        dispute_keywords: spec.dispute_keywords ?? null, edge_case_examples: spec.edge_case_examples ?? null,
      },
    };
  }
  for (const c of JUDGED_COLUMNS) delete out[c];
  delete out.outcome_end_ms;
  return out;
}
/** presentProtoMarket 需要的额外 SELECT 列(GET 列表 / 详情在 PUBLIC_MARKET_COLS 之外补这些, 输出前由 presentProtoMarket 去掉)。 */
export const JUDGED_PRESENTATION_COLS = ['outcome_end_ms', ...JUDGED_COLUMNS].map((c) => `m.${c}`).join(', ');
