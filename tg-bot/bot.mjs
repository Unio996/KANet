// TG bot service (grammY) — broker X 的电报前端 (Owner v1.3 §8). J1 S5: 0-key, read + deep-link only.
// 价值/信任步 NEVER executed here; bot deep-links the USER to Console/relay to act + pay on-chain.
// Run:  TELEGRAM_BOT_TOKEN=.. BROKER_RELAY_ID=.. INGEST_SECRET=.. node tg-bot/bot.mjs
import { Bot } from 'grammy';
import { CONFIG, missingConfig, resolveBrokerRelayId, verifyAndSyncBotUsername } from './config.mjs';
import * as api from './console-api.mjs';
import * as M from './messages.mjs';
import * as PM from './prediction-menu.mjs';
import { t, detectLang, SUPPORTED_LANGS } from './i18n.mjs';

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

// 用户反馈通道卡A N2 限流 (2026-07-12, tg-side-design.md §5): 单用户滑动窗口 5次/分钟, 内存 Map
// (同 PM 会话状态管理模式, 不新建表). 超限 → 静态文案, 不调 LLM.
const feedbackRateLimit = new Map(); // tg_user → number[] (最近请求时间戳 ms)
const FEEDBACK_RATE_LIMIT_MAX = 5;
const FEEDBACK_RATE_LIMIT_WINDOW_MS = 60_000;
function feedbackRateLimited(tgUser) {
  const now = Date.now();
  const hits = (feedbackRateLimit.get(tgUser) || []).filter((ts) => now - ts < FEEDBACK_RATE_LIMIT_WINDOW_MS);
  if (hits.length >= FEEDBACK_RATE_LIMIT_MAX) { feedbackRateLimit.set(tgUser, hits); return true; }
  hits.push(now);
  feedbackRateLimit.set(tgUser, hits);
  return false;
}

// Lang helper: stored pref (set by /lang or auto-detected on first interaction) → fall back to auto-detect.
function getLang(ctx) { return PM.getUserLang(String(ctx.from.id)); }
// Auto-detect + persist on first use (non-blocking, uses debounce-persist).
function initLang(ctx) { PM.maybeSetLang(String(ctx.from.id), detectLang(ctx.from?.language_code)); }

// Bettor 2026-06-29: 首页从"热榜(>=3真人)"换"可押市场(usable+有空位)": 用户要能押的盘不是最热的盘.
// 查漏补缺(2026-07-05 晚, Owner 精确纠正"不加不减·只收真实膨胀点"): 热榜条数曾从设计值 5
// 悄悄涨到 8(唯一该动的地方, 收回 5), 赛事卡组数原本就是 5, 不动(不是新猜的数字)。
// KANet-UI 2026-07-19 (#19+① 合并, Bettor/NWT 审GREEN): /start 和 lang:toggle 两处原本各写一份
// 一样的 fetch 逻辑(漂移风险), 抽成共享 helper。同时补上 wcFallbackCandidates: card_groups 为空
// 时才多拉一次更宽的可押市场集(仅当 sports 为空才触发, 常态零额外请求), 专门喂给首页赛事区兜底
// 过滤——不能复用 trending(那份 limit 5 按 pool+recency 排序, Owner 钦定不能动, 小池新盘挤不进
// 前 5, 兜底会变空转, 2026-07-19 功能自测抓到)。
async function _fetchHomeMarketData() {
  let trending = null, sports = null, wcFallbackCandidates = null;
  try {
    const [av, cg] = await Promise.all([api.availableMarkets(5), api.cardGroups(5)]);
    if (av.ok && av.json?.ok) trending = av.json.markets || [];
    if (cg.ok && cg.json?.ok) sports = cg.json.card_groups || [];
    if (!sports || sports.length === 0) {
      const avWide = await api.availableMarkets(30);
      if (avWide.ok && avWide.json?.ok) wcFallbackCandidates = avWide.json.markets || [];
    }
  } catch { /* Console 暂不可达 → 无区块 */ }
  return { trending, sports, wcFallbackCandidates };
}

// KANet-UI 2026-06-22 (Owner 实测派修 ②): /start 查 /link 绑定 — 已绑显地址+下一步, 未绑走三步引导。
// T1 (2026-06-27): 解析 ctx.match payload — t.me/<bot>?start=<market_id> 深链直跳市场详情。
bot.command('start', async (ctx) => {
  const tgUser = String(ctx.from.id);
  initLang(ctx);
  const lang = getLang(ctx);
  PM.exitBetFlow(tgUser);
  // Deep link payload: /start <market_id>
  const payload = (ctx.match || '').trim();
  if (payload && /^[a-zA-Z0-9_-]{2,64}$/.test(payload)) {
    const reply = await PM.startBetFromMarket(tgUser, payload);
    // Bettor #j1nlmx (2026-07-13, 实stack trace复现): typeof null === 'object' 是 JS 经典陷阱, 裸
    // `typeof reply === 'object'` 骗不过 null——reply.text 会真崩(TypeError), 被 bot.catch 吞掉=用户
    // 点击/操作零反应。加 `reply &&` 短路, null/undefined 都安全落到下面的 fallback.
    if (reply && typeof reply === 'object' && reply.text) {
      return ctx.reply(reply.text, { reply_markup: reply.keyboard });
    }
    return ctx.reply(reply);
  }
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  if (!addr) { const sm = M.startMessage(lang); return ctx.reply(sm.text, { reply_markup: sm.keyboard || undefined }); }
  // KANet-UI 2026-06-23 (Bettor 承重 custody 口径): custody-aware /start — 托管钱包(/wallet 生成, 节点持 key)
  // 与非托管(/link 自己地址, key 用户掌控)的警告不可一刀切。查 tg-wallet: 存在且地址==当前绑定 → 托管。
  // 查询失败 → custodial=null (显两类并存警告, 绝不假称"bot 不持 key")。
  let custodial = null;
  try {
    const w = await api.tgWalletGet(tgUser);
    if (w.ok && w.json?.ok) custodial = !!(w.json.exists && w.json.address === addr);
  } catch { /* Console 暂不可达 → null → 中性 custody 警告 */ }
  const { trending, sports, wcFallbackCandidates } = await _fetchHomeMarketData();
  const startMsg = M.startMessageLinked(addr, custodial, trending, CONFIG.botUsername, sports, lang, wcFallbackCandidates);
  return ctx.reply(startMsg.text, { reply_markup: startMsg.keyboard || undefined });
});
bot.command('help', (ctx) => { initLang(ctx); return ctx.reply(M.help(getLang(ctx))); });

