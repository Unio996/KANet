// S-C: in-chat 编号菜单押注状态机 (Owner r250 pivot — 全程 Telegram, 0 网页跳转).
// J1 S-B contract (frozen r81): GET /api/pool/markets / /market/:id.
// 0-key/0-custody (J1 S5): bot 只读 + 显; 价值步 (stage4-5: escrow 地址 + 用户自钱包付 + 链上检测)
//   待 J2/J1 taker-stake-external backend, 此处先 stub + 错付预防文案.
import * as api from './console-api.mjs';
import { t, detectLang } from './i18n.mjs';
import { CONFIG } from './config.mjs';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, '_state.json');

// Bettor r8 P0 (Owner 14h 后回「确认」→ bot 已重启状态丢 → 走丢): sessions + pendingPayments
// 落盘 _state.json, bot 重启即 reload 续单. awaiting-confirm 与 stage5 付款监控跨重启不丢.
const sessions = new Map();          // stage0-4 menu navigation per tg user
const pendingPayments = new Map();   // stage5 awaiting on-chain payment, poller 域
// Bettor r63 P0 fix ① — link store 必持久化, 否则 bot 重启丢 linkedAddr → pending 里 undefined 字段被
// JSON.stringify drop → confirm 时 linked_addr 缺 → push 上链失败 silent → Owner 500 KAS 类卡死.
const linkedAddrs = new Map();       // tg_user → { address, linked_at } — persists across bot restart
const userLangs = new Map();         // tg_user → 'en'|'zh' — language preference, persists across restart
let brokerFeeTs = 0;                 // global cursor (ms): pollBrokerFeeEvents 起点, 跨重启续单

try {
  if (existsSync(STATE_FILE)) {
    const j = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    for (const [k, v] of (j.sessions || [])) sessions.set(k, v);
    for (const [k, v] of (j.pendingPayments || [])) pendingPayments.set(k, v);
    for (const [k, v] of (j.linkedAddrs || [])) linkedAddrs.set(k, v);
    for (const [k, v] of (j.userLangs || [])) userLangs.set(k, v);
    brokerFeeTs = j.brokerFeeTs || 0;
    console.log(`[prediction-menu] state loaded: ${sessions.size} sessions, ${pendingPayments.size} pending payments, ${linkedAddrs.size} linked addrs`);
  }
} catch (e) { console.warn(`[prediction-menu] state load skipped: ${e.message}`); }

// Bettor r9 F2 (原子写): tmp + rename, 防 writeFileSync 崩在写一半 → _state.json 损坏 → JSON.parse 失败 → 两 Map 全丢。
function _writeAtomic() {
  const data = JSON.stringify({
    sessions: [...sessions.entries()],
    pendingPayments: [...pendingPayments.entries()],
    linkedAddrs: [...linkedAddrs.entries()],
    userLangs: [...userLangs.entries()],
    brokerFeeTs,
  });
  const tmp = STATE_FILE + '.tmp';
  writeFileSync(tmp, data);
  renameSync(tmp, STATE_FILE);  // Node fs.renameSync 在 Windows 也覆盖
}

let _saveTimer = null;
// 菜单导航类 (sessions 翻页) 走 debounce, 高频小写合并; 资金关键步走 persistNow().
function persist() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { _writeAtomic(); } catch (e) { console.warn(`[prediction-menu] state save fail: ${e.message}`); }
  }, 250);
}
// Bettor r9 F1 (资金关键步同步 flush): 「确认押注」→ pendingPayments.set 后必须立刻落盘,
// 不能用 debounce, 否则 250ms 窗口内崩溃 = 刚确认的付款监控丢 = 用户实付也没人盯。
function persistNow() {
  clearTimeout(_saveTimer);
  try { _writeAtomic(); } catch (e) { console.warn(`[prediction-menu] state save fail (sync): ${e.message}`); }
}

const MIN_STAKE_KAS = 1.0;          // pool.js BETTOR_MIN_STAKE_POLICY (anti-bot product floor, Bettor r158 P2-3 LOCK).
const SOMPI_PER_KAS = 1e8;
// G4 防资损 (Bettor r283 LOCK A+/prep 双门): bot 不让用户碰 deadline 近的 market —
// 列表只列 deadline>now+10min, /prep 出地址那步 deadline-now<10min 拒. Owner 100 KAS 卡因.
const DEADLINE_BUFFER_SEC = 600;
function sompiToKasStr(sompi) { return (Number(sompi) / SOMPI_PER_KAS).toFixed(8); }

function fmtDeadline(unixSec, lang) {
  if (!unixSec) return '?';
  const h = Math.round((unixSec * 1000 - Date.now()) / 3600000);
  return h > 0 ? t(lang, 'deadline_hours', { h }) : t(lang, 'deadline_expired');
}

// 列表里截短标题 (resolution_rule_spec 可能含完整结算规则全文, Bettor r256). 详情页给全文.
function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// KANet-UI 2026-06-07 r308: market 出单人 label. backend /api/pool/markets LEFT JOIN relay_nodes
// 返 maker_name; 跨节点 maker (= relay_nodes 本节点无 record) → name=null, fallback 短 id.
function makerLabel(m) {
  if (m && m.maker_name) return m.maker_name;
  if (m && m.maker_relay_id) return '跨节点 ' + String(m.maker_relay_id).slice(0, 8);
  return '?';
}

