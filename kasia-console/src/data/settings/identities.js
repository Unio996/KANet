import { sqlite } from '../../db/client.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

export async function upsertIdentity({ network, address, displayName, identityType = 'remote', pubkey = null, metadataJson = null }) {
  const now = nowIso();
  const existing = sqlite.prepare('SELECT id FROM identities WHERE network=? AND address=?').get(network, address);
  if (existing) {
    sqlite.prepare(`UPDATE identities SET display_name=COALESCE(?,display_name), identity_type=?, pubkey=COALESCE(?,pubkey), metadata_json=COALESCE(?,metadata_json), updated_at=? WHERE network=? AND address=?`)
      .run(displayName, identityType, pubkey, metadataJson ? JSON.stringify(metadataJson) : null, now, network, address);
    return existing.id;
  }
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO identities (id,network,address,display_name,identity_type,pubkey,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, network, address, displayName || address.slice(-8), identityType, pubkey, metadataJson ? JSON.stringify(metadataJson) : null, now, now);
  return id;
}

export async function getIdentityByAddress(network, address) {
  return sqlite.prepare('SELECT * FROM identities WHERE network=? AND address=?').get(network, address);
}

export async function getIdentityById(id) {
  return sqlite.prepare('SELECT * FROM identities WHERE id=?').get(id);
}

export async function listIdentities() {
  return sqlite.prepare('SELECT * FROM identities ORDER BY created_at DESC').all();
}

export async function listIdentitiesByTrustLevel(trustLevel) {
  return sqlite.prepare('SELECT * FROM identities WHERE trust_level=? ORDER BY created_at DESC').all(trustLevel);
}

export async function updateIdentity(id, { displayName, notes, isBlocked, tags, trustLevel }) {
  const now = nowIso();
  const fields = [];
  const vals = [];
  if (displayName !== undefined) { fields.push('display_name=?'); vals.push(displayName); }
  if (notes !== undefined) { fields.push('notes=?'); vals.push(notes); }
  if (tags !== undefined) { fields.push('tags=?'); vals.push(tags); }
  if (trustLevel !== undefined) {
    fields.push('trust_level=?'); vals.push(trustLevel);
    // Sync is_blocked for backward compat
    fields.push('is_blocked=?'); vals.push(trustLevel === 'blocked' ? 1 : 0);
  } else if (isBlocked !== undefined) {
    fields.push('is_blocked=?'); vals.push(isBlocked ? 1 : 0);
    fields.push('trust_level=?'); vals.push(isBlocked ? 'blocked' : 'normal');
  }
  if (fields.length === 0) return;
  fields.push('updated_at=?');
  vals.push(now);
  vals.push(id);
  sqlite.prepare(`UPDATE identities SET ${fields.join(', ')} WHERE id=?`).run(...vals);
}

export async function setTrustLevel(id, trustLevel) {
  const now = nowIso();
  sqlite.prepare('UPDATE identities SET trust_level=?, is_blocked=?, updated_at=? WHERE id=?')
    .run(trustLevel, trustLevel === 'blocked' ? 1 : 0, now, id);
}

/** Annotate identity — used by Agent to auto-inject tags/notes */
export async function annotateIdentity(id, { tags, notes, trustLevel }) {
  const now = nowIso();
  const identity = sqlite.prepare('SELECT * FROM identities WHERE id=?').get(id);
  if (!identity) return false;
  const fields = [];
  const vals = [];
  if (tags !== undefined) {
    // Merge tags: append new, deduplicate
    const existing = (identity.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const incoming = tags.split(',').map(t => t.trim()).filter(Boolean);
    const merged = [...new Set([...existing, ...incoming])].join(',');
    fields.push('tags=?'); vals.push(merged);
  }
  if (notes !== undefined) {
    // Append notes with timestamp
    const prev = identity.notes || '';
    const appended = prev ? `${prev}\n[${now}] ${notes}` : `[${now}] ${notes}`;
    fields.push('notes=?'); vals.push(appended);
  }
  if (trustLevel !== undefined) {
    fields.push('trust_level=?'); vals.push(trustLevel);
    fields.push('is_blocked=?'); vals.push(trustLevel === 'blocked' ? 1 : 0);
  }
  if (fields.length === 0) return false;
  fields.push('updated_at=?');
  vals.push(now);
  vals.push(id);
  sqlite.prepare(`UPDATE identities SET ${fields.join(', ')} WHERE id=?`).run(...vals);
  return true;
}

export async function isAddressBlocked(network, address) {
  const row = sqlite.prepare('SELECT trust_level FROM identities WHERE network=? AND address=?').get(network, address);
  return row ? row.trust_level === 'blocked' : false;
}

export async function listBlockedAddresses(network) {
  return sqlite.prepare("SELECT address FROM identities WHERE network=? AND trust_level='blocked'").all(network || 'mainnet');
}

export async function getAddressTrustLevel(network, address) {
  const row = sqlite.prepare('SELECT trust_level FROM identities WHERE network=? AND address=?').get(network, address);
  return row ? row.trust_level : 'unknown';
}