// /lang en|zh — set language preference persistently.
bot.command('lang', (ctx) => {
  const tgUser = String(ctx.from.id);
  const arg = (ctx.match || '').trim().toLowerCase();
  if (!SUPPORTED_LANGS.includes(arg)) {
    return ctx.reply(t(PM.getUserLang(tgUser), 'lang_usage'));
  }
  PM.setUserLang(tgUser, arg);
  return ctx.reply(t(arg, arg === 'zh' ? 'lang_set_zh' : 'lang_set_en'));
});

// /start 语言切换按钮 — 一键 EN↔ZH, 直接 editMessageText 无需重发.
bot.callbackQuery('lang:toggle', async (ctx) => {
  const tgUser = String(ctx.from.id);
  const curLang = PM.getUserLang(tgUser) || 'en';
  const newLang = curLang === 'en' ? 'zh' : 'en';
  PM.setUserLang(tgUser, newLang);
  await ctx.answerCallbackQuery();
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  try {
    if (addr) {
      let custodial = null;
      try {
        const w = await api.tgWalletGet(tgUser);
        if (w.ok && w.json?.ok) custodial = !!(w.json.exists && w.json.address === addr);
      } catch { /* ignore */ }
      const { trending, sports, wcFallbackCandidates } = await _fetchHomeMarketData();
      const msg = M.startMessageLinked(addr, custodial, trending, CONFIG.botUsername, sports, newLang, wcFallbackCandidates);
      await ctx.editMessageText(msg.text, { reply_markup: msg.keyboard || undefined });
    } else {
      const msg = M.startMessage(newLang);
      await ctx.editMessageText(msg.text, { reply_markup: msg.keyboard || undefined });
    }
  } catch { /* editMessageText fails if content unchanged — silent */ }
});

