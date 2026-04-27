import { sqlite } from '../src/db/client.js';
const prefix = process.argv[2] || '28c92f60';
const rows = sqlite.prepare(`SELECT tx_hash, sender_address, channel_name, content, created_at FROM messages WHERE tx_hash LIKE ? || '%' LIMIT 1`).all(prefix);
for (const r of rows) {
  console.log('=== TX', r.tx_hash.slice(0,8), 'from', (r.sender_address||'').slice(-12), 'ch', r.channel_name, '@', r.created_at, '===');
  console.log(r.content);
}
