// readonly-handlers.mjs — 电报口子接主网(只读壳)的命令/回调接线。只在 isReadonlyShell(CONFIG)(=mainnet)时被 bot.mjs 调用, 且在原有 handler【之前】注册
// (grammY 先注册者先处理、不调 next() 则后面的原 handler 不会被触及): 原 handler 一个字节没动, TN12 行为原样保留。
// 设计: docs/2026-09-20-kanetui-tg-bot-mainnet-relaunch-and-proto-v0-repoint-change-note-v0.1.md §2 P1 / CR-3 / §7 隐藏入口。
//
// 🔴 只读: 这里没有任何下注/钱包/转账/领水入口, 唯一的写是 /link 绑定地址(既有 POST /api/link/bind, 服务端按网络校验)。
// 🔴 只含逻辑: 所有可见字符串经 t(lang, 'ro_*'), 措辞是另一笔(B, 等 Owner 定稿)。依赖全部注入(api/PM/CONFIG/linked/t), 便于用假 bot 测试。
import {
  visibleMarkets, toBotMarket, formatMarketList, formatMarketDetail, findByIdPrefix, classifyLinkInput, linkRejectKey,
} from './readonly-shell.mjs';
import { prefixForNetwork } from '../shared/lib/kaspa-network.mjs';

/** 主网期隐藏的命令(Owner 已批: /wallet /send /faucet; /swap 无兑换; /broker_apply 建议隐藏, Owner 待定——改这一处即可)。 */
export const RO_HIDDEN_COMMANDS = ['wallet', 'balance', 'receive', 'send', 'confirm', 'cancel', 'faucet', 'swap', 'broker_apply'];

