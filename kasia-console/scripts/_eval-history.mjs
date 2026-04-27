import { _detectIntent } from '../src/services/broker-llm-agent.js';
import Database from 'better-sqlite3';
const db = new Database('./data/console.db', { readonly: true });

const fakePeer = 'kaspa:qpfake_j2_17771693398';
const broker = db.prepare(`SELECT address FROM relay_nodes WHERE id='0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0'`).get();
console.log('broker:', broker.address);
console.log('peer:', fakePeer);

// 复刻 _loadHistory query
const rows = db.prepare(`
  SELECT m.direction, m.content_text
  FROM messages m
  LEFT JOIN identities si ON si.id = m.sender_identity_id
  LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
  WHERE m.message_type = 'text'
    AND ((si.address = ? AND ri.address = ?) OR (si.address = ? AND ri.address = ?))
  ORDER BY m.created_at DESC LIMIT 20
`).all(fakePeer, broker.address, broker.address, fakePeer);

console.log('history rows for fresh fake peer:', rows.length);
for (const r of rows) console.log('  ', r);

// 复刻 _detectIntent
console.log('_detectIntent("我要买 50 KAS"):', _detectIntent('我要买 50 KAS'));

// 另外查一下 — 也许 fastify body 拿到的 peer 跟我以为的不一样, 可能有 trim/normalize
db.close();
