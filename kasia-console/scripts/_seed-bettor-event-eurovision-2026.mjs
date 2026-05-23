#!/usr/bin/env node
// Bettor Phase 3f-1 Sub #7 — Eurovision 2026 event_calendar seed + unblacklist Greece + scan trigger + e2e verify
//
// Owner 5/12 钦定 "完善投注策略 系统自动操作" + Bettor r55 architect spec Sub #7.
//
// 4 ops sequence (有依赖):
//   1. POST /api/bettor/event-calendar — semifinal 5/13 19:00 UTC priority 8
//   2. POST /api/bettor/event-calendar — final 5/16 19:00 UTC priority 9
//   3. DELETE /api/bettor/blacklist/842019  (放出 Greece 让新算法接管)
//   4. POST /api/bettor/scan (manual trigger)
//   5. GET /api/bettor/recommendations + /api/bettor/event-calendar — verify
//
// expected post-run:
//   - Greece 进 lifecycle SM 自动决策
//   - new bettor_recommendations row for market_id=842019
//   - lifecycle_state ∈ {pre_event_near, event_imminent, event_live, priced_in} (按时间窗)
//   - calibrator_confidence ∈ {low, mid, high}
//   - size_usd 远低于 raw Kelly (calibrator damping + observed × 0.5 双层减仓)
//
// usage: node kasia-console/scripts/_seed-bettor-event-eurovision-2026.mjs [console_url]

const CONSOLE_URL = process.argv[2] || 'http://127.0.0.1:3100';
const GREECE_MARKET_ID = '842019';

const events = [
  {
    market_id: GREECE_MARKET_ID,
    event_type: 'semifinal',
    event_time_utc: '2026-05-13T19:00:00Z',
    priority: 8,
    source: 'Bettor r55 spec',
    notes: 'Eurovision 2026 Semifinal 2 (Greece 出场)',
  },
  {
    market_id: GREECE_MARKET_ID,
    event_type: 'final',
    event_time_utc: '2026-05-16T19:00:00Z',
    priority: 9,
    source: 'Bettor r55 spec',
    notes: 'Eurovision 2026 Grand Final',
  },
];

const fetchJson = async (url, opts = {}) => {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({ error: 'non-JSON response' }));
  return { ok: r.ok, status: r.status, body: j };
};

const main = async () => {
  console.log('=== Bettor Phase 3f-1 Sub #7 seed: Eurovision 2026 + unblacklist Greece + scan trigger ===\n');

  // op 1+2: POST event_calendar (semifinal + final)
  for (const ev of events) {
    const r = await fetchJson(`${CONSOLE_URL}/api/bettor/event-calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(ev),
    });
    console.log(`[op POST event_calendar ${ev.event_type}] status=${r.status}:`, JSON.stringify(r.body));
    if (!r.ok) throw new Error(`event_calendar POST ${ev.event_type} failed: ${JSON.stringify(r.body)}`);
  }
  console.log();

  // op 3: DELETE blacklist (放出 Greece)
  const delRes = await fetchJson(`${CONSOLE_URL}/api/bettor/blacklist/${GREECE_MARKET_ID}`, { method: 'DELETE' });
  console.log(`[op DELETE blacklist Greece ${GREECE_MARKET_ID}] status=${delRes.status}:`, JSON.stringify(delRes.body));
  if (!delRes.ok) throw new Error(`blacklist DELETE failed: ${JSON.stringify(delRes.body)}`);
  console.log();

  // op 4: POST scan (manual trigger)
  console.log('[op POST /api/bettor/scan] triggering manual scan (LLM call, may take 30-60s)...');
  const scanRes = await fetchJson(`${CONSOLE_URL}/api/bettor/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  console.log(`[op scan trigger] status=${scanRes.status}:`, JSON.stringify(scanRes.body));
  console.log();

  // wait a moment so scanner can write recommendations
  console.log('[wait] 5s for scan to settle into DB...');
  await new Promise(res => setTimeout(res, 5000));

  // op 5: verify GET event_calendar + recommendations for Greece
  const ecList = await fetchJson(`${CONSOLE_URL}/api/bettor/event-calendar?market_id=${GREECE_MARKET_ID}`);
  console.log(`\n[verify GET event_calendar Greece] status=${ecList.status} count=${ecList.body?.count}`);
  for (const item of ecList.body?.items || []) {
    console.log(`  - ${item.event_type} @ ${item.event_time_utc} prio=${item.priority} (id=${item.id})`);
  }

  const recList = await fetchJson(`${CONSOLE_URL}/api/bettor/recommendations?limit=10`);
  console.log(`\n[verify GET recommendations top10] status=${recList.status} count=${recList.body?.count}`);
  // endpoint shape: { ok, scanned_at, count, recommendations: [...] }
  const recs = Array.isArray(recList.body?.recommendations) ? recList.body.recommendations : [];
  const greeceRecs = recs.filter(r => String(r.market_id) === GREECE_MARKET_ID);
  if (greeceRecs.length === 0) {
    console.log(`  ⚠ no Greece recommendation row yet (market_id=${GREECE_MARKET_ID}) — scan may still be running OR market filtered out (eligibility/blacklist).`);
  } else {
    for (const r of greeceRecs) {
      console.log(`  Greece rec: lifecycle_state=${r.lifecycle_state} calibrator_confidence=${r.calibrator_confidence} decision=${r.decision} size_usd=${r.size_usd} fraction=${r.fraction} p_mid=${r.p_mid} yes_price=${r.yes_price}`);
    }
  }

  console.log('\n=== Sub #7 seed complete ===');
};

main().catch(err => { console.error('seed FAIL:', err.message); process.exit(1); });
