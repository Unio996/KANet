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

// Bettor 2026-06-03 止血 1-2 行: Telegram URL 预览图乱码 — 关掉所有 sendMessage 的 link preview.
// 适用所有 ctx.reply / bot.api.sendMessage 不破 parse_mode 等其他选项 (transformer 仅注 link_preview_options).
bot.api.config.use(async (prev, method, payload, signal) => {
  if (method === 'sendMessage' && payload && typeof payload === 'object') {
    if (!payload.link_preview_options) payload.link_preview_options = { is_disabled: true };
    // KANet-UI (Owner r549 'tg-bot 又死了'): cap text 至 Telegram 4096 限 — 超长回复(如长菜单/
    // 错误回显)否则 Telegram 返 400 'message is too long' → 未捕获 BotError → bot 进程崩。截断兜底。
    if (typeof payload.text === 'string' && payload.text.length > 4096) {
      payload.text = payload.text.slice(0, 4080) + '\n[…内容过长已截断]';
    }
  }
  return prev(method, payload, signal);
});

// KANet-UI (Owner r549): 全局错误捕获 — 任何 handler / API 调用抛错(含 send 失败)只记日志不崩进程。
// 之前缺这个 → 一条 'message too long' 400 就把整个 bot poller 崩掉 (= Owner 'tg-bot 又死了' 第二次).
bot.catch((err) => {
  const desc = err?.error?.description || err?.message || String(err);
  console.error('[tg-bot] caught (no-crash):', desc);
});

// broker X identity — resolved from UI/DB config (Owner sets in Console Settings, 0-restart),
// refreshed periodically so a UI change takes effect live. env BROKER_RELAY_ID is fallback only.
let brokerRelayId = await resolveBrokerRelayId();
if (!brokerRelayId) console.warn('[tg-bot] no broker configured — set it in Console Settings → Telegram Bot Broker');
// broker-refresh interval moved into startBot() (below) so import doesn't poll the Console.

// linked users for the reactive notification poller (tg_user -> { address, lastTs }).
// Bettor r63 P0 fix: link store 持久化已迁到 prediction-menu._state.json (getLinkedAddr/setLinkedAddr).
// 这个 Map 仍维护 lastTs 用于 poller cursor (= ephemeral, 重启 = 重新从最近开始 poll 即可, 不丢钱).
const linked = new Map();
// gate D faucet — per-Telegram-user 24h cooldown (in-memory MVP; server guards once-per-address).
const faucetCooldown = new Map();
// KANet-UI 2026-06-23 — /send 2 步确认的 pending 暂存 (ephemeral; 重启清空 = 安全, 不会误发).
const pendingSends = new Map(); // tg_user → { to, amount, ts }

// KANet-UI 2026-06-22 (Owner 实测派修 ②): /start 查 /link 绑定 — 已绑显地址+下一步, 未绑走三步引导。
bot.command('start', async (ctx) => {
  const tgUser = String(ctx.from.id);
  PM.exitBetFlow(tgUser);
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  if (!addr) return ctx.reply(M.startMessage());
  // KANet-UI 2026-06-23 (Bettor 承重 custody 口径): custody-aware /start — 托管钱包(/wallet 生成, 节点持 key)
  // 与非托管(/link 自己地址, key 用户掌控)的警告不可一刀切。查 tg-wallet: 存在且地址==当前绑定 → 托管。
  // 查询失败 → custodial=null (显两类并存警告, 绝不假称"bot 不持 key")。
  let custodial = null;
  try {
    const w = await api.tgWalletGet(tgUser);
    if (w.ok && w.json?.ok) custodial = !!(w.json.exists && w.json.address === addr);
  } catch { /* Console 暂不可达 → null → 中性 custody 警告 */ }
  return ctx.reply(M.startMessageLinked(addr, custodial));
});
bot.command('help', (ctx) => ctx.reply(M.help()));

