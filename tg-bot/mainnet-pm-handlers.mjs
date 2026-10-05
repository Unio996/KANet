// mainnet-pm-handlers.mjs — 主网电报口子的预测市场接线(D-036): /bet /hot 列表 → 详情 → 押 YES/NO → 回复筹码数 → register-v07 一步下注; /mybets /record; 每日上限。
// 只在 isReadonlyShell(CONFIG)(=mainnet)时被 bot.mjs 调用, 且在 registerReadonlyShell【之前】注册(grammY 先注册者先处理): 这里接管 bet/hot/mybets/record 与相关回调,
// 其余(隐藏入口/ link / help / start)仍由只读壳处理; 文本消息无押注会话时 next() 交还只读壳。TN12 老 handler 一个字节没动。
// 依赖全部注入(api/PM/CONFIG/t/cap), 便于假 bot 测试。0 密钥: 下注靠服务端网关代付, bot 只送 {linked_addr, direction, stake_ktt}。
import { visiblePoolMarkets, cbData, chipsLabel, parseChips, chipsToStakeKtt, mapRegisterFailure, formatMyPositions } from './mainnet-pm.mjs';

const SESSION_TTL_MS = 10 * 60 * 1000;
const fmtResets = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) + ' UTC' : 'UTC 00:00');

