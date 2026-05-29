// tg-bot config — env-driven. 0-key / 0-custody (J1 S5 guard): bot holds NO kaspa key.
// Owner 5/29 v1.3 §8: bot = broker X 的电报脸 (env BROKER_RELAY_ID). bot 命令 broker relay
// 做服务, 但私钥留在 relay, bot 自己 0 持钥. 价值步一律 deep-link Console/relay 让用户自己签.
export const CONFIG = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  botUsername: process.env.TELEGRAM_BOT_USERNAME || 'KANET_Broker_bot',
  brokerRelayId: process.env.BROKER_RELAY_ID || '',          // = broker X identity (relay_nodes.id). Owner 配.
  consoleUrl: process.env.CONSOLE_URL || 'http://127.0.0.1:3200',
  ingestSecret: process.env.INGEST_SECRET || '',             // x-ingest-secret on S1/S2 endpoints
  pollMs: parseInt(process.env.TG_POLL_MS || '30000', 10),   // S1 notification poller cadence
  network: process.env.KASPA_NETWORK || 'testnet-12',
};

// Returns list of missing required env vars (empty = ok to start).
export function missingConfig() {
  const need = { TELEGRAM_BOT_TOKEN: CONFIG.botToken, BROKER_RELAY_ID: CONFIG.brokerRelayId, INGEST_SECRET: CONFIG.ingestSecret };
  return Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
}
