// TG bot service (grammY) — broker X 的电报前端 (Owner v1.3 §8). J1 S5: 0-key, read + deep-link only.
// 价值/信任步 NEVER executed here; bot deep-links the USER to Console/relay to act + pay on-chain.
// Run:  TELEGRAM_BOT_TOKEN=.. BROKER_RELAY_ID=.. INGEST_SECRET=.. node tg-bot/bot.mjs
import { Bot } from 'grammy';
import { CONFIG, missingConfig, resolveBrokerRelayId } from './config.mjs';
import * as api from './console-api.mjs';
import * as M from './messages.mjs';
import * as PM from './prediction-menu.mjs';

const missing = missingConfig();
if (missing.length) { console.error('[tg-bot] missing env:', missing.join(', ')); process.exit(1); }

const bot = new Bot(CONFIG.botToken);

// broker X identity — resolved from UI/DB config (Owner sets in Console Settings, 0-restart),
// refreshed periodically so a UI change takes effect live. env BROKER_RELAY_ID is fallback only.
let brokerRelayId = await resolveBrokerRelayId();
if (!brokerRelayId) console.warn('[tg-bot] no broker configured — set it in Console Settings → Telegram Bot Broker');
setInterval(async () => { brokerRelayId = await resolveBrokerRelayId(); }, CONFIG.brokerRefreshMs);

// linked users for the reactive notification poller (tg_user -> {address, lastTs}); in-mem v0.
// /link binds directly — r275 全砍共识 (Bettor r277): no signature challenge (paying FROM an address
// proves control; PoolSide claim needs the real key, so nonce/verify were redundant). Betting auth =
// on-chain from-addr check at register-external/confirm.
const linked = new Map();

bot.command('start', (ctx) => { PM.exitBetFlow(String(ctx.from.id)); return ctx.reply(M.startMessage()); });
bot.command('help', (ctx) => ctx.reply(M.help()));

bot.command('link', async (ctx) => {
  const addr = (ctx.match || '').trim();
  if (!/^kaspatest:[a-z0-9]+$/.test(addr)) return ctx.reply('用法: /link <你的 kaspatest 地址>');
  const tgUser = String(ctx.from.id);
  const r = await api.linkBind(addr, tgUser);
  if (!r.ok || !r.json?.linked) return ctx.reply('绑定失败: ' + (r.json?.error || r.status));
  linked.set(tgUser, { address: addr, lastTs: Date.now() });
  return ctx.reply('✅ 已绑定 ' + addr + '。\n这个地址有链上动态会通知你。\n/bet 开始押注。');
});

// /verify 已废弃 (r275 砍签名挑战). 老用户可能还按旧习惯发, 友好重定向到 /link。
bot.command('verify', (ctx) => ctx.reply('用 /link <你的 kaspatest 地址> 绑定即可。/bet 开始押注。'));

bot.command('swap', async (ctx) => { const broker = await api.brokerInfo(brokerRelayId); return ctx.reply(M.swapFlow(broker)); });
bot.command('bet',  async (ctx) => ctx.reply(await PM.startBet(String(ctx.from.id))));  // S-C: in-chat 编号菜单
bot.command('discover', (ctx) => ctx.reply('浏览:\n' + CONFIG.consoleUrl + '/exchange\n' + CONFIG.consoleUrl + '/predictions'));

// S-C menu navigation — plain-text numeric replies advance the bet flow (commands handled above).
bot.on('message:text', async (ctx) => {
  const tgUser = String(ctx.from.id);
  const txt = ctx.message?.text || '';
  if (txt.startsWith('/')) return;            // commands handled by bot.command
  if (PM.inBetFlow(tgUser)) {
    const reply = await PM.handleReply(tgUser, txt, linked.get(tgUser)?.address);
    if (reply) await ctx.reply(reply);
    return;
  }
  // Bettor r8 即时止血: 用户输看似押注续单的词 (确认/yes/纯数字), 但本地已无 bet 流程态
  // (bot 重启 / 会话超时), 明示而非甩裸菜单, 避免用户以为「确认」生效付了钱。
  const t = (txt || '').trim().toLowerCase();
  if (t === '确认' || t === 'yes' || t === 'y' || /^[0-9]+$/.test(t)) {
    return ctx.reply('⌛ 这句像是回前次押注流程的话, 但本地会话已不存在(bot 重启或会话过期)。\n之前那笔押注没续上, 也没启动付款监控。请重新 /bet 走一遍。');
  }
  await ctx.reply('用 /help 看命令 · /bet 押注 · /swap 兑换 · /link 绑定地址');
});

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

// S-C stage5 — poll backend confirm for users awaiting on-chain bet payment (design LOCKED Bettor r263).
// confirm runs server-side 3-validation (dest==side_p2sh + amount==exact_sompi + UNIQUE tx) → insert pool_bettor_sides.
// 0-custody: bot only reports + notifies; it never moves funds. Stops watching past the market deadline.
async function pollPendingBets() {
  const nowSec = Date.now() / 1000;
  for (const p of PM.listPendingPayments()) {
    if (p.deadline && nowSec > p.deadline) {
      PM.clearPendingPayment(p.tgUser);
      try { await bot.api.sendMessage(p.tgUser, '⌛ 市场已截止, 停止盯付款。若你已付款会照常入账/结算。'); } catch {}
      continue;
    }
    const r = await api.poolRegisterConfirm(p.marketId, { linkedAddr: p.linkedAddr, direction: p.direction, stakeKas: p.stakeKas });
    const j = r.json || {};
    if (r.ok && (j.registered || j.already_registered || j.side_lock_tx || j.merkle_index != null)) {
      PM.clearPendingPayment(p.tgUser);
      try { await bot.api.sendMessage(p.tgUser, `✅ 押注已入账! ${p.side} · ${(p.exact_sompi / 1e8).toFixed(8)} KAS\n市场: ${p.question}\n链上到账检测成功, side 已锁仓。结算后用绑定地址领取。`); } catch {}
    } else if (j.wrong_payment_detected) {
      // 错付被检测到 — 金额不符无法入账, 且少付会被合约永久锁死 (J2/Bettor 裁决). 诚实披露, 停止盯。
      PM.clearPendingPayment(p.tgUser);
      try { await bot.api.sendMessage(p.tgUser, `⚠ 检测到一笔金额不符的付款到该地址。\n按合约规则, 金额不符的付款无法被正确入账, 且【少付会被永久锁死、无法退回】。\n你的押注未成立。请勿再向此地址付款 (重复付款同样无法挽回)。`); } catch {}
    }
    // else (pending / not ok): payment not yet detected — keep polling silently.
  }
}
setInterval(() => { pollPendingBets().catch(() => {}); }, CONFIG.pollMs);

bot.start();
console.log('[tg-bot] @' + CONFIG.botUsername + ' up (broker=' + (brokerRelayId || 'UNSET — set in Console Settings') + ', 0-key / deep-link only)');
