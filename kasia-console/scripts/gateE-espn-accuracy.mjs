// 线E sports/ESPN 准确率 harness (NWT-tn lead, Bettor 5 INVARIANTS)
// ============================================================================
// 【fidelity 焊死·我 lead 拍板】不 copy prompt、不建 mirror — 直接 import 生产
// deriveVote(offer)(bettor-prediction-voter.js)= 跑【完整生产管线】: 真 ESPN
// fetch + 真 extractEvidence(oracle-evidence-extractors.mjs)+ J2 canonical
// derivevote-prompt.mjs(prod 内部已 import)+ 真 LLM(temp 0.1/json_object/conf<0.6
// →abstain)。= gap①(prompt 漂)②(真提取链)一次全闭, 比只 import buildDeriveVotePrompt 彻底。
//
// 【双成分题集·INVARIANT①】正样本~70%(真已结束赛, 平衡 YES/NO) + 负样本~30%
//   (未来/未结算赛→易逝 ABSTAIN / 非白名单源→no-extractor ABSTAIN)。
// 【ground truth】ESPN scoreboard 端点的 winner 字段(= fresh 批, 动态拉非训练集 INVARIANT④)。
//   caveat: scoreboard 与 summary 同属 ESPN(provider 一致, 非真独立双源 INVARIANT③);
//   测的是"deriveVote 判定 == 客观赛果"。源本身错 = G5 不算 oracle 错。
// 【干净数字·INVARIANT④】精确 X/Y, 定语"窄门内提取准确率"。
// 【trial-ramp·INVARIANT⑤】--trial 先跑 5 过 gate, 再 --full N>=30, 错峰 sleep。
// ============================================================================
process.env.QWEN_LLM_URL = process.env.QWEN_LLM_URL || 'http://127.0.0.1:8000/v1';
const { deriveVote } = await import('../src/services/bettor-prediction-voter.js');

const ARGS = process.argv.slice(2);
const TRIAL = ARGS.includes('--trial');
const LIMIT = TRIAL ? 5 : (parseInt((ARGS.find(a => a.startsWith('--n=')) || '').slice(4), 10) || 999);
const SLEEP_MS = 1200; // 错峰, 别砸 :8000

