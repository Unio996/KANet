// gateE-judgeline-accuracy.mjs — Owner 令核心交付 (J2-tn, 2026-06-19): 预言机【算术判+弃权】准确率。
// ============================================================================
// 离线 (无 LLM, 只 ESPN fetch): 真实已结束赛 → extractEspnFields 抽 5 字段 → 构造 predicate
//   (moneyline/spread/total, 含边界 off-by-one) → judgeLine 算术判 → 准确率数字。
// 对比 gateE-espn-accuracy 的 LLM 路 (spread/total 边界 ~60% off-by-one): judgeLine 确定性
//   算术应 100% 边界正确 (= Owner "算术判消 off-by-one" 的证明)。
// fixture-mirror (复用线E纪律): import 生产 judgeline.mjs + extractEspnFields, 零 mock。
// 独立 ground-truth: ESPN scoreboard winner (extractEspnFields winner_side 抽取正确性核) +
//   算术真值 (margin/total 从 fields 确定性算, judgeLine 判定正确性核)。
// 用: node scripts/gateE-judgeline-accuracy.mjs --trial   (从 kasia-console/)
// ============================================================================
import { extractEspnFields, normalizeAbbr } from '../src/lib/oracle-evidence-extractors.mjs';
import { judgeLine } from '../src/lib/judgeline.mjs';

const ARGS = process.argv.slice(2);
const TRIAL = ARGS.includes('--trial');
const LIMIT = TRIAL ? 5 : (parseInt((ARGS.find(a => a.startsWith('--n=')) || '').slice(4), 10) || 20);
const SLEEP_MS = 600;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SPORTS = ['baseball/mlb', 'basketball/nba', 'football/nfl', 'hockey/nhl'];
const PAST_DATES = ['20250615', '20250610', '20250605', '20250420', '20250115', '20241215'];
const SCOREBOARD = (lg, d) => `https://site.api.espn.com/apis/site/v2/sports/${lg}/scoreboard?dates=${d}`;
const SUMMARY = (lg, id) => `https://site.api.espn.com/apis/site/v2/sports/${lg}/summary?event=${id}`;

