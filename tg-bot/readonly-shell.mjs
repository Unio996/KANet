// readonly-shell.mjs — 电报口子接主网(只读壳)的纯函数层。设计: docs/2026-09-20-kanetui-tg-bot-mainnet-relaunch-and-proto-v0-repoint-change-note-v0.1.md §2 P1 / §3.2 字段对照;
// 样图(Owner 定稿前不含最终措辞): docs/2026-09-20-kanetui-tg-bot-user-copy-samples-v0.1.md。
//
// 🔴 只含【逻辑】: 所有可见字符串都经 t(lang, 'ro_*' 键) 取——键的措辞是另一笔(B, 等 Owner 定稿)。测试注入假 t, 只断言"用了哪个键+传了什么变量", 不依赖措辞。
// 🔴 只读: 没有任何写调用、没有下注/钱包/转账入口。数据只来自 GET /api/proto-markets(见 console-api.mjs protoMarkets)。
// 🔴 字段白名单(变更说明 §3.2): 公开路由会顺带返回委员会公钥 / rootclose / shardleaf / payout_root / *_txid——这里只取
//    id/question/status/deadline_ms/min_bet/token_name/token_ticker/winning_side(+judged 判定题信息), 其余一律不进渲染层。
// 🔴 三处单位/编码陷阱: deadline_ms 是【毫秒】(bot 旧代码是秒); 押注额单位是【代币】不是 KAS; winning_side 0=YES / 1=NO(旧 pool 是 1/2)。
import { t as realT } from './i18n.mjs';
import { prefixForNetwork, addressPrefix } from '../shared/lib/kaspa-network.mjs';

/** 只读壳只在主网启用(TN12 已退役, 其行为原样保留): 判据 = bot 配置的网络。 */
export function isReadonlyShell(cfg) { return !!cfg && cfg.network === 'mainnet'; }

/** proto 市场状态 → 用户可见状态。genesis_* 与未知值一律 'hidden'(内部态不展示)。 */
export function protoStateOf(status) {
  switch (status) {
    case 'betting': return 'open';
    case 'sealed': return 'sealed';
    case 'resolved': return 'settled';
    case 'cancelled': return 'cancelled';
    default: return 'hidden';
  }
}

/**
 * winning_side → 'YES'|'NO'|null。
 *  · 非判定题(无 judged): 0=YES / 1=NO(operator 市场的下注方向编码, 见 api/proto.js:242)。
 *  · 判定题(有 judged): 按 judged.side_map({"yes":0|1,"no":1|0}, label→side 双射)换算——side_map 可能是 {yes:1,no:0}, 直接套 0=YES 会显反赢家;
 *    side_map 缺失/非法 ⇒ null(不猜, 由渲染层显"已结算"不带结果)。
 *  其它(null/undefined/2…)⇒ null。
 */
export function resultLabel(winningSide, judged) {
  if (winningSide !== 0 && winningSide !== 1) return null;
  if (judged == null) return winningSide === 0 ? 'YES' : 'NO';
  const sm = judged && typeof judged === 'object' ? judged.side_map : null;
  if (!sm || typeof sm !== 'object') return null;
  const y = sm.yes, n = sm.no;
  if (!((y === 0 || y === 1) && (n === 0 || n === 1) && y !== n)) return null;
  return y === winningSide ? 'YES' : 'NO';
}

