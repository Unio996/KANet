// proto-oracle-spec.test.mjs — oracle 整合批 B / B3·B6·C1·C2: 判定题创建入口校验 + 下注 side_label 校验 + 公开读呈现。纯函数, 无 DB / 无网络(finder 用真 findExtractor: 纯 URL 解析)。
// Run: cd kasia-console && node src/lib/proto-oracle-spec.test.mjs
import assert from 'node:assert/strict';
import { validateJudgedMarketInput, dryRunPredicate, checkSideLabel, presentProtoMarket, findRelayKeyInBody, hasJudgedInput, parseStoredSpec, CONDITION_ID_RE, JUDGED_PRESENTATION_COLS } from './proto-oracle-spec.mjs';
import { resolveBudgetConfig } from './proto-settlement-budget.mjs';

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const cfg = resolveBudgetConfig({}, { tickMs: 20_000 }).config;
const H = 3_600_000, UMA = 48 * H, NOW = 1_800_000_000_000, OE = NOW + 24 * H, TICK = 300_000;
const MIN_DL = OE + UMA + cfg.graceMs + cfg.closePipelineMarginMs + 2 * TICK;
const COND = '0x' + 'aB'.repeat(32);
const spec = (over = {}) => ({ data_source_canonical: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401', secondary_sources: ['https://www.espn.com/nba/game/_/gameId/401'], ambiguity_handler: 'abstain', dispute_keywords: ['postponed'], edge_case_examples: [], resolution_predicate: { metric: 'winner', op: '==', operand: 'LAL' }, side_map: { yes: 1, no: 0 }, polymarket_outcome_side: 'YES', title: 'LAL beat BOS?', ...over });
const call = (over = {}) => validateJudgedMarketInput({ title: 'q?', deadlineMs: MIN_DL, resolutionRuleSpec: spec(), outcomeEndMs: OE, outcomeConditionId: COND, budgetCfg: cfg, umaWindowMs: UMA, adapterTickMs: TICK, nowMs: NOW, ...over });
const rejects = (over, code) => { const r = call(over); assert.equal(r.ok, false, JSON.stringify(over).slice(0, 120)); assert.equal(r.code, code, `${r.code}: ${r.error}`); };

await t('S1 ▲ 合法输入 ⇒ ok, 规范化列: spec 串 / outcome_market_source=polymarket / condition id 小写 / relay ids 恒 [] / outcome_end_ms 整数; spec 也可传 JSON 串; outcomeEnd 可传数字串', () => {
  const r = call(); assert.equal(r.ok, true); const n = r.normalized;
  assert.equal(n.outcome_market_source, 'polymarket'); assert.equal(n.outcome_condition_id, COND.toLowerCase()); assert.equal(n.outcome_oracle_relay_ids, '[]'); assert.equal(n.outcome_end_ms, OE); assert.equal(n.minDeadlineMs, MIN_DL); assert.deepEqual(parseStoredSpec(n.resolution_rule_spec), spec());
  assert.equal(call({ resolutionRuleSpec: JSON.stringify(spec()), outcomeEndMs: String(OE) }).ok, true);
});
await t('S2 ▲ 半套判定题输入(缺任一 / 空串 / null)⇒ judged_input_incomplete(路由映射 400); 三个都缺由 hasJudgedInput=false ⇒ 走旧流程', () => {
  rejects({ resolutionRuleSpec: undefined }, 'judged_input_incomplete'); rejects({ resolutionRuleSpec: null }, 'judged_input_incomplete');
  for (const v of [undefined, null, '']) { rejects({ outcomeEndMs: v }, 'judged_input_incomplete'); rejects({ outcomeConditionId: v }, 'judged_input_incomplete'); }
  assert.equal(hasJudgedInput({}), false); assert.equal(hasJudgedInput({ title: 'x', deadline: 5 }), false); assert.equal(hasJudgedInput(null), false); assert.equal(hasJudgedInput([]), false);
  for (const k of ['resolutionRuleSpec', 'outcomeEnd', 'outcomeConditionId']) assert.equal(hasJudgedInput({ [k]: 1 }), true, k); assert.equal(hasJudgedInput({ outcomeEnd: null }), true, 'null 也算"出现"(≠ undefined)⇒ 不能绕过半套检查');
});
await t('S3 ▲ B6(a) 数据源白名单 / SSRF: 非 https / 未知 host / 内网 / loopback / 单标签 host / 空白 / 超长 / 非字符串 ⇒ 拒; 命中但非 ESPN(coingecko)⇒ data_source_not_deterministic(C2 缺确定性源只能创建时拒)', () => {
  const ds = (u) => ({ resolutionRuleSpec: spec({ data_source_canonical: u }) });
  for (const u of ['http://site.api.espn.com/x', 'https://evil.example/apis/espn.com', 'https://espn.com.evil.example/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'ftp://site.api.espn.com/x', 'site.api.espn.com/x', 'file:///etc/passwd']) rejects(ds(u), 'data_source_not_whitelisted');
  rejects(ds('https://site.api.espn.com/a b'), 'data_source_invalid'); rejects(ds('https://site.api.espn.com/' + 'a'.repeat(500)), 'data_source_invalid'); rejects(ds(123), 'data_source_invalid'); rejects(ds(''), 'data_source_invalid');
  rejects(ds('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin'), 'data_source_not_deterministic');
  rejects({ resolutionRuleSpec: spec({ secondary_sources: ['https://evil.example/x'] }) }, 'secondary_source_not_whitelisted');
});
await t('S4 spec 结构: 非对象 / 非 JSON / 未知字段(输入面白名单)/ 缺 5 必填任一 / 类型错 / 超长 / 超上限', () => {
  rejects({ resolutionRuleSpec: '{bad' }, 'spec_json_invalid'); for (const v of [[], 5, true, '5', '[]']) rejects({ resolutionRuleSpec: v }, 'spec_not_object');
  rejects({ resolutionRuleSpec: spec({ evil_field: 1 }) }, 'spec_unknown_field'); rejects({ resolutionRuleSpec: spec({ __proto__x: 1 }) }, 'spec_unknown_field');
  for (const f of ['data_source_canonical', 'secondary_sources', 'ambiguity_handler', 'dispute_keywords', 'edge_case_examples']) { const s = spec(); delete s[f]; rejects({ resolutionRuleSpec: s }, 'spec_missing_field'); rejects({ resolutionRuleSpec: spec({ [f]: null }) }, 'spec_missing_field'); }
  rejects({ resolutionRuleSpec: spec({ secondary_sources: 'x' }) }, 'secondary_sources_invalid'); rejects({ resolutionRuleSpec: spec({ secondary_sources: new Array(21).fill('https://www.espn.com/a') }) }, 'secondary_sources_invalid');
  rejects({ resolutionRuleSpec: spec({ ambiguity_handler: 5 }) }, 'ambiguity_handler_invalid'); rejects({ resolutionRuleSpec: spec({ ambiguity_handler: 'a'.repeat(501) }) }, 'ambiguity_handler_invalid');
  rejects({ resolutionRuleSpec: spec({ dispute_keywords: [1] }) }, 'dispute_keywords_invalid'); rejects({ resolutionRuleSpec: spec({ edge_case_examples: 'x' }) }, 'edge_case_examples_invalid');
  rejects({ resolutionRuleSpec: spec({ title: 5 }) }, 'spec_text_invalid'); rejects({ resolutionRuleSpec: spec({ resolution_criteria: 'c'.repeat(501) }) }, 'spec_text_invalid');
});
await t('S5 C2 resolution_predicate: 缺 / 非对象 / 结构非法 ⇒ 拒; 干跑(注入 judge)全 ABSTAIN ⇒ 拒, 有一组 YES/NO 即过; 干跑对合法 predicate 三类(winner / margin / total)都能出 YES/NO', () => {
  const s = spec(); delete s.resolution_predicate; rejects({ resolutionRuleSpec: s }, 'predicate_missing'); rejects({ resolutionRuleSpec: spec({ resolution_predicate: 'x' }) }, 'predicate_missing');
  rejects({ resolutionRuleSpec: spec({ resolution_predicate: { metric: 'nope', op: '==', operand: 'A' } }) }, 'predicate_invalid'); rejects({ resolutionRuleSpec: spec({ resolution_predicate: { metric: 'winner', op: '>', operand: 'A' } }) }, 'predicate_invalid'); rejects({ resolutionRuleSpec: spec({ resolution_predicate: { metric: 'winner', op: '==', operand: '' } }) }, 'predicate_invalid');
  assert.equal(dryRunPredicate({ metric: 'winner', op: '==', operand: 'LAL' }, () => 'ABSTAIN').ok, false);
  assert.equal(dryRunPredicate({ metric: 'winner', op: '==', operand: 'LAL' }, () => { throw new Error('x'); }).ok, false, '抛错按 ABSTAIN');
  let n = 0; assert.equal(dryRunPredicate({ metric: 'winner', op: '==', operand: 'LAL' }, () => (++n === 2 ? 'NO' : 'ABSTAIN')).ok, true);
  for (const p of [{ metric: 'winner', op: '==', operand: 'LAL' }, { metric: 'margin', op: '>=', operand: 5, subject: 'LAL' }, { metric: 'total', op: '<', operand: 220 }]) { const d = dryRunPredicate(p); assert.equal(d.ok, true, JSON.stringify(p) + JSON.stringify(d)); }
  // 干跑接线(结构校验通过的 predicate 若 judge 全 ABSTAIN 仍要拒建): 生产里 validateResolutionPredicate 与 judgeLine 同契约, 这条只能靠注入 judge 证明"干跑这一道确实在"
  const dr = call({ judge: () => 'ABSTAIN' }); assert.deepEqual([dr.ok, dr.code], [false, 'predicate_dry_run_abstain']); assert.equal(call({ judge: () => 'YES' }).ok, true); assert.equal(call({ judge: () => { throw new Error('x'); } }).code, 'predicate_dry_run_abstain', 'judge 抛错按 ABSTAIN');
  const nosub = call({ resolutionRuleSpec: spec({ resolution_predicate: { metric: 'margin', op: '>=', operand: 5 } }) }); assert.equal(nosub.ok, false, 'margin 缺 subject ⇒ judge-time 永 ABSTAIN ⇒ 创建时必须拒'); assert.ok(['predicate_invalid', 'predicate_dry_run_abstain'].includes(nosub.code), nosub.code);
});
await t('S6 ▲ B3 side_map / 极性: 缺 / 非双射(同值 / 三键 / 值非 0-1 / 数组 / 字符串值)⇒ side_map_invalid; polymarket_outcome_side 缺或非 YES|NO ⇒ 拒(不静默默认); 两个合法排列 + 两种极性均过', () => {
  for (const sm of [undefined, null, {}, { yes: 1, no: 1 }, { yes: 0, no: 0 }, { yes: 0, no: 1, x: 2 }, { yes: 2, no: 0 }, { yes: '1', no: '0' }, [0, 1], 'x', { Yes: 1, No: 0 }, { yes: 1 }]) { const s = spec(); if (sm === undefined) delete s.side_map; else s.side_map = sm; rejects({ resolutionRuleSpec: s }, 'side_map_invalid'); }
  for (const p of [undefined, null, 'yes', 'MAYBE', 1, '']) { const s = spec(); if (p === undefined) delete s.polymarket_outcome_side; else s.polymarket_outcome_side = p; rejects({ resolutionRuleSpec: s }, 'polymarket_outcome_side_invalid'); }
  for (const sm of [{ yes: 1, no: 0 }, { yes: 0, no: 1 }]) for (const p of ['YES', 'NO']) assert.equal(call({ resolutionRuleSpec: spec({ side_map: sm, polymarket_outcome_side: p }) }).ok, true);
});
await t('S7 UMA 条件: 缺 / 格式非法(无 0x / 长度错 / 非 hex)⇒ 拒; 大小写混合过并规范为小写', () => {
  for (const c of ['abc', '0x' + 'a'.repeat(63), '0x' + 'a'.repeat(65), '0x' + 'g'.repeat(64), 'a'.repeat(64), 5]) rejects({ outcomeConditionId: c }, 'condition_id_invalid');
  assert.ok(CONDITION_ID_RE.test(COND)); assert.equal(call().normalized.outcome_condition_id, COND.toLowerCase());
});
await t('S8 ▲ B6(c) 时间预算: deadline ≥ outcomeEnd + UMA 窗 + 宽限窗 + 余量 + 2×adapter tick 恰过, 少 1ms 拒; 各项都真的进预算(把任一项改大则边界同步移动); outcomeEnd 已过 / 非整数 / 非正 ⇒ 拒; UMA 窗不安全 ⇒ 拒', () => {
  assert.equal(call({ deadlineMs: MIN_DL }).ok, true); rejects({ deadlineMs: MIN_DL - 1 }, 'deadline_too_early');
  assert.equal(call({ adapterTickMs: TICK + 1000, deadlineMs: MIN_DL + 2000 }).ok, true); rejects({ adapterTickMs: TICK + 1000, deadlineMs: MIN_DL + 1999 }, 'deadline_too_early');
  assert.equal(call({ umaWindowMs: UMA + 1000, deadlineMs: MIN_DL + 1000 }).ok, true); rejects({ umaWindowMs: UMA + 1000, deadlineMs: MIN_DL + 999 }, 'deadline_too_early');
  const big = { ...cfg, graceMs: cfg.graceMs + 1000 }; assert.equal(call({ budgetCfg: big, deadlineMs: MIN_DL + 1000 }).ok, true); rejects({ budgetCfg: big, deadlineMs: MIN_DL + 999 }, 'deadline_too_early');
  rejects({ deadlineMs: NaN }, 'deadline_too_early'); rejects({ deadlineMs: undefined }, 'deadline_too_early'); rejects({ deadlineMs: 'x' }, 'deadline_too_early');
  rejects({ outcomeEndMs: NOW - 1 }, 'outcome_end_in_past'); rejects({ outcomeEndMs: NOW }, 'outcome_end_in_past'); for (const v of [1.5, -5, 0, 'abc', NaN, Infinity]) rejects({ outcomeEndMs: v }, 'outcome_end_invalid');
  for (const w of [NaN, undefined, null, 3 * H, 24 * H - 1]) rejects({ umaWindowMs: w }, 'uma_window_unsafe'); assert.equal(call({ umaWindowMs: 24 * H, deadlineMs: MIN_DL }).ok, true);
  assert.throws(() => call({ budgetCfg: null }), /budgetCfg/);
});
await t('S9 ▲ 请求体不得含 relay 类字段(键名含 relay 不分大小写, 服务端定 outcome_oracle_relay_ids)', () => {
  for (const k of ['relayId', 'outcomeOracleRelayIds', 'outcome_oracle_relay_ids', 'RELAY', 'x_relay_y']) assert.equal(findRelayKeyInBody({ [k]: 1, title: 'x' }), k);
  assert.equal(findRelayKeyInBody({ title: 'x', outcomeEnd: 1 }), null); assert.equal(findRelayKeyInBody(null), null); assert.equal(findRelayKeyInBody([]), null);
});
await t('S10 ▲ C1 下注 side_label: 判定题下注必须带 side_label 且与 direction 按 side_map 一致; 缺 / 非 yes|no / 不一致 ⇒ 400; side_map 缺失或非法 ⇒ 500(拒受理); 两种 side_map 排列 × 两个 label 全表', () => {
  for (const [sm, rows] of [[{ yes: 1, no: 0 }, [['yes', 1, true], ['yes', 0, false], ['no', 0, true], ['no', 1, false]]], [{ yes: 0, no: 1 }, [['yes', 0, true], ['yes', 1, false], ['no', 1, true], ['no', 0, false]]]]) {
    const raw = JSON.stringify(spec({ side_map: sm }));
    for (const [lab, dir, good] of rows) { const r = checkSideLabel({ specRaw: raw, direction: dir, sideLabel: lab }); assert.equal(r.ok, good, JSON.stringify([sm, lab, dir])); if (good) assert.equal(r.side, dir); else { assert.equal(r.code, 'side_label_mismatch'); assert.equal(r.http, 400); } }
    for (const lab of [undefined, null, '', 'YES', 'maybe', 1, true]) { const r = checkSideLabel({ specRaw: raw, direction: 0, sideLabel: lab }); assert.deepEqual([r.ok, r.code, r.http], [false, 'side_label_required', 400], String(lab)); }
  }
  for (const bad of [null, 'not-json', JSON.stringify(spec({ side_map: { yes: 1, no: 1 } })), JSON.stringify({ ...spec(), side_map: undefined })]) { const r = checkSideLabel({ specRaw: bad, direction: 0, sideLabel: 'yes' }); assert.deepEqual([r.ok, r.code, r.http], [false, 'side_map_invalid', 500]); }
});
await t('S11 ▲ C1 公开读呈现: 判定题 ⇒ 附 judged{side_map, outcome_end_ms, data_source_canonical, polymarket_outcome_side, outcome_market_source, outcome_condition_id} 且内部列不外露; 非判定题 ⇒ 字节与今天完全相同(无新键、四个内部列被去掉后与原 SELECT 一致)', () => {
  const base = { id: 'm1', question: 'q?', status: 'betting', deadline_ms: 5, ticker: 'TST' };
  const nonJudged = { ...base, outcome_end_ms: null, resolution_rule_spec: null, outcome_market_source: null, outcome_condition_id: null, outcome_oracle_relay_ids: null };
  assert.equal(JSON.stringify(presentProtoMarket(nonJudged)), JSON.stringify(base), '非判定题: 逐字节同旧响应'); assert.ok(!('judged' in presentProtoMarket(nonJudged)));
  const j = { ...base, outcome_end_ms: OE, resolution_rule_spec: JSON.stringify(spec()), outcome_market_source: 'polymarket', outcome_condition_id: COND.toLowerCase(), outcome_oracle_relay_ids: '[]' };
  const out = presentProtoMarket(j); assert.deepEqual(out.judged, { side_map: { yes: 1, no: 0 }, outcome_end_ms: OE, data_source_canonical: spec().data_source_canonical, polymarket_outcome_side: 'YES', outcome_market_source: 'polymarket', outcome_condition_id: COND.toLowerCase() });
  for (const c of ['resolution_rule_spec', 'outcome_market_source', 'outcome_condition_id', 'outcome_oracle_relay_ids', 'outcome_end_ms']) assert.ok(!(c in out), c + ' 不外露(只经 judged 块)');
  assert.throws(() => presentProtoMarket({ ...base, outcome_end_ms: null }), /缺列/, '漏 SELECT 判定题列 ⇒ 抛(不把判定题误当非判定题)'); assert.equal(presentProtoMarket(null), null);
  assert.ok(/outcome_end_ms/.test(JUDGED_PRESENTATION_COLS) && /resolution_rule_spec/.test(JUDGED_PRESENTATION_COLS));
});

console.log(`\nproto-oracle-spec.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
