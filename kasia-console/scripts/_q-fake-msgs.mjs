import Database from 'better-sqlite3';
const db = new Database('./data/console.db', { readonly: true });

// 找 fake_xxx peer 的 identity (probably 不存在)
const id = db.prepare(`SELECT id, address FROM identities WHERE address LIKE '%fake%'`).all();
console.log('identities matching fake:', id);

// 找 broker outbound to fake_xxx (or 任何含 fake 的)
const msgs = db.prepare(`
  SELECT m.id, m.direction, m.message_type, m.content_text, m.created_at,
         si.address as sender_addr, ri.address as receiver_addr
  FROM messages m
  LEFT JOIN identities si ON si.id = m.sender_identity_id
  LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
  WHERE (si.address LIKE '%fake%' OR ri.address LIKE '%fake%')
  ORDER BY m.created_at DESC LIMIT 10
`).all();
console.log('\nmessages involving fake addresses:', msgs.length);
for (const m of msgs) {
  console.log(`${m.created_at} ${m.direction} type=${m.message_type} ${m.sender_addr?.slice(-8)}->${m.receiver_addr?.slice(-8)}: ${(m.content_text || '').slice(0, 100)}`);
}

// 直接看 broker outbound 最近 5 条
const broker = db.prepare(`SELECT address FROM relay_nodes WHERE id='0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0'`).get();
console.log('\nbroker addr:', broker.address);
const recentBrokerOut = db.prepare(`
  SELECT m.created_at, m.content_text, ri.address as to_addr
  FROM messages m
  LEFT JOIN identities si ON si.id = m.sender_identity_id
  LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
  WHERE si.address = ? AND m.message_type = 'text'
  ORDER BY m.created_at DESC LIMIT 5
`).all(broker.address);
console.log('\nrecent broker outbound:', recentBrokerOut.length);
for (const m of recentBrokerOut) {
  console.log(`${m.created_at} → ${m.to_addr?.slice(-8)}: ${(m.content_text || '').slice(0, 100)}`);
}

db.close();
