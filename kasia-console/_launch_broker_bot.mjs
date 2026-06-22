// Per-broker TG bot launcher — forked by src/services/broker-bot-manager.js (one process per
// approved external broker, so each @BotFather token has exactly one grammy poller → no 409 Conflict).
// The per-broker token + broker identity are passed via fork ENV by the manager (manager decrypts the
// token from broker_onboarding.bot_token_encrypted in-process). This launcher inherits the Console's
// CONSOLE_ENCRYPTION_KEY (forked child) so it can decrypt the shared ingest_secret in-process.
// NEVER prints the token. Run (manager only): node _launch_broker_bot.mjs
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.log('[broker-bot launch] no TELEGRAM_BOT_TOKEN in fork env — abort');
  process.exit(1);
}

// ingest_secret is the shared S1/S2 x-ingest-secret (same for all bots); decrypt via inherited key.
let ingest = '';
try {
  const { getConfig } = await import('./src/data/settings/configs.js');
  ingest = (await getConfig('ingest_secret')) || '';
} catch (e) {
  console.log('[broker-bot launch] ingest_secret decrypt failed: ' + e.message);
}

process.env.INGEST_SECRET = ingest;
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'KANET_Broker_bot';
process.env.CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3200';
process.env.KASPA_NETWORK = process.env.KASPA_NETWORK || 'testnet-12';

console.log('[broker-bot launch] broker=' + (process.env.BROKER_ADDRESS || '?').slice(-12) +
            ' username=' + process.env.TELEGRAM_BOT_USERNAME +
            ' token=set ingest_secret=' + (ingest ? 'resolved' : 'MISSING') + ' console=' + process.env.CONSOLE_URL);

// bot.mjs creates the grammy Bot from process.env.TELEGRAM_BOT_TOKEN at import; startBot() goes live.
// Each forked process = its own module graph = its own Bot/token/poller (no cross-bot 409).
const { startBot } = await import('../tg-bot/bot.mjs');
startBot();