const SPORTS = [
  { league: 'baseball/mlb', name: 'MLB' },
  { league: 'basketball/nba', name: 'NBA' },
  { league: 'football/nfl', name: 'NFL' },
  { league: 'hockey/nhl', name: 'NHL' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SUMMARY = (lg, id) => `https://site.api.espn.com/apis/site/v2/sports/${lg}/summary?event=${id}`;
const SCOREBOARD = (lg, d) => `https://site.api.espn.com/apis/site/v2/sports/${lg}/scoreboard?dates=${d}`;

// 过去日期(YYYYMMDD): 已结束赛池. 多日多运动 = 跨类 fresh 批。
// --fresh = 终版准确率批(Bettor r681 纪律: 终版数必来自 fix 后 fresh 批、非抓 bug 批)。
// 两组日期【零重叠】→ fresh 批是 bug-finding 批没见过的赛事。
const FRESH = process.argv.includes('--fresh');
function pastDates() {
  // 固定历史日期(已 final, 结果不变 = 可复现 ground truth)。跨多日多运动凑 N。
  return FRESH
    ? ['20250618', '20250608', '20250602', '20250411', '20250112', '20241208']  // 终版 fresh 批
    : ['20250615', '20250610', '20250605', '20250420', '20250115', '20241215']; // bug-finding 批
}
// 未来日期: 未结束赛(negative 易逝 ABSTAIN). 用远期保证 scheduled/pre。
function futureDates() { return ['20261220', '20261225']; }

async function fetchGames(lg, date) {
  try {
    const r = await fetch(SCOREBOARD(lg, date), { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.events || []).map(e => {
      const c = e.competitions?.[0]; const cs = c?.competitors || [];
      const st = c?.status?.type;
      const w = cs.find(x => x.winner === true);
      const home = cs.find(x => x.homeAway === 'home');
      const away = cs.find(x => x.homeAway === 'away');
      return {
        id: e.id, lg, completed: st?.completed === true, state: st?.state,
        winner: w?.team?.displayName, winnerAbbr: w?.team?.abbreviation,
        home: home?.team?.displayName, homeAbbr: home?.team?.abbreviation,
        away: away?.team?.displayName, awayAbbr: away?.team?.abbreviation,
        loser: w ? (cs.find(x => x.winner === false)?.team?.displayName) : null,
      };
    }).filter(g => g.id);
  } catch { return []; }
}

function mkOffer(id, title, criteria, url, source = 'kanet_native') {
  return { id, outcome_market_source: source, resolution_rule_spec: JSON.stringify({ title, resolution_criteria: criteria, data_source_canonical: url }) };
}

// 判正样本: outcome 命中 known truth = 对; ABSTAIN/错 = 错。
// 判负样本: outcome===ABSTAIN 或 ok:false daemon_abstain = 对(正确弃权); 出 YES/NO = 错(被迫判)。
function classify(sample, r) {
  const out = r?.ok ? r.outcome : 'ABSTAIN(' + (r?.reason || '').split(':')[0] + ')';
  const abstained = (r?.ok && r.outcome === 'ABSTAIN') || (!r?.ok && /abstain/i.test(r?.reason || ''));
  if (sample.kind === 'pos') {
    return { out, correct: r?.ok && r.outcome === sample.truth, abstained };
  } else {
    return { out, correct: abstained, abstained }; // 负样本 correct = 正确弃权
  }
}

(async () => {
  console.log(`=== 线E sports/ESPN 准确率 harness ${TRIAL ? '[TRIAL 5]' : '[FULL N>=30]'} (import 生产 deriveVote) ===`);
  console.log(`LLM=${process.env.QWEN_LLM_URL}\n`);

  // ---- 收集已结束赛 (positive pool) — 跨运动每类取量, 保 cross-category ----
  const completed = [];
  for (const s of SPORTS) {
    let perSport = 0;
    for (const d of pastDates()) {
      const gs = await fetchGames(s.league, d);
      for (const g of gs) { if (g.completed && g.winner && g.loser && perSport < 8) { completed.push(g); perSport++; } }
      if (perSport >= 8) break;
    }
  }
  const bySport = completed.reduce((m, g) => { const k = g.lg.split('/')[1]; m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log(`已结束赛池: ${completed.length} 场 (跨类: ${JSON.stringify(bySport)})`);

  // ---- 收集未来赛 (negative 易逝 pool) ----
  const future = [];
  for (const s of SPORTS) {
    for (const d of futureDates()) {
      const gs = await fetchGames(s.league, d);
      for (const g of gs) if (!g.completed && g.home && g.away && future.length < 12) future.push(g);
    }
  }
  console.log(`未来/未结束赛池: ${future.length} 场\n`);

  // ---- 建题集: 正~70% (平衡 YES/NO) + 负~30% ----
  const samples = [];
  // 正样本: 交替问 winner(=YES) / loser(=NO) 保平衡
  completed.forEach((g, i) => {
    const askYes = i % 2 === 0;
    const team = askYes ? g.winner : g.loser;
    samples.push({
      kind: 'pos', truth: askYes ? 'YES' : 'NO', label: `${g.lg.split('/')[1]} ${g.awayAbbr}@${g.homeAbbr}`,
      offer: mkOffer(`gateE-pos-${i}`, `Did the ${team} win their game?`,
        `YES if the ${team} won this game per the ESPN final box score; NO otherwise.`, SUMMARY(g.lg, g.id)),
    });
  });
  // 负样本 A: 未来赛 (易逝/未结算 → 该 ABSTAIN known-source-not-final)
  future.forEach((g, i) => {
    samples.push({
      kind: 'neg', subtype: 'future-unresolved', label: `future ${g.awayAbbr}@${g.homeAbbr}`,
      offer: mkOffer(`gateE-neg-fut-${i}`, `Did the ${g.home} win their game?`,
        `YES if the ${g.home} won; NO otherwise.`, SUMMARY(g.lg, g.id)),
    });
  });
  // 负样本 B: 非白名单源 (→ findExtractor null → ABSTAIN no-extractor-match)
  const nonWl = [
    { u: 'https://www.example.com/stock/AAPL', t: 'Did AAPL stock close above $200?' },
    { u: 'https://news.ycombinator.com/item?id=1', t: 'Did the proposal pass?' },
    { u: 'https://api.weather.gov/stations/KNYC', t: 'Did it rain in NYC today?' },
  ];
  nonWl.forEach((x, i) => {
    samples.push({
      kind: 'neg', subtype: 'non-whitelist', label: `non-wl ${new URL(x.u).host}`,
      offer: mkOffer(`gateE-neg-nwl-${i}`, x.t, `YES if condition met; NO otherwise.`, x.u),
    });
  });

  // 平衡到 ~70/30: 取够样本。trial 取前 5(混正负)。
  // 正样本按运动 round-robin 交错 → chosen 子集跨类(非 slice 前 N 全 MLB)。
  const posBySport = {};
  samples.filter(s => s.kind === 'pos').forEach(s => { const k = s.label.split(' ')[0]; (posBySport[k] ||= []).push(s); });
  const pos = [];
  for (let i = 0, more = true; more; i++) {
    more = false;
    for (const k of Object.keys(posBySport)) { if (posBySport[k][i]) { pos.push(posBySport[k][i]); more = true; } }
  }
  const neg = samples.filter(s => s.kind === 'neg');
  let chosen;
  if (TRIAL) {
    chosen = [...pos.slice(0, 3), ...neg.slice(0, 2)];
  } else {
    const nPos = Math.min(pos.length, Math.max(21, Math.ceil(LIMIT * 0.7)));
    const nNeg = Math.min(neg.length, Math.ceil(nPos / 0.7 * 0.3));
    chosen = [...pos.slice(0, nPos), ...neg.slice(0, nNeg)];
  }
  console.log(`题集: ${chosen.length} (正 ${chosen.filter(s => s.kind === 'pos').length} / 负 ${chosen.filter(s => s.kind === 'neg').length})\n`);

  // ---- 跑 (源 5xx 瞬挂自动重试 = 不让 ESPN 瞬时 502 污染终版准确率, INVARIANT③ 源错非 oracle 错) ----
  const results = [];
  for (const s of chosen) {
    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { r = await deriveVote(s.offer); } catch (e) { r = { ok: false, reason: 'EXC:' + e.message }; }
      // 仅源 5xx/fetch fail 重试; ABSTAIN/判定结果不重试(那是真信号)
      if (r.ok || !/HTTP 5\d\d|fetch fail/i.test(r.reason || '')) break;
      await sleep(3500);
    }
    const c = classify(s, r);
    results.push({ s, c });
    const mark = c.correct ? '✓' : '✗';
    const exp = s.kind === 'pos' ? s.truth : 'ABSTAIN';
    console.log(`${mark} [${s.kind}${s.subtype ? '/' + s.subtype : '/' + s.truth}] ${s.label.padEnd(22)} → ${c.out.padEnd(18)} (expect ${exp})`);
    await sleep(SLEEP_MS);
  }

  // ---- 干净数字 ----
  const posR = results.filter(r => r.s.kind === 'pos');
  const negR = results.filter(r => r.s.kind === 'neg');
  const posCorrect = posR.filter(r => r.c.correct).length;
  const negCorrect = negR.filter(r => r.c.correct).length;
  console.log(`\n=== 干净数字 (窄门内提取准确率) ===`);
  console.log(`正样本判对率: ${posCorrect}/${posR.length}${posR.length ? ' = ' + (100 * posCorrect / posR.length).toFixed(1) + '%' : ''}`);
  console.log(`负样本弃权校准(正确 ABSTAIN): ${negCorrect}/${negR.length}${negR.length ? ' = ' + (100 * negCorrect / negR.length).toFixed(1) + '%' : ''}`);
  console.log(`总: ${posCorrect + negCorrect}/${results.length}`);
  const fails = results.filter(r => !r.c.correct);
  if (fails.length) {
    console.log(`\n失败明细:`);
    fails.forEach(r => console.log(`  ✗ [${r.s.kind}] ${r.s.label} → ${r.c.out} (expect ${r.s.kind === 'pos' ? r.s.truth : 'ABSTAIN'})`));
  }
  process.exit(0);
})();
