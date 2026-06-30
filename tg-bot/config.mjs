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
  pendingBetPollMs: parseInt(process.env.TG_PENDING_BET_POLL_MS || '3000', 10),  // #28: pending custodial bet poll — fast (3s) to stay within DEFRAG_MIN_DEPTH protection window
  brokerRefreshMs: parseInt(process.env.TG_BROKER_REFRESH_MS || '60000', 10), // re-read broker config
  network: process.env.KASPA_NETWORK || 'testnet-12',
  // owner-in-dev-channel bridge (pure messaging / 0-custody). Runs in a SEPARATE owner bot process
  // (owner-bot.mjs), NOT the broker bot — Owner 钦定 两个独立电报面. ownerBotToken = the dedicated owner
  // bot's @BotFather token (own bot, own getUpdates → no 409 with the broker bot). ownerChatId = the
  // Owner's Telegram chat id (gate: only plain text from this chat bridges to dev-coord). The "Owner voice"
  // relay is NOT configured here — resolved at runtime from the owner-classified address
  // (resolveOwnerVoiceRelayId below), so re-anchoring the address in /identities takes effect with no
  // restart, no env edit (mirrors resolveBrokerRelayId's DB-config-first design).
  ownerBotToken: process.env.OWNER_BOT_TOKEN || '',
  ownerChatId: process.env.OWNER_CHAT_ID || '1437320734',
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

// Resolve the "Owner voice" relay for the owner-in-dev-channel bridge — the relay whose ADDRESS is
// classified trust_level='owner' (Console /api/chat/owner-voice). Returns the relay id, or '' if no
// address is classified 'owner' yet (bridge Direction A then no-ops — never errors). Re-resolved per
// use so re-classifying in /identities takes effect with no bot restart (mirrors resolveBrokerRelayId).
export async function resolveOwnerVoiceRelayId() {
  try {
    const res = await fetch(`${CONFIG.consoleUrl}/api/chat/owner-voice`, { signal: AbortSignal.timeout(5000) });
    const j = await res.json();
    if (j && j.ownerVoice && j.ownerVoice.id) return j.ownerVoice.id;
  } catch { /* Console unreachable — bridge skips this tick */ }
  return '';
}

// BROKER_RELAY_ID is NOT a hard env requirement anymore (resolved at runtime from DB config/env).
export function missingConfig() {
  const need = { TELEGRAM_BOT_TOKEN: CONFIG.botToken, INGEST_SECRET: CONFIG.ingestSecret };
  return Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
}
