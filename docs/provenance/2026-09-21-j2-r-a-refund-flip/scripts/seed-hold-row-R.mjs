// R-a 准入 ④: 在冻结的 R 市场上放一条 prepared 的 resolve 行(F1 HOLD 形状; 字节是占位 '[]'——本项只验"F1 HOLD 后被 R-a 标 ambiguous", 不验字节有效性)。simnet-only。
import { createRequire } from 'node:module'; import fs from 'node:fs'; import crypto from 'node:crypto';
const D = createRequire('D:/kanet-tn12/scratch/_j2_wt_ra/kasia-console/')('better-sqlite3');
const arms = JSON.parse(fs.readFileSync('D:/kanet-tn12/scratch/_j2_e2e_run/arms.json', 'utf8'));
const id = arms.R; const db = new D('D:/kanet-tn12/scratch/_j2_e2e_run/console.simnet.db');
const m = db.prepare('SELECT status, settlement_frozen_at, frozen_reason FROM proto_markets WHERE id = ?').get(id);
if (m.status !== 'sealed' || m.settlement_frozen_at == null) throw new Error('R 不是冻结的 sealed: ' + JSON.stringify(m));
const key = `settle:market:${id}:resolve`; const now = new Date().toISOString(); const txid = crypto.createHash('sha256').update('placeholder-close-' + id).digest('hex');
db.prepare("INSERT INTO proto_settlement_intents (intent_key, subject_type, subject_id, step, depends_on, status, prepared_txid, prepared_tx_json, created_at, updated_at) VALUES (?, 'market', ?, 'resolve', ?, 'prepared', ?, '[]', ?, ?)").run(key, id, `settle:market:${id}:seal`, txid, now, now);
fs.appendFileSync('D:/kanet-tn12/scratch/_j2_e2e_run/evidence/actions.jsonl', JSON.stringify({ at: now, action: 'ra_seed_prepared_close_hold_row', marketId: id, intentKey: key, preparedTxid: txid, note: '占位字节 [] 的 prepared resolve 行(F1 HOLD 形状), 仅验 R-a 翻后把它标 ambiguous' }) + '\n');
console.log('seeded', key, txid.slice(0, 12)); db.close();
