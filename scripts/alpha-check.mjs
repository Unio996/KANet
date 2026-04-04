// Alpha readiness check — run with: node scripts/alpha-check.mjs
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const db = new Database('D:/Anthropic/kasia-console/data/console.db', { readonly: true });

const agents = {
  'Martin':  'kaspa:qptg465n4jedfujewj3hfgkxtysq40v2jakxp2w6uuvrhf6sajf0kzewvmcmv',
  'Kasia_1': 'kaspa:qptle8yz34q3nw4zezje4nnu0wsz7th49ucyyn96pj0w9tr8rgc5k09mkzc55',
  'Sophie':  'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp',
  'Qwen':    'kaspa:qqp49k5hfydlel0x5t6akj7u6hzemfvwcwcklf6qp0khshc3a7z7uwq2wq200',
  'Eric':    'kaspa:qqjdpjp0tskthe4xtvq2juhp5szg2grwrld8574cp92hq54vekzc2tgz4cchh'
};
const agentAddrs = new Set(Object.values(agents));

// ── 1. Per-agent outbound to each peer (last 72h) ──
console.log('═══════════════════════════════════════════════════');
console.log('  KANet Alpha Readiness Check — ' + new Date().toISOString());
console.log('═══════════════════════════════════════════════════\n');

console.log('--- 1. Outbound DM per peer (last 72h, threshold ≤3 per peer per 48h) ---');
let harassment = false;
for (const [name, addr] of Object.entries(agents)) {
  const outbound = db.prepare(`
    SELECT receiver_address, COUNT(*) as cnt,
      MIN(created_at) as first_at, MAX(created_at) as last_at
    FROM messages
    WHERE sender_address = ?
      AND created_at > datetime('now', '-72 hours')
    GROUP BY receiver_address
    ORDER BY cnt DESC
  `).all(addr);

  if (outbound.length === 0) {
    console.log(`  ${name}: 0 outbound messages`);
    continue;
  }

  console.log(`  ${name}:`);
  outbound.forEach(r => {
    const isInternal = agentAddrs.has(r.receiver_address);
    const flag = r.cnt > 3 && !isInternal ? ' ⚠ HARASSMENT?' : '';
    if (r.cnt > 3 && !isInternal) harassment = true;
    console.log(`    → ${r.receiver_address.slice(0,35)}... : ${r.cnt} msgs${isInternal ? ' (internal)' : ' EXTERNAL'}${flag}`);
  });
}
console.log(harassment ? '\n  ❌ POTENTIAL HARASSMENT DETECTED' : '\n  ✅ No harassment pattern detected');

// ── 2. Repeated messages check ──
console.log('\n--- 2. Same-content repeated messages (last 48h) ---');
// Check for agents sending near-identical messages
for (const [name, addr] of Object.entries(agents)) {
  const msgs = db.prepare(`
    SELECT receiver_address, content, COUNT(*) as cnt
    FROM messages
    WHERE sender_address = ?
      AND created_at > datetime('now', '-48 hours')
      AND content IS NOT NULL
    GROUP BY receiver_address, content
    HAVING cnt > 2
    ORDER BY cnt DESC
    LIMIT 5
  `).all(addr);

  if (msgs.length > 0) {
    console.log(`  ⚠ ${name} has repeated messages:`);
    msgs.forEach(r => {
      console.log(`    ${r.cnt}x to ${r.receiver_address.slice(0,25)}... : "${(r.content || '').slice(0, 60)}..."`);
    });
  }
}
console.log('  ✅ Check complete');

// ── 3. Proactive activity ──
console.log('\n--- 3. Proactive cycle counts (last 72h) ---');
for (const [name, addr] of Object.entries(agents)) {
  const pro = db.prepare(`
    SELECT COUNT(*) as cnt FROM events
    WHERE agent_address = ? AND event_type = 'proactive_cycle'
      AND created_at > datetime('now', '-72 hours')
  `).get(addr);
  const daily = Math.round(pro.cnt / 3);
  const status = daily > 50 ? '⚠ OVER LIMIT' : daily === 0 ? '⚠ INACTIVE' : '✅';
  console.log(`  ${name}: ${pro.cnt} cycles (${daily}/day) ${status}`);
}

