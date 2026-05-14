// Phase B Sub B1.2 — Sports enricher for predictions market questions.
// Owner 5/14 17:00 hat 切 (Bettor architect+reviewer / J1 implementor). spec docs/bettor-phase-b-fundamental-enricher-spec.md §B1.2.
//
// enrichSports(question, description) → { league, teams, standings, schedule, fundamentals }
//   fundamentals: LLM-readable text summary (B1.3 reasoner ingests this as grounded data)
//
// Data source chain (Bettor r111 §4 — Polymarket-native always sanity, never primary):
//   PRIMARY  : ESPN public API (no key) — /sports/<sport>/<league>/standings + /scoreboard
//   SECONDARY: TheSportsDB free API — /searchteams.php + /eventsnext.php (team metadata + schedule)
//   FALLBACK : both unreachable → fundamentals = null (no闭门估, Owner invariant 1)
//
// Cache: in-memory Map keyed by question hash, TTL 1h (matches TTL_BY_DOMAIN.sports in domain-detector).

import { callLLMWithFallback } from './llm-fallback.js';

// ESPN has two hosts with different coverage:
//   - site.api.espn.com (scoreboard / news / per-team) — empty for /standings on most leagues
//   - site.web.api.espn.com (table-style standings) — returns full standings entries
// Standings live on site.web.api.espn.com (empirical 2026-05-14 curl verify).
const ESPN_STANDINGS_BASE = 'https://site.web.api.espn.com/apis/v2';
const ESPN_SCOREBOARD_BASE = 'https://site.api.espn.com/apis/site/v2';
const SPORTSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/3';
const CACHE_TTL_MS = 3600_000; // 1h
const FETCH_TIMEOUT_MS = 8000;

const _cache = new Map(); // key → { result, cachedAt }

// League map: Polymarket question keyword → ESPN slug + TheSportsDB league_id.
// Add more as Phase B B1.2 sees new sports markets in scavenger output.
const LEAGUE_MAP = {
  'english premier league': { espn: 'soccer/eng.1', sportsdb_id: '4328', display: 'EPL' },
  'epl': { espn: 'soccer/eng.1', sportsdb_id: '4328', display: 'EPL' },
  'premier league': { espn: 'soccer/eng.1', sportsdb_id: '4328', display: 'EPL' },
  'nba': { espn: 'basketball/nba', sportsdb_id: '4387', display: 'NBA' },
  'nfl': { espn: 'football/nfl', sportsdb_id: '4391', display: 'NFL' },
  'mlb': { espn: 'baseball/mlb', sportsdb_id: '4424', display: 'MLB' },
  'nhl': { espn: 'hockey/nhl', sportsdb_id: '4380', display: 'NHL' },
  'champions league': { espn: 'soccer/uefa.champions', sportsdb_id: '4480', display: 'UEFA CL' },
};

function detectLeague(question) {
  const q = (question || '').toLowerCase();
  // Longest-match first to avoid 'premier league' partially matching 'english premier league'
  const sorted = Object.keys(LEAGUE_MAP).sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (q.includes(name)) return { keyword: name, ...LEAGUE_MAP[name] };
  }
  return null;
}