// scoreboard → 已结束赛 event id + 独立 ground-truth winnerAbbr
async function fetchCompleted(lg, date) {
  try {
    const r = await fetch(SCOREBOARD(lg, date), { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.events || []).map(e => {
      const c = e.competitions?.[0]; const cs = c?.competitors || [];
      const st = c?.status?.type;
      const w = cs.find(x => x.winner === true);
      return { id: e.id, lg, completed: st?.completed === true, winnerAbbr: w?.team?.abbreviation };
    }).filter(g => g.id && g.completed && g.winnerAbbr);
  } catch { return []; }
}

// 对一场赛的 fields 构造 predicate cases + 算术真值期望
function buildCases(fields) {
  const { winner_side, home_team, away_team, home_score, away_score } = fields;
  const margin = Math.abs(home_score - away_score);       // 净胜 (winner 视角, 正)
  const total = home_score + away_score;
  const loser_side = winner_side === home_team ? away_team : home_team;
  return [
    // moneyline (字符串判)
    { name: 'ML:winner==win', pred: { metric: 'winner', op: '==', operand: winner_side }, expect: 'YES' },
    { name: 'ML:winner==lose', pred: { metric: 'winner', op: '==', operand: loser_side }, expect: 'NO' },
    // spread / 让分 (margin 整数定点, subject=winner) — 边界 off-by-one
    { name: 'spread:margin>=M', pred: { metric: 'margin', op: '>=', operand: margin, subject: winner_side }, expect: 'YES' },
    { name: 'spread:margin>=M+1', pred: { metric: 'margin', op: '>=', operand: margin + 1, subject: winner_side }, expect: 'NO' },
    // half-point spread (scale=1: operand=×10) — 测小数 line 整数定点
    { name: 'spread:margin>=M-0.5', pred: { metric: 'margin', op: '>=', operand: margin * 10 - 5, scale: 1, subject: winner_side }, expect: 'YES' },
    { name: 'spread:margin>=M+0.5', pred: { metric: 'margin', op: '>=', operand: margin * 10 + 5, scale: 1, subject: winner_side }, expect: 'NO' },
    // total / 大小球 — 边界 off-by-one
    { name: 'total:total>=T', pred: { metric: 'total', op: '>=', operand: total }, expect: 'YES' },
    { name: 'total:total>=T+1', pred: { metric: 'total', op: '>=', operand: total + 1 }, expect: 'NO' },
  ];
}

(async () => {
  console.log(`=== gateE judgeLine 算术判准确率 harness ${TRIAL ? '[TRIAL 5]' : `[N=${LIMIT}]`} (离线, 无 LLM) ===`);
  console.log('import 生产 judgeline.mjs + extractEspnFields (fixture-mirror, 零 mock)\n');

  // 收集已结束赛
  const games = [];
  outer: for (const lg of SPORTS) {
    for (const d of PAST_DATES) {
      const gs = await fetchCompleted(lg, d);
      for (const g of gs) { games.push(g); if (games.length >= LIMIT * 2) break outer; }
      await sleep(SLEEP_MS);
    }
  }

  let extractOK = 0, extractTotal = 0;
  const judgeStats = { graded: 0, correct: 0, abstain: 0 };
  const wrong = [];
  let processed = 0;

  for (const g of games) {
    if (processed >= LIMIT) break;
    let raw;
    try {
      const r = await fetch(SUMMARY(g.lg, g.id), { signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      raw = await r.text();
    } catch { continue; }
    await sleep(SLEEP_MS);

    const sf = extractEspnFields(raw);
    if (!sf || !sf.fields) continue; // 抽取失败/未 final → 跳 (不算样本)
    processed++;
    const fields = sf.fields;

    // ① 抽取正确性: winner_side == ESPN scoreboard 独立 winnerAbbr
    extractTotal++;
    const gtWinner = normalizeAbbr(g.winnerAbbr);
    const extractCorrect = fields.winner_side === gtWinner;
    if (extractCorrect) extractOK++;

    // ② judgeLine 算术判正确性: 各 predicate vs 算术真值
    for (const c of buildCases(fields)) {
      const verdict = judgeLine(c.pred, fields);
      judgeStats.graded++;
      if (verdict === 'ABSTAIN') { judgeStats.abstain++; continue; }
      if (verdict === c.expect) judgeStats.correct++;
      else wrong.push(`${g.lg.split('/')[1]} ${fields.winner_side} ${fields.home_score}-${fields.away_score} | ${c.name}: judge=${verdict} expect=${c.expect}`);
    }
    console.log(`✓ ${g.lg.split('/')[1]} ${fields.winner_side} won ${fields.home_score}-${fields.away_score} (margin ${Math.abs(fields.home_score-fields.away_score)}/total ${fields.home_score+fields.away_score}) | extract ${extractCorrect?'✓':'✗ gt='+gtWinner}`);
  }

  console.log(`\n=== 干净数字 (离线算术判, 无 LLM) ===`);
  console.log(`抽取正确率 (winner_side == ESPN scoreboard): ${extractOK}/${extractTotal} = ${extractTotal ? (100*extractOK/extractTotal).toFixed(1) : 0}%`);
  console.log(`judgeLine 算术判正确率: ${judgeStats.correct}/${judgeStats.graded - judgeStats.abstain} = ${(judgeStats.graded-judgeStats.abstain) ? (100*judgeStats.correct/(judgeStats.graded-judgeStats.abstain)).toFixed(1) : 0}% (abstain ${judgeStats.abstain})`);
  console.log(`  含边界 off-by-one (spread >=M vs >=M+1 / total >=T vs >=T+1) + half-point scale`);
  if (wrong.length) { console.log(`\n❌ 误判 (${wrong.length}):`); wrong.forEach(w => console.log('  ' + w)); }
  else console.log(`\n✅ judgeLine 算术判 0 误判 (确定性, 消 LLM off-by-one)`);
  process.exit(wrong.length ? 1 : 0);
})();
