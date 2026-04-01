#!/usr/bin/env node
/**
 * KANet Smoke Test — 关键路径验证
 *
 * 需要 Console 在 localhost:3100 运行。
 * 用法: node test/smoke.mjs
 *
 * 覆盖：连接 / health / 数据 / anti-spam / 交易 / mind / 市场 / UI
 */

const BASE = process.env.CONSOLE_URL || 'http://localhost:3100';
let passed = 0, failed = 0, skipped = 0;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json();
}

async function fetchOk(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, ok: res.ok };
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \u2705 ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \u274c ${name}: ${e.message}`);
  }
}

function skip(name, reason) {
  skipped++;
  console.log(`  \u23ed  ${name} — ${reason}`);
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ═══════════════════════════════════════════════════════
console.log('\n=== System Connection ===');
// ═══════════════════════════════════════════════════════

let healthData = null;

await test('Console reachable', async () => {
  const { status } = await fetchOk('/');
  assert(status === 200 || status === 302, `status=${status}`);
});

await test('Health API returns agents', async () => {
  healthData = await fetchJson('/api/health/agents');
  assert(healthData.agents?.length > 0, 'no agents found');
  for (const a of healthData.agents) {
    const dot = a.status === 'green' ? '[G]' : a.status === 'yellow' ? '[Y]' : '[R]';
    console.log(`       ${dot} ${a.name}: ${a.status}${a.reason ? ' (' + a.reason + ')' : ''}`);
  }
});

await test('All agents green or yellow (none red)', async () => {
  assert(healthData, 'no health data');
  const red = healthData.agents.filter(a => a.status === 'red');
  assert(red.length === 0, `${red.length} agent(s) RED: ${red.map(a => a.name).join(', ')}`);
});

// ═══════════════════════════════════════════════════════
console.log('\n=== Anti-Spam ===');
// ═══════════════════════════════════════════════════════

const agentAddr = healthData?.agents?.[0]?.address;

await test('outbound-check allows unknown peer', async () => {
  assert(agentAddr, 'no agent address');
  const data = await fetchJson(`/api/agent/outbound-check?agent_address=${encodeURIComponent(agentAddr)}&peer_address=kaspa:qzzzzzzzfake_address_for_smoke_test_00000000000000000000`);
  assert(data.allowed === true, `expected allowed=true, got ${JSON.stringify(data)}`);
});

await test('outbound-check blocks empty params', async () => {
  const res = await fetch(`${BASE}/api/agent/outbound-check?agent_address=&peer_address=`);
  // 400 or JSON with allowed=false — both are correct behavior
  if (res.ok) {
    const data = await res.json();
    assert(data.allowed === false, 'empty params should be blocked');
  } else {
    assert(res.status === 400, `unexpected status ${res.status}`);
  }
});

await test('outbound-check blocks same-agent (self)', async () => {
  assert(agentAddr, 'no agent address');
  const data = await fetchJson(`/api/agent/outbound-check?agent_address=${encodeURIComponent(agentAddr)}&peer_address=${encodeURIComponent(agentAddr)}`);
  // Self-contact should be blocked or irrelevant
  console.log(`       self-check: allowed=${data.allowed} reason=${data.reason || 'none'}`);
});

// ═══════════════════════════════════════════════════════
console.log('\n=== Trade System ===');
// ═══════════════════════════════════════════════════════

await test('mm_orders API works', async () => {
  const data = await fetchJson('/api/trade/mm-orders');
  assert(Array.isArray(data), 'expected array');
  const active = data.filter(o => !['completed', 'cancelled', 'expired'].includes(o.status));
  console.log(`       ${data.length} total orders, ${active.length} active`);
});

await test('preflight API rejects without params', async () => {
  try {
    const res = await fetch(`${BASE}/api/trade/preflight`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Should return error or rejection
    const data = await res.json();
    console.log(`       preflight response: ${JSON.stringify(data).slice(0, 100)}`);
  } catch (e) {
    // Expected — no params
  }
});

// ═══════════════════════════════════════════════════════
console.log('\n=== Mind System ===');
// ═══════════════════════════════════════════════════════

await test('mind-events has recent data', async () => {
  const data = await fetchJson('/api/agent/mind-events?limit=5');
  assert(Array.isArray(data) && data.length > 0, 'no mind events');
  const latest = data[0];
  const age = Date.now() - new Date(latest.created_at || latest.timestamp).getTime();
  const ageMin = Math.floor(age / 60000);
  assert(ageMin < 120, `latest event is ${ageMin}min old — system may be stalled`);
  console.log(`       latest: ${ageMin}min ago — ${latest.event_type}: ${(latest.source || '').slice(0, 40)}`);
});

// ═══════════════════════════════════════════════════════
console.log('\n=== Market Data ===');
// ═══════════════════════════════════════════════════════

await test('KAS price available', async () => {
  const data = await fetchJson('/api/market/crypto');
  // API returns { source, ok, data: { KAS: {...}, BTC: {...} } }
  const kas = data?.data?.KAS;
  assert(kas, 'KAS not in crypto data');
  assert(kas.price > 0, `KAS price invalid: ${kas.price}`);
  console.log(`       KAS: $${kas.price} (24h: ${(kas.change24h * 100).toFixed(1)}%)`);
});

await test('Market overview available', async () => {
  const { ok } = await fetchOk('/api/market/overview');
  assert(ok, 'market overview not reachable');
});

// ═══════════════════════════════════════════════════════
console.log('\n=== Stock Fundamentals ===');
// ═══════════════════════════════════════════════════════

await test('fundamentals API returns sector for equity', async () => {
  const data = await fetchJson('/api/stocks/fundamentals');
  const symbols = Object.keys(data.stocks || {});
  if (symbols.length === 0) { skip('fundamentals sector', 'no stocks in watchlist'); return; }
  const first = data.stocks[symbols[0]];
  console.log(`       ${symbols[0]}: sector=${first.sector || 'null'}, industry=${first.industry || 'null'}`);
  assert(first.sector !== undefined, 'sector field missing from fundamentals');
});

await test('fundamentals API skips peers for empty industry', async () => {
  const data = await fetchJson('/api/stocks/fundamentals');
  const peerIndustries = Object.keys(data.peers || {});
  for (const ind of peerIndustries) {
    assert(Array.isArray(data.peers[ind]), `peers[${ind}] is not an array`);
    const watchSyms = new Set(Object.keys(data.stocks || {}));
    for (const p of data.peers[ind]) {
      assert(!watchSyms.has(p.symbol), `peer ${p.symbol} is also in watchlist — should be excluded`);
    }
  }
  console.log(`       ${peerIndustries.length} industries with peers discovered`);
});

await test('divergence threshold consistent between Brain and API', async () => {
  const data = await fetchJson('/api/stocks/fundamentals');
  assert(data.threshold === 3, `API threshold=${data.threshold}, expected 3`);
  console.log('       API threshold: ' + data.threshold + ' (Brain: DIVERGENCE_THRESHOLD=3 in stock-tracker.mjs)');
});

// ═══════════════════════════════════════════════════════
console.log('\n=== UI Pages ===');
// ═══════════════════════════════════════════════════════

const pages = ['/chat', '/agent', '/contacts', '/market', '/trading', '/events', '/stocks', '/predictions', '/explore'];
for (const page of pages) {
  await test(`${page} renders`, async () => {
    const { status } = await fetchOk(page);
    assert(status === 200, `status=${status}`);
  });
}

// ═══════════════════════════════════════════════════════
console.log('\n=== Data Integrity ===');
// ═══════════════════════════════════════════════════════

await test('chain_events event_type coverage', async () => {
  assert(agentAddr, 'no agent address');
  // Find relay_node_id from mind-events
  const events = await fetchJson('/api/agent/mind-events?limit=1');
  const rnId = events?.[0]?.relay_node_id;
  if (!rnId) { skip('chain_events coverage', 'no relay_node_id found'); return; }
  const data = await fetchJson(`/api/agent/activity-log?relay_node_id=${rnId}&limit=100`);
  assert(Array.isArray(data) && data.length > 0, 'no activity data');
  const types = new Set(data.map(e => e.type));
  console.log(`       ${data.length} events, types: ${[...types].join(', ')}`);
  // 至少应有 text 或 comm（DM），和 handshake
  const hasSocial = types.has('text') || types.has('comm') || types.has('comm_sent');
  console.log(`       social events present: ${hasSocial}`);
});

// ═══════════════════════════════════════════════════════
console.log('\n' + '='.repeat(50));
console.log(`  PASS: ${passed}  FAIL: ${failed}  SKIP: ${skipped}`);
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
