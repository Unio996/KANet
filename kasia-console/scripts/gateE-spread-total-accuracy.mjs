// #25 UMA L1 — spread (让分) + total (大小球) deriveVote 准确率 harness (J2-tn)
// ============================================================================
// §20.10 L1: 一个 ESPN final box score 解锁一批 binary 谓词 — moneyline(已证 line-E 95.8%)
// + 让分(净胜 margin >= line?) + 大小球(total >= line?), 皆终分算术非推理。
//
// capability-first (trial-ramp 纪律): 先证 deriveVote 能可靠算 margin/total 再放行 C 的
//   INFERENCE_RE(37a43878 现拒 spread/total 当推理题)。准确率达 line-E moneyline 档(>=90%)才放行。
//
// fidelity 焊死(同 line-E): import 生产 deriveVote = 真 ESPN fetch + 真 extractEvidence
//   (evidence 已含双队具名分数) + J2 canonical derivevote-prompt + 真 LLM。不 copy prompt。
//
// ground truth = 算术(从 scoreboard competitors[].score 算 margin/total, 与 LLM 判定独立)。
//   每场造 4 题: spread-YES(line=margin-1) / spread-NO(line=margin+1) / total-OVER-YES /
//   total-UNDER-NO, 平衡正负 + 边界贴近实际值(防 LLM 蒙大数对)。
//
// run: node scripts/gateE-spread-total-accuracy.mjs --trial   (5 题先验)
//      node scripts/gateE-spread-total-accuracy.mjs --n=24    (ramp)
// ============================================================================
process.env.QWEN_LLM_URL = process.env.QWEN_LLM_URL || 'http://127.0.0.1:8000/v1';
const { deriveVote } = await import('../src/services/bettor-prediction-voter.js');

const ARGS = process.argv.slice(2);
const TRIAL = ARGS.includes('--trial');
const LIMIT = TRIAL ? 5 : (parseInt((ARGS.find(a => a.startsWith('--n=')) || '').slice(4), 10) || 24);
const SLEEP_MS = 1200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SPORTS = [
  { league: 'baseball/mlb', name: 'MLB' },
  { league: 'basketball/nba', name: 'NBA' },
  { league: 'football/nfl', name: 'NFL' },
  { league: 'hockey/nhl', name: 'NHL' },
];
const SUMMARY = (lg, id) => `https://site.api.espn.com/apis/site/v2/sports/${lg}/summary?event=${id}`;
const SCOREBOARD = (lg, d) => `https://site.api.espn.com/apis/site/v2/sports/${lg}/scoreboard?dates=${d}`;
const DATES = ['20250618', '20250608', '20250602', '20250411', '20250112', '20241208'];

