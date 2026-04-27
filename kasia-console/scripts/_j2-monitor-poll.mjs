// J2 Monitor poll dev-coord broadcasts (5s)
import Db from 'better-sqlite3';
const db = new Db('data/console.db', { readonly: true });
let last = db.prepare("SELECT MAX(created_at) AS t FROM broadcast_messages WHERE channel_name='dev-coord'").get()?.t || new Date().toISOString();
process.stdout.write(`[monitor] start last=${last}\n`);
setInterval(() => {
  try {
    const rows = db.prepare(`
      SELECT created_at, substr(sender_address,-12) AS sender,
             substr(tx_hash,1,8) AS tx,
             substr(content,1,180) AS preview
      FROM broadcast_messages
      WHERE channel_name='dev-coord' AND created_at > ?
      ORDER BY created_at LIMIT 5
    `).all(last);
    for (const r of rows) {
      process.stdout.write(`[NEW] ${r.created_at} ${r.tx} ${r.sender}: ${(r.preview||'').replace(/\s+/g,' ')}\n`);
      last = r.created_at;
    }
  } catch (e) { process.stdout.write(`[err] ${e.message}\n`); }
}, 5000);
