// 同主网 (1814) 默认做法: 备份后只改 6 行 is_oracle=1
import { readFileSync, copyFileSync } from 'node:fs';
const DB = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db';
const relays = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_tok_sim/relays.json', 'utf8'));
process.env.DB_PATH = DB; process.env.CONSOLE_ENCRYPTION_KEY ||= '1'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
const { sqlite: db } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/db/client.js');   // 生产 client(M0a 门: 不裸 import better-sqlite3); 需 sim console 已停或仅读
db.pragma('wal_checkpoint(TRUNCATE)');
copyFileSync(DB, 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.pre-is_oracle.db');
const ids = Object.entries(relays).filter(([n]) => n.startsWith('oracle-')).map(([, r]) => r.id);
const info = db.prepare(`UPDATE relay_nodes SET is_oracle = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
console.log('is_oracle=1 rows changed:', info.changes);
console.log(db.prepare('SELECT name, is_oracle, role FROM relay_nodes ORDER BY name').all());