// KANet-UI 2026-06-23 (Owner 钦定 托管钱包·零门槛玩): /wallet 生成或查看; /balance; /receive。
// Console 侧托管(持 key/签名), bot 0-key 只调 API。/send 待 Bettor Q3 后加。NO /export (Bettor⑤)。
bot.command('wallet', async (ctx) => {
  initLang(ctx);
  const lang = getLang(ctx);
  const tgUser = String(ctx.from.id);
  const r = await api.tgWalletCreate(tgUser);
  if (!r.ok || !r.json?.ok) return ctx.reply(t(lang, 'wallet_fail', { error: r.json?.error || r.status }));
  if (r.json.created) {
    // 新生成: auto-link 地址(现有 /bet//broker//earnings 直接可用) + 显助记词【仅此一次】+ 醒目警告。
    PM.setLinkedAddr(tgUser, r.json.address);
    linked.set(tgUser, { address: r.json.address, lastTs: Date.now() });
    return ctx.reply(M.walletGenerated(r.json.address, r.json.mnemonic, lang));
  }
  // 已有: 显地址+余额(永不再显助记词)
  const g = await api.tgWalletGet(tgUser);
  return ctx.reply(g.ok && g.json?.exists ? M.walletView(g.json, lang) : t(lang, 'wallet_view_fallback', { addr: r.json.address }));
});
bot.command('balance', async (ctx) => {
  initLang(ctx);
  const lang = getLang(ctx);
  const r = await api.tgWalletGet(String(ctx.from.id));
  if (!r.ok || !r.json?.ok) return ctx.reply(t(lang, 'wallet_fail', { error: r.json?.error || r.status }));
  if (!r.json.exists) return ctx.reply(t(lang, 'wallet_no_wallet'));
  return ctx.reply(M.walletView(r.json, lang));
});
bot.command('receive', async (ctx) => {
  initLang(ctx);
  const lang = getLang(ctx);
  const r = await api.tgWalletGet(String(ctx.from.id));
  if (r.ok && r.json?.exists) return ctx.reply(t(lang, 'wallet_receive_label', { addr: r.json.address }));
  return ctx.reply(t(lang, 'wallet_receive_no_wallet'));
});
// /send <地址> <金额> — 2 步确认 (Bettor: /send 必 confirm)。这步只本地校验+暂存, 不碰钱。
bot.command('send', async (ctx) => {
  initLang(ctx);
  const lang = getLang(ctx);
  const tgUser = String(ctx.from.id);
  const parts = (ctx.match || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return ctx.reply(t(lang, 'wallet_send_usage'));
  const to = parts[0];
  const amount = Number(parts[1]);
  if (!/^kaspa(test)?:[a-z0-9]+$/.test(to)) return ctx.reply(t(lang, 'wallet_send_bad_addr'));
  if (!Number.isFinite(amount) || amount <= 0) return ctx.reply(t(lang, 'wallet_send_bad_amount'));
  pendingSends.set(tgUser, { to, amount, ts: Date.now() });
  return ctx.reply(M.walletSendConfirm(to, amount, lang));
});
bot.command('confirm', async (ctx) => {
  initLang(ctx);
  const lang = getLang(ctx);
  const tgUser = String(ctx.from.id);
  const p = pendingSends.get(tgUser);
  if (!p) return ctx.reply(t(lang, 'wallet_confirm_none'));
  if (Date.now() - p.ts > 5 * 60 * 1000) { pendingSends.delete(tgUser); return ctx.reply(t(lang, 'wallet_confirm_timeout')); }
  pendingSends.delete(tgUser); // 单次, 防重发
  const r = await api.tgWalletSend(tgUser, p.to, p.amount);
  if (r.ok && r.json?.ok && r.json.txId) return ctx.reply(M.walletSendDone(r.json.txId, p.amount, p.to, lang));
  return ctx.reply(t(lang, 'wallet_send_fail', { error: r.json?.error || r.status }));
});
bot.command('cancel', async (ctx) => {
  initLang(ctx);
  const lang = getLang(ctx);
  const tgUser = String(ctx.from.id);
  if (pendingSends.delete(tgUser)) return ctx.reply(t(lang, 'wallet_cancel_transfer'));
  PM.exitBetFlow(tgUser);
  return ctx.reply(t(lang, 'wallet_cancel_generic'));
});

bot.command('link', async (ctx) => {
  initLang(ctx);
  const lang = getLang(ctx);
  const addr = (ctx.match || '').trim();
  if (!/^kaspatest:[a-z0-9]+$/.test(addr)) return ctx.reply(t(lang, 'link_usage'));
  const tgUser = String(ctx.from.id);
  const r = await api.linkBind(addr, tgUser);
  if (!r.ok || !r.json?.linked) return ctx.reply(t(lang, 'link_fail', { error: r.json?.error || r.status }));
  PM.setLinkedAddr(tgUser, addr);  // Bettor r63 ① 持久化 — 抗 bot 重启
  linked.set(tgUser, { address: addr, lastTs: Date.now() });  // poller cursor (= 重启可重置)
  return ctx.reply(t(lang, 'link_ok', { addr }));
});

// gate D onboarding (Bettor APPROVE bot-DM): /faucet — send the linked address 5 testnet KAS via the
// internal localhost faucet (FaucetRelay). Backend never exposed; the bot DM is the only public surface.
// per-Telegram-user 24h cooldown stops address-rotation drain on top of the server once-per-address guard.
// #18 (2026-07-05, Owner /start 精简: 13→4 按钮, Bettor 批): 提取成具名函数, 供 /faucet 命令 +
// /start 精简后的"💧 领水"按钮共用同一份逻辑(不复制, 按钮≈打这条命令的快捷方式)。
async function faucetHandler(ctx) {
  initLang(ctx);
  const lang = getLang(ctx);
  const tgUser = String(ctx.from.id);
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  if (!addr) return ctx.reply(t(lang, 'faucet_no_link'));
  const now = Date.now();
  const COOLDOWN_MS = 24 * 3600 * 1000;
  const last = faucetCooldown.get(tgUser) || 0;
  if (now - last < COOLDOWN_MS) {
    const hrs = Math.ceil((COOLDOWN_MS - (now - last)) / 3600000);
    return ctx.reply(t(lang, 'faucet_cooldown', { hrs }));
  }
  const r = await api.faucetRequest(addr);
  if (!r.ok) {
    // 查漏补缺(2026-07-04): 服务端是【永久 1 次/钱包】上限(chat.js walletRow check), 非 24h 冷却.
    // 之前 faucet_cooldown 文案暗示"等 24h 再试"会成功, 但已领过的钱包 24h 后再试只会撞这条永久
    // 拒绝, 且之前直接把服务端原始英文错误字符串(混语言)透传给用户 — 现在识别这个具体 case 给清楚提示.
    if (String(r.json?.error || '').includes('already granted')) {
      return ctx.reply(t(lang, 'faucet_already_claimed'));
    }
    return ctx.reply(t(lang, 'faucet_fail', { error: r.json?.error || r.status }));
  }
  faucetCooldown.set(tgUser, now);
  // KANet-UI 2026-06-23 (Bettor 派修): 数量不硬编——用 API 回的真值 (由 server env FAUCET_AMOUNT_KAS 定)。
  // 查漏补缺(2026-07-04): 后端 amount 字段是 "${N} testnet KAS" 英文单位写死的字符串(web faucet.eta
  // 也在用这个字段直接显示, 不能改后端格式), 之前 ZH 模板直接拼接会显示"已发 10000 testnet KAS"这种
  // 混语言——这里只取数字部分, 单位交给 i18n 模板自己按语言给("testnet KAS" / "测试网 KAS")。
  const amtMatch = String(r.json.amount || '').match(/[\d.]+/);
  const amt = amtMatch ? amtMatch[0] : String(r.json.amount || '?');
  return ctx.reply(t(lang, 'faucet_ok', { amt, addr, tx: String(r.json.txid || '').slice(0, 16) }));
}
bot.command('faucet', faucetHandler);

// /verify 已废弃 (r275 砍签名挑战). 老用户可能还按旧习惯发, 友好重定向到 /link。
bot.command('verify', (ctx) => { initLang(ctx); return ctx.reply(t(getLang(ctx), 'verify_redirect')); });

bot.command('swap', async (ctx) => { initLang(ctx); const lang = getLang(ctx); const broker = await api.brokerInfo(brokerRelayId); return ctx.reply(M.swapFlow(broker, lang, CONFIG.network)); });
// /broker — Owner 实测派修 (2026-06-22): 从 INFO-ONLY 升级为真接通自助申请流。auth 硬化已满足
// (地址制 onboarding + Owner trust 审批门已落), 申请落 pending → Owner 批 trust 才激活, 公开安全。
// 显用户绑定地址 + 当前 onboard 状态 + 申请路径 (/broker_apply)。0-key 不变 (onboard 不碰资金)。
bot.command('broker', async (ctx) => {
  initLang(ctx);
  const lang = getLang(ctx);
  const tgUser = String(ctx.from.id);
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  let status = null;
  if (addr) {
    const r = await api.brokerOnboardStatus(addr);
    // Bettor #izjcun.1: 传输失败之前 status 保持 null, 落到 brokerRole() 最后一个 else 分支——对一个已
    // approved 的 broker 显示"申请步骤"文案(暗示还没申请), 比"暂无数据"更误导。传输失败必须单独短路.
    if (api.isTransportFailure(r)) return ctx.reply(t(lang, 'service_busy'));
    if (r.ok) status = r.json;
  }
  // T2 (2026-06-27): fetch earnings summary for approved brokers to show inline (non-broker = skip).
  let earnings = null;
  if (addr && status?.onboarded && status.status === 'approved') {
    const er = await api.brokerEarningsByAddress(addr);
    if (er.ok && er.json?.ok) earnings = er.json;
  }
  return ctx.reply(M.brokerRole({ addr, status, earnings }, lang), { disable_web_page_preview: true });
});
// /earnings — broker 收益统计 + T4 node 委员收益 (Owner 钦定 2026-06-22 DM 显): address-keyed.
// T4 (2026-06-27): 如地址对应本机 relay (节点 operator), 额外显示委员 fee 分成。
bot.command('earnings', async (ctx) => {
  initLang(ctx);
  const lang = getLang(ctx);
  const tgUser = String(ctx.from.id);
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  if (!addr) return ctx.reply(t(lang, 'earnings_no_link'));
  const r = await api.brokerEarningsByAddress(addr);
  if (!r.ok || !r.json?.ok) return ctx.reply(t(lang, 'earnings_fail', { error: r.json?.error || r.status }));
  // T4: 同时尝试查 node 收益 (链路: 地址→relay→pubkey→node/income, 全静默失败)
  let nodeIncome = null;
  try {
    const rf = await api.relayFind(addr);
    if (rf.ok && rf.json?.relay_id) {
      const pkR = await api.relayPubkey(rf.json.relay_id);
      if (pkR.ok && pkR.json?.x_only_pubkey) {
        const ni = await api.nodeIncomeByPk(pkR.json.x_only_pubkey);
        if (ni.ok && ni.json?.ok) nodeIncome = ni.json;
      }
    }
  } catch {}
  return ctx.reply(M.brokerEarnings(r.json, nodeIncome, lang), { disable_web_page_preview: true });
});
// /broker_apply <bot token> — 提交 broker 自助申请 (地址制): broker_address = 用户 /link 地址,
// bot_token = 用户自己的 @BotFather token (加密落库, 永不外显)。提交即激活 (Owner 2026-07-04 钦定
// 测试网无许可自由进出, 移除人工审批门, 见 kanet-broker.js onboard endpoint)。
bot.command('broker_apply', async (ctx) => {
  initLang(ctx);
  const lang = getLang(ctx);
  const tgUser = String(ctx.from.id);
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  if (!addr) return ctx.reply(t(lang, 'broker_apply_no_link'));
  const token = (ctx.match || '').trim();
  if (!token || token.length < 20) return ctx.reply(t(lang, 'broker_apply_usage'));
  const r = await api.brokerOnboardApply({ address: addr, token, username: ctx.from.username ? '@' + ctx.from.username : undefined });
  if (!r.ok || !r.json?.ok) return ctx.reply(t(lang, 'broker_apply_fail', { error: r.json?.error || r.status }));
  return ctx.reply(t(lang, 'broker_apply_ok', { addr }));
});
bot.command('bet',  async (ctx) => ctx.reply(await PM.startBet(String(ctx.from.id), brokerRelayId)));  // S-C: in-chat 编号菜单 — broker-scoped (only this broker's 经手 markets)
// Bettor r78 ① — /mybets: 列自己押注 + 赢/输/退款状态 (= J2 r126 my-positions wire).
// Bettor r87 ③ 续 — 每 open position 加 inline-keyboard '➕ 加注/反手' (防流失, callback 接 startBetFromMarket).
// #18 (2026-07-05): 具名函数, /mybets 命令 + /start 精简后"📋 我的下注"按钮共用。
async function mybetsHandler(ctx) {
  initLang(ctx);
  const lang = getLang(ctx);
  const tgUser = String(ctx.from.id);
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  const text = await PM.formatMyBets(addr, lang);
  const buttons = await PM.buildMyBetsKeyboard(addr, lang);
  if (buttons.length === 0) return ctx.reply(text);
  // grammy reply_markup 直接传 — 每按钮 1 行, 简洁
  return ctx.reply(text, {
    reply_markup: { inline_keyboard: buttons.map(b => [{ text: b.label, callback_data: b.callback_data }]) },
  });
}
bot.command('mybets', mybetsHandler);

// 世界杯玩法 UI (Bettor 2026-07-04, 不依赖 G1) — /record: 精简战绩卡(胜率+净盈亏), 跟 /mybets
// 逐笔列表是两回事, 复用同一份 my-positions 数据.
bot.command('record', async (ctx) => {
  initLang(ctx);
  const lang = getLang(ctx);
  const tgUser = String(ctx.from.id);
  const addr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address;
  return ctx.reply(await PM.formatRecordCard(addr, lang));
});

// 世界杯冠军长线盘 UI 壳 (Bettor 2026-07-04): 数据无关, J2 走 create-v07 建新盘前 count=0 走空态,
// 建好后本命令直接就能显示(靠 console-api.mjs championMarkets 的 ?tag=champions 过滤).
bot.command('champions', async (ctx) => {
  initLang(ctx);
  const lang = getLang(ctx);
  const r = await api.championMarkets(20);
  // 查漏补缺(2026-07-04): 之前网络失败(r.ok=false)跟"确实没有冠军盘"(r.json.ok但markets=[])共用
  // 同一条'暂无'文案——后端瞬时故障时用户会以为盘真的没了(永久性语气), 不是"再试一次"。/hot 早就
  // 用 hot_fail 区分了这两种情况, /champions 漏做, 现在对齐.
  if (!r.ok) return ctx.reply(t(lang, 'champions_fail'));
  if (!r.json?.ok) return ctx.reply(t(lang, 'champions_empty'));
  const result = M.championMarkets(r.json.markets || [], lang);
  if (result.keyboard) return ctx.reply(result.text, { reply_markup: result.keyboard });
  return ctx.reply(result.text);
});

// Bettor r87 ③ — '➕ 加注/反手' callback handler: 进该 market 的 detail stage (= 跳过类目/市场选).
bot.callbackQuery(/^mybet:addmore:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const marketId = ctx.match[1];
  const reply = await PM.startBetFromMarket(String(ctx.from.id), marketId);
  // Bettor #j1nlmx: typeof null==='object' 陷阱, 加 reply && 短路 (同 line82/401/413 同款修法)。
  if (reply && typeof reply === 'object' && reply.text) {
    await ctx.reply(reply.text, { reply_markup: reply.keyboard });
  } else {
    await ctx.reply(reply);
  }
});

