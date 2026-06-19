import { sqlite } from '../../db/client.js';
import { encrypt, decrypt, makeMnemonicHint } from '../../services/crypto.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

export function listRelayNodes() {
  // T-J2-2026-05-11 Phase 2 η.3: 加 role + is_dex_broker + is_service (UI consume per Owner 5/11 钦定)
  return sqlite.prepare(`
    SELECT r.id, r.name, r.address, r.network, r.poll_ms, r.mnemonic_hint,
           r.adapter_node_id, a.name AS adapter_name, a.http_port AS adapter_port,
           r.focus, r.role, r.is_dex_broker, r.is_service, r.is_oracle, r.created_at
    FROM relay_nodes r
    LEFT JOIN adapter_nodes a ON a.id = r.adapter_node_id
    ORDER BY r.created_at ASC
  `).all();
}

export function getRelayNode(id) {
  return sqlite.prepare('SELECT * FROM relay_nodes WHERE id = ?').get(id);
}

export function createRelayNode({ name, mnemonic, privkey, address, network, adapterNodeId, pollMs }) {
  const id = randomUUID();
  const now = nowIso();
  const mnemonicEncrypted = mnemonic ? encrypt(mnemonic) : null;
  const mnemonicHint = mnemonic ? makeMnemonicHint(mnemonic) : null;
  // r281 (Owner P0): privkey-backed relay (raw kaspa privkey, no mnemonic). 加密存.
  // J2 r93 reviewer audit: privkeyHint **不**漏私钥 hex (旧 first6+last4 漏 10 字符 = 1.7% 私钥). 改用固定
  // 标记表示这是导入的私钥型 relay (具体地址走 address 列已显示, 不需要从私钥派生 hint).
  const privkeyEncrypted = privkey ? encrypt(privkey) : null;
  const privkeyHint = privkey ? 'privkey-imported' : null;
  sqlite.prepare(`
    INSERT INTO relay_nodes (id, name, mnemonic_encrypted, mnemonic_hint, privkey_encrypted, privkey_hint, address, network, adapter_node_id, poll_ms, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, mnemonicEncrypted, mnemonicHint, privkeyEncrypted, privkeyHint,
         address || null, network || 'mainnet', adapterNodeId || null, pollMs || 2000, now, now);
  return id;
}

// r281 (Owner P0): expose decrypted privkey so startRelay can pass it as KASPA_PRIVKEY env to the
// relay child process (mirrors getRelayMnemonic below). Returns null if relay has no stored privkey.
// J2 r93 reviewer audit: decrypt fail 不 silent (KI-12 silent skip pattern). Log error so 用户 import 私钥
// 后启 relay 看 'no_key' 时能从 console 日志看到 decrypt 故障原因 (= CONSOLE_ENCRYPTION_KEY 不一致等).
export function getRelayPrivkey(id) {
  const row = sqlite.prepare('SELECT privkey_encrypted FROM relay_nodes WHERE id = ?').get(id);
  if (!row?.privkey_encrypted) return null;
  try {
    return decrypt(row.privkey_encrypted);
  } catch (e) {
    console.error(`[relay-nodes] getRelayPrivkey(${id}) decrypt fail: ${e.message} (check CONSOLE_ENCRYPTION_KEY)`);
    return null;
  }
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
