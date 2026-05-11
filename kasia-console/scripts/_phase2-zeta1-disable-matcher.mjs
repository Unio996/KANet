// T-J2-2026-05-11 Phase 2 ζ.1: disable matcher on 5 dev agent + Bettor
// Owner 5/11 钦定: 交易 agent 独立专门, 通用 agent 不干交易活儿
// NWT #14 propose + NWT #15 ack (a) — Trader-M role='trader' 微调

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'console.db');
const db = new Database(DB_PATH);

// Pre-update audit
const before = db.prepare(`
  SELECT r.name, sk.status
  FROM skills sk JOIN relay_nodes r ON r.id = sk.relay_node_id
  WHERE sk.name = 'matcher'
  ORDER BY r.name
`).all();
console.log('Before:', JSON.stringify(before, null, 2));

// Disable matcher on 5 dev agent + Bettor
const r = db.prepare(`
  UPDATE skills SET status='disabled', updated_at=?
  WHERE name='matcher'
    AND relay_node_id IN (
      SELECT id FROM relay_nodes
      WHERE name IN ('NWT','J2','KANet','Qclaude','Opus','Bettor')
    )
`).run(new Date().toISOString());

console.log(`UPDATE skills: ${r.changes} rows changed`);

// Post-update audit
const after = db.prepare(`
  SELECT r.name, sk.status
  FROM skills sk JOIN relay_nodes r ON r.id = sk.relay_node_id
  WHERE sk.name = 'matcher'
  ORDER BY r.name
`).all();
console.log('After:', JSON.stringify(after, null, 2));

db.close();
