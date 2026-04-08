import { sqlite } from '../../db/client.js';
import { encrypt, decrypt } from '../../services/crypto.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

export async function getConfig(key) {
  const row = sqlite.prepare('SELECT * FROM config_entries WHERE key = ?').get(key);
  if (!row) return null;
  if (row.is_sensitive && row.value_encrypted) {
    try { return decrypt(row.value_encrypted); } catch { return null; }
  }
  return row.value_encrypted; // for non-sensitive, we store plain in value_encrypted
}

export async function setConfig(key, value, { category = 'general', isSensitive = false, hint = null } = {}) {
  const now = nowIso();
  const existing = sqlite.prepare('SELECT id FROM config_entries WHERE key = ?').get(key);

  let valueEncrypted, valuePlainHint;
  if (isSensitive) {
    valueEncrypted = encrypt(value);
    valuePlainHint = hint;
  } else {
    valueEncrypted = value;
    valuePlainHint = null;
  }

  if (existing) {
    sqlite.prepare(`UPDATE config_entries SET value_encrypted=?, value_plain_hint=?, is_sensitive=?, category=?, updated_at=? WHERE key=?`)
      .run(valueEncrypted, valuePlainHint, isSensitive ? 1 : 0, category, now, key);
  } else {
    sqlite.prepare(`INSERT INTO config_entries (id,key,category,value_encrypted,value_plain_hint,is_sensitive,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), key, category, valueEncrypted, valuePlainHint, isSensitive ? 1 : 0, now, now);
  }
}

export async function getAllConfigs(category) {
  if (category) {
    return sqlite.prepare('SELECT id,key,category,value_plain_hint,is_sensitive,updated_at,created_at FROM config_entries WHERE category=? ORDER BY key').all(category);
  }
  return sqlite.prepare('SELECT id,key,category,value_plain_hint,is_sensitive,updated_at,created_at FROM config_entries ORDER BY key').all();
}

export async function deleteConfig(key) {
  sqlite.prepare('DELETE FROM config_entries WHERE key = ?').run(key);
}
