// proto-oracle-identity.mjs — D-032 §2.6 命题身份绑定("人看的题 = 机器判的题")。
// 设计 docs/2026-09-22-bettor-d032-single-judge-question-closure-design-v0.1.md §2.6(v0.2.4 定稿)。
// 建题时: 抓一次 ESPN summary + 一次同域球队注册表 → parseEspnParticipants(载荷身份核对 + 参赛方已定,
// oracle-evidence-extractors.mjs) → predicate 队名对齐 → 服务端渲染判定语句(纯函数, 运营者不可改内容)
// → 两步回签(attestStatement 原样带回)。判定时回验(home_team/away_team vs canonical_event)落在
// proto-oracle-adapter-core.mjs, 不在这个文件(那边复用的是 extractEspnFields, 不再调这里的 fetch 流程)。
// 🔴 这是本批唯一做网络 IO 的判定题创建路径文件——其余 proto-oracle-*.mjs 头注claim的"无 DB/无 IO"对这个
// 新文件不适用, 特此不与它们混在一起(fetch 全部走注入的 fetchImpl, 测试零真实网络)。
import { parseEspnParticipants, parseEspnTeamsRegistry, normalizeAbbr } from './oracle-evidence-extractors.mjs';

const FETCH_TIMEOUT_MS = 15_000;

/** data_source_canonical 的 ?event= 参数(ESPN summary URL 惯用形态)。取不到 ⇒ null(交给身份核对拒)。 */
export function urlEventParam(url) {
  try { return new URL(String(url)).searchParams.get('event'); } catch { return null; }
}