// \u987A\u5E8F load-bearing(S3\u00B7SHOULD): \u5148\u5265\u4E0D\u53EF\u89C1/\u683C\u5F0F\u5B57\u7B26(\u663E\u5F0F\u6BB5 + \u6574\u4E2A Unicode Cf \u7C7B: \u8F6F\u8FDE\u5B57\u7B26/\u963F\u62C9\u4F2F\u683C\u5F0F\u7B26/tag \u5B57\u7B26\u2026)\u3001\u518D\u5265 URL\u2014\u2014\u5426\u5219 "ht\u200Btp://x" \u8FD9\u7C7B\u88AB\u96F6\u5BBD\u5B57\u7B26\u5207\u5F00\u7684\u94FE\u63A5\u8EB2\u8FC7 URL \u5265\u79BB\u3001\u968F\u540E\u4E0D\u53EF\u89C1\u5B57\u7B26\u88AB\u5220\u53C8\u62FC\u56DE\u6D3B\u94FE\u63A5\u3002
const cleanText = (s) => String(s == null ? '' : s).replace(/[\u202A-\u202E\u2066-\u2069\u200B-\u200F\u2060\uFEFF]/g, '').replace(/\p{Cf}/gu, '').replace(/https?:\/\/\S+/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
export const QUESTION_MAX_DETAIL = 300;
export const truncate = (s, n) => { const x = cleanText(s); return x.length > n ? x.slice(0, n - 1) + '…' : x; };

/** 白名单映射: 一行 proto 市场 → bot 渲染用的最小对象(deadline 已转秒)。id 缺失/非字符串 ⇒ null。 */
export function toBotMarket(row) {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) return null;
  const dl = Number(row.deadline_ms);
  const out = {
    id: row.id,
    question: cleanText(row.question),
    state: protoStateOf(row.status),
    deadlineSec: Number.isFinite(dl) && dl > 0 ? Math.floor(dl / 1000) : null,
    minBet: Number.isFinite(Number(row.min_bet)) ? Number(row.min_bet) : null,
    tokenTicker: cleanText(row.token_ticker),
    tokenName: cleanText(row.token_name),
    result: protoStateOf(row.status) === 'settled' ? resultLabel(row.winning_side, row.judged) : null,
  };
  return out;
}

/** 列表可见集: 去掉 cancelled / hidden; 进行中(截止近的在前)→ 已封盘 → 已结算(新的在前, 用 id 稳定排序); 最多 limit 条。 */
export function visibleMarkets(rows, { limit = 8 } = {}) {
  const ms = (Array.isArray(rows) ? rows : []).map(toBotMarket).filter((m) => m && m.state !== 'cancelled' && m.state !== 'hidden');
  const rank = { open: 0, sealed: 1, settled: 2 };
  ms.sort((a, b) => (rank[a.state] - rank[b.state]) || (a.state === 'open' ? (a.deadlineSec ?? Infinity) - (b.deadlineSec ?? Infinity) : 0));
  return ms.slice(0, Math.max(0, limit));
}

/** 距截止还有多久 → 文案: null(无截止)/ 已过 / 不足 1 小时按分钟(向上取整, 至少 1 分钟)/ 否则按小时(向上取整)。之前 Math.round: 还剩 29 分显"已过截止"、31–89 分显"1 小时"。 */
function whenText(t, lang, deadlineSec, nowMs) {
  if (deadlineSec == null) return null;
  const left = deadlineSec * 1000 - nowMs;
  if (left <= 0) return t(lang, 'ro_when_expired');
  if (left < 3600000) return t(lang, 'ro_when_minutes', { m: Math.max(1, Math.ceil(left / 60000)) });
  return t(lang, 'ro_when_hours', { h: Math.ceil(left / 3600000) });
}

/** 一行摘要(列表/热门用): 键与变量只由状态决定。 */
export function marketLine(m, lang, { t = realT, nowMs = Date.now(), qMax = 56 } = {}) {
  const q = truncate(m.question, qMax);
  if (m.state === 'open') {
    return t(lang, 'ro_line_open', { q, when: whenText(t, lang, m.deadlineSec, nowMs) ?? '' });
  }
  if (m.state === 'sealed') return t(lang, 'ro_line_sealed', { q });
  return m.result ? t(lang, 'ro_line_settled', { q, result: m.result }) : t(lang, 'ro_line_settled_noresult', { q });
}

/** /bet 列表: 文本 + 每个市场一个详情按钮(callback_data 只带 id 前缀 16 位——Telegram 限 64 字节, 完整 64 位 id 放不下)。 */
export function formatMarketList(markets, lang, { t = realT, nowMs = Date.now(), titleKey = 'ro_list_title' } = {}) {
  if (!markets || !markets.length) return { text: t(lang, 'ro_list_empty'), keyboard: null };
  const lines = [t(lang, titleKey, { n: markets.length }), ''];
  markets.forEach((m, i) => lines.push(`${i + 1}. ${marketLine(m, lang, { t, nowMs })}`));
  lines.push('', t(lang, 'ro_list_footer'));
  const keyboard = { inline_keyboard: markets.map((m, i) => [{ text: `${i + 1}. ${truncate(m.question, 28)}`, callback_data: `ro:m:${m.id.slice(0, 16)}` }]) };
  return { text: lines.join('\n'), keyboard };
}

