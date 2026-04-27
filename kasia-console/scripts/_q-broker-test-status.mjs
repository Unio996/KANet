import Database from 'better-sqlite3';
const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });

const TraderB = db.prepare(`SELECT id, address, display_name FROM identities WHERE display_name='Trader-B'`).get();
console.log('## Trader-B:', TraderB);

// last 30min msgs around Trader-B
const msgs = db.prepare(`
  SELECT m.created_at, m.direction, m.content_text,
         si.address as sender, si.display_name as sname,
         ri.address as recv, ri.display_name as rname
  FROM messages m
  LEFT JOIN identities si ON si.id = m.sender_identity_id
  LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
  WHERE (m.sender_identity_id = ? OR m.receiver_identity_id = ?)
    AND m.created_at > datetime('now','-40 minutes')
  ORDER BY m.created_at ASC
`).all(TraderB.id, TraderB.id);

console.log(`\n## msgs around Trader-B last 40min (${msgs.length}):`);
for (const m of msgs) {
  const dir = m.direction === 'outbound' ? 'OUT→' : 'IN ←';
  const peer = m.direction === 'outbound' ? `${m.rname || m.recv?.slice(-12)}` : `${m.sname || m.sender?.slice(-12)}`;
  console.log(`${m.created_at?.slice(11,19)} ${dir} ${peer?.padEnd(20)}  ${(m.content_text||'').replace(/\s+/g,' ').slice(0,160)}`);
}

// exchange offers in last 40min where maker or taker is Trader-B
const offers = db.prepare(`
  SELECT id, give_asset, give_amount, want_asset, want_amount, want_chain, maker, taker,
         protocol_status, taker_payment_address, payment_tx, delivery_tx, created_at, matched_at, verifying_started_at, completed_at
  FROM exchange_offers
  WHERE (maker=? OR taker=?) AND created_at > datetime('now','-40 minutes')
  ORDER BY created_at DESC
`).all(TraderB.address, TraderB.address);
console.log(`\n## offers (Trader-B side, last 40min) ${offers.length}:`);
for (const o of offers) {
  console.log(JSON.stringify(o, null, 2));
}

// pending actions
const acts = db.prepare(`
  SELECT * FROM pending_actions WHERE created_at > datetime('now','-40 minutes') ORDER BY created_at DESC LIMIT 10
`).all();
console.log(`\n## pending_actions last 40min: ${acts.length}`);
for (const a of acts) {
  console.log(`${a.created_at?.slice(11,19)} ${a.action_type} ${a.status} retry=${a.retry_count} err=${(a.error||'').slice(0,80)}`);
}

// market_seeder_config price
const cfg = db.prepare('SELECT * FROM market_seeder_config').all();
console.log('\n## market_seeder_config:');
for (const c of cfg) console.log(JSON.stringify(c).slice(0,400));

db.close();
