// Owner bot (grammY) — the Owner's DEDICATED dev-coord remote-control bot (owner-in-dev-channel).
// SEPARATE process + token from the broker bot (KANET_Broker_bot): no /bet /link /faucet, no broker
// functions — only the Owner ↔ dev-coord bridge. Owner 钦定 "两个独立电报面": broker 面 (user-facing) vs
// owner 面 (this — owner remote-controls the dev team, mirrors the Claude Code UI over Telegram DM).
//
// 0-custody pure messaging (no kaspa key, no value): identity anchors on the owner-classified ADDRESS
// (resolveOwnerVoiceRelayId → the relay whose address is identities.trust_level='owner'), the same anchor
// the chat.js L195 firewall OR-clause uses. Two directions:
//   A) Owner DM → dev-coord: post '[Owner] <text>' via the owner-voice relay (firewall lets it through).
//   B) dev-coord → Owner DM: poll new dev-coord messages, push compact "<sender>: <text>" to the Owner.
import { Bot } from 'grammy';
import { CONFIG, resolveOwnerVoiceRelayId } from './config.mjs';
import { postOwnerMessageToDevCoord, devCoordMessagesSince } from './console-api.mjs';

if (!CONFIG.ownerBotToken) {
  console.error('[owner-bot] OWNER_BOT_TOKEN not set — owner bot cannot start (Owner: @BotFather → /newbot → set OWNER_BOT_TOKEN).');
  process.exit(1);
}
const bot = new Bot(CONFIG.ownerBotToken);

bot.command('start', (ctx) => ctx.reply('Owner ↔ dev-coord 桥已就绪。\n· 直接发文字 → 以 owner 身份转到 dev-coord\n· 团队在 dev-coord 的消息会推到这里\n（你专属，其他人发这个 bot 无效）'));

// Direction A: Owner DM → dev-coord. Gated on ownerChatId (only the Owner's chat bridges; any other
// chat is ignored — this bot is the Owner's alone). Plain text only (commands skipped). Pure messaging.
bot.on('message:text', async (ctx) => {
  const tgUser = String(ctx.from.id);
  const txt = ctx.message?.text || '';
  if (txt.startsWith('/')) return;                         // commands handled by bot.command
  if (tgUser !== String(CONFIG.ownerChatId)) return;       // only the Owner's chat is bridged
  const ownerRelayId = await resolveOwnerVoiceRelayId();
  if (!ownerRelayId) {
    return ctx.reply('⚠ 还没有地址被分类为 trust_level=owner。在 Console /identities 把你的地址设为 owner 后，这里发的话才会以 owner 身份进 dev-coord。');
  }
  const r = await postOwnerMessageToDevCoord(ownerRelayId, '[Owner] ' + txt);
  if (r.ok && r.json?.txId) return ctx.reply('✓ 已发到 dev-coord');
  return ctx.reply('⚠ 转发 dev-coord 失败: ' + (r.json?.error || r.json?.detail || r.status));
});

// Direction B: dev-coord → Owner DM poller. Cursor starts at "now" (no history replay); advances to the
// newest seen (dedup). Skips '[Owner] …' messages (loop guard — never echo the Owner's own bridged text).
let _cursor = new Date().toISOString();
async function pollDevCoord() {
  const r = await devCoordMessagesSince(_cursor, 50);
  if (!r.ok) return;
  for (const m of r.messages) {
    if (m.created_at && m.created_at > _cursor) _cursor = m.created_at;   // advance first so a send failure doesn't replay
    const text = m.content || '';
    if (text.startsWith('[Owner]')) continue;                            // loop guard
    const sender = (m.sender_address ? String(m.sender_address).slice(-8) : 'dev');
    try { await bot.api.sendMessage(CONFIG.ownerChatId, `${sender}: ${text}`); } catch {}
  }
}

// Runtime side-effects live in startOwnerBot() so importing this module (e.g. a test) registers the
// handlers WITHOUT going live. _launch_owner_bot.mjs calls startOwnerBot(); tests import { bot }.
export function startOwnerBot() {
  if (CONFIG.ownerChatId) {
    const t = setInterval(() => { pollDevCoord().catch(() => {}); }, CONFIG.ownerBridgePollMs);
    if (typeof t.unref === 'function') t.unref();
  }
  bot.start();
  console.log('[owner-bot] up — Owner dev-coord bridge (chat=' + CONFIG.ownerChatId + ', Direction B poller ' + (CONFIG.ownerChatId ? 'on' : 'OFF — OWNER_CHAT_ID unset') + ')');
}

export { bot };
