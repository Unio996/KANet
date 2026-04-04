// Deep harassment and proactive analysis
const Database = require('../kasia-console/node_modules/better-sqlite3');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../kasia-console/data/console.db'), { readonly: true });

const agents = {
  'Martin':  'kaspa:qptg465n4jedfujewj3hfgkxtysq40v2jakxp2w6uuvrhf6sajf0kzewvmcmv',
  'Kasia_1': 'kaspa:qptle8yz34q3nw4zezje4nnu0wsz7th49ucyyn96pj0w9tr8rgc5k09mkzc55',
  'Sophie':  'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp',
};

function getIds(addr) {
  return db.prepare('SELECT id FROM identities WHERE address = ?').all(addr).map(r => r.id);
}

function analyzeOutbound(agentName, agentAddr, targetAddr) {
  const sIds = getIds(agentAddr);
  const tIds = getIds(targetAddr);
  if (!sIds.length || !tIds.length) { console.log('  No identity found'); return; }

  const sPh = sIds.map(() => '?').join(',');
  const tPh = tIds.map(() => '?').join(',');

  const msgs = db.prepare(
    `SELECT created_at, content_text FROM messages
     WHERE sender_identity_id IN (${sPh}) AND receiver_identity_id IN (${tPh})
     AND created_at > datetime('now', '-72 hours') ORDER BY created_at`
  ).all(...sIds, ...tIds);

  console.log(`\n=== ${agentName} -> ${targetAddr.slice(0,25)}... (${msgs.length} msgs) ===`);
  msgs.forEach((m, i) => {
    console.log(`  ${i+1}. [${m.created_at}] ${(m.content_text || '').slice(0, 120)}`);
  });

  // Check replies
  const replies = db.prepare(
    `SELECT COUNT(*) as cnt FROM messages
     WHERE sender_identity_id IN (${tPh}) AND receiver_identity_id IN (${sPh})
     AND created_at > datetime('now', '-72 hours')`
  ).get(...tIds, ...sIds);
  console.log(`  Target replied: ${replies.cnt} times`);

  // Timing analysis
  if (msgs.length > 1) {
    const times = msgs.map(m => new Date(m.created_at).getTime());
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(Math.round((times[i] - times[i-1]) / 60000));
    console.log(`  Message gaps (minutes): ${gaps.join(', ')}`);
  }
}

// Analyze the flagged pairs
analyzeOutbound('Sophie', agents.Sophie, 'kaspa:qqscw77lnjdjuafrjh8nz5hxlat83gqkpamrd2r7t95dz09z0vlqwvjjkwf5');
analyzeOutbound('Kasia_1', agents.Kasia_1, 'kaspa:qpe8w8fgxfq6q0p0em7qc2hjg35hd6z4xqh86k78cw73y0pkq5t2kytlwm5c');
analyzeOutbound('Martin', agents.Martin, 'kaspa:qp8pasdg9dhssfx5g3alxy7pprxy00mjw37gdx4eqvrcq5r7dl8e20fgywwcv');
analyzeOutbound('Martin', agents.Martin, 'kaspa:qqscw77lnjdjuafrjh8nz5hxlat83gqkpamrd2r7t95dz09z0vlqwvjjkwf5');
analyzeOutbound('Martin', agents.Martin, 'kaspa:qzz2s7gruqr5zrxatlnw2wzlu07cxcaemz3ynqcmtsrg4gy3v4egqfnkz4qls');

// Proactive per day
console.log('\n=== Proactive cycles per day ===');
for (const [name, addr] of Object.entries(agents)) {
  const rows = db.prepare(
    `SELECT date(created_at) as day, COUNT(*) as cnt
     FROM events WHERE agent_address = ? AND event_type = 'proactive_cycle'
     AND created_at > datetime('now', '-72 hours')
     GROUP BY date(created_at) ORDER BY day`
  ).all(addr);
  console.log(`  ${name}:`);
  rows.forEach(r => console.log(`    ${r.day}: ${r.cnt}${r.cnt > 50 ? ' !! OVER' : ''}`));
}

// Check if qqscw77 is actually an agent or external user
console.log('\n=== Who is qqscw77? ===');
const qqscw = db.prepare("SELECT * FROM identities WHERE address LIKE 'kaspa:qqscw77%'").get();
console.log(JSON.stringify(qqscw, null, 2));

const rs = db.prepare("SELECT * FROM relation_states WHERE agent_address LIKE 'kaspa:qqscw77%' OR peer_address LIKE 'kaspa:qqscw77%' LIMIT 5").all();
console.log('relation_states entries:', rs.length);
rs.forEach(r => console.log(`  ${r.agent_address?.slice(0,20)} <-> ${r.peer_address?.slice(0,20)}: ${r.status}`));

db.close();
