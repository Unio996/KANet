// tg-bot config — env-driven. 0-key / 0-custody (J1 S5 guard): bot holds NO kaspa key.
// Owner 5/29 v1.3 §8: bot = broker X 的电报脸. broker X 身份 = UI-settable DB config
// (Settings 页选 broker, 0-restart 即时生效), env BROKER_RELAY_ID 仅作 fallback.
export const CONFIG = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  botUsername: process.env.TELEGRAM_BOT_USERNAME || 'KANET_Broker_bot',
  brokerRelayIdEnv: process.env.BROKER_RELAY_ID || '',       // fallback only; prefer DB config below
  consoleUrl: process.env.CONSOLE_URL || 'http://127.0.0.1:3200',
  ingestSecret: process.env.INGEST_SECRET || '',            // x-ingest-secret on S1/S2 endpoints
  pollMs: parseInt(process.env.TG_POLL_MS || '30000', 10),  // S1 notification poller cadence
  brokerRefreshMs: parseInt(process.env.TG_BROKER_REFRESH_MS || '60000', 10), // re-read broker config
  network: process.env.KASPA_NETWORK || 'testnet-12',
  // owner-in-dev-channel bridge (pure messaging, 0-custody). Owner's Telegram chat id is the
  // gate: only plain text from this chat is bridged to dev-coord-testnet. OWNER_RELAY_ID is the
  // "Owner voice" relay that posts to dev-coord; unset → post-direction no-ops (Direction A skipped).
  ownerChatId: process.env.OWNER_CHAT_ID || '1437320734',
  ownerRelayId: process.env.OWNER_RELAY_ID || '',
  ownerBridgePollMs: parseInt(process.env.OWNER_BRIDGE_POLL_MS || '10000', 10), // dev-coord → Owner cadence
};

// Resolve which broker the bot represents — prefer UI/DB config (Owner sets it in Settings,
// changeable without restart), fall back to env BROKER_RELAY_ID. Returns '' if neither set.
export async function resolveBrokerRelayId() {
  try {
    const res = await fetch(`${CONFIG.consoleUrl}/api/config/tg-bot-broker`, { signal: AbortSignal.timeout(5000) });
    const j = await res.json();
    if (j && j.broker_relay_id) return j.broker_relay_id;
  } catch { /* Console unreachable — use env fallback */ }
  return CONFIG.brokerRelayIdEnv;
}

// BROKER_RELAY_ID is NOT a hard env requirement anymore (resolved at runtime from DB config/env).
export function missingConfig() {
  const need = { TELEGRAM_BOT_TOKEN: CONFIG.botToken, INGEST_SECRET: CONFIG.ingestSecret };
  return Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
}
