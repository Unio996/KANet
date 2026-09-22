// proto-oracle-create-route.test.mjs — D-032 单口径(v0.2.4)创建入口 + 公开读 + 下注 side_label 的【路由接线】(真 Fastify + app.inject + 真 migration 临时库)。
// 校验矩阵在 lib/proto-oracle-spec.test.mjs, 策略矩阵在 lib/proto-oracle-policy.test.mjs, §2.6 编排矩阵在 lib/proto-oracle-identity.test.mjs;
// 这里验路由确实按顺序调它们(校验 → §2.6 身份绑定两步回签 → §2.7 主网建题闸)、旧流程逐字节不变、拒绝发生在任何 DB 写之前。
// 全局 fetch 打桩(同 lib/proto-oracle-verdict.test.mjs 惯例): §2.6 需要真的经过 bindCanonicalEventIdentity 两次 fetch, 这里给固定的 ESPN summary/teams 响应。
// 测试环境: PROTO_DRIVER_ENABLED / PROTO_RELAY_ID 未配 ⇒ 过了全部校验后 ensureMarketPending 写行, 然后 409 proto_driver_disabled(带 id)——这是既有旧流程的终点, 也是本测试的"创建成功"信号。
// Run: cd kasia-console && node src/api/proto-oracle-create-route.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._PROTO_CREATE_ROUTE_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_create_route_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_CREATE_ROUTE_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
process.env.KASPA_NETWORK = 'simnet';
delete process.env.PROTO_DRIVER_ENABLED; delete process.env.PROTO_RELAY_ID; delete process.env.PROTO_ORACLE_VALUELESS_TOKEN_IDS; delete process.env.PROTO_ORACLE_ADAPTER_ENABLED;
import Fastify from 'fastify';
const { sqlite } = await import('../db/client.js');
const { registerProtoRoutes } = await import('./proto.js');

let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const app = Fastify(); await registerProtoRoutes(app); await app.ready();
const NOW = new Date().toISOString(), H = 3_600_000;
sqlite.prepare('INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)').run('tok1', 'Test', 'TST', NOW);
// 🔴 冻结基准时刻(不是每次调用都读 Date.now()): §2.6 两步回签要求 attestStatement 逐字节等于服务端渲染的
// statement, 而 renderResolutionStatement 把 outcomeEndMs 编进语句文本——如果 judged()/iso() 每次调用各自
// 读一次 Date.now(), 两次调用之间哪怕只差 1ms, outcomeEnd 的 ISO 串就不同, 语句就不同, 会把"原样带回"误判成
// attest_mismatch(伪失败, 不是真在测什么)。所有 iso() 调用共用同一个 NOW_MS, 保证同一逻辑场景内的多次
// create() 调用(第一次拿 statement、第二次带回)算出完全相同的 outcomeEndMs / deadlineMs。
const NOW_MS = Date.now();
const iso = (ms) => new Date(NOW_MS + ms).toISOString();

// ── 全局 fetch 打桩(§2.6 bindCanonicalEventIdentity 的两次真 fetch, 无真实网络) ──
const realFetch = globalThis.fetch;
const REGISTRY_IDS = new Set(['13', '2']);   // LAL=13, BOS=2(路由接线测试不需要真 ESPN id, 只需内部自洽)
const SUMMARIES = new Map();   // eventId(URL ?event= 参数) → summary JSON 文本
const NBA = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
/** @param {{eventId:string, headerId?:string, compId?:string, homeAbbr?:string, homeId?:string, awayAbbr?:string, awayId?:string}} o headerId/compId 缺省=eventId(用于构造 §2.6-1 载荷身份不一致的负测) */
function setSummary({ eventId, headerId = eventId, compId = headerId, homeAbbr = 'LAL', homeId = '13', awayAbbr = 'BOS', awayId = '2', league = 'NBA' }) {
  SUMMARIES.set(eventId, JSON.stringify({
    header: { id: headerId, league: { abbreviation: league }, competitions: [{ id: compId, date: '2026-10-01T00:00Z', status: { type: { completed: false, state: 'pre' } }, competitors: [
      { homeAway: 'home', winner: false, team: { id: homeId, abbreviation: homeAbbr, displayName: homeAbbr + ' Team' } },
      { homeAway: 'away', winner: false, team: { id: awayId, abbreviation: awayAbbr, displayName: awayAbbr + ' Team' } },
    ] }] },
  }));
}
setSummary({ eventId: '401' });   // 默认事件: LAL(home,id=13) vs BOS(away,id=2), 两队都在 REGISTRY_IDS 里(已定)
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith(NBA + '/summary')) {
    const eventId = new URL(u).searchParams.get('event');
    const text = SUMMARIES.get(eventId);
    if (text === undefined) return { ok: false, status: 404, text: async () => 'not found' };
    return { ok: true, status: 200, text: async () => text };
  }
  if (u.startsWith(NBA + '/teams')) {
    return { ok: true, status: 200, text: async () => JSON.stringify({ sports: [{ leagues: [{ teams: [...REGISTRY_IDS].map((id) => ({ team: { id } })) }] }] }) };
  }
  throw new Error('unstubbed fetch in proto-oracle-create-route.test.mjs: ' + u);
};

