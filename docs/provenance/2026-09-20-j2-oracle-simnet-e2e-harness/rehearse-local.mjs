// rehearse-local.mjs — simnet e2e 方案 §4 的【本地演练】: 临时库 + 真 derive 代码跑在受控上游(upstream-mock)上 + 模拟时钟 / pmt; 不碰 simnet / 链 / relay。
// 链上的部分(bet / seal / close_commit / convert / claim 的真广播)本演练不做, 只验 verdict → promote / 冻结 → 结算选行(listWork / dependenciesLanded)的库层接线与各臂的时间线判据。
// Run: node D:/kanet-tn12/scratch/_j2_e2e/rehearse-local.mjs   (自带临时库 + 迁移)
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const KC = process.env.E2E_REPO_KC || 'D:/kanet-tn12/scratch/_j2_wt_pointers_shape/kasia-console';
const SCEN = process.env.E2E_SCENARIO_FILE || path.join(process.env.TEMP || '/tmp', `_j2_e2e_scenario_${process.pid}.json`);   // 子进程沿用父进程定的路径(否则各按各的 pid 算 ⇒ 预加载读不到 ⇒ 全 503)
if (!process.env._E2E_REH_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_e2e_reh_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: KC, env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: KC, stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, CONSOLE_ENCRYPTION_KEY: process.env.CONSOLE_ENCRYPTION_KEY || '1'.repeat(64), KASPA_NETWORK: 'simnet', _E2E_REH_BOOTSTRAPPED: '1', E2E_SCENARIO_FILE: SCEN } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  try { fs.unlinkSync(SCEN); } catch {}
  process.exit(r.status ?? 1);
}
const here = path.dirname(fileURLToPath(import.meta.url)).split(path.sep).join('/') + '/';
const assert = (await import('node:assert/strict')).default;
const imp = (rel) => import(pathToFileURL(path.join(KC, 'src', rel)).href);
// 1) 装上游预加载(等价 --import), 之后再加载 voter, 使真 derive 的 fetch 走受控上游
const mockLines = []; const realLog = console.log; console.log = (...a) => { const s = a.join(' '); if (s.startsWith('[e2e-upstream-mock]')) mockLines.push(s); else realLog(...a); };
await import(pathToFileURL(here + 'upstream-mock.mjs').href);
mockLines.length = 0;   // 丢掉 installed 那行, 只留上游拦截日志
const voter = await imp('services/bettor-prediction-voter.js');
const { sqlite } = await imp('db/client.js');
const { runOracleAdapterTick } = await imp('lib/proto-oracle-adapter-core.mjs');
const { freezeMarket, applyLateSealGuard } = await imp('lib/proto-settlement-freeze.mjs');
const { createSettlementStore } = await imp('lib/proto-settlement-store.mjs');
const { CLAIM_DRAW_CLAIM_OUT_INDEX } = await imp('lib/proto-tx-assembly-settlement.mjs');
const { promotionCutoffPmt } = await imp('lib/proto-settlement-budget.mjs');
const { createJudgedMarket, mkSpec, condOf, e2eBudgetCfg, H } = await import(pathToFileURL(here + 'harness-lib.mjs').href);