// /start 热门市场按钮 callback — callback_data='bet:market:<id>' → 市场详情+押注按钮.
bot.callbackQuery(/^bet:market:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  initLang(ctx);
  const reply = await PM.startBetFromMarket(String(ctx.from.id), ctx.match[1]);
  // Bettor #j1nlmx: typeof null==='object' 陷阱, 加 reply && 短路。
  if (reply && typeof reply === 'object' && reply.text) {
    await ctx.reply(reply.text, { reply_markup: reply.keyboard });
  } else {
    await ctx.reply(reply);
  }
});

// 详情页 YES/NO 押注按钮 callback — callback_data='bet:side:1'(YES)/'bet:side:2'(NO) → 复用 handleReply 进金额输入流程.
bot.callbackQuery(/^bet:side:(1|2)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  initLang(ctx);
  const lang = getLang(ctx);
  const tgUser = String(ctx.from.id);
  const reply = await PM.handleReply(tgUser, ctx.match[1], PM.getLinkedAddr(tgUser));
  // Bettor #j1nlmx(2026-07-13, 实stack trace复现: TypeError in middleware, typeof null==='object' 骗过
  // 了旧 guard, reply.text 真崩, 被 bot.catch 吞掉=用户点 YES/NO 零反应): 加 reply && 短路防崩溃(止血)+
  // reply 为 null/undefined 时(会话丢失, 如 bot 重启清了 in-mem session)显式告知, 不再默默什么都不做
  // (崩溃 vs 静默失败对用户体感一样是"点了没用", 必须两条路都堵)。
  if (reply && typeof reply === 'object' && reply.text) {
    await ctx.reply(reply.text, { reply_markup: reply.keyboard });
  } else if (reply) {
    await ctx.reply(reply);
  } else {
    await ctx.reply(t(lang, 'bet_session_expired'));
  }
});
bot.command('discover', (ctx) => { initLang(ctx); return ctx.reply(t(getLang(ctx), 'discover_text')); });