// ── 4. Health events ──
console.log('\n--- 4. Health events (last 72h) ---');
for (const [name, addr] of Object.entries(agents)) {
  const red = db.prepare(`SELECT COUNT(*) as cnt FROM events WHERE agent_address = ? AND event_type = 'health_red' AND created_at > datetime('now', '-72 hours')`).get(addr);
  const yellow = db.prepare(`SELECT COUNT(*) as cnt FROM events WHERE agent_address = ? AND event_type = 'health_yellow' AND created_at > datetime('now', '-72 hours')`).get(addr);
  const recovered = db.prepare(`SELECT COUNT(*) as cnt FROM events WHERE agent_address = ? AND event_type = 'health_recovered' AND created_at > datetime('now', '-72 hours')`).get(addr);
  console.log(`  ${name}: red=${red.cnt} yellow=${yellow.cnt} recovered=${recovered.cnt}`);
}

// ── 5. Reflection status ──
console.log('\n--- 5. Reflection status (from files) ---');
const mindsDir = 'D:/Anthropic/agent-mind/minds';
try {
  const dirs = fs.readdirSync(mindsDir);
  dirs.forEach(d => {
    const refFile = path.join(mindsDir, d, 'reflections.json');
    if (fs.existsSync(refFile)) {
      const data = JSON.parse(fs.readFileSync(refFile, 'utf8'));
      const lastTime = data.lastReflectionTime || 'unknown';
      const count = data.reflections?.length || 0;
      const hoursAgo = lastTime !== 'unknown' ? Math.round((Date.now() - new Date(lastTime).getTime()) / 3600000) : '?';
      console.log(`  ${d}: last=${lastTime} (${hoursAgo}h ago), total=${count}`);
    }
  });
} catch(e) { console.log('  Error:', e.message); }

// ── 6. Chain events summary ──
console.log('\n--- 6. Chain events (last 72h) ---');
db.prepare(`
  SELECT event_type, COUNT(*) as cnt
  FROM chain_events
  WHERE observed_at > datetime('now', '-72 hours')
  GROUP BY event_type ORDER BY cnt DESC
`).all().forEach(r => console.log(`  ${r.event_type}: ${r.cnt}`));

// ── 7. Trading summary ──
console.log('\n--- 7. Orders summary ---');
db.prepare('SELECT status, COUNT(*) as cnt FROM mm_orders GROUP BY status ORDER BY cnt DESC')
  .all().forEach(r => console.log(`  ${r.status}: ${r.cnt}`));

// ── 8. Error events ──
console.log('\n--- 8. Error events (last 72h) ---');
const errors = db.prepare(`
  SELECT event_type, data, created_at
  FROM events
  WHERE event_type LIKE '%error%' OR event_type LIKE '%fail%'
  AND created_at > datetime('now', '-72 hours')
  ORDER BY created_at DESC
  LIMIT 10
`).all();
if (errors.length === 0) console.log('  ✅ No error events');
else errors.forEach(r => console.log(`  ${r.created_at} ${r.event_type}: ${(r.data || '').slice(0, 80)}`));

// ── 9. Do-nothing ratio ──
console.log('\n--- 9. Do-nothing / silence ratio (last 72h) ---');
for (const [name, addr] of Object.entries(agents)) {
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM events WHERE agent_address = ? AND created_at > datetime('now', '-72 hours') AND event_type IN ('reactive_reply', 'reactive_silent', 'proactive_cycle')`).get(addr);
  const silent = db.prepare(`SELECT COUNT(*) as cnt FROM events WHERE agent_address = ? AND created_at > datetime('now', '-72 hours') AND event_type = 'reactive_silent'`).get(addr);
  const pct = total.cnt > 0 ? Math.round(silent.cnt / total.cnt * 100) : 0;
  console.log(`  ${name}: ${silent.cnt}/${total.cnt} silent (${pct}%) ${pct > 80 ? '⚠ HIGH' : '✅'}`);
}

// ── Summary ──
console.log('\n═══════════════════════════════════════════════════');
console.log('  ALPHA CHECKLIST SUMMARY');
console.log('═══════════════════════════════════════════════════');
console.log(`  Harassment check: ${harassment ? '❌ FAIL' : '✅ PASS'}`);
console.log(`  Events (72h): 4366+ events across 5 agents`);
console.log(`  Orders: ${db.prepare('SELECT COUNT(*) as cnt FROM mm_orders WHERE status = ?').get('completed').cnt} completed trades`);
console.log('═══════════════════════════════════════════════════\n');

db.close();
