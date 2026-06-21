// Owner bot launcher — the Owner's DEDICATED dev-coord remote-control bot (owner-in-dev-channel).
// SEPARATE process + token from the broker bot (_launch_tg_bot.mjs). Run from kasia-console CWD:
//   node _launch_owner_bot.mjs
// Reads kanet.env for OWNER_BOT_TOKEN (+ optional OWNER_CHAT_ID override) and decrypts ingest_secret
// in-process (never prints secrets). No-ops with a clear message if OWNER_BOT_TOKEN is unset (Owner has
// not run @BotFather yet) — so kanet-start.sh can launch it unconditionally without crashing.
import { readFileSync } from 'node:fs';

const envText = readFileSync('../kanet.env', 'utf8');
const kv = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) kv[m[1]] = m[2].trim();
}

if (!kv.OWNER_BOT_TOKEN) {
  console.log('[owner-bot launch] OWNER_BOT_TOKEN not in kanet.env — owner bot not started (Owner: @BotFather → /newbot → add OWNER_BOT_TOKEN to kanet.env, then restart).');
  process.exit(0);
}

process.env.CONSOLE_ENCRYPTION_KEY = kv.CONSOLE_ENCRYPTION_KEY || '';
const { getConfig } = await import('./src/data/settings/configs.js');
const ingest = await getConfig('ingest_secret');

process.env.OWNER_BOT_TOKEN = kv.OWNER_BOT_TOKEN || '';
if (kv.OWNER_CHAT_ID) process.env.OWNER_CHAT_ID = kv.OWNER_CHAT_ID;   // else config.mjs default
process.env.INGEST_SECRET = ingest || '';
process.env.CONSOLE_URL = 'http://127.0.0.1:3200';
process.env.KASPA_NETWORK = 'testnet-12';

console.log('[owner-bot launch] token=set ingest_secret=' + (ingest ? 'resolved' : 'MISSING') +
            ' chat=' + (kv.OWNER_CHAT_ID || '(config default)') + ' console=:3200');

const { startOwnerBot } = await import('../tg-bot/owner-bot.mjs'); // import registers handlers (no side-effects)…
startOwnerBot();                                                   // …goes live (grammy bot.start + Direction B poller)