// /hot (Owner 热需求 2026-06-27): 热门市场 Top5. 换 availableMarkets(raw<50 滤满盘·同 /start 口径).
// startBetFromMarket guard 是 catch-all (任何入口按钮都过); /hot 源换是额外 UX 保障.
// #18 (2026-07-05): 具名函数, /hot 命令 + /start 精简后"🎲 去押注"按钮共用(复用现有 available
// markets 浏览流程, 不新造入口, 见 J2 review)。
async function hotHandler(ctx) {
  initLang(ctx);
  const lang = getLang(ctx);
  const r = await api.availableMarkets(5);
  if (!r.ok || !r.json?.ok) return ctx.reply(t(lang, 'hot_fail'));
  const result = M.hotMarkets(r.json.markets || [], CONFIG.botUsername, lang);
  if (result.keyboard) {
    return ctx.reply(result.text, { reply_markup: result.keyboard });
  }
  return ctx.reply(result.text);
}
bot.command('hot', hotHandler);

// 用户反馈通道卡A (2026-07-12, tg-side-design.md §1): /support = 显式引导入口(展示说明+示例问法),
// 不自己处理自由文本——用户后续直接打字走 message:text 兜底(§1 point 2, 同一接入点承接).
bot.command('support', (ctx) => { initLang(ctx); return ctx.reply(t(getLang(ctx), 'support_intro')); });