// KANet-UI 2026-06-03 Bettor 钦点: 显示前 try JSON.parse(spec) — kanet 现有干净格式
// = {title, data_source_canonical, source?}. 是 JSON 显 .title (干净题干). 非 JSON 显 raw.
// KANet-UI 2026-06-07 Track A (Bettor r335 关 1 PASS): fallback URL-strip 兜底
// (= 用户文案绝不漏 127.0.0.1 / data_source_canonical 内部 URL; specTitle export 给 bot.mjs 用)
export function specTitle(spec) {
  if (!spec) return '';
  const s = String(spec).trim();
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s);
      if (typeof obj.title === 'string' && obj.title.trim()) return obj.title.trim();
    } catch {}
  }
  // fallback: 非 JSON 或解析失败 → strip 所有 http(s):// URL 防泄 (= Bettor r335 关 1 'URL-strip fallback' 校准)
  return s.replace(/https?:\/\/\S+/g, '').trim();
}
// 真规则 (resolution_criteria) — 押注前用户必须看到的判定依据。KANet 委员预言机按这条裁决。
function specCriteria(spec) {
  if (!spec) return null;
  const s = String(spec).trim();
  if (!s.startsWith('{')) return null;
  try {
    const obj = JSON.parse(s);
    return (typeof obj.resolution_criteria === 'string' && obj.resolution_criteria.trim()) ? obj.resolution_criteria.trim() : null;
  } catch { return null; }
}
// 质量门槛: spec 必须是干净结构化 JSON 含 title + resolution_criteria + data_source_canonical.
// KANet-UI 2026-06-06 Owner P0 voo3z + qrv65 实证: 缺 resolution_criteria → 用户玩儿毛;
// 缺 data_source_canonical URL → voter deriveVote fail → 市场卡死无法结算.
// **绑死 pool.js isStructuredSpec + voter deriveVote 三端单一源** (Bettor r243 加固): 改时
// pool.js isStructuredSpec + 此 specIsUsable + voter deriveVote kanet_native check 同步.
// Bettor 钦定数据非破坏默认: 糊单不删 (= 留 DB 让自然过期), 只在 bot 入口 filter 掉不显示.
function specDataSourceCanonical(spec) {
  if (!spec) return null;
  const s = String(spec).trim();
  if (!s.startsWith('{')) return null;
  try {
    const obj = JSON.parse(s);
    return (typeof obj.data_source_canonical === 'string' && obj.data_source_canonical.trim()) ? obj.data_source_canonical.trim() : null;
  } catch { return null; }
}
function specIsUsable(spec) {
  return specTitle(spec) && specCriteria(spec) && specDataSourceCanonical(spec);
}
// HTML escape: bot 发送 parse_mode='HTML' 时必 esc (< > &), 防 URL/HTML 渲染崩.
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Bettor r82 ② — 句子/词边界截断, 不破词中间. 优先句号/逗号/空格回退.
function truncSmart(s, n) {
  s = String(s || '');
  if (s.length <= n) return s;
  const slice = s.slice(0, n);
  const m = slice.match(/^(.*?)(?:[。.!?,，;； ]|\s)[^。.!?,，;； \s]*$/);
  const cut = m ? m[1] : slice;
  return (cut.length > 0 ? cut : slice).replace(/[\s,，。.!?;；]+$/, '') + '…';
}
// Bettor r82 ① — 锁仓时间显示 (SQLite created_at TEXT '2026-05-30 14:18:32' → 用户友好格式)
function fmtLockedAt(s) {
  if (!s) return '';
  const t = String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z');
  const d = new Date(t);
  if (Number.isNaN(+d)) return String(s);
  // 显示 "MM-DD HH:mm" 本地化 — 桌面浏览器/手机均可读
  const pad = n => n < 10 ? '0' + n : '' + n;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Bettor r78 ① — /mybets 命令: 列用户所有押注 + 状态 (押中/已结算赢/输/退款).
// Reads /api/pool/my-positions (= J2 r126 backend). 0-custody read-only.
// Bettor r143/r144 (Owner P0 现场): 同市场多笔押注合并成一条 block, 同 direction 加总.
//   实证 Owner c9b933 在 pg1ab 有 3 单 (NO 2000 + NO 100 + YES 5) → 旧版列 3 条, 新版 1 block:
//   YES 5 KAS (1 笔), NO 2100 KAS (2 笔). 一市场 = 一条 block, 不再每笔 1 条. 后端不动.
//   铁律: 合并显示, 绝不删/清除任何押注行 (后端照样返全部).
export async function formatMyBets(linkedAddr, lang = 'en') {
  if (!linkedAddr) return t(lang, 'mybets_no_link');
  const r = await api.myPositions(linkedAddr);
  if (!r.ok) return t(lang, 'mybets_fail', { error: r.json?.error || r.status });
  const positions = r.json?.positions || [];
  if (!positions.length) return t(lang, 'mybets_empty');

  // 按 market_id 分组保序 (Map 按 insertion order)
  const byMarket = new Map();
  for (const p of positions) {
    if (!byMarket.has(p.market_id)) byMarket.set(p.market_id, []);
    byMarket.get(p.market_id).push(p);
  }

  // KANet-UI 2026-06-06 Owner P0: 用户必须看清三个总数 (投入 / 返回 / 在押) + 明细分布.
  // 投入总 = 所有押注 stake. 返回总 = 已赢实拿 actual_payout + 已退 refund stake. 在押总 = 未结算 stake.
  const totals = {
    stakeInTotal: 0,    // 投入总 = 所有押注 stake (永久不减, 历史输入)
    payoutBackTotal: 0, // 返回总 = 赢实拿 + 退款拿回 (实际收到 KAS)
    stakeOpenTotal: 0,  // 在押总 = 押注中 + 已截止等开奖 + 待入账 (= 还在系统里的钱)
    wonKas: 0,
    lostStakeKas: 0,
    refundKas: 0,
    settledPendingCnt: 0,
    settledPendingStake: 0,
    openCnt: 0,
    openStake: 0,
    awaitingResultCnt: 0,
    awaitingResultStake: 0,
  };
  const nowSec = Math.floor(Date.now() / 1000);
  for (const p of positions) {
    const stake = Number(p.stake_kas) || 0;
    totals.stakeInTotal += stake;
    if (p.settle_txid && p.did_win === true) {
      const payout = Number(p.actual_payout_kas) || 0;
      totals.wonKas += payout;
      totals.payoutBackTotal += payout;
    } else if (p.settle_txid && p.did_win === false) {
      totals.lostStakeKas += stake;
    } else if (p.settle_txid) {
      // settle_txid 有但 did_win 不明 — 链上 settle 了但本地状态未推进
      totals.settledPendingCnt++;
      totals.settledPendingStake += stake;
      totals.stakeOpenTotal += stake;   // 还没拿回, 算在押
    } else if (p.refund_txid) {
      totals.refundKas += stake;
      totals.payoutBackTotal += stake;
    } else if (p.side_lock_tx) {
      if (p.deadline_unix && Number(p.deadline_unix) < nowSec) {
        totals.awaitingResultCnt++;
        totals.awaitingResultStake += stake;
      } else {
        totals.openCnt++;
        totals.openStake += stake;
      }
      totals.stakeOpenTotal += stake;
    }
  }
  const netKas = totals.payoutBackTotal - totals.stakeInTotal;
  const netSign = netKas >= 0 ? '+' : '';
  const lines = [t(lang, 'mybets_header', { n: positions.length, m: byMarket.size })];
  // 三个核心数字 (永显):
  lines.push(t(lang, 'mybets_total_in', { kas: totals.stakeInTotal.toFixed(4) }));
  lines.push(t(lang, 'mybets_total_back', { kas: totals.payoutBackTotal.toFixed(4), won: totals.wonKas.toFixed(4), refunded: totals.refundKas.toFixed(4) }));
  lines.push(t(lang, 'mybets_total_active', { kas: totals.stakeOpenTotal.toFixed(4) }));
  lines.push(t(lang, 'mybets_net', { sign: netSign, kas: netKas.toFixed(4) }) + `  ${netKas >= 0 ? '🎉' : '😞'}`);
  // 明细分布 (按状态拆):
  const detail = [];
  if (totals.openCnt > 0)            detail.push(t(lang, 'mybets_detail_open', { n: totals.openCnt, kas: totals.openStake.toFixed(4) }));
  if (totals.awaitingResultCnt > 0)  detail.push(t(lang, 'mybets_detail_awaiting', { n: totals.awaitingResultCnt, kas: totals.awaitingResultStake.toFixed(4) }));
  if (totals.settledPendingCnt > 0)  detail.push(t(lang, 'mybets_detail_settled_pending', { n: totals.settledPendingCnt, kas: totals.settledPendingStake.toFixed(4) }));
  if (totals.lostStakeKas > 0)       detail.push(t(lang, 'mybets_detail_lost', { kas: totals.lostStakeKas.toFixed(4) }));
  if (detail.length) lines.push(t(lang, 'mybets_detail_prefix', { detail: detail.join(' · ') }));
  lines.push('');

  for (const [marketId, group] of byMarket) {
    // 按 direction 二次聚合 (YES / NO 各加总 stake, 累计 count, 收集状态)
    const byDir = new Map();
    for (const p of group) {
      const dir = p.my_side || (p.direction === 0 ? 'YES' : p.direction === 1 ? 'NO' : '?');
      if (!byDir.has(dir)) byDir.set(dir, { stakeSum: 0, count: 0, statuses: { won: 0, lost: 0, settled_pending: 0, refunded: 0, open: 0, unchain: 0 }, payoutWin: 0, actualPayoutSum: 0 });
      const a = byDir.get(dir);
      a.stakeSum += Number(p.stake_kas) || 0;
      a.count++;
      if (p.settle_txid && p.did_win === true) { a.statuses.won++; a.actualPayoutSum += Number(p.actual_payout_kas) || 0; }
      else if (p.settle_txid && p.did_win === false) a.statuses.lost++;
      else if (p.settle_txid) a.statuses.settled_pending++;
      else if (p.refund_txid) a.statuses.refunded++;
      else if (p.side_lock_tx) { a.statuses.open++; a.payoutWin += Number(p.payout_if_win_kas) || 0; }
      else a.statuses.unchain++;
    }

    // shared metadata 取 group 第一笔 (question / odds / deadline 同市场共享)
    const sample = group[0];
    // KANet-UI 2026-06-06 Owner P0: backend 的 question 可能是 raw JSON spec, specTitle 抽干净题干.
    const title = truncSmart(specTitle(sample.question) || marketId, 70);

    lines.push('');
    lines.push(`📍 ${title}`);

    // 每 direction 1 行
    // 用 group 内 locked_at 最早 + 最晚 (保留时间信息, Bettor r82 加的)
    const allLocked = group.map(p => p.locked_at).filter(Boolean).sort();
    const firstLocked = allLocked[0];
    const lastLocked = allLocked[allLocked.length - 1];
    for (const [dir, a] of byDir) {
      // 单状态时显式; 混合时 collapsed
      const s = a.statuses;
      const onlyOpen = s.open === a.count;
      const onlyWon = s.won === a.count;
      const onlyLost = s.lost === a.count;
      const onlyRefund = s.refunded === a.count;
      let statusStr;
      const onlySettledPending = s.settled_pending === a.count;
      if (onlyWon)        statusStr = t(lang, 'mybets_status_win', { kas: a.actualPayoutSum.toFixed(4) });
      else if (onlyLost)  statusStr = t(lang, 'mybets_status_lose', { kas: a.stakeSum.toFixed(4) });
      else if (onlyRefund) statusStr = t(lang, 'mybets_status_refunded');
      else if (onlySettledPending) statusStr = t(lang, 'mybets_status_settled_chain');
      else if (onlyOpen)  statusStr = (sample.deadline_unix && Number(sample.deadline_unix) < Math.floor(Date.now() / 1000)) ? t(lang, 'mybets_status_deadline_vote') : t(lang, 'mybets_status_active');
      else                statusStr = t(lang, 'mybets_status_mixed', { won: s.won, lost: s.lost, open: s.open, refunded: s.refunded, pending: s.settled_pending });
      const cnt = a.count > 1 ? t(lang, 'mybets_dir_cnt', { n: a.count }) : '';
      lines.push(`• ${dir} ${a.stakeSum.toFixed(4)} KAS${cnt} · ${statusStr}`);
      // 若赢可拿 = 直接加总每笔 payout_if_win_kas. 后端 endpoint 是 query-time 同池子快照统一算每笔
      // (Bettor r147 实证 + 我 r345 多想一层的 pari-mutuel 反向算同分母 = 数学等价).
      // → 简单加总即正确, 不需要 disclaimer "未来变" (现池就是 query 时的池).
      if (onlyOpen && a.payoutWin > 0) lines.push(t(lang, 'mybets_if_win', { kas: a.payoutWin.toFixed(4) }));
    }

    // 共享 meta (odds + 押注时间 + 截止)
    const odds = sample.yes_implied_prob != null
      ? `池: YES ${(sample.yes_implied_prob * 100).toFixed(0)}% / NO ${(100 - sample.yes_implied_prob * 100).toFixed(0)}%`
      : '';
    if (odds) lines.push(`  ${odds}`);
    if (firstLocked) {
      const t1 = fmtLockedAt(firstLocked);
      const t2 = lastLocked && lastLocked !== firstLocked ? `..${fmtLockedAt(lastLocked)}` : '';
      lines.push(t(lang, 'mybets_placed_at', { time: t1 + t2 }));
    }
    // 截止 (Bettor r86 ② + r91 fix: 用 deadline_unix)
    if (sample.deadline_unix) {
      const d = new Date(Number(sample.deadline_unix) * 1000);
      if (!Number.isNaN(+d)) {
        const pad = n => n < 10 ? '0' + n : '' + n;
        const ymd = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        lines.push(t(lang, 'mybets_deadline', { deadline: ymd }));
      }
    }
    // KANet-UI 2026-06-06 Owner 实证: P1.1 ship 的"看怎么定的" URL = 127.0.0.1 局内网, 用户外部点不开
    // = 我违 [[no-impl-jargon]] + Owner r250 全菜单交互 0 网页跳转纪律. 删 URL.
  }
  return lines.join('\n');
}

// Bettor r87 ③ 防流失 — 给 /mybets 每个 open position 返按钮配置. bot.mjs 拿这个用
// InlineKeyboard 显在 /mybets 消息下. callbackQuery handler 收 'mybet:addmore:<id>' →
// 直接进该 market 的押注 flow (= 跳过 stage0/1 类目选 + 市场选, 直接 stage='detail').
// Bettor r143/r144 (Owner P0): 按 market_id 去重 — 每市场 1 个按钮 (原每笔 1 个 = Owner 看着重复).
export async function buildMyBetsKeyboard(linkedAddr, lang = 'en') {
  if (!linkedAddr) return [];
  const r = await api.myPositions(linkedAddr);
  if (!r.ok) return [];
  const positions = r.json?.positions || [];
  // 仅 open + market still active (= 未结算, 未退款, deadline 未过 — 否则按了无意义)
  const now = Math.floor(Date.now() / 1000);
  const seenMarkets = new Set();
  const buttons = [];
  for (const p of positions) {
    if (p.settle_txid || p.refund_txid) continue;
    if (p.deadline && p.deadline < now) continue;
    if (seenMarkets.has(p.market_id)) continue;     // 已加过这市场, 跳
    seenMarkets.add(p.market_id);
    const title = (p.question || p.market_id).slice(0, 30);
    buttons.push({
      market_id: p.market_id,
      label: t(lang, 'mybets_addmore', { title }),
      callback_data: `mybet:addmore:${p.market_id}`,
    });
  }
  return buttons;
}

// Bettor r87 ③ 续 — 用户点 '加注/反手' callback → 跳进 detail stage (= 已知 market, 直问方向).
// 复用 _handleReplyImpl detail stage UX, 但需先 poolMarket(id) 拉全量记录构造 session.
// T1 (2026-06-27): 市场详情分享按钮 — Bot API 7.7 CopyTextButton, 一键复制深链.
function _shareKeyboard(marketId) {
  const shareUrl = `https://t.me/${CONFIG.botUsername}?start=${marketId}`;
  return { inline_keyboard: [[{ text: '🔗 分享此市场', copy_text: { text: shareUrl } }]] };
}
// YES/NO 选边 + 分享 keyboard (详情页用).
function _detailKeyboard(marketId, lang = 'en') {
  const shareUrl = `https://t.me/${CONFIG.botUsername}?start=${marketId}`;
  return { inline_keyboard: [
    [{ text: t(lang, 'btn_yes'), callback_data: 'bet:side:1' }, { text: t(lang, 'btn_no'), callback_data: 'bet:side:2' }],
    [{ text: t(lang, 'btn_share'), copy_text: { text: shareUrl } }],
  ]};
}

export async function startBetFromMarket(tgUser, marketId) {
  const lang = getUserLang(tgUser);
  const dr = await api.poolMarket(marketId);
  const market = (dr.json && (dr.json.market || (dr.json.id ? dr.json : null))) || null;
  if (!market) return t(lang, 'market_not_found');
  // 质量防御: 同 list filter (2026-06-06 Owner 实证 voo3z) — 缺规则不让进押注流程, 不糊弄用户.
  if (!specIsUsable(market.resolution_rule_spec)) {
    return t(lang, 'market_bad_spec');
  }
  // 满员早拒: inline-keyboard 按钮跨 bot 重启持久存在, 用户可能点旧 /start 里已满盘进来.
  // raw_bettor_count = raw COUNT(*) 含 AutoBetter (== prep L1524 同源); 缺失 fail-closed → 999.
  const rawCount = dr.json.raw_bettor_count ?? 999; // fail-closed: missing raw → treat as full
  if (rawCount >= 50) {
    return t(lang, 'market_full');
  }
  // 直接进 detail 复用同 UI
  sessions.set(tgUser, { stage: 'detail', market });
  persist();
  const lines = [
    `📊 ${specTitle(market.resolution_rule_spec)}`,
    t(lang, 'bet_detail_maker', { maker: makerLabel(market) }),
    t(lang, 'bet_detail_deadline_count', { deadline: fmtDeadline(market.deadline, lang), count: market.bettor_count || 0, stake: market.maker_stake_kas ?? '?' }),
  ];
  const _crit = specCriteria(market.resolution_rule_spec);
  if (_crit) lines.push('', t(lang, 'bet_detail_rules_header'), _crit);
  if (market.yes_pool_kas != null && market.no_pool_kas != null) {
    const yp = Number(market.yes_pool_kas).toFixed(4);
    const np = Number(market.no_pool_kas).toFixed(4);
    const ypp = market.yes_implied_prob != null ? (market.yes_implied_prob * 100).toFixed(1) + '%' : '?';
    const npp = market.no_implied_prob != null ? (market.no_implied_prob * 100).toFixed(1) + '%' : '?';
    lines.push(t(lang, 'bet_detail_odds', { yp, np, ypp, npp }));
    lines.push(t(lang, 'bet_detail_odds_explain'));
    // KANet-UI 2026-06-06 #25/L23 Bettor ③ APPROVE r562: 同 detail stage MIN_POT 警告.
    const totalPool = Number(market.yes_pool_kas) + Number(market.no_pool_kas);
    if (totalPool < 100) {
      lines.push(t(lang, 'bet_detail_low_pool', { total: totalPool.toFixed(2) }));
    }
  }
  lines.push('', t(lang, 'bet_detail_oracle'), t(lang, 'bet_detail_warn'), t(lang, 'bet_detail_question'));
  return { text: lines.join('\n'), keyboard: _detailKeyboard(market.id, lang) };
}

export function inBetFlow(tgUser) { return sessions.has(tgUser) || pendingPayments.has(tgUser); }
export function exitBetFlow(tgUser) { sessions.delete(tgUser); pendingPayments.delete(tgUser); persist(); }

// stage5 — bot.mjs poller 用: 列出待检测付款 + 入账后清除.
export function listPendingPayments() { return [...pendingPayments.entries()].map(([tgUser, p]) => ({ tgUser, ...p })); }
export function clearPendingPayment(tgUser) { pendingPayments.delete(tgUser); persist(); }

// Bettor r63 ① link store 持久化 — bot.mjs /link 调 setLinkedAddr, 任何使用 linkedAddr 的步骤调 getLinkedAddr.
export function setLinkedAddr(tgUser, address) {
  linkedAddrs.set(tgUser, { address, linked_at: Date.now(), seen_settled: [] });
  persistNow();  // 资金前置依赖 — 必同步落盘, 不走 debounce
}
export function getLinkedAddr(tgUser) {
  const v = linkedAddrs.get(tgUser);
  return v?.address || null;
}
export function listLinkedUsers() { return [...linkedAddrs.entries()].map(([tgUser, v]) => ({ tgUser, ...v })); }

// Language preference store — persisted in _state.json.
export function setUserLang(tgUser, lang) { userLangs.set(tgUser, lang); persist(); }
export function getUserLang(tgUser) { return userLangs.get(tgUser) || 'en'; }
// Auto-detect on first interaction; /lang override calls setUserLang explicitly.
export function maybeSetLang(tgUser, lang) {
  if (!userLangs.has(tgUser)) { userLangs.set(tgUser, lang); persist(); }
}

// broker fee DM 游标 — poller 跨重启续单 (persist 走 debounce, 可接受 250ms 丢失=最多重发一次 DM)
export function getBrokerFeeTs() { return brokerFeeTs; }
export function setBrokerFeeTs(ts) { brokerFeeTs = ts; persist(); }

// Bettor r71 ① — settle-result poller: bot 追踪已押市场, 结算/退款后通知用户.
// seen_settled = per-user array of marketIds already notified for terminal state (= 防重复 ping).
// Returns marketIds that are new-settled/refunded since last poll (= caller should notify these).
export function pickFreshSettlements(tgUser, currentSettled) {
  const v = linkedAddrs.get(tgUser);
  if (!v) return [];
  const seen = new Set(v.seen_settled || []);
  const fresh = currentSettled.filter(m => !seen.has(m));
  if (fresh.length === 0) return [];
  v.seen_settled = [...seen, ...fresh];
  persistNow();  // 终态记录 = 防重复 push, 必落盘
  return fresh;
}

// /bet → stage0: 列品类 (按 pending_bettors 市场的 category 聚合)
export async function startBet(tgUser, brokerRelayId) {
  try { return await _startBetImpl(tgUser, brokerRelayId); } finally { persist(); }
}
async function _startBetImpl(tgUser, brokerRelayId) {
  // KANet-UI 2026-06-22 (Owner 钦定 '对外同一呈现同一批市场' + 'bot 怎么还是这几个单子'): show ALL open
  // markets, NOT broker-scoped. Supersedes Bettor r957 broker-scope ('broker X's face' = only 经手
  // markets) — Owner's directive: every bot presents the SAME full market list; broker identity matters
  // only at bet-settle (fee attribution to the broker's address), NOT at the display面. brokerRelayId
  // kept in signature (callers pass it) but no longer filters the list. = multi-bot ② 同一呈现.
  void brokerRelayId;
  const lang = getUserLang(tgUser);
  // Switch to availableMarkets: server-side raw<50 + deadline>+10min + isStructuredSpec + non-commingled.
  // Fixes: /bet was using poolMarkets (no raw<50 guard) → users could select full markets → prep rejected.
  // availableMarkets already exposes protocol_version + resolution_rule_spec (pool.js update 2026-06-29).
  const r = await api.availableMarkets(100);
  const allMarkets = (r.json && r.json.markets) || [];
  // Only v0.6/v0.7 — v0.5 needs legacy register-external path; deadline+specIsUsable already server-side.
  const markets = allMarkets.filter(m =>
    m.protocol_version === 'v0.6' || m.protocol_version === 'v0.7'
  );
  if (!markets.length) { sessions.delete(tgUser); return t(lang, 'bet_no_markets'); }
  const byCat = {};
  for (const m of markets) { const c = m.category || 'other'; (byCat[c] = byCat[c] || []).push(m); }
  const categories = Object.keys(byCat).sort();
  // KANet-UI 2026-06-06 Owner P0 + Bettor ③ APPROVE r543: 加 🏆 世界杯专题 + 🔍 搜索 虚菜单, 置顶突出.
  const worldCupMarkets = markets.filter(m => {
    const s = String(m.resolution_rule_spec || '');
    const lower = s.toLowerCase();
    return lower.includes('fifa') || lower.includes('world cup') || s.includes('世界杯');
  });
  const menu = [];
  // entries[i] = { type: 'worldcup'|'search'|'category', markets?, cat? }
  // KANet-UI 2026-06-06 Owner 钦定: 顺序 1.🏆专题 → 2-N.categories (浏览) → 末.🔍搜索 (兜底).
  const entries = [];
  if (worldCupMarkets.length > 0) {
    menu.push(`${t(lang, 'bet_worldcup_label')} (${t(lang, 'market_count', { n: worldCupMarkets.length })})`);
    entries.push({ type: 'worldcup', markets: worldCupMarkets });
  }
  for (const cat of categories) {
    menu.push(`${cat} (${t(lang, 'market_count', { n: byCat[cat].length })})`);
    entries.push({ type: 'category', cat, markets: byCat[cat] });
  }
  menu.push(t(lang, 'bet_search_label'));
  entries.push({ type: 'search' });
  sessions.set(tgUser, { stage: 'category', entries });
  const lines = [t(lang, 'bet_category_title'), ''];
  menu.forEach((label, i) => lines.push(`${i + 1}. ${label}`));
  lines.push('', t(lang, 'bet_category_footer'));
  return lines.join('\n');
}

// 处理用户在菜单流程中的回复 (数字导航). 返 null = 不在流程, 交其他 handler.
export async function handleReply(tgUser, text, linkedAddr) {
  try { return await _handleReplyImpl(tgUser, text, linkedAddr); } finally { persist(); }
}
async function _handleReplyImpl(tgUser, text, linkedAddr) {
  const lang = getUserLang(tgUser);
  const s = sessions.get(tgUser);
  const raw = (text || '').trim();
  if (!s) {
    const pp = pendingPayments.get(tgUser);
    if (pp) return t(lang, 'bet_still_pending', { kas: sompiToKasStr(pp.exact_sompi), addr: pp.side_p2sh });
    return null;
  }

  if (s.stage === 'category') {
    const n = parseInt(raw, 10);
    const entry = Number.isFinite(n) && s.entries && s.entries[n - 1];
    if (!entry) return t(lang, 'bet_invalid_number', { max: s.entries ? s.entries.length : 0 });
    if (entry.type === 'search') {
      s.stage = 'search_input';
      return t(lang, 'bet_search_prompt');
    }
    s.stage = 'market';
    s.markets = entry.markets;
    const head = entry.type === 'worldcup' ? t(lang, 'bet_market_worldcup_head') : `📂 ${entry.cat}`;
    const lines = [t(lang, 'bet_market_list_head', { head }), ''];
    s.markets.forEach((m, i) => lines.push(`${i + 1}. ${trunc(specTitle(m.resolution_rule_spec), 56)}  · ${makerLabel(m)} · ${fmtDeadline(m.deadline, lang)} · ${m.bettor_count || 0}`));
    lines.push('', t(lang, 'bet_market_list_footer'));
    return lines.join('\n');
  }

  if (s.stage === 'search_input') {
    const term = raw.trim();
    if (!term) return t(lang, 'bet_search_prompt');
    // 调 backend ?q= 全文 LIKE NOCASE + 客户端 specIsUsable filter (= Bettor 1要求一致性).
    const r = await api.poolMarkets({ status: 'pending_bettors', limit: 50 });
    const all = (r.json && r.json.markets) || [];
    const nowSec = Math.floor(Date.now() / 1000);
    const lowerTerm = term.toLowerCase();
    const matches = all.filter(m =>
      (m.protocol_version === 'v0.6' || m.protocol_version === 'v0.7') &&
      (!m.deadline || Number(m.deadline) - nowSec > DEADLINE_BUFFER_SEC) &&
      specIsUsable(m.resolution_rule_spec) &&
      String(m.resolution_rule_spec || '').toLowerCase().includes(lowerTerm)
    );
    if (!matches.length) return t(lang, 'bet_search_none', { term });
    s.stage = 'market'; s.markets = matches;
    const lines = [t(lang, 'bet_search_head', { term, count: matches.length }), ''];
    matches.forEach((m, i) => lines.push(`${i + 1}. ${trunc(specTitle(m.resolution_rule_spec), 56)}  · ${makerLabel(m)} · ${fmtDeadline(m.deadline, lang)} · ${m.bettor_count || 0}`));
    lines.push('', t(lang, 'bet_market_list_footer'));
    return lines.join('\n');
  }

  if (s.stage === 'market') {
    const n = parseInt(raw, 10);
    const m = Number.isFinite(n) && s.markets[n - 1];
    if (!m) return t(lang, 'bet_invalid_market', { max: s.markets.length });
    // 拉完整记录给精确结算判据 (Bettor r256 finding: 用户押注前须见完整规则+结算源, 否则吞钱风险).
    const dr = await api.poolMarket(m.id);
    const full = (dr.json && (dr.json.market || (dr.json.id ? dr.json : null))) || m;
    s.stage = 'detail'; s.market = full;
    const lines = [
      `📊 ${specTitle(full.resolution_rule_spec)}`,
      t(lang, 'bet_detail_maker', { maker: makerLabel(full) }),
      t(lang, 'bet_detail_deadline_count', { deadline: fmtDeadline(full.deadline, lang), count: full.bettor_count || 0, stake: full.maker_stake_kas ?? '?' }),
    ];
    const _critF = specCriteria(full.resolution_rule_spec);
    if (_critF) lines.push('', t(lang, 'bet_detail_rules_header'), _critF);
    // Bettor r78 ②: 显示池子分布 + 隐含赔率 (= Bettor r70 A 数据底座). pari-mutuel.
    if (full.yes_pool_kas != null && full.no_pool_kas != null) {
      const yp = Number(full.yes_pool_kas).toFixed(4);
      const np = Number(full.no_pool_kas).toFixed(4);
      const ypp = full.yes_implied_prob != null ? (full.yes_implied_prob * 100).toFixed(1) + '%' : '?';
      const npp = full.no_implied_prob != null ? (full.no_implied_prob * 100).toFixed(1) + '%' : '?';
      lines.push(t(lang, 'bet_detail_odds', { yp, np, ypp, npp }));
      lines.push(t(lang, 'bet_detail_odds_explain'));
      // KANet-UI 2026-06-06 #25/L23 (Bettor ③ APPROVE r562 + r219 文案精化): SS L300 钦定 MIN_POT 1e10 sompi
      // = 100 KAS 总池才能结算. <100 = 卡死无法结算 (J2 refund 路由未 ship → 文案不说自动退款).
      const totalPool = Number(full.yes_pool_kas) + Number(full.no_pool_kas);
      if (totalPool < 100) {
        lines.push(t(lang, 'bet_detail_low_pool', { total: totalPool.toFixed(2) }));
      }
    }
    lines.push('', t(lang, 'bet_detail_oracle'), t(lang, 'bet_detail_warn'), t(lang, 'bet_detail_question'));
    return { text: lines.join('\n'), keyboard: _detailKeyboard(full.id, lang) };
  }

  if (s.stage === 'detail') {
    const n = parseInt(raw, 10);
    if (n !== 1 && n !== 2) return t(lang, 'bet_side_invalid');
    s.side = n === 1 ? 'YES' : 'NO'; s.stage = 'amount';
    return t(lang, 'bet_amount_prompt', { side: s.side, min: MIN_STAKE_KAS });
  }

  if (s.stage === 'amount') {
    const amt = parseFloat(raw);
    if (!Number.isFinite(amt) || amt <= 0) return t(lang, 'bet_amount_invalid');
    if (amt < MIN_STAKE_KAS) return t(lang, 'bet_amount_min', { min: MIN_STAKE_KAS });
    if (!linkedAddr) {
      sessions.delete(tgUser);
      return t(lang, 'bet_amount_no_link');
    }
    s.amount = amt;
    // G4 防资损 C (最后硬门, Bettor r283 LOCK): /prep 出地址前再 check deadline —
    // 列表过滤后用户可能停留几分钟才输金额, 这步 deadline 仍可能近. <10min 直接拒, 钱不出钱包.
    const nowSec = Math.floor(Date.now() / 1000);
    if (s.market.deadline && Number(s.market.deadline) - nowSec < DEADLINE_BUFFER_SEC) {
      sessions.delete(tgUser);
      return t(lang, 'bet_amount_expired');
    }
    const direction = s.side === 'YES' ? 0 : 1;   // PoolSide ctor: 0=YES 1=NO
    const pr = await api.poolRegisterPrep(s.market.id, { linkedAddr, direction, stakeKas: amt });
    if (!pr.ok || !pr.json || !pr.json.side_p2sh || pr.json.exact_stake_sompi == null) {
      sessions.delete(tgUser);
      return t(lang, 'bet_amount_prep_fail', { error: (pr.json && pr.json.error) || ('HTTP ' + pr.status) });
    }
    s.prep = { side_p2sh: pr.json.side_p2sh, exact_sompi: pr.json.exact_stake_sompi, direction };
    s.stage = 'confirm';
    const kas = sompiToKasStr(s.prep.exact_sompi);
    // Owner P0 (Bettor r116 spec, KANet-UI ship): tap-to-copy 地址 + 精确金额 + Kaspa payment URI.
    // 地址手抄风险高 → 用 Telegram HTML <code> 包成 monospace + tap-to-copy 块.
    // URI 也用 <code> tap-to-copy (Telegram HTML <a href> 限 http/https/tg, kaspatest: 自定义 scheme 不保险).
    // resolution_rule_spec 可能含 HTML 特殊字符, 必须 escape (HTML mode 整条解析).
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const addr = s.prep.side_p2sh;
    const uri = `${addr}?amount=${kas}`;
    return {
      text: [
        t(lang, 'bet_confirm_header', { title: esc(specTitle(s.market.resolution_rule_spec)) }),
        t(lang, 'bet_confirm_direction', { side: s.side, kas }),
        '',
        t(lang, 'bet_confirm_step'),
        '',
        t(lang, 'bet_confirm_amount_label', { kas }),
        t(lang, 'bet_confirm_sompi', { sompi: s.prep.exact_sompi }),
        '',
        t(lang, 'bet_confirm_addr_label'),
        `<code>${addr}</code>`,
        '',
        t(lang, 'bet_confirm_uri_label'),
        `<code>${uri}</code>`,
        '',
        t(lang, 'bet_confirm_warn1'),
        t(lang, 'bet_confirm_warn2'),
        t(lang, 'bet_confirm_warn3'),
        t(lang, 'bet_confirm_tip'),
        '',
        t(lang, 'bet_confirm_key_warn'),
        '',
        t(lang, 'bet_confirm_prompt', { kas }),
        t(lang, 'bet_confirm_cancel_hint'),
      ].join('\n'),
      parseMode: 'HTML',
    };
  }

  if (s.stage === 'confirm') {
    // Bettor r9 ③ 数字确认: 全流程数字一致 + exact-match 脆弱 (CONFIRM_WORDS 撞「确认了」不命中) 已修.
    // 收兼容老指引: 1 / 确认 / yes / y 都接.
    const rawLc = raw.toLowerCase();
    const ok = raw === '1' || raw === '确认' || rawLc === 'yes' || rawLc === 'y';
    if (!ok) { sessions.delete(tgUser); return t(lang, 'bet_confirm_cancelled'); }
    // Bettor r63 ② guard: linkedAddr 缺则别建 pending — 否则 poller confirm 调用 linked_addr 缺 silent fail.
    // 优先从持久 link store 取 (= 抗 bot 重启), 退到 caller 传入的 (= 旧路径兼容).
    const resolvedLinkedAddr = getLinkedAddr(tgUser) || linkedAddr || null;
    if (!resolvedLinkedAddr) {
      sessions.delete(tgUser);
      persistNow();
      return t(lang, 'bet_confirm_no_link');
    }
    const kas = sompiToKasStr(s.prep.exact_sompi);
    const exactPayKas = Number(kas); // prep exact (baked), NOT user s.amount
    const pendingRecord = {
      marketId: s.market.id, direction: s.prep.direction, stakeKas: s.amount, linkedAddr: resolvedLinkedAddr,
      side_p2sh: s.prep.side_p2sh, exact_sompi: s.prep.exact_sompi,
      question: s.market.resolution_rule_spec, side: s.side,
      deadline: s.market.deadline || null, since: Date.now(),
    };
    // 托管一键付: 查余额 → 够 → set-pending-first → auto-pay → 失败则 delete + fallthrough
    const wRes = await api.tgWalletGet(tgUser);
    const hasCustodial = wRes.ok && wRes.json?.ok && wRes.json.exists;
    const walletBal = hasCustodial ? (wRes.json.balance_kas ?? 0) : 0;
    if (hasCustodial && walletBal >= exactPayKas + 0.01) {
      pendingPayments.set(tgUser, pendingRecord); // set-pending-first (J2+Bettor 加固)
      const payRes = await api.tgWalletSend(tgUser, s.prep.side_p2sh, exactPayKas);
      if (payRes.ok && payRes.json?.ok) {
        sessions.delete(tgUser);
        persistNow();
        return t(lang, 'bet_autopay_success', { kas: exactPayKas });
      }
      pendingPayments.delete(tgUser); // 付款失败 → delete + fallthrough 手动
    }
    // 手动路径: 非托管 / 余额不足 / auto-pay 失败
    const faucetHint = hasCustodial && walletBal < exactPayKas
      ? t(lang, 'bet_autopay_faucet_hint', { bal: walletBal }) : '';
    pendingPayments.set(tgUser, pendingRecord);
    sessions.delete(tgUser);
    persistNow();  // Bettor r9 F1: 资金关键步同步 flush, 不走 debounce — 250ms 窗口崩 = 监控丢
    return [
      t(lang, 'bet_manual_pay_header'),
      t(lang, 'bet_manual_pay_amount', { kas, sompi: s.prep.exact_sompi }),
      t(lang, 'bet_manual_pay_addr', { addr: s.prep.side_p2sh }),
      '',
      t(lang, 'bet_manual_pay_watching'),
      t(lang, 'bet_manual_pay_min'),
    ].join('\n') + faucetHint;
  }
  return null;
}
