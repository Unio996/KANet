import { sqlite } from '../../db/client.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

export async function insertContract({ traceId = null, conversationId = null, replyId = null, contractName = '', sourceSil = '', network = 'mainnet' }) {
  const now = nowIso();
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO contracts (id,trace_id,conversation_id,reply_id,contract_name,source_sil,network,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, traceId, conversationId, replyId, contractName, sourceSil, network, 'draft', now, now);
  return id;
}

export async function updateContractStatus(id, { status, compiledOutputJson = null, txid = null, errorText = null }) {
  sqlite.prepare('UPDATE contracts SET status=?,compiled_output_json=COALESCE(?,compiled_output_json),txid=COALESCE(?,txid),error_text=COALESCE(?,error_text),updated_at=? WHERE id=?')
    .run(status, compiledOutputJson ? JSON.stringify(compiledOutputJson) : null, txid, errorText, nowIso(), id);
}

export async function listContracts() {
  return sqlite.prepare('SELECT * FROM contracts ORDER BY created_at DESC').all();
}
