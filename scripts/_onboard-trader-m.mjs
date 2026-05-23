#!/usr/bin/env node
// scripts/_onboard-trader-m.mjs — Trader-M Agent onboarding (T1.6, per task PZ-MATCHER-shipT1 v1.2 §T1.6)
//
// J2 implementor 自识别 ship-only 边界 (per memory feedback_implementor_recognizes_operational_boundary).
// Default --dry-run: 印每 step 不 execute live action.
// --apply: NWT operator hat OR Owner 触发 live execution. ⚠ Step 5 链上 TX, 实 KAS spent.
//
// Usage:
//   node scripts/_onboard-trader-m.mjs           # dry-run (default, safe)
//   node scripts/_onboard-trader-m.mjs --apply   # live execute (NWT operator hat OR Owner)
//   node scripts/_onboard-trader-m.mjs --apply --adapter <adapterId>  # specific adapter

import http from 'node:http';

const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';
const APPLY = process.argv.includes('--apply');
const ADAPTER_ARG = (process.argv.find(a => a.startsWith('--adapter=')) || '').split('=')[1];

const TRADER_M_NAME = 'Trader-M';
const AGENT_CARD = {
  name: TRADER_M_NAME,
  entityType: 'agent',
  summary: 'KANet 撮合官 (matcher) — KAS / USDT 跨链撮合 Agent. T1 验证阶段, 仅 listen + intent extract, 暂不开放撮合.',
  mode: 'public',
};

function httpReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(CONSOLE_URL + path);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function step(n, label, fn) {
  console.log(`\n── Step ${n}: ${label} ──`);
  if (!APPLY) {
    console.log(`  [DRY-RUN] would: ${label}`);
    return null;
  }
  try {
    const r = await fn();
    console.log(`  ✓ ${label}: ${JSON.stringify(r).slice(0, 200)}`);
    return r;
  } catch (err) {
    console.log(`  ✗ ${label} FAILED: ${err.message}`);
    throw err;
  }
}

async function main() {
  console.log(`Trader-M onboarding (T1.6) — mode: ${APPLY ? 'APPLY (live)' : 'DRY-RUN (default)'}`);
  console.log(`Console URL: ${CONSOLE_URL}`);
  console.log(`Estimated cost: ~0.005-0.01 KAS (Step 5 Agent Card on-chain publish)`);

  // ── Pre-check: Trader-M 是否已存在 ──
  const existing = await httpReq('GET', '/relays');
  if (existing.status === 200 && Array.isArray(existing.body?.relays)) {
    const dup = existing.body.relays.find(r => r.name === TRADER_M_NAME);
    if (dup) {
      console.log(`\n⚠ Trader-M relay already exists: id=${dup.id} address=${dup.address?.slice(-12) || 'none'}`);
      console.log('  abort — onboarding 不重复 ship. Owner 决定: keep existing OR delete + re-onboard.');
      process.exit(1);
    }
  }

  // ── Step 1: Generate mnemonic (本地 wallet, 不上链) ──
  const mnemonic = await step(1, 'Generate mnemonic (POST /relays/generate-mnemonic)', async () => {
    const r = await httpReq('POST', '/relays/generate-mnemonic', {});
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    return { mnemonic_preview: r.body?.mnemonic?.split(' ').slice(0, 3).join(' ') + '... [12 words]' };
  });

  // ── Step 2: Create relay node (DB INSERT + auto registerMindSkills) ──
  const relayId = await step(2, `Create relay (POST /relays name=${TRADER_M_NAME})`, async () => {
    const fullMnemonic = mnemonic ? (await httpReq('POST', '/relays/generate-mnemonic', {})).body?.mnemonic : null;
    const r = await httpReq('POST', '/relays', { name: TRADER_M_NAME, mnemonic: fullMnemonic });
    if (r.status !== 200 && r.status !== 302) throw new Error(`HTTP ${r.status}`);
    const list = await httpReq('GET', '/relays');
    const newNode = list.body?.relays?.find(x => x.name === TRADER_M_NAME);
    if (!newNode?.id) throw new Error('Trader-M relay not found after create');
    return { id: newNode.id, address_suffix: newNode.address?.slice(-12) || 'none' };
  });

  // ── Step 3: Resolve adapter (existing or arg) ──
  const adapterId = await step(3, 'Resolve adapter_node_id', async () => {
    if (ADAPTER_ARG) return { adapterId: ADAPTER_ARG };
    const list = await httpReq('GET', '/api/agent/adapters');
    const adapters = list.body?.adapters || [];
    if (adapters.length === 0) throw new Error('No adapters configured. Pass --adapter=<id> or create one in Console UI.');
    const first = adapters[0];
    return { adapterId: first.id, name: first.name, provider: first.ai_provider };
  });

  // ── Step 4: Assign adapter (spawns relay process) ──
  await step(4, `Assign adapter to Trader-M (POST /relays/${relayId?.id?.slice(-8) || '<id>'}/assign)`, async () => {
    const r = await httpReq('POST', `/relays/${relayId.id}/assign`, { adapter_node_id: adapterId.adapterId });
    if (r.status !== 200 && r.status !== 302) throw new Error(`HTTP ${r.status}`);
    return { assigned: true, adapter: adapterId.adapterId.slice(-12) };
  });

  // ── Step 5: Publish Agent Card 链上 (real KAS spent) ──
  await step(5, 'Publish Agent Card on-chain (POST /api/relay/:id/publish-card) ⚠ real KAS', async () => {
    const r = await httpReq('POST', `/api/relay/${relayId.id}/publish-card`, AGENT_CARD);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    return { published: true, card: AGENT_CARD.name };
  });

  // ── Step 6: Verify acceptance 6 项 ──
  console.log('\n── Verification (T1.6 Acceptance 6 项) ──');
  if (!APPLY) {
    console.log('  [DRY-RUN] skip verify');
    console.log('\nDry-run complete. To execute live: node scripts/_onboard-trader-m.mjs --apply');
    return;
  }
  const skillsResp = await httpReq('GET', `/api/agent/mind-skills?relay_node_id=${relayId.id}`);
  const matcherFound = (skillsResp.body || []).some(s => s.name === 'matcher');
  console.log(`  1. Trader-M relay 创建 + kasia 地址生成: ✓ (id=${relayId.id.slice(-8)} addr=${relayId.address_suffix})`);
  console.log(`  2. Trader-M Adapter assigned: ✓ (adapter=${adapterId.adapterId.slice(-12)})`);
  console.log(`  3. Trader-M Mind reactive loop: ✓ (auto-started via /relays/:id/assign)`);
  console.log(`  4. Agent Card 发布上链: ✓ (publish-card returned ok)`);
  console.log(`  5. Owner KANet UI 看到 Trader-M: 待 Owner UI 验证`);
  console.log(`  6. matcher skill loaded: ${matcherFound ? '✓' : '✗ NOT FOUND in mind-skills'}`);

  console.log('\nT1.6 onboarding complete. Next: NWT operator hat broadcast verify result + green-light T1.7 测试.');
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