async function fetchGames(lg, date) {
  try {
    const r = await fetch(SCOREBOARD(lg, date), { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.events || []).map(e => {
      const c = e.competitions?.[0]; const cs = c?.competitors || [];
      const st = c?.status?.type;
      const w = cs.find(x => x.winner === true);
      const l = cs.find(x => x.winner === false);
      const ws = w ? Number(w.score) : NaN;
      const ls = l ? Number(l.score) : NaN;
      return {
        id: e.id, lg,
        completed: st?.completed === true && st?.state === 'post',
        winner: w?.team?.displayName, loser: l?.team?.displayName,
        winnerAbbr: w?.team?.abbreviation, loserAbbr: l?.team?.abbreviation,
        ws, ls,
      };
    }).filter(g => g.id && g.completed && g.winner && g.loser && Number.isFinite(g.ws) && Number.isFinite(g.ls));
  } catch { return []; }
}

function mkOffer(id, title, criteria, url) {
  return { id, outcome_market_source: 'kanet_native', resolution_rule_spec: JSON.stringify({ title, resolution_criteria: criteria, data_source_canonical: url }) };
}

// 每场造 spread + total 各一正一负, ground truth = 算术真值
function buildSamples(g) {
  const margin = g.ws - g.ls;       // winner 净胜 (>0)
  const total = g.ws + g.ls;
  const url = SUMMARY(g.lg, g.id);
  const lbl = `${g.lg.split('/')[1]} ${g.winnerAbbr}/${g.loserAbbr}`;
  const out = [];
  // spread YES: winner 净胜 >= (margin) → 真. line = margin (恰好 >=) → YES
  out.push({
    kind: 'spread', truth: 'YES', label: `${lbl} sprd>=${margin}Y`,
    offer: mkOffer(`st-sprd-y-${g.id}`, `Did the ${g.winner} win by ${margin} or more?`,
      `YES if the ${g.winner}'s final score minus the ${g.loser}'s final score is >= ${margin}, per the ESPN final box score; NO otherwise.`, url),
  });
  // spread NO: winner 净胜 >= margin+1 → 假(实际只赢 margin). → NO
  out.push({
    kind: 'spread', truth: 'NO', label: `${lbl} sprd>=${margin + 1}N`,
    offer: mkOffer(`st-sprd-n-${g.id}`, `Did the ${g.winner} win by ${margin + 1} or more?`,
      `YES if the ${g.winner}'s final score minus the ${g.loser}'s final score is >= ${margin + 1}, per the ESPN final box score; NO otherwise.`, url),
  });
  // total OVER YES: total >= total → 真. line=total → YES
  out.push({
    kind: 'total', truth: 'YES', label: `${lbl} tot>=${total}Y`,
    offer: mkOffer(`st-tot-y-${g.id}`, `Was the combined final score ${total} or more?`,
      `YES if the sum of both teams' final scores is >= ${total}, per the ESPN final box score; NO otherwise.`, url),
  });
  // total UNDER NO: total >= total+1 → 假. → NO
  out.push({
    kind: 'total', truth: 'NO', label: `${lbl} tot>=${total + 1}N`,
    offer: mkOffer(`st-tot-n-${g.id}`, `Was the combined final score ${total + 1} or more?`,
      `YES if the sum of both teams' final scores is >= ${total + 1}, per the ESPN final box score; NO otherwise.`, url),
  });
  return out;
}

(async () => {
  console.log(`=== #25 L1 spread/total 准确率 harness ${TRIAL ? '[TRIAL 5]' : '[N=' + LIMIT + ']'} (import 生产 deriveVote) ===`);
  console.log(`LLM=${process.env.QWEN_LLM_URL}\n`);

  const perSport = [];
  for (const s of SPORTS) {
    const bucket = [];
    for (const d of DATES) {
      const gs = await fetchGames(s.league, d);
      for (const g of gs) { if (bucket.length < 4) bucket.push(g); }
      if (bucket.length >= 4) break;
    }
    perSport.push(bucket);
  }
  // 跨运动 round-robin (防 slice 取偏单一运动 = MLB-only caveat 修): [MLB0,NBA0,NFL0,NHL0,MLB1,...]
  const games = [];
  for (let i = 0; i < 4; i++) for (const b of perSport) if (b[i]) games.push(b[i]);
  const sportCount = games.reduce((m, g) => { const k = g.lg.split('/')[1]; m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log(`已结束赛(含分数): ${games.length} 场 (跨类: ${JSON.stringify(sportCount)})`);

  // round-robin 4 类 (spread-Y/spread-N/total-Y/total-N) 跨场交错, 防 slice 取偏 (= 全 spread-N bug)
  const perGame = games.map(buildSamples);  // 每场 [sprdY, sprdN, totY, totN]
  const buckets = [[], [], [], []];
  perGame.forEach(gs => gs.forEach((s, i) => buckets[i].push(s)));
  const all = perGame.flat();
  const interleaved = [];
  for (let i = 0; interleaved.length < all.length; i++) for (const b of buckets) if (b[i]) interleaved.push(b[i]);
  const samples = interleaved.slice(0, LIMIT);
  console.log(`题集: ${samples.length} (spread ${samples.filter(s => s.kind === 'spread').length} / total ${samples.filter(s => s.kind === 'total').length}, YES ${samples.filter(s => s.truth === 'YES').length} / NO ${samples.filter(s => s.truth === 'NO').length})\n`);

  const results = [];
  for (const s of samples) {
    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { r = await deriveVote(s.offer); } catch (e) { r = { ok: false, reason: 'EXC:' + e.message }; }
      if (r.ok || !/HTTP 5\d\d|fetch fail/i.test(r.reason || '')) break;
      await sleep(3500);
    }
    const out = r?.ok ? r.outcome : 'ABSTAIN(' + (r?.reason || '').split(':')[0] + ')';
    const correct = r?.ok && r.outcome === s.truth;
    results.push({ s, out, correct });
    console.log(`${correct ? '✓' : '✗'} [${s.kind}/${s.truth}] ${s.label.padEnd(22)} → ${String(out).padEnd(16)} (expect ${s.truth})`);
    await sleep(SLEEP_MS);
  }

  const byKind = k => { const rs = results.filter(r => r.s.kind === k); const c = rs.filter(r => r.correct).length; return `${c}/${rs.length}${rs.length ? ' = ' + (100 * c / rs.length).toFixed(1) + '%' : ''}`; };
  const corr = results.filter(r => r.correct).length;
  console.log(`\n=== #25 L1 准确率 (算术 ground truth) ===`);
  console.log(`spread (让分): ${byKind('spread')}`);
  console.log(`total  (大小球): ${byKind('total')}`);
  console.log(`总: ${corr}/${results.length}${results.length ? ' = ' + (100 * corr / results.length).toFixed(1) + '%' : ''} (放行 C 阈 >=90%, 配 NWT co-verify)`);
  const fails = results.filter(r => !r.correct);
  if (fails.length) { console.log(`\n失败明细 (= L1 真死角):`); fails.forEach(r => console.log(`  ✗ [${r.s.kind}/${r.s.truth}] ${r.s.label} → ${r.out}`)); }
  process.exit(0);
})();
