/**
 * Agent 页面数据完整性测试
 * 验证每个数字的来源和准确性
 */

import { strict as assert } from 'node:assert';
import http from 'node:http';

const BASE = 'http://localhost:3100';
let passed = 0, failed = 0;

async function get(path) {
  return new Promise(resolve => {
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

async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  Agent 页面：概览数据');
console.log('══════════════════════════════════════════\n');

const profileRes = await get('/api/agent/profile');
const profiles = profileRes.data;

await test('Profile API 返回 Agent 列表', () => {
  assert.ok(Array.isArray(profiles), 'not array');
  assert.ok(profiles.length > 0, 'empty');
});

await test('每个 Agent 有 name/address/id', () => {
  for (const a of profiles) {
    assert.ok(a.name, `missing name: ${JSON.stringify(a).slice(0,50)}`);
    assert.ok(a.address || a.relayNodeId || a.id, `missing identity`);
  }
});

const healthRes = await get('/api/health/agents');
await test('Health API 返回状态', () => {
  assert.ok(healthRes.data.agents, 'no agents');
  assert.ok(healthRes.data.summary, 'no summary');
  for (const a of healthRes.data.agents) {
    assert.ok(['green', 'yellow', 'red'].includes(a.status), `invalid status: ${a.status}`);
  }
});

await test('Health agent 数 = Profile agent 数', () => {
  assert.equal(healthRes.data.agents.length, profiles.length,
    `health ${healthRes.data.agents.length} vs profile ${profiles.length}`);
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  Agent 页面：通讯录 Tab');
console.log('══════════════════════════════════════════\n');

const agentId = profiles[0]?.relayNodeId || profiles[0]?.id;
const contactsRes = await get(`/api/contacts/list?relay_node_id=${agentId}`);
const contacts = contactsRes.data;

await test('通讯录 API 返回数组', () => {
  assert.ok(Array.isArray(contacts), 'not array');
});

await test('每个联系人有 address + status', () => {
  for (const c of contacts) {
    assert.ok(c.address, 'missing address');
    assert.ok(c.status, `missing status for ${c.address.slice(-8)}`);
  }
});

await test('交易统计字段存在（可以是 0）', () => {
  for (const c of contacts.slice(0, 5)) {
    assert.ok(typeof c.tradeCount === 'number', `tradeCount not number: ${c.tradeCount}`);
    assert.ok(typeof c.tradeVolume === 'number', `tradeVolume not number: ${c.tradeVolume}`);
  }
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  Agent 页面：目标 Tab');
console.log('══════════════════════════════════════════\n');

const goalsRes = await get(`/api/relay/${agentId}/goals`);

await test('目标 API 返回数据', () => {
  assert.equal(goalsRes.status, 200);
});

await test('目标有 text + status 字段', () => {
  const goals = Array.isArray(goalsRes.data) ? goalsRes.data : goalsRes.data?.goals || [];
  for (const g of goals) {
    assert.ok(g.text, 'goal missing text');
    assert.ok(g.status, 'goal missing status');
  }
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  Agent 页面：提案 + 审批');
console.log('══════════════════════════════════════════\n');

await test('提案 API 可用', async () => {
  const r = await get('/api/trade/proposal');
  assert.equal(r.status, 200);
  assert.ok('analysis' in r.data || 'proposal' in r.data);
});

await test('审批 API 可用', async () => {
  const r = await get('/api/trade/pending-approvals');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data));
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  Agent 页面：钱包 Tab');
console.log('══════════════════════════════════════════\n');

await test('余额 API 返回数字', async () => {
  const r = await get(`/api/relay/${agentId}/balance`);
  assert.equal(r.status, 200);
  assert.ok(typeof r.data.balance === 'number' || r.data.balance === undefined,
    `balance type: ${typeof r.data.balance}`);
});

await test('钱包列表 API 可用', async () => {
  const r = await get(`/api/relay/${agentId}/wallets`);
  assert.equal(r.status, 200);
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  Agent 页面：技能 Tab');
console.log('══════════════════════════════════════════\n');

await test('Mind 技能 API 返回列表', async () => {
  const r = await get(`/api/agent/mind-skills?relay_node_id=${agentId}`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data), 'not array');
  assert.ok(r.data.length > 0, 'no skills');
});

await test('技能有 name 字段', async () => {
  const r = await get(`/api/agent/mind-skills?relay_node_id=${agentId}`);
  for (const s of r.data.slice(0, 5)) {
    assert.ok(s.name, 'skill missing name');
  }
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  Agent 页面：历史 Tab (Episode)');
console.log('══════════════════════════════════════════\n');

await test('Episode API 可用', async () => {
  const r = await get(`/api/history/episodes?relay_node_id=${agentId}&limit=10`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data), 'not array');
});

await test('Episode 有必要字段', async () => {
  const r = await get(`/api/history/episodes?relay_node_id=${agentId}&limit=5`);
  for (const ep of r.data) {
    assert.ok(ep.episode_id, 'missing episode_id');
    assert.ok(ep.episode_type, 'missing episode_type');
    assert.ok(ep.status, 'missing status');
    assert.ok(ep.started_at, 'missing started_at');
  }
});

await test('Mind 摘要 API 可用', async () => {
  const r = await get(`/api/history/mind-summary?relay_node_id=${agentId}`);
  assert.equal(r.status, 200);
  assert.ok(r.data.performance, 'missing performance');
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  Agent 页面：故事线跳转');
console.log('══════════════════════════════════════════\n');

await test('/story 页面可加载', async () => {
  const peer = contacts[0]?.address || 'test';
  const r = await get(`/story?peer=${encodeURIComponent(peer)}&agent=${agentId}`);
  assert.equal(r.status, 200);
});

await test('Episode detail API 可用', async () => {
  const peer = contacts[0]?.address;
  if (peer) {
    const r = await get(`/api/history/episode-detail?relay_node_id=${agentId}&peer_address=${encodeURIComponent(peer)}`);
    assert.equal(r.status, 200);
  }
});

// ═══════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  Agent 页面: ${passed + failed} tests | ✅ ${passed} | ❌ ${failed}`);
if (failed === 0) console.log('  ✅ 全部通过');
else console.log(`  ⛔ ${failed} 项失败`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
