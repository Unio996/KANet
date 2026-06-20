// scripts/prevet-fp-fn-fixtures.mjs
// NWT-tn r341/r344/r345 测试角 — Bettor r367/r376 派 C 阈值实测
// 4 类 × 30 = 120 fixture (= FP<5% / FN<15% 目标)
// 用法: node scripts/prevet-fp-fn-runner.mjs

const futureIso = (offsetHours = 24) => new Date(Date.now() + offsetHours * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

// 1) 好单 30: clear 二元 + 可信源 + 截止 ISO. expected pass (score >=7).
const goodSingleSource = (sym, source, dsc) => ({
  category: 'good_clear',
  expected: 'pass',
  body: {
    title: `Will ${sym} win this matchup?`,
    resolution_rule_spec: { title: `Will ${sym} win this matchup?`, resolution_criteria: `YES if ${sym} wins per ${source} final. NO otherwise.`, data_source_canonical: dsc },
    data_source_canonical: dsc,
    outcome_end_date: futureIso(24),
  }
});

const goodMultiSource = (q, dsc) => ({
  category: 'good_multi',
  expected: 'pass',
  body: {
    title: q,
    resolution_rule_spec: { title: q, resolution_criteria: 'YES if primary source confirms; secondary cross-check ESPN+BBC. NO otherwise.', data_source_canonical: dsc, secondary_sources: ['https://www.bbc.com', 'https://www.reuters.com'] },
    data_source_canonical: dsc,
    outcome_end_date: futureIso(36),
  }
});

const goodEdge = (q, dsc) => ({
  category: 'good_edge',
  expected: 'pass',
  body: {
    title: q,
    resolution_rule_spec: { title: q, resolution_criteria: 'YES if score >= threshold per source. NO otherwise. Tie = NO.', data_source_canonical: dsc },
    data_source_canonical: dsc,
    outcome_end_date: futureIso(48),
  }
});

const goodSingles = [
  goodSingleSource('Yankees', 'ESPN', 'https://www.espn.com/mlb/scoreboard'),
  goodSingleSource('Red Sox', 'ESPN', 'https://www.espn.com/mlb/scoreboard'),
  goodSingleSource('Lakers', 'ESPN', 'https://www.espn.com/nba/scoreboard'),
  goodSingleSource('Liverpool', 'BBC', 'https://www.bbc.com/sport/football/scores-fixtures'),
  goodSingleSource('Real Madrid', 'BBC', 'https://www.bbc.com/sport/football/scores-fixtures'),
  goodSingleSource('Dodgers', 'AP News', 'https://apnews.com/sports/mlb'),
  goodSingleSource('Warriors', 'Reuters', 'https://www.reuters.com/sports/'),
  goodSingleSource('Manchester United', 'BBC', 'https://www.bbc.com/sport'),
  goodSingleSource('Yankees over Boston', 'ESPN', 'https://www.espn.com/mlb/game/_/gameId/401815659'),
  goodSingleSource('Mariners over Detroit', 'ESPN', 'https://www.espn.com/mlb/game/_/gameId/401815647'),
];
const goodMulti = [
  goodMultiSource('Will Bitcoin price > $100,000 by deadline?', 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin'),
  goodMultiSource('Will SPX close > 6,000 by deadline?', 'https://www.reuters.com/markets/us/'),
  goodMultiSource('Will Apple stock close > $200 by deadline?', 'https://finance.yahoo.com/quote/AAPL'),
  goodMultiSource('Will USDT/USD remain >= 0.99 by deadline?', 'https://api.coingecko.com/api/v3/simple/price?ids=tether'),
  goodMultiSource('Will gold spot > $2,500/oz by deadline?', 'https://www.reuters.com/markets/commodities/'),
  goodMultiSource('Will ETH price > $4,000 by deadline?', 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum'),
  goodMultiSource('Will Tesla close > $250 by deadline?', 'https://finance.yahoo.com/quote/TSLA'),
  goodMultiSource('Will SOL > $200 by deadline?', 'https://api.coingecko.com/api/v3/simple/price?ids=solana'),
  goodMultiSource('Will Polymarket trade volume > $1M today?', 'https://polymarket.com/api/markets'),
  goodMultiSource('Will USD/JPY < 150 by deadline?', 'https://www.reuters.com/markets/currencies/'),
];
const goodEdges = [
  goodEdge('Will Chiefs score >= 28 points in next game?', 'https://www.espn.com/nfl/scoreboard'),
  goodEdge('Will Knicks score >= 100 points in next game?', 'https://www.espn.com/nba/scoreboard'),
  goodEdge('Will MLB total runs >= 10 in NYY@BOS today?', 'https://www.espn.com/mlb/game/_/gameId/401815659'),
  goodEdge('Will Premier League goals total >= 3 in Liverpool match?', 'https://www.bbc.com/sport/football'),
  goodEdge('Will UFC main event finish in round 1?', 'https://www.espn.com/mma/schedule'),
  goodEdge('Will boxing main event end via KO?', 'https://www.espn.com/boxing/'),
  goodEdge('Will NBA team score >= 120 in playoff game 1?', 'https://www.espn.com/nba/scoreboard'),
  goodEdge('Will NFL game total points >= 50?', 'https://www.espn.com/nfl/scoreboard'),
  goodEdge('Will baseball game go to extra innings?', 'https://www.espn.com/mlb/scoreboard'),
  goodEdge('Will tennis match go 5 sets?', 'https://www.bbc.com/sport/tennis'),
];

// 2) 垃圾单 30: 缺字段/vague/无 canonical. expected critical (score <4).
const badMissingFields = (cat) => ({
  category: 'bad_missing',
  expected: 'critical',
  body: {
    title: cat,
    resolution_rule_spec: { title: cat, resolution_criteria: 'TBD', data_source_canonical: '' },
    data_source_canonical: '',
    outcome_end_date: '2026-12-31',
  }
});

const badVague = (q) => ({
  category: 'bad_vague',
  expected: 'critical',
  body: {
    title: q,
    resolution_rule_spec: { title: q, resolution_criteria: 'When agreed', data_source_canonical: 'depends' },
    data_source_canonical: 'depends',
    outcome_end_date: 'soon',
  }
});

const badNoSource = (q) => ({
  category: 'bad_no_source',
  expected: 'critical',
  body: {
    title: q,
    resolution_rule_spec: { title: q, resolution_criteria: 'YES if X', data_source_canonical: '' },
    data_source_canonical: '',
    outcome_end_date: futureIso(48),
  }
});

const badMissing = ['Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8','Q9','Q10'].map(badMissingFields);
const badVagues = [
  badVague('Something good'),
  badVague('Will it rain?'),
  badVague('Will tech be ok?'),
  badVague('Will the market be bullish?'),
  badVague('Will the situation improve?'),
  badVague('Will event happen?'),
  badVague('Will tomorrow be good?'),
  badVague('Will the team play well?'),
  badVague('Will stock go up?'),
  badVague('Will it be a busy day?'),
];
const badNoSources = [
  badNoSource('Will Yankees win soon?'),
  badNoSource('Will TEAM A win the game?'),
  badNoSource('Will TEAM B win the matchup?'),
  badNoSource('Will TEAM C achieve victory?'),
  badNoSource('Will player score over 20?'),
  badNoSource('Will the price reach target?'),
  badNoSource('Will season end with team X champion?'),
  badNoSource('Will event finalize positive?'),
  badNoSource('Will Tournament X result favor Y?'),
  badNoSource('Will League outcome match prediction?'),
];

// 3) bait-switch 30: URL 看似可信 但 content 不稳. expected critical (= 不稳源 score 低).
const baitSwitch = (q, dsc) => ({
  category: 'bait_switch',
  expected: 'critical',
  body: {
    title: q,
    resolution_rule_spec: { title: q, resolution_criteria: 'YES if score >= threshold per live feed.', data_source_canonical: dsc },
    data_source_canonical: dsc,
    outcome_end_date: futureIso(72),
  }
});

const baitSwitches = [
  baitSwitch('Will random user homepage say "yes"?', 'https://reddit.com/r/random'),
  baitSwitch('Will Twitter trending topic be X by deadline?', 'https://twitter.com/explore'),
  baitSwitch('Will TikTok view count exceed Y?', 'https://www.tiktok.com/discover'),
  baitSwitch('Will user agreed in chat by deadline?', 'https://discord.com'),
  baitSwitch('Will subreddit upvote count exceed Z?', 'https://reddit.com/r/popular'),
  baitSwitch('Will YouTube comment count match prediction?', 'https://youtube.com/'),
  baitSwitch('Will Facebook reaction count be over X?', 'https://facebook.com/'),
  baitSwitch('Will Instagram likes count match X?', 'https://instagram.com/'),
  baitSwitch('Will gas station price match X?', 'https://gasbuddy.com'),
  baitSwitch('Will random API return X?', 'https://example.com/api/random'),
  baitSwitch('Will scraped page contain phrase X?', 'https://news.ycombinator.com'),
  baitSwitch('Will live count from feed > X?', 'https://livecounter.example.com'),
  baitSwitch('Will Wikipedia article state X?', 'https://en.wikipedia.org/wiki/Main_Page'),
  baitSwitch('Will rss feed contain item X?', 'https://example.com/rss'),
  baitSwitch('Will weather API show >X temp?', 'https://api.openweathermap.org/data/2.5/weather?q=NYC'),
  baitSwitch('Will OSM map data show X?', 'https://www.openstreetmap.org/'),
  baitSwitch('Will random poll result favor X?', 'https://strawpoll.com/'),
  baitSwitch('Will Github trending list contain repo X?', 'https://github.com/trending'),
  baitSwitch('Will stack overflow tag have N questions?', 'https://stackoverflow.com/tags'),
  baitSwitch('Will random blog post contain phrase X?', 'https://medium.com/'),
  baitSwitch('Will streaming service top chart contain X?', 'https://music.apple.com/charts'),
  baitSwitch('Will random forum thread have N replies?', 'https://forum.example.com/'),
  baitSwitch('Will random news aggregator headline say X?', 'https://news.google.com'),
  baitSwitch('Will random store inventory list contain X?', 'https://amazon.com'),
  baitSwitch('Will ticket sale count exceed X?', 'https://ticketmaster.com'),
  baitSwitch('Will random crypto exchange show vol > X?', 'https://example-exchange.com'),
  baitSwitch('Will random sports prediction site favor X?', 'https://fantasysite.example.com'),
  baitSwitch('Will random translator output contain X?', 'https://translate.google.com'),
  baitSwitch('Will random IP geolocation API return Y?', 'https://ipapi.co'),
  baitSwitch('Will random calendar event time slot show X?', 'https://calendar.google.com'),
];

// 4) 主观长尾 30: 无确定源, 主观/品味/未来不可证. expected critical (= 主观=无源).
const subjective = (q) => ({
  category: 'subjective_tail',
  expected: 'critical',
  body: {
    title: q,
    resolution_rule_spec: { title: q, resolution_criteria: 'YES if widely considered true.', data_source_canonical: '' },
    data_source_canonical: '',
    outcome_end_date: futureIso(96),
  }
});

const subjectives = [
  subjective('Who is the best player in 2026?'),
  subjective('Will this stock be a good investment?'),
  subjective('Is this a fair price for the painting?'),
  subjective('Will the new movie be great?'),
  subjective('Is the food at restaurant X good?'),
  subjective('Will people like the new album?'),
  subjective('Is the company well-managed?'),
  subjective('Will the team have a successful season?'),
  subjective('Is the new policy effective?'),
  subjective('Will the design choice be popular?'),
  subjective('Is the website easy to use?'),
  subjective('Will the book be a bestseller?'),
  subjective('Is the player overrated?'),
  subjective('Will the event be successful?'),
  subjective('Is this a smart move?'),
  subjective('Will fans love the new product?'),
  subjective('Is the article well-written?'),
  subjective('Will the brand maintain reputation?'),
  subjective('Is the leader competent?'),
  subjective('Will the project be remembered?'),
  subjective('Is the algorithm fair?'),
  subjective('Will the technology mature soon?'),
  subjective('Is the speech persuasive?'),
  subjective('Will the campaign be effective?'),
  subjective('Is the meeting productive?'),
  subjective('Will the strategy succeed long-term?'),
  subjective('Is the partnership beneficial?'),
  subjective('Will the venue be liked?'),
  subjective('Is the artwork meaningful?'),
  subjective('Will the practice gain traction?'),
];

export const fixtures = [
  ...goodSingles, ...goodMulti, ...goodEdges,
  ...badMissing, ...badVagues, ...badNoSources,
  ...baitSwitches,
  ...subjectives,
];
// Counts per category (sanity check)
export const categoryCounts = {
  good_clear: goodSingles.length,
  good_multi: goodMulti.length,
  good_edge: goodEdges.length,
  bad_missing: badMissing.length,
  bad_vague: badVagues.length,
  bad_no_source: badNoSources.length,
  bait_switch: baitSwitches.length,
  subjective_tail: subjectives.length,
};
