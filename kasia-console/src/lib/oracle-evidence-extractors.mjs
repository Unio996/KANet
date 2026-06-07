// J2-tn r403 Track D Bettor r340 关1 PASS — 证据抽取器 (LLM 喂干净 evidence).
//
// 根因 (Bettor r339b): bettor-prediction-voter.js deriveKanetNativeVote L796-798
// fetch 后 slice(0, 2000) 截断 raw JSON, ESPN summary winner 字段被切 →
// LLM 蒙对/蒙错. 修: source-aware 抽取干净结果字段 (< 500 char) 喂 LLM.
//
// Bettor r340 关1 条件 (= baked here):
// (1) 比赛未结束/延期 → returns null (= LLM 弃权, 不假装 winner).
// (2) 防假并行 (gamma/UMA) 不在此模块, 仍 L102 voter assert 挡死.
// (3) 忠实抽取不加工 (winner 字段原样, 不做语义推理).
//
// 抽取器返干净 evidence_text (≤ 500 字符) 或 null (= 结果未出/抽取失败).
// 没匹配 source → fallback raw slice(0,2000) (= 现 behavior, 保兼容).

/**
 * Parse ESPN summary JSON → extract winner + final score.
 * URL format: https://site.api.espn.com/apis/site/v2/sports/.../summary?event=<id>
 *
 * Bettor 条件 (1): 比赛未 final → 返 null.
 *   ESPN: status.type.completed === true && status.type.state === 'post' = final.
 *   其他状态 (pre/in/halftime/postponed) → 返 null.
 *
 * @param {string} rawText - raw HTTP response text
 * @returns {string|null} - "<winner_name> won (<home_abbr> <hs> - <as> <away_abbr>, <league>)" or null
 */
export function extractEspnEvidence(rawText) {
  let data;
  try { data = JSON.parse(rawText); } catch { return null; }

  // ESPN summary structure: { header: { competitions: [{ competitors: [{...}], status: {...} }] } }
  const comp = data?.header?.competitions?.[0];
  if (!comp) return null;

  // Bettor 条件 (1) — 比赛未 final → null. ESPN: status.type.completed === true.
  const status = comp.status;
  const completed = status?.type?.completed === true;
  const state = status?.type?.state;
  if (!completed || state !== 'post') {
    return null;  // pre/in/postponed → LLM 弃权
  }

  // Bettor 条件 (3) — 忠实抽取. competitors[] 每条含 winner: true/false + score + team.abbreviation.
  const competitors = comp.competitors || [];
  if (competitors.length !== 2) return null;
  const winner = competitors.find(c => c.winner === true);
  if (!winner) return null;

  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;

  const homeTeam = home.team?.abbreviation || home.team?.shortDisplayName || '?';
  const awayTeam = away.team?.abbreviation || away.team?.shortDisplayName || '?';
  const homeScore = home.score ?? '?';
  const awayScore = away.score ?? '?';
  const winnerName = winner.team?.displayName || winner.team?.shortDisplayName || winner.team?.abbreviation || '?';
  const league = data?.header?.league?.abbreviation || data?.leagues?.[0]?.abbreviation || '';

  const evidence = `${winnerName} won (${homeTeam} ${homeScore} - ${awayScore} ${awayTeam}${league ? ', ' + league : ''}).`;
  return evidence.length > 500 ? evidence.slice(0, 497) + '...' : evidence;
}

/**
 * Dispatcher: route by URL → call source-specific extractor.
 * Falls back to raw slice(0, 2000) if no match (= 保 deriveKanetNativeVote 现 behavior).
 *
 * @param {string} url - source URL
 * @param {string} rawText - HTTP response text
 * @returns {string|null} - clean evidence or null (= 结果未出 / 抽取失败, voter 应 abstain)
 */
export function extractEvidence(url, rawText) {
  if (!url || !rawText) return null;
  const lower = String(url).toLowerCase();

  // ESPN site.api.espn.com / cdn.espn.com / espn.com/api
  if (/site\.api\.espn\.com|cdn\.espn\.com|espn\.com\/.*\/api/i.test(lower)) {
    return extractEspnEvidence(rawText);
  }

  // Future: BBC, Reuters, AP, other domain-specific extractors.
  // bbc.co.uk/news: parse <h1 class="story-headline"> + result block.

  // Fallback — 不在已知源, voter 仍 slice raw, 返 null 不影响.
  return null;
}
