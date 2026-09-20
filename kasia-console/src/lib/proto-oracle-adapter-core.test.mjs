// proto-oracle-adapter-core.test.mjs — oracle 整合批 B: adapter 一个 tick 的编排(真 migration 临时库 + 注入 derive / readPmt; 零网络 / 零链 / 零 IPC / 零私钥)。
// 覆盖设计 §8 + §10 B1–B7 + §11: happy path(两源一致 + 宽限窗后 promote)/ 单源等第二源 / 冲突冻结 / 实质 ABSTAIN 冻结(含 pmt 无效写 NULL pmt_at)/ 暂态重试 / 赞成延后 /
//   llm 类不入赞成集且只问一次 / N5b 三档网络 / 非候选 / 坏 spec / 未登记源 / UMA 窗不安全中止 / B7 检查后插异议 ⇒ promote changes==0。
// Run: cd kasia-console && node src/lib/proto-oracle-adapter-core.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PMOAC_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_pmoac_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PMOAC_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
const assert = (await import('node:assert/strict')).default;
const { sqlite } = await import('../db/client.js');
const { runOracleAdapterTick } = await import('./proto-oracle-adapter-core.mjs');
const { resolveBudgetConfig, evaluatePromoteGate, promotionCutoffPmt } = await import('./proto-settlement-budget.mjs');
const { promoteWinningSide } = await import('./proto-settlement-freeze.mjs');
const { ENV_VALUELESS_TOKEN_IDS } = await import('./proto-oracle-policy.mjs');
const { evidenceRefOf } = await import('./proto-oracle-verdict.mjs');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const silent = { log() {}, warn() {}, error() {} };
const NOW_ISO = '2026-09-20T00:00:00.000Z';
const cfg = resolveBudgetConfig({}, { tickMs: 20_000 }).config;
const H = 3_600_000, D = 1_900_000_000_000, OE = D - 4 * H, CUT = promotionCutoffPmt(D, cfg), T1 = OE + H;
const UMA_OK = 48 * H;
const ESPN = (n) => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${n}`;
sqlite.prepare('INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)').run('tok1', 'Test', 'TST', NOW_ISO);
sqlite.prepare('INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)').run('tok2', 'Test2', 'TS2', NOW_ISO);

let seq = 0;
const specJson = (over = {}) => JSON.stringify({ data_source_canonical: ESPN(++seq), secondary_sources: [], ambiguity_handler: 'abstain', dispute_keywords: [], edge_case_examples: [], resolution_predicate: { metric: 'winner', op: '==', operand: 'LAL' }, side_map: { yes: 1, no: 0 }, polymarket_outcome_side: 'YES', title: 'LAL beat BOS?', ...over });
/** 判定题市场; bets=true ⇒ 两笔 confirmed(各侧一笔, 满足 R5 预检)。 */
function mk({ token = 'tok1', status = 'sealed', spec = specJson(), oe = OE, deadline = D, cond = '0x' + 'ab'.repeat(32), src = 'polymarket', bets = true, judged = true } = {}) {
  const id = `m${String(++seq).padStart(4, '0')}`;
  const cols = { id, token_def_id: token, question: 'q?', deadline_ms: deadline, min_bet: 1, seal_count: 2, committee_pubkeys_json: '[]', committee_privkey_enc: 'enc', rootclose_tmpl_hash: 'aa'.repeat(32), status, created_at: NOW_ISO, updated_at: NOW_ISO };
  if (judged) Object.assign(cols, { resolution_rule_spec: spec, outcome_market_source: src, outcome_condition_id: cond, outcome_end_ms: oe });
  const names = Object.keys(cols);
  sqlite.prepare(`INSERT INTO proto_markets (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((k) => cols[k]));
  if (bets) sqlite.exec(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES ('${id}-0','${id}','pk0',0,10,'confirmed','${NOW_ISO}'),('${id}-1','${id}','pk1',1,90,'confirmed','${NOW_ISO}')`);
  return id;
}
const M = (id) => sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(id);
const V = (id) => sqlite.prepare('SELECT * FROM proto_market_verdicts WHERE market_id = ? ORDER BY id').all(id);
const extractorVote = (label, kind = 'judgeline-deterministic') => async () => ({ ok: true, outcome: label, extractor_kind_used: kind, evidence_url: ESPN(1), evidence_raw: 'raw-' + label + '-' + kind });
const umaVote = (label) => async () => ({ ok: true, outcome: label, evidence_url: 'https://gamma-api.polymarket.com/markets', evidence_raw: 'gamma-' + label });
const notReady = async () => ({ ok: false, reason: 'polymarket market not resolved yet' });
const pmtOf = (ms) => ({ valid: true, pmtMs: ms });
const PMT_BAD = { valid: false, reason: 'lag_exceeded' };
/** 跑一个 tick; 只处理指定市场(其它市场已被前面的用例弄成非候选或无害——每个用例用独立市场且默认关闭其余候选: 见 isolate) */
async function tick({ pmt = pmtOf(T1), wall = T1, derive = {}, network = 'simnet', env = {}, umaWindowMs = UMA_OK, db = sqlite, calls = { ex: 0, uma: 0 } } = {}) {
  const s = await runOracleAdapterTick({
    db, cfg, network, umaWindowMs, env, log: silent, nowMs: () => wall, limit: 500,
    readPmt: async () => pmt,
    deriveExtractor: async (o, sp) => { calls.ex++; return (derive.ex || notReady)(o, sp); },
    deriveUma: async (o) => { calls.uma++; return (derive.uma || notReady)(o); },
  });
  return { s, calls };
}
/** 把所有当前候选市场冻结掉(冻结 = 非候选), 让下一个用例只看自己的市场。 */
const isolate = () => { sqlite.exec(`UPDATE proto_markets SET settlement_frozen_at = 1, frozen_reason = 'test_isolate|clock=wall' WHERE status='sealed' AND winning_side IS NULL AND settlement_frozen_at IS NULL`); };

await t('A1 ▲ happy path: 两源(extractor + uma)一致 ⇒ tick1 写两条带 pmt_at 的 verdict 后在宽限窗 wait, 宽限窗后 tick2 promote; 审计列 / 来源 / verdict_id 落库, 且引用 extractor 那条', async () => {
  isolate(); const id = mk();
  const r1 = await tick({ derive: { ex: extractorVote('YES'), uma: umaVote('YES') } });
  assert.equal(r1.s.verdictsWritten, 2); assert.equal(r1.s.waited, 1); assert.equal(r1.s.promoted.length, 0); assert.equal(M(id).winning_side, null);
  const vs = V(id); assert.deepEqual(vs.map((v) => [v.source_kind, v.outcome, v.pmt_at]), [['extractor', 1, T1], ['uma', 1, T1]]); assert.ok(vs.every((v) => v.evidence_ref && v.relay_id === null));
  const r2 = await tick({ pmt: pmtOf(T1 + cfg.graceMs), wall: T1 + cfg.graceMs, derive: { ex: extractorVote('YES'), uma: umaVote('YES') }, calls: r1.calls });
  assert.equal(r2.s.promoted.length, 1); assert.equal(r2.s.verdictsWritten, 0, '已有的源不再 derive / 不重复写');
  assert.equal(r1.calls.ex, 1, 'extractor 只 derive 一次'); assert.equal(r1.calls.uma, 1, 'uma 只 derive 一次');
  const m = M(id); assert.equal(m.winning_side, 1); assert.equal(m.winning_side_source, 'extractor'); assert.equal(m.winning_side_verdict_id, vs[0].id); assert.ok(m.winning_side_set_at);
  const r3 = await tick({ pmt: pmtOf(T1 + cfg.graceMs), wall: T1 + cfg.graceMs }); assert.equal(r3.s.scanned, 0, '已判的市场不再是候选');
});
await t('A2 B3 side_map + UMA 极性: side_map {yes:0,no:1}, polymarket_outcome_side=NO ⇒ extractor YES→0; uma(Polymarket)NO ⇒ 反极性=YES→0, 两源同侧 ⇒ promote 胜方 0; 极性对照臂: 同数据但 outcome_side=YES ⇒ uma NO→1 与 extractor 冲突 ⇒ 冻结', async () => {
  isolate();
  const a = mk({ spec: specJson({ side_map: { yes: 0, no: 1 }, polymarket_outcome_side: 'NO' }), bets: true });
  const b = mk({ spec: specJson({ side_map: { yes: 0, no: 1 }, polymarket_outcome_side: 'YES' }), bets: true });
  await tick({ derive: { ex: extractorVote('YES'), uma: umaVote('NO') } });
  await tick({ pmt: pmtOf(T1 + cfg.graceMs), wall: T1 + cfg.graceMs, derive: { ex: extractorVote('YES'), uma: umaVote('NO') } });
  assert.equal(M(a).winning_side, 0, '极性 NO: 一致 ⇒ promote 0'); assert.deepEqual(V(a).map((v) => v.outcome), [0, 0]);
  assert.equal(M(b).winning_side, null); assert.ok(M(b).settlement_frozen_at !== null, '极性 YES 对照臂: uma NO→1 vs extractor YES→0 ⇒ 冲突冻结'); assert.match(M(b).frozen_reason, /inconsistent_verdicts|abstain_or_dispute/);
});
await t('A3 单源: 只有 extractor 出票、uma 暂态 ⇒ 写 extractor 一条, wait(awaiting_second_source), 永不 promote; 下 tick uma 才出票才继续(extractor 不重 derive)', async () => {
  isolate(); const id = mk(); const calls = { ex: 0, uma: 0 };
  const r1 = await tick({ derive: { ex: extractorVote('NO'), uma: notReady }, calls }); assert.equal(r1.s.verdictsWritten, 1); assert.equal(r1.s.waited, 1); assert.deepEqual(V(id).map((v) => v.source_kind), ['extractor']);
  const r2 = await tick({ pmt: pmtOf(T1 + 5 * cfg.graceMs), wall: T1 + 5 * cfg.graceMs, derive: { ex: extractorVote('NO'), uma: notReady }, calls }); assert.equal(M(id).winning_side, null); assert.equal(r2.s.waited, 1);
  assert.equal(calls.ex, 1, 'extractor 已出票 ⇒ 不再 derive'); assert.equal(calls.uma, 2, 'uma 暂态 ⇒ 每 tick 重试');
});
await t('A4 冲突 ⇒ 两边都写(冻结集不漏任何一方)并冻结 reason=inconsistent_verdicts', async () => {
  isolate(); const id = mk(); await tick({ derive: { ex: extractorVote('YES'), uma: umaVote('NO') } });
  assert.deepEqual(V(id).map((v) => [v.source_kind, v.outcome]), [['extractor', 1], ['uma', 0]]); assert.notEqual(M(id).settlement_frozen_at, null); assert.match(M(id).frozen_reason, /inconsistent_verdicts/); assert.equal(M(id).winning_side, null);
});
await t('A5 B2/B4 实质 ABSTAIN(judgeline-abstain, pmt 有效)⇒ 写 extractor NULL(带 pmt_at)⇒ 冻结 abstain_or_dispute; 该 kind 不再 derive', async () => {
  isolate(); const id = mk(); const calls = { ex: 0, uma: 0 };
  await tick({ derive: { ex: async () => ({ ok: true, outcome: 'ABSTAIN', extractor_kind_used: 'judgeline-abstain', evidence_url: ESPN(1), reason: 'predicate fields insufficient' }), uma: notReady }, calls });
  const vs = V(id); assert.equal(vs.length, 1); assert.deepEqual([vs[0].source_kind, vs[0].outcome, vs[0].pmt_at], ['extractor', null, T1]); assert.match(M(id).frozen_reason, /abstain_or_dispute/); assert.equal(M(id).winning_side, null);
});
await t('A6 B4 ▲ 实质 ABSTAIN 且 pmt 无效: 仍写 NULL 行(pmt_at=NULL), 不能因 pmt 无效被跳过 = fail-open; 当 tick 门 wait(pmt_invalid); pmt 恢复后同一行让门冻结, 不重 derive', async () => {
  isolate(); const id = mk(); const calls = { ex: 0, uma: 0 };
  const ab = async () => ({ ok: true, outcome: 'ABSTAIN', extractor_kind_used: 'judgeline-no-fields', evidence_url: ESPN(1), reason: 'no fields' });
  const r1 = await tick({ pmt: PMT_BAD, wall: OE + H, derive: { ex: ab, uma: notReady }, calls });
  const vs = V(id); assert.equal(vs.length, 1); assert.deepEqual([vs[0].source_kind, vs[0].outcome, vs[0].pmt_at], ['extractor', null, null]); assert.equal(r1.s.waited, 1); assert.equal(M(id).settlement_frozen_at, null);
  const r2 = await tick({ pmt: pmtOf(T1), wall: T1, derive: { ex: ab, uma: notReady }, calls }); assert.equal(calls.ex, 1, '已有 extractor 行 ⇒ 不重 derive'); assert.match(M(id).frozen_reason, /abstain_or_dispute/); assert.equal(r2.s.frozen.length, 1);
  const id2 = mk(); await tick({ pmt: PMT_BAD, wall: CUT + 1, derive: { ex: ab, uma: notReady } });   // 墙钟已过 cutoff + pmt 无效 ⇒ 门直接冻结(pmt_invalid_past_cutoff)
  assert.match(M(id2).frozen_reason, /pmt_invalid_past_cutoff/); assert.equal(V(id2).length, 1);
});
await t('A7 暂态(取数失败 / known-source-not-final / 抛异常 / 未知 abstain kind)⇒ 不写任何行, 下 tick 重试; 状态不变', async () => {
  isolate(); const id = mk(); const calls = { ex: 0, uma: 0 };
  const transients = [async () => ({ ok: false, reason: 'HTTP 503' }), async () => ({ ok: true, outcome: 'ABSTAIN', extractor_kind_used: 'known-source-not-final' }), async () => { throw new Error('boom'); }, async () => ({ ok: true, outcome: 'ABSTAIN', extractor_kind_used: 'brand-new-kind' })];
  for (const ex of transients) { const r = await tick({ derive: { ex, uma: notReady }, calls }); assert.equal(r.s.verdictsWritten, 0); assert.equal(r.s.waited, 1); assert.equal(V(id).length, 0); assert.equal(M(id).settlement_frozen_at, null); }
  assert.equal(calls.ex, 4, '每 tick 都重试');
});
await t('A8 赞成延后: 出票但 pmt 无效 ⇒ 不写(赞成集不含 pmt_at=NULL 的行也不该有); pmt 恢复后才写; 无 pmt_at=NULL 的赞成行', async () => {
  isolate(); const id = mk();
  await tick({ pmt: PMT_BAD, wall: OE + H, derive: { ex: extractorVote('YES'), uma: umaVote('YES') } }); assert.equal(V(id).length, 0);
  await tick({ pmt: pmtOf(T1), derive: { ex: extractorVote('YES'), uma: umaVote('YES') } }); assert.equal(V(id).length, 2); assert.ok(V(id).every((v) => v.pmt_at === T1));
});
await t('A9 llm 类(extractor_kind_used 非 judgeline-deterministic)⇒ 贴 llm, 有 outcome 写入但永不入赞成集(即使 uma 也一致 ⇒ 仍 awaiting_second_source); LLM 只问一次; 与 extractor 冲突时 llm 异议冻结', async () => {
  isolate(); const id = mk(); const calls = { ex: 0, uma: 0 };
  const llm = extractorVote('YES', 'llm-narrative');
  await tick({ derive: { ex: llm, uma: umaVote('YES') }, calls }); assert.deepEqual(V(id).map((v) => [v.source_kind, v.outcome]), [['llm', 1], ['uma', 1]]);
  await tick({ pmt: pmtOf(T1 + 9 * cfg.graceMs), wall: T1 + 9 * cfg.graceMs, derive: { ex: llm, uma: umaVote('YES') }, calls });
  assert.equal(M(id).winning_side, null, 'llm + uma 一致也不能 promote(赞成集不含 llm)'); assert.equal(calls.ex, 1, 'LLM 每市场只问一次');
  const id2 = mk(); await tick({ derive: { ex: extractorVote('NO', 'some-future-kind'), uma: umaVote('YES') } });
  assert.equal(V(id2).find((v) => v.source_kind === 'llm').outcome, 0); assert.match(M(id2).frozen_reason, /inconsistent_verdicts/, '未知 extractor_kind_used ⇒ llm ⇒ 与 uma 冲突 ⇒ 异议冻结, 不是 extractor 赞成');
});
await t('A10 B5/N5b 三档网络: 主网 + 非白名单 ⇒ 不 derive 不写任何行(skipped not_allowed_here); 主网 + 白名单代币 ⇒ 处理; simnet / testnet-12 ⇒ 处理; 网络缺失 ⇒ fail-closed 跳过', async () => {
  isolate(); const a = mk({ token: 'tok1' }), b = mk({ token: 'tok2' });
  const calls = { ex: 0, uma: 0 };
  const r = await tick({ network: 'mainnet', env: { [ENV_VALUELESS_TOKEN_IDS]: 'tok2' }, derive: { ex: extractorVote('YES'), uma: umaVote('YES') }, calls });
  assert.equal(V(a).length, 0, '主网非白名单: 不写'); assert.equal(V(b).length, 2, '主网白名单: 处理'); assert.equal(calls.ex, 1); assert.ok(Object.keys(r.s.skipped).some((k) => k.startsWith('not_allowed_here')), JSON.stringify(r.s.skipped));
  const r2 = await tick({ network: null, derive: { ex: extractorVote('YES'), uma: umaVote('YES') }, calls }); assert.equal(V(a).length, 0, '网络未配置 ⇒ fail-closed'); assert.ok(Object.keys(r2.s.skipped).some((k) => k.startsWith('not_allowed_here')));
  const r3 = await tick({ network: 'mainnet', env: {}, derive: { ex: extractorVote('YES'), uma: umaVote('YES') }, calls }); assert.equal(V(a).length, 0);
  for (const net of ['simnet', 'testnet-12']) { isolate(); const c = mk({ token: 'tok1' }); await tick({ network: net, derive: { ex: extractorVote('YES'), uma: umaVote('YES') } }); assert.equal(V(c).length, 2, net); }
  void r3;
});
await t('A11 结果尚不可知 ⇒ 跳过(max(墙钟, pmt) < outcome_end 不 derive); 墙钟已过而 pmt 无效 ⇒ 仍扫(为写实质异议, B4); pmt 已过而墙钟未过 ⇒ 也扫', async () => {
  isolate(); const id = mk(); const calls = { ex: 0, uma: 0 };
  const r = await tick({ pmt: pmtOf(OE - 1), wall: OE - 1, derive: { ex: extractorVote('YES') }, calls }); assert.equal(calls.ex, 0); assert.equal(r.s.skipped.outcome_not_known, 1);
  await tick({ pmt: PMT_BAD, wall: OE, derive: { ex: extractorVote('YES') }, calls }); assert.equal(calls.ex, 1, '墙钟到点即扫');
  isolate(); const id2 = mk(); await tick({ pmt: pmtOf(OE), wall: OE - 5000, derive: { ex: extractorVote('YES') }, calls }); assert.equal(calls.ex, 2, 'pmt 到点也扫');
  void id; void id2;
});
await t('A12 非候选全跳过(不 derive / 不写): 非 sealed(betting)/ 已冻结 / 非判定题 / outcome_end 为 NULL / 已判', async () => {
  isolate(); const calls = { ex: 0, uma: 0 };
  const o = mk({ status: 'betting' }), p = mk({ judged: false }), q = mk({ oe: null }); const f = mk(); sqlite.prepare("UPDATE proto_markets SET settlement_frozen_at = 1, frozen_reason = 'x|clock=wall' WHERE id = ?").run(f);
  const r = await tick({ derive: { ex: extractorVote('YES'), uma: umaVote('YES') }, calls }); assert.equal(r.s.scanned, 0); assert.equal(calls.ex + calls.uma, 0);
  for (const id of [o, p, q, f]) assert.equal(V(id).length, 0);
});
await t('A13 坏 spec / 未登记数据源 ⇒ 跳过并计 errors, 不 derive(SSRF 二道闸: 直接写库的 data_source 也不 fetch): 非 JSON / 缺 side_map / side_map 非双射 / 缺 polymarket_outcome_side / 非 ESPN 域 / 内网地址', async () => {
  isolate(); const calls = { ex: 0, uma: 0 };
  const bad = [mk({ spec: 'not-json' }), mk({ spec: specJson({ side_map: undefined }) }), mk({ spec: specJson({ side_map: { yes: 1, no: 1 } }) }), mk({ spec: specJson({ polymarket_outcome_side: undefined }) }), mk({ spec: specJson({ data_source_canonical: 'https://evil.example/a?event=1' }) }), mk({ spec: specJson({ data_source_canonical: 'http://127.0.0.1:3200/admin' }) })];
  const r = await tick({ derive: { ex: extractorVote('YES'), uma: umaVote('YES') }, calls });
  assert.equal(calls.ex + calls.uma, 0); assert.equal(r.s.errors, bad.length); for (const id of bad) assert.equal(V(id).length, 0);
});
await t('A14 UMA 定稿窗不安全(NaN / <24h / undefined)⇒ 整个 tick 中止, 不读候选不 derive 不写(SHOULD①)', async () => {
  isolate(); const id = mk(); const calls = { ex: 0, uma: 0 };
  for (const w of [NaN, 3 * H, null, Infinity, -1]) { const r = await tick({ umaWindowMs: w, derive: { ex: extractorVote('YES'), uma: umaVote('YES') }, calls }); assert.equal(r.s.aborted, 'uma_window_unsafe', String(w)); }
  assert.equal(calls.ex + calls.uma, 0); assert.equal(V(id).length, 0);
  const r = await tick({ umaWindowMs: 24 * H, derive: { ex: extractorVote('YES') } }); assert.equal(r.s.aborted, null, '恰 24h 通过');
});
await t('A15 B7 ▲ gate 判 promote 之后、写值之前插入异议 ⇒ PROMOTE_UPDATE 的 NOT EXISTS 让 changes==0(NULL 异议 / 早于 outcome_end 的相反票 / pmt_at=NULL 的 llm 异议 / human 异议各一); 一致的 llm 票不拦(对照臂)', () => {
  const mkReady = () => { const id = mk(); sqlite.prepare('INSERT INTO proto_market_verdicts (market_id, source_kind, outcome, evidence_ref, created_at, pmt_at) VALUES (?,?,?,?,?,?)').run(id, 'extractor', 1, 'e#1', NOW_ISO, T1); sqlite.prepare('INSERT INTO proto_market_verdicts (market_id, source_kind, outcome, evidence_ref, created_at, pmt_at) VALUES (?,?,?,?,?,?)').run(id, 'uma', 1, 'u#1', NOW_ISO, T1); return id; };
  const gate = (id) => evaluatePromoteGate({ market: sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(id), verdicts: V(id), bets: sqlite.prepare('SELECT side, status, stake FROM proto_bets WHERE market_id = ?').all(id), pmt: pmtOf(T1 + cfg.graceMs), wallMs: T1 + cfg.graceMs, cfg });
  const ins = (id, kind, outcome, pmtAt, ref) => sqlite.prepare('INSERT INTO proto_market_verdicts (market_id, source_kind, outcome, evidence_ref, created_at, pmt_at) VALUES (?,?,?,?,?,?)').run(id, kind, outcome, ref, NOW_ISO, pmtAt);
  const ctl = mkReady(); const dc = gate(ctl); assert.equal(dc.action, 'promote'); ins(ctl, 'llm', 1, null, 'l#agree'); assert.equal(promoteWinningSide({ db: sqlite, marketId: ctl, decision: dc }).changes, 1, '对照臂: 一致的 llm 票不拦');
  const arms = { 'NULL 弃权': ['llm', null, T1, 'l#null'], '早于 outcome_end 的相反票(extractor)': ['extractor', 0, OE - 1, 'e#early'], 'pmt_at=NULL 的 llm 异议': ['llm', 0, null, 'l#nullpmt'], 'human 异议': ['human', 0, T1, 'h#1'] };
  for (const [name, [k, o, p, ref]] of Object.entries(arms)) {
    const id = mkReady(); const d = gate(id); assert.equal(d.action, 'promote', name); ins(id, k, o, p, ref);
    const r = promoteWinningSide({ db: sqlite, marketId: id, decision: d }); assert.equal(r.changes, 0, name); assert.equal(M(id).winning_side, null, name);
  }
});
await t('A16 B7 端到端(adapter 内): 在 promote UPDATE 前一刻插入异议 ⇒ skipped promote_guard_changes_0, winning_side 仍 NULL; 下 tick 门看到异议 ⇒ 冻结', async () => {
  isolate(); const id = mk();
  await tick({ derive: { ex: extractorVote('YES'), uma: umaVote('YES') } });   // tick1: 写两票, 宽限窗内 wait
  let injected = false;
  const proxy = new Proxy(sqlite, { get(target, prop) { if (prop === 'prepare') return (sql) => { if (!injected && /^UPDATE proto_markets SET winning_side/.test(sql)) { injected = true; target.prepare('INSERT INTO proto_market_verdicts (market_id, source_kind, outcome, evidence_ref, created_at, pmt_at) VALUES (?,?,?,?,?,?)').run(id, 'llm', null, 'l#race', NOW_ISO, null); } return target.prepare(sql); }; const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; } });
  const r2 = await tick({ pmt: pmtOf(T1 + cfg.graceMs), wall: T1 + cfg.graceMs, db: proxy });
  assert.equal(injected, true); assert.equal(r2.s.promoted.length, 0); assert.equal(r2.s.skipped.promote_guard_changes_0, 1); assert.equal(M(id).winning_side, null);
  const r3 = await tick({ pmt: pmtOf(T1 + cfg.graceMs + 20_000), wall: T1 + cfg.graceMs + 20_000 }); assert.equal(r3.s.frozen.length, 1); assert.match(M(id).frozen_reason, /abstain_or_dispute/);
});
await t('A17 门后逐 verdict 抗重复: 同 tick 重复进入(evidence_ref 相同)不写第二条; R5 预检失败(胜方侧无确认下注)⇒ 冻结 r5_precheck_failed', async () => {
  isolate(); const id = mk({ bets: false }); sqlite.exec(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES ('${id}-0','${id}','pk0',0,10,'confirmed','${NOW_ISO}')`);   // 无 side=1 的下注
  await tick({ derive: { ex: extractorVote('YES'), uma: umaVote('YES') } }); await tick({ derive: { ex: extractorVote('YES'), uma: umaVote('YES') } }); assert.equal(V(id).length, 2);
  await tick({ pmt: pmtOf(T1 + cfg.graceMs), wall: T1 + cfg.graceMs }); assert.match(M(id).frozen_reason, /r5_precheck_failed/); assert.equal(M(id).winning_side, null);
});