export function registerReadonlyShell(bot, { api, PM, CONFIG, linked, t, getLang, initLang, now = Date.now, log = console }) {
  // F2(NWT 审后修): 启动清理——丢弃地址前缀≠主网的旧绑定(TN12 时代 kaspatest)+清空残留下注会话, 让 /start 那句"旧的绑定与会话已重置"名副其实; 同时堵住
  // pollLoop 拿旧地址查事件、老用户打字掉进旧下注流的口子。pendingPayments 不动(监控队列), 只 LOUD 报数量。清理在原 handler 之前、注册时执行一次。
  if (typeof PM.pruneForReadonlyShell === 'function') {
    const s = PM.pruneForReadonlyShell(prefixForNetwork(CONFIG.network));
    log.log(`[readonly-shell] startup cleanup: dropped ${s.droppedLinks} non-mainnet binding(s), cleared ${s.clearedSessions} stale session(s), pendingPayments=${s.pendingPayments}`);
    if (s.pendingPayments > 0) log.warn(`[readonly-shell] 🔴 ${s.pendingPayments} pendingPayments left in state (in-flight payment monitors are NOT cleared) — expected 0 before go-live`);
  }
  const reply = (ctx, r) => (r.keyboard ? ctx.reply(r.text, { reply_markup: r.keyboard }) : ctx.reply(r.text));

  /** 取 proto 市场行。返回 { rows } | { busy:true } | { fail:true }。 */
  async function loadRows() {
    const r = await api.protoMarkets();
    if (api.isTransportFailure(r)) return { busy: true };
    if (!r.ok || !r.json?.ok) return { fail: true };
    return { rows: Array.isArray(r.json.markets) ? r.json.markets : [] };
  }

  async function listReply(ctx, { limit, titleKey }) {
    initLang(ctx); const lang = getLang(ctx);
    const got = await loadRows();
    if (got.busy) return ctx.reply(t(lang, 'service_busy'));
    if (got.fail) return ctx.reply(t(lang, 'hot_fail'));
    return reply(ctx, formatMarketList(visibleMarkets(got.rows, { limit }), lang, { t, nowMs: now(), titleKey }));
  }

  /** 详情: 按 id 前缀(>=8 位 hex)在列表里找唯一一条; 找不到 / 隐藏态(genesis_*)⇒ "未找到"。 */
  async function detailReply(ctx, prefix) {
    initLang(ctx); const lang = getLang(ctx);
    const got = await loadRows();
    if (got.busy) return ctx.reply(t(lang, 'service_busy'));
    if (got.fail) return ctx.reply(t(lang, 'hot_fail'));
    const row = findByIdPrefix(got.rows, prefix);
    const m = row ? toBotMarket(row) : null;
    return reply(ctx, formatMarketDetail(m && m.state !== 'hidden' ? m : null, lang, { t, nowMs: now() }));
  }

  const startText = (lang) => [t(lang, 'ro_start_notice'), '', t(lang, 'ro_start_commands')].join('\n');
  const langBtn = (lang) => ({ inline_keyboard: [[{ text: t(lang, lang === 'en' ? 'start_lang_btn_zh' : 'start_lang_btn_en'), callback_data: 'lang:toggle' }]] });
  const unavailable = (ctx) => { initLang(ctx); return ctx.reply(t(getLang(ctx), 'ro_unavailable')); };

  bot.command('start', async (ctx) => {
    const tgUser = String(ctx.from.id);
    initLang(ctx);
    if (typeof PM.exitBetFlow === 'function') PM.exitBetFlow(tgUser);   // 清掉 TN12 时代残留的下注会话(与原 /start 同)
    const payload = (ctx.match || '').trim();
    if (payload && /^[0-9a-fA-F]{8,64}$/.test(payload)) return detailReply(ctx, payload);   // 深链 t.me/<bot>?start=<市场 id>
    const lang = getLang(ctx);
    return ctx.reply(startText(lang), { reply_markup: langBtn(lang) });
  });

  bot.callbackQuery('lang:toggle', async (ctx) => {
    const tgUser = String(ctx.from.id);
    const newLang = (PM.getUserLang(tgUser) || 'en') === 'en' ? 'zh' : 'en';
    PM.setUserLang(tgUser, newLang);
    await ctx.answerCallbackQuery();
    try { await ctx.editMessageText(startText(newLang), { reply_markup: langBtn(newLang) }); } catch { /* 内容未变时 editMessageText 会抛, 静默 */ }
  });

  bot.command('help', (ctx) => { initLang(ctx); return ctx.reply(t(getLang(ctx), 'ro_help')); });

  bot.command('link', async (ctx) => {
    initLang(ctx); const lang = getLang(ctx);
    const addr = (ctx.match || '').trim();
    const c = classifyLinkInput(addr, CONFIG.network);
    if (!c.ok) return ctx.reply(t(lang, c.reason === 'wrong_network' ? 'ro_link_wrong_network' : 'ro_link_usage'));
    const tgUser = String(ctx.from.id);
    const r = await api.linkBind(addr, tgUser);
    if (api.isTransportFailure(r)) return ctx.reply(t(lang, 'service_busy'));
    if (!r.ok || !r.json?.linked) {
      const key = linkRejectKey(r.json?.code);   // console 按网络+校验和判定, 回机器码
      return ctx.reply(key ? t(lang, key) : t(lang, 'link_fail', { error: r.json?.error || r.status }));
    }
    PM.setLinkedAddr(tgUser, addr);                                   // 持久化(抗 bot 重启), 与原 /link 同
    linked.set(tgUser, { address: addr, lastTs: now() });
    return ctx.reply(t(lang, 'ro_link_ok', { addr }));
  });

  bot.command('bet', (ctx) => listReply(ctx, { limit: 8, titleKey: 'ro_list_title' }));
  bot.command('hot', (ctx) => listReply(ctx, { limit: 5, titleKey: 'ro_hot_title' }));
  bot.callbackQuery('nav:hot', async (ctx) => { await ctx.answerCallbackQuery(); return listReply(ctx, { limit: 5, titleKey: 'ro_hot_title' }); });
  bot.callbackQuery(/^ro:m:([0-9a-f]{16})$/, async (ctx) => { await ctx.answerCallbackQuery(); return detailReply(ctx, ctx.match[1]); });

  // proto-v0 不记下注人 ⇒ 没有"某地址的下注"可读(变更说明 §3 第 1 条)
  const noData = (ctx) => { initLang(ctx); return ctx.reply(t(getLang(ctx), 'ro_mybets_unavailable')); };
  bot.command('mybets', noData);
  bot.command('record', noData);
  bot.callbackQuery('nav:mybets', async (ctx) => { await ctx.answerCallbackQuery(); return noData(ctx); });

  bot.command('discover', (ctx) => { initLang(ctx); return ctx.reply(t(getLang(ctx), 'ro_discover')); });
  bot.command('champions', (ctx) => { initLang(ctx); return ctx.reply(t(getLang(ctx), 'ro_champions_ended')); });

  // 隐藏入口: 手打统一回"暂不开放"; 老消息里残留的旧按钮(TN12 时代的 inline keyboard)也同样拦下, 不进旧的下注/钱包流程
  for (const c of RO_HIDDEN_COMMANDS) bot.command(c, unavailable);
  // 自由文本/非命令(NWT#4): 只读壳不产生反馈工单、也不进旧下注会话流程——统一回"暂不开放"; 以 / 开头的交还给后面(/broker /earnings /lang /support /verify 等原 handler)
  bot.on('message:text', async (ctx, next) => {
    if (String(ctx.message?.text || '').startsWith('/')) return next();
    initLang(ctx); return ctx.reply(t(getLang(ctx), 'ro_unavailable'));
  });
  for (const pat of [/^bet:market:(.+)$/, /^bet:side:(1|2)$/, /^mybet:addmore:(.+)$/, 'nav:faucet']) {
    bot.callbackQuery(pat, async (ctx) => { await ctx.answerCallbackQuery(); return unavailable(ctx); });
  }
}
