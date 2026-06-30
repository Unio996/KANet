// nwt-espn-sports-judge.mjs — NWT域判v1: polymarket体育盘ESPN独立判 (Owner GO 2026-06-30·#26延伸)
// 覆盖: outcome_market_source='polymarket' + category='sports' + "Will X win?" 型比赛结果盘
// 独立源: ESPN scoreboard API (非市价·非judgeLine·非借用ESPN-native市场·Bettor co-verify)
// ABSTAIN: O/U/handicap/advance/qualify/championship/无法解析/赛事未完结/ESPN无数据

const SPORT_MAP = [
  { pat: /\b(ATP|WTA|Roland Garros|Wimbledon|US Open|Australian Open|French Open|Grand Slam)\b/i, slug: 'tennis' },
  { pat: /\b(FIFA|World Cup|MLS|Premier League|La Liga|Bundesliga|Serie A|Ligue 1|UEFA|Copa)\b/i, slug: 'soccer/FIFA.WORLDCUP' },
  { pat: /\bNBA\b/i,  slug: 'basketball/nba' },
  { pat: /\bMLB\b/i,  slug: 'baseball/mlb' },
  { pat: /\bNFL\b/i,  slug: 'football/nfl' },
  { pat: /\bNHL\b/i,  slug: 'hockey/nhl' },
  { pat: /\bNCAAB\b/i, slug: 'basketball/mens-college-basketball' },
];

// Exclude non-"will X win" question types → ABSTAIN without judging
const EXCLUDE = [
  /over[\s\/]under/i, /\bO\/U\b/, /total\s+goals/i, /both\s+teams.*score/i,
  /\bspread\b/i, /handicap/i, /\badvance\b/i, /qualify/i, /championship/i,
  /\bseason\b/i, /\bdraft\b/i, /\btransfer\b/i,
];

// Match "will X win" / "X to win" target team
const WIN_RE = [
  /will\s+(.+?)\s+win(?:\s+(?:the|against|vs|on)|\s*\?)/i,
  /^(.+?)\s+to\s+win\b/i,
];

function detectSlug(text) {
  for (const { pat, slug } of SPORT_MAP) if (pat.test(text)) return slug;
  return null;
}

function extractTeam(text) {
  for (const re of WIN_RE) {
    const m = re.exec(text);
    if (m?.[1]) return m[1].replace(/\?$/, '').trim();
  }
  return null;
}

function extractDate(text) {
  // "scheduled for May 28, 2026 at" or "on 2026-06-30" or "June 30, 2026"
  const pats = [
    /(?:scheduled for|on)\s+(\w+\s+\d{1,2},\s*\d{4})/i,
    /\b(\d{4}-\d{2}-\d{2})\b/,
    /\b(\w+ \d{1,2}, \d{4})\b/,
  ];
  for (const p of pats) {
    const m = p.exec(text);
    if (m) { const d = new Date(m[1]); if (!isNaN(d)) return d; }
  }
  return null;
}

function toESPNDateStr(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function teamNameMatch(competitor, team) {
  const tl = team.toLowerCase();
  const c = competitor;
  return (
    c.team?.displayName?.toLowerCase().includes(tl) ||
    c.team?.shortDisplayName?.toLowerCase().includes(tl) ||
    c.team?.name?.toLowerCase().includes(tl) ||
    c.team?.abbreviation?.toLowerCase() === tl ||
    c.athlete?.displayName?.toLowerCase().includes(tl)  // tennis: player name
  );
}

export const espnSportsJudge = {
  id: 'nwt-espn-sports-v1',

  /** 只应用于 polymarket体育盘 + "比赛结果型"("Will X win?")·其余ABSTAIN */
  appliesTo(market) {
    if (market.outcome_market_source !== 'polymarket') return false;
    if (market.category !== 'sports') return false;
    const spec = String(market.resolution_rule_spec || '');
    for (const ex of EXCLUDE) if (ex.test(spec)) return false;
    for (const re of WIN_RE) if (re.test(spec)) return true;
    return false;
  },

  /** 独立读 ESPN scoreboard → 判队伍赢没赢 → YES|NO|ABSTAIN。throws → 上层 ABSTAIN(不影响结算) */
  async judge(market) {
    const spec = String(market.resolution_rule_spec || '');
    const slug = detectSlug(spec);
    if (!slug) return 'ABSTAIN';

    const team = extractTeam(spec);
    if (!team) return 'ABSTAIN';

    const date = extractDate(spec);
    if (!date) return 'ABSTAIN';

    const url = `https://site.api.espn.com/apis/site/v2/sports/${slug}/scoreboard?dates=${toESPNDateStr(date)}`;
    const data = await (await fetch(url, { signal: AbortSignal.timeout(6000) })).json();

    for (const event of (data.events || [])) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      const competitors = comp.competitors || [];
      const myTeam = competitors.find(c => teamNameMatch(c, team));
      if (!myTeam) continue;
      if (!comp.status?.type?.completed) return 'ABSTAIN';  // 赛事未结束 → 不判
      return myTeam.winner ? 'YES' : 'NO';
    }
    return 'ABSTAIN';  // ESPN无此赛事数据
  },
};
