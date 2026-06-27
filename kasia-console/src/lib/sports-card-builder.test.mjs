// sports-card-builder 护栏回归测试 (J2-tn 2026-06-27). 跑: node kasia-console/src/lib/sports-card-builder.test.mjs
// 守 6 护栏不退化: ESPN源(2)/sport-aware线(3)/半线no-push(6)/J1接口雷(无"+")/abbr单源/predicate正确+judgeLine round-trip。
import { buildSportsCard } from './sports-card-builder.mjs';
import { judgeLine } from './judgeline.mjs';

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.error(`✘ ${name}`); } }
function eq(got, want, name) { if (got === want) pass++; else { fail++; console.error(`✘ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } }

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=760487';
const base = {
  sport: 'soccer', league_label: 'FIFA World Cup', event_id: '760487',
  data_source_canonical: ESPN, home_team: 'BRA', away_team: 'JPN',
  home_name: 'Brazil', away_name: 'Japan', favorite: 'BRA', outcome_end_date: '2026-06-29T20:30:00Z',
};
const full = (legs) => buildSportsCard({ ...base, legs });

// ── 1. happy path: 5 盘全建 + predicate 正确 ──
const card = full({ winner: ['BRA', 'JPN'], spread: ['-0.5', '-1.5'], total: ['2.5'] });
ok(card.valid, 'happy: valid=true');
eq(card.markets.length, 5, 'happy: 5 markets');
eq(card.card_group_id, 'espn-FIFA_World_Cup-760487', 'happy: card_group_id');
const byKey = Object.fromEntries(card.markets.map(m => [m.leg_key, m]));
eq(JSON.stringify(byKey['winner_BRA'].resolution_predicate), JSON.stringify({ metric: 'winner', op: '==', operand: 'BRA' }), 'winner_BRA predicate');
eq(JSON.stringify(byKey['spread_BRA_-1.5'].resolution_predicate), JSON.stringify({ metric: 'margin', op: '>', operand: 15, scale: 1, subject: 'BRA' }), 'spread -1.5 predicate (operand=-line)');
eq(JSON.stringify(byKey['total_o_2.5'].resolution_predicate), JSON.stringify({ metric: 'total', op: '>', operand: 25, scale: 1 }), 'total 2.5 predicate');
// spec 含 event_id/card_group/data_source 绑定
const spec0 = JSON.parse(byKey['winner_BRA'].resolution_rule_spec);
ok(spec0.event_id === '760487' && spec0.card_group_id === card.card_group_id && spec0.data_source_canonical === ESPN, 'spec binds event_id/card_group/data_source');
ok(spec0.resolution_predicate && spec0.title && spec0.resolution_criteria, 'spec has predicate+title+criteria (isStructuredSpec)');

// ── 2. 护栏6 半线 no-push (硬铁律) ──
ok(!full({ spread: ['-1'] }).valid, 'G6: soccer integer line -1 rejected');
ok(!buildSportsCard({ ...base, sport: 'basketball', data_source_canonical: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=1', legs: { spread: ['-3'] } }).valid, 'G6: non-soccer integer -3 rejected (no-push backstop)');
ok(!buildSportsCard({ ...base, sport: 'basketball', data_source_canonical: 'https://site.api.espn.com/x/summary?event=1', legs: { total: ['220.0'] } }).valid, 'G6: x.0 integer-equiv 220.0 rejected');
ok(buildSportsCard({ ...base, sport: 'basketball', data_source_canonical: 'https://site.api.espn.com/x/summary?event=1', legs: { spread: ['-3.5'] } }).valid, 'G6: non-soccer half -3.5 accepted');

// ── 3. J1 接口雷: "+" 前缀拒 ──
ok(!full({ spread: ['+1.5'] }).valid, 'J1trap: "+1.5" rejected (no plus sign)');

// ── 4. 护栏2 score 源: 非 ESPN 拒 ──
ok(!buildSportsCard({ ...base, data_source_canonical: 'https://gamma-api.polymarket.com/markets?clob_token_ids=x&closed=true', legs: { winner: ['BRA'] } }).valid, 'G2: polymarket source rejected');
ok(!buildSportsCard({ ...base, data_source_canonical: '', legs: { winner: ['BRA'] } }).valid, 'G2: empty source rejected');
ok(!buildSportsCard({ ...base, data_source_canonical: 'http://site.api.espn.com/x/summary?event=1', legs: { winner: ['BRA'] } }).valid, 'G2: http (non-https) ESPN rejected (SSRF/MITM guard)');

// ── 5. 护栏3 sport-aware: 足球禁棒球线 ──
ok(!full({ spread: ['-3.5'] }).valid, 'G3: soccer -3.5 (baseball line) rejected');
ok(!full({ total: ['8.5'] }).valid, 'G3: soccer total 8.5 rejected (out of allowed set)');

// ── 6. abbr 单源 + 校验 ──
const lc = buildSportsCard({ ...base, home_team: 'bra', away_team: 'jpn', favorite: 'bra', legs: { winner: ['bra'] } });
ok(lc.valid && lc.markets[0].resolution_predicate.operand === 'BRA', 'abbr: lowercase input normalized to BRA');
ok(!full({ winner: ['ARG'] }).valid, 'winner operand not in {home,away} rejected');
ok(!buildSportsCard({ ...base, favorite: 'ARG', legs: { spread: ['-0.5'] } }).valid, 'favorite not in {home,away} rejected');
// spread subject 必 == favorite
const sp = full({ spread: ['-0.5'] });
ok(sp.valid && sp.markets[0].resolution_predicate.subject === 'BRA', 'spread subject == favorite (BRA)');

// ── 7. judgeLine round-trip (built predicate → 终局 fields → verdict 对死) ──
const F_bra20 = { home_team: 'BRA', away_team: 'JPN', home_score: 2, away_score: 0, winner_side: 'BRA' };
const F_draw = { home_team: 'BRA', away_team: 'JPN', home_score: 1, away_score: 1, winner_side: 'TIE' };
eq(judgeLine(byKey['winner_BRA'].resolution_predicate, F_bra20), 'YES', 'RT: BRA 2-0 winner_BRA=YES');
eq(judgeLine(byKey['spread_BRA_-1.5'].resolution_predicate, F_bra20), 'YES', 'RT: BRA 2-0 spread-1.5=YES');
eq(judgeLine(byKey['total_o_2.5'].resolution_predicate, F_bra20), 'NO', 'RT: total 2 goals over2.5=NO');
eq(judgeLine(byKey['winner_BRA'].resolution_predicate, F_draw), 'NO', 'RT: 1-1 draw winner_BRA=NO');
eq(judgeLine(byKey['spread_BRA_-0.5'].resolution_predicate, F_draw), 'NO', 'RT: 1-1 draw spread-0.5=NO');

console.log(`\nsports-card-builder.test: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
