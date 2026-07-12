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
  // 查漏补缺(2026-07-04): 没有硬编码 fallback(之前默认值是 Owner 真实 chat id, PII 泄露风险——
  // 本文件进 git history, 面向公开仓库不合适)。未配置时 owner-bot.mjs 已有优雅降级(bridge OFF, 见
  // 该文件 L57/L62), 所以留空不会崩, 只是 bridge 不启用。真实值移到 gitignored 的 kanet.env。
  ownerChatId: process.env.OWNER_CHAT_ID || '',
  ownerBridgePollMs: parseInt(process.env.OWNER_BRIDGE_POLL_MS || '10000', 10), // dev-coord → Owner cadence
  // 用户反馈通道卡A 续卡(2026-07-12): Direction C 独立轮询源 cadence, 与 Direction B 分开调不耦合两者.
  feedbackEscalationPollMs: parseInt(process.env.FEEDBACK_ESCALATION_POLL_MS || '15000', 10),
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

// 根治(2026-07-08, Owner "找根治问题" 指令): bot 之前完全信任 TELEGRAM_BOT_USERNAME env var 自报的
// 用户名(CONFIG.botUsername 静态值, 从没验过跟 bot_token 是不是真的对应同一个 bot)——env 配错/过期,
// 分享链接就指向一个完全不同的 bot(实况: Owner 转的真实用户会话暴露此坑, 链接打不开)。根治 = 用
// Telegram 自己的 getMe API(唯一权威源, 传 bot_token 拿它自己认的 username, 不是"猜"或"配置")校验。
// 调用一次即可(username 跟 token 绑定固定不会变), 在 startBot() 里、真正开始服务用户前调用, 成功则
// 覆写 CONFIG.botUsername(所有现有读取点——bot.mjs/messages.mjs/prediction-menu.mjs 全部只读这个
// 属性, 零改动自动拿到校验后的真值)。getMe 失败(网络/token 无效)→ 保留 env fallback 值 + LOUD warn,
// 不阻断启动(bot 仍可能可用, 只是分享链接可能错——比硬失败更接近"诚实降级"这个既有原则)。
export async function verifyAndSyncBotUsername() {
  if (!CONFIG.botToken) { console.warn('[config] verifyAndSyncBotUsername: botToken 未配置, 跳过 getMe 校验'); return; }
  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.botToken}/getMe`, { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    const realUsername = j?.result?.username;
    if (!j?.ok || !realUsername) { console.warn(`[config] getMe 返回异常(不校验, 沿用 env 值 @${CONFIG.botUsername}): ${JSON.stringify(j).slice(0, 200)}`); return; }
    if (realUsername !== CONFIG.botUsername) {
      console.warn(`[config] 🔴 TELEGRAM_BOT_USERNAME 配错! env=@${CONFIG.botUsername} 但 getMe 真值=@${realUsername} — 已自动纠正(所有分享链接/消息现在用真值)`);
      CONFIG.botUsername = realUsername;
    } else {
      console.log(`[config] getMe 校验通过: @${CONFIG.botUsername} 确实是这个 bot_token 对应的 bot`);
    }
  } catch (e) {
    console.warn(`[config] getMe 调用失败(网络/超时, 沿用 env 值 @${CONFIG.botUsername}, 不阻断启动): ${e.message}`);
  }
}

// BROKER_RELAY_ID is NOT a hard env requirement anymore (resolved at runtime from DB config/env).
export function missingConfig() {
  const need = { TELEGRAM_BOT_TOKEN: CONFIG.botToken, INGEST_SECRET: CONFIG.ingestSecret };
  return Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
}
