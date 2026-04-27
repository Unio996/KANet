import Db from 'better-sqlite3';
const db = new Db('data/console.db', { readonly: true });
const J2 = 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3';
const BROKER = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

// J2 most recent outbound + broker most recent outbound
const j2_out = db.prepare(`
  SELECT m.created_at, m.content_text, i.address as recv FROM messages m
  JOIN identities i ON m.receiver_identity_id = i.id
  WHERE m.sender_identity_id = (SELECT id FROM identities WHERE address=?)
    AND m.created_at > datetime('now','-15 minutes')
  ORDER BY m.created_at DESC LIMIT 5
`).all(J2);
console.log('=== J2 outbound recent 15min ===');
for (const r of j2_out) console.log(`  ${r.created_at} → ${r.recv.slice(-12)}: "${(r.content_text||'').slice(0,80)}"`);

const broker_out = db.prepare(`
  SELECT m.created_at, m.content_text, i.address as recv FROM messages m
  JOIN identities i ON m.receiver_identity_id = i.id
  WHERE m.sender_identity_id = (SELECT id FROM identities WHERE address=?)
    AND m.created_at > datetime('now','-15 minutes')
  ORDER BY m.created_at DESC LIMIT 10
`).all(BROKER);
console.log('\n=== broker outbound recent 15min ===');
for (const r of broker_out) console.log(`  ${r.created_at} → ${r.recv.slice(-12)}: "${(r.content_text||'').slice(0,100)}"`);

// broker queue stats
const queueRows = db.prepare(`
  SELECT id, kind, peer, status, attempts, error, created_at FROM broker_action_queue
  WHERE created_at > datetime('now','-15 minutes')
  ORDER BY created_at DESC LIMIT 10
`).all();
console.log('\n=== broker_action_queue recent 15min ===');
for (const r of queueRows) console.log(`  ${r.created_at} ${r.kind} → ${(r.peer||'').slice(-12)} status=${r.status} attempts=${r.attempts} ${r.error||''}`);

// J2 inbound from broker
const j2_in = db.prepare(`
  SELECT m.created_at, m.content_text FROM messages m
  WHERE m.receiver_identity_id = (SELECT id FROM identities WHERE address=?)
    AND m.sender_identity_id = (SELECT id FROM identities WHERE address=?)
    AND m.created_at > datetime('now','-15 minutes')
  ORDER BY m.created_at DESC LIMIT 5
`).all(J2, BROKER);
console.log('\n=== J2 inbound from broker recent 15min ===');
for (const r of j2_in) console.log(`  ${r.created_at}: "${(r.content_text||'').slice(0,120)}"`);

db.close();
