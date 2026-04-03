// Deep harassment and proactive analysis v2
const Database = require('../kasia-console/node_modules/better-sqlite3');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../kasia-console/data/console.db'), { readonly: true });

const agents = {
  'Martin':  'kaspa:qptg465n4jedfujewj3hfgkxtysq40v2jakxp2w6uuvrhf6sajf0kzewvmcmv',
  'Kasia_1': 'kaspa:qptle8yz34q3nw4zezje4nnu0wsz7th49ucyyn96pj0w9tr8rgc5k09mkzc55',
  'Sophie':  'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp',
  'Qwen':    'kaspa:qqp49k5hfydlel0x5t6akj7u6hzemfvwcwcklf6qp0khshc3a7z7uwq2wq200',
  'Eric':    'kaspa:qqjdpjp0tskthe4xtvq2juhp5szg2grwrld8574cp92hq54vekzc2tgz4cchh'
};

function getIdFor(addr) {
  const r = db.prepare('SELECT id FROM identities WHERE address = ?').get(addr);
  return r ? r.id : null;
}

function analyzeOutbound(agentName, agentAddr, targetAddrPrefix) {
  const targetRow = db.prepare(`SELECT address FROM identities WHERE address LIKE ?`).get(targetAddrPrefix + '%');
  if (!targetRow) { console.log(`  ${agentName} -> ${targetAddrPrefix}...: target not found`); return; }
  const targetAddr = targetRow.address;

  const sId = getIdFor(agentAddr);
  const tId = getIdFor(targetAddr);
  if (!sId || !tId) { console.log(`  Identity not found`); return; }

  const msgs = db.prepare(
    `SELECT created_at, content_text FROM messages
     WHERE sender_identity_id = ? AND receiver_identity_id = ?
     AND created_at > datetime('now', '-72 hours') ORDER BY created_at`
  ).all(sId, tId);

  console.log(`\n=== ${agentName} -> ${targetAddr.slice(0,35)}... (${msgs.length} msgs in 72h) ===`);
  msgs.forEach((m, i) => {
    console.log(`  ${i+1}. [${m.created_at}] ${(m.content_text || '').slice(0, 120)}`);
  });

  const replies = db.prepare(
    `SELECT COUNT(*) as cnt FROM messages WHERE sender_identity_id = ? AND receiver_identity_id = ?
     AND created_at > datetime('now', '-72 hours')`
  ).get(tId, sId);
  console.log(`  Target replied: ${replies.cnt} times`);

  if (msgs.length > 1) {
    const times = msgs.map(m => new Date(m.created_at).getTime());
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(Math.round((times[i] - times[i-1]) / 60000));
    console.log(`  Gaps (min): ${gaps.join(', ')}`);
  }

  // Check relation_states
  const rs = db.prepare(
    `SELECT * FROM relation_states WHERE local_address = ? AND peer_address = ?`
  ).get(agentAddr, targetAddr);
  if (rs) {
    console.log(`  Relation: status=${rs.status}, trust=${rs.trust_level}`);
  }
}

// Analyze flagged pairs
analyzeOutbound('Sophie', agents.Sophie, 'kaspa:qqscw77');
analyzeOutbound('Kasia_1', agents.Kasia_1, 'kaspa:qpe8w8');
analyzeOutbound('Martin', agents.Martin, 'kaspa:qp8pasdg9dhs');
analyzeOutbound('Martin', agents.Martin, 'kaspa:qqscw77');
analyzeOutbound('Martin', agents.Martin, 'kaspa:qzz2s7');

// Proactive per day per agent (all 5)
console.log('\n=== Proactive cycles per day (all agents) ===');
for (const [name, addr] of Object.entries(agents)) {
  const rows = db.prepare(
    `SELECT date(created_at) as day, COUNT(*) as cnt
     FROM events WHERE agent_address = ? AND event_type = 'proactive_cycle'
     AND created_at > datetime('now', '-72 hours')
     GROUP BY date(created_at) ORDER BY day`
  ).all(addr);
  console.log(`  ${name}:`);
  rows.forEach(r => console.log(`    ${r.day}: ${r.cnt}${r.cnt > 50 ? ' !! OVER LIMIT' : ''}`));
}

// Check proactive daily limit code: look at what time the events happened on 3/31 for Martin
console.log('\n=== Martin proactive timing on 3/31 (over-limit day) ===');
const martinPro = db.prepare(
  `SELECT created_at FROM events
   WHERE agent_address = ? AND event_type = 'proactive_cycle'
   AND created_at BETWEEN '2026-03-31T00:00:00Z' AND '2026-03-31T23:59:59Z'
   ORDER BY created_at`
).all(agents.Martin);
console.log(`  Total: ${martinPro.length} proactive cycles`);
if (martinPro.length > 0) {
  console.log(`  First: ${martinPro[0].created_at}`);
  console.log(`  Last:  ${martinPro[martinPro.length - 1].created_at}`);
  // Time between cycles
  if (martinPro.length > 1) {
    const times = martinPro.map(r => new Date(r.created_at).getTime());
    const gaps = [];
    for (let i = 1; i < Math.min(times.length, 20); i++) gaps.push(Math.round((times[i] - times[i-1]) / 60000));
    console.log(`  First 20 gaps (min): ${gaps.join(', ')}`);
  }
}

db.close();