// 用户反馈通道卡A 核心分发: 身份锚定(H2, §2)+限流(N2, §5)+桥接 console 卡B → 展示回复.
// 升级(escalated)时 console 已写好工单+events 行(§4 硬门), 这里只负责展示 Owner 已批的定稿文案
// (§7)——不采信 LLM 自己对升级场景的即兴措辞, 用户看到的"已开工单"承诺必须是这句写死的话.
async function feedbackAgentHandler(ctx, tgUser, lang, txt) {
  if (feedbackRateLimited(tgUser)) {
    return ctx.reply(t(lang, 'support_rate_limited'));
  }
  const linkedAddr = PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address || null;
  const r = await api.feedbackReply(tgUser, linkedAddr, null, txt);
  if (!r.ok || !r.json?.ok) {
    return ctx.reply(t(lang, 'support_fail'));
  }
  const j = r.json;
  if (j.escalated && j.ticketId) {
    return ctx.reply(t(lang, 'support_escalated', { ticket_id: j.ticketId.slice(0, 8) }));
  }
  return ctx.reply(j.reply || t(lang, 'support_fail'));
}

// #18 nav buttons (2026-07-05, Owner /start 精简批): /start 首页 4 按钮里 3 个复用命令同款逻辑
// (领水/我的下注/去押注), 只是入口从打字变成点按钮——按钮回调必须先 answerCallbackQuery(否则
// Telegram 客户端一直转圈), 再走跟命令一样的 handler(单源, 不复制业务逻辑)。
bot.callbackQuery('nav:faucet', async (ctx) => { await ctx.answerCallbackQuery(); return faucetHandler(ctx); });
bot.callbackQuery('nav:mybets', async (ctx) => { await ctx.answerCallbackQuery(); return mybetsHandler(ctx); });
bot.callbackQuery('nav:hot', async (ctx) => { await ctx.answerCallbackQuery(); return hotHandler(ctx); });

// S-C menu navigation — plain-text numeric replies advance the bet flow (commands handled above).
bot.on('message:text', async (ctx) => {
  const tgUser = String(ctx.from.id);
  initLang(ctx);
  const lang = getLang(ctx);
  const txt = ctx.message?.text || '';
  if (txt.startsWith('/')) return;            // commands handled by bot.command
  if (PM.inBetFlow(tgUser)) {
    // Bettor r63 ①: 优先从持久 link store 取 (= 抗 bot 重启), in-mem 退化 fallback.
    const reply = await PM.handleReply(tgUser, txt, PM.getLinkedAddr(tgUser) || linked.get(tgUser)?.address);
    if (reply) {
      // Bettor r116 + KANet-UI: prediction-menu confirm 阶段返 { text, parseMode } 支持 HTML.
      // T1 (2026-06-27): detail 阶段额外返 { keyboard } — 市场详情分享按钮.
      // Bettor #j1nlmx: 这处已被外层 `if (reply)` 挡过 null, 本身安全; 加 reply && 只为跟其余 4 处
      // 视觉一致(同一个文件出现 5 处同款写法, 4 处修了 1 处不修容易让后人以为漏了一处)。
      if (reply && typeof reply === 'object' && reply.text) {
        await ctx.reply(reply.text, { parse_mode: reply.parseMode, reply_markup: reply.keyboard });
      } else {
        await ctx.reply(reply);
      }
    }
    return;
  }
  // Bettor r8 即时止血: 用户输看似押注续单的词 (确认/yes/纯数字), 但本地已无 bet 流程态
  // (bot 重启 / 会话超时), 明示而非甩裸菜单, 避免用户以为「确认」生效付了钱。
  const tl = (txt || '').trim().toLowerCase();
  if (tl === '确认' || tl === 'yes' || tl === 'y' || /^[0-9]+$/.test(tl)) {
    return ctx.reply(t(lang, 'stale_session'));
  }
  // 用户反馈通道卡A (2026-07-12, tg-side-design.md §1 point 2): generic_help 死路改接反馈 agent.
  // 上面两道守卫(PM.inBetFlow / 确认-yes-数字 stale session)保持在前不动.
  await feedbackAgentHandler(ctx, tgUser, lang, txt);
});

