// proto-winning-side-triggers-v212.test.mjs — oracle→winning_side 整合批 A(v212): proto_markets.winning_side 的 DB 层防御(R1) + 题面不可改(R4) + proto_market_verdicts 追加表。
// 设计 docs/2026-09-20-bettor-oracle-to-proto-winning-side-integration-design-v0.1.md §3.1 / §7-A / §10 R1·R4(NWT 复核 GREEN dff2d8ba)。
// 真 migration 临时库(DB_PATH); 零链 / 零 IPC / 零私钥。Run: cd kasia-console && node src/db/proto-winning-side-triggers-v212.test.mjs
// 🟡 诚实边界(设计 §10 R1 末句): 触发器防应用 / 运维失误与手写 SQL, 不防能 DROP TRIGGER / 伪造 verdict 行的机器写权——本测试不声称防这个。
// 变异钩子(仅本测试文件): MUT_TRIGGER=<触发器名> MUT_FROM=<原片段> MUT_TO=<替换片段 | __DROP__> ⇒ 迁移后就地改写该触发器再跑全套, 全套必须变红(见 docs/provenance/.../mutate-*.mjs)。
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PMV212_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_pmv212_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PMV212_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
const { sqlite } = await import('./client.js');

// ── 变异钩子 ──
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
/** fn 必须抛 SqliteError 且报文匹配 re(触发器 RAISE 文案 / CHECK / FK) */
function aborts(fn, re, label = '') {
  let e = null; try { fn(); } catch (x) { e = x; }
  if (!e) throw new Error(`${label} 应该 ABORT, 实际成功`);
  if (re && !re.test(e.message)) throw new Error(`${label} 抛了但报文不对: ${e.message}`);
}
const NOW = '2026-09-20T00:00:00.000Z';
let seq = 0;
const nid = (p = 'm') => `${p}${String(++seq).padStart(4, '0')}`;
sqlite.prepare('INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)').run('tok1', 'Test', 'TST', NOW);

