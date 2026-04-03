// Check post-fix behavior: did harassment stop after 3/31?
const Database = require('../kasia-console/node_modules/better-sqlite3');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../kasia-console/data/console.db'), { readonly: true });

function getIdFor(addr) {
  const r = db.prepare('SELECT id FROM identities WHERE address = ?').get(addr);
  return r ? r.id : null;
}

function checkPairFull(label, agentAddr, targetPrefix) {
  const target = db.prepare(`SELECT address FROM identities WHERE address LIKE ?`).get(targetPrefix + '%');
  if (!target) { console.log(`${label}: target not found`); return; }
  const sId = getIdFor(agentAddr);
  const tId = getIdFor(target.address);
  if (!sId || !tId) return;

  // All messages grouped by date
  const byDay = db.prepare(
    `SELECT date(created_at) as day, COUNT(*) as cnt
     FROM messages WHERE sender_identity_id = ? AND receiver_identity_id = ?
     GROUP BY date(created_at) ORDER BY day`
  ).all(sId, tId);

  console.log(`\n=== ${label} → ${target.address.slice(0,30)}... ===`);
  console.log('  Messages by day:');
  byDay.forEach(r => console.log(`    ${r.day}: ${r.cnt}`));

  // Messages after 3/31 specifically
  const after = db.prepare(
    `SELECT created_at, content_text FROM messages
     WHERE sender_identity_id = ? AND receiver_identity_id = ?
     AND created_at > '2026-03-31T23:59:59Z' ORDER BY created_at`
  ).all(sId, tId);
  console.log(`  After 3/31: ${after.length} messages`);
  after.forEach((m, i) => {
    console.log(`    ${i+1}. [${m.created_at}] ${(m.content_text || '').slice(0, 120)}`);
  });

  // Also check: did target reply?
  const targetReplies = db.prepare(
    `SELECT date(created_at) as day, COUNT(*) as cnt
     FROM messages WHERE sender_identity_id = ? AND receiver_identity_id = ?
     GROUP BY date(created_at) ORDER BY day`
  ).all(tId, sId);
  console.log('  Target replies by day:');
  targetReplies.forEach(r => console.log(`    ${r.day}: ${r.cnt}`));

  // Relation state
  const rs = db.prepare(`SELECT * FROM relation_states WHERE local_address = ? AND peer_address = ?`).get(agentAddr, target.address);
  if (rs) {
    console.log(`  Relation: status=${rs.status} trust=${rs.trust_level} blocked=${rs.is_blocked}`);
  }
}

const agents = {
  'Martin':  'kaspa:qptg465n4jedfujewj3hfgkxtysq40v2jakxp2w6uuvrhf6sajf0kzewvmcmv',
  'Kasia_1': 'kaspa:qptle8yz34q3nw4zezje4nnu0wsz7th49ucyyn96pj0w9tr8rgc5k09mkzc55',
  'Sophie':  'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp',
};

console.log('='.repeat(55));
console.log('  Post-fix harassment check');
console.log('='.repeat(55));

checkPairFull('Sophie', agents.Sophie, 'kaspa:qqscw77');
checkPairFull('Kasia_1', agents.Kasia_1, 'kaspa:qpe8w8');
checkPairFull('Martin', agents.Martin, 'kaspa:qp8pasdg9dhs');

// Also check: ALL agents outbound after 4/1 to ANY external peer > 3 messages
console.log('\n\n=== ALL outbound after 4/1 to any external peer > 2 msgs ===');
const agentAddrs = new Set(Object.values(agents));
agentAddrs.add('kaspa:qqp49k5hfydlel0x5t6akj7u6hzemfvwcwcklf6qp0khshc3a7z7uwq2wq200');
agentAddrs.add('kaspa:qqjdpjp0tskthe4xtvq2juhp5szg2grwrld8574cp92hq54vekzc2tgz4cchh');

const allAgents = {
  ...agents,
  'Qwen': 'kaspa:qqp49k5hfydlel0x5t6akj7u6hzemfvwcwcklf6qp0khshc3a7z7uwq2wq200',
  'Eric': 'kaspa:qqjdpjp0tskthe4xtvq2juhp5szg2grwrld8574cp92hq54vekzc2tgz4cchh'
};

// Build all agent identity ids
const agentIdentityIds = new Set();
for (const addr of agentAddrs) {
  const rows = db.prepare('SELECT id FROM identities WHERE address = ?').all(addr);
  rows.forEach(r => agentIdentityIds.add(r.id));
}

// Build identity → address map
const idToAddr = {};
db.prepare('SELECT id, address FROM identities').all().forEach(r => { idToAddr[r.id] = r.address; });

for (const [name, addr] of Object.entries(allAgents)) {
  const sIds = db.prepare('SELECT id FROM identities WHERE address = ?').all(addr).map(r => r.id);
  if (!sIds.length) continue;

  const ph = sIds.map(() => '?').join(',');
  const outbound = db.prepare(
    `SELECT receiver_identity_id, COUNT(*) as cnt
     FROM messages WHERE sender_identity_id IN (${ph})
     AND created_at > '2026-04-01T00:00:00Z'
     GROUP BY receiver_identity_id
     HAVING cnt > 2
     ORDER BY cnt DESC`
  ).all(...sIds);

  const external = outbound.filter(r => !agentIdentityIds.has(r.receiver_identity_id));
  if (external.length > 0) {
    console.log(`  ${name}:`);
    external.forEach(r => {
      const pAddr = idToAddr[r.receiver_identity_id] || 'unknown';
      console.log(`    → ${pAddr.slice(0,35)}...: ${r.cnt} msgs (4/1+)`);
    });
  }
}

// Proactive cycles after 4/1
console.log('\n=== Proactive cycles 4/1 + 4/2 per day ===');
for (const [name, addr] of Object.entries(allAgents)) {
  const rows = db.prepare(
    `SELECT date(created_at) as day, COUNT(*) as cnt
     FROM events WHERE agent_address = ? AND event_type = 'proactive_cycle'
     AND created_at > '2026-04-01T00:00:00Z'
     GROUP BY date(created_at) ORDER BY day`
  ).all(addr);
  if (rows.length) {
    console.log(`  ${name}:`);
    rows.forEach(r => console.log(`    ${r.day}: ${r.cnt}${r.cnt > 50 ? ' !! OVER' : ''}`));
  }
}

db.close();
