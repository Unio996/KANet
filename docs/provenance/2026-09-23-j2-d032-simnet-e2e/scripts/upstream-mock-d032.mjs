// upstream-mock-d032.mjs — D-032 单口径 simnet e2e 用的【受控上游】(改自 docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/scripts/upstream-mock.mjs,
// D-031 复用): 只拦 site.api.espn.com 的两类端点(summary + teams 注册表);不再拦 gamma-api.polymarket.com(D-032 删了第二裁判,永不会被调)。
// 相对原版补的两件事(设计文档明确点名的缺口, docs/2026-09-22-bettor-d032-single-judge-question-closure-design-v0.1.md §2.6-1):
//   ① espnBody 加 header.id / competitions[0].id / competitions[0].date / competitors[].team.id(§2.6-1 载荷身份核对 + 参赛方已定都要这些字段)
//   ② 新增 /teams 端点(球队注册表)——determined 事件的两队 id 出现在注册表里, undetermined 事件的那侧不出现(或整个不在 espn 场景表里)
// 场景文件形状(D-032 版, 比原版简化——只留 espn, 加 registry):
//   { "version": 1,
//     "espn": { "<event id>": { "state":"final"|"in"|"pre", "homeWins":true, "home":"LAL","homeId":"13", "away":"BOS","awayId":"2", "homeScore":110,"awayScore":100, "date":"2026-10-01T00:00Z", "league":"NBA", "http":503? } },
//     "registryTeamIds": ["13","2", ...] }   // 该联赛"已定"球队的 id 全集; 故意漏掉某个 id 就是在模拟"未定席位"
import fs from 'node:fs';

const realFetch = globalThis.fetch;
const ESPN_HOST = 'site.api.espn.com';
const respond = (status, bodyObj) => { const body = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj); return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) }; };

function loadScenario() {
  const f = process.env.E2E_SCENARIO_FILE;
  if (!f) return { err: 'E2E_SCENARIO_FILE 未设' };
  try { const o = JSON.parse(fs.readFileSync(f, 'utf8')); return { sc: o }; } catch (e) { return { err: `场景文件读取失败: ${e.message}` }; }
}
function espnSummaryBody(eventId, e) {
  const done = e.state === 'final';
  return {
    header: {
      id: eventId,
      league: { abbreviation: e.league || 'NBA' },
      competitions: [{
        id: eventId, date: e.date || '2026-10-01T00:00Z',
        status: { type: { completed: done, state: done ? 'post' : (e.state === 'in' ? 'in' : 'pre') } },
        competitors: [
          { homeAway: 'home', winner: !!e.homeWins, score: String(e.homeScore ?? 110), team: { id: e.homeId ?? '1', abbreviation: e.home || 'LAL', displayName: e.home || 'LAL' } },
          { homeAway: 'away', winner: !e.homeWins, score: String(e.awayScore ?? 100), team: { id: e.awayId ?? '2', abbreviation: e.away || 'BOS', displayName: e.away || 'BOS' } },
        ],
      }],
    },
  };
}
function espnTeamsBody(sc) {
  const ids = Array.isArray(sc.registryTeamIds) ? sc.registryTeamIds : [];
  return { sports: [{ leagues: [{ teams: ids.map((id) => ({ team: { id } })) }] }] };
}

globalThis.fetch = async function e2eFetch(url, init) {
  let u; try { u = new URL(String(url)); } catch { return realFetch(url, init); }
  const host = u.hostname.toLowerCase();
  if (host !== ESPN_HOST) return realFetch(url, init);
  const { sc, err } = loadScenario();
  if (err) { console.log(`[e2e-upstream-mock-d032] ${host} ${err} -> 503`); return respond(503, { error: err }); }
  if (u.pathname.endsWith('/teams')) {
    console.log(`[e2e-upstream-mock-d032] ${host} /teams -> registryTeamIds=${JSON.stringify(sc.registryTeamIds || [])}`);
    return respond(200, espnTeamsBody(sc));
  }
  const key = u.searchParams.get('event') || '';
  const e = (sc.espn || {})[key];
  if (!e) { console.log(`[e2e-upstream-mock-d032] ${host} key=${key} -> 404 (未知 event)`); return respond(404, {}); }
  if (e.http && e.http !== 200) { console.log(`[e2e-upstream-mock-d032] ${host} key=${key} -> HTTP ${e.http}`); return respond(e.http, {}); }
  console.log(`[e2e-upstream-mock-d032] ${host} key=${key} -> state=${e.state} ${e.home || 'LAL'}(id=${e.homeId}):${e.homeScore ?? 110}-${e.away || 'BOS'}(id=${e.awayId}):${e.awayScore ?? 100} homeWins=${!!e.homeWins}`);
  return respond(200, espnSummaryBody(key, e));
};
console.log('[e2e-upstream-mock-d032] installed (espn summary+teams intercepted; scenario=' + (process.env.E2E_SCENARIO_FILE || 'UNSET') + ')');
