import { sqlite } from '../../db/client.js';
import { encrypt, decrypt, makeTokenHint } from '../../services/crypto.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

export function listAdapterNodes() {
  return sqlite.prepare(`
    SELECT id, name, gateway_ws_url, token_hint, agent_id, session_key, http_port,
           ai_provider, ai_provider_url, ai_provider_key_hint, ai_model, created_at
    FROM adapter_nodes ORDER BY created_at ASC
  `).all();
}

export function getAdapterNode(id) {
  return sqlite.prepare('SELECT * FROM adapter_nodes WHERE id = ?').get(id);
}

function nextPort() {
  const row = sqlite.prepare('SELECT MAX(http_port) AS max FROM adapter_nodes').get();
  return (row?.max || 3009) + 1;
}

export function createAdapterNode({ name, gatewayWsUrl, token, agentId, sessionKey, aiProvider, aiProviderUrl, aiProviderKey, aiModel }) {
  const id = randomUUID();
  const now = nowIso();
  const provider = aiProvider || 'openclaw';
  const tokenEncrypted = token ? encrypt(token) : null;
  const tokenHint = token ? makeTokenHint(token) : null;
  const keyEncrypted = aiProviderKey ? encrypt(aiProviderKey) : null;
  const keyHint = aiProviderKey ? makeTokenHint(aiProviderKey) : null;
  const httpPort = nextPort();
  sqlite.prepare(`
    INSERT INTO adapter_nodes (id, name, gateway_ws_url, token_encrypted, token_hint, agent_id, session_key, http_port,
                               ai_provider, ai_provider_url, ai_provider_key_encrypted, ai_provider_key_hint, ai_model,
                               created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, gatewayWsUrl || 'ws://127.0.0.1:18789', tokenEncrypted, tokenHint,
         agentId || 'main', sessionKey || `agent:${agentId || 'main'}:${agentId || 'main'}`, httpPort,
         provider, aiProviderUrl || null, keyEncrypted, keyHint, aiModel || null, now, now);
  return id;
}

export function updateAdapterNode(id, { name, gatewayWsUrl, token, agentId, sessionKey, httpPort, aiProvider, aiProviderUrl, aiProviderKey, aiModel }) {
  const now = nowIso();
  const existing = getAdapterNode(id);
  if (!existing) return;
  const tokenEncrypted = token ? encrypt(token) : existing.token_encrypted;
  const tokenHint = token ? makeTokenHint(token) : existing.token_hint;
  const keyEncrypted = aiProviderKey ? encrypt(aiProviderKey) : existing.ai_provider_key_encrypted;
  const keyHint = aiProviderKey ? makeTokenHint(aiProviderKey) : existing.ai_provider_key_hint;
  sqlite.prepare(`
    UPDATE adapter_nodes SET name=?, gateway_ws_url=?, token_encrypted=?, token_hint=?,
      agent_id=?, session_key=?, http_port=?,
      ai_provider=?, ai_provider_url=?, ai_provider_key_encrypted=?, ai_provider_key_hint=?, ai_model=?,
      updated_at=?
    WHERE id=?
  `).run(name || existing.name, gatewayWsUrl || existing.gateway_ws_url,
         tokenEncrypted, tokenHint, agentId || existing.agent_id,
         sessionKey || existing.session_key, httpPort || existing.http_port,
         aiProvider || existing.ai_provider, aiProviderUrl ?? existing.ai_provider_url,
         keyEncrypted, keyHint, aiModel ?? existing.ai_model, now, id);
}

export function getAdapterProviderKey(id) {
  const row = sqlite.prepare('SELECT ai_provider_key_encrypted FROM adapter_nodes WHERE id = ?').get(id);
  if (!row?.ai_provider_key_encrypted) return null;
  try { return decrypt(row.ai_provider_key_encrypted); } catch { return null; }
}

export function deleteAdapterNode(id) {
  sqlite.prepare('UPDATE relay_nodes SET adapter_node_id = NULL WHERE adapter_node_id = ?').run(id);
  sqlite.prepare('DELETE FROM adapter_nodes WHERE id = ?').run(id);
}

export function getAdapterToken(id) {
  const row = sqlite.prepare('SELECT token_encrypted FROM adapter_nodes WHERE id = ?').get(id);
  if (!row?.token_encrypted) return null;
  try { return decrypt(row.token_encrypted); } catch { return null; }
}
