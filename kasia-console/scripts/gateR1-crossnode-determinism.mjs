// R1③ cross-node deriveVote determinism 测 (J2 落地, NWT §8 INVARIANT)
// ============================================================================
// 单源铁律: import 生产 deriveVote(bettor-prediction-voter.js)= 跑完整生产管线
//   (真 extractEvidence/findExtractor + canonical derivevote-prompt + 真 LLM temp0)。
//   不 copy / 不 mirror（= gateE 同模式）。两节点跑【同一 committed 脚本】→ 逐题
//   原始 vote 对拍 byte-identical = cross-node determinism 实证。
//
// 4 道边界（Bettor r831: 必变 evidence source 才 exercise extractor 路由）:
//   ① clear   : known-extractor(ESPN past-final)→ LLM judge 明确 winner
//   ② margin  : known-extractor(ESPN past-final)→ LLM judge（第二场, 覆盖 LLM 路）
//   ③ no-question : spec 缺 title+criteria → ABSTAIN(voter L906 spec-no-question)
//   ④ unknown-src : 非白名单源 → ABSTAIN(extractor=null, L858-861 no-extractor-match)
//   ③④ 纯确定（无 LLM）= voter + extractors determinism 直证;①② 走共享 :8000。
//
// 用: PORT=3200 node scripts/gateR1-crossnode-determinism.mjs   (:3200 侧, 我)
//     PORT=3300 node scripts/gateR1-crossnode-determinism.mjs   (:3300 侧, J1)
//   两节点输出逐题 outcome+reason+extractor_kind 必 byte-identical。
// ============================================================================
process.env.QWEN_LLM_URL = process.env.QWEN_LLM_URL || 'http://127.0.0.1:8000/v1';
const { deriveVote } = await import('../src/services/bettor-prediction-voter.js');

const NODE = process.env.PORT || '3200';
const ESPN = (lg, id) => `https://site.api.espn.com/apis/site/v2/sports/${lg}/summary?event=${id}`;
const SCOREBOARD = (lg, d) => `https://site.api.espn.com/apis/site/v2/sports/${lg}/scoreboard?dates=${d}`;

function mkOffer(id, spec) {
  return {
    id,
    outcome_market_source: 'kanet_native',
    resolution_rule_spec: JSON.stringify(spec),
    outcome_oracle_relay_id: process.env.ORACLE_RELAY_ID || null,
  };
}

// 拉一个固定历史日期的已 final 赛事（两节点同日期同源 → 同 ground-truth, 可复现）。
async function pinFinalGame(lg, date) {
  try {
    const r = await fetch(SCOREBOARD(lg, date), { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const j = await r.json();
    const games = (j.events || []).map(e => {
      const c = e.competitions?.[0]; const cs = c?.competitors || [];
      const w = cs.find(x => x.winner === true);
      return { id: e.id, completed: c?.status?.type?.completed === true,
        winner: w?.team?.displayName, loser: cs.find(x => x.winner === false)?.team?.displayName };
    }).filter(g => g.id && g.completed && g.winner && g.loser);
    games.sort((a, b) => a.id.localeCompare(b.id)); // 确定排序 → 两节点同选
    return games[0] || null;
  } catch { return null; }
}

async function queryModelFingerprint() {
  try {
    const r = await fetch('http://127.0.0.1:8000/v1/models', { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const m = (j.data || j.models || [])[0] || {};
    return { id: m.id || m.name || null };
  } catch (e) { return { error: e.message }; }
}

(async () => {
  console.log(`\n=== R1③ cross-node determinism · NODE PORT=${NODE} ===`);
  const fp = await queryModelFingerprint();
  console.log(`[model] ${JSON.stringify(fp)}`);

  // ①② known-extractor ESPN past-final (固定日期, sorted-first final game)
  const g1 = await pinFinalGame('baseball/mlb', '20250615');
  const g2 = await pinFinalGame('basketball/nba', '20250610');

  const fixtures = [];
  if (g1) fixtures.push({ name: '①clear-mlb', offer: mkOffer('r1-clear', {
    title: `Did ${g1.winner} defeat ${g1.loser}?`, resolution_criteria: 'YES if the named team won the final game',
    data_source_canonical: ESPN('baseball/mlb', g1.id) }) });
  if (g2) fixtures.push({ name: '②clear-nba', offer: mkOffer('r1-margin', {
    title: `Did ${g2.winner} defeat ${g2.loser}?`, resolution_criteria: 'YES if the named team won the final game',
    data_source_canonical: ESPN('basketball/nba', g2.id) }) });

  // ③ no-question (缺 title+criteria) → ABSTAIN spec-no-question
  fixtures.push({ name: '③no-question', offer: mkOffer('r1-noq', {
    data_source_canonical: 'kanet_native_freetext_no_question' }) });

  // ④ unknown-source: 可 fetch 但非白名单 → extractEvidence null → ABSTAIN
  //   (exercise extractors 文件: findExtractor(example.com)=null → no-extractor-match,
  //    或 extractEvidence 异常 → extractor-exception; 两者都确定性 ABSTAIN)。
  fixtures.push({ name: '④unknown-src', offer: mkOffer('r1-unknown', {
    title: 'Did event X resolve YES?', resolution_criteria: 'per source',
    data_source_canonical: 'https://example.com/' }) });

  const results = [];
  for (const f of fixtures) {
    let v;
    try { v = await deriveVote(f.offer); } catch (e) { v = { ok: false, reason: `EXCEPTION ${e.message}` }; }
    const line = `${f.name} | outcome=${v.outcome ?? '(none)'} | ok=${v.ok} | kind=${v.extractor_kind_used ?? '-'} | reason=${(v.reason ?? '').slice(0, 80)}`;
    console.log(`[vote] ${line}`);
    results.push({ name: f.name, outcome: v.outcome ?? null, ok: v.ok ?? null, extractor_kind_used: v.extractor_kind_used ?? null });
    await new Promise(r => setTimeout(r, 1200));
  }
  // 对拍锚: 只比 outcome+ok+kind (= 确定性核心, 不比 reason 措辞/timestamp)
  console.log(`\n=== COMPARE-ANCHOR (两节点必逐题同) PORT=${NODE} ===`);
  console.log(JSON.stringify(results.map(r => `${r.name}:${r.outcome}/${r.ok}/${r.extractor_kind_used}`), null, 0));
})();
