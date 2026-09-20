// proto-oracle-verdict.test.mjs — oracle 整合批 B: B1 贴标 / B2·B4 写入决策表 / B3 side 映射 / UMA 窗断言。
// 🔴 B1 用【真生产者】输出: 真 deriveKanetNativeVote(ESPN 结构化 + judgeLine / 无 predicate 的 Qwen 路 / 各弃权与失败形态)与真 derivePolymarketVote(过 / 未过定稿窗),
//    只把网络 fetch 打桩(全局 fetch)。用真 migration 临时库(voter 模块 import 需要 DB)。Run: cd kasia-console && node src/lib/proto-oracle-verdict.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_ORACLE_VERDICT_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_orverdict_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_ORACLE_VERDICT_BOOTSTRAPPED: '1', QWEN_LLM_URL: 'http://llm.test/v1', UMA_FINALIZATION_WINDOW_MS: '' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
delete process.env.UMA_FINALIZATION_WINDOW_MS;              // 默认 48h
const assert = (await import('node:assert/strict')).default;
const V = await import('./proto-oracle-verdict.mjs');
const voter = await import('../services/bettor-prediction-voter.js');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };

// ── 全局 fetch 打桩: URL 前缀 → 响应工厂 ──
const realFetch = globalThis.fetch;
let routes = [];
globalThis.fetch = async (url, init) => { const u = String(url); const r = routes.find((x) => u.startsWith(x.prefix)); if (!r) throw new Error('unstubbed fetch ' + u); return r.handler(u, init); };
const stub = (prefix, handler) => { routes = [{ prefix, handler }, ...routes]; };
const espnJson = ({ completed = true, homeWins = true } = {}) => JSON.stringify({ header: { league: { abbreviation: 'NBA' }, competitions: [{ status: { type: { completed, state: completed ? 'post' : 'in' } }, competitors: [
  { homeAway: 'home', winner: homeWins, score: '110', team: { abbreviation: 'LAL', displayName: 'Lakers' } }, { homeAway: 'away', winner: !homeWins, score: '100', team: { abbreviation: 'BOS', displayName: 'Celtics' } }] }] } });
