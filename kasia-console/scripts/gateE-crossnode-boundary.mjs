// R1③ cross-node deriveVote determinism boundary fixture (NWT-tn lead, 单源)
// ============================================================================
// 【目的】R1 步②: 两节点 (:3200 J2 + :3300 J1) 各跑此 fixture → 贴逐题原始 vote
//   → 必 byte-identical (outcome + extractor_kind_used)。任一不同 = cross-node
//   determinism 破 (函数/param/model/分支 哪层漂)。
//
// 【单源·不 fork】直 import 生产 deriveVote(bettor-prediction-voter.js) = 跑完整
//   生产管线 (ESPN fetch + extractEvidence + canonical prompt + 真 LLM)。杜绝 harness
//   拷贝漂移 (线E P0 教训)。
//
// 【跨节点确定性·命门】
//   · ESPN 道用【硬编码不可变 final 赛 event ID】(结果永不变) → 两节点 fetch 同内容。
//   · 用固定 event ID 非 date-pool 动态拉 (date-pool 可能两节点不同时刻拉到不同赛)。
//   · ABSTAIN 道 (no-question / unknown-source) 不 fetch 或 extractor=null → 天然确定。
//   · :8000 共享单 llama + temp0(L933) → 同 evidence 同 vote。
//
// 【5 道边界·exercise 全 determinism 路】(Bettor r831 + J2 r829 测设计)
//   1. ESPN known-extractor, ask winner → YES   (extractor-hit + LLM judge)
//   2. ESPN known-extractor, ask loser  → NO    (NO-recall, 抗 YES-bias)
//   3. ESPN known-extractor, 跨运动 winner → YES (cross-sport extractor 覆盖)
//   4. no-question (spec 无 title+criteria) → ABSTAIN (voter L906 spec-no-question, J1 误删 guard)
//   5. unknown-source (非 KNOWN_EXTRACTORS) → ABSTAIN (extractor=null L858-861 no-extractor-match)
//
// 跑: node scripts/gateE-crossnode-boundary.mjs   (两节点各跑, 贴输出对拍)
// ============================================================================
process.env.QWEN_LLM_URL = process.env.QWEN_LLM_URL || 'http://127.0.0.1:8000/v1';
const { deriveVote } = await import('../src/services/bettor-prediction-voter.js');

const SUMMARY = (lg, id) => `https://site.api.espn.com/apis/site/v2/sports/${lg}/summary?event=${id}`;

// 硬编码不可变 final 赛 (结果永不变 = 可复现 ground truth, 跨节点 fetch 同内容):
//   MLB event=401695967: Cincinnati Reds (W) vs Detroit Tigers (L)
//   NFL event=401671854: Kansas City Chiefs (W) vs Cleveland Browns (L)
const FIX = {
  mlb: { lg: 'baseball/mlb', id: '401695967', winner: 'Cincinnati Reds', loser: 'Detroit Tigers' },
  nfl: { lg: 'football/nfl', id: '401671854', winner: 'Kansas City Chiefs', loser: 'Cleveland Browns' },
};

function mkOffer(id, title, criteria, url, source = 'kanet_native') {
  return { id, outcome_market_source: source, resolution_rule_spec: JSON.stringify({ title, resolution_criteria: criteria, data_source_canonical: url }) };
}
// no-question: spec 故意无 title + 无 resolution_criteria → 命中 voter L906 guard
function mkNoQuestionOffer(id, url) {
  return { id, outcome_market_source: 'kanet_native', resolution_rule_spec: JSON.stringify({ data_source_canonical: url }) };
}

const CASES = [
  {
    n: 1, label: 'espn-known-winner-YES', expect: 'YES',
    offer: mkOffer('xn-1', `Did the ${FIX.mlb.winner} win their game?`,
      `YES if the ${FIX.mlb.winner} won this game per the ESPN final box score; NO otherwise.`,
      SUMMARY(FIX.mlb.lg, FIX.mlb.id)),
  },
  {
    n: 2, label: 'espn-known-loser-NO', expect: 'NO',
    offer: mkOffer('xn-2', `Did the ${FIX.mlb.loser} win their game?`,
      `YES if the ${FIX.mlb.loser} won this game per the ESPN final box score; NO otherwise.`,
      SUMMARY(FIX.mlb.lg, FIX.mlb.id)),
  },
  {
    n: 3, label: 'espn-crosssport-winner-YES', expect: 'YES',
    offer: mkOffer('xn-3', `Did the ${FIX.nfl.winner} win their game?`,
      `YES if the ${FIX.nfl.winner} won this game per the ESPN final box score; NO otherwise.`,
      SUMMARY(FIX.nfl.lg, FIX.nfl.id)),
  },
  {
    n: 4, label: 'no-question-ABSTAIN', expect: 'ABSTAIN',
    offer: mkNoQuestionOffer('xn-4', SUMMARY(FIX.mlb.lg, FIX.mlb.id)),  // spec 无 title/criteria
  },
  {
    // example.com 根返 200 (稳定静态页) → fetch 成功 → extractEvidence null (非白名单)
    // → L861 no-extractor-match ABSTAIN。= 正确 exercise extractor=null determinism 路
    // (非 fetch-404 提前返回, 那条不加载 extractors)。
    n: 5, label: 'unknown-source-ABSTAIN', expect: 'ABSTAIN',
    offer: mkOffer('xn-5', 'Did AAPL stock close above $200?',
      'YES if AAPL closed above $200; NO otherwise.', 'https://example.com/'),
  },
];

function voteOf(r) {
  // 结算相关确定值: ok:true → outcome; ok:false → daemon_abstain (reason head)
  if (r?.ok) return r.outcome;
  return 'ABSTAIN(' + String(r?.reason || '').split(':')[0].slice(0, 40) + ')';
}

(async () => {
  console.log('=== R1③ cross-node deriveVote boundary fixture (单源 import 生产 deriveVote) ===');
  console.log(`LLM=${process.env.QWEN_LLM_URL}`);
  console.log(`PORT=${process.env.PORT || '(unset→默认 3200)'}  时间无关(用不可变 final 赛 event ID)\n`);

  const records = [];
  for (const c of CASES) {
    let r;
    try { r = await deriveVote(c.offer); }
    catch (e) { r = { ok: false, reason: 'EXC:' + e.message }; }
    const vote = voteOf(r);
    const kind = r?.extractor_kind_used || '-';
    const pass = vote === c.expect || (c.expect === 'ABSTAIN' && /^ABSTAIN/.test(vote));
    // 逐题确定值记录行 (= 跨节点 byte-compare 单位)
    const line = `#${c.n} ${c.label.padEnd(28)} vote=${vote.padEnd(10)} kind=${kind}`;
    console.log(`${pass ? '✓' : '✗'} ${line}${pass ? '' : `   <<< expect ${c.expect}`}`);
    records.push(`${c.n}|${vote}|${kind}`);
    await new Promise(s => setTimeout(s, 1200)); // 错峰别砸 :8000
  }

  // 跨节点对拍指纹: 把 5 道确定值串成单行, 两节点必逐字符相同
  const fingerprint = records.join('  ');
  console.log('\n--- CROSS-NODE FINGERPRINT (两节点必逐字符相同) ---');
  console.log(fingerprint);
  console.log('\n贴此 FINGERPRINT 行 + 上方逐题 vote 到频道对拍。');
})();
