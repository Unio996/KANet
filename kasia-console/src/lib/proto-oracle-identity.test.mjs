// proto-oracle-identity.test.mjs — D-032 §2.6 命题身份绑定单测。零真实网络(fetchImpl 全注入), 用
// docs/provenance/2026-09-22-j2-d032-espn-fixtures/ 下的真实(determined/registry)+ synthetic(undetermined) fixture。
// Run: cd kasia-console && node src/lib/proto-oracle-identity.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  urlEventParam, deriveTeamsRegistryUrl, renderResolutionStatement, bindCanonicalEventIdentity,
} from './proto-oracle-identity.mjs';

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };

const FIXDIR = '../docs/provenance/2026-09-22-j2-d032-espn-fixtures';
const DETERMINED = fs.readFileSync(`${FIXDIR}/espn-fixture-determined-raw.json`, 'utf8');
const REGISTRY = fs.readFileSync(`${FIXDIR}/espn-fixture-teams-registry-raw.json`, 'utf8');
const UNDETERMINED = fs.readFileSync(`${FIXDIR}/espn-fixture-undetermined-synthetic.json`, 'utf8');
const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872932';
const REGISTRY_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams';
const PREDICATE = { metric: 'winner', operand: 'BUF' };
const SIDE_MAP = { yes: 0, no: 1 };
const OE_MS = 1_800_000_000_000;

// fetchImpl 桩: 按 URL 路由到两份 fixture 文本(或注入的覆盖表/失败)。
function mkFetch({ summary = DETERMINED, registry = REGISTRY, summaryOk = true, registryOk = true, throwOn = null } = {}) {
  return async (url) => {
    if (throwOn && String(url).includes(throwOn)) throw new Error('network down (injected)');
    if (String(url).includes('/summary')) return { ok: summaryOk, status: summaryOk ? 200 : 503, text: async () => summary };
    if (String(url).includes('/teams')) return { ok: registryOk, status: registryOk ? 200 : 503, text: async () => registry };
    throw new Error('unexpected URL in test fetch stub: ' + url);
  };
}

// ══ 纯函数辅助 ═══════════════════════════════════════════════════════════════════════════════
await t('H1 urlEventParam: 取 ?event= 参数; 缺 / 非法 URL / 重复(≥2 个, MUST Codex ddf67d6b: 不许静默取第一个当"拿到了")⇒ null', () => {
  assert.equal(urlEventParam(SUMMARY_URL), '401872932');
  assert.equal(urlEventParam('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary'), null, '缺 ?event=');
  assert.equal(urlEventParam('not a url'), null);
  assert.equal(urlEventParam(undefined), null);
  assert.equal(urlEventParam('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872932&event=999999'), null, '重复 event 参数(URLSearchParams.get 会静默取第一个)⇒ 视为拿不到干净值, 不是"401872932"');
  assert.equal(urlEventParam('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event='), '', '空串本身是合法返回值(由 parseEspnParticipants 拒, 不是这里拒)');
});
await t('H2 deriveTeamsRegistryUrl: .../summary?event=X → .../teams(同域, 去 query); 路径不以 /summary 结尾 ⇒ null', () => {
  assert.equal(deriveTeamsRegistryUrl(SUMMARY_URL), REGISTRY_URL);
  assert.equal(deriveTeamsRegistryUrl('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'), null);
  assert.equal(deriveTeamsRegistryUrl('not a url'), null);
});
await t('H3 renderResolutionStatement: 纯函数, 确定性(同输入同输出), 含联赛/事件id/双方name/ISO时刻/predicate operand/side_map', () => {
  const ce = { event_id: '401872932', league: 'NFL', home: { abbr: 'BUF', name: 'Buffalo Bills' }, away: { abbr: 'DET', name: 'Detroit Lions' }, start_ms: 1_789_690_500_000 };
  const s1 = renderResolutionStatement(ce, PREDICATE, SIDE_MAP, OE_MS);
  const s2 = renderResolutionStatement(ce, PREDICATE, SIDE_MAP, OE_MS);
  assert.equal(s1, s2, '确定性');
  for (const frag of ['NFL', '401872932', 'Buffalo Bills', 'Detroit Lions', 'BUF', 'side 0', 'side 1']) assert.ok(s1.includes(frag), frag + ' 应出现在渲染语句里: ' + s1);
});

