// oracle-evidence-extractors.test.mjs — D-032 §2.6-1 新增导出(parseEspnParticipants / parseEspnTeamsRegistry)
// 的结构级单测(fetch 级编排见 proto-oracle-identity.test.mjs)。零网络, 用真实 + synthetic fixture。
// Run: cd kasia-console && node src/lib/oracle-evidence-extractors.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseEspnParticipants, parseEspnTeamsRegistry } from './oracle-evidence-extractors.mjs';

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };

const FIXDIR = '../docs/provenance/2026-09-22-j2-d032-espn-fixtures';
const DETERMINED = JSON.parse(fs.readFileSync(`${FIXDIR}/espn-fixture-determined-raw.json`, 'utf8'));
const REGISTRY_RAW = fs.readFileSync(`${FIXDIR}/espn-fixture-teams-registry-raw.json`, 'utf8');
const REGISTRY = parseEspnTeamsRegistry(REGISTRY_RAW);
const clone = (o) => JSON.parse(JSON.stringify(o));

await t('R1 parseEspnTeamsRegistry: 真实 32 队 NFL 注册表 ⇒ 32 个 team.id; 坏 JSON / 空 sports ⇒ null(不是空 Set)', () => {
  assert.equal(REGISTRY.size, 32);
  assert.ok(REGISTRY.has('2') && REGISTRY.has('8'));
  assert.equal(parseEspnTeamsRegistry('not json'), null);
  assert.equal(parseEspnTeamsRegistry('{}'), null);
  assert.equal(parseEspnTeamsRegistry('{"sports":[]}'), null);
  assert.equal(parseEspnTeamsRegistry('{"sports":[{"leagues":[{"teams":[]}]}]}'), null);
});

