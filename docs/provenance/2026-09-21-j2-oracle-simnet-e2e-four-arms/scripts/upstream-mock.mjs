// upstream-mock.mjs — simnet e2e 用的【受控上游】: Node 预加载(NODE_OPTIONS=--import=<本文件>)或直接 import。
// 只拦两个 host 的 fetch: site.api.espn.com(ESPN summary)与 gamma-api.polymarket.com; 其余 fetch 原样放行。响应取自场景文件(每次 fetch 现读, 可热切换), 路径 = env E2E_SCENARIO_FILE。
// 真的 deriveKanetNativeVote / derivePolymarketVote 跑在这些响应上(贴标 / 暂态·实质分类 / 极性 / evidence_ref 全走真代码)。
// 场景文件形状:
//   { "version": 3,
//     "espn":       { "<event id>": { "state": "final"|"in", "homeWins": true, "home": "LAL", "away": "BOS", "homeScore": 110, "awayScore": 100, "http": 503? } },
//     "polymarket": { "<condition id 小写>": { "prices": ["1","0"], "closedTime": "2020-01-01T00:00:00.000Z"(可省, 默认此值; 想模拟"定稿窗内"就填近时刻), "empty": false, "http": 503? } } }
// 每次拦截打一行日志: [e2e-upstream-mock] <host> key=<key> scenario_v=<version> -> <what>(NWT 可逐条对回 verdict 行的 evidence_ref)。
// 未知 key ⇒ ESPN 404 / gamma 空数组(derive 侧都是暂态)。场景文件读不到 / 非法 ⇒ 503(暂态), 不静默放行到真网。
import fs from 'node:fs';

const realFetch = globalThis.fetch;
const ESPN_HOST = 'site.api.espn.com', GAMMA_HOST = 'gamma-api.polymarket.com';
const respond = (status, bodyObj) => { const body = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj); return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) }; };

function loadScenario() {
  const f = process.env.E2E_SCENARIO_FILE;
  if (!f) return { err: 'E2E_SCENARIO_FILE 未设' };
  try { const o = JSON.parse(fs.readFileSync(f, 'utf8')); return { sc: o }; } catch (e) { return { err: `场景文件读取失败: ${e.message}` }; }
}
function espnBody(e) {
  const done = e.state === 'final';
  return { header: { league: { abbreviation: e.league || 'NBA' }, competitions: [{ status: { type: { completed: done, state: done ? 'post' : 'in' } }, competitors: [
    { homeAway: 'home', winner: !!e.homeWins, score: String(e.homeScore ?? 110), team: { abbreviation: e.home || 'LAL', displayName: e.home || 'LAL' } },
    { homeAway: 'away', winner: !e.homeWins, score: String(e.awayScore ?? 100), team: { abbreviation: e.away || 'BOS', displayName: e.away || 'BOS' } }] }] } };
}

globalThis.fetch = async function e2eFetch(url, init) {
  let u; try { u = new URL(String(url)); } catch { return realFetch(url, init); }
  const host = u.hostname.toLowerCase();
  if (host !== ESPN_HOST && host !== GAMMA_HOST) return realFetch(url, init);
  const { sc, err } = loadScenario();
  const log = (key, what) => console.log(`[e2e-upstream-mock] ${host} key=${key} scenario_v=${sc ? sc.version : 'NA'} -> ${what}`);
  if (err) { console.log(`[e2e-upstream-mock] ${host} ${err} -> 503`); return respond(503, { error: err }); }
  if (host === ESPN_HOST) {
    const key = u.searchParams.get('event') || '';
    const e = (sc.espn || {})[key];
    if (!e) { log(key, '404 (未知 event)'); return respond(404, {}); }
    if (e.http && e.http !== 200) { log(key, `HTTP ${e.http}`); return respond(e.http, {}); }
    log(key, `state=${e.state} ${e.home || 'LAL'}:${e.homeScore ?? 110}-${e.away || 'BOS'}:${e.awayScore ?? 100} homeWins=${!!e.homeWins}`);
    return respond(200, espnBody(e));
  }
  const key = String(u.searchParams.get('condition_ids') || u.searchParams.get('clob_token_ids') || '').toLowerCase();
  const g = (sc.polymarket || {})[key];
  if (!g) { log(key, '空数组(未知 condition)'); return respond(200, []); }
  if (g.http && g.http !== 200) { log(key, `HTTP ${g.http}`); return respond(g.http, []); }
  if (g.empty) { log(key, '空数组'); return respond(200, []); }
  const closedTime = g.closedTime || '2020-01-01T00:00:00.000Z';   // 固定时间戳(默认远早于 48h 定稿窗)⇒ evidence_raw 逐字节稳定 ⇒ evidence_ref 可对回场景原文
  log(key, `prices=${JSON.stringify(g.prices)} closedTime=${closedTime}`);
  return respond(200, [{ outcomePrices: JSON.stringify(g.prices || []), closed: true, closedTime }]);
};
console.log('[e2e-upstream-mock] installed (espn + gamma intercepted; scenario=' + (process.env.E2E_SCENARIO_FILE || 'UNSET') + ')');
