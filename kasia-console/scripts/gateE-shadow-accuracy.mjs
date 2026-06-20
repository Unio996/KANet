// Polymarket shadow-accuracy harness (NWT-tn lead, Owner Q1 方向, Bettor r1073 派)
// ============================================================================
// 测【native 预言机 vs UMA/Polymarket 独立 ground-truth】的逐 domain 准确率。
// 比 gateE-espn-accuracy 进一步: 那个 ESPN 既判源又 ground-truth(非独立);
// 这个 judge=ESPN(独立源) / ground-truth=UMA gamma resolved outcome(真独立权威)。
//
// 【fidelity·复用线E纪律】直接 import 生产 deriveKanetNativeVote + derivePolymarketVote
//   (bettor-prediction-voter.js)= 真 ESPN fetch + 真 extractEvidence + J2 canonical
//   prompt + 真 LLM。零 mock、零 mirror。
//
// 【关键前置·我 r1078 发现】168 polymarket 市场全 dsc=polymarket:condId(非 fetchable)
//   → deriveKanetNativeVote 直接喂会 ABSTAIN。∴ harness 先建 title→独立源 resolver:
//   sports 市场 → ESPN scoreboard URL(由 deadline 日期 + league)→ 喂 native judge。
//   非 sports / resolver 不出 URL = coverage gap(=能力扩张 frontier, 显式报)。
//
// 【ground-truth】derivePolymarketVote(offer) 查 gamma by condition_id → UMA resolved
//   YES/NO(48h finalization gate; testnet 用 UMA_FINALIZATION_WINDOW_MS=0 可放宽)。
//
// 【trial-ramp】--trial = 5 个先验 harness 通; --n=N 扩。错峰 sleep 别砸 :8000。
// 【干净数字】by-domain: graded / correct / abstain / coverage-gap, 分开报不聚合虚高。
// 用: node scripts/gateE-shadow-accuracy.mjs --trial   (从 kasia-console/)
// ============================================================================
process.env.QWEN_LLM_URL = process.env.QWEN_LLM_URL || 'http://127.0.0.1:8000/v1';
// testnet: 放宽 UMA 48h finalization gate (历史市场早 finalized, 但避免 closedTime 缺失误 abstain)
if (process.env.UMA_FINALIZATION_WINDOW_MS === undefined) process.env.UMA_FINALIZATION_WINDOW_MS = '0';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { deriveKanetNativeVote, derivePolymarketVote } = await import('../src/services/bettor-prediction-voter.js');

const ARGS = process.argv.slice(2);
const TRIAL = ARGS.includes('--trial');
const LIMIT = TRIAL ? 5 : (parseInt((ARGS.find(a => a.startsWith('--n=')) || '').slice(4), 10) || 20);
const SLEEP_MS = 1300;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── title→ESPN resolver (复用 bettor-sports-enricher LEAGUE_MAP 逻辑) ──
const LEAGUE_MAP = {
  'premier league': 'soccer/eng.1', 'epl': 'soccer/eng.1',
  'nba': 'basketball/nba', 'nfl': 'football/nfl', 'mlb': 'baseball/mlb',
  'nhl': 'hockey/nhl', 'champions league': 'soccer/uefa.champions',
  'la liga': 'soccer/esp.1', 'bundesliga': 'soccer/ger.1', 'serie a': 'soccer/ita.1',
};
function detectLeague(title) {
  const q = (title || '').toLowerCase();
  for (const name of Object.keys(LEAGUE_MAP).sort((a, b) => b.length - a.length)) {
    if (q.includes(name)) return LEAGUE_MAP[name];
  }
  return null;
}

