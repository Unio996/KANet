// Market category classifier — prediction-menu bot discovery (Bettor r240 S-B + Owner r93 多样性钦定).
// Maps a market's question / resolution_rule_spec to one of the 4 Owner-钦定 buckets
// (政治/经济/体育/加密) + 'other' fallback. Consumed by:
//   - pool-market-seeder.js  (polymarket mirror → category, fallback when gamma has no category)
//   - pool.js create endpoint (auto-categorize when caller omits category)
//   - migrate.js v155 backfill (categorize pre-existing markets by their rule text)
//
// Anti-pattern #12 (CLAUDE.md): CJK keywords MUST NOT use \b. EN keywords keep \b for precision.
// So each category carries two regexes — an ASCII-only \b regex and a CJK no-\b regex — checked together.

const RULES = [
  ['politics',
    /\b(election|president|presidential|senate|house|congress|midterm|approval rating|approval|poll|primary|governor|parliament|referendum|impeach|trump|biden|harris|democrat|republican|gop|war|wars|ceasefire|peace deal|peace talks|treaty|sanctions|nuclear|invasion|invade|airstrike|nato|putin|zelensky|netanyahu|hostage|coup|iran|ukraine|russia|israel|gaza|taiwan|venezuela|north korea)\b/i,
    /(选举|中期选举|大选|总统|参议院|众议院|国会|支持率|民调|公投|弹劾|战争|停火|和平|制裁|核武|入侵|军事|伊朗|乌克兰|俄罗斯|以色列|台湾|朝鲜|委内瑞拉)/],
  ['economy',
    /\b(fed|fomc|rate cut|rate hike|interest rate|cpi|inflation|gdp|recession|unemployment|jobs report|powell|treasury yield|tariff|s&p 500|nasdaq|dow jones)\b/i,
    /(降息|加息|利率|通胀|通货膨胀|美联储|经济衰退|失业|关税)/],
  ['sports',
    /\b(nba|nfl|mlb|nhl|world cup|premier league|champions league|super bowl|finals|playoff|playoffs|championship|celtics|lakers|world series|fifa|olympics|grand slam|formula 1)\b/i,
    /(世界杯|总冠军|季后赛|超级碗|英超|欧冠|奥运|总决赛|夺冠|出线)/],
  ['crypto',
    /\b(kas|kaspa|btc|bitcoin|eth|ethereum|sol|solana|hashrate|hash rate|crypto|blockchain|defi|stablecoin|altcoin|halving)\b/i,
    /(算力|比特币|以太坊|加密货币|区块链|稳定币|减半)/],
];

export function categorizeMarket(text) {
  const s = String(text || '');
  for (const [cat, enRe, cjkRe] of RULES) {
    if (enRe.test(s) || cjkRe.test(s)) return cat;
  }
  return 'other';
}

export const MARKET_CATEGORIES = ['politics', 'economy', 'sports', 'crypto', 'other'];
