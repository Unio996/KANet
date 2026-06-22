// J1 offline self-test: verifyFrozenEvidence + fetchCanonicalEvidence (Track B, 2026-06-22).
// 注入 fetchImpl (无网络) + ESPN fixture (真 x4kpq 赛 ATL 2 - SF 7) → 验 canonical 自取 / FINAL-cache / poison 拒 / abstain / SSRF 拒。
import {
  fetchCanonicalEvidence, verifyFrozenEvidence, _clearFinalEvidenceCache,
} from '../src/lib/bshard-close-enforce.mjs';
import { judgeLine } from '../src/lib/judgeline.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

// ESPN summary fixture — FINAL game, home=SF won 7, away=ATL 2 (真 x4kpq 赛果).
const espnFinal = JSON.stringify({
  header: {
    league: { abbreviation: 'NFL' },
    competitions: [{
      status: { type: { completed: true, state: 'post' } },
      competitors: [
        { homeAway: 'home', team: { abbreviation: 'SF' }, score: '7', winner: true },
        { homeAway: 'away', team: { abbreviation: 'ATL' }, score: '2', winner: false },
      ],
    }],
  },
});
const espnInProgress = JSON.stringify({
  header: { competitions: [{ status: { type: { completed: false, state: 'in' } },
    competitors: [
      { homeAway: 'home', team: { abbreviation: 'SF' }, score: '3', winner: false },
      { homeAway: 'away', team: { abbreviation: 'ATL' }, score: '0', winner: false },
    ] }] },
});

const URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=1782085313835';
const predicate = { metric: 'winner', op: '==', operand: 'ATL', data_source_canonical: URL };  // "ATL 赢?" — 真赛 SF 赢 → judgeLine NO

let fetchCalls = 0;
const mkFetch = (body, status = 200) => async () => { fetchCalls++; return { ok: status === 200, status, text: async () => body }; };

(async () => {
  console.log('== T1: fetchCanonicalEvidence FINAL extract ==');
  _clearFinalEvidenceCache();
  fetchCalls = 0;
  const r1 = await fetchCanonicalEvidence(predicate, { fetchImpl: mkFetch(espnFinal) });
  ok(r1.fields && r1.fields.winner_side === 'SF', `winner_side=SF (got ${r1.fields?.winner_side})`);
  ok(r1.fields.home_team === 'SF' && r1.fields.away_team === 'ATL', 'home/away teams');
  ok(r1.fields.home_score === 7 && r1.fields.away_score === 2, `scores 7/2 (got ${r1.fields.home_score}/${r1.fields.away_score})`);
  ok(r1.cached === false && fetchCalls === 1, 'first call hit network (not cached)');

  console.log('== T2: per-URL FINAL-cache (防 403 self-DoS) ==');
  const r2 = await fetchCanonicalEvidence(predicate, { fetchImpl: mkFetch(espnFinal) });
  ok(r2.cached === true && fetchCalls === 1, 'second call served from cache (no extra network)');
  ok(r2.field_hash === r1.field_hash, 'cached field_hash stable');

  console.log('== T3: verifyFrozenEvidence MATCH (settler proposes honest fields) ==');
  _clearFinalEvidenceCache();
  const ctx = { fetchCanonicalEvidence: (p) => fetchCanonicalEvidence(p, { fetchImpl: mkFetch(espnFinal) }) };
  const proposedHonest = { winner_side: 'SF', home_team: 'SF', away_team: 'ATL', home_score: 7, away_score: 2 };
  const m1 = await verifyFrozenEvidence(predicate, proposedHonest, ctx);
  ok(m1.match === true, 'honest proposed snapshot matches own fetch');
  // downstream judgeLine on own fetch → NO (predicate winner==ATL, real winner SF)
  ok(judgeLine(predicate, m1.ownFetch) === 'NO', 'judgeLine on own fetch = NO (ATL did not win)');

  console.log('== T4: verifyFrozenEvidence REJECT poison snapshot (settler flips winner) ==');
  const proposedPoison = { winner_side: 'ATL', home_team: 'SF', away_team: 'ATL', home_score: 7, away_score: 2 };
  const m2 = await verifyFrozenEvidence(predicate, proposedPoison, ctx);
  ok(m2.match === false, 'poison snapshot (winner flipped to ATL) rejected');

  console.log('== T5: abstain-not-guess on non-final game ==');
  _clearFinalEvidenceCache();
  const ctxLive = { fetchCanonicalEvidence: (p) => fetchCanonicalEvidence(p, { fetchImpl: mkFetch(espnInProgress) }) };
  const m3 = await verifyFrozenEvidence(predicate, proposedHonest, ctxLive);
  ok(m3.match === false && /final/i.test(m3.reason || '') || !m3.match, 'in-progress game → no fields → abstain (match:false)');

  console.log('== T6: HTTP error → fetch fail (弃签, not cached) ==');
  _clearFinalEvidenceCache();
  let threw = false;
  try { await fetchCanonicalEvidence(predicate, { fetchImpl: mkFetch('rate limited', 403) }); } catch { threw = true; }
  ok(threw, '403 throws (弃签 — caller treats as abstain)');

  console.log('== T7: SSRF / non-https / unknown-source rejection ==');
  for (const bad of [
    { metric: 'winner', op: '==', operand: 'X', data_source_canonical: 'http://site.api.espn.com/x' },     // non-https
    { metric: 'winner', op: '==', operand: 'X', data_source_canonical: 'https://evil.com/site.api.espn.com' }, // host spoof
    { metric: 'winner', op: '==', operand: 'X', data_source_canonical: 'https://127.0.0.1/summary' },        // SSRF loopback
    { metric: 'winner', op: '==', operand: 'X', data_source_canonical: '' },                                  // missing
  ]) {
    let t = false;
    try { await fetchCanonicalEvidence(bad, { fetchImpl: mkFetch(espnFinal) }); } catch { t = true; }
    ok(t, `rejected: ${bad.data_source_canonical || '(empty)'}`);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