// Regex-first team extraction — covers the common Polymarket pattern "Will [Team] win [League]?".
// Saves LLM call for ~80% of sports questions; LLM fallback only for atypical phrasing.
function extractTeamRegex(question) {
  if (!question) return null;
  // "Will [Team] win ..."
  let m = question.match(/will\s+(?:the\s+)?([A-Z][\w'.\s&-]{1,40}?)\s+win\b/i);
  if (m) return m[1].trim().replace(/\s+/g, ' ');
  // "[Team] to win ..."
  m = question.match(/^([A-Z][\w'.\s&-]{1,40}?)\s+to\s+win\b/i);
  if (m) return m[1].trim().replace(/\s+/g, ' ');
  return null;
}

async function extractTeamLLM(question, adapterUrl) {
  const system = 'You extract the primary sports team mentioned in a prediction market question. Output ONLY JSON: {"team": "<team name>"} or {"team": null} if no specific team. No preamble.';
  const llm = await callLLMWithFallback({ system, user: `Question: ${question}\n\nOutput JSON:`, adapterUrl });
  if (!llm.ok || !llm.text) return null;
  const m = llm.text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]).team || null; } catch { return null; }
}

async function extractTeam(question, adapterUrl) {
  // Regex first (no LLM call), LLM fallback only for non-matching patterns
  return extractTeamRegex(question) || await extractTeamLLM(question, adapterUrl);
}

async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchESPNStandings(espnSlug) {
  return fetchJsonSafe(`${ESPN_STANDINGS_BASE}/sports/${espnSlug}/standings`);
}

async function fetchSportsDBTeam(team) {
  return fetchJsonSafe(`${SPORTSDB_BASE}/searchteams.php?t=${encodeURIComponent(team)}`);
}

async function fetchSportsDBNextEvents(teamId) {
  return fetchJsonSafe(`${SPORTSDB_BASE}/eventsnext.php?id=${teamId}`);
}

function summarizeStandings(standings, league, focusTeam) {
  if (!standings) return null;
  try {
    const entries = standings.children?.[0]?.standings?.entries || standings.entries || [];
    if (!entries.length) return null;
    // Top 5 + focus team if not in top 5
    const top = entries.slice(0, 5);
    const focusIdx = entries.findIndex(e => (e.team?.displayName || e.team?.name || '').toLowerCase().includes((focusTeam || '').toLowerCase()));
    const focus = (focusIdx >= 5) ? entries[focusIdx] : null;
    const rows = [...top, ...(focus ? [focus] : [])].map((e, i) => {
      const idx = focus && i === top.length ? focusIdx + 1 : i + 1;
      const name = e.team?.displayName || e.team?.name || '?';
      const stats = e.stats || [];
      const pts = stats.find(s => s.name === 'points')?.displayValue
               ?? stats.find(s => s.name === 'wins')?.displayValue ?? '?';
      const gp = stats.find(s => s.name === 'gamesPlayed')?.displayValue ?? '?';
      return `  ${idx}. ${name}: ${pts} pts (${gp} games)`;
    });
    return `${league.display} standings (top 5${focus ? ' + focus' : ''}):\n${rows.join('\n')}`;
  } catch { return null; }
}

function summarizeNextEvents(events, teamName) {
  if (!events?.events?.length) return null;
  const lines = events.events.slice(0, 3).map(e => {
    const home = e.strHomeTeam || '?';
    const away = e.strAwayTeam || '?';
    const date = e.dateEvent || '?';
    const opp = home === teamName ? away : home;
    return `  vs ${opp} on ${date}`;
  });
  return `Next ${lines.length} matches for ${teamName}:\n${lines.join('\n')}`;
}

export async function enrichSports(question, description, adapterUrl = null) {
  const key = `sports:${question}:${(description || '').slice(0, 200)}`;
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.result;

  const league = detectLeague(question);
  if (!league) {
    const result = { league: null, teams: null, standings: null, schedule: null, fundamentals: null, reason: 'no league matched' };
    _cache.set(key, { result, cachedAt: Date.now() });
    return result;
  }

  const team = await extractTeam(question, adapterUrl);
  if (!team) {
    const result = { league: league.display, teams: null, standings: null, schedule: null, fundamentals: null, reason: 'team extract fail' };
    _cache.set(key, { result, cachedAt: Date.now() });
    return result;
  }

  // Parallel fetch primary + secondary
  const [standings, sportsdbData] = await Promise.all([
    fetchESPNStandings(league.espn),
    fetchSportsDBTeam(team),
  ]);

  const sportsdbTeam = sportsdbData?.teams?.[0] || null;
  const nextEvents = sportsdbTeam?.idTeam ? await fetchSportsDBNextEvents(sportsdbTeam.idTeam) : null;

  const standingsSummary = summarizeStandings(standings, league, team);
  const scheduleSummary = summarizeNextEvents(nextEvents, team);

  // Fundamentals: LLM-readable text combining standings + schedule
  let fundamentals = null;
  if (standingsSummary || scheduleSummary) {
    const parts = [standingsSummary, scheduleSummary].filter(Boolean);
    fundamentals = `League: ${league.display}\nFocus team: ${team}\n\n${parts.join('\n\n')}`;
  }

  const result = {
    league: league.display,
    teams: sportsdbTeam ? [{ name: sportsdbTeam.strTeam, id: sportsdbTeam.idTeam, formed: sportsdbTeam.intFormedYear }] : [{ name: team, id: null }],
    standings: standingsSummary ? 'fetched' : null,
    schedule: scheduleSummary ? 'fetched' : null,
    fundamentals,
    sources: [
      standings ? `${ESPN_STANDINGS_BASE}/sports/${league.espn}/standings` : null,
      sportsdbTeam ? `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(team)}` : null,
      nextEvents ? `https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=${sportsdbTeam?.idTeam}` : null,
    ].filter(Boolean),
  };
  _cache.set(key, { result, cachedAt: Date.now() });
  return result;
}

export const __testing = { LEAGUE_MAP, detectLeague, summarizeStandings, summarizeNextEvents, extractTeamRegex };
