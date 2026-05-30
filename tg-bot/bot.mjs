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

// linked users for the reactive notification poller (tg_user -> { address, lastTs }).
// Bettor r63 P0 fix: link store 持久化已迁到 prediction-menu._state.json (getLinkedAddr/setLinkedAddr).
// 这个 Map 仍维护 lastTs 用于 poller cursor (= ephemeral, 重启 = 重新从最近开始 poll 即可, 不丢钱).
const linked = new Map();

bot.command('start', (ctx) => { PM.exitBetFlow(String(ctx.from.id)); return ctx.reply(M.startMessage()); });
bot.command('help', (ctx) => ctx.reply(M.help()));

bot.command('link', async (ctx) => {
  const addr = (ctx.match || '').trim();
  if (!/^kaspatest:[a-z0-9]+$/.test(addr)) return ctx.reply('用法: /link <你的 kaspatest 地址>');
  const tgUser = String(ctx.from.id);
  const r = await api.linkBind(addr, tgUser);
  if (!r.ok || !r.json?.linked) return ctx.reply('绑定失败: ' + (r.json?.error || r.status));
  PM.setLinkedAddr(tgUser, addr);  // Bettor r63 ① 持久化 — 抗 bot 重启
  linked.set(tgUser, { address: addr, lastTs: Date.now() });  // poller cursor (= 重启可重置)
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
    // Bettor r63 ①: 优先从持久 link store 取 (= 抗 bot 重启), in-mem 退化 fallback.
    const reply = await PM.handleReply(tgUser, txt, PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address);
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
    // Bettor r63 ② guard: pending 缺 linkedAddr (= 老历史 pending in v0 in-mem 丢的) → 反馈用户而非 silent poll.
    if (!p.linkedAddr) {
      PM.clearPendingPayment(p.tgUser);
      try { await bot.api.sendMessage(p.tgUser, '⚠ 这笔押注单异常: 缺绑定地址 (bot 旧版会话丢失). 押注未成立, 也不会自动确认。请先 /link <kaspatest 地址>, 再 /bet 重新走完整流程。\n(若已付款到上次显示的地址, 押注无法挽回 — 别再付了。)'); } catch {}
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
    } else if (!r.ok && typeof j.error === 'string' && /linked.addr|linkedAddr/i.test(j.error)) {
      // Bettor r63 ③ 不静默: confirm 端硬错 (linked_addr 缺/无效) → 通知用户重 /link, 停盯.
      PM.clearPendingPayment(p.tgUser);
      try { await bot.api.sendMessage(p.tgUser, `⚠ 押注单异常 (后端: ${j.error})。\n请先 /link <kaspatest 地址> 重新绑定, 再 /bet 重走流程。\n(此前显示的付款地址若已付, 押注无法挽回 — 别再付了。)`); } catch {}
    }
    // else (pending / not ok / soft fail): payment not yet detected — keep polling silently.
  }
}
setInterval(() => { pollPendingBets().catch(() => {}); }, CONFIG.pollMs);

// Bettor r71 ① — settle-result poller: 每 link'd 用户的所有 positions, 检测结算/退款后通知.
// 0-custody: read-only my-positions; 不签不付. 跨重启幂等 (seen_settled 持久化 _state.json).
async function pollSettleResults() {
  for (const u of PM.listLinkedUsers()) {
    try {
      const r = await api.myPositions(u.address);
      if (!r.ok) continue;
      const positions = r.json?.positions || [];
      // 终态: settle_txid 已写 (= settled) OR refund_txid 已写 (= refunded).
      const terminal = positions.filter(p => p.settle_txid || p.refund_txid);
      if (terminal.length === 0) continue;
      const fresh = PM.pickFreshSettlements(u.tgUser, terminal.map(p => p.market_id));
      if (fresh.length === 0) continue;
      for (const marketId of fresh) {
        const p = terminal.find(x => x.market_id === marketId);
        if (!p) continue;
        let msg;
        if (p.settle_txid) {
          // settled — find winning side via outcome_side from market detail or my position info
          // my_side = my position direction (YES/NO). To know if I won: compare with the market's
          // settled outcome. v0.5 settled outcome can be inferred by checking pool_markets.outcome_side
          // OR by checking whether claim_txid exists for my position (= my P2SH was claimed = I won).
          // Simplest signal: payout_if_win > stake = my side was winner (calc valid). But this is
          // pre-settle estimate. Post-settle, claim_txid presence is the deterministic signal.
          const claimed = !!p.claim_txid;
          msg = claimed
            ? `🎉 [${p.question || p.market_id}]\n你赢了! ${p.my_side} · 押注 ${p.stake_kas} KAS → 已到账 (claim TX: ${p.claim_txid.slice(0,16)}...)`
            : `📊 [${p.question || p.market_id}] 已结算\n你的押注: ${p.my_side} · ${p.stake_kas} KAS · 结算 TX ${p.settle_txid.slice(0,16)}...\n用绑定地址的钱包检查到账 (赢家由 settle_via_spine 直发到地址).`;
        } else if (p.refund_txid) {
          msg = `💸 [${p.question || p.market_id}] 已退款\n市场取消/分歧, 退款 TX: ${p.refund_txid.slice(0,16)}...\n你的押注退回到绑定地址.`;
        }
        if (msg) { try { await bot.api.sendMessage(u.tgUser, msg); } catch {} }
      }
    } catch {}
  }
}
setInterval(() => { pollSettleResults().catch(() => {}); }, CONFIG.pollMs);

bot.start();
console.log('[tg-bot] @' + CONFIG.botUsername + ' up (broker=' + (brokerRelayId || 'UNSET — set in Console Settings') + ', 0-key / deep-link only)');
