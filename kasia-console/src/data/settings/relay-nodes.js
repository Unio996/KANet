import { sqlite } from '../../db/client.js';
import { encrypt, decrypt, makeMnemonicHint } from '../../services/crypto.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

export function listRelayNodes() {
  return sqlite.prepare(`
    SELECT r.id, r.name, r.address, r.network, r.poll_ms, r.mnemonic_hint,
           r.adapter_node_id, a.name AS adapter_name, a.http_port AS adapter_port,
           r.created_at
    FROM relay_nodes r
    LEFT JOIN adapter_nodes a ON a.id = r.adapter_node_id
    ORDER BY r.created_at ASC
  `).all();
}

export function getRelayNode(id) {
  return sqlite.prepare('SELECT * FROM relay_nodes WHERE id = ?').get(id);
}

export function createRelayNode({ name, mnemonic, address, network, adapterNodeId, pollMs }) {
  const id = randomUUID();
  const now = nowIso();
  const mnemonicEncrypted = mnemonic ? encrypt(mnemonic) : null;
  const mnemonicHint = mnemonic ? makeMnemonicHint(mnemonic) : null;
  sqlite.prepare(`
    INSERT INTO relay_nodes (id, name, mnemonic_encrypted, mnemonic_hint, address, network, adapter_node_id, poll_ms, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, mnemonicEncrypted, mnemonicHint,
         address || null, network || 'mainnet', adapterNodeId || null, pollMs || 2000, now, now);
  return id;
}

export function updateRelayNode(id, { name, mnemonic, address, network, adapterNodeId, pollMs }) {
  const now = nowIso();
  const existing = getRelayNode(id);
  if (!existing) return;
  const mnemonicEncrypted = mnemonic ? encrypt(mnemonic) : existing.mnemonic_encrypted;
  const mnemonicHint = mnemonic ? makeMnemonicHint(mnemonic) : existing.mnemonic_hint;
  sqlite.prepare(`
    UPDATE relay_nodes SET name=?, mnemonic_encrypted=?, mnemonic_hint=?, address=?,
      network=?, adapter_node_id=?, poll_ms=?, updated_at=?
    WHERE id=?
  `).run(name || existing.name, mnemonicEncrypted, mnemonicHint,
         address ?? existing.address, network || existing.network,
         adapterNodeId ?? existing.adapter_node_id, pollMs || existing.poll_ms, now, id);
}

export function deleteRelayNode(id) {
  // Clean up per-account skills before deleting the relay node (FK constraint)
  sqlite.prepare('DELETE FROM skills WHERE relay_node_id = ?').run(id);
  // account_relations dropped in v46 — relation_states uses address not relay_node_id, no cleanup needed
  sqlite.prepare('DELETE FROM relay_nodes WHERE id = ?').run(id);
}

export function getRelayMnemonic(id) {
  const row = sqlite.prepare('SELECT mnemonic_encrypted FROM relay_nodes WHERE id = ?').get(id);
  if (!row?.mnemonic_encrypted) return null;
  try { return decrypt(row.mnemonic_encrypted); } catch { return null; }
}
