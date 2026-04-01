#!/usr/bin/env node
/**
 * dump-launch.mjs
 * Reads and decrypts all relay/adapter configs from the console DB.
 * Outputs a single JSON object to stdout.
 * Requires: CONSOLE_ENCRYPTION_KEY in env, run from kasia-console root.
 */
import Database from 'better-sqlite3';
import { createDecipheriv } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'console.db');

const hexKey = process.env.CONSOLE_ENCRYPTION_KEY;
if (!hexKey || hexKey.length !== 64) {
  console.error('CONSOLE_ENCRYPTION_KEY not set or invalid');
  process.exit(1);
}
const key = Buffer.from(hexKey, 'hex');

function decrypt(envelope) {
  if (!envelope) return null;
  try {
    const { iv, tag, ciphertext } = JSON.parse(envelope);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return decipher.update(Buffer.from(ciphertext, 'base64')) + decipher.final('utf8');
  } catch {
    return null;
  }
}

function decryptPlainOrEnc(value) {
  // Some fields store plain value (non-sensitive) in value_encrypted column
  if (!value) return null;
  try { JSON.parse(value); return decrypt(value); } catch { return value; }
}

const db = new Database(DB_PATH, { readonly: true });

// ingest_secret
const secretRow = db.prepare("SELECT value_encrypted FROM config_entries WHERE key = 'ingest_secret'").get();
const ingestSecret = secretRow ? decrypt(secretRow.value_encrypted) : null;

// adapters
const adapterRows = db.prepare(
  `SELECT id, name, gateway_ws_url, token_encrypted, agent_id, session_key, http_port,
          ai_provider, ai_provider_url, ai_provider_key_encrypted, ai_model
   FROM adapter_nodes ORDER BY created_at ASC`
).all();

const adapters = adapterRows.map(a => ({
  id: a.id,
  name: a.name,
  gatewayWsUrl: a.gateway_ws_url,
  token: decrypt(a.token_encrypted),
  agentId: a.agent_id,
  sessionKey: a.session_key || `agent:${a.agent_id}:${a.agent_id}`,
  httpPort: a.http_port,
  aiProvider: a.ai_provider || 'openclaw',
  aiProviderUrl: a.ai_provider_url || null,
  aiProviderKey: decrypt(a.ai_provider_key_encrypted),
  aiModel: a.ai_model || null,
}));

// relays
const relayRows = db.prepare(
  `SELECT r.id, r.name, r.mnemonic_encrypted, r.address, r.network, r.poll_ms,
          r.adapter_node_id, a.http_port AS adapter_port
   FROM relay_nodes r
   LEFT JOIN adapter_nodes a ON a.id = r.adapter_node_id
   ORDER BY r.created_at ASC`
).all();

const relays = relayRows.map(r => ({
  id: r.id,
  name: r.name,
  mnemonic: decrypt(r.mnemonic_encrypted),
  address: r.address,
  network: r.network,
  pollMs: r.poll_ms,
  adapterNodeId: r.adapter_node_id,
  adapterPort: r.adapter_port,
}));

db.close();

console.log(JSON.stringify({ ingestSecret, adapters, relays }, null, 2));