// S1 reactive notification poller — only polls addresses a user explicitly /link'd (opt-in).
async function pollLoop() {
  // Seed from PM-persisted linked users so DMs fire after bot restart (linked Map is ephemeral).
  for (const u of PM.listLinkedUsers()) {
    if (!linked.has(String(u.tgUser))) {
      linked.set(String(u.tgUser), { address: u.address, lastTs: Date.now() - 300_000 });
    }
  }
  for (const [tgUser, st] of linked) {
    const r = await api.eventsSince(st.address, st.lastTs);
    const evs = r.json?.events || [];
    const uLang = PM.getUserLang(tgUser);
    for (const ev of evs) { try { await bot.api.sendMessage(tgUser, M.notifyLine(ev, uLang)); } catch {} }
    if (evs.length) { const last = Date.parse(evs[evs.length - 1].observed_at); if (last) st.lastTs = last; }
  }
}
// pollLoop interval moved into startBot() (below).

// S-C stage5 — poll backend confirm for users awaiting on-chain bet payment (design LOCKED Bettor r263).
// confirm runs server-side 3-validation (dest==side_p2sh + amount==exact_sompi + UNIQUE tx) → insert pool_bettor_sides.
// 0-custody: bot only reports + notifies; it never moves funds. Stops watching past the market deadline.
export async function pollPendingBets() {
  const nowSec = Date.now() / 1000;
  for (const p of PM.listPendingPayments()) {
    const uLang = PM.getUserLang(p.tgUser);
    if (p.deadline && nowSec > p.deadline) {
      PM.clearPendingPayment(p.tgUser);
      try { await bot.api.sendMessage(p.tgUser, t(uLang, 'poll_deadline_passed')); } catch {}
      continue;
    }
    // Bettor r63 ② guard: pending 缺 linkedAddr (= 老历史 pending in v0 in-mem 丢的) → 反馈用户而非 silent poll.
    if (!p.linkedAddr) {
      PM.clearPendingPayment(p.tgUser);
      try { await bot.api.sendMessage(p.tgUser, t(uLang, 'poll_no_linkedaddr')); } catch {}
      continue;
    }
    const r = await api.poolRegisterConfirm(p.marketId, { linkedAddr: p.linkedAddr, direction: p.direction, stakeKas: p.stakeKas, protocolVersion: p.protocolVersion, betId: p.betId });
    const j = r.json || {};
    if (r.ok && (j.registered || j.already_registered || j.side_lock_tx || j.merkle_index != null)) {
      PM.clearPendingPayment(p.tgUser);
      try { await bot.api.sendMessage(p.tgUser, t(uLang, 'poll_registered', { side: p.side, kas: (p.exact_sompi / 1e8).toFixed(8), question: PM.specTitle(p.question) || p.market_id || '' })); } catch {}
    } else if (j.wrong_payment_detected) {
      // 错付被检测到 — 金额不符无法入账, 且少付会被合约永久锁死 (J2/Bettor 裁决). 诚实披露, 停止盯。
      PM.clearPendingPayment(p.tgUser);
      try { await bot.api.sendMessage(p.tgUser, t(uLang, 'poll_wrong_payment')); } catch {}
    } else if (!r.ok && typeof j.error === 'string' && /linked.addr|linkedAddr/i.test(j.error)) {
      // Bettor r63 ③ 不静默: confirm 端硬错 (linked_addr 缺/无效) → 通知用户重 /link, 停盯.
      PM.clearPendingPayment(p.tgUser);
      try { await bot.api.sendMessage(p.tgUser, t(uLang, 'poll_linkedaddr_error', { error: j.error })); } catch {}
    } else if (r.ok && j.pending === true) {
      // 真·还在等付款落地检测(confirm 端点明确说'还没查到这笔付款') — 正常状态, 不计入失败, 继续静默 poll.
      PM.resetPendingPaymentFailCount(p.tgUser);
    } else {
      // 根治(2026-07-08, KANet-UI grep 坐实 7291bd66 死循环案例, Owner "查根因根治" 指令): 走到这里的情况
      // (!r.ok 的其它错误 / j.ambiguous 等) 之前被静默当成"还在等付款"无限重试——但这些是 confirm 端点
      // 明确报了"这次调用本身出问题"(不是"还没检测到付款"), 无熔断重试会像 KANet-UI 实测的那样卡 6 小时+。
      // 达到阈值(20 次连续真错误, ~1 分钟 @3s poll interval, 容忍短暂 tip-lag 抖动)后停止重试 + 诚实告知
      // 用户资金没丢但需要人工处理 + LOUD console.error 供 ops 发现(不是静默失败)。
      const fc = PM.bumpPendingPaymentFailCount(p.tgUser);
      if (fc >= 20) {
        console.error(`[pollPendingBets] 🔴 STUCK: tgUser=${p.tgUser} market=${p.marketId} betId=${String(p.betId).slice(0, 8)} confirm 连续失败 ${fc} 次(${(fc * (CONFIG.pendingBetPollMs || 3000) / 1000).toFixed(0)}s), 停止自动重试. last error: ${JSON.stringify(j).slice(0, 200)}`);
        PM.clearPendingPayment(p.tgUser);
        try { await bot.api.sendMessage(p.tgUser, t(uLang, 'poll_registration_stuck', { question: PM.specTitle(p.question) || p.marketId || '' })); } catch {}
      }
      // 未到阈值: 继续静默 poll(容忍偶发抖动), 不打扰用户.
    }
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
      const uLang = PM.getUserLang(u.tgUser);
      for (const marketId of fresh) {
        const p = terminal.find(x => x.market_id === marketId);
        if (!p) continue;
        let msg;
        const question = PM.specTitle(p.question) || p.market_id;
        if (p.settle_txid) {
          // Bettor r76 F-N1 fix: use server-derived did_win (= my_direction === outcome_winner)
          // instead of p.claim_txid (= empty for happy-path winners since settle_via_spine pays direct).
          if (p.did_win === true) {
            msg = t(uLang, 'poll_win', { question, side: p.my_side, stake: p.stake_kas, payout: p.actual_payout_kas, tx: p.settle_txid.slice(0, 16) });
          } else if (p.did_win === false) {
            msg = t(uLang, 'poll_lose', { question, outcome: p.outcome_side, side: p.my_side, stake: p.stake_kas, tx: p.settle_txid.slice(0, 16) });
          } else {
            // outcome_winner 还没写入 metadata (= 还在收集签名/早) — 给中性话, 等下一轮 poll.
            msg = t(uLang, 'poll_neutral', { question, side: p.my_side, stake: p.stake_kas, tx: p.settle_txid.slice(0, 16) });
          }
        } else if (p.refund_txid) {
          msg = t(uLang, 'poll_refund', { question, tx: p.refund_txid.slice(0, 16) });
        }
        if (msg) { try { await bot.api.sendMessage(u.tgUser, msg); } catch {} }
      }
    } catch {}
  }
}

