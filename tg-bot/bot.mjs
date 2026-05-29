// TG bot service (grammY) — broker X 的电报前端 (Owner v1.3 §8). J1 S5: 0-key, read + deep-link only.
// 价值/信任步 NEVER executed here; bot deep-links the USER to Console/relay to act + pay on-chain.
// Run:  TELEGRAM_BOT_TOKEN=.. BROKER_RELAY_ID=.. INGEST_SECRET=.. node tg-bot/bot.mjs
import { Bot } from 'grammy';
import { CONFIG, missingConfig, resolveBrokerRelayId } from './config.mjs';
import * as api from './console-api.mjs';
import * as M from './messages.mjs';

const missing = missingConfig();
if (missing.length) { console.error('[tg-bot] missing env:', missing.join(', ')); process.exit(1); }

const bot = new Bot(CONFIG.botToken);

// broker X identity — resolved from UI/DB config (Owner sets in Console Settings, 0-restart),
// refreshed periodically so a UI change takes effect live. env BROKER_RELAY_ID is fallback only.
let brokerRelayId = await resolveBrokerRelayId();
if (!brokerRelayId) console.warn('[tg-bot] no broker configured — set it in Console Settings → Telegram Bot Broker');
setInterval(async () => { brokerRelayId = await resolveBrokerRelayId(); }, CONFIG.brokerRefreshMs);

// per-user /link handshake state (tg_user -> {address, nonce}); in-mem, 5min TTL aligns Console nonce.
const pending = new Map();
// linked users for the reactive notification poller (tg_user -> {address, lastTs}); in-mem v0.
const linked = new Map();

bot.command('start', (ctx) => ctx.reply(M.startMessage()));
bot.command('help', (ctx) => ctx.reply(M.help()));

bot.command('link', async (ctx) => {
  const addr = (ctx.match || '').trim();
  if (!/^kaspatest:[a-z0-9]+$/.test(addr)) return ctx.reply('用法: /link <你的 kaspatest 地址>');
  const tgUser = String(ctx.from.id);
  const r = await api.linkNonce(addr, tgUser);
  if (!r.ok || !r.json?.nonce) return ctx.reply('绑定发起失败: ' + (r.json?.error || r.status));
  pending.set(tgUser, { address: addr, nonce: r.json.nonce });
  return ctx.reply(M.linkInstructions(r.json.nonce));
});

bot.command('verify', async (ctx) => {
  const proof = (ctx.match || '').trim();
  const tgUser = String(ctx.from.id);
  const p = pending.get(tgUser);
  if (!p) return ctx.reply('先 /link <地址> 拿 nonce。');
  if (!proof) return ctx.reply('用法: /verify <proof>');
  const r = await api.linkVerify(p.address, tgUser, p.nonce, proof);
  if (!r.ok || !r.json?.linked) return ctx.reply('校验失败: ' + (r.json?.error || r.status));
  pending.delete(tgUser);
  linked.set(tgUser, { address: p.address, lastTs: Date.now() });
  return ctx.reply('✅ 已绑定 ' + p.address + '。该地址链上事件会通知你。/help 看更多。');
});

bot.command('swap', (ctx) => { const b = M.bridge('swap'); return ctx.reply(b.note + '\n\n' + b.url); });
bot.command('bet',  (ctx) => { const b = M.bridge('bet');  return ctx.reply(b.note + '\n\n' + b.url); });
bot.command('discover', (ctx) => ctx.reply('浏览:\n' + CONFIG.consoleUrl + '/exchange\n' + CONFIG.consoleUrl + '/predictions'));

// S1 reactive notification poller — only polls addresses a user explicitly /link'd (opt-in).
async function pollLoop() {
  for (const [tgUser, st] of linked) {
    const r = await api.eventsSince(st.address, st.lastTs);
    const evs = r.json?.events || [];
    for (const ev of evs) { try { await bot.api.sendMessage(tgUser, M.notifyLine(ev)); } catch {} }
    if (evs.length) { const last = Date.parse(evs[evs.length - 1].observed_at); if (last) st.lastTs = last; }
  }
}
setInterval(() => { pollLoop().catch(() => {}); }, CONFIG.pollMs);

bot.start();
console.log('[tg-bot] @' + CONFIG.botUsername + ' up (broker=' + (brokerRelayId || 'UNSET — set in Console Settings') + ', 0-key / deep-link only)');