await t('P1 parseEspnParticipants 快乐路径(真实 fixture): ok:true, canonical_event 五字段齐全, start_ms 是有限数', () => {
  const r = parseEspnParticipants(JSON.stringify(DETERMINED), { urlEventParam: '401872932', registryTeamIds: REGISTRY });
  assert.equal(r.ok, true);
  assert.deepEqual(r.canonical_event, { event_id: '401872932', league: 'NFL', home: { abbr: 'BUF', name: 'Buffalo Bills', team_id: '2' }, away: { abbr: 'DET', name: 'Detroit Lions', team_id: '8' }, start_ms: Date.parse('2026-09-18T00:15Z') });
});
await t('P2 结构异常(structure_invalid): 坏 JSON / 缺 header.competitions / competitors≠2 / 缺 home 或 away ⇒ 拒, 不抛', () => {
  assert.equal(parseEspnParticipants('not json').reason, 'structure_invalid');
  assert.equal(parseEspnParticipants('{}').reason, 'structure_invalid');
  const noAway = clone(DETERMINED); noAway.header.competitions[0].competitors = [noAway.header.competitions[0].competitors[0]];
  assert.equal(parseEspnParticipants(JSON.stringify(noAway)).reason, 'structure_invalid');
  const badDate = clone(DETERMINED); badDate.header.competitions[0].date = 'not-a-date';
  assert.equal(parseEspnParticipants(JSON.stringify(badDate), { registryTeamIds: REGISTRY }).reason, 'structure_invalid');
});
await t('P3 ▲ v0.2.1 载荷身份核对: header.id ≠ competitions[0].id ⇒ event_identity_unverified; header.id 缺 ⇒ 同; urlEventParam 不传(undefined)⇒ 跳过 URL 比对(只查 header/comp 内部一致)', () => {
  const mismatch = clone(DETERMINED); mismatch.header.competitions[0].id = '000000000';
  assert.equal(parseEspnParticipants(JSON.stringify(mismatch), { registryTeamIds: REGISTRY }).reason, 'event_identity_unverified');
  const noId = clone(DETERMINED); delete noId.header.id;
  assert.equal(parseEspnParticipants(JSON.stringify(noId), { registryTeamIds: REGISTRY }).reason, 'event_identity_unverified');
  const ok = parseEspnParticipants(JSON.stringify(DETERMINED), { registryTeamIds: REGISTRY }); // 不传 urlEventParam
  assert.equal(ok.ok, true, 'urlEventParam 省略时不做 URL 比对, 仍能通过(路由层永远会传, 这里只测函数自身契约)');
});
await t('P4 ▲ v0.2.4 参赛方已定核心: team.id/abbreviation/displayName 任一缺 ⇒ event_participants_not_determined; abbr 撞 TIE_TOKEN ⇒ 同; home/away abbr 相同 ⇒ structure_invalid; 缺注册表(undefined/空 Set)⇒ fail-closed 拒(即使字段齐全)', () => {
  const noTeamId = clone(DETERMINED); delete noTeamId.header.competitions[0].competitors[0].team.id;
  assert.equal(parseEspnParticipants(JSON.stringify(noTeamId), { registryTeamIds: REGISTRY }).reason, 'event_participants_not_determined');
  const noAbbr = clone(DETERMINED); delete noAbbr.header.competitions[0].competitors[1].team.abbreviation;
  assert.equal(parseEspnParticipants(JSON.stringify(noAbbr), { registryTeamIds: REGISTRY }).reason, 'event_participants_not_determined');
  const noName = clone(DETERMINED); delete noName.header.competitions[0].competitors[0].team.displayName; delete noName.header.competitions[0].competitors[0].team.shortDisplayName;
  assert.equal(parseEspnParticipants(JSON.stringify(noName), { registryTeamIds: REGISTRY }).reason, 'event_participants_not_determined');
  const tieAbbr = clone(DETERMINED); tieAbbr.header.competitions[0].competitors[0].team.abbreviation = 'TIE';
  assert.equal(parseEspnParticipants(JSON.stringify(tieAbbr), { registryTeamIds: REGISTRY }).reason, 'event_participants_not_determined');
  const sameAbbr = clone(DETERMINED); sameAbbr.header.competitions[0].competitors[1].team.abbreviation = 'BUF';
  assert.equal(parseEspnParticipants(JSON.stringify(sameAbbr), { registryTeamIds: REGISTRY }).reason, 'structure_invalid', 'home/away abbr 撞了(结构层面, 不是"未定")');
  assert.equal(parseEspnParticipants(JSON.stringify(DETERMINED), {}).reason, 'event_participants_not_determined', '不传 registryTeamIds ⇒ fail-closed, 不是"没查就默认已定"');
  assert.equal(parseEspnParticipants(JSON.stringify(DETERMINED), { registryTeamIds: new Set() }).reason, 'event_participants_not_determined', '空 Set 同样 fail-closed');
});
await t('P5 ▲ v0.2.4 负测(设计 §7 明确要求的那一条): team.id 非空且与另一侧互异, 但不在真实球队注册表里 ⇒ event_participants_not_determined(不是靠"非空+互异"旧谓词误判已定)', () => {
  const placeholder = clone(DETERMINED);
  placeholder.header.competitions[0].competitors[1].team = { id: '-1', abbreviation: 'TBD', displayName: 'AFC Championship Winner' };
  const r = parseEspnParticipants(JSON.stringify(placeholder), { registryTeamIds: REGISTRY });
  assert.equal(r.reason, 'event_participants_not_determined');
  assert.match(r.detail, /away/);
  // 对照: 同一份数据但 registryTeamIds 换成"接受一切"的假注册表(含 -1)⇒ 会通过——证明这条测试确实在测注册表解析, 不是别的字段在挡
  const permissive = new Set([...REGISTRY, '-1']);
  assert.equal(parseEspnParticipants(JSON.stringify(placeholder), { registryTeamIds: permissive }).ok, true, '对照臂: 注册表若接受 -1, 则通过——证明拦截点就是注册表解析');
});
await t('P6 ▲ D-032 §2.6-1 MUST(Codex ddf67d6b 审 4dff42d9): opts 里出现 urlEventParam 键(哪怕值是 null/空串)就必须核对且通过, 不能被当"跳过"——只有这个键完全不存在(undefined)才跳过; 删掉这条判据(把 in 判断退回旧的 !==undefined&&!==null)本测必红', () => {
  for (const bad of [null, '', 'wrong-id', '  ']) {
    const r = parseEspnParticipants(JSON.stringify(DETERMINED), { urlEventParam: bad, registryTeamIds: REGISTRY });
    assert.equal(r.reason, 'event_identity_unverified', 'urlEventParam=' + JSON.stringify(bad) + ' 必须拒, 不能被当跳过');
  }
  // 键存在且真等于 header.id 才放行(与 P1 快乐路径对照, 证明这不是"永远拒")
  assert.equal(parseEspnParticipants(JSON.stringify(DETERMINED), { urlEventParam: '401872932', registryTeamIds: REGISTRY }).ok, true);
});

console.log(`\noracle-evidence-extractors.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