const ok = (body) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
const spec = (over = {}) => ({ data_source_canonical: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=', title: 'LAL beat BOS?', resolution_criteria: 'winner', ...over });
let evSeq = 0;
const kanet = (specObj, id = 'm1') => voter.deriveKanetNativeVote({ id, outcome_market_source: 'kanet_native', resolution_rule_spec: JSON.stringify(specObj) }, specObj);
const espnSpec = (over = {}) => { evSeq++; return spec({ data_source_canonical: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${evSeq}`, ...over }); };

// ══ B1: 真生产者输出的贴标 ═══════════════════════════════════════════════════════════════════════
await t('B1 ▲ 真 deriveKanetNativeVote(ESPN final + resolution_predicate ⇒ judgeline-deterministic)⇒ extractor; 胜 / 负两向各一份', async () => {
  stub('https://site.api.espn.com/', async () => ok(espnJson({ homeWins: true })));
  const pred = { metric: 'winner', op: '==', operand: 'LAL' };
  const r1 = await kanet(espnSpec({ resolution_predicate: pred })); assert.equal(r1.extractor_kind_used, 'judgeline-deterministic'); assert.equal(r1.outcome, 'YES');
  let c = V.classifyDerivation({ branch: 'extractor', result: r1 }); assert.deepEqual([c.cls, c.kind, c.label], ['vote', 'extractor', 'YES']);
  const r2 = await kanet(espnSpec({ resolution_predicate: { metric: 'winner', op: '==', operand: 'BOS' } })); assert.equal(r2.outcome, 'NO');
  c = V.classifyDerivation({ branch: 'extractor', result: r2 }); assert.deepEqual([c.cls, c.kind, c.label], ['vote', 'extractor', 'NO']);
});
await t('B1 ▲ 真 Qwen 路(无 predicate ⇒ LLM 判)的有 outcome 结果 ⇒ llm(绝不 extractor)——即使源是已知抽取器 / 证据由抽取器抽: 变异"LLM 标 extractor"必红', async () => {
  stub('http://llm.test/', async () => ok(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ outcome: 'YES', confidence: 0.95, reason: 'clear' }) } }] })));
  stub('https://site.api.espn.com/', async () => ok(espnJson({ homeWins: true })));
  const r = await kanet(espnSpec());                                            // 有 title、无 resolution_predicate
  assert.equal(r.ok, true); assert.equal(r.outcome, 'YES'); assert.equal(r.extractor_kind_used, undefined, 'LLM 路不带 extractor_kind_used');
  const c = V.classifyDerivation({ branch: 'extractor', result: r }); assert.deepEqual([c.cls, c.kind], ['vote', 'llm']);
  // 未知 / 新增的 extractor_kind_used(将来有人加了新路径)+ 有 outcome ⇒ 一律 llm
  for (const k of ['some-new-deterministic-kind', 'judgeline-deterministic-v2', '', null, undefined, 'JUDGELINE-DETERMINISTIC']) { const cc = V.classifyDerivation({ branch: 'extractor', result: { ok: true, outcome: 'NO', extractor_kind_used: k } }); assert.deepEqual([cc.cls, cc.kind], ['vote', 'llm'], String(k)); }
});
await t('B1 真 derivePolymarketVote: 过定稿窗的明确 YES/NO ⇒ uma; 定稿窗未到 / 未 resolved / 404 / HTTP 错 / 抛错 ⇒ 暂态(绝不贴 uma)', async () => {
  const gamma = (mk) => { stub('https://gamma-api.polymarket.com/', async () => ok(JSON.stringify(mk()))); };
  const old = new Date(Date.now() - 100 * 3600e3).toISOString(), recent = new Date(Date.now() - 3600e3).toISOString();
  gamma(() => [{ outcomePrices: '["1","0"]', closed: true, closedTime: old }]); let r = await voter.derivePolymarketVote({ outcome_condition_id: '0x' + 'ab'.repeat(32) });
  assert.equal(r.ok, true); let c = V.classifyDerivation({ branch: 'uma', result: r }); assert.deepEqual([c.cls, c.kind, c.label], ['vote', 'uma', 'YES']);
  gamma(() => [{ outcomePrices: '["0","1"]', closed: true, closedTime: old }]); r = await voter.derivePolymarketVote({ outcome_condition_id: '0x' + 'ab'.repeat(32) }); c = V.classifyDerivation({ branch: 'uma', result: r }); assert.equal(c.label, 'NO');
  gamma(() => [{ outcomePrices: '["1","0"]', closed: true, closedTime: recent }]); r = await voter.derivePolymarketVote({ outcome_condition_id: '0x' + 'ab'.repeat(32) });
  assert.equal(r.ok, false); assert.equal(r.finalization_pending, true); c = V.classifyDerivation({ branch: 'uma', result: r }); assert.deepEqual([c.cls, c.kind], ['transient', null], 'UMA 未定稿(ok:false)⇒ 暂态, 不写 NULL、不贴 uma');
  gamma(() => [{ outcomePrices: '["0.6","0.4"]', closed: true, closedTime: old }]); r = await voter.derivePolymarketVote({ outcome_condition_id: '0x' + 'ab'.repeat(32) }); assert.equal(V.classifyDerivation({ branch: 'uma', result: r }).cls, 'transient');
  gamma(() => []); r = await voter.derivePolymarketVote({ outcome_condition_id: '0x' + 'ab'.repeat(32) }); assert.equal(V.classifyDerivation({ branch: 'uma', result: r }).cls, 'transient');
  stub('https://gamma-api.polymarket.com/', async () => { throw new Error('boom'); }); r = await voter.derivePolymarketVote({ outcome_condition_id: '0x' + 'ab'.repeat(32) }); assert.equal(V.classifyDerivation({ branch: 'uma', result: r }).cls, 'transient');
  // uma 路上即使有人伪造成 ok:true 但 outcome 非 YES/NO ⇒ 也不是票
  assert.equal(V.classifyDerivation({ branch: 'uma', result: { ok: true, outcome: 'ABSTAIN' } }).cls, 'transient');
});
await t('B1 分类矩阵: kanet 路各真实形态——已 final 的实质弃权 ⇒ substantive(NULL 行); 暂态 ⇒ 不写; LLM 低置信 ⇒ 实质; LLM 取数 / HTTP / 无 provider 失败 ⇒ 暂态; 未知 extractor_kind_used 的 ABSTAIN ⇒ 暂态', async () => {
  stub('https://site.api.espn.com/', async () => ok(espnJson({ homeWins: true })));
  const real = await kanet(espnSpec({ resolution_predicate: { metric: 'winner', op: '!=', operand: 'LAL' } }));            // 真 judgeLine: winner 只支持 == ⇒ ABSTAIN
  assert.equal(real.extractor_kind_used, 'judgeline-abstain'); let c = V.classifyDerivation({ branch: 'extractor', result: real }); assert.deepEqual([c.cls, c.kind], ['substantive_abstain', 'extractor']);
  stub('https://site.api.espn.com/', async () => ok(espnJson({ completed: false })));
  const nf = await kanet(espnSpec({ resolution_predicate: { metric: 'winner', op: '==', operand: 'LAL' } })); assert.equal(nf.extractor_kind_used, 'known-source-not-final');
  c = V.classifyDerivation({ branch: 'extractor', result: nf }); assert.deepEqual([c.cls, c.kind], ['transient', null], '赛果未 final ⇒ 暂态');
  for (const k of ['judgeline-no-fields', 'judgeline-abstain']) { c = V.classifyDerivation({ branch: 'extractor', result: { ok: true, outcome: 'ABSTAIN', extractor_kind_used: k } }); assert.deepEqual([c.cls, c.kind], ['substantive_abstain', 'extractor'], k); }
  c = V.classifyDerivation({ branch: 'extractor', result: { ok: true, outcome: 'ABSTAIN', extractor_kind_used: 'spec-no-question' } }); assert.deepEqual([c.cls, c.kind], ['substantive_abstain', 'llm']);
  for (const k of ['known-source-not-final', 'extractor-exception', 'no-extractor-match', 'brand-new-kind', undefined, null, '']) { c = V.classifyDerivation({ branch: 'extractor', result: { ok: true, outcome: 'ABSTAIN', extractor_kind_used: k } }); assert.equal(c.cls, 'transient', '未知 / 暂态: ' + String(k)); }
  // LLM 路真实失败形态
  stub('http://llm.test/', async () => ok(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ outcome: 'YES', confidence: 0.3, reason: 'meh' }) } }] })));
  stub('https://site.api.espn.com/', async () => ok(espnJson({ homeWins: true })));
  const low = await kanet(espnSpec()); assert.equal(low.ok, false); assert.match(low.reason, /^daemon_abstain/); c = V.classifyDerivation({ branch: 'extractor', result: low }); assert.deepEqual([c.cls, c.kind], ['substantive_abstain', 'llm']);
  stub('http://llm.test/', async () => ({ ok: false, status: 503, json: async () => ({}) }));
  const http = await kanet(espnSpec()); assert.equal(http.ok, false); assert.equal(V.classifyDerivation({ branch: 'extractor', result: http }).cls, 'transient', 'LLM HTTP 错 ⇒ 暂态');
  stub('http://llm.test/', async () => { throw new Error('econnreset'); });
  const thr = await kanet(espnSpec()); assert.equal(V.classifyDerivation({ branch: 'extractor', result: thr }).cls, 'transient', 'LLM 取数失败 ⇒ 暂态');
  for (const bad of [null, undefined, {}, { ok: false }, { ok: true }, { ok: true, outcome: 'MAYBE' }, { ok: false, reason: 'kanet_native fetch fail: x' }]) assert.equal(V.classifyDerivation({ branch: 'extractor', result: bad }).cls, 'transient', JSON.stringify(bad));
  assert.throws(() => V.classifyDerivation({ branch: 'human', result: {} }), RangeError);
});

// ══ B1: UMA 窗断言 ═══════════════════════════════════════════════════════════════════════════════
await t('B1/SHOULD① UMA 窗: voter 导出生效值(默认 48h); assertUmaWindowSafe: NaN / Infinity / 非数字 / 0 / 负 / <24h ⇒ 拒; = 24h / 48h ⇒ 过; NaN 场景(env 写成非数字)真的会让 voter 定稿窗静默关闭', async () => {
  assert.equal(voter.UMA_FINALIZATION_WINDOW_MS, 48 * 3600e3); assert.equal(V.assertUmaWindowSafe(voter.UMA_FINALIZATION_WINDOW_MS).ok, true);
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, '172800000', 0, -1, 24 * 3600e3 - 1, 3600e3]) assert.equal(V.assertUmaWindowSafe(bad).ok, false, String(bad));
  for (const good of [24 * 3600e3, 48 * 3600e3, 72 * 3600e3]) assert.equal(V.assertUmaWindowSafe(good).ok, true, String(good));
  assert.equal(V.UMA_MIN_FINALIZATION_WINDOW_MS, 24 * 3600e3);
  // 旁证: voter 里 NaN 使 `> 0` 为假 ⇒ 未定稿的 UMA 结果直接 ok:true(这正是 finite 断言存在的原因)
  assert.equal(parseInt('abc', 10) > 0, false);
});

// ══ B3: side 映射 ════════════════════════════════════════════════════════════════════════════════
await t('B3 ▲ side_map 双射校验 + toSide 真值表: 两种 side_map × 三源(extractor / llm 同路 / uma)× UMA 两种极性 × YES/NO; 非法输入抛错(不猜)', () => {
  const normal = { yes: 0, no: 1 }, swapped = { yes: 1, no: 0 };
  assert.deepEqual(V.normalizeSideMap(normal), { yes: 0, no: 1 }); assert.deepEqual(V.normalizeSideMap(swapped), { yes: 1, no: 0 });
  for (const bad of [null, undefined, [], 'x', {}, { yes: 0 }, { yes: 0, no: 0 }, { yes: 1, no: 1 }, { yes: 0, no: 2 }, { yes: '0', no: '1' }, { yes: 0, no: 1, maybe: 2 }, { YES: 0, NO: 1 }, { yes: true, no: false }]) assert.equal(V.normalizeSideMap(bad), null, JSON.stringify(bad));
  // extractor 路(极性不适用)
  assert.equal(V.toSide('YES', { sideMap: normal, branch: 'extractor' }), 0); assert.equal(V.toSide('NO', { sideMap: normal, branch: 'extractor' }), 1);
  assert.equal(V.toSide('YES', { sideMap: swapped, branch: 'extractor' }), 1); assert.equal(V.toSide('NO', { sideMap: swapped, branch: 'extractor' }), 0);
  // uma 路: polymarket_outcome_side 'YES' = 同极性; 'NO' = 反极性(Polymarket YES ⇒ 本市场 no)
  for (const [sm, pol, label, want] of [[normal, 'YES', 'YES', 0], [normal, 'YES', 'NO', 1], [normal, 'NO', 'YES', 1], [normal, 'NO', 'NO', 0], [swapped, 'YES', 'YES', 1], [swapped, 'YES', 'NO', 0], [swapped, 'NO', 'YES', 0], [swapped, 'NO', 'NO', 1]]) assert.equal(V.toSide(label, { sideMap: sm, branch: 'uma', polymarketOutcomeSide: pol }), want, `${JSON.stringify(sm)} pol=${pol} ${label}`);
  assert.throws(() => V.toSide('YES', { sideMap: normal, branch: 'uma' }), RangeError, 'uma 不显式极性 ⇒ 抛'); assert.throws(() => V.toSide('YES', { sideMap: normal, branch: 'uma', polymarketOutcomeSide: 'MAYBE' }), RangeError);
  assert.throws(() => V.toSide('yes', { sideMap: normal, branch: 'extractor' }), RangeError, 'label 必须大写 YES|NO(引擎输出)'); assert.throws(() => V.toSide('ABSTAIN', { sideMap: normal, branch: 'extractor' }), RangeError);
  assert.throws(() => V.toSide('YES', { sideMap: { yes: 0, no: 0 }, branch: 'extractor' }), TypeError); assert.throws(() => V.toSide('YES', { sideMap: normal, branch: 'other' }), RangeError);
});
await t('B3 ▲ 端到端极性(真生产者): 同一场比赛 LAL 赢——extractor 路 YES→side、UMA 路(Polymarket 问的是 BOS 赢? polymarket_outcome_side=NO ⇒ Polymarket 报 NO)→ 同一 side; 极性反对照臂: 错标极性 ⇒ 两源反着投 ⇒ 不一致', async () => {
  stub('https://site.api.espn.com/', async () => ok(espnJson({ homeWins: true })));
  const ex = await kanet(espnSpec({ resolution_predicate: { metric: 'winner', op: '==', operand: 'LAL' } }));            // LAL 赢 ⇒ YES
  const old = new Date(Date.now() - 100 * 3600e3).toISOString();
  stub('https://gamma-api.polymarket.com/', async () => ok(JSON.stringify([{ outcomePrices: '["0","1"]', closed: true, closedTime: old }])));   // Polymarket 问"BOS 赢?" ⇒ NO
  const um = await voter.derivePolymarketVote({ outcome_condition_id: '0x' + 'cd'.repeat(32) });
  const sm = { yes: 0, no: 1 };
  const sExtractor = V.toSide(V.classifyDerivation({ branch: 'extractor', result: ex }).label, { sideMap: sm, branch: 'extractor' });
  const sUmaRight = V.toSide(V.classifyDerivation({ branch: 'uma', result: um }).label, { sideMap: sm, branch: 'uma', polymarketOutcomeSide: 'NO' });
  const sUmaWrong = V.toSide(V.classifyDerivation({ branch: 'uma', result: um }).label, { sideMap: sm, branch: 'uma', polymarketOutcomeSide: 'YES' });
  assert.equal(sExtractor, 0); assert.equal(sUmaRight, 0, '极性正确 ⇒ 与 extractor 同 side'); assert.equal(sUmaWrong, 1, '对照臂: 极性标反 ⇒ 反着投(测试手段有效)');
});

// ══ B2 / B4: 写入决策表 ═════════════════════════════════════════════════════════════════════════
const it_ = (o) => ({ branch: 'extractor', cls: 'vote', kind: 'extractor', side: 0, evidenceRef: 'u#sha256:a', confidence: null, ...o });
const P = (n) => ({ valid: true, pmtMs: n }), BAD = { valid: false, reason: 'not_synced' };
await t('B2/B4 ▲ 决策表: 暂态 ⇒ 不写(pmt 有效无效都不写); 实质 ABSTAIN ⇒ 写 NULL(pmt 有效 ⇒ pmt_at; 无效 ⇒ pmt_at=NULL 也写); 赞成 ⇒ pmt 有效才写(无效 ⇒ 推迟); 无冲突', () => {
  let r = V.planVerdictWrites({ items: [it_({ cls: 'transient', kind: null })], existing: [], pmt: P(5) }); assert.equal(r.writes.length, 0);
  r = V.planVerdictWrites({ items: [it_({ cls: 'transient', kind: null })], existing: [], pmt: BAD }); assert.equal(r.writes.length, 0);
  r = V.planVerdictWrites({ items: [it_({ cls: 'substantive_abstain', side: undefined })], existing: [], pmt: P(7) }); assert.deepEqual([r.writes.length, r.writes[0].outcome, r.writes[0].pmt_at, r.writes[0].why], [1, null, 7, 'substantive_abstain']);
  r = V.planVerdictWrites({ items: [it_({ cls: 'substantive_abstain', side: undefined })], existing: [], pmt: BAD }); assert.deepEqual([r.writes.length, r.writes[0].outcome, r.writes[0].pmt_at], [1, null, null], 'B4: 实质 ABSTAIN 在 pmt 无效时也写, pmt_at=NULL');
  r = V.planVerdictWrites({ items: [it_({ side: 1 })], existing: [], pmt: P(9) }); assert.deepEqual([r.writes.length, r.writes[0].outcome, r.writes[0].pmt_at, r.writes[0].why], [1, 1, 9, 'approval']);
  r = V.planVerdictWrites({ items: [it_({ side: 1 })], existing: [], pmt: BAD }); assert.deepEqual([r.writes.length, r.skipped[0].why], [0, 'approval_deferred_pmt_invalid'], '赞成 ⇒ pmt 无效不写(否则乱写 NULL 误冻)');
  for (const bad of [null, undefined, { valid: true }, { valid: true, pmtMs: 1.5 }, { valid: true, pmtMs: 0 }]) assert.equal(V.planVerdictWrites({ items: [it_({ side: 1 })], existing: [], pmt: bad }).writes.length, 0, JSON.stringify(bad));
});
await t('B4 ▲ 实质异议 ⇒ pmt 无效也必写: 本次的票与已有行 / 本 tick 其它票冲突 ⇒ 冲突双方都写(pmt 有效写 pmt_at, 无效写 NULL); 与已有一致 ⇒ 仍算赞成(pmt 无效不写)', () => {
  const ex = { source_kind: 'extractor', outcome: 1, evidence_ref: 'e#sha256:1', pmt_at: 5 };
  let r = V.planVerdictWrites({ items: [it_({ branch: 'uma', kind: 'uma', side: 0, evidenceRef: 'g#sha256:2' })], existing: [ex], pmt: BAD }); assert.deepEqual([r.writes.length, r.writes[0].outcome, r.writes[0].pmt_at, r.writes[0].why], [1, 0, null, 'dissent(conflict)'], '与已有 extractor 相反 ⇒ 异议, pmt 无效也写 pmt_at=NULL');
  r = V.planVerdictWrites({ items: [it_({ branch: 'uma', kind: 'uma', side: 0, evidenceRef: 'g#sha256:2' })], existing: [ex], pmt: P(11) }); assert.equal(r.writes[0].pmt_at, 11);
  r = V.planVerdictWrites({ items: [it_({ branch: 'uma', kind: 'uma', side: 1, evidenceRef: 'g#sha256:2' })], existing: [ex], pmt: BAD }); assert.equal(r.writes.length, 0, '与已有一致 ⇒ 赞成 ⇒ pmt 无效推迟');
  r = V.planVerdictWrites({ items: [it_({ side: 1 }), it_({ branch: 'uma', kind: 'uma', side: 0, evidenceRef: 'g#sha256:2' })], existing: [], pmt: BAD }); assert.deepEqual(r.writes.map((w) => [w.source_kind, w.outcome, w.pmt_at]), [['extractor', 1, null], ['uma', 0, null]], '同 tick 两源互相冲突 ⇒ 两条都写(冻结集不能漏冲突任一方)');
  r = V.planVerdictWrites({ items: [it_({ side: 1 }), it_({ branch: 'uma', kind: 'uma', side: 1, evidenceRef: 'g#sha256:2' })], existing: [], pmt: BAD }); assert.equal(r.writes.length, 0, '同 tick 两源一致 ⇒ 都是赞成 ⇒ 推迟');
  r = V.planVerdictWrites({ items: [it_({ side: 1 })], existing: [{ source_kind: 'llm', outcome: 0, evidence_ref: 'l#sha256:3', pmt_at: null }], pmt: BAD }); assert.equal(r.writes[0].why, 'dissent(conflict)', '与已有 llm 行冲突也算异议(冻结集含 llm)');
  r = V.planVerdictWrites({ items: [it_({ side: 1 })], existing: [{ source_kind: 'extractor', outcome: null, evidence_ref: 'z', pmt_at: null }], pmt: BAD }); assert.equal(r.writes.length, 0, '已有 NULL 行不参与"冲突"判定(NULL 本身就会冻结)——本次赞成仍按 pmt 无效推迟');
});
await t('B2 去重: 同 (source_kind, evidence_ref) 已存在 ⇒ 不重写(skipped duplicate_evidence); 不同证据哈希 ⇒ 允许; evidenceRefOf 稳定 + 非空 + 有票取 evidence_raw / 弃权取 kind|reason', () => {
  const ex = { source_kind: 'extractor', outcome: 1, evidence_ref: 'u#sha256:a', pmt_at: 5 };
  let r = V.planVerdictWrites({ items: [it_({ side: 1 })], existing: [ex], pmt: P(9) }); assert.deepEqual([r.writes.length, r.skipped[0].why], [0, 'duplicate_evidence']);
  r = V.planVerdictWrites({ items: [it_({ side: 1, evidenceRef: 'u#sha256:b' })], existing: [ex], pmt: P(9) }); assert.equal(r.writes.length, 1);
  r = V.planVerdictWrites({ items: [it_({ side: 1, kind: 'llm', evidenceRef: 'u#sha256:a' })], existing: [ex], pmt: P(9) }); assert.equal(r.writes.length, 1, '不同 source_kind 同哈希不算重复');
  const a = V.evidenceRefOf({ result: { evidence_url: 'https://x', evidence_raw: 'RAW' }, cls: 'vote' }), b = V.evidenceRefOf({ result: { evidence_url: 'https://x', evidence_raw: 'RAW' }, cls: 'vote' });
  assert.equal(a, b); assert.match(a, /^https:\/\/x#sha256:[0-9a-f]{64}$/); assert.notEqual(a, V.evidenceRefOf({ result: { evidence_url: 'https://x', evidence_raw: 'RAW2' }, cls: 'vote' }));
  const ab = V.evidenceRefOf({ result: { extractor_kind_used: 'judgeline-abstain', reason: 'r' }, cls: 'substantive_abstain' }); assert.match(ab, /^-#sha256:[0-9a-f]{64}$/);
  for (const bad of [{ cls: 'vote', kind: 'extractor', side: 1, evidenceRef: '' }, { cls: 'vote', kind: 'extractor', side: 1, evidenceRef: '   ' }, { cls: 'vote', kind: null, side: 1, evidenceRef: 'x' }, { cls: 'vote', kind: 'extractor', side: undefined, evidenceRef: 'x' }, { cls: 'vote', kind: 'extractor', side: 2, evidenceRef: 'x' }]) assert.equal(V.planVerdictWrites({ items: [it_(bad)], existing: [], pmt: P(1) }).writes.length, 0, JSON.stringify(bad));
});

globalThis.fetch = realFetch;
console.log(`\nproto-oracle-verdict.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