// KANet-UI 2026-06-23 (Owner 钦定 托管钱包·零门槛玩): /wallet 生成或查看; /balance; /receive。
// Console 侧托管(持 key/签名), bot 0-key 只调 API。/send 待 Bettor Q3 后加。NO /export (Bettor⑤)。
bot.command('wallet', async (ctx) => {
  const tgUser = String(ctx.from.id);
  const r = await api.tgWalletCreate(tgUser);
  if (!r.ok || !r.json?.ok) return ctx.reply('钱包操作失败: ' + (r.json?.error || r.status));
  if (r.json.created) {
    // 新生成: auto-link 地址(现有 /bet//broker//earnings 直接可用) + 显助记词【仅此一次】+ 醒目警告。
    PM.setLinkedAddr(tgUser, r.json.address);
    linked.set(tgUser, { address: r.json.address, lastTs: Date.now() });
    return ctx.reply(M.walletGenerated(r.json.address, r.json.mnemonic));
  }
  // 已有: 显地址+余额(永不再显助记词)
  const g = await api.tgWalletGet(tgUser);
  return ctx.reply(g.ok && g.json?.exists ? M.walletView(g.json) : ('你的钱包: ' + r.json.address));
});
bot.command('balance', async (ctx) => {
  const r = await api.tgWalletGet(String(ctx.from.id));
  if (!r.ok || !r.json?.ok) return ctx.reply('查询失败: ' + (r.json?.error || r.status));
  if (!r.json.exists) return ctx.reply('你还没有钱包。/wallet 生成一个 (零门槛玩)。');
  return ctx.reply(M.walletView(r.json));
});
bot.command('receive', async (ctx) => {
  const r = await api.tgWalletGet(String(ctx.from.id));
  if (r.ok && r.json?.exists) return ctx.reply('收款地址 (把它给对方往这转):\n' + r.json.address + '\n⚠ 测试网钱包。');
  return ctx.reply('你还没有钱包。/wallet 生成一个。');
});
// /send <地址> <金额> — 2 步确认 (Bettor: /send 必 confirm)。这步只本地校验+暂存, 不碰钱。
bot.command('send', async (ctx) => {
  const tgUser = String(ctx.from.id);
  const parts = (ctx.match || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return ctx.reply('用法: /send <kaspatest地址> <金额KAS>\n例: /send kaspatest:qq... 5');
  const to = parts[0];
  const amount = Number(parts[1]);
  if (!/^kaspa(test)?:[a-z0-9]+$/.test(to)) return ctx.reply('收款地址非法 (须 kaspatest:...)');
  if (!Number.isFinite(amount) || amount <= 0) return ctx.reply('金额非法, 须正数。');
  pendingSends.set(tgUser, { to, amount, ts: Date.now() });
  return ctx.reply(M.walletSendConfirm(to, amount));
});
bot.command('confirm', async (ctx) => {
  const tgUser = String(ctx.from.id);
  const p = pendingSends.get(tgUser);
  if (!p) return ctx.reply('没有待确认的转账。/send <地址> <金额> 发起。');
  if (Date.now() - p.ts > 5 * 60 * 1000) { pendingSends.delete(tgUser); return ctx.reply('确认超时 (>5 分钟), 请重新 /send。'); }
  pendingSends.delete(tgUser); // 单次, 防重发
  const r = await api.tgWalletSend(tgUser, p.to, p.amount);
  if (r.ok && r.json?.ok && r.json.txId) return ctx.reply(M.walletSendDone(r.json.txId, p.amount, p.to));
  return ctx.reply('转账失败: ' + (r.json?.error || r.status));
});
bot.command('cancel', async (ctx) => {
  const tgUser = String(ctx.from.id);
  if (pendingSends.delete(tgUser)) return ctx.reply('已取消转账。');
  PM.exitBetFlow(tgUser);
  return ctx.reply('已取消。');
});

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

// gate D onboarding (Bettor APPROVE bot-DM): /faucet — send the linked address 5 testnet KAS via the
// internal localhost faucet (FaucetRelay). Backend never exposed; the bot DM is the only public surface.
// per-Telegram-user 24h cooldown stops address-rotation drain on top of the server once-per-address guard.
bot.command('faucet', async (ctx) => {
  const tgUser = String(ctx.from.id);
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  if (!addr) return ctx.reply('先 /link <你的 kaspatest 地址> 绑定，再 /faucet 领测试币。');
  const now = Date.now();
  const COOLDOWN_MS = 24 * 3600 * 1000;
  const last = faucetCooldown.get(tgUser) || 0;
  if (now - last < COOLDOWN_MS) {
    const hrs = Math.ceil((COOLDOWN_MS - (now - last)) / 3600000);
    return ctx.reply(`你今天已领过测试币，约 ${hrs} 小时后可再领。`);
  }
  const r = await api.faucetRequest(addr);
  if (!r.ok) return ctx.reply('领取失败：' + (r.json?.error || r.status));
  faucetCooldown.set(tgUser, now);
  // KANet-UI 2026-06-23 (Bettor 派修): 数量不硬编——用 API 回的真值 (server env FAUCET_AMOUNT_KAS, 现 10k)。
  const amt = r.json.amount || '测试 KAS';
  return ctx.reply(`✅ 已发 ${amt} 到 ${addr}\ntx ${String(r.json.txid || '').slice(0, 16)}…（约 10 秒到账）\n下一步：/bet 开始押注。`);
});

// /verify 已废弃 (r275 砍签名挑战). 老用户可能还按旧习惯发, 友好重定向到 /link。
bot.command('verify', (ctx) => ctx.reply('用 /link <你的 kaspatest 地址> 绑定即可。/bet 开始押注。'));

bot.command('swap', async (ctx) => { const broker = await api.brokerInfo(brokerRelayId); return ctx.reply(M.swapFlow(broker)); });
// /broker — Owner 实测派修 (2026-06-22): 从 INFO-ONLY 升级为真接通自助申请流。auth 硬化已满足
// (地址制 onboarding + Owner trust 审批门已落), 申请落 pending → Owner 批 trust 才激活, 公开安全。
// 显用户绑定地址 + 当前 onboard 状态 + 申请路径 (/broker_apply)。0-key 不变 (onboard 不碰资金)。
bot.command('broker', async (ctx) => {
  const tgUser = String(ctx.from.id);
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  let status = null;
  if (addr) { const r = await api.brokerOnboardStatus(addr); if (r.ok) status = r.json; }
  return ctx.reply(M.brokerRole({ addr, status }));
});
// /earnings — broker 收益统计 (Owner 钦定 2026-06-22 DM 显): address-keyed, 用户 /link 地址当 broker 查。
// 经手 N 单 / 已实现 X / 待结算 Y / 各单 explorer 链接 (价值分成 1.6%, 链上可验)。0-key 只读。
bot.command('earnings', async (ctx) => {
  const tgUser = String(ctx.from.id);
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  if (!addr) return ctx.reply('先 /link <你的 kaspatest 地址> 绑定 (= 你的 broker 收款地址), 再 /earnings 看收益。');
  const r = await api.brokerEarningsByAddress(addr);
  if (!r.ok || !r.json?.ok) return ctx.reply('收益查询失败: ' + (r.json?.error || r.status));
  return ctx.reply(M.brokerEarnings(r.json), { disable_web_page_preview: true });
});
// /broker_apply <bot token> — 提交 broker 自助申请 (地址制): broker_address = 用户 /link 地址,
// bot_token = 用户自己的 @BotFather token (加密落库, 永不外显)。落 pending, 待 Owner 批 trust 激活。
bot.command('broker_apply', async (ctx) => {
  const tgUser = String(ctx.from.id);
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  if (!addr) return ctx.reply('先 /link <你的 kaspatest 地址> 绑定 (这地址 = 你的 broker 收款地址), 再 /broker_apply。');
  const token = (ctx.match || '').trim();
  if (!token || token.length < 20) return ctx.reply('用法: /broker_apply <你的 @BotFather bot token>\n去 @BotFather 发 /newbot 拿 token (形如 123456:ABC-...)。');
  const r = await api.brokerOnboardApply({ address: addr, token, username: ctx.from.username ? '@' + ctx.from.username : undefined });
  if (!r.ok || !r.json?.ok) return ctx.reply('申请失败: ' + (r.json?.error || r.status));
  return ctx.reply(`✅ 申请已提交！\n📍 broker 地址: ${addr}\n⏳ 状态: 待 Owner 审批 (批准后 KANet 自动托管拉起你的 bot, 对外呈现市场, 带量佣金落你地址)。\n查状态: /broker · token 已加密存储绝不外显。`);
});
bot.command('bet',  async (ctx) => ctx.reply(await PM.startBet(String(ctx.from.id), brokerRelayId)));  // S-C: in-chat 编号菜单 — broker-scoped (only this broker's 经手 markets)
// Bettor r78 ① — /mybets: 列自己押注 + 赢/输/退款状态 (= J2 r126 my-positions wire).
// Bettor r87 ③ 续 — 每 open position 加 inline-keyboard '➕ 加注/反手' (防流失, callback 接 startBetFromMarket).
bot.command('mybets', async (ctx) => {
  const tgUser = String(ctx.from.id);
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  const text = await PM.formatMyBets(addr);
  const buttons = await PM.buildMyBetsKeyboard(addr);
  if (buttons.length === 0) return ctx.reply(text);
  // grammy reply_markup 直接传 — 每按钮 1 行, 简洁
  return ctx.reply(text, {
    reply_markup: { inline_keyboard: buttons.map(b => [{ text: b.label, callback_data: b.callback_data }]) },
  });
});

// Bettor r87 ③ — '➕ 加注/反手' callback handler: 进该 market 的 detail stage (= 跳过类目/市场选).
bot.callbackQuery(/^mybet:addmore:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const marketId = ctx.match[1];
  const reply = await PM.startBetFromMarket(String(ctx.from.id), marketId);
  await ctx.reply(reply);
});
bot.command('discover', (ctx) => ctx.reply('浏览:\n· /bet — 押注预测市场 (全菜单选品类/市场)\n· /swap — 兑换 KAS ↔ USDT (经 broker)\n· /mybets — 看自己的押注 + 状态'));