export function registerMainnetPm(bot, { api, PM, t, getLang, initLang, cap, now = Date.now }) {
  const sessions = new Map();   // tgUser → { marketId, title, direction, side, exp, busy }
  const reply = (ctx, text, keyboard) => (keyboard ? ctx.reply(text, { reply_markup: keyboard }) : ctx.reply(text));

  async function loadMarkets() {
    const r = await api.poolMarkets({ status: 'pending_bettors', limit: 50 });
    if (api.isTransportFailure(r)) return { busy: true };
    if (!r.ok || !r.json?.ok) return { fail: true };
    return { rows: Array.isArray(r.json.markets) ? r.json.markets : [] };
  }
  const whenText = (lang, deadlineSec) => {
    if (deadlineSec == null) return '';
    const left = deadlineSec * 1000 - now();
    if (left <= 0) return t(lang, 'ro_when_expired');
    if (left < 3600000) return t(lang, 'ro_when_minutes', { m: Math.max(1, Math.ceil(left / 60000)) });
    return t(lang, 'ro_when_hours', { h: Math.ceil(left / 3600000) });
  };

  async function listReply(ctx, titleKey, limit) {
    initLang(ctx); const lang = getLang(ctx);
    const got = await loadMarkets();
    if (got.busy) return ctx.reply(t(lang, 'service_busy'));
    if (got.fail) return ctx.reply(t(lang, 'hot_fail'));
    const ms = visiblePoolMarkets(got.rows, { limit, nowMs: now() }).filter((m) => cbData('m', m.id));
    if (!ms.length) return ctx.reply(t(lang, 'ro_list_empty'));
    const lines = [t(lang, titleKey, { n: ms.length }), ''];
    ms.forEach((m, i) => lines.push(`${i + 1}. ${t(lang, 'pm_line_open', { q: m.title.length > 56 ? m.title.slice(0, 55) + '…' : m.title, when: whenText(lang, m.deadlineSec) })}`));
    lines.push('', t(lang, 'pm_list_footer'));
    const keyboard = { inline_keyboard: ms.map((m, i) => [{ text: `${i + 1}. ${m.title.length > 28 ? m.title.slice(0, 27) + '…' : m.title}`, callback_data: cbData('m', m.id) }]) };
    return reply(ctx, lines.join('\n'), keyboard);
  }

  async function detailReply(ctx, marketId) {
    initLang(ctx); const lang = getLang(ctx);
    const got = await loadMarkets();
    if (got.busy) return ctx.reply(t(lang, 'service_busy'));
    if (got.fail) return ctx.reply(t(lang, 'hot_fail'));
    const m = visiblePoolMarkets(got.rows, { limit: 50, nowMs: now() }).find((x) => x.id === marketId);
    if (!m) return ctx.reply(t(lang, 'ro_detail_not_found'));
    const linkedAddr = PM.getLinkedAddr(String(ctx.from.id));
    const lines = [t(lang, 'ro_detail_title', { q: m.title }), t(lang, 'pm_detail_status'), t(lang, 'ro_detail_deadline', { when: whenText(lang, m.deadlineSec) || '?' }),
      t(lang, 'pm_detail_pool', { yes: chipsLabel(m.yesChips), no: chipsLabel(m.noChips) }), t(lang, 'pm_detail_min')];
    if (!linkedAddr) { lines.push('', t(lang, 'pm_need_link')); return reply(ctx, lines.join('\n')); }
    const yes = cbData('b', m.id, '0'), no = cbData('b', m.id, '1');
    return reply(ctx, lines.join('\n'), { inline_keyboard: [[{ text: t(lang, 'pm_btn_yes'), callback_data: yes }, { text: t(lang, 'pm_btn_no'), callback_data: no }]] });
  }

  bot.command('bet', (ctx) => listReply(ctx, 'pm_list_title', 8));
  bot.command('hot', (ctx) => listReply(ctx, 'pm_hot_title', 5));
  bot.callbackQuery('nav:hot', async (ctx) => { await ctx.answerCallbackQuery(); return listReply(ctx, 'pm_hot_title', 5); });
  bot.callbackQuery(/^pm:m:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); return detailReply(ctx, ctx.match[1]); });

  // 点 YES/NO ⇒ 开一个押注会话, 问要押多少筹码(整数, 最少 1)
  bot.callbackQuery(/^pm:b:(.+):([01])$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    initLang(ctx); const lang = getLang(ctx); const tg = String(ctx.from.id);
    if (!PM.getLinkedAddr(tg)) return ctx.reply(t(lang, 'pm_need_link'));
    if (!cap.allowed(tg)) return ctx.reply(t(lang, 'pm_cap_bot', { max: cap.max, resets: fmtResets(cap.resetsAt()) }));
    const marketId = ctx.match[1], direction = Number(ctx.match[2]);
    const got = await loadMarkets();
    if (got.busy) return ctx.reply(t(lang, 'service_busy'));
    if (got.fail) return ctx.reply(t(lang, 'hot_fail'));
    const m = visiblePoolMarkets(got.rows, { limit: 50, nowMs: now() }).find((x) => x.id === marketId);
    if (!m) return ctx.reply(t(lang, 'pm_closed'));
    const side = t(lang, direction === 0 ? 'pm_side_yes' : 'pm_side_no');
    sessions.set(tg, { marketId, title: m.title, direction, side, exp: now() + SESSION_TTL_MS, busy: false });
    return ctx.reply(t(lang, 'pm_amount_prompt', { q: m.title, side }));
  });

  // 回复筹码数 ⇒ 下注。没有会话 ⇒ next() 交还只读壳; 以 / 开头 ⇒ next()(命令照常)
  bot.on('message:text', async (ctx, next) => {
    const txt = String(ctx.message?.text || '');
    if (txt.startsWith('/')) return next();
    const tg = String(ctx.from.id); const s = sessions.get(tg);
    if (!s || s.exp < now()) { sessions.delete(tg); return next(); }
    initLang(ctx); const lang = getLang(ctx);
    if (s.busy) return ctx.reply(t(lang, 'pm_busy'));
    const p = parseChips(txt);
    if (!p.ok) return ctx.reply(t(lang, p.reason === 'min' ? 'pm_chips_min' : p.reason === 'max' ? 'pm_chips_max' : 'pm_chips_format'));
    const linkedAddr = PM.getLinkedAddr(tg);
    if (!linkedAddr) { sessions.delete(tg); return ctx.reply(t(lang, 'pm_need_link')); }
    if (!cap.allowed(tg)) { sessions.delete(tg); return ctx.reply(t(lang, 'pm_cap_bot', { max: cap.max, resets: fmtResets(cap.resetsAt()) })); }
    s.busy = true;
    let r;
    try { r = await api.poolRegisterV07Gateway(s.marketId, { linkedAddr, direction: s.direction, stakeKtt: chipsToStakeKtt(p.chips) }); }
    finally { s.busy = false; }
    sessions.delete(tg);
    if (r.ok && r.json?.ok) {
      cap.increment(tg);
      return ctx.reply(t(lang, 'pm_bet_ok', { q: s.title, side: s.side, chips: chipsLabel(p.chips) }));
    }
    const f = mapRegisterFailure(r);
    return ctx.reply(t(lang, f.key, f.key === 'pm_cap_server' ? { resets: fmtResets(f.vars.resets) } : f.vars));
  });

  async function myBets(ctx) {
    initLang(ctx); const lang = getLang(ctx); const tg = String(ctx.from.id);
    const addr = PM.getLinkedAddr(tg);
    if (!addr) return ctx.reply(t(lang, 'pm_need_link'));
    const r = await api.myPositions(addr);
    if (api.isTransportFailure(r)) return ctx.reply(t(lang, 'service_busy'));
    if (!r.ok || !r.json?.ok) return ctx.reply(t(lang, 'hot_fail'));
    return ctx.reply(formatMyPositions(r.json.positions || [], lang, { t }));
  }
  bot.command('mybets', myBets);
  bot.command('record', myBets);
  bot.callbackQuery('nav:mybets', async (ctx) => { await ctx.answerCallbackQuery(); return myBets(ctx); });

  return { sessions };
}