// ══ bindCanonicalEventIdentity 编排 ══════════════════════════════════════════════════════════
await t('B1 快乐路径(真实 fixture): 无 attestStatement ⇒ attest_required(409)带 statement+canonical_event; 原样带回 ⇒ ok:true 且 canonical_event/resolution_statement 与首次一致', async () => {
  const first = await bindCanonicalEventIdentity({ url: SUMMARY_URL, predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, attestStatement: undefined, fetchImpl: mkFetch() });
  assert.deepEqual([first.ok, first.code, first.http], [false, 'attest_required', 409]);
  assert.equal(typeof first.statement, 'string'); assert.equal(first.canonical_event.event_id, '401872932');
  const second = await bindCanonicalEventIdentity({ url: SUMMARY_URL, predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, attestStatement: first.statement, fetchImpl: mkFetch() });
  assert.equal(second.ok, true); assert.equal(second.resolution_statement, first.statement); assert.deepEqual(second.canonical_event, first.canonical_event);
});
await t('B2 attest_mismatch(400): attestStatement 与渲染语句不逐字相等(含大小写/多余空白差异)⇒ 拒, 不做模糊匹配', async () => {
  const r = await bindCanonicalEventIdentity({ url: SUMMARY_URL, predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, attestStatement: 'close but not exact', fetchImpl: mkFetch() });
  assert.deepEqual([r.ok, r.code, r.http], [false, 'attest_mismatch', 400]);
  const first = await bindCanonicalEventIdentity({ url: SUMMARY_URL, predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, attestStatement: undefined, fetchImpl: mkFetch() });
  const r2 = await bindCanonicalEventIdentity({ url: SUMMARY_URL, predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, attestStatement: first.statement + ' ', fetchImpl: mkFetch() });
  assert.equal(r2.code, 'attest_mismatch', '哪怕只多一个空格也拒');
});
await t('B3 ▲ v0.2.4 核心: 未定席位(synthetic fixture, 字段非空/id 互异但载荷标明未定)⇒ event_participants_not_determined(409), 不因"非空+互异"旧谓词误放行', async () => {
  // synthetic fixture 的 header.id = "999999901"(见 README), URL 须用匹配的 event 参数, 否则先撞 event_identity_unverified(B4 已单独测)。
  const undeterminedUrl = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=999999901';
  const r = await bindCanonicalEventIdentity({ url: undeterminedUrl, predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, attestStatement: undefined, fetchImpl: mkFetch({ summary: UNDETERMINED }) });
  assert.deepEqual([r.ok, r.code, r.http], [false, 'event_participants_not_determined', 409]);
});
await t('B4 ▲ v0.2.1 载荷身份核对: URL event 参数与载荷 header.id 不一致 ⇒ event_identity_unverified(400), 不建', async () => {
  const r = await bindCanonicalEventIdentity({ url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=WRONG_ID', predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, attestStatement: undefined, fetchImpl: mkFetch() });
  assert.deepEqual([r.ok, r.code, r.http], [false, 'event_identity_unverified', 400]);
});
await t('B4b ▲ D-032 §2.6-1 MUST(Codex ddf67d6b 审 4dff42d9, 真实生产路径): data_source_canonical 缺 ?event= / 重复 event 参数 / 空 event= ⇒ event_identity_unverified(400), 不因"URL 没写清楚"就悄悄跳过三向核对放行(载荷本身 header.id===competitions[0].id 内部自洽、参赛方也都在注册表里, 唯独 URL 没能验证——这条测试删掉 opts in 判据的话会变回 attest_required, 即误放行, 本测必红)', async () => {
  const noEvent = await bindCanonicalEventIdentity({ url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary', predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, fetchImpl: mkFetch() });
  assert.deepEqual([noEvent.ok, noEvent.code, noEvent.http], [false, 'event_identity_unverified', 400], '缺 ?event=');
  const dup = await bindCanonicalEventIdentity({ url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872932&event=999999', predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, fetchImpl: mkFetch() });
  assert.deepEqual([dup.ok, dup.code, dup.http], [false, 'event_identity_unverified', 400], '重复 event 参数(即便第一个值恰好是真事件 id)');
  const empty = await bindCanonicalEventIdentity({ url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=', predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, fetchImpl: mkFetch() });
  assert.deepEqual([empty.ok, empty.code, empty.http], [false, 'event_identity_unverified', 400], '空 event=');
});
await t('B5 §2.6-2 predicate 队名对齐: operand 不在参赛方(home/away abbr)之中 ⇒ predicate_team_not_in_event(400)', async () => {
  const r = await bindCanonicalEventIdentity({ url: SUMMARY_URL, predicate: { metric: 'winner', operand: 'ZZZ' }, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, attestStatement: undefined, fetchImpl: mkFetch() });
  assert.deepEqual([r.ok, r.code, r.http], [false, 'predicate_team_not_in_event', 400]);
  const ok = await bindCanonicalEventIdentity({ url: SUMMARY_URL, predicate: { metric: 'winner', operand: 'DET' }, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, attestStatement: undefined, fetchImpl: mkFetch() });
  assert.equal(ok.code, 'attest_required', 'away 侧(DET)同样算在参赛方内, 不是只认 home');
});
await t('B6 fetch 失败 / 非 200 / 注册表推导失败 ⇒ 一律 source_unreachable_at_creation(409), 永不抛', async () => {
  const r1 = await bindCanonicalEventIdentity({ url: SUMMARY_URL, predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, fetchImpl: mkFetch({ throwOn: '/summary' }) });
  assert.deepEqual([r1.ok, r1.code, r1.http], [false, 'source_unreachable_at_creation', 409], 'summary fetch 抛错');
  const r2 = await bindCanonicalEventIdentity({ url: SUMMARY_URL, predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, fetchImpl: mkFetch({ summaryOk: false }) });
  assert.deepEqual([r2.ok, r2.code, r2.http], [false, 'source_unreachable_at_creation', 409], 'summary HTTP 非 200');
  const r3 = await bindCanonicalEventIdentity({ url: SUMMARY_URL, predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, fetchImpl: mkFetch({ throwOn: '/teams' }) });
  assert.deepEqual([r3.ok, r3.code, r3.http], [false, 'source_unreachable_at_creation', 409], 'registry fetch 抛错');
  const r4 = await bindCanonicalEventIdentity({ url: SUMMARY_URL, predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, fetchImpl: mkFetch({ registryOk: false }) });
  assert.deepEqual([r4.ok, r4.code, r4.http], [false, 'source_unreachable_at_creation', 409], 'registry HTTP 非 200');
  const r5 = await bindCanonicalEventIdentity({ url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, fetchImpl: mkFetch() });
  assert.deepEqual([r5.ok, r5.code, r5.http], [false, 'source_unreachable_at_creation', 409], 'URL 不是 .../summary 形状, 推导不出注册表 URL');
});
await t('B7 结构异常(raw 不是 JSON)⇒ source_unreachable_at_creation(409)', async () => {
  const r = await bindCanonicalEventIdentity({ url: SUMMARY_URL, predicate: PREDICATE, sideMap: SIDE_MAP, outcomeEndMs: OE_MS, fetchImpl: mkFetch({ summary: 'not json' }) });
  assert.deepEqual([r.ok, r.code, r.http], [false, 'source_unreachable_at_creation', 409]);
});

console.log(`\nproto-oracle-identity.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
