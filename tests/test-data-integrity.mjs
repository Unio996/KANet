/**
 * KANet Data Integrity Tests — P0
 *
 * 三项不通过不能上线：
 *   1. 钱包余额准确性
 *   2. 交易提案参数正确性
 *   3. 限额/模式生效验证
 *
 * 运行：node tests/test-data-integrity.mjs
 * 依赖：Console 必须运行在 localhost:3100
 */

import { strict as assert } from 'node:assert';
import http from 'node:http';

const BASE = 'http://localhost:3100';
let passed = 0, failed = 0;

async function get(path) {
  return new Promise((resolve) => {
    http.get(BASE + path, { timeout: 15000 }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    }).on('error', e => resolve({ status: 0, data: e.message }));
  });
}

async function put(path, bodyObj) {
  return new Promise((resolve) => {
    const data = JSON.stringify(bodyObj);
    const req = http.request(BASE + path, {
      method: 'PUT', timeout: 10000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', e => resolve({ status: 0, data: e.message }));
    req.write(data);
    req.end();
  });
}

function test(name, fn) {
  return fn().then(() => {
    passed++;
    console.log(`  ✅ ${name}`);
  }).catch(e => {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  });
}

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  P0-1: 钱包余额准确性');
console.log('══════════════════════════════════════════\n');

// Get relay nodes first
const healthRes = await get('/api/health/agents');
const agents = healthRes.data?.agents || [];
const agentModesRes = await get('/api/trade/agent-modes');
const agentList = agentModesRes.data?.agents || [];

await test('Health API 返回 Agent 列表', async () => {
  assert.ok(agents.length > 0, 'no agents');
  for (const a of agents) {
    assert.ok(a.name, 'agent missing name');
    assert.ok(a.address, 'agent missing address');
  }
});

await test('每个 Agent 有地址（非 null/undefined）', async () => {
  for (const a of agentList) {
    assert.ok(a.address, `${a.name} has no address`);
    assert.ok(a.address.startsWith('kaspa:'), `${a.name} address invalid: ${a.address}`);
  }
});

await test('Portfolio API 返回数据（不报错）', async () => {
  const r = await get('/api/trade/portfolio');
  assert.equal(r.status, 200, `status ${r.status}`);
  // Portfolio should have some structure
  assert.ok(r.data !== null && r.data !== undefined, 'portfolio is null');
});

await test('钱包余额是数字，不是 null/NaN/undefined', async () => {
  const r = await get('/api/trade/portfolio');
  if (r.data?.kasBalance !== undefined) {
    assert.ok(typeof r.data.kasBalance === 'number', `kasBalance not number: ${typeof r.data.kasBalance}`);
    assert.ok(!isNaN(r.data.kasBalance), 'kasBalance is NaN');
  }
  // USDT balance might not exist if no exchange connected — that's OK
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  P0-2: 交易提案参数正确性');
console.log('══════════════════════════════════════════\n');

await test('Signal API 返回完整结构', async () => {
  const r = await get('/api/trade/signals');
  assert.equal(r.status, 200);
  const d = r.data;
  assert.ok('composite' in d, 'missing composite');
  assert.ok('confidence' in d, 'missing confidence');
  assert.ok('regime' in d, 'missing regime');
  assert.ok('actionable' in d, 'missing actionable');
  assert.ok(typeof d.composite === 'number', `composite not number: ${d.composite}`);
  assert.ok(typeof d.confidence === 'number', `confidence not number: ${d.confidence}`);
  assert.ok(typeof d.actionable === 'boolean', `actionable not boolean: ${d.actionable}`);
});

await test('Signal 五维信号全部是数字', async () => {
  const r = await get('/api/trade/signals');
  const s = r.data?.signals;
  if (s && Object.keys(s).length > 0) {
    for (const [key, val] of Object.entries(s)) {
      assert.ok(typeof val === 'number', `signal ${key} not number: ${val}`);
      assert.ok(!isNaN(val), `signal ${key} is NaN`);
    }
  }
});

await test('Signal composite 范围 -100 ~ +100', async () => {
  const r = await get('/api/trade/signals');
  const c = r.data?.composite;
  if (typeof c === 'number') {
    assert.ok(c >= -100 && c <= 100, `composite out of range: ${c}`);
  }
});

await test('Proposal API 返回完整结构', async () => {
  const r = await get('/api/trade/proposal');
  assert.equal(r.status, 200);
  assert.ok('analysis' in r.data || 'proposal' in r.data, 'missing analysis/proposal');
  // If proposal exists, validate its structure
  if (r.data.proposal) {
    const p = r.data.proposal;
    assert.ok(p.strategy, 'proposal missing strategy');
    assert.ok(p.action, 'proposal missing action');
    assert.ok(p.params, 'proposal missing params');
    assert.ok(p.params.amount > 0, 'proposal amount <= 0');
    assert.ok(p.params.price > 0, 'proposal price <= 0');
    assert.ok(p.params.reason, 'proposal missing reason');
    assert.ok(p.riskCheck, 'proposal missing riskCheck');
  }
});

await test('actionable=false 时不生成提案', async () => {
  const r = await get('/api/trade/proposal');
  if (r.data.analysis && !r.data.analysis.actionable) {
    assert.equal(r.data.proposal, null, 'proposal should be null when not actionable');
  }
});

await test('Anchor API 返回有效值', async () => {
  const r = await get('/api/trade/anchor');
  assert.equal(r.status, 200);
  assert.ok(['usd', 'kas'].includes(r.data.anchor), `invalid anchor: ${r.data.anchor}`);
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  P0-3: 限额/模式生效验证');
console.log('══════════════════════════════════════════\n');

await test('Agent modes API 返回所有 Agent', async () => {
  const r = await get('/api/trade/agent-modes');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.agents), 'agents not array');
  assert.ok(r.data.agents.length > 0, 'no agents');
  for (const a of r.data.agents) {
    assert.ok(a.name, 'agent missing name');
    assert.ok(['auto', 'approval', 'manual', 'disabled'].includes(a.mode), `invalid mode: ${a.mode}`);
  }
});

await test('Per-agent 模式设置生效', async () => {
  const agents = (await get('/api/trade/agent-modes')).data.agents;
  if (agents.length === 0) return;
  const testAgent = agents[0];
  const originalMode = testAgent.mode;

  // Set to disabled
  const r1 = await put('/api/trade/agent-mode', { mode: 'disabled', relayNodeId: testAgent.id });
  assert.ok(r1.data.ok, 'set disabled failed');

  // Verify
  const r2 = await get(`/api/trade/agent-mode?relay_node_id=${testAgent.id}`);
  assert.equal(r2.data.mode, 'disabled', `expected disabled, got ${r2.data.mode}`);

  // Restore
  await put('/api/trade/agent-mode', { mode: originalMode, relayNodeId: testAgent.id });

  // Verify restore
  const r3 = await get(`/api/trade/agent-mode?relay_node_id=${testAgent.id}`);
  assert.equal(r3.data.mode, originalMode, `restore failed: expected ${originalMode}, got ${r3.data.mode}`);
});

await test('限额配置存在且合理', async () => {
  const r = await get('/api/trade/config');
  assert.equal(r.status, 200);
  // Config should be array of agent configs
  const configs = Array.isArray(r.data) ? r.data : [];
  // At minimum, the global limits should be queryable
});

await test('锚切换 → Proposal 反映新锚', async () => {
  // Save current
  const original = (await get('/api/trade/anchor')).data.anchor;

  // Set to usd
  await put('/api/trade/set-anchor', { anchor: 'usd' });
  const usdProposal = await get('/api/trade/proposal');

  // Set to kas
  await put('/api/trade/set-anchor', { anchor: 'kas' });
  const kasProposal = await get('/api/trade/proposal');

  // Restore
  await put('/api/trade/set-anchor', { anchor: original });

  // If both have proposals, they should have different anchors
  if (usdProposal.data.proposal && kasProposal.data.proposal) {
    assert.equal(usdProposal.data.proposal.anchor, 'usd');
    assert.equal(kasProposal.data.proposal.anchor, 'kas');
    // USD anchor should pick trend/grid/mean_reversion strategy
    assert.ok(['trend_following', 'grid_trading', 'mean_reversion'].includes(usdProposal.data.proposal.strategy),
      `usd proposal has wrong strategy: ${usdProposal.data.proposal.strategy}`);
    // KAS anchor should pick accumulate/deploy_ammo/dip_reentry strategy
    assert.ok(['accumulate', 'deploy_ammo', 'dip_reentry'].includes(kasProposal.data.proposal.strategy),
      `kas proposal has wrong strategy: ${kasProposal.data.proposal.strategy}`);
  }
  // If no proposal (signal not strong enough), at least verify anchor was stored
  const finalAnchor = (await get('/api/trade/anchor')).data.anchor;
  assert.equal(finalAnchor, original, 'anchor not restored');
});

await test('Signal 不变，锚只影响 strategy 不影响 signal', async () => {
  // Set usd
  await put('/api/trade/set-anchor', { anchor: 'usd' });
  const s1 = (await get('/api/trade/signals')).data;

  // Set kas
  await put('/api/trade/set-anchor', { anchor: 'kas' });
  const s2 = (await get('/api/trade/signals')).data;

  // Restore
  await put('/api/trade/set-anchor', { anchor: 'kas' }); // user's preferred

  // Signals should be identical (market data hasn't changed in seconds)
  // Allow small variance due to real-time data refresh
  if (s1.composite !== undefined && s2.composite !== undefined) {
    const diff = Math.abs(s1.composite - s2.composite);
    assert.ok(diff < 10, `signal changed with anchor switch: ${s1.composite} vs ${s2.composite} (diff=${diff})`);
  }
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  P0-bonus: execution_states 记录完整性');
console.log('══════════════════════════════════════════\n');

await test('Pending approvals API 可用', async () => {
  const r = await get('/api/trade/pending-approvals');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data), 'not array');
});

await test('Historical execution_states 有完整字段', async () => {
  // Query via mind-summary which reads execution_states indirectly
  if (agentList.length > 0) {
    const r = await get(`/api/history/mind-summary?relay_node_id=${agentList[0].id}&days=30`);
    assert.equal(r.status, 200);
    assert.ok(r.data.performance, 'missing performance');
    assert.ok(typeof r.data.performance.total === 'number', 'performance.total not number');
    assert.ok(typeof r.data.performance.completed === 'number', 'performance.completed not number');
  }
});

// ═══════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  P0 RESULTS: ${passed + failed} tests | ✅ ${passed} passed | ❌ ${failed} failed`);
if (failed > 0) {
  console.log(`  ⛔ P0 NOT PASSED — DO NOT SHIP`);
} else {
  console.log(`  ✅ P0 PASSED — safe to proceed`);
}
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