// team→league 映射 (数据驱动: 启动时 fetch 4 大联赛 team 列表建 token map).
// "Cleveland Guardians vs. New York Yankees" 这类 matchup 无联赛名 → 靠 team 反查 league.
const TEAM_LEAGUE = new Map(); // lowercased team displayName/nickname → espnSlug
async function buildTeamLeagueMap() {
  const leagues = ['baseball/mlb', 'basketball/nba', 'football/nfl', 'hockey/nhl'];
  for (const lg of leagues) {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${lg}/teams`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const j = await r.json();
      const teams = j.sports?.[0]?.leagues?.[0]?.teams || [];
      for (const t of teams) {
        const tm = t.team || {};
        for (const key of [tm.displayName, tm.name, tm.nickname, tm.location, tm.shortDisplayName]) {
          if (key && key.length > 2) TEAM_LEAGUE.set(key.toLowerCase(), lg);
        }
      }
    } catch {}
  }
}
// 从 "Team A vs. Team B" title 反查 league (任一 team 命中即可)
function leagueFromTeams(title) {
  const t = (title || '').toLowerCase();
  for (const [team, lg] of TEAM_LEAGUE) {
    if (t.includes(team)) return lg;
  }
  return null;
}
// 是否单场 matchup (非 futures/赛季)
function isSingleGame(title) {
  const tl = (title || '').toLowerCase();
  if (/\bwin the\b|\bchampionship\b|\bmvp\b|\bworld cup\b|\bnba finals\b|\bsuper bowl\b|\bmake the playoffs\b/.test(tl)) return false;
  return /\bvs\.?\b|\bbeat\b|@| at /.test(tl);
}
// deadline (unix sec) → YYYYMMDD (UTC). ESPN scoreboard?dates= 接受这格式。
function deadlineToDate(deadlineSec) {
  if (!deadlineSec) return null;
  const d = new Date(deadlineSec * 1000);
  const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0'), day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
// gamma metadata (真比赛日 + YES-team 映射). closedTime ≈ 比赛后(比 seeded deadline / endDate 可靠).
// outcomes[i] 对 outcomePrices[i]: price=1 的 outcome = 该市场 resolved 的赢方 = UMA "YES" 对应队.
async function fetchGammaMeta(conditionId) {
  try {
    const r = await fetch(`https://gamma-api.polymarket.com/markets?condition_ids=${encodeURIComponent(conditionId)}&closed=true`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const m = (await r.json())[0];
    if (!m) return null;
    let outcomes = []; try { outcomes = JSON.parse(m.outcomes || '[]'); } catch {}
    let prices = []; try { prices = JSON.parse(m.outcomePrices || '[]'); } catch {}
    // 真比赛日: closedTime(market 关 ≈ 赛后) 优先, fallback endDate. ISO → Date.
    // closedTime 格式 "2026-06-03 03:42:33+00" 非标准(+00 应 +00:00/Z) → 规范化再 parse.
    const normTs = (s) => s ? new Date(s.replace(' ', 'T').replace(/\+00$/, 'Z').replace(/([+-]\d{2})$/, '$1:00')) : null;
    let gameDateRef = normTs(m.closedTime);
    if (!gameDateRef || isNaN(gameDateRef.getTime())) gameDateRef = m.endDate ? new Date(m.endDate) : null;
    const yesIdx = prices.findIndex(p => parseFloat(p) === 1);
    return { outcomes, prices, gameDateRef, yesTeam: yesIdx >= 0 ? outcomes[yesIdx] : null, question: m.question, description: m.description };
  } catch { return null; }
}

// "Team A vs. Team B" → [a, b] team 名 (lowercased, 去掉 vs/at)
function parseMatchup(title) {
  const m = (title || '').split(/\s+vs\.?\s+|\s+@\s+|\s+at\s+/i);
  if (m.length !== 2) return null;
  return [m[0].trim(), m[1].replace(/\?$/, '').trim()];
}
// resolver: market → ESPN SUMMARY URL (单场 event id) — 非 scoreboard!
// extractEspnEvidence 只解析 summary 结构(header.competitions), scoreboard(events[])不认.
// ∴ 必须先查 scoreboard 找到 event id, 再出 summary URL (= line-E 做法).
// 只 grade 单场 matchup (futures/赛季 ESPN 判不了 = frontier).
async function resolveIndependentSource(title, baseDate) {
  if (!isSingleGame(title)) return { url: null, reason: 'not-single-game(futures/season)' };
  const league = detectLeague(title) || leagueFromTeams(title);
  if (!league) return { url: null, reason: 'no-league/team-match' };
  const teams = parseMatchup(title);
  if (!teams) return { url: null, reason: 'no-matchup-parse' };
  if (!baseDate || isNaN(baseDate.getTime())) return { url: null, reason: 'no-game-date' };
  // gamma closedTime ≈ 赛后 → 试当天及前 3 天找比赛 (game date <= closedTime)
  for (let back = 0; back <= 3; back++) {
    const d = new Date(baseDate.getTime() - back * 86400000);
    const date = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    let games;
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard?dates=${date}`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      games = (await r.json()).events || [];
    } catch { continue; }
    for (const e of games) {
      const comp = e.competitions?.[0];
      const cs = comp?.competitors || [];
      const names = cs.map(x => (x.team?.displayName || x.team?.name || '').toLowerCase());
      const hit = teams.every(t => names.some(n => n.includes(t.toLowerCase()) || t.toLowerCase().includes(n)));
      // 只取 final 场 (completed=true), 否则系列赛里 scheduled 那场 → extractor null → ABSTAIN
      if (hit && comp?.status?.type?.completed === true) {
        return { url: `https://site.api.espn.com/apis/site/v2/sports/${league}/summary?event=${e.id}`, league, date, eventId: e.id };
      }
    }
  }
  return { url: null, reason: 'game-not-found-in-scoreboard' };
}

