// Alpha readiness check — run from kasia-console dir: node ../scripts/alpha-check.js
const Database = require('../kasia-console/node_modules/better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '../kasia-console/data/console.db');
const db = new Database(dbPath, { readonly: true });

const agents = {
  'Martin':  'kaspa:qptg465n4jedfujewj3hfgkxtysq40v2jakxp2w6uuvrhf6sajf0kzewvmcmv',
  'Kasia_1': 'kaspa:qptle8yz34q3nw4zezje4nnu0wsz7th49ucyyn96pj0w9tr8rgc5k09mkzc55',
  'Sophie':  'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp',
  'Qwen':    'kaspa:qqp49k5hfydlel0x5t6akj7u6hzemfvwcwcklf6qp0khshc3a7z7uwq2wq200',
  'Eric':    'kaspa:qqjdpjp0tskthe4xtvq2juhp5szg2grwrld8574cp92hq54vekzc2tgz4cchh'
};

// Build identity_id → address map
const idMap = {};
db.prepare('SELECT id, address FROM identities').all().forEach(r => { idMap[r.id] = r.address; });

const agentIdIds = {};
for (const [name, addr] of Object.entries(agents)) {
  agentIdIds[name] = db.prepare('SELECT id FROM identities WHERE address = ?').all(addr).map(r => r.id);
}

const agentAddrs = new Set(Object.values(agents));
const SEP = '='.repeat(55);

console.log(SEP);
console.log('  KANet Alpha Check — ' + new Date().toLocaleString());
console.log(SEP);

// ── 1. Outbound DM per peer ──
console.log('\n--- 1. Outbound DM per peer (72h) ---');
let harassment = false;
for (const [name, addr] of Object.entries(agents)) {
  const ids = agentIdIds[name];
  if (!ids.length) { console.log('  ' + name + ': no identity'); continue; }
  const ph = ids.map(() => '?').join(',');
  const sql = `SELECT receiver_identity_id, COUNT(*) as cnt FROM messages WHERE sender_identity_id IN (${ph}) AND direction='outbound' AND created_at > datetime('now', '-72 hours') GROUP BY receiver_identity_id ORDER BY cnt DESC`;
  const outbound = db.prepare(sql).all(...ids);
  if (outbound.length === 0) { console.log('  ' + name + ': 0 outbound'); continue; }
  console.log('  ' + name + ':');
  outbound.forEach(r => {
    const peerAddr = idMap[r.receiver_identity_id] || 'unknown';
    const isInt = agentAddrs.has(peerAddr);
    if (r.cnt > 3 && !isInt) harassment = true;
    console.log('    -> ' + peerAddr.slice(0,35) + '... : ' + r.cnt + (isInt ? ' (internal)' : ' EXTERNAL') + (r.cnt > 3 && !isInt ? ' !! HARASS' : ''));
  });
}
console.log(harassment ? '  X HARASSMENT DETECTED' : '  OK No harassment');

// ── 2. Proactive cycles ──
console.log('\n--- 2. Proactive cycles (72h, limit 50/day) ---');
for (const [name, addr] of Object.entries(agents)) {
  const r = db.prepare(`SELECT COUNT(*) as cnt FROM events WHERE agent_address = ? AND event_type = 'proactive_cycle' AND created_at > datetime('now', '-72 hours')`).get(addr);
  const daily = Math.round(r.cnt / 3);
  console.log('  ' + name + ': ' + r.cnt + ' (' + daily + '/day)' + (daily > 50 ? ' !! OVER' : ' OK'));
}

// ── 3. Health events ──
console.log('\n--- 3. Health events (72h) ---');
for (const [name, addr] of Object.entries(agents)) {
  const red = db.prepare(`SELECT COUNT(*) as cnt FROM events WHERE agent_address = ? AND event_type = 'health_red' AND created_at > datetime('now', '-72 hours')`).get(addr);
  const yellow = db.prepare(`SELECT COUNT(*) as cnt FROM events WHERE agent_address = ? AND event_type = 'health_yellow' AND created_at > datetime('now', '-72 hours')`).get(addr);
  console.log('  ' + name + ': red=' + red.cnt + ' yellow=' + yellow.cnt);
}

// ── 4. Reflections ──
console.log('\n--- 4. Reflections ---');
const mindsDir = path.resolve(__dirname, '../agent-mind/minds');
try {
  fs.readdirSync(mindsDir).forEach(d => {
    const refFile = path.join(mindsDir, d, 'reflections.json');
    if (fs.existsSync(refFile)) {
      const data = JSON.parse(fs.readFileSync(refFile, 'utf8'));
      const lt = data.lastReflectionTime || 'unknown';
      const c = (data.reflections || []).length;
      const h = lt !== 'unknown' ? Math.round((Date.now() - new Date(lt).getTime()) / 3600000) : '?';
      console.log('  ' + d + ': last=' + lt + ' (' + h + 'h ago), total=' + c);
    }
  });
} catch(e) { console.log('  Error: ' + e.message); }

// ── 5. Chain events ──
console.log('\n--- 5. Chain events (72h) ---');
db.prepare(`SELECT event_type, COUNT(*) as cnt FROM chain_events WHERE observed_at > datetime('now', '-72 hours') GROUP BY event_type ORDER BY cnt DESC`).all().forEach(r => console.log('  ' + r.event_type + ': ' + r.cnt));

// ── 6. Silence ratio ──
console.log('\n--- 6. Silence ratio (72h) ---');
for (const [name, addr] of Object.entries(agents)) {
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM events WHERE agent_address = ? AND created_at > datetime('now', '-72 hours') AND event_type IN ('reactive_reply', 'reactive_silent', 'proactive_cycle')`).get(addr);
  const silent = db.prepare(`SELECT COUNT(*) as cnt FROM events WHERE agent_address = ? AND created_at > datetime('now', '-72 hours') AND event_type = 'reactive_silent'`).get(addr);
  const pct = total.cnt > 0 ? Math.round(silent.cnt / total.cnt * 100) : 0;
  console.log('  ' + name + ': ' + silent.cnt + '/' + total.cnt + ' (' + pct + '%)' + (pct > 80 ? ' !! HIGH' : ' OK'));
}

// ── 7. Orders ──
console.log('\n--- 7. Orders ---');
db.prepare('SELECT status, COUNT(*) as cnt FROM mm_orders GROUP BY status ORDER BY cnt DESC').all().forEach(r => console.log('  ' + r.status + ': ' + r.cnt));

// ── 8. Activity window ──
console.log('\n--- 8. Activity window ---');
const first72 = db.prepare(`SELECT MIN(created_at) as ts FROM events WHERE created_at > datetime('now', '-72 hours')`).get();
const lastAll = db.prepare('SELECT MAX(created_at) as ts FROM events').get();
console.log('  72h window start: ' + (first72?.ts || 'none'));
console.log('  Last event:       ' + (lastAll?.ts || 'none'));
const hrs = first72?.ts && lastAll?.ts ? Math.round((new Date(lastAll.ts) - new Date(first72.ts)) / 3600000) : 0;
console.log('  Span: ~' + hrs + 'h');

// ── 9. Last activity per agent ──
console.log('\n--- 9. Last activity per agent ---');
for (const [name, addr] of Object.entries(agents)) {
  const le = db.prepare('SELECT MAX(created_at) as ts FROM events WHERE agent_address = ?').get(addr);
  const hoursAgo = le?.ts ? Math.round((Date.now() - new Date(le.ts).getTime()) / 3600000) : '?';
  console.log('  ' + name + ': ' + (le?.ts || 'none') + ' (' + hoursAgo + 'h ago)');
}

// ── Summary ──
console.log('\n' + SEP);
console.log('  SUMMARY');
console.log(SEP);
const totalEvts = db.prepare(`SELECT COUNT(*) as cnt FROM events WHERE created_at > datetime('now', '-72 hours')`).get().cnt;
const trades = db.prepare(`SELECT COUNT(*) as cnt FROM mm_orders WHERE status = 'completed'`).get().cnt;
console.log('  Harassment:        ' + (harassment ? 'FAIL' : 'PASS'));
console.log('  Events (72h):      ' + totalEvts);
console.log('  Completed trades:  ' + trades);
console.log('  Agents:            ' + Object.keys(agents).length);
console.log('  Activity span:     ~' + hrs + 'h');
console.log(SEP);

db.close();