await t('A18 事务内 dedupe: derive 期间另一 tick 已写入同 (市场, source_kind, 证据哈希) 的行 ⇒ 本 tick 不再写第二条(同证据至多一条); 不同证据哈希仍写', async () => {
  isolate(); const id = mk(); const res = { ok: true, outcome: 'YES', extractor_kind_used: 'judgeline-deterministic', evidence_url: ESPN(1), evidence_raw: 'same-evidence' };
  const ref = evidenceRefOf({ result: res, cls: 'vote' });
  const racing = async () => { sqlite.prepare('INSERT INTO proto_market_verdicts (market_id, source_kind, outcome, evidence_ref, created_at, pmt_at) VALUES (?,?,?,?,?,?)').run(id, 'extractor', 1, ref, NOW_ISO, T1); return res; };
  const r = await tick({ derive: { ex: racing, uma: notReady } }); assert.equal(V(id).filter((v) => v.source_kind === 'extractor').length, 1, '同证据只一条'); assert.equal(r.s.verdictsWritten, 0);
  const id2 = mk(); const racing2 = async () => { sqlite.prepare('INSERT INTO proto_market_verdicts (market_id, source_kind, outcome, evidence_ref, created_at, pmt_at) VALUES (?,?,?,?,?,?)').run(id2, 'extractor', 1, 'other#sha256:aa', NOW_ISO, T1); return res; };
  const r2 = await tick({ derive: { ex: racing2, uma: notReady } }); assert.equal(V(id2).filter((v) => v.source_kind === 'extractor').length, 2, '不同证据哈希仍写'); assert.equal(r2.s.verdictsWritten, 1);
});

