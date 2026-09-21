// proto-settlement-freeze-v213.test.mjs — oracle 整合批 D(v213): 冻结列 + verdicts.pmt_at 的 DB 触发器(D2 / N1 / N5) + 冻结 / 晚 seal / promote 写值的 DB 端口。
// 设计 docs/2026-09-20-bettor-oracle-batchD-grace-refundflip-budget-design-v0.1.md v0.3 §3/§4/§7。真 migration 临时库(DB_PATH); 零链 / 零 IPC / 零私钥。
// Run: cd kasia-console && node src/db/proto-settlement-freeze-v213.test.mjs
// 🟡 诚实边界(同批 A): 触发器防应用 / 运维失误与手写 SQL, 不防能 DROP TRIGGER 的机器写权。
// 变异钩子(仅本测试文件): MUT_TRIGGER=<触发器名> MUT_FROM=<原片段> MUT_TO=<替换片段 | __DROP__> ⇒ 迁移后就地改写该触发器再跑全套, 全套必须变红。
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PMV213_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_pmv213_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PMV213_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
const { sqlite } = await import('./client.js');
const { judgedSqlPredicate } = await import('./proto-judged.mjs');
const { isMarketFrozen, freezeMarket, applyLateSealGuard, promoteWinningSide } = await import('../lib/proto-settlement-freeze.mjs');
const { resolveBudgetConfig, evaluatePromoteGate } = await import('../lib/proto-settlement-budget.mjs');