function domainOf(title) {
  const t = (title || '').toLowerCase();
  if (detectLeague(title) || /\b(vs\.?|beat|defeat|win|game|match)\b/.test(t)) return 'sports';
  if (/\b(bitcoin|btc|eth|crypto|price|\$\d|coin|solana)\b/.test(t)) return 'crypto';
  if (/\b(election|president|trump|senate|vote|nominee)\b/.test(t)) return 'politics';
  return 'other';
}

(async () => {
  console.log(`=== Polymarket shadow-accuracy harness ${TRIAL ? '[TRIAL 5]' : `[N=${LIMIT}]`} (import 生产 deriveKanetNativeVote + derivePolymarketVote) ===`);
  console.log(`LLM=${process.env.QWEN_LLM_URL} | UMA_FINAL_WINDOW=${process.env.UMA_FINALIZATION_WINDOW_MS}\n`);

  process.stdout.write('building team→league map (ESPN teams)... ');
  await buildTeamLeagueMap();
  console.log(`${TEAM_LEAGUE.size} team tokens mapped\n`);

  const db = new Database('data/console.db', { readonly: true, timeout: 5000 });
  // 取已结算 polymarket 市场(有 condition_id = 可查 gamma ground-truth)
  const rows = db.prepare(`
    SELECT id, resolution_rule_spec, outcome_condition_id, outcome_token_id, deadline, protocol_status
    FROM pool_markets
    WHERE outcome_market_source = 'polymarket' AND outcome_condition_id IS NOT NULL
    ORDER BY deadline DESC
  `).all();
  db.close();

  // 廉价预分类 (不 fetch): domain + 单场 + league-knowable = resolvable-in-principle
  const candidates = [];
  for (const r of rows) {
    let spec = {}; try { spec = JSON.parse(r.resolution_rule_spec || '{}'); } catch {}
    const title = spec.title || '';
    const domain = domainOf(title);
    const single = isSingleGame(title);
    const leagueKnown = !!(detectLeague(title) || leagueFromTeams(title));
    const inPrinciple = single && leagueKnown && !!r.deadline;
    candidates.push({ id: r.id, title, domain, conditionId: r.outcome_condition_id, tokenId: r.outcome_token_id, deadline: r.deadline, inPrinciple });
  }

  // coverage 报告 (resolvable-in-principle vs frontier) — 廉价, 不 fetch
  const cov = {};
  for (const c of candidates) {
    cov[c.domain] ||= { total: 0, resolvable: 0 };
    cov[c.domain].total++;
    if (c.inPrinciple) cov[c.domain].resolvable++;
  }
  console.log('=== coverage (独立源 in-principle 可解析 by domain) ===');
  for (const [d, s] of Object.entries(cov)) console.log(`  ${d}: ${s.resolvable}/${s.total} resolvable (frontier gap = ${s.total - s.resolvable})`);
  console.log('');

  // 对 in-principle 的逐个: fetch gamma meta(真比赛日 closedTime + YES-team) → resolve ESPN event → 凑够 LIMIT
  const pool = candidates.filter(c => c.inPrinciple);
  const gradable = [];
  for (const c of pool) {
    if (gradable.length >= LIMIT) break;
    c.gamma = await fetchGammaMeta(c.conditionId);
    if (!c.gamma || !c.gamma.gameDateRef) { c.resolved = { url: null, reason: 'no-gamma-meta' }; continue; }
    c.resolved = await resolveIndependentSource(c.title, c.gamma.gameDateRef);
    if (c.resolved.url) gradable.push(c);
  }
  console.log(`=== grading ${gradable.length} resolved 市场 (native ESPN summary vs UMA gamma, 真比赛日=gamma closedTime) ===\n`);

  const results = [];
  for (const c of gradable) {
    // YES-team = gamma outcomes[price=1] (= UMA resolved 赢方), 非假设第一队. criteria 明确该队=YES.
    const teams = parseMatchup(c.title) || [c.title, ''];
    const yesTeam = c.gamma.yesTeam || teams[0];
    const noTeam = (c.gamma.outcomes || []).find(o => o !== yesTeam) || teams[1];
    const offer = {
      id: c.id, outcome_market_source: 'polymarket', outcome_condition_id: c.conditionId, outcome_token_id: c.tokenId,
      resolution_rule_spec: JSON.stringify({ title: c.title, resolution_criteria: `Resolves YES if the ${yesTeam} won this game per the ESPN final box score; NO if the ${noTeam} won. Output YES or NO based on which team won.`, data_source_canonical: c.resolved.url }),
    };
    // 1. native judge (ESPN 独立源, 生产管线)
    let native; try { native = await deriveKanetNativeVote(offer, JSON.parse(offer.resolution_rule_spec)); } catch (e) { native = { ok: false, reason: 'EXC:' + e.message }; }
    // 2. UMA ground-truth (gamma resolved)
    let uma; try { uma = await derivePolymarketVote(offer); } catch (e) { uma = { ok: false, reason: 'EXC:' + e.message }; }

    const nativeOut = native?.ok ? native.outcome : `abstain(${(native?.reason || '').split(':')[0].slice(0, 20)})`;
    const umaOut = uma?.ok ? uma.outcome : `n/a(${(uma?.reason || '').split(':')[0].slice(0, 20)})`;
    const graded = native?.ok && native.outcome !== 'ABSTAIN' && uma?.ok;
    const correct = graded ? (native.outcome === uma.outcome) : null;
    results.push({ c, nativeOut, umaOut, graded, correct, nativeAbstain: native?.ok && native.outcome === 'ABSTAIN' });
    const mark = correct === true ? '✓' : correct === false ? '✗' : '·';
    console.log(`${mark} [${c.domain}] ${c.title.slice(0, 38).padEnd(38)} native=${String(nativeOut).padEnd(14)} uma=${String(umaOut).padEnd(12)} ${graded ? (correct ? 'MATCH' : 'DISAGREE') : 'ungraded'}`);
    await sleep(SLEEP_MS);
  }

  // 干净数字 by-domain
  console.log(`\n=== 干净数字 (native vs UMA ground-truth) ===`);
  const byDom = {};
  for (const r of results) {
    const d = r.c.domain; byDom[d] ||= { graded: 0, correct: 0, nativeAbstain: 0, umaNa: 0 };
    if (r.graded) { byDom[d].graded++; if (r.correct) byDom[d].correct++; }
    else if (r.nativeAbstain) byDom[d].nativeAbstain++;
    else byDom[d].umaNa++;
  }
  for (const [d, s] of Object.entries(byDom)) {
    const acc = s.graded ? (100 * s.correct / s.graded).toFixed(1) + '%' : 'n/a';
    console.log(`  ${d}: graded ${s.correct}/${s.graded} = ${acc} | native-abstain ${s.nativeAbstain} | uma-n/a ${s.umaNa}`);
  }
  const totGraded = results.filter(r => r.graded).length;
  const totCorrect = results.filter(r => r.correct).length;
  console.log(`\n总 graded: ${totCorrect}/${totGraded}${totGraded ? ' = ' + (100 * totCorrect / totGraded).toFixed(1) + '%' : ''} (ungraded: native-abstain ${results.filter(r => r.nativeAbstain).length} + uma-n/a ${results.filter(r => !r.graded && !r.nativeAbstain).length})`);
  process.exit(0);
})();