const spec = (over = {}) => ({ data_source_canonical: `${NBA}/summary?event=401`, secondary_sources: [], ambiguity_handler: 'abstain', dispute_keywords: [], edge_case_examples: [], resolution_predicate: { metric: 'winner', op: '==', operand: 'LAL' }, side_map: { yes: 1, no: 0 }, title: 'LAL beat BOS?', ...over });
const legacy = () => ({ tokenId: 'tok1', title: 'legacy market?', deadline: iso(3 * H) });
const judged = (over = {}) => ({ tokenId: 'tok1', title: 'LAL beat BOS?', deadline: iso(100 * H), resolutionRuleSpec: spec(), outcomeEnd: iso(24 * H), ...over });
const create = (payload) => app.inject({ method: 'POST', url: '/api/proto-markets/create', payload });
const count = () => sqlite.prepare('SELECT count(*) n FROM proto_markets').get().n;
const body = (r) => { try { return JSON.parse(r.body); } catch { return {}; } };
const row = (id) => sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(id);
const JC = ['resolution_rule_spec', 'outcome_market_source', 'outcome_condition_id', 'outcome_oracle_relay_ids', 'outcome_end_ms'];
/** §2.6 两步回签: 第一次 create() 缺 attestStatement ⇒ 409 attest_required 带 statement; 原样带回重发。返回两次响应, second=null 表示第一次就没走到 attest_required(半路被别的校验拒了)。 */
async function createJudgedWithAttest(over = {}) {
  const first = await create(judged(over)); const fb = body(first);
  if (!(first.statusCode === 409 && fb.error === 'attest_required')) return { first, second: null };
  const second = await create(judged({ ...over, attestStatement: fb.statement })); return { first, second };
}