if (process.env.MUT_TRIGGER) {
  const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name = ?").get(process.env.MUT_TRIGGER);
  if (!row) { console.log(`MUTATION ERROR: 触发器 ${process.env.MUT_TRIGGER} 不存在`); process.exit(3); }
  sqlite.exec(`DROP TRIGGER ${process.env.MUT_TRIGGER}`);
  if (process.env.MUT_TO !== '__DROP__') {
    const n = row.sql.split(process.env.MUT_FROM).length - 1;
    if (n !== 1) { console.log(`MUTATION ERROR: 片段命中 ${n} 次(应恰 1): ${process.env.MUT_FROM}`); process.exit(3); }
    sqlite.exec(row.sql.replace(process.env.MUT_FROM, () => process.env.MUT_TO));
  }
  console.log(`MUTATION APPLIED: ${process.env.MUT_TRIGGER} ${process.env.MUT_TO === '__DROP__' ? 'DROPPED' : 'rewritten'}`);
}

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'eq'}: 期望 ${String(b)}, 实际 ${String(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
function aborts(fn, re, label = '') {
  let e = null; try { fn(); } catch (x) { e = x; }
  if (!e) throw new Error(`${label} 应该 ABORT, 实际成功`);
  if (re && !re.test(e.message)) throw new Error(`${label} 抛了但报文不对: ${e.message}`);
}
const NOW_ISO = '2026-09-20T00:00:00.000Z';
let seq = 0; const nid = () => `d${String(++seq).padStart(4, '0')}`;
sqlite.prepare('INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)').run('tok1', 'Test', 'TST', NOW_ISO);
const cfg = resolveBudgetConfig({}, { tickMs: 20_000 }).config;
function mkMarket({ id = nid(), status = 'genesis_pending', ...extra } = {}) {
  const cols = { id, token_def_id: 'tok1', question: 'q?', deadline_ms: 1700000000000, min_bet: 1, seal_count: 2, committee_pubkeys_json: '[]', committee_privkey_enc: 'enc', rootclose_tmpl_hash: 'aa'.repeat(32), status, created_at: NOW_ISO, updated_at: NOW_ISO, ...extra };
  const names = Object.keys(cols);
  sqlite.prepare(`INSERT INTO proto_markets (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((k) => cols[k]));
  return id;
}
const row = (id) => sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(id);
const setWS = (id, side, source, { verdictId = null } = {}) => sqlite.prepare('UPDATE proto_markets SET winning_side = ?, winning_side_source = ?, winning_side_set_at = ?, winning_side_verdict_id = ? WHERE id = ?').run(side, source, NOW_ISO, verdictId, id);
const mkVerdict = (marketId, kind, outcome, pmtAt = 1_790_000_000_000) => sqlite.prepare('INSERT INTO proto_market_verdicts (market_id, source_kind, outcome, evidence_ref, created_at, pmt_at) VALUES (?,?,?,?,?,?)').run(marketId, kind, outcome, 'ev:1', NOW_ISO, pmtAt).lastInsertRowid;
const freezeRaw = (id, at = 1_790_000_000_000, reason = 'test|clock=wall') => sqlite.prepare('UPDATE proto_markets SET settlement_frozen_at = ?, frozen_reason = ? WHERE id = ?').run(at, reason, id);
const TRIGGERS = ['trg_pm_d_frozen_insert_null', 'trg_pm_d_frozen_domain', 'trg_pm_d_frozen_one_way', 'trg_pm_d_frozen_reason_required', 'trg_pm_d_reason_needs_frozen', 'trg_pm_d_frozen_no_winning_side', 'trg_pmv_d_pmt_at_domain'];
const silent = { log() {}, warn() {}, error() {} };

await t('Z1 结构: 3 个新列 + 7 个新触发器 + 重建的 verdict_ref 带 pmt_at 非空; 迁移幂等(同库再跑触发器数不变)', async () => {
  const mcols = sqlite.prepare('PRAGMA table_info(proto_markets)').all().map((c) => c.name); ok(mcols.includes('settlement_frozen_at') && mcols.includes('frozen_reason'));
  ok(sqlite.prepare('PRAGMA table_info(proto_market_verdicts)').all().map((c) => c.name).includes('pmt_at'));
  const names = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map((r) => r.name);
  const missing = TRIGGERS.filter((n) => !names.includes(n));
  if (process.env.MUT_TRIGGER && process.env.MUT_TO === '__DROP__') { ok(missing.length === 1 && missing[0] === process.env.MUT_TRIGGER, `变异只应缺被 DROP 的那一个: ${missing}`); return; }
  eq(missing.length, 0, `缺触发器: ${missing}`);
  ok(/v\.pmt_at IS NOT NULL/.test(sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'trg_pm_ws_r1_verdict_ref'").get().sql), 'verdict_ref 应含 v.pmt_at IS NOT NULL');
  if (!process.env.MUT_TRIGGER) {
    const before = sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger'").get().n;
    execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: process.env.DB_PATH }, stdio: 'pipe' });
    eq(sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger'").get().n, before, '再跑迁移后触发器数应不变');
  }
});
await t('Z2 冻结列 INSERT 必 NULL(settlement_frozen_at / frozen_reason 各自非 NULL 都拒)', () => {
  aborts(() => mkMarket({ settlement_frozen_at: 5 }), /must be NULL at INSERT/, 'frozen_at'); aborts(() => mkMarket({ frozen_reason: 'x|clock=wall' }), /must be NULL at INSERT/, 'frozen_reason');
  aborts(() => mkMarket({ settlement_frozen_at: 5, frozen_reason: 'x|clock=wall' }), /must be NULL at INSERT/, '两者');
});
await t('Z3 冻结时刻域: 0 / 负 / 小数 / 非数字文本 ⇒ 拒; 正整数 ⇒ 成功', () => {
  for (const bad of [0, -1, 1.5, 'abc']) { const id = mkMarket(); aborts(() => freezeRaw(id, bad), /positive integer/, String(bad)); eq(row(id).settlement_frozen_at, null); }
  const id = mkMarket(); eq(freezeRaw(id, 1).changes, 1); eq(row(id).settlement_frozen_at, 1);
});
await t('Z4 ▲ 冻结单向不可撤: 改时刻 / 清空 / 改 reason / 清 reason ⇒ 拒; 同值重写与无关列更新放行; 冻结市场 status 照常推进', () => {
  const id = mkMarket({ status: 'sealed' }); freezeRaw(id, 100, 'a_reason|clock=pmt');
  aborts(() => sqlite.prepare('UPDATE proto_markets SET settlement_frozen_at = 101 WHERE id = ?').run(id), /one-way/, '改时刻');
  aborts(() => sqlite.prepare('UPDATE proto_markets SET settlement_frozen_at = NULL, frozen_reason = NULL WHERE id = ?').run(id), /one-way|frozen_reason/, '清空');
  aborts(() => sqlite.prepare('UPDATE proto_markets SET settlement_frozen_at = NULL WHERE id = ?').run(id), /one-way|frozen_reason/, '只清时刻');
  aborts(() => sqlite.prepare("UPDATE proto_markets SET frozen_reason = 'other|clock=wall' WHERE id = ?").run(id), /one-way/, '改 reason');
  aborts(() => sqlite.prepare('UPDATE proto_markets SET frozen_reason = NULL WHERE id = ?').run(id), /one-way|frozen_reason/, '清 reason');
  eq(sqlite.prepare("UPDATE proto_markets SET settlement_frozen_at = 100, frozen_reason = 'a_reason|clock=pmt' WHERE id = ?").run(id).changes, 1, '同值重写放行');
  eq(sqlite.prepare("UPDATE proto_markets SET status = 'resolved', updated_at = ? WHERE id = ?").run(NOW_ISO, id).changes, 1, '无关列 / status 照常');
  eq(row(id).settlement_frozen_at, 100); eq(row(id).frozen_reason, 'a_reason|clock=pmt');
});
await t('Z5 ▲ N5a frozen_reason 必非空(NULL / 空 / 纯空白 ⇒ 拒); reason 不能脱离冻结单独写', () => {
  for (const bad of [null, '', '   ']) { const id = mkMarket(); aborts(() => sqlite.prepare('UPDATE proto_markets SET settlement_frozen_at = 5, frozen_reason = ? WHERE id = ?').run(bad, id), /frozen_reason is required/, JSON.stringify(bad)); eq(row(id).settlement_frozen_at, null); }
  const id = mkMarket(); aborts(() => sqlite.prepare("UPDATE proto_markets SET frozen_reason = 'x|clock=wall' WHERE id = ?").run(id), /cannot be set without settlement_frozen_at/);
});
await t('Z6 ▲ D2 冻结市场 winning_side 永不可写(operator / extractor / uma / human 全拒, 值不变); 同一条 UPDATE 顺带冻结 + 写值也拒; 冻结之前正常写; 写值之后仍可冻结(应急停 close_commit, 不撤已写值)', () => {
  for (const [src, needV] of [['operator', false], ['extractor', true], ['uma', true], ['human', true]]) {
    const id = mkMarket({ status: 'sealed', ...(needV ? { resolution_rule_spec: 'r' } : {}) }); const v = needV ? mkVerdict(id, src, 1) : null; freezeRaw(id);
    aborts(() => setWS(id, 1, src, { verdictId: v }), /frozen market/, src); eq(row(id).winning_side, null, src);
  }
  const same = mkMarket({ status: 'sealed' });
  aborts(() => sqlite.prepare("UPDATE proto_markets SET settlement_frozen_at = 5, frozen_reason = 'x|clock=wall', winning_side = 1, winning_side_source = 'operator', winning_side_set_at = ? WHERE id = ?").run(NOW_ISO, same), /frozen market/, '同语句');
  eq(row(same).winning_side, null); eq(row(same).settlement_frozen_at, null);
  const pre = mkMarket({ status: 'sealed' }); eq(setWS(pre, 1, 'operator').changes, 1, '冻结前正常写'); eq(freezeRaw(pre).changes, 1, '写值后仍可冻结'); eq(row(pre).winning_side, 1);
});
await t('Z7 ▲ N1 verdicts.pmt_at: 域(正整数或 NULL); append-only 保写后不可改; NULL pmt_at 的 verdict 不可被引用(extractor / uma / human 三来源), 有 pmt_at 的可引用', () => {
  const id = mkMarket({ status: 'sealed', resolution_rule_spec: 'r' });
  for (const bad of [0, -5, 1.5, 'x']) aborts(() => mkVerdict(id, 'extractor', 1, bad), /pmt_at must be a positive integer/, String(bad));
  const nul = mkVerdict(id, 'extractor', 1, null); ok(nul > 0, 'NULL pmt_at 可写入(只是不可被引用 / 不计一致性)');
  const good = mkVerdict(id, 'extractor', 1, 1_790_000_000_001);
  aborts(() => sqlite.prepare('UPDATE proto_market_verdicts SET pmt_at = 5 WHERE id = ?').run(good), /append-only/, 'pmt_at 写后不可改');
  aborts(() => sqlite.prepare('UPDATE proto_market_verdicts SET pmt_at = 5 WHERE id = ?').run(nul), /append-only/, 'NULL 也不可事后补写');
  for (const src of ['extractor', 'uma', 'human']) {
    const m = mkMarket({ status: 'sealed', resolution_rule_spec: 'r' }); const vNull = mkVerdict(m, src, 1, null); const vOk = mkVerdict(m, src, 1, 1_790_000_000_002);
    aborts(() => setWS(m, 1, src, { verdictId: vNull }), /requires winning_side_verdict_id/, `${src} 引用 NULL pmt_at`); eq(row(m).winning_side, null);
    eq(setWS(m, 1, src, { verdictId: vOk }).changes, 1, `${src} 引用有 pmt_at`);
  }
});
await t('Z8 freezeMarket: pmt 有效 ⇒ 写 pmt + reason 带 clock=pmt; pmt 无效 / null ⇒ 退墙钟 + clock=wall(N5a, 不因 pmt 无效而写不进); 二次冻结幂等不覆盖首次时刻与原因; reason 非法先抛; 市场不存在 ⇒ changes=0', () => {
  const a = mkMarket({ status: 'sealed' }); const r1 = freezeMarket({ db: sqlite, marketId: a, reason: 'past_cutoff', pmt: { valid: true, pmtMs: 1_790_000_123_456 }, wallMs: 9, log: silent });
  eq(r1.changes, 1); eq(r1.clock, 'pmt'); eq(row(a).settlement_frozen_at, 1_790_000_123_456); eq(row(a).frozen_reason, 'past_cutoff|clock=pmt');
  for (const pmt of [null, { valid: false, reason: 'not_synced' }]) { const b = mkMarket({ status: 'sealed' }); const r = freezeMarket({ db: sqlite, marketId: b, reason: 'pmt_invalid_past_cutoff', pmt, wallMs: 1_790_000_999_000, log: silent }); eq(r.clock, 'wall'); eq(row(b).settlement_frozen_at, 1_790_000_999_000); eq(row(b).frozen_reason, 'pmt_invalid_past_cutoff|clock=wall'); }
  const again = freezeMarket({ db: sqlite, marketId: a, reason: 'late_seal', pmt: null, wallMs: 5, log: silent }); eq(again.changes, 0); eq(row(a).frozen_reason, 'past_cutoff|clock=pmt'); eq(row(a).settlement_frozen_at, 1_790_000_123_456);
  aborts(() => freezeMarket({ db: sqlite, marketId: mkMarket(), reason: 'Bad Reason', pmt: null, wallMs: 5, log: silent }), null); eq(freezeMarket({ db: sqlite, marketId: 'nope', reason: 'x', pmt: null, wallMs: 5, log: silent }).changes, 0);
  eq(isMarketFrozen(sqlite, a), true); eq(isMarketFrozen(sqlite, mkMarket()), false); aborts(() => isMarketFrozen(sqlite, 'nope'), /不存在/); aborts(() => isMarketFrozen(null, 'x'), null);
});
await t('Z9 promoteWinningSide(批 B 用, 本批不接调用方): 正常 ⇒ changes=1 且审计列齐; 已冻 / 非 sealed / 已判 ⇒ changes=0(谓词同语句带 sealed ∧ 未判 ∧ 未冻, 触发器双保险); 非 promote 决定 ⇒ 抛', () => {
  const m = mkMarket({ status: 'sealed', resolution_rule_spec: 'r' }); const v1 = mkVerdict(m, 'extractor', 1);
  const decision = { action: 'promote', winningSide: 1, source: 'extractor', verdictId: Number(v1) };
  eq(promoteWinningSide({ db: sqlite, marketId: m, decision, setAtIso: NOW_ISO }).changes, 1);
  const r = row(m); eq(r.winning_side, 1); eq(r.winning_side_source, 'extractor'); eq(Number(r.winning_side_verdict_id), Number(v1)); eq(r.winning_side_set_at, NOW_ISO);
  eq(promoteWinningSide({ db: sqlite, marketId: m, decision }).changes, 0, '已判 ⇒ 0');
  const f = mkMarket({ status: 'sealed', resolution_rule_spec: 'r' }); const vf = mkVerdict(f, 'extractor', 1); freezeRaw(f);
  eq(promoteWinningSide({ db: sqlite, marketId: f, decision: { ...decision, verdictId: Number(vf) } }).changes, 0, '已冻 ⇒ 0'); eq(row(f).winning_side, null);
  const b = mkMarket({ status: 'betting', resolution_rule_spec: 'r' }); const vb = mkVerdict(b, 'extractor', 1); eq(promoteWinningSide({ db: sqlite, marketId: b, decision: { ...decision, verdictId: Number(vb) } }).changes, 0, '非 sealed ⇒ 0');
  aborts(() => promoteWinningSide({ db: sqlite, marketId: m, decision: { action: 'freeze' } }), null); aborts(() => promoteWinningSide({ db: sqlite, marketId: m, decision: null }), null);
});
await t('Z10 ▲ 晚 seal 守卫(§4): 只对判定题市场; upper < GRACE ⇒ 冻结(F2: 原 GRACE_MIN, 宽限不压缩)(late_seal, pmt 有效 clock=pmt / 无效 clock=wall / readPmt 抛 clock=wall); upper = GRACE ⇒ 不冻; 无判定题(如主网首轮 a59c 形)即使已过 cutoff 也不冻; 已冻 / 已判 / 市场缺失 ⇒ noop; 永不抛', async () => {
  const D = 1_790_000_000_000, cutoff = D + 7_200_000 - cfg.promotionSafetyMs;
  const at = (upper) => cutoff - cfg.closePipelineMarginMs - upper;
  const run = (marketId, decisionPmt, extra = {}) => applyLateSealGuard({ db: sqlite, marketId, readPmt: async () => (decisionPmt === null ? { valid: false, reason: 'not_synced' } : { valid: true, pmtMs: decisionPmt }), cfg, wallMs: () => at(cfg.graceMs + 5), log: silent, ...extra });
  const late = mkMarket({ status: 'sealed', deadline_ms: D, resolution_rule_spec: 'r' });
  let r = await run(late, at(cfg.graceMs - 1)); eq(r.applied, true); eq(r.reason, 'late_seal'); eq(row(late).frozen_reason, 'late_seal|clock=pmt'); eq(row(late).settlement_frozen_at, at(cfg.graceMs - 1));
  const edge = mkMarket({ status: 'sealed', deadline_ms: D, resolution_rule_spec: 'r' }); r = await run(edge, at(cfg.graceMs)); eq(r.applied, false); eq(r.reason, 'not_late'); eq(row(edge).settlement_frozen_at, null);
  const w1 = mkMarket({ status: 'sealed', deadline_ms: D, outcome_condition_id: 'c' }); r = await run(w1, null, { wallMs: () => at(cfg.graceMs - 1) }); eq(r.applied, true); eq(row(w1).frozen_reason, 'late_seal|clock=wall', 'pmt 无效 ⇒ 决策与冻结都退墙钟'); eq(row(w1).settlement_frozen_at, at(cfg.graceMs - 1));
  const w2 = mkMarket({ status: 'sealed', deadline_ms: D, outcome_oracle_relay_ids: '["r1"]' }); r = await applyLateSealGuard({ db: sqlite, marketId: w2, readPmt: async () => { throw new Error('ipc down'); }, cfg, wallMs: () => cutoff + 1, log: silent }); eq(r.applied, true); eq(row(w2).frozen_reason, 'late_seal|clock=wall');
  const a59c = mkMarket({ status: 'sealed', deadline_ms: D }); r = await run(a59c, cutoff + 10_000_000); eq(r.applied, false); eq(r.reason, 'not_judged'); eq(row(a59c).settlement_frozen_at, null, '无判定题的 operator 市场不因晚 seal 冻结');
  r = await run(late, at(0)); eq(r.applied, false); eq(r.reason, 'already_frozen');
  const decided = mkMarket({ status: 'sealed', deadline_ms: D, resolution_rule_spec: 'r' }); const vd = mkVerdict(decided, 'extractor', 1); setWS(decided, 1, 'extractor', { verdictId: vd }); r = await run(decided, at(0)); eq(r.reason, 'already_decided'); eq(row(decided).settlement_frozen_at, null);
  eq((await run('missing', at(0))).reason, 'market_not_found');
  const noThrow = await applyLateSealGuard({ db: { prepare() { throw new Error('db gone'); } }, marketId: 'x', readPmt: async () => null, cfg, log: silent }); eq(noThrow.applied, false); eq(noThrow.reason, 'guard_error');
});
await t('Z11 ▲ N3 判定题单一来源: operator 禁写触发器里的判定题谓词文本 == db/proto-judged.mjs 生成的文本(批 A 与批 D 共用一份定义)', () => {
  const sql = sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'trg_pm_ws_r1_operator_no_judged'").get();
  if (process.env.MUT_TRIGGER === 'trg_pm_ws_r1_operator_no_judged') return;      // 变异钩子改写了它
  ok(sql && sql.sql.includes(judgedSqlPredicate('NEW')), 'operator_no_judged 触发器应内含 judgedSqlPredicate(NEW)');
});
await t('Z12 端到端(纯 DB): promote 门 → 写值 → 冻结互斥: 门给出 promote ⇒ promoteWinningSide 落值; 门给出 freeze ⇒ freezeMarket 落冻结, 之后 promote 谓词 0 行; 两者对同一市场互斥(先到先得, 不会既冻又判)', () => {
  const D = 1_790_000_000_000, OE = D - 3_600_000, cma = OE + 60_000;
  const mk = () => { const m = mkMarket({ status: 'sealed', deadline_ms: D, outcome_end_ms: OE, resolution_rule_spec: 'r' }); const a = mkVerdict(m, 'extractor', 1, cma - 1), b = mkVerdict(m, 'uma', 1, cma); sqlite.exec(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES ('${m}-1','${m}','pk',0,10,'confirmed','${NOW_ISO}'),('${m}-2','${m}','pk',1,90,'confirmed','${NOW_ISO}')`); return { m, a, b }; };
  const g = (m, pmtMs) => evaluatePromoteGate({ market: row(m), verdicts: sqlite.prepare('SELECT id, source_kind, outcome, pmt_at FROM proto_market_verdicts WHERE market_id = ?').all(m), bets: sqlite.prepare('SELECT side, status, stake FROM proto_bets WHERE market_id = ?').all(m), pmt: { valid: true, pmtMs }, wallMs: pmtMs + 140_000, cfg });
  const p = mk(); const d = g(p.m, cma + cfg.graceMs); eq(d.action, 'promote'); eq(promoteWinningSide({ db: sqlite, marketId: p.m, decision: d, setAtIso: NOW_ISO }).changes, 1); eq(row(p.m).winning_side, d.winningSide);
  eq(g(p.m, cma + cfg.graceMs).action, 'stop', '判后门给 stop(already_decided)');
  const f = mk(); const df = g(f.m, D + 7_200_000 - cfg.promotionSafetyMs); eq(df.action, 'freeze'); eq(df.reason, 'past_cutoff');
  eq(freezeMarket({ db: sqlite, marketId: f.m, reason: df.reason, pmt: { valid: true, pmtMs: D + 7_200_000 - cfg.promotionSafetyMs }, log: silent }).changes, 1);
  eq(promoteWinningSide({ db: sqlite, marketId: f.m, decision: { action: 'promote', winningSide: 1, source: 'extractor', verdictId: Number(f.a) } }).changes, 0, '冻后 promote 谓词 0 行'); eq(row(f.m).winning_side, null);
  eq(g(f.m, cma + cfg.graceMs).action, 'stop', '冻后门给 stop(already_frozen)');
});

