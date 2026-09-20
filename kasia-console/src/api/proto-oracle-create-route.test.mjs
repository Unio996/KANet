// proto-oracle-create-route.test.mjs — oracle 整合批 B / B5·B6·C1·C2: 创建入口 + 公开读 + 下注 side_label 的【路由接线】(真 Fastify + app.inject + 真 migration 临时库)。
// 校验矩阵在 lib/proto-oracle-spec.test.mjs, 策略矩阵在 lib/proto-oracle-policy.test.mjs; 这里验路由确实调它们、旧流程逐字节不变、拒绝发生在任何 DB 写之前。
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
const COND = '0x' + 'aB'.repeat(32);
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const spec = (over = {}) => ({ data_source_canonical: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401', secondary_sources: [], ambiguity_handler: 'abstain', dispute_keywords: [], edge_case_examples: [], resolution_predicate: { metric: 'winner', op: '==', operand: 'LAL' }, side_map: { yes: 1, no: 0 }, polymarket_outcome_side: 'YES', ...over });
const legacy = () => ({ tokenId: 'tok1', title: 'legacy market?', deadline: iso(3 * H) });
const judged = (over = {}) => ({ tokenId: 'tok1', title: 'LAL beat BOS?', deadline: iso(100 * H), resolutionRuleSpec: spec(), outcomeEnd: iso(24 * H), outcomeConditionId: COND, ...over });
const create = (payload) => app.inject({ method: 'POST', url: '/api/proto-markets/create', payload });
const count = () => sqlite.prepare('SELECT count(*) n FROM proto_markets').get().n;
const body = (r) => { try { return JSON.parse(r.body); } catch { return {}; } };
const row = (id) => sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(id);
const JC = ['resolution_rule_spec', 'outcome_market_source', 'outcome_condition_id', 'outcome_oracle_relay_ids', 'outcome_end_ms'];

console.log('[test] 创建入口:');
let legacyId, judgedId;
{
  const r = await create(legacy()); const b = body(r);
  ok(r.statusCode === 409 && b.error === 'proto_driver_disabled' && b.id, `旧流程(三个新字段全缺省): 行为不变——写行后 409 proto_driver_disabled(实际 ${r.statusCode})`);
  legacyId = b.id; const lr = row(legacyId);
  ok(JC.every((c) => lr[c] === null), '旧流程: 五个判定题列全 NULL(与批 B 之前逐字节相同的行)');

  const c0 = count();
  for (const [name, over] of [['缺 outcomeEnd', { outcomeEnd: undefined }], ['缺 outcomeConditionId', { outcomeConditionId: undefined }], ['缺 resolutionRuleSpec', { resolutionRuleSpec: undefined }]]) {
    const rr = await create(judged(over)); ok(rr.statusCode === 400 && body(rr).error === 'judged_input_incomplete', `半套判定题输入(${name}) ⇒ 400 judged_input_incomplete(实际 ${rr.statusCode} ${body(rr).error})`);
  }
  ok(count() === c0, '半套输入 ⇒ 未写任何市场行');

  const rr = await create(judged({ outcomeOracleRelayIds: ['relay-1'] })); ok(rr.statusCode === 400 && /relay/i.test(rr.body), `请求体带 relay 类字段 ⇒ 400(实际 ${rr.statusCode})`);
  const rr2 = await create(judged({ relayId: 'x' })); ok(rr2.statusCode === 400, `relayId ⇒ 400(实际 ${rr2.statusCode})`);
  ok(count() === c0, 'relay 字段拒建: 未写行');

  const bads = [
    ['数据源非白名单', { resolutionRuleSpec: spec({ data_source_canonical: 'https://evil.example/x' }) }, 'data_source_not_whitelisted'],
    ['数据源内网', { resolutionRuleSpec: spec({ data_source_canonical: 'https://127.0.0.1/x' }) }, 'data_source_not_whitelisted'],
    ['非确定性源(coingecko)', { resolutionRuleSpec: spec({ data_source_canonical: 'https://api.coingecko.com/api/v3/simple/price?ids=btc' }) }, 'data_source_not_deterministic'],
    ['缺 predicate', { resolutionRuleSpec: (() => { const s = spec(); delete s.resolution_predicate; return s; })() }, 'predicate_missing'],
    ['side_map 非双射', { resolutionRuleSpec: spec({ side_map: { yes: 1, no: 1 } }) }, 'side_map_invalid'],
    ['缺极性', { resolutionRuleSpec: (() => { const s = spec(); delete s.polymarket_outcome_side; return s; })() }, 'polymarket_outcome_side_invalid'],
    ['condition id 格式错', { outcomeConditionId: '0xabc' }, 'condition_id_invalid'],
    ['deadline 早于 outcomeEnd + UMA 窗 + 宽限窗 …', { deadline: iso(30 * H) }, 'deadline_too_early'],
    ['outcomeEnd 已过', { outcomeEnd: iso(-H) }, 'outcome_end_in_past'],
    ['spec 未知字段', { resolutionRuleSpec: spec({ evil: 1 }) }, 'spec_unknown_field'],
  ];
  for (const [name, over, code] of bads) { const rr3 = await create(judged(over)); ok(rr3.statusCode === 400 && body(rr3).error === code, `拒建: ${name} ⇒ 400 ${code}(实际 ${rr3.statusCode} ${body(rr3).error})`); }
  ok(count() === c0, '全部拒建路径都发生在任何 DB 写之前');

  // SHOULD②: 未识别的 resolution* / outcome* 键(蛇形等)⇒ 400, 不静默丢弃后建成普通市场; resolutionNote(既有占位字段)仍照旧接受
  for (const k of ['resolution_rule_spec', 'outcome_end', 'outcome_condition_id', 'outcomeMarketSource', 'resolutionPredicate']) { const rs = await create({ ...legacy(), [k]: 'x' }); ok(rs.statusCode === 400 && body(rs).error === 'unrecognized_judged_field', `未识别键 ${k} ⇒ 400 unrecognized_judged_field(实际 ${rs.statusCode} ${body(rs).error})`); }
  const rs2 = await create({ ...judged(), outcome_end: 'x' }); ok(rs2.statusCode === 400 && body(rs2).error === 'unrecognized_judged_field', '合法判定题 + 多带一个蛇形键 ⇒ 仍 400(不悄悄丢弃)');
  const rn = await create({ ...legacy(), resolutionNote: 'note' }); ok(rn.statusCode === 409 && body(rn).error === 'proto_driver_disabled', `resolutionNote(既有字段)照旧接受(实际 ${rn.statusCode})`);
  ok(count() === c0 + 1, '未识别键拒建: 未写行(仅 resolutionNote 那一个旧流程行)');
  const okr = await create(judged()); const ob = body(okr); judgedId = ob.id;
  ok(okr.statusCode === 409 && ob.error === 'proto_driver_disabled' && judgedId, `合法判定题创建: 写行后走既有终点(实际 ${okr.statusCode} ${ob.error})`);
  const jr = row(judgedId);
  ok(JSON.parse(jr.resolution_rule_spec).side_map.yes === 1 && jr.outcome_market_source === 'polymarket' && jr.outcome_condition_id === COND.toLowerCase() && jr.outcome_oracle_relay_ids === '[]' && Number.isSafeInteger(jr.outcome_end_ms), '判定题列在同一条 INSERT 里全部落库(spec / polymarket / 小写 condition id / relay ids=[] / outcome_end_ms 整数)');
  ok(jr.winning_side === null && jr.settlement_frozen_at === null, '创建不写 winning_side / 不冻结');
}

console.log('[test] B5 站点①(创建入口)——网络 / 代币白名单:');
{
  const c0 = count(); const saveNet = process.env.KASPA_NETWORK;
  process.env.KASPA_NETWORK = 'mainnet';
  try {
    const r1 = await create(judged()); ok(r1.statusCode === 403 && body(r1).error === 'judged_market_not_allowed_here', `主网 + 非白名单代币 ⇒ 403(实际 ${r1.statusCode} ${body(r1).error})`);
    const r2 = await create(legacy()); ok(r2.statusCode === 409 && body(r2).error === 'proto_driver_disabled', `主网 + 旧流程(无判定题)不受影响(实际 ${r2.statusCode})`);
    process.env.PROTO_ORACLE_VALUELESS_TOKEN_IDS = 'tok1';
    const r3 = await create(judged()); ok(r3.statusCode === 409 && body(r3).error === 'proto_driver_disabled', `主网 + 白名单代币 ⇒ 放行到既有终点(实际 ${r3.statusCode} ${body(r3).error})`);
    delete process.env.PROTO_ORACLE_VALUELESS_TOKEN_IDS;
    delete process.env.KASPA_NETWORK;
    const r4 = await create(judged()); ok(r4.statusCode === 403, `网络未配置 ⇒ fail-closed 403(实际 ${r4.statusCode})`);
    const r5 = await create(legacy()); ok(r5.statusCode === 409 && body(r5).error === 'proto_driver_disabled', '网络未配置 + 旧流程: 判定题策略不介入');
    ok(count() === c0 + 3, '拒建路径未写行(只有 r2 旧流程 + r3 白名单放行 + r5 旧流程各写一行)');
  } finally { process.env.KASPA_NETWORK = saveNet; delete process.env.PROTO_ORACLE_VALUELESS_TOKEN_IDS; }
}

console.log('[test] C1 公开读:');
{
  const list = body(await app.inject({ method: 'GET', url: '/api/proto-markets' })).markets;
  const detail = body(await app.inject({ method: 'GET', url: `/api/proto-markets/${judgedId}` }));
  const jm = list.find((m) => m.id === judgedId), lm = list.find((m) => m.id === legacyId);
  const dm = detail.market || detail;
  ok(jm && jm.judged && jm.judged.side_map.yes === 1 && jm.judged.polymarket_outcome_side === 'YES' && Number.isSafeInteger(jm.judged.outcome_end_ms) && /espn\.com/.test(jm.judged.data_source_canonical), '列表: 判定题带 judged{side_map, outcome_end_ms, data_source_canonical, polymarket_outcome_side}');
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
await app.close();
console.log(fails ? `\n❌ ${fails} 项失败` : '\n✅✅ ALL PASS — 判定题创建入口 / 公开读 / 下注 side_label 路由接线(旧流程不变 / 拒在写之前 / 网络 + 白名单策略 / 内部列不外露)');
process.exit(fails ? 1 : 0);