console.log('[test] 创建入口(D-032 单口径 v0.2.4):');
let legacyId, judgedId;
{
  const r = await create(legacy()); const b = body(r);
  ok(r.statusCode === 409 && b.error === 'proto_driver_disabled' && b.id, `旧流程(两个新字段全缺省): 行为不变——写行后 409 proto_driver_disabled(实际 ${r.statusCode})`);
  legacyId = b.id; const lr = row(legacyId);
  ok(JC.every((c) => lr[c] === null), '旧流程: 五个判定题列全 NULL(与批 B 之前逐字节相同的行)');

  const c0 = count();
  for (const [name, over] of [['缺 outcomeEnd', { outcomeEnd: undefined }], ['缺 resolutionRuleSpec', { resolutionRuleSpec: undefined }]]) {
    const rr = await create(judged(over)); ok(rr.statusCode === 400 && body(rr).error === 'judged_input_incomplete', `半套判定题输入(${name}) ⇒ 400 judged_input_incomplete(实际 ${rr.statusCode} ${body(rr).error})`);
  }
  ok(count() === c0, '半套输入 ⇒ 未写任何市场行');

  const rr = await create(judged({ outcomeOracleRelayIds: ['relay-1'] })); ok(rr.statusCode === 400 && /relay/i.test(rr.body), `请求体带 relay 类字段 ⇒ 400(实际 ${rr.statusCode})`);
  const rr2 = await create(judged({ relayId: 'x' })); ok(rr2.statusCode === 400, `relayId ⇒ 400(实际 ${rr2.statusCode})`);
  ok(count() === c0, 'relay 字段拒建: 未写行');

  // D-032 §2.1: 曾经的第二裁判输入(outcomeConditionId / polymarket*) ⇒ dual_judge_not_allowed, 比"未识别字段"更明确
  const rr3 = await create(judged({ outcomeConditionId: '0x' + 'aB'.repeat(32) })); ok(rr3.statusCode === 400 && body(rr3).error === 'dual_judge_not_allowed', `outcomeConditionId ⇒ 400 dual_judge_not_allowed(实际 ${rr3.statusCode} ${body(rr3).error})`);
  const rr4 = await create(judged({ resolutionRuleSpec: spec({ polymarket_outcome_side: 'YES' }) })); ok(rr4.statusCode === 400, `spec 里 polymarket_outcome_side ⇒ 400(实际 ${rr4.statusCode} ${body(rr4).error})`);
  ok(count() === c0, '第二裁判字段拒建: 未写行');

  const bads = [
    ['数据源非白名单', { resolutionRuleSpec: spec({ data_source_canonical: 'https://evil.example/x' }) }, 'data_source_not_whitelisted'],
    ['数据源内网', { resolutionRuleSpec: spec({ data_source_canonical: 'https://127.0.0.1/x' }) }, 'data_source_not_whitelisted'],
    ['非确定性源(coingecko)', { resolutionRuleSpec: spec({ data_source_canonical: 'https://api.coingecko.com/api/v3/simple/price?ids=btc' }) }, 'data_source_not_deterministic'],
    ['缺 predicate', { resolutionRuleSpec: (() => { const s = spec(); delete s.resolution_predicate; return s; })() }, 'predicate_missing'],
    ['side_map 非双射', { resolutionRuleSpec: spec({ side_map: { yes: 1, no: 1 } }) }, 'side_map_invalid'],
    ['deadline 早于 outcomeEnd + 宽限窗 + 余量 + 投票预算', { deadline: iso(H) }, 'deadline_too_early'],   // deadline(1H) < outcomeEnd 默认(24H), 必然早于 minDeadline(= outcomeEnd + 正数余量)
    ['outcomeEnd 已过', { outcomeEnd: iso(-H) }, 'outcome_end_in_past'],
    ['spec 未知字段', { resolutionRuleSpec: spec({ evil: 1 }) }, 'spec_unknown_field'],
  ];
  for (const [name, over, code] of bads) { const rr5 = await create(judged(over)); ok(rr5.statusCode === 400 && body(rr5).error === code, `拒建: ${name} ⇒ 400 ${code}(实际 ${rr5.statusCode} ${body(rr5).error})`); }
  ok(count() === c0, '全部拒建路径都发生在任何 DB 写之前(validateJudgedMarketInput 层, 不到 §2.6 fetch)');

  // SHOULD②: 未识别的 resolution* / outcome* 键(蛇形等)⇒ 400, 不静默丢弃后建成普通市场; resolutionNote(既有占位字段)仍照旧接受
  for (const k of ['resolution_rule_spec', 'outcome_end', 'outcome_condition_id', 'outcomeMarketSource', 'resolutionPredicate']) { const rs = await create({ ...legacy(), [k]: 'x' }); ok(rs.statusCode === 400 && body(rs).error === 'unrecognized_judged_field', `未识别键 ${k} ⇒ 400 unrecognized_judged_field(实际 ${rs.statusCode} ${body(rs).error})`); }
  const rs2 = await create({ ...judged(), outcome_end: 'x' }); ok(rs2.statusCode === 400 && body(rs2).error === 'unrecognized_judged_field', '合法判定题 + 多带一个蛇形键 ⇒ 仍 400(不悄悄丢弃)');
  const rn = await create({ ...legacy(), resolutionNote: 'note' }); ok(rn.statusCode === 409 && body(rn).error === 'proto_driver_disabled', `resolutionNote(既有字段)照旧接受(实际 ${rn.statusCode})`);
  ok(count() === c0 + 1, '未识别键拒建: 未写行(仅 resolutionNote 那一个旧流程行)');

  // D-032 §2.6: 通过 validateJudgedMarketInput 后走命题身份绑定——两步回签
  // 🔴 直接单发 create(judged()), 不经 createJudgedWithAttest 助手(那个助手在拿到 attest_required 后会
  // 自动发第二次请求真的建成市场, 这里只想看第一次单独的响应形状 + 确认它没有副作用地写行)。
  const f1 = await create(judged());
  ok(f1.statusCode === 409 && body(f1).error === 'attest_required' && typeof body(f1).statement === 'string' && body(f1).canonical_event?.event_id === '401', `第一次(无 attestStatement) ⇒ 409 attest_required 带 statement + canonical_event(实际 ${f1.statusCode} ${body(f1).error})`);
  ok(count() === c0 + 1, 'attest_required 不写行(还没建)');
  const badAttest = await create(judged({ attestStatement: 'not the real statement' })); ok(badAttest.statusCode === 400 && body(badAttest).error === 'attest_mismatch', `attestStatement 与渲染语句不逐字相等 ⇒ 400 attest_mismatch(实际 ${badAttest.statusCode} ${body(badAttest).error})`);
  ok(count() === c0 + 1, 'attest_mismatch 不写行');

  const okr = await create(judged({ attestStatement: body(f1).statement })); const ob = body(okr); judgedId = ob.id;
  ok(okr.statusCode === 409 && ob.error === 'proto_driver_disabled' && judgedId, `合法判定题创建(原样回签): 写行后走既有终点(实际 ${okr.statusCode} ${ob.error})`);
  const jr = row(judgedId);
  const jspec = JSON.parse(jr.resolution_rule_spec);
  ok(jspec.side_map.yes === 1 && jr.outcome_market_source === 'kanet_native' && jr.outcome_condition_id === null && jr.outcome_oracle_relay_ids === '[]' && Number.isSafeInteger(jr.outcome_end_ms), '判定题列在同一条 INSERT 里全部落库(spec / kanet_native / condition_id=null / relay ids=[] / outcome_end_ms 整数)');
  ok(jspec.canonical_event && jspec.canonical_event.event_id === '401' && jspec.canonical_event.home.abbr === 'LAL' && jspec.canonical_event.away.abbr === 'BOS', 'spec.canonical_event(§2.6-5 冻结进 spec)与 fetch 打桩的事件一致');
  ok(typeof jspec.resolution_statement === 'string' && jspec.resolution_statement === body(f1).statement, 'spec.resolution_statement = 首次响应给出的渲染语句(逐字节相同)');
  ok(jr.winning_side === null && jr.settlement_frozen_at === null, '创建不写 winning_side / 不冻结');
}

