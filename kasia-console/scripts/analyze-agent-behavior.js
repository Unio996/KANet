/**
 * Agent Behavior Quantitative Analysis
 *
 * Usage: node scripts/analyze-agent-behavior.js [--hours 24]
 *
 * Analyzes: goal tracking, proactive behavior, social quality, relay dedup, economic efficiency
 */

import { sqlite } from '../src/db/client.js';
import fs from 'fs';
import path from 'path';

const hours = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--hours') || '24');
const since = new Date(Date.now() - hours * 3600_000).toISOString();

console.log(`\n${'='.repeat(60)}`);
console.log(`  Agent Behavior Analysis — last ${hours}h (since ${since.slice(0, 16)})`);
console.log(`${'='.repeat(60)}\n`);

// ── Agent list ──
const agents = sqlite.prepare('SELECT id, name, address FROM relay_nodes WHERE address IS NOT NULL').all();

// ══════════════════════════════════════════════════
// 1. GOAL TRACKING (from intent.json files)
// ══════════════════════════════════════════════════
console.log('--- 1. GOAL TRACKING ---\n');

const MINDS_DIR = path.resolve('..', 'agent-mind', 'minds');
for (const agent of agents) {
  const agentDir = agent.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const intentPath = path.join(MINDS_DIR, agentDir, 'intent.json');
  try {
    const data = JSON.parse(fs.readFileSync(intentPath, 'utf-8'));
    const goals = data.goals || [];
    const active = goals.filter(g => g.status === 'active');
    const retired = goals.filter(g => g.status === 'retired');
    const tracked = goals.filter(g => (g.attempts || 0) > 0);
    const successes = tracked.filter(g => g.lastResult === 'success');
    const failures = tracked.filter(g => (g.failCount || 0) > 0);
    const coolingDown = active.filter(g => g.cooldownUntil && g.cooldownUntil > new Date().toISOString());
    const autoRetired = retired.filter(g => g.retireReason?.includes('failed'));
    const unused = active.filter(g => !g.attempts);

    console.log(`  ${agent.name}:`);
    console.log(`    Active: ${active.length} | Retired: ${retired.length} | Tracked: ${tracked.length}`);
    console.log(`    Success: ${successes.length} | Failed: ${failures.length} | Cooling: ${coolingDown.length} | Auto-retired: ${autoRetired.length}`);
    console.log(`    Unused (0 attempts): ${unused.length}`);
    if (coolingDown.length > 0) {
      coolingDown.forEach(g => console.log(`      CD: "${g.text?.slice(0, 40)}" until ${g.cooldownUntil?.slice(11, 16)}`));
    }
    if (autoRetired.length > 0) {
      autoRetired.forEach(g => console.log(`      AR: "${g.text?.slice(0, 40)}" — ${g.retireReason?.slice(0, 50)}`));
    }
  } catch {
    console.log(`  ${agent.name}: no intent.json`);
  }
}

// ══════════════════════════════════════════════════
// 2. PROACTIVE BEHAVIOR (from events table)
// ══════════════════════════════════════════════════
console.log('\n--- 2. PROACTIVE BEHAVIOR ---\n');

for (const agent of agents) {
  const events = sqlite.prepare(`
    SELECT event_type, summary FROM events
    WHERE agent_address = ? AND created_at >= ? AND event_type LIKE 'proactive%'
    ORDER BY created_at
  `).all(agent.address, since);

  const total = events.length;
  const doNothing = events.filter(e => e.summary?.includes('do_nothing')).length;
  const followUp = events.filter(e => e.summary?.includes('follow_up')).length;
  const sendMsg = events.filter(e => e.summary?.includes('send_message')).length;
  const broadcast = events.filter(e => e.summary?.includes('broadcast')).length;
  const handshake = events.filter(e => e.summary?.includes('handshake')).length;
  const other = total - doNothing - followUp - sendMsg - broadcast - handshake;

  console.log(`  ${agent.name}: ${total} proactive events`);
  if (total > 0) {
    const dnPct = Math.round(doNothing / total * 100);
    console.log(`    do_nothing: ${doNothing} (${dnPct}%) | follow_up: ${followUp} | message: ${sendMsg} | broadcast: ${broadcast} | handshake: ${handshake} | other: ${other}`);
  }
}

// ══════════════════════════════════════════════════
// 3. SOCIAL QUALITY
// ══════════════════════════════════════════════════
console.log('\n--- 3. SOCIAL QUALITY ---\n');