let pass = 0, fail = 0; const t = async (n, f) => { try { await f(); pass++; realLog('[PASS] ' + n); } catch (e) { fail++; realLog('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const silent = { log() {}, warn() {}, error() {} };
const cfg = await e2eBudgetCfg();
sqlite.prepare('INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)').run('tokE2E', 'E2E', 'E2E', new Date().toISOString());

// ── 场景文件 ──
let scenarioV = 0;
const espn = (state, o = {}) => ({ state, home: 'LAL', away: 'BOS', homeScore: 110, awayScore: 100, homeWins: true, ...o });
const writeScenario = (over = {}) => { scenarioV++; fs.writeFileSync(SCEN, JSON.stringify({ version: scenarioV, espn: { ...base.espn, ...(over.espn || {}) }, polymarket: { ...base.polymarket, ...(over.polymarket || {}) } })); };
const YES = { prices: ['1', '0'] }, NO = { prices: ['0', '1'] };
const base = {
  espn: { 9001: espn('final'), 9002: espn('final'), 9003: espn('final', { home: 'MIA', away: 'NYK' }), 9004: espn('in'), 9005: espn('final'), 9006: espn('final'), 9007: espn('final') },
  polymarket: { [condOf(9001)]: YES, [condOf(9002)]: NO, [condOf(9003)]: YES, [condOf(9004)]: YES, [condOf(9005)]: YES, [condOf(9006)]: NO, [condOf(9007)]: YES },
};
writeScenario();

// ── 时间线(模拟时钟; 创建校验用真实 Date.now) ──
const t0 = Date.now(), MIN = 60_000;
const OE = t0 + 12 * MIN, D = t0 + 22 * MIN, CUT = promotionCutoffPmt(D, cfg);
const LAG = 264_000;                                 // ≈ 1315 块 × 0.2s: 矿工 5 块/s 时 pmt 落后墙钟
const clock = { wall: 0, pmt: 0, valid: true };
const setClock = (wall, { valid = true, lag = LAG } = {}) => { clock.wall = wall; clock.pmt = wall - lag; clock.valid = valid; };
const readPmt = async () => (clock.valid ? { valid: true, pmtMs: clock.pmt } : { valid: false, reason: 'not_synced' });
const dbg = process.env.E2E_DEBUG ? console : silent;
const tick = async () => { const s = await runOracleAdapterTick({ db: sqlite, readPmt, deriveExtractor: voter.deriveKanetNativeVote, deriveUma: voter.derivePolymarketVote, cfg, network: 'simnet', umaWindowMs: voter.UMA_FINALIZATION_WINDOW_MS, env: {}, nowMs: () => clock.wall, log: dbg, limit: 20 }); if (process.env.E2E_DEBUG) realLog('  tick summary', JSON.stringify(s)); return s; };
const M = (id) => sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(id);
const V = (id) => sqlite.prepare('SELECT source_kind, outcome, pmt_at, evidence_ref FROM proto_market_verdicts WHERE market_id = ? ORDER BY id').all(id);
const standIn = (id) => { sqlite.exec(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES ('${id}-0','${id}','pk0',0,600,'confirmed','${new Date().toISOString()}'),('${id}-1','${id}','pk1',1,700,'confirmed','${new Date().toISOString()}')`); sqlite.prepare("UPDATE proto_markets SET status = 'sealed' WHERE id = ?").run(id); };   // 链上 bet/seal 的本地替身(仅演练)

// ── 建市场(经 harness-lib: 真校验 + 真 genesis artifacts + ensureMarketPending) ──
const ids = {};
const mkArm = async (arm, event, opts = {}) => { const r = await createJudgedMarket({ tokenId: 'tokE2E', title: `e2e ${arm}`, deadlineMs: opts.deadline ?? D, outcomeEndMs: opts.oe ?? OE, spec: mkSpec({ event, ...(opts.spec || {}) }), conditionId: condOf(event) }); ids[arm] = r.id; standIn(r.id); };
await t('X0 harness 建 8 个判定题市场(H D A T F P L + 哨兵前置): 真 validateJudgedMarketInput + genesis artifacts + ensureMarketPending; judged 列落库、status 由本地替身推到 sealed', async () => {
  await mkArm('H', 9001); await mkArm('D', 9002); await mkArm('A', 9003, { spec: { predicate: { metric: 'margin', op: '>=', operand: 55, scale: 1, subject: 'LAL' } } });
  await mkArm('T', 9004); await mkArm('F', 9005); await mkArm('P', 9006, { oe: OE + 3 * MIN });
  await mkArm('L', 9007, { deadline: t0 + 10 * MIN, oe: t0 + 80 * MIN });
  for (const [arm, id] of Object.entries(ids)) { const m = M(id); assert.ok(m.resolution_rule_spec && m.outcome_market_source === 'polymarket' && m.outcome_condition_id === condOf(Number(JSON.parse(m.resolution_rule_spec).data_source_canonical.split('event=')[1])) && m.outcome_oracle_relay_ids === '[]' && m.outcome_end_ms > 0, arm); assert.equal(m.status, 'sealed'); assert.equal(m.winning_side, null); }
  assert.equal(cfg.graceMs, 120_000); assert.equal(cfg.promotionSafetyMs, 3_600_000); assert.equal(CUT, D + 2 * H - 3_600_000);
});
// L 臂先脱离候选(它走 seal 时晚 seal 守卫, 不参与 verdict 阶段)
sqlite.prepare("UPDATE proto_markets SET outcome_end_ms = ? WHERE id = ?").run(t0 + 80 * MIN, ids.L);

await t('E1 wall<oe: 无候选(未到期不被扫)', async () => { setClock(OE - MIN); const s = await tick(); assert.equal(s.scanned, 0); assert.equal(mockLines.length, 0, '未到期 ⇒ 不 fetch 上游'); });

let pH, pT;
await t('E2 ▲ wall=oe+1min, pmt 有效但 pmt<oe(落后 4.4min): H/F 批准票延后(M1: 不写); T ESPN in-progress ⇒ 暂态不写; D / A 异议 / ABSTAIN 照写(带 pmt_at<oe)', async () => {
  setClock(OE + MIN); const s = await tick(); assert.ok(clock.pmt < OE);
  for (const a of ['H', 'F', 'T']) assert.equal(V(ids[a]).length, 0, a + ' 无 verdict');
  assert.deepEqual(V(ids.D).map((v) => [v.source_kind, v.outcome, v.pmt_at]), [['extractor', 1, clock.pmt], ['uma', 0, clock.pmt]], 'D 冲突各方都写');
  assert.deepEqual(V(ids.A).map((v) => [v.source_kind, v.outcome]), [['extractor', null]], 'A: judgeline-abstain ⇒ extractor NULL');
  assert.ok(mockLines.some((l) => l.includes('espn') && l.includes('key=9004') && l.includes('state=in')), '预加载日志可见 T 的 in-progress'); void s;
});
await t('E3 ▲ P 臂: wall=oe+4min, pmt 无效(矿工停顿)⇒ P 的冲突票仍写(pmt_at=NULL); H/F 批准票仍不写', async () => {
  setClock(OE + 4 * MIN, { valid: false }); await tick();
  assert.deepEqual(V(ids.P).map((v) => [v.source_kind, v.outcome, v.pmt_at]), [['extractor', 1, null], ['uma', 0, null]], 'P: 异议带 pmt_at=NULL 也写(B4)');
  for (const a of ['H', 'F']) assert.equal(V(ids[a]).length, 0);
  assert.equal(M(ids.P).settlement_frozen_at, null, 'pmt 无效 ∧ 未过 cutoff ⇒ 门 wait, 不冻');
});
await t('E4 ▲ pmt 恢复且 ≥ oe: H/F 批准票写入(pmt_at≥oe)进宽限窗; D/A/P 被门冻结(inconsistent_verdicts / abstain_or_dispute); T 仍 in-progress ⇒ 无行', async () => {
  setClock(OE + 9 * MIN); assert.ok(clock.pmt >= OE + 3 * MIN); const s = await tick(); pH = clock.pmt;
  for (const a of ['H', 'F']) { const vs = V(ids[a]); assert.deepEqual(vs.map((v) => [v.source_kind, v.outcome]), [['extractor', 1], ['uma', 1]], a); assert.ok(vs.every((v) => v.pmt_at >= OE && v.pmt_at === pH), a + ' pmt_at≥oe'); assert.equal(M(ids[a]).winning_side, null, '宽限窗内不 promote'); }
  assert.match(M(ids.D).frozen_reason, /^inconsistent_verdicts\|clock=pmt/); assert.match(M(ids.A).frozen_reason, /^abstain_or_dispute\|clock=pmt/); assert.match(M(ids.P).frozen_reason, /^inconsistent_verdicts\|clock=pmt/);
  // T: extractor 侧 in-progress(暂态, 无行); uma 侧独立成票 ⇒ 只有一条 uma 行(两路互不牵连), 且不冻结
  assert.deepEqual(V(ids.T).map((v) => [v.source_kind, v.outcome, v.pmt_at]), [['uma', 1, pH]]); assert.equal(M(ids.T).settlement_frozen_at, null); void s;
});
await t('E5 ▲ T 臂热切换: 场景改 final ⇒ 下 tick 写 T 的两票并进宽限窗(暂态不冻结 + 热切换)', async () => {
  writeScenario({ espn: { 9004: espn('final') } }); setClock(OE + 10 * MIN); await tick(); pT = clock.pmt;
  assert.deepEqual(V(ids.T).map((v) => [v.source_kind, v.outcome, v.pmt_at]), [['uma', 1, pH], ['extractor', 1, pT]], 'extractor 只在热切成 final 后才写, uma 行沿用早先的'); assert.ok(pT > pH); assert.equal(M(ids.T).settlement_frozen_at, null);
});
await t('E6 ▲ 宽限窗后 promote: H / F / T 写 winning_side(source=extractor, verdict_id 指 extractor 行, set_at 有值); 冻结的 D/A/P 不动', async () => {
  setClock(pH + cfg.graceMs + 1000 + LAG); await tick(); assert.ok(clock.pmt >= pH + cfg.graceMs && clock.pmt < pT + cfg.graceMs);   // H/F 的宽限窗从 pH 起算, T 的从 pT(第二源写入时刻)起算
  for (const a of ['H', 'F']) { const m = M(ids[a]); assert.equal(m.winning_side, 1, a); assert.equal(m.winning_side_source, 'extractor'); assert.ok(m.winning_side_set_at); assert.equal(m.winning_side_verdict_id, sqlite.prepare("SELECT id FROM proto_market_verdicts WHERE market_id = ? AND source_kind = 'extractor'").get(ids[a]).id); }
  assert.equal(M(ids.T).winning_side, null, 'T 的宽限窗从 pT(晚一个 tick)起算, 此刻尚未满');
  setClock(pT + cfg.graceMs + 1000 + LAG); await tick(); assert.equal(M(ids.T).winning_side, 1, 'T 宽限窗从 pT 起算, 满了才 promote');
  for (const a of ['D', 'A', 'P']) assert.equal(M(ids[a]).winning_side, null);
});
await t('E7 ▲ F 臂(D1 三入口): promote 后、pmt 越过 D+30s 之前应急冻结 ⇒ 之后 close_commit 选行不含 F(入口①), dependenciesLanded 拒 settlement_frozen(入口②); H / T 正常在选行里', async () => {
  const fr = freezeMarket({ db: sqlite, marketId: ids.F, reason: 'operator_emergency_stop', pmt: { valid: true, pmtMs: clock.pmt }, wallMs: clock.wall, log: silent }); assert.equal(fr.changes, 1);
  assert.notEqual(M(ids.F).winning_side, null, 'winning_side 已写 ∧ 冻结(批 D 设计保留的应急出口)');
  setClock(D + 3 * MIN);                                   // pmt = D + 3min − 4.4min ⇒ 未越过 D; 再走一段
  setClock(D + 10 * MIN); assert.ok(clock.pmt > D + 30_000);
  const store = createSettlementStore({ db: sqlite, claimDrawClaimOutIndex: CLAIM_DRAW_CLAIM_OUT_INDEX });
  const work = store.listWork({ limit: 50 }).advances.filter((w) => w.step === 'close_commit').map((w) => w.marketId);
  assert.ok(work.includes(ids.H) && work.includes(ids.T), 'H / T 在 close_commit 选行里'); for (const a of ['F', 'D', 'A', 'P', 'L']) assert.ok(!work.includes(ids[a]), a + ' 不在选行里');
  const dep = store.dependenciesLanded('close_commit', { subjectId: ids.F, marketId: ids.F }); assert.deepEqual([dep.ok, dep.reason], [false, 'settlement_frozen']);
  assert.equal(await store.isSettlementFrozen(ids.F), true);
});
await t('E8 ▲ L 臂(晚 seal): seal 落地时 cutoff−pmt−margin < graceMin ⇒ applyLateSealGuard 冻结 late_seal(clock=pmt); 对照: 早 seal(pmt 距 cutoff 远)不冻', async () => {
  const lm = M(ids.L); const cut = promotionCutoffPmt(lm.deadline_ms, cfg);
  const early = await applyLateSealGuard({ db: sqlite, marketId: ids.L, readPmt: async () => ({ valid: true, pmtMs: cut - 20 * MIN }), cfg, wallMs: () => cut - 15 * MIN, log: silent }); assert.deepEqual([early.applied, early.reason], [false, 'not_late']);
  const late = await applyLateSealGuard({ db: sqlite, marketId: ids.L, readPmt: async () => ({ valid: true, pmtMs: cut - 2.5 * MIN }), cfg, wallMs: () => cut, log: silent }); assert.deepEqual([late.applied, late.reason, late.clock], [true, 'late_seal', 'pmt']);
  assert.match(M(ids.L).frozen_reason, /^late_seal\|clock=pmt/); assert.equal(V(ids.L).length, 0); assert.equal(M(ids.L).winning_side, null);
});
await t('E9 全局不变量: 无批准票 pmt_at<oe; 无重复 (market, source_kind, evidence_ref); evidence_ref 与上游场景原文哈希吻合(uma 行可复算)', async () => {
  const bad = sqlite.prepare(`SELECT v.id FROM proto_market_verdicts v JOIN proto_markets m ON m.id = v.market_id WHERE v.outcome IS NOT NULL AND v.source_kind IN ('extractor','uma') AND v.pmt_at IS NOT NULL AND v.pmt_at < m.outcome_end_ms AND m.winning_side IS NOT NULL`).all(); assert.equal(bad.length, 0, '已 promote 市场里没有 pmt_at<oe 的批准票');
  const dup = sqlite.prepare('SELECT market_id, source_kind, evidence_ref, count(*) n FROM proto_market_verdicts GROUP BY 1,2,3 HAVING n > 1').all(); assert.equal(dup.length, 0);
  const { createHash } = await import('node:crypto'); const u = sqlite.prepare("SELECT evidence_ref FROM proto_market_verdicts WHERE market_id = ? AND source_kind = 'uma'").get(ids.H).evidence_ref;
  const raw = JSON.stringify({ outcomePrices: JSON.stringify(['1', '0']), closed: true, closedTime: '2020-01-01T00:00:00.000Z' });   // 与 derive 内 evidence_raw 同构(endDate 缺 ⇒ undefined 不入 JSON)
  assert.ok(u.startsWith(`https://gamma-api.polymarket.com/markets?condition_ids=${condOf(9001)}&closed=true#sha256:`), 'evidence_url 指向被拦截的 gamma 查询'); assert.equal(u.split('#sha256:')[1], createHash('sha256').update(raw).digest('hex'), 'evidence_ref 哈希 = sha256(场景原文)——可由场景文件独立复算');
  assert.ok(mockLines.length > 10, '预加载留下了拦截日志: ' + mockLines.length + ' 行');
});
if (process.env.E2E_KEEP) {   // 留下 DB 拷贝 + 臂映射 + 场景, 供 verify-arms.mjs 在拷贝上做只读验收(演练本身不依赖)
  fs.mkdirSync(process.env.E2E_KEEP, { recursive: true }); sqlite.pragma('wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(process.env.DB_PATH, path.join(process.env.E2E_KEEP, 'rehearsal.db')); fs.copyFileSync(SCEN, path.join(process.env.E2E_KEEP, 'scenario.json'));
  fs.writeFileSync(path.join(process.env.E2E_KEEP, 'arms.json'), JSON.stringify(ids, null, 1)); fs.writeFileSync(path.join(process.env.E2E_KEEP, 'pmt-now.txt'), String(clock.pmt));
}
realLog(`\ne2e local rehearsal: ${pass} passed, ${fail} failed`);
realLog('--- 各臂终态 ---'); for (const [arm, id] of Object.entries(ids)) { const m = M(id); realLog(`${arm}: status=${m.status} winning_side=${m.winning_side} src=${m.winning_side_source} frozen=${m.frozen_reason || '-'} verdicts=${JSON.stringify(V(id).map((v) => [v.source_kind, v.outcome, v.pmt_at === null ? null : v.pmt_at - t0]))}`); }
process.exit(fail ? 1 : 0);