console.log('[test] D-032 §2.6 命题身份绑定负测(建题时真走 fetch 打桩, 拒建不写行):');
{
  const c0 = count();
  const r1 = await create(judged({ resolutionRuleSpec: spec({ data_source_canonical: `${NBA}/summary?event=999_never_registered` }) }));
  ok(r1.statusCode === 409 && body(r1).error === 'source_unreachable_at_creation', `ESPN summary 未注册(fetch 404) ⇒ 409 source_unreachable_at_creation(实际 ${r1.statusCode} ${body(r1).error})`);

  setSummary({ eventId: '402', headerId: '999_mismatched' });   // URL ?event=402, 但载荷 header.id 是别的事件
  const r2 = await create(judged({ resolutionRuleSpec: spec({ data_source_canonical: `${NBA}/summary?event=402` }) }));
  ok(r2.statusCode === 400 && body(r2).error === 'event_identity_unverified', `URL event 参数与载荷 header.id 不一致 ⇒ 400 event_identity_unverified(实际 ${r2.statusCode} ${body(r2).error})`);

  setSummary({ eventId: '403', awayId: '999_not_in_registry', awayAbbr: 'TBD' });   // away 侧不在 REGISTRY_IDS 里(占位席位)
  const r3 = await create(judged({ resolutionRuleSpec: spec({ data_source_canonical: `${NBA}/summary?event=403` }) }));
  ok(r3.statusCode === 409 && body(r3).error === 'event_participants_not_determined', `参赛方未定(id 不在球队注册表)⇒ 409 event_participants_not_determined(实际 ${r3.statusCode} ${body(r3).error})`);

  const r4 = await create(judged({ resolutionRuleSpec: spec({ resolution_predicate: { metric: 'winner', op: '==', operand: 'ZZZ' } }) }));
  ok(r4.statusCode === 400 && body(r4).error === 'predicate_team_not_in_event', `predicate 队名不在参赛方之中 ⇒ 400 predicate_team_not_in_event(实际 ${r4.statusCode} ${body(r4).error})`);

  ok(count() === c0, '§2.6 四类负测全部拒在任何 DB 写之前');
}

