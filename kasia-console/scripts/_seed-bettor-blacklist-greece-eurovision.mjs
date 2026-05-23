#!/usr/bin/env node
// Bettor Phase 3f-0 #5/5 seed — Greece Eurovision 2026 (market_id 842019) blacklist
// Owner 5/12 钦定: 信息差窗口期已过 + alt-data 缺失, Owner 手动按 20/50/30 分段策略入场,
// Bettor 不要自动开仓/调仓 (Eurovision 半决赛前夕).
//
// usage: node kasia-console/scripts/_seed-bettor-blacklist-greece-eurovision.mjs [console_url]
// default console_url = http://127.0.0.1:3100

const CONSOLE_URL = process.argv[2] || 'http://127.0.0.1:3100';

const payload = {
  market_id: '842019',
  reason: 'Owner 5/12 钦定: 信息差窗口期已过 + alt-data 缺失, Owner 手动按 20/50/30 分段策略入场, Bettor 不要自动开仓/调仓 (Eurovision 半决赛前夕)',
  added_by: 'Owner',
};

const main = async () => {
  // 1. add
  const addRes = await fetch(`${CONSOLE_URL}/api/bettor/blacklist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const addJson = await addRes.json();
  console.log('POST /api/bettor/blacklist:', addJson);

  // 2. verify list
  const listRes = await fetch(`${CONSOLE_URL}/api/bettor/blacklist`);
  const listJson = await listRes.json();
  console.log('GET /api/bettor/blacklist:', JSON.stringify(listJson, null, 2));

  // 3. trigger reactor 1 evaluation (verify blacklist filter at SQL layer)
  const evalRes = await fetch(`${CONSOLE_URL}/api/bettor/evaluate-now`, { method: 'POST' });
  const evalJson = await evalRes.json();
  console.log('POST /api/bettor/evaluate-now:', evalJson);
};

main().catch(err => { console.error('seed FAIL:', err.message); process.exit(1); });
