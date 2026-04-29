// NWT real-time channel watcher for Claude Code Monitor tool.
// Each poll: close+reopen DB so we see fresh INSERTs (WAL/restart resilient).
import Db from 'better-sqlite3';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(__dirname, '..', 'data', 'console.db');
const NWT_SUFFIX = 'z2w7ktl95grm';

function poll(last) {
  const db = new Db(DB, { readonly: true });
  try {
    return db.prepare(`
      SELECT created_at, substr(tx_hash,1,10) AS tx, substr(sender_address,-12) AS sender, substr(content,1,140) AS preview
      FROM broadcast_messages
      WHERE channel_name='dev-coord' AND created_at > ?
        AND sender_address != 'monitor:system'
        AND sender_address NOT LIKE '%${NWT_SUFFIX}'
      ORDER BY created_at ASC LIMIT 10
    `).all(last);
  } finally {
    db.close();
  }
}

let last;
{
  const db = new Db(DB, { readonly: true });
  last = db.prepare("SELECT MAX(created_at) AS t FROM broadcast_messages WHERE channel_name='dev-coord'").get()?.t || new Date().toISOString();
  db.close();
}
process.stdout.write(`[NWT-watch] start last=${last}\n`);

while (true) {
  try {
    const rows = poll(last);
    for (const r of rows) {
      const cleaned = (r.preview || '').replace(/\s+/g, ' ').slice(0, 130);
      process.stdout.write(`${r.created_at} ${r.tx} ${r.sender}: ${cleaned}\n`);
      last = r.created_at;
    }
  } catch (e) {
    process.stdout.write(`[err] ${e.message}\n`);
  }
  await sleep(15_000);
}