console.log('[test] B5/D-032 §2.7 站点①(创建入口)——网络 / 代币白名单 / 非判定题主网闸:');
{
  const c0 = count(); const saveNet = process.env.KASPA_NETWORK;
  process.env.KASPA_NETWORK = 'mainnet';
  try {
    const r1 = await createJudgedWithAttest(); const bindResp = r1.second ? r1.second : r1.first;
    ok(bindResp.statusCode === 403 && body(bindResp).error === 'judged_market_not_allowed_here', `主网 + 非白名单代币: 判定题 ⇒ 403(实际 ${bindResp.statusCode} ${body(bindResp).error})`);
    const r2 = await create(legacy()); ok(r2.statusCode === 409 && body(r2).error === 'non_judged_market_not_allowed_here', `D-032 §2.7: 主网 + 非判定题(旧流程)⇒ 409 non_judged_market_not_allowed_here(实际 ${r2.statusCode} ${body(r2).error})`);
    process.env.PROTO_ORACLE_VALUELESS_TOKEN_IDS = 'tok1';
    const r3full = await createJudgedWithAttest(); const r3 = r3full.second || r3full.first;
    ok(r3.statusCode === 409 && body(r3).error === 'proto_driver_disabled', `主网 + 白名单代币: 判定题放行到既有终点(实际 ${r3.statusCode} ${body(r3).error})`);
    delete process.env.PROTO_ORACLE_VALUELESS_TOKEN_IDS;
    delete process.env.KASPA_NETWORK;
    const r4full = await createJudgedWithAttest(); const r4 = r4full.second || r4full.first;
    ok(r4.statusCode === 403, `网络未配置 ⇒ 判定题 fail-closed 403(实际 ${r4.statusCode})`);
    const r5 = await create(legacy()); ok(r5.statusCode === 409 && body(r5).error === 'non_judged_market_not_allowed_here', `网络未配置 ⇒ D-032 §2.7 同样 fail-closed 拒(实际 ${r5.statusCode} ${body(r5).error}); reason=${body(r5).detail}`);
    ok(count() === c0 + 1, '本段拒建路径未写行(只有 r3 白名单放行那一行)');
  } finally { process.env.KASPA_NETWORK = saveNet; delete process.env.PROTO_ORACLE_VALUELESS_TOKEN_IDS; }
  const r6 = await create(legacy()); ok(r6.statusCode === 409 && body(r6).error === 'proto_driver_disabled', `simnet: 非判定题不受 §2.7 影响(恢复 KASPA_NETWORK 后, 实际 ${r6.statusCode})`);
}

console.log('[test] C1 公开读:');
{
  const list = body(await app.inject({ method: 'GET', url: '/api/proto-markets' })).markets;
  const detail = body(await app.inject({ method: 'GET', url: `/api/proto-markets/${judgedId}` }));
  const jm = list.find((m) => m.id === judgedId), lm = list.find((m) => m.id === legacyId);
  const dm = detail.market || detail;
  ok(jm && jm.judged && jm.judged.side_map.yes === 1 && Number.isSafeInteger(jm.judged.outcome_end_ms) && /espn\.com/.test(jm.judged.data_source_canonical), '列表: 判定题带 judged{side_map, outcome_end_ms, data_source_canonical}');
  ok(jm.judged.judge && jm.judged.judge.kind === 'espn-judgeline' && typeof jm.judged.judge.statement === 'string' && jm.judged.judge.canonical_event?.event_id === '401', 'D-032 §2.6-7: judge.statement / judge.canonical_event 原样透出(§2.6 绑定过的市场)');
  ok(dm && dm.judged && dm.judged.side_map && dm.judged.side_map.no === 0, '详情: 判定题带 judged 块');
  for (const [nm, m] of [['判定题', jm], ['判定题详情', dm], ['旧市场', lm]]) ok(m && JC.every((c) => !(c in m)), `${nm}: 五个内部列不外露`);
  ok(lm && !('judged' in lm), '旧(非判定题)市场: 没有 judged 键');
  const { judged: _j, ...jm2 } = jm;
  ok(JSON.stringify(Object.keys(jm2)) === JSON.stringify(Object.keys(lm)), '旧市场的键集合 / 顺序 = 判定题去掉 judged 后的键集合(响应形状对旧客户端不变)');
  ok(!/committee_privkey_enc|privkey/i.test(JSON.stringify(list)) && !/committee_privkey_enc|privkey/i.test(JSON.stringify(detail)), '响应不含私钥类字段');
}