/** summary URL(.../sports/<sport>/<league>/summary?event=X) → 同域 teams 注册表 URL(.../teams)。路径形状不对 ⇒ null。 */
export function deriveTeamsRegistryUrl(summaryUrl) {
  try {
    const u = new URL(String(summaryUrl));
    if (!/\/summary$/.test(u.pathname)) return null;
    u.pathname = u.pathname.replace(/\/summary$/, '/teams');
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch { return null; }
}

/**
 * §2.6-3 服务端渲染判定语句(纯函数, 代码模板——运营者只能对生成结果原样回签, 不能自己填内容)。
 * @param {{event_id:string, league:string|null, home:{abbr:string,name:string}, away:{abbr:string,name:string}, start_ms:number}} canonicalEvent
 * @param {object} predicate  resolution_predicate(已过 validateResolutionPredicate)
 * @param {{yes:0|1,no:0|1}} sideMap
 * @param {number} outcomeEndMs
 * @returns {string}
 */
export function renderResolutionStatement(canonicalEvent, predicate, sideMap, outcomeEndMs) {
  const operand = predicate?.subject ?? predicate?.operand ?? '?';
  const startIso = Number.isFinite(canonicalEvent?.start_ms) ? new Date(canonicalEvent.start_ms).toISOString() : '?';
  const oeIso = Number.isFinite(outcomeEndMs) ? new Date(outcomeEndMs).toISOString() : '?';
  const league = canonicalEvent?.league || '?';
  const awayName = canonicalEvent?.away?.name ?? '?', homeName = canonicalEvent?.home?.name ?? '?';
  const yes = sideMap?.yes, no = sideMap?.no;
  return `ESPN ${league} event ${canonicalEvent?.event_id ?? '?'} · ${awayName} @ ${homeName} · ${startIso} · 判定: winner == ${operand}(平局=NO) · 取值时刻 >= ${oeIso} · yes→side ${yes} / no→side ${no}`;
}

/**
 * §2.6 建题时的完整命题身份绑定(fetch summary → fetch teams registry → 身份/已定核对 → predicate 对齐 →
 * 渲染判定语句 → 两步回签)。纯粹的编排函数, 每一步的判定逻辑都在被调函数里(便于分别单测)。
 * @param {object} o
 * @param {string} o.url                  data_source_canonical(已过 findExtractor 白名单 + kind==='espn')
 * @param {object} o.predicate            resolution_predicate(已过 validateResolutionPredicate)
 * @param {{yes:0|1,no:0|1}} o.sideMap    已过 normalizeSideMap
 * @param {number} o.outcomeEndMs
 * @param {string|undefined|null} o.attestStatement  请求体的回签; 缺省 = 第一步(只要 statement)
 * @param {(url:string, opts:object)=>Promise<Response>} [o.fetchImpl]  测试注入; 默认全局 fetch
 * @param {number} [o.timeoutMs=15000]
 * @returns {Promise<
 *   {ok:true, canonical_event:object, resolution_statement:string} |
 *   {ok:false, code:string, http:number, detail:string, statement?:string, canonical_event?:object}
 * >}
 */
export async function bindCanonicalEventIdentity({ url, predicate, sideMap, outcomeEndMs, attestStatement, fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS }) {
  let summaryText;
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ok: false, code: 'source_unreachable_at_creation', http: 409, detail: `ESPN summary HTTP ${r.status}` };
    summaryText = await r.text();
  } catch (e) {
    return { ok: false, code: 'source_unreachable_at_creation', http: 409, detail: `ESPN summary fetch 失败: ${String(e?.message || e).slice(0, 160)}` };
  }

  const registryUrl = deriveTeamsRegistryUrl(url);
  if (!registryUrl) return { ok: false, code: 'source_unreachable_at_creation', http: 409, detail: 'data_source_canonical 不是 .../summary 形状, 无法推导球队注册表 URL' };
  let registryText;
  try {
    const r = await fetchImpl(registryUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ok: false, code: 'source_unreachable_at_creation', http: 409, detail: `ESPN teams 注册表 HTTP ${r.status}` };
    registryText = await r.text();
  } catch (e) {
    return { ok: false, code: 'source_unreachable_at_creation', http: 409, detail: `ESPN teams 注册表 fetch 失败: ${String(e?.message || e).slice(0, 160)}` };
  }
  const registryTeamIds = parseEspnTeamsRegistry(registryText) || new Set();

  const parsed = parseEspnParticipants(summaryText, { urlEventParam: urlEventParam(url), registryTeamIds });
  if (!parsed.ok) {
    const HTTP_BY_REASON = { structure_invalid: 409, event_identity_unverified: 400, event_participants_not_determined: 409 };
    const CODE_BY_REASON = { structure_invalid: 'source_unreachable_at_creation', event_identity_unverified: 'event_identity_unverified', event_participants_not_determined: 'event_participants_not_determined' };
    return { ok: false, code: CODE_BY_REASON[parsed.reason] || 'source_unreachable_at_creation', http: HTTP_BY_REASON[parsed.reason] || 409, detail: parsed.detail };
  }
  const canonicalEvent = parsed.canonical_event;

  // §2.6-2: predicate 队名(winner 用 operand, margin/total/score 用 subject——同 validateResolutionPredicate 的既有取值约定)必须 ∈ 参赛方
  const operandAbbr = normalizeAbbr(predicate?.subject ?? predicate?.operand);
  if (!operandAbbr || (operandAbbr !== canonicalEvent.home.abbr && operandAbbr !== canonicalEvent.away.abbr)) {
    return { ok: false, code: 'predicate_team_not_in_event', http: 400, detail: `predicate 队名(${operandAbbr}) 不在本场参赛方(${canonicalEvent.home.abbr}/${canonicalEvent.away.abbr})之中` };
  }

  const statement = renderResolutionStatement(canonicalEvent, predicate, sideMap, outcomeEndMs);

  // §2.6-4: 两步回签——不做模糊匹配, 必须逐字相等
  if (attestStatement === undefined || attestStatement === null) {
    return { ok: false, code: 'attest_required', http: 409, detail: '判定题建题需要两步回签: 先取 statement / canonical_event, 原样带回 attestStatement 重新提交', statement, canonical_event: canonicalEvent };
  }
  if (typeof attestStatement !== 'string' || attestStatement !== statement) {
    return { ok: false, code: 'attest_mismatch', http: 400, detail: 'attestStatement 与服务端渲染的判定语句不逐字相等(不做模糊匹配)', statement, canonical_event: canonicalEvent };
  }
  return { ok: true, canonical_event: canonicalEvent, resolution_statement: statement };
}