/** 造市场: status 默认 genesis_pending(新建市场); extra 里可给判定题列 / shardleaf_txid / genesis_submitted_txid 等 */
function mkMarket({ id = nid(), status = 'genesis_pending', ...extra } = {}) {
  const cols = { id, token_def_id: 'tok1', question: 'q?', deadline_ms: 1700000000000, min_bet: 1, seal_count: 2, committee_pubkeys_json: '[]', committee_privkey_enc: 'enc', rootclose_tmpl_hash: 'aa'.repeat(32), status, created_at: NOW, updated_at: NOW, ...extra };
  const names = Object.keys(cols);
  sqlite.prepare(`INSERT INTO proto_markets (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((k) => cols[k]));
  return id;
}
const row = (id) => sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(id);
const setWS = (id, side, source, { verdictId = null, setAt = NOW } = {}) =>
  sqlite.prepare('UPDATE proto_markets SET winning_side = ?, winning_side_source = ?, winning_side_set_at = ?, winning_side_verdict_id = ? WHERE id = ?').run(side, source, setAt, verdictId, id);
const mkVerdict = (marketId, kind, outcome, extra = {}) => sqlite.prepare('INSERT INTO proto_market_verdicts (market_id, source_kind, relay_id, outcome, confidence, evidence_ref, created_at) VALUES (?,?,?,?,?,?,?)')
  .run(marketId, kind, extra.relay ?? null, outcome, extra.conf ?? null, extra.ev ?? 'ev:1', NOW).lastInsertRowid;
const TRIGGERS = ['trg_pmv_append_only_update', 'trg_pmv_append_only_delete', 'trg_pm_ws_r1_insert_existing_id', 'trg_pm_ws_r1_insert_null', 'trg_pm_ws_r1_write_once', 'trg_pm_ws_r1_value_domain',
  'trg_pm_ws_r1_status_sealed', 'trg_pm_ws_r1_source_required', 'trg_pm_ws_r1_set_at_required', 'trg_pm_ws_r1_operator_no_judged', 'trg_pm_ws_r1_operator_no_verdict', 'trg_pm_ws_r1_verdict_ref',
  'trg_pm_ws_r1_audit_needs_value', 'trg_pm_ws_r1_audit_immutable', 'trg_pm_ws_r1_delete_guard', 'trg_pm_r4_question_immutable'];
const JUDGED_COLS = [['resolution_rule_spec', '{"rule":1}'], ['outcome_market_source', 'polymarket'], ['outcome_condition_id', '0xabc'], ['outcome_oracle_relay_ids', '["r1","r2"]']];

// ══ S 系列: 结构 ═══════════════════════════════════════════════════════════════════════════════════
await t('S1 结构: verdicts 表 + 9 个新列 + 16 个触发器全在; 迁移幂等(同库再跑一次不抛、触发器数不变)', async () => {
  const cols = sqlite.prepare('PRAGMA table_info(proto_markets)').all().map((c) => c.name);
  for (const c of ['winning_side_source', 'winning_side_set_at', 'winning_side_verdict_id', 'outcome_oracle_relay_ids', 'resolution_rule_spec', 'outcome_market_source', 'outcome_condition_id', 'outcome_end_ms']) ok(cols.includes(c), c);
  const vcols = sqlite.prepare('PRAGMA table_info(proto_market_verdicts)').all().map((c) => c.name);
  for (const c of ['id', 'market_id', 'source_kind', 'relay_id', 'outcome', 'confidence', 'evidence_ref', 'created_at']) ok(vcols.includes(c), 'verdicts.' + c);
  const names = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map((r) => r.name);
  const missing = TRIGGERS.filter((n) => !names.includes(n));
  if (process.env.MUT_TRIGGER && process.env.MUT_TO === '__DROP__') { ok(missing.length === 1 && missing[0] === process.env.MUT_TRIGGER, `变异只应缺被 DROP 的那一个: ${missing}`); return; }
  eq(missing.length, 0, `缺触发器: ${missing}`);
  const before = sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger'").get().n;
  if (!process.env.MUT_TRIGGER) {
    execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: process.env.DB_PATH }, stdio: 'pipe' });
    eq(sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger'").get().n, before, '再跑迁移后触发器数应不变');
  }
});

// ══ I 系列: R1 INSERT ═════════════════════════════════════════════════════════════════════════════
await t('I1 INSERT 带 winning_side / 任一审计列非 NULL ⇒ ABORT(四列逐个)', async () => {
  const m0 = mkMarket({ status: 'sealed' }); const vid = mkVerdict(m0, 'extractor', 1);
  for (const [c, v] of [['winning_side', 1], ['winning_side_source', 'operator'], ['winning_side_set_at', NOW], ['winning_side_verdict_id', vid]]) aborts(() => mkMarket({ [c]: v }), /must be NULL at INSERT/, c);
});
await t('I2 ▲ 已存在 id 的任何 INSERT 变体一律 ABORT 且原行(含 winning_side)分毫不动: 普通 / OR IGNORE / OR REPLACE / REPLACE INTO / upsert DO UPDATE / DO NOTHING', async () => {
  const id = mkMarket({ status: 'sealed' }); setWS(id, 1, 'operator');
  const snap = JSON.stringify(row(id));
  const ins = (verb, tail = '') => sqlite.prepare(`${verb} proto_markets (id,token_def_id,deadline_ms,min_bet,committee_pubkeys_json,committee_privkey_enc,rootclose_tmpl_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ${tail}`)
    .run(id, 'tok1', 1, 1, '[]', 'enc', 'aa'.repeat(32), 'sealed', NOW, NOW);
  for (const [name, fn] of [['INSERT', () => ins('INSERT INTO')], ['INSERT OR IGNORE', () => ins('INSERT OR IGNORE INTO')], ['INSERT OR REPLACE', () => ins('INSERT OR REPLACE INTO')],
    ['REPLACE INTO', () => ins('REPLACE INTO')], ['upsert DO UPDATE', () => ins('INSERT INTO', 'ON CONFLICT(id) DO UPDATE SET status = excluded.status')], ['upsert DO NOTHING', () => ins('INSERT INTO', 'ON CONFLICT(id) DO NOTHING')]]) {
    aborts(fn, /existing id/, name);
    eq(JSON.stringify(row(id)), snap, `${name} 后原行应逐字段不变`);
  }
});

// ══ W 系列: R1 UPDATE winning_side ════════════════════════════════════════════════════════════════
await t('W1 主路径: sealed + 非判定题市场, operator 写 winning_side(带 source + set_at)⇒ 成功; 之后再写 / 写回 NULL / 改审计列 / 改值 ⇒ ABORT; 而 status→resolved(不碰 winning_side)照常成功', async () => {
  const id = mkMarket({ status: 'sealed' });
  eq(setWS(id, 1, 'operator').changes, 1);
  eq(row(id).winning_side, 1); eq(row(id).winning_side_source, 'operator'); eq(row(id).winning_side_set_at, NOW);
  aborts(() => setWS(id, 1, 'operator'), /write-once|immutable/, '同值再写');
  aborts(() => setWS(id, 0, 'operator'), /write-once|immutable/, '改值');
  aborts(() => sqlite.prepare('UPDATE proto_markets SET winning_side = NULL WHERE id = ?').run(id), /write-once|immutable|cannot be set without/, '写回 NULL');
  aborts(() => sqlite.prepare("UPDATE proto_markets SET winning_side_source = 'human' WHERE id = ?").run(id), /immutable/, '改 source(不带 winning_side)');
  aborts(() => sqlite.prepare("UPDATE proto_markets SET winning_side_set_at = 'x' WHERE id = ?").run(id), /immutable/, '改 set_at');
  aborts(() => sqlite.prepare('UPDATE proto_markets SET winning_side_verdict_id = NULL, winning_side_source = NULL WHERE id = ?').run(id), /immutable/, '清审计列');
  eq(sqlite.prepare("UPDATE proto_markets SET status = 'resolved', updated_at = ? WHERE id = ? AND status = 'sealed'").run(NOW, id).changes, 1, '驱动的 sealed→resolved 不受影响');
  eq(row(id).winning_side, 1);
});
await t('W2 受控写法(主网首轮同形, 双守卫 WHERE)兼容: 带 source+set_at ⇒ changes=1; 已写过再跑 ⇒ 守卫命中 0 行(changes=0, 不触发触发器); 旧写法(不带 source)⇒ ABORT', async () => {
  const id = mkMarket({ status: 'sealed' });
  const good = () => sqlite.prepare("UPDATE proto_markets SET winning_side = ?, winning_side_source = 'operator', winning_side_set_at = ?, updated_at = ? WHERE id = ? AND status = 'sealed' AND winning_side IS NULL").run(1, NOW, NOW, id).changes;
  aborts(() => sqlite.prepare("UPDATE proto_markets SET winning_side = ?, updated_at = ? WHERE id = ? AND winning_side IS NULL AND status = 'sealed'").run(1, NOW, id), /source is required|set_at is required/, '旧写法');
  eq(row(id).winning_side, null, '旧写法被拒后应没写进去');
  eq(good(), 1); eq(good(), 0, '第二次: WHERE 守卫 0 行');
});
await t('W3 值域: 2 / -1 / 1.5 / "abc" ⇒ ABORT(integer 0|1); 0 与 1 各自成功', async () => {
  for (const bad of [2, -1, 1.5, 'abc']) { const id = mkMarket({ status: 'sealed' }); aborts(() => setWS(id, bad, 'operator'), /integer 0 or 1/, String(bad)); eq(row(id).winning_side, null); }
  for (const v of [0, 1]) { const id = mkMarket({ status: 'sealed' }); eq(setWS(id, v, 'operator').changes, 1); eq(row(id).winning_side, v); }
});
await t('W4 ▲ status 必须 sealed(OLD 与 NEW 都是): betting / genesis_* / resolved / cancelled 拒; 同一条 UPDATE 顺带改 status 也拒(sealed→resolved 一并写值 / betting→sealed 一并写值)', async () => {
  for (const st of ['genesis_pending', 'genesis_prepared', 'genesis_submitted', 'genesis_ambiguous', 'betting', 'resolved', 'cancelled']) {
    const id = mkMarket({ status: st }); aborts(() => setWS(id, 1, 'operator'), /status='sealed'/, st); eq(row(id).winning_side, null, st);
  }
  const a = mkMarket({ status: 'sealed' });
  aborts(() => sqlite.prepare("UPDATE proto_markets SET status='resolved', winning_side=1, winning_side_source='operator', winning_side_set_at=? WHERE id=?").run(NOW, a), /status='sealed'/, 'NEW.status=resolved');
  const b = mkMarket({ status: 'betting' });
  aborts(() => sqlite.prepare("UPDATE proto_markets SET status='sealed', winning_side=1, winning_side_source='operator', winning_side_set_at=? WHERE id=?").run(NOW, b), /status='sealed'/, 'betting→sealed 一并写值');
});
await t('W5 source / set_at 必填: source 为 NULL / 不在集合内(CHECK) / set_at 为 NULL / 空白 ⇒ 拒', async () => {
  const id = mkMarket({ status: 'sealed' });
  aborts(() => setWS(id, 1, null), /winning_side_source is required/, 'source NULL');
  aborts(() => setWS(id, 1, 'llm'), /CHECK|source/, "source='llm'");
  aborts(() => setWS(id, 1, 'root'), /CHECK|source/, "source='root'");
  aborts(() => setWS(id, 1, 'operator', { setAt: null }), /set_at is required/, 'set_at NULL');
  aborts(() => setWS(id, 1, 'operator', { setAt: '   ' }), /set_at is required/, 'set_at 空白');
  eq(row(id).winning_side, null);
});
await t('W6 ▲ 审计列不能脱离值单独写: 只写 source / set_at / verdict_id 而 winning_side 仍 NULL ⇒ ABORT', async () => {
  const id = mkMarket({ status: 'sealed' }); const v = mkVerdict(id, 'extractor', 1);
  aborts(() => sqlite.prepare("UPDATE proto_markets SET winning_side_source = 'operator' WHERE id = ?").run(id), /cannot be set without winning_side/, 'source');
  aborts(() => sqlite.prepare("UPDATE proto_markets SET winning_side_set_at = ? WHERE id = ?").run(NOW, id), /cannot be set without winning_side/, 'set_at');
  aborts(() => sqlite.prepare('UPDATE proto_markets SET winning_side_verdict_id = ? WHERE id = ?').run(v, id), /cannot be set without winning_side/, 'verdict_id');
});

// ══ O 系列: operator 禁写判定题市场 / verdict 引用 ═════════════════════════════════════════════════
await t('O1 ▲ operator 禁写有判定题的市场(4 个判定题列各自单独非 NULL 即算, 含空串); 无判定题(全 NULL)成功', async () => {
  for (const [c, v] of JUDGED_COLS) { const id = mkMarket({ status: 'sealed', [c]: v }); aborts(() => setWS(id, 1, 'operator'), /forbidden on a market with a resolution question/, c); eq(row(id).winning_side, null, c); }
  const e = mkMarket({ status: 'sealed', resolution_rule_spec: '' }); aborts(() => setWS(e, 1, 'operator'), /forbidden on a market with a resolution question/, '空串也算判定题');
  eq(setWS(mkMarket({ status: 'sealed', outcome_end_ms: 123 }), 1, 'operator').changes, 1);   // outcome_end_ms 单独不构成"判定题"
});
await t('O2 operator 不得携带 verdict 引用', async () => {
  const id = mkMarket({ status: 'sealed' }); const v = mkVerdict(id, 'extractor', 1);
  aborts(() => setWS(id, 1, 'operator', { verdictId: v }), /must not carry a verdict reference/);
});
await t('V1 ▲ 伪造 / 错配 verdict ⇒ ABORT: 无 verdict_id / 指向不存在 id / 指向别的市场 / outcome 不一致 / source_kind 与 source 不一致 / llm 类 verdict 永不能提升', async () => {
  for (const src of ['extractor', 'uma', 'human']) {
    const id = mkMarket({ status: 'sealed', resolution_rule_spec: 'r' }); const other = mkMarket({ status: 'sealed', resolution_rule_spec: 'r' });
    aborts(() => setWS(id, 1, src), /requires winning_side_verdict_id/, `${src} 无 verdict_id`);
    aborts(() => setWS(id, 1, src, { verdictId: 999999 }), /FOREIGN KEY|requires winning_side_verdict_id/, `${src} 指向不存在`);
    aborts(() => setWS(id, 1, src, { verdictId: mkVerdict(other, src, 1) }), /requires winning_side_verdict_id/, `${src} 别的市场`);
    aborts(() => setWS(id, 1, src, { verdictId: mkVerdict(id, src, 0) }), /requires winning_side_verdict_id/, `${src} outcome 不一致`);
    const wrongKind = src === 'uma' ? 'extractor' : 'uma';
    aborts(() => setWS(id, 1, src, { verdictId: mkVerdict(id, wrongKind, 1) }), /requires winning_side_verdict_id/, `${src} source_kind 不一致`);
    aborts(() => setWS(id, 1, src, { verdictId: mkVerdict(id, 'llm', 1) }), /requires winning_side_verdict_id/, `${src} 引用 llm 判定`);
    eq(row(id).winning_side, null, src);
  }
});
await t('V2 合法提升: extractor / uma / human 各引用同市场同值同类 verdict ⇒ 成功(判定题市场也行), 落审计列', async () => {
  for (const [src, side] of [['extractor', 1], ['uma', 0], ['human', 1]]) {
    const id = mkMarket({ status: 'sealed', resolution_rule_spec: 'r', outcome_oracle_relay_ids: '["r1"]' }); const v = mkVerdict(id, src, side, { relay: 'r1', conf: 0.9 });
    eq(setWS(id, side, src, { verdictId: v }).changes, 1, src);
    const r = row(id); eq(r.winning_side, side); eq(r.winning_side_source, src); eq(Number(r.winning_side_verdict_id), Number(v));
    const v2 = mkVerdict(id, src, side);   // 同市场同值同类的另一条合法 verdict: 提升之后审计引用也不可改(只改 verdict_id, 不动 source / set_at)
    aborts(() => sqlite.prepare('UPDATE proto_markets SET winning_side_verdict_id = ? WHERE id = ?').run(v2, id), /immutable/, `${src} 改 verdict_id`);
    aborts(() => sqlite.prepare('UPDATE proto_markets SET winning_side_verdict_id = NULL WHERE id = ?').run(id), /immutable/, `${src} 清 verdict_id`);
    eq(Number(row(id).winning_side_verdict_id), Number(v));
  }
});

// ══ D 系列: verdicts 表本身 ═══════════════════════════════════════════════════════════════════════
await t('D1 verdicts append-only: UPDATE / DELETE 一律 ABORT; 行不变', async () => {
  const id = mkMarket({ status: 'sealed' }); const v = mkVerdict(id, 'llm', 1);
  aborts(() => sqlite.prepare('UPDATE proto_market_verdicts SET outcome = 0 WHERE id = ?').run(v), /append-only/, 'UPDATE');
  aborts(() => sqlite.prepare('DELETE FROM proto_market_verdicts WHERE id = ?').run(v), /append-only/, 'DELETE');
  eq(sqlite.prepare('SELECT outcome FROM proto_market_verdicts WHERE id = ?').get(v).outcome, 1);
});
await t('D2 verdicts 列约束: outcome∉{0,1} / source_kind 非法 / confidence 越界 / evidence_ref 空白或 NULL / market_id 不存在 ⇒ 拒', async () => {
  const id = mkMarket({ status: 'sealed' });
  const ins = (kind, outcome, conf, ev, mid = id) => sqlite.prepare('INSERT INTO proto_market_verdicts (market_id, source_kind, outcome, confidence, evidence_ref, created_at) VALUES (?,?,?,?,?,?)').run(mid, kind, outcome, conf, ev, NOW);
  aborts(() => ins('extractor', 2, null, 'e'), /CHECK/, 'outcome=2'); aborts(() => ins('bogus', 1, null, 'e'), /CHECK/, 'kind');
  aborts(() => ins('llm', 1, 1.5, 'e'), /CHECK/, 'conf>1'); aborts(() => ins('llm', 1, -0.1, 'e'), /CHECK/, 'conf<0');
  aborts(() => ins('llm', 1, null, '   '), /CHECK/, 'ev 空白'); aborts(() => ins('llm', 1, null, null), /NOT NULL|CHECK/, 'ev NULL');
  aborts(() => ins('llm', 1, null, 'e', 'no-such-market'), /FOREIGN KEY/, '不存在的市场');
  ins('llm', 1, 0.5, 'ok');   // 合法对照
});

// ══ X 系列: DELETE 守卫 ═══════════════════════════════════════════════════════════════════════════
await t('X1 ▲ DELETE 守卫: 有 winning_side / shardleaf_txid / genesis_submitted_txid / 下注 / claim / 结算意图 / verdict / genesis submit_intent 的市场拒删; 干净的未广播市场可删', async () => {
  const del = (id) => sqlite.prepare('DELETE FROM proto_markets WHERE id = ?').run(id);
  const cases = {
    winning_side: () => { const id = mkMarket({ status: 'sealed' }); setWS(id, 1, 'operator'); return id; },
    shardleaf_txid: () => mkMarket({ shardleaf_txid: 'ab'.repeat(32) }),
    genesis_submitted_txid: () => mkMarket({ genesis_submitted_txid: 'cd'.repeat(32) }),
    bet: () => { const id = mkMarket(); sqlite.exec(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, created_at) VALUES ('b-${id}', '${id}', 'pk', 0, 1, '${NOW}')`); return id; },
    claim: () => { const id = mkMarket(); sqlite.exec(`INSERT INTO proto_claims (id, market_id, bettor_pk, side, amount, created_at) VALUES ('c-${id}', '${id}', 'pk', 'win', 5, '${NOW}')`); return id; },
    settlement_intent: () => { const id = mkMarket(); sqlite.exec(`INSERT INTO proto_settlement_intents (intent_key, subject_type, subject_id, step, created_at, updated_at) VALUES ('settle:market:${id}:seal', 'market', '${id}', 'seal', '${NOW}', '${NOW}')`); return id; },
    verdict: () => { const id = mkMarket(); mkVerdict(id, 'llm', 1); return id; },
    genesis_submit_intent: () => { const id = mkMarket(); sqlite.exec(`INSERT INTO submit_intents (intent_key, intent_kind, offer_id, target_address, amount_kas, created_at, updated_at) VALUES ('genesis:${id}', 'proto_genesis', '${id}', 'kaspa:x', '0', '${NOW}', '${NOW}')`); return id; },
  };
  for (const [name, mk] of Object.entries(cases)) { const id = mk(); aborts(() => del(id), /DELETE forbidden/, name); ok(row(id), `${name}: 被拒后市场应仍在`); }
  const clean = mkMarket(); eq(del(clean).changes, 1, '干净未广播市场可删'); eq(row(clean), undefined);
});