await t('Z13 ▲ 晚 seal 守卫接线(服务层 makeMarkLanded): seal landed 后跑守卫并保 store.markLanded 结果; relay 读不到 pmt ⇒ 退墙钟仍能冻结(N5a); 非 seal 步 / 未配预算 / 无判定题 不冻; store.markLanded 抛错 ⇒ 原样上抛且不跑守卫', async () => {
  const { makeMarkLanded } = await import('../services/proto-settlement-driver.mjs');
  const D = 1_790_000_000_000, cutoff = D + 7_200_000 - cfg.promotionSafetyMs;
  const store = { calls: [], markLanded(step, intent) { this.calls.push([step, intent.subject_id]); return { sealed: 1 }; } };
  const lateMarket = (deadline = D) => mkMarket({ status: 'sealed', deadline_ms: deadline, resolution_rule_spec: 'r' });
  const relay = (pmtMs, isSynced = true) => async () => ({ ok: true, pastMedianTimeMs: pmtMs, observedAtMs: pmtMs + 100_000, isSynced });
  const wire = (o = {}) => makeMarkLanded({ store, budget: cfg, sendCmd: relay(cutoff), relayId: 'r', db: sqlite, log: silent, ...o });
  // ① seal + 晚 + relay 报 pmt 有效 ⇒ 冻结; 返回值就是 store.markLanded 的返回值
  const m1 = lateMarket(); eq(JSON.stringify(await wire()('seal', { subject_id: m1 })), JSON.stringify({ sealed: 1 })); eq(store.calls.length, 1);
  ok(/^late_seal\|clock=/.test(row(m1).frozen_reason || ''), 'seal 后晚 seal 应冻结: ' + row(m1).frozen_reason);
  // ② relay 抛错 ⇒ 不抛, 记账照常, 守卫退墙钟: 用 deadline 落在"墙钟已过 cutoff"的位置 ⇒ late ⇒ 冻结(clock=wall)
  const m2 = lateMarket(Date.now() - 7_000_000); eq(JSON.stringify(await wire({ sendCmd: async () => { throw new Error('ipc down'); } })('seal', { subject_id: m2 })), JSON.stringify({ sealed: 1 }));
  eq(row(m2).frozen_reason, 'late_seal|clock=wall');
  // ③ 非 seal 步 / 未配预算 / 无判定题 ⇒ 不冻
  const m3 = lateMarket(); await wire()('resolve', { subject_id: m3 }); eq(row(m3).settlement_frozen_at, null);
  const m4 = lateMarket(); await wire({ budget: undefined })('seal', { subject_id: m4 }); eq(row(m4).settlement_frozen_at, null, '未配预算不跑守卫');
  const m5 = mkMarket({ status: 'sealed', deadline_ms: D }); await wire()('seal', { subject_id: m5 }); eq(row(m5).settlement_frozen_at, null, '无判定题不冻');
  // ④ store.markLanded 抛错 ⇒ 原样上抛(记账失败必须让核心报警), 且不跑守卫
  const m6 = lateMarket(); let err = null; try { await wire({ store: { markLanded() { throw new Error('db locked'); } } })('seal', { subject_id: m6 }); } catch (x) { err = x; }
  ok(err && /db locked/.test(err.message), 'markLanded 失败应上抛'); eq(row(m6).settlement_frozen_at, null);
});

console.log(`\nproto-settlement-freeze-v213.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