for (const agent of agents) {
  const identity = sqlite.prepare('SELECT id FROM identities WHERE address = ?').get(agent.address);
  if (!identity) { console.log(`  ${agent.name}: no identity`); continue; }

  const sent = sqlite.prepare(`
    SELECT COUNT(*) as c FROM messages m
    JOIN conversations conv ON m.conversation_id = conv.id
    WHERE conv.local_identity_id = ? AND m.direction = 'outbound' AND m.created_at >= ?
  `).get(identity.id, since);

  const recv = sqlite.prepare(`
    SELECT COUNT(*) as c FROM messages m
    JOIN conversations conv ON m.conversation_id = conv.id
    WHERE conv.local_identity_id = ? AND m.direction = 'inbound' AND m.created_at >= ?
  `).get(identity.id, since);

  const uniquePeers = sqlite.prepare(`
    SELECT COUNT(DISTINCT conv.remote_identity_id) as c FROM messages m
    JOIN conversations conv ON m.conversation_id = conv.id
    WHERE conv.local_identity_id = ? AND m.direction = 'outbound' AND m.created_at >= ?
  `).get(identity.id, since);

  // Repeat contacts (same peer >3 outbound messages)
  const repeats = sqlite.prepare(`
    SELECT conv.remote_identity_id, COUNT(*) as c FROM messages m
    JOIN conversations conv ON m.conversation_id = conv.id
    WHERE conv.local_identity_id = ? AND m.direction = 'outbound' AND m.created_at >= ?
    GROUP BY conv.remote_identity_id HAVING c > 3
  `).all(identity.id, since);

  console.log(`  ${agent.name}: sent ${sent.c} | recv ${recv.c} | peers ${uniquePeers.c} | repeat(>3): ${repeats.length}`);
}

// ══════════════════════════════════════════════════
// 4. DEDUP & BLOCKING STATS
// ══════════════════════════════════════════════════
console.log('\n--- 4. DEDUP & BLOCKING ---\n');

for (const agent of agents) {
  const blocked = sqlite.prepare(`
    SELECT COUNT(*) as c FROM events
    WHERE agent_address = ? AND created_at >= ? AND summary LIKE '%dedup-blocked%'
  `).get(agent.address, since);

  const hallucination = sqlite.prepare(`
    SELECT COUNT(*) as c FROM events
    WHERE agent_address = ? AND created_at >= ? AND summary LIKE '%hallucination%'
  `).get(agent.address, since);

  const silent = sqlite.prepare(`
    SELECT COUNT(*) as c FROM events
    WHERE agent_address = ? AND created_at >= ? AND event_type = 'reactive_silent'
  `).get(agent.address, since);

  const totalReactive = sqlite.prepare(`
    SELECT COUNT(*) as c FROM events
    WHERE agent_address = ? AND created_at >= ? AND event_type LIKE 'reactive%'
  `).get(agent.address, since);

  console.log(`  ${agent.name}: dedup-blocked ${blocked.c} | hallucination ${hallucination.c} | silent ${silent.c} / ${totalReactive.c} reactive`);
}

// ══════════════════════════════════════════════════
// 5. ECONOMIC EFFICIENCY
// ══════════════════════════════════════════════════
console.log('\n--- 5. ECONOMICS ---\n');

for (const agent of agents) {
  const txs = sqlite.prepare(`
    SELECT COALESCE(SUM(CAST(fee AS REAL)), 0) as totalFee,
           COALESCE(SUM(CAST(amount AS REAL)), 0) as totalAmount,
           COUNT(*) as txCount
    FROM tx_records
    WHERE conversation_id IN (
      SELECT conv.id FROM conversations conv
      JOIN identities i ON conv.local_identity_id = i.id
      WHERE i.address = ?
    ) AND created_at >= ?
  `).get(agent.address, since);

  const chainEvents = sqlite.prepare(`
    SELECT event_type, COUNT(*) as c FROM chain_events
    WHERE from_address = ? AND observed_at >= ?
    GROUP BY event_type
  `).all(agent.address, since);

  const mindActions = sqlite.prepare(`
    SELECT COUNT(*) as c FROM events
    WHERE agent_address = ? AND created_at >= ? AND event_type LIKE 'proactive%' AND summary NOT LIKE '%do_nothing%'
  `).get(agent.address, since);

  const costPerAction = mindActions.c > 0 ? (txs.totalFee / mindActions.c).toFixed(6) : 'N/A';

  console.log(`  ${agent.name}: ${txs.txCount} TXs | fees: ${txs.totalFee.toFixed(4)} KAS | actions: ${mindActions.c} | cost/action: ${costPerAction} KAS`);
  if (chainEvents.length) {
    console.log(`    chain_events: ${chainEvents.map(e => `${e.event_type}:${e.c}`).join(' | ')}`);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`  Analysis complete. Run again with --hours 48 for wider window.`);
console.log(`${'='.repeat(60)}\n`);