// ══ Q 系列: R4 题面不可改 ═════════════════════════════════════════════════════════════════════════
const QCOLS = [['question', 'new q'], ['outcome_oracle_relay_ids', '["x"]'], ['resolution_rule_spec', '{"r":2}'], ['outcome_market_source', 'src2'], ['outcome_condition_id', '0xdef'], ['outcome_end_ms', 999]];
await t('Q1 未锁(genesis_pending / genesis_prepared, 无下注, 无 txid)时题面各列可改; 值不变的 UPDATE 在锁后也允许', async () => {
  for (const st of ['genesis_pending', 'genesis_prepared']) for (const [c, v] of QCOLS) { const id = mkMarket({ status: st }); eq(sqlite.prepare(`UPDATE proto_markets SET ${c} = ? WHERE id = ?`).run(v, id).changes, 1, `${st}.${c}`); }
  const id = mkMarket({ status: 'betting', resolution_rule_spec: 'r' });
  eq(sqlite.prepare('UPDATE proto_markets SET resolution_rule_spec = ?, updated_at = ? WHERE id = ?').run('r', NOW, id).changes, 1, '同值不算改');
});
await t('Q2 ▲ 锁后一律拒改(六列 × 各锁因): status 出了 pending/prepared(submitted / ambiguous / betting / sealed / resolved / cancelled)/ genesis_submitted_txid / shardleaf_txid / 已有下注', async () => {
  const lockers = {
    'status=genesis_submitted': () => mkMarket({ status: 'genesis_submitted' }), 'status=genesis_ambiguous': () => mkMarket({ status: 'genesis_ambiguous' }), 'status=betting': () => mkMarket({ status: 'betting' }),
    'status=sealed': () => mkMarket({ status: 'sealed' }), 'status=resolved': () => mkMarket({ status: 'resolved' }), 'status=cancelled': () => mkMarket({ status: 'cancelled' }),
    'genesis_submitted_txid': () => mkMarket({ genesis_submitted_txid: 'ab'.repeat(32) }), 'shardleaf_txid': () => mkMarket({ shardleaf_txid: 'cd'.repeat(32) }),
    'has bet': () => { const id = mkMarket(); sqlite.exec(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, created_at) VALUES ('b-${id}', '${id}', 'pk', 0, 1, '${NOW}')`); return id; },
  };
  for (const [why, mk] of Object.entries(lockers)) for (const [c, v] of QCOLS) {
    const id = mk(); aborts(() => sqlite.prepare(`UPDATE proto_markets SET ${c} = ? WHERE id = ?`).run(v, id), /immutable after genesis/, `${why}:${c}`);
  }
});
await t('Q3 ▲ 锁后 NULL→值 / 值→NULL 也拒(不能事后给市场加判定题, 也不能事后摘掉); 锁后其它列(updated_at / status 推进)照常更新', async () => {
  const a = mkMarket({ status: 'betting' }); aborts(() => sqlite.prepare("UPDATE proto_markets SET resolution_rule_spec = 'late' WHERE id = ?").run(a), /immutable after genesis/, 'NULL→值');
  const b = mkMarket({ status: 'betting', resolution_rule_spec: 'r' }); aborts(() => sqlite.prepare('UPDATE proto_markets SET resolution_rule_spec = NULL WHERE id = ?').run(b), /immutable after genesis/, '值→NULL');
  eq(sqlite.prepare("UPDATE proto_markets SET updated_at = ?, status = 'sealed' WHERE id = ?").run(NOW, b).changes, 1);
});
await t('Q4 ▲ "改题面后再写值"链路: 锁后无法先把判定题摘掉再让 operator 写 winning_side(摘除被 R4 拒 ⇒ operator 写仍被 R1 拒)', async () => {
  const id = mkMarket({ status: 'betting', resolution_rule_spec: 'r' });
  aborts(() => sqlite.prepare('UPDATE proto_markets SET resolution_rule_spec = NULL WHERE id = ?').run(id), /immutable after genesis/);
  sqlite.prepare("UPDATE proto_markets SET status = 'sealed' WHERE id = ?").run(id);
  aborts(() => setWS(id, 1, 'operator'), /forbidden on a market with a resolution question/);
  eq(row(id).winning_side, null);
});

// ══ L 系列: 遗留行 / 驱动兼容 ═════════════════════════════════════════════════════════════════════
await t('L1 遗留行(主网 a59c 形: winning_side 已有值而审计列全 NULL, 触发器装上之前写的)照常运转: sealed→resolved 更新成功; 值仍不可改; 仍不可删', async () => {
  const id = mkMarket({ status: 'sealed', shardleaf_txid: 'ab'.repeat(32) });
  // 模拟"触发器之前"的写入: 临时摘掉写一次/审计相关触发器, 写值, 再按迁移原文装回(重跑迁移即重建全部)
  const saved = sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_pm_ws_r1_%'").all();
  for (const r of saved) sqlite.exec(`DROP TRIGGER ${r.name}`);
  sqlite.prepare('UPDATE proto_markets SET winning_side = 1 WHERE id = ?').run(id);
  for (const r of saved) sqlite.exec(r.sql);
  eq(row(id).winning_side, 1); eq(row(id).winning_side_source, null);
  eq(sqlite.prepare("UPDATE proto_markets SET status='resolved', updated_at=? WHERE id=? AND status='sealed'").run(NOW, id).changes, 1, '遗留行的驱动状态推进');
  aborts(() => setWS(id, 0, 'operator'), /write-once|immutable/, '值仍不可改'); aborts(() => sqlite.prepare('DELETE FROM proto_markets WHERE id = ?').run(id), /DELETE forbidden/, '仍不可删');
});
await t('L2 驱动兼容: 结算 store 的两条 status 更新形(betting→sealed / sealed→resolved)不带 winning_side, 不触发 R1', async () => {
  const id = mkMarket({ status: 'betting', shardleaf_txid: 'ab'.repeat(32) });
  eq(sqlite.prepare("UPDATE proto_markets SET status = 'sealed', updated_at = ? WHERE id = ? AND status = 'betting'").run(NOW, id).changes, 1);
  eq(setWS(id, 1, 'operator').changes, 1);
  eq(sqlite.prepare("UPDATE proto_markets SET status = 'resolved', updated_at = ? WHERE id = ? AND status = 'sealed'").run(NOW, id).changes, 1);
});

console.log(`\nproto-winning-side-triggers-v212.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