// KANet-UI 2026-06-28: broker fee DM poller — Phase 1: 托管/link 地址的 broker.
// 轮询 /api/pool/broker-fee-dm?since=<ms>, 对每笔新落链 fee 向 tg_user_id 发 DM.
// 去重: brokerFeeTs 游标持久化 (_state.json via PM), 重启后续单.
// B1 fix (NWT 红队): 只在 sendMessage 成功后前进游标; 失败 log+break → 下次 tick 重试同一批.
async function pollBrokerFeeEvents() {
  const sinceMs = PM.getBrokerFeeTs() || (Date.now() - 60_000);
  const r = await api.brokerFeeDmEvents(sinceMs);
  if (!r.ok) return;
  const evs = r.json?.events || [];
  for (const ev of evs) {
    const msg = M.brokerFeeDmText(ev, PM.getUserLang(String(ev.tg_user_id)));
    try {
      await bot.api.sendMessage(ev.tg_user_id, msg);
      PM.setBrokerFeeTs(new Date(ev.observed_at).getTime() + 1);  // 只在成功后前进
    } catch (e) {
      console.warn(`[broker-DM] sendMessage fail uid=${ev.tg_user_id} fee=${ev.fee_sompi}: ${e.message}`);
      break;  // 停住游标·下次 tick 重试
    }
  }
}

// KANet-UI 2026-06-13: runtime side-effects (Telegram poller + the 3 background pollers, which can send
// real messages) live in startBot() so `import`ing this module (e.g. from a test) registers the handlers
// WITHOUT going live. _launch_tg_bot.mjs calls startBot(); tests import { bot } and feed bot.handleUpdate().
export async function startBot() {
  // 根治(2026-07-08): 真正开始服务用户前先校验 CONFIG.botUsername(见 config.mjs verifyAndSyncBotUsername
  // 注释) —— 覆写发生在这里, bot.start() 之后所有分享链接/消息构造读的都是校验后的真值。
  await verifyAndSyncBotUsername();
  setInterval(async () => { brokerRelayId = await resolveBrokerRelayId(); }, CONFIG.brokerRefreshMs);
  // 2026-07-20 08:5x 修复(Owner 报重复中奖通知坐实): 这几个 poller 原来没有 re-entry guard,
  // 一轮跑得比 pollMs 长(今晚链上活动重时会发生)就会跟下一轮并发——pollSettleResults 内部
  // pickFreshSettlements 是经典 read-check-then-write, 两个并发轮都读到"还没通知过"就都推送,
  // seen_settled 数组也跟着写进两条重复项(85fit-s0 精确复现)。guardedInterval 保证同一个函数
  // 任意时刻只有一轮在跑, 上一轮没完下一轮直接跳过(跟 settle-daemon 的 "prev tick still running
  // skip" 同款模式)。
  const guardedInterval = (fn, ms) => {
    let running = false;
    setInterval(async () => {
      if (running) return;
      running = true;
      try { await fn(); } catch {} finally { running = false; }
    }, ms);
  };
  guardedInterval(pollLoop, CONFIG.pollMs);
  guardedInterval(pollPendingBets, CONFIG.pendingBetPollMs);  // #28: fast poll (3s default) — protects in-flight custodial bet payments from defrag window
  guardedInterval(pollSettleResults, CONFIG.pollMs);
  guardedInterval(pollBrokerFeeEvents, CONFIG.pollMs);
  bot.start();
  console.log('[tg-bot] @' + CONFIG.botUsername + ' up (broker=' + (brokerRelayId || 'UNSET — set in Console Settings') + ', 0-key / deep-link only)');
}

export { bot };