console.log('[test] C1 下注 side_label(路由):');
{
  sqlite.prepare("UPDATE proto_markets SET status = 'betting' WHERE id = ?").run(judgedId);   // 创建流程被 driver 关闭截停在 genesis_pending; 这里只为过 bet 路由的状态校验
  const bet = (payload) => app.inject({ method: 'POST', url: `/api/proto-markets/${judgedId}/bet`, payload });
  const nb = () => sqlite.prepare('SELECT count(*) n FROM proto_bets WHERE market_id = ?').get(judgedId).n;
  const r0 = await bet({ direction: 1, amount: 5 }); ok(r0.statusCode === 400 && body(r0).error === 'side_label_required', `判定题下注缺 side_label ⇒ 400(实际 ${r0.statusCode} ${body(r0).error})`);
  const r1 = await bet({ direction: 0, amount: 5, side_label: 'yes' }); ok(r1.statusCode === 400 && body(r1).error === 'side_label_mismatch', `side_label=yes 配 direction=0(side_map yes→1)⇒ 400 mismatch(实际 ${r1.statusCode} ${body(r1).error})`);
  const r2 = await bet({ direction: 1, amount: 5, side_label: 'yes' }); ok(r2.statusCode === 503 && body(r2).error === 'pmt_unavailable_fail_closed', `一致 ⇒ 过 C1 进入既有 pmt 门(无 relay ⇒ 503 fail-closed)(实际 ${r2.statusCode} ${body(r2).error})`);
  ok(nb() === 0, '三种都拒在任何 DB 写之前: 无 bets 行');
  const saveNet = process.env.KASPA_NETWORK; process.env.KASPA_NETWORK = 'mainnet';
  try { const r3 = await bet({ direction: 1, amount: 5, side_label: 'yes' }); ok(r3.statusCode === 403 && body(r3).error === 'judged_market_not_allowed_here', `B5 站点②: 主网 + 非白名单 ⇒ 403(实际 ${r3.statusCode} ${body(r3).error})`); }
  finally { process.env.KASPA_NETWORK = saveNet; }
  const rl = await app.inject({ method: 'POST', url: `/api/proto-markets/${legacyId}/bet`, payload: { direction: 0, amount: 5 } });
  sqlite.prepare("UPDATE proto_markets SET status = 'betting' WHERE id = ?").run(legacyId);
  const rl2 = await app.inject({ method: 'POST', url: `/api/proto-markets/${legacyId}/bet`, payload: { direction: 0, amount: 5 } });
  ok(rl2.statusCode === 409 && body(rl2).error === 'proto_driver_disabled', `旧(非判定题)市场下注不需要 side_label, 行为不变(实际 ${rl2.statusCode} ${body(rl2).error}; 未 betting 时 ${rl.statusCode})`);
}

console.log('[test] D-032 §2.7 /resolve 占位(不实现, detail 指向本设计):');
{
  // 造一个 sealed 判定题市场专测 /resolve(不依赖上面被 driver 截停在 genesis_pending 的 judgedId)
  const rid = 'resolve-test-market';
  sqlite.prepare(`INSERT INTO proto_markets (id, token_def_id, question, deadline_ms, min_bet, seal_count, committee_pubkeys_json, committee_privkey_enc, rootclose_tmpl_hash, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rid, 'tok1', 'q?', Date.now() + H, 1, 2, '[]', 'enc', 'aa'.repeat(32), 'sealed', NOW, NOW);
  const rr2 = await app.inject({ method: 'POST', url: `/api/proto-markets/${rid}/resolve`, payload: { outcome: 1 } });
  ok(rr2.statusCode === 501 && body(rr2).error === 'market_resolve 暂未实现' && /D-032/.test(body(rr2).detail), `sealed 市场 resolve ⇒ 501 占位, detail 指明 D-032 不提供人工裁决(实际 ${rr2.statusCode} ${JSON.stringify(body(rr2))})`);
  ok(sqlite.prepare('SELECT winning_side FROM proto_markets WHERE id = ?').get(rid).winning_side === null, '占位端点不写 winning_side');
}

globalThis.fetch = realFetch;
await app.close();
console.log(fails ? `\n❌ ${fails} 项失败` : '\n✅✅ ALL PASS — D-032 单口径判定题创建入口(§2.1/§2.6/§2.7) / 公开读 / 下注 side_label 路由接线(旧流程不变 / 拒在写之前 / 网络 + 白名单策略 / 内部列不外露)');
process.exit(fails ? 1 : 0);