/** 详情页: 无任何下注按钮/入口。 */
export function formatMarketDetail(m, lang, { t = realT, nowMs = Date.now() } = {}) {
  if (!m) return { text: t(lang, 'ro_detail_not_found'), keyboard: null };
  const stateKey = m.state === 'settled' && !m.result ? 'ro_state_settled_noresult' : `ro_state_${m.state}`;
  const lines = [t(lang, 'ro_detail_title', { q: truncate(m.question, QUESTION_MAX_DETAIL) }), t(lang, stateKey, { result: m.result || '' })];   // 题干设上限(SHOULD #2): 详情页不无限回显
  if (m.state === 'open') lines.push(t(lang, 'ro_detail_deadline', { when: whenText(t, lang, m.deadlineSec, nowMs) ?? '?' }));
  if (m.minBet != null) lines.push(t(lang, 'ro_detail_min_bet', { n: m.minBet, ticker: m.tokenTicker || m.tokenName || '' }));
  lines.push(t(lang, 'ro_detail_no_bet'));
  return { text: lines.join('\n'), keyboard: null };
}

/** 按 id 前缀(>=8 位)在市场行里找唯一一条; 0 条或多条都返回 null(不猜)。 */
export function findByIdPrefix(rows, prefix) {
  const p = String(prefix || '').toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(p)) return null;
  const hits = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.id === 'string' && r.id.toLowerCase().startsWith(p));
  return hits.length === 1 ? hits[0] : null;
}

/** /link 输入预判(纯字符串, 不碰 wasm): 只看"是不是本网络前缀 + 字符集"; 校验和由 console 权威判(返回 code)。 */
export function classifyLinkInput(addr, network) {
  let want;
  try { want = prefixForNetwork(network); } catch { return { ok: false, reason: 'usage' }; }   // 未知网络 ⇒ fail-closed
  const a = String(addr == null ? '' : addr);
  if (new RegExp(`^${want}:[a-z0-9]+$`).test(a)) return { ok: true };
  const p = addressPrefix(a);
  if (p && p !== want && /^kaspa[a-z]*$/.test(p)) return { ok: false, reason: 'wrong_network' };
  return { ok: false, reason: 'usage' };
}

/** console 拒绝码 → 用户可见键(未知码 ⇒ null, 由调用方走既有 link_fail)。 */
export function linkRejectKey(code) {
  if (code === 'prefix-mismatch') return 'ro_link_wrong_network';
  if (code === 'invalid-checksum') return 'ro_link_invalid';
  return null;
}

/**
 * F2(NWT 审后修): 主网只读壳启动清理的【纯函数】——让 /start 那句"旧的绑定与会话已重置"名副其实。
 *  · linkedAddrs(条目 [tgUser, {address,...}]): 只保留地址前缀 == wantPrefix(主网 kaspa)的绑定; 前缀不符(TN12 时代的 kaspatest 等)或缺地址的丢弃。
 *  · sessions: 全部清空(TN12 时代残留的下注会话; 只读壳没有会话流程)。
 *  · pendingPayments: 【不改】——它是"等待链上付款"的监控队列, 清掉 = 丢监控; 只回报数量, 调用方 LOUD 提示(上线前应为 0)。
 * 返回新的 { linkedAddrs, sessions } 与统计。不做任何 I/O。
 */
export function pruneStateForMainnet({ linkedAddrs = [], sessions = [], pendingPayments = [] } = {}, wantPrefix) {
  const keep = [];
  let droppedLinks = 0;
  for (const e of Array.isArray(linkedAddrs) ? linkedAddrs : []) {
    const addr = e && e[1] && typeof e[1] === 'object' ? e[1].address : null;
    if (typeof addr === 'string' && addressPrefix(addr) === wantPrefix) keep.push(e); else droppedLinks++;
  }
  return { linkedAddrs: keep, sessions: [], droppedLinks, clearedSessions: Array.isArray(sessions) ? sessions.length : 0, pendingPayments: Array.isArray(pendingPayments) ? pendingPayments.length : 0 };
}