await t('A19 ▲ B2/B4 冲突且 pmt 无效: 两边的票仍都写(pmt_at=NULL 的异议行, 冻结集不漏任何一方); 当 tick 门 wait(pmt_invalid); pmt 恢复后同样的行让门冻结 inconsistent_verdicts, 不重 derive; 对照: 同数据无冲突 + pmt 无效 ⇒ 什么都不写', async () => {
  isolate(); const id = mk(); const calls = { ex: 0, uma: 0 };
  const r1 = await tick({ pmt: PMT_BAD, wall: OE + H, derive: { ex: extractorVote('YES'), uma: umaVote('NO') }, calls });
  assert.deepEqual(V(id).map((v) => [v.source_kind, v.outcome, v.pmt_at]), [['extractor', 1, null], ['uma', 0, null]]); assert.equal(r1.s.waited, 1); assert.equal(M(id).settlement_frozen_at, null);
  const r2 = await tick({ pmt: pmtOf(T1), wall: T1, derive: { ex: extractorVote('YES'), uma: umaVote('NO') }, calls }); assert.equal(calls.ex, 1); assert.equal(calls.uma, 1); assert.match(M(id).frozen_reason, /inconsistent_verdicts/); assert.equal(r2.s.frozen.length, 1);
  const id2 = mk(); await tick({ pmt: PMT_BAD, wall: OE + H, derive: { ex: extractorVote('YES'), uma: umaVote('YES') } }); assert.equal(V(id2).length, 0, '无冲突 + pmt 无效 ⇒ 赞成延后, 不写');
});

console.log(`\nproto-oracle-adapter-core.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