// S-C menu navigation — plain-text numeric replies advance the bet flow (commands handled above).
bot.on('message:text', async (ctx) => {
  const tgUser = String(ctx.from.id);
  const txt = ctx.message?.text || '';
  if (txt.startsWith('/')) return;            // commands handled by bot.command
  if (PM.inBetFlow(tgUser)) {
    // Bettor r63 ①: 优先从持久 link store 取 (= 抗 bot 重启), in-mem 退化 fallback.
    const reply = await PM.handleReply(tgUser, txt, PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address);
    if (reply) {
      // Bettor r116 + KANet-UI: prediction-menu confirm 阶段返 { text, parseMode } 支持 HTML
      // (tap-to-copy 地址 + payment URI). 其余阶段返 string 原路 ctx.reply.
      if (typeof reply === 'object' && reply.text) {
        await ctx.reply(reply.text, { parse_mode: reply.parseMode });
      } else {
        await ctx.reply(reply);
      }
    }
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
// pollLoop interval moved into startBot() (below).

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
      try { await bot.api.sendMessage(p.tgUser, `✅ 押注已入账! ${p.side} · ${(p.exact_sompi / 1e8).toFixed(8)} KAS\n市场: ${PM.specTitle(p.question) || p.market_id || ''}\n链上到账检测成功, side 已锁仓。结算后用绑定地址领取。`); } catch {}
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
// pollPendingBets interval moved into startBot() (below).

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
          // Bettor r76 F-N1 fix: use server-derived did_win (= my_direction === outcome_winner)
          // instead of p.claim_txid (= empty for happy-path winners since settle_via_spine pays direct).
          if (p.did_win === true) {
            msg = `🎉 [${PM.specTitle(p.question) || p.market_id}]\n你赢了! 押 ${p.my_side} ${p.stake_kas} KAS → 应到账 ${p.actual_payout_kas} KAS (settle TX: ${p.settle_txid.slice(0,16)}...)\n钱已发到你的绑定地址 — 钱包查看到账.`;
          } else if (p.did_win === false) {
            msg = `😞 [${PM.specTitle(p.question) || p.market_id}]\n你输了。\n开奖: ${p.outcome_side} (你押的是 ${p.my_side}) · 押 ${p.stake_kas} KAS\nsettle TX: ${p.settle_txid.slice(0,16)}...`;
          } else {
            // outcome_winner 还没写入 metadata (= 还在收集签名/早) — 给中性话, 等下一轮 poll.
            msg = `📊 [${PM.specTitle(p.question) || p.market_id}] 已结算\n你的押注: ${p.my_side} · ${p.stake_kas} KAS · settle TX ${p.settle_txid.slice(0,16)}...\n等待最终开奖标注 (下次会推确切赢/输).`;
          }
        } else if (p.refund_txid) {
          msg = `💸 [${PM.specTitle(p.question) || p.market_id}] 已退款\n市场取消/分歧, 退款 TX: ${p.refund_txid.slice(0,16)}...\n你的押注退回到绑定地址.`;
        }
        if (msg) { try { await bot.api.sendMessage(u.tgUser, msg); } catch {} }
      }
    } catch {}
  }
}

// KANet-UI 2026-06-13: runtime side-effects (Telegram poller + the 3 background pollers, which can send
// real messages) live in startBot() so `import`ing this module (e.g. from a test) registers the handlers
// WITHOUT going live. _launch_tg_bot.mjs calls startBot(); tests import { bot } and feed bot.handleUpdate().
export function startBot() {
  setInterval(async () => { brokerRelayId = await resolveBrokerRelayId(); }, CONFIG.brokerRefreshMs);
  setInterval(() => { pollLoop().catch(() => {}); }, CONFIG.pollMs);
  setInterval(() => { pollPendingBets().catch(() => {}); }, CONFIG.pollMs);
  setInterval(() => { pollSettleResults().catch(() => {}); }, CONFIG.pollMs);
  bot.start();
  console.log('[tg-bot] @' + CONFIG.botUsername + ' up (broker=' + (brokerRelayId || 'UNSET — set in Console Settings') + ', 0-key / deep-link only)');
}

export { bot };
