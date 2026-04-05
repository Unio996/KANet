#!/usr/bin/env node
/**
 * KANet Patrol — 巡检脚本
 * 用法: node scripts/patrol.mjs [--baseline] [--verbose] [--diff]
 *
 * 输出五个 Agent 的健康、行为、社交、交易状态。
 * --baseline: 保存快照到 scripts/patrol-snapshots/
 * --verbose:  显示详细目标和反思状态
 * --diff:     与上一次快照对比变化
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:3100';
const AGENTS = [
  { name: 'Martin',  id: '3765cc82-5e20-4e61-bb0a-697277287223', addr: 'kaspa:qptg465n4jedfujewj3hfgkxtysq40v2jakxp2w6uuvrhf6sajf0kzewvmcmv' },
  { name: 'Kasia_1', id: 'b236f45f-15df-440a-b0b7-991aeef9b1a4', addr: 'kaspa:qptle8yz34q3nw4zezje4nnu0wsz7th49ucyyn96pj0w9tr8rgc5k09mkzc55' },
  { name: 'Sophie',  id: 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf', addr: 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp' },
  { name: 'Qwen',    id: '5dcb8531-5c9b-4729-82cc-dcdccba2dd40', addr: 'kaspa:qqp49k5hfydlel0x5t6akj7u6hzemfvwcwcklf6qp0khshc3a7z7uwq2wq200' },
  { name: 'Eric',    id: '6fb00ee9-af18-47f4-99fa-111ee477621d', addr: 'kaspa:qqjdpjp0tskthe4xtvq2juhp5szg2grwrld8574cp92hq54vekzc2tgz4cchh' },
];

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(BASE + urlPath, { timeout: 8000 }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject);
  });
}

function ago(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return Math.round(ms / 1000) + 's ago';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm ago';
  return Math.round(ms / 3600000) + 'h ago';
}

function statusIcon(s) {
  return s === 'green' ? '🟢' : s === 'yellow' ? '🟡' : '🔴';
}

function loadLastSnapshot() {
  const dir = path.join(__dirname, 'patrol-snapshots');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  if (files.length === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
  } catch { return null; }
}

async function detectRepeatActions() {
  // Check recent mind events for repetitive ACTION patterns
  const events = await get('/api/agent/mind-events?limit=100').catch(() => []);
  const evtArr = Array.isArray(events) ? events : (events.events || []);

  const byAgent = {};
  for (const e of evtArr) {
    if (e.event_type !== 'proactive_cycle') continue;
    const src = e.source || '?';
    if (!byAgent[src]) byAgent[src] = [];
    // Extract target address from ACTION
    const targetMatch = (e.summary || '').match(/target=(\S+)/);
    const target = targetMatch ? targetMatch[1].slice(-12) : null;
    if (target) byAgent[src].push(target);
  }

  const warnings = [];
  for (const [agent, targets] of Object.entries(byAgent)) {
    // Count how many times same target appears
    const counts = {};
    targets.forEach(t => counts[t] = (counts[t] || 0) + 1);
    for (const [target, count] of Object.entries(counts)) {
      if (count >= 3) {
        warnings.push(`${agent} → ${target} repeated ${count}x in last 100 events`);
      }
    }
  }
  return warnings;
}

async function patrol() {
  const ts = new Date().toLocaleString(undefined, { hour12: false });
  console.log(`\n${'='.repeat(60)}`);
  console.log(`KANet Patrol — ${ts}`);
  console.log('='.repeat(60));

  // Health
  const health = await get('/api/health/agents').catch(() => null);
  if (!health) { console.log('❌ Console unreachable!'); return null; }

  const report = { ts: new Date().toISOString(), agents: {} };

  for (const a of AGENTS) {
    const h = health.agents?.find(x => x.name === a.name);
    if (!h) { console.log(`  ❌ ${a.name}: not in health response`); continue; }

    const bal = await get(`/api/relay/${a.id}/balance`).catch(() => ({ balance: '?' }));
    const goals = await get(`/api/relay/${a.id}/goals`).catch(() => ({ goals: [] }));
    const goalArr = goals.goals || goals || [];
    const activeGoals = (Array.isArray(goalArr) ? goalArr : []).filter(g => g.status === 'active');
    const coolingGoals = (Array.isArray(goalArr) ? goalArr : []).filter(g => g.cooldownUntil);

    // Per-peer outbound check
    const peers = await get(`/api/agent/activity-by-peer?relay_node_id=${a.id}`).catch(() => []);
    const peerArr = Array.isArray(peers) ? peers : [];
    const external = peerArr.filter(p => !p.is_local || p.peer_name !== a.name);
    const noReply = external.filter(p => p.out_count > 3 && p.in_count === 0);

    const icon = statusIcon(h.status);
    const yellowIndicators = Object.entries(h.indicators).filter(([, v]) => v !== 'green').map(([k, v]) => `${k}=${v}`);

    console.log(`\n${icon} ${a.name.padEnd(10)} bal=${String(bal.balance).padEnd(8)} active2h=${String(h.stats.active2h).padEnd(4)} err=${h.stats.errors2h} blk=${h.stats.blocks2h} payF=${h.stats.payFails24h}`);
    console.log(`   lastEvt=${ago(h.stats.lastEvent).padEnd(10)} proact=${ago(h.stats.lastProactive).padEnd(10)} reflect=${ago(h.stats.lastReflection)}`);
    console.log(`   goals: ${activeGoals.length} active, ${coolingGoals.length} cooling`);

    if (yellowIndicators.length) console.log(`   ⚠ indicators: ${yellowIndicators.join(', ')}`);
    if (noReply.length) console.log(`   ⚠ no-reply targets: ${noReply.map(p => (p.peer_name || p.peer?.slice(-12)) + '(' + p.out_count + ')').join(', ')}`);
    if (bal.balance !== '?' && bal.balance < 1) console.log(`   ⚠ LOW BALANCE: ${bal.balance} KAS`);

    report.agents[a.name] = {
      status: h.status,
      balance: bal.balance,
      active2h: h.stats.active2h,
      errors2h: h.stats.errors2h,
      blocks2h: h.stats.blocks2h,
      payFails24h: h.stats.payFails24h,
      lastEvent: h.stats.lastEvent,
      lastProactive: h.stats.lastProactive,
      lastReflection: h.stats.lastReflection,
      activeGoals: activeGoals.length,
      coolingGoals: coolingGoals.length,
      noReplyTargets: noReply.length,
      indicators: h.indicators,
    };
  }

  // Repeat action detection
  const repeatWarnings = await detectRepeatActions();
  if (repeatWarnings.length) {
    console.log('\n🔁 Repeat ACTION patterns detected:');
    repeatWarnings.forEach(w => console.log(`   ⚠ ${w}`));
  }

  // Trading status
  const approvals = await get('/api/trade/pending-approvals').catch(() => []);
  const offers = await get('/api/exchange/offers?status=open').catch(() => []);
  const approvalArr = Array.isArray(approvals) ? approvals : (approvals.approvals || []);
  const offerArr = Array.isArray(offers) ? offers : (offers.offers || []);

  console.log(`\n📊 Trading: ${approvalArr.length} pending approvals, ${offerArr.length} open exchange offers`);

  // Summary line
  console.log(`\n✅ Summary: ${health.summary.green}🟢 ${health.summary.yellow}🟡 ${health.summary.red}🔴`);

  return report;
}

// Diff against last snapshot
function diffReport(current, previous) {
  if (!previous) return;
  console.log('\n📈 Changes since last snapshot:');
  for (const [name, curr] of Object.entries(current.agents)) {
    const prev = previous.agents[name];
    if (!prev) continue;
    const changes = [];
    if (curr.status !== prev.status) changes.push(`status: ${prev.status}→${curr.status}`);
    if (curr.balance !== prev.balance) changes.push(`bal: ${prev.balance}→${curr.balance}`);
    const actDiff = curr.active2h - prev.active2h;
    if (actDiff !== 0) changes.push(`active2h: ${actDiff > 0 ? '+' : ''}${actDiff}`);
    if (curr.errors2h !== prev.errors2h) changes.push(`err: ${prev.errors2h}→${curr.errors2h}`);
    if (curr.blocks2h !== prev.blocks2h) changes.push(`blk: ${prev.blocks2h}→${curr.blocks2h}`);
    if (changes.length) console.log(`   ${name}: ${changes.join(', ')}`);
  }
}

// Run
const args = process.argv.slice(2);
const prev = args.includes('--diff') ? loadLastSnapshot() : null;

patrol().then(report => {
  if (report && prev) diffReport(report, prev);

  if (report && args.includes('--baseline')) {
    const dir = path.join(__dirname, 'patrol-snapshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filename = `patrol-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(report, null, 2));
    console.log(`\n📁 Snapshot saved: ${filename}`);
  }
}).catch(e => console.error('Patrol failed:', e.message));
