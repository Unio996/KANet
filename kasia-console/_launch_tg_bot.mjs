// TG bot launcher (started by kanet-start.sh for 24/7 常驻; Owner r238/钦定 常驻).
// Run from kasia-console CWD: node _launch_tg_bot.mjs
// Reads kanet.env for token + encryption key, decrypts ingest_secret in-process (never prints secrets),
// sets the bot env, then starts tg-bot/bot.mjs. broker resolves from UI/DB config at runtime;
// BROKER_RELAY_ID env here is the fallback (broker-1) until the config endpoint is deployed.
import { readFileSync } from 'node:fs';

const envText = readFileSync('../kanet.env', 'utf8');
const kv = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) kv[m[1]] = m[2].trim();
}

// CONSOLE_ENCRYPTION_KEY needed so getConfig can decrypt the sensitive ingest_secret.
process.env.CONSOLE_ENCRYPTION_KEY = kv.CONSOLE_ENCRYPTION_KEY || '';
const { getConfig } = await import('./src/data/settings/configs.js');
const ingest = await getConfig('ingest_secret');

process.env.TELEGRAM_BOT_TOKEN = kv.TELEGRAM_BOT_TOKEN || '';
process.env.TELEGRAM_BOT_USERNAME = kv.TELEGRAM_BOT_USERNAME || 'KANET_Broker_bot';
process.env.INGEST_SECRET = ingest || '';
process.env.BROKER_RELAY_ID = '15593e10-fe63-4806-a7b5-cae062699de8'; // broker-1 (env fallback per Bettor r238)
process.env.CONSOLE_URL = 'http://127.0.0.1:3200';
process.env.KASPA_NETWORK = 'testnet-12';

console.log('[launch] token=' + (kv.TELEGRAM_BOT_TOKEN ? 'set' : 'MISSING') +
            ' ingest_secret=' + (ingest ? 'resolved' : 'MISSING') +
            ' broker=15593e10(broker-1) console=:3200');

await import('../tg-bot/bot.mjs'); // starts the bot (grammy bot.start)
