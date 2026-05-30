// S-C: in-chat 编号菜单押注状态机 (Owner r250 pivot — 全程 Telegram, 0 网页跳转).
// J1 S-B contract (frozen r81): GET /api/pool/markets / /market/:id.
// 0-key/0-custody (J1 S5): bot 只读 + 显; 价值步 (stage4-5: escrow 地址 + 用户自钱包付 + 链上检测)
//   待 J2/J1 taker-stake-external backend, 此处先 stub + 错付预防文案.
import * as api from './console-api.mjs';
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

try {
  if (existsSync(STATE_FILE)) {
    const j = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    for (const [k, v] of (j.sessions || [])) sessions.set(k, v);
    for (const [k, v] of (j.pendingPayments || [])) pendingPayments.set(k, v);
    for (const [k, v] of (j.linkedAddrs || [])) linkedAddrs.set(k, v);
    console.log(`[prediction-menu] state loaded: ${sessions.size} sessions, ${pendingPayments.size} pending payments, ${linkedAddrs.size} linked addrs`);
  }
} catch (e) { console.warn(`[prediction-menu] state load skipped: ${e.message}`); }

// Bettor r9 F2 (原子写): tmp + rename, 防 writeFileSync 崩在写一半 → _state.json 损坏 → JSON.parse 失败 → 两 Map 全丢。
function _writeAtomic() {
  const data = JSON.stringify({
    sessions: [...sessions.entries()],
    pendingPayments: [...pendingPayments.entries()],
    linkedAddrs: [...linkedAddrs.entries()],
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

const MIN_STAKE_KAS = 0.5;          // pool.js bettor/register 硬下限 (Bug 8: 更小 stake → settle TX 超 KIP-9 storage mass).
const SOMPI_PER_KAS = 1e8;
function sompiToKasStr(sompi) { return (Number(sompi) / SOMPI_PER_KAS).toFixed(8); }

function fmtDeadline(unixSec) {
  if (!unixSec) return '?';
  const h = Math.round((unixSec * 1000 - Date.now()) / 3600000);
  return h > 0 ? `${h}h 后截止` : '已过期';
}

// 列表里截短标题 (resolution_rule_spec 可能含完整结算规则全文, Bettor r256). 详情页给全文.
function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
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
export async function formatMyBets(linkedAddr) {
  if (!linkedAddr) return '⚠ 还没绑定地址。先 /link <你的 kaspatest 地址>, 再 /mybets 看自己的押注。';
  const r = await api.myPositions(linkedAddr);
  if (!r.ok) return `查询失败: ${r.json?.error || r.status}`;
  const positions = r.json?.positions || [];
  if (!positions.length) return '你还没有押注记录。/bet 开始押。';
  const lines = [`📋 你的押注 (${positions.length} 笔):`];
  for (const p of positions) {
    const status =
      p.settle_txid && p.did_win === true ? `🎉 赢 +${Number(p.actual_payout_kas || 0).toFixed(4)} KAS` :
      p.settle_txid && p.did_win === false ? `😞 输 -${p.stake_kas} KAS` :
      p.settle_txid ? `📊 已结算待最终标注` :
      p.refund_txid ? `💸 已退款` :
      p.side_lock_tx ? `⏳ 已押注等开奖` : `❓ 未上链`;
    const odds = p.yes_implied_prob != null ? `池: YES ${(p.yes_implied_prob*100).toFixed(0)}% / NO ${(100-p.yes_implied_prob*100).toFixed(0)}%` : '';
    const stakedAt = p.locked_at ? `押注于 ${fmtLockedAt(p.locked_at)}` : '';
    lines.push('');
    lines.push(`• ${p.my_side} ${p.stake_kas} KAS · ${status}`);
    lines.push(`  ${truncSmart(p.question || p.market_id || '', 70)}`);
    const meta = [odds, stakedAt].filter(Boolean).join(' · ');
    if (meta) lines.push(`  ${meta}`);
    if (!p.settle_txid && !p.refund_txid) {
      // Bettor r86 ② + r91 fix: 用 deadline_unix (pool_markets 实存列), bot 端格式化.
      if (p.deadline_unix) {
        const d = new Date(Number(p.deadline_unix) * 1000);
        if (!Number.isNaN(+d)) {
          const pad = n => n < 10 ? '0' + n : '' + n;
          const ymd = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
          lines.push(`  截止 ${ymd} · 开奖后自动结算到账绑定地址`);
        }
      }
      if (p.payout_if_win_kas) lines.push(`  赢可拿 ${Number(p.payout_if_win_kas).toFixed(4)} KAS`);
    }
  }
  return lines.join('\n');
}

// Bettor r87 ③ 防流失 — 给 /mybets 每个 open position 返按钮配置. bot.mjs 拿这个用
// InlineKeyboard 显在 /mybets 消息下. callbackQuery handler 收 'mybet:addmore:<id>' →
// 直接进该 market 的押注 flow (= 跳过 stage0/1 类目选 + 市场选, 直接 stage='detail').
export async function buildMyBetsKeyboard(linkedAddr) {
  if (!linkedAddr) return [];
  const r = await api.myPositions(linkedAddr);
  if (!r.ok) return [];
  const positions = r.json?.positions || [];
  // 仅 open + market still active (= 未结算, 未退款, deadline 未过 — 否则按了无意义)
  const now = Math.floor(Date.now() / 1000);
  const buttons = [];
  for (const p of positions) {
    if (p.settle_txid || p.refund_txid) continue;
    if (p.deadline && p.deadline < now) continue;
    buttons.push({
      market_id: p.market_id,
      label: `➕ 加注/反手: ${(p.question || p.market_id).slice(0, 30)}`,
      callback_data: `mybet:addmore:${p.market_id}`,
    });
  }
  return buttons;
}

// Bettor r87 ③ 续 — 用户点 '加注/反手' callback → 跳进 detail stage (= 已知 market, 直问方向).
// 复用 _handleReplyImpl detail stage UX, 但需先 poolMarket(id) 拉全量记录构造 session.
export async function startBetFromMarket(tgUser, marketId) {
  const dr = await api.poolMarket(marketId);
  const market = (dr.json && (dr.json.market || (dr.json.id ? dr.json : null))) || null;
  if (!market) return '市场未找到。/bet 重选。';
  // 直接进 detail 复用同 UI
  sessions.set(tgUser, { stage: 'detail', market });
  persist();
  const lines = [
    `📊 ${market.resolution_rule_spec}`,
    `${fmtDeadline(market.deadline)} · 已 ${market.bettor_count || 0} 人押 · maker stake ${market.maker_stake_kas ?? '?'} KAS`,
  ];
  if (market.yes_pool_kas != null && market.no_pool_kas != null) {
    const yp = Number(market.yes_pool_kas).toFixed(4);
    const np = Number(market.no_pool_kas).toFixed(4);
    const ypp = market.yes_implied_prob != null ? (market.yes_implied_prob * 100).toFixed(1) + '%' : '?';
    const npp = market.no_implied_prob != null ? (market.no_implied_prob * 100).toFixed(1) + '%' : '?';
    lines.push(`池子分布: YES ${yp} KAS (${ypp})  ·  NO ${np} KAS (${npp})`);
    lines.push('赔率 = 对方池 / 自方池 (押对越少人, 赢得越多)。');
  }
  if (market.outcome_market_source) lines.push(`结算源: ${market.outcome_market_source}`);
  lines.push('', '⚠ 押注前请看清上面【完整结算规则 + 结算源】— 这是判定输赢的唯一依据。', '你押哪边?  回复 1 = YES   ·   2 = NO');
  return lines.join('\n');
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
export async function startBet(tgUser) {
  try { return await _startBetImpl(tgUser); } finally { persist(); }
}
async function _startBetImpl(tgUser) {
  const r = await api.poolMarkets({ status: 'pending_bettors', limit: 200 });
  // Bettor r68 P0 fix: bot 走 register-external (v0.5 only) — v0.6 市场用 register-v06/confirm,
  // bot 还没接. 不滤会拒 → 用户选中 v0.6 市场 register-external 拒 protocol mismatch = broken path.
  // 等 bot v0.6 wire 完成再删此过滤.
  const allMarkets = (r.json && r.json.markets) || [];
  const markets = allMarkets.filter(m => m.protocol_version !== 'v0.6');
  if (!markets.length) { sessions.delete(tgUser); return '现在没有可押注的市场。稍后再来,或 /discover 看看。'; }
  const byCat = {};
  for (const m of markets) { const c = m.category || 'other'; (byCat[c] = byCat[c] || []).push(m); }
  const categories = Object.keys(byCat).sort();
  sessions.set(tgUser, { stage: 'category', categories, byCat });
  const lines = ['🎲 押注预测市场 — 选品类(回复编号):', ''];
  categories.forEach((c, i) => lines.push(`${i + 1}. ${c} (${byCat[c].length} 个市场)`));
  lines.push('', '回复数字选品类。随时 /start 退出。');
  return lines.join('\n');
}

// 处理用户在菜单流程中的回复 (数字导航). 返 null = 不在流程, 交其他 handler.
export async function handleReply(tgUser, text, linkedAddr) {
  try { return await _handleReplyImpl(tgUser, text, linkedAddr); } finally { persist(); }
}
async function _handleReplyImpl(tgUser, text, linkedAddr) {
  const s = sessions.get(tgUser);
  const raw = (text || '').trim();
  if (!s) {
    const pp = pendingPayments.get(tgUser);
    if (pp) return `仍在等待你的付款入账:\n金额 ${sompiToKasStr(pp.exact_sompi)} KAS → 地址 ${pp.side_p2sh}\n付款后我会自动确认。/start 取消等待。`;
    return null;
  }

  if (s.stage === 'category') {
    const n = parseInt(raw, 10);
    const cat = Number.isFinite(n) && s.categories[n - 1];
    if (!cat) return `请回复有效品类编号 (1-${s.categories.length})。`;
    s.stage = 'market'; s.category = cat; s.markets = s.byCat[cat];
    const lines = [`📂 ${cat} — 选市场(回复编号):`, ''];
    s.markets.forEach((m, i) => lines.push(`${i + 1}. ${trunc(m.resolution_rule_spec, 64)}  · ${fmtDeadline(m.deadline)} · ${m.bettor_count || 0} 人已押`));
    lines.push('', '回复数字选市场(看完整结算规则)。');
    return lines.join('\n');
  }

  if (s.stage === 'market') {
    const n = parseInt(raw, 10);
    const m = Number.isFinite(n) && s.markets[n - 1];
    if (!m) return `请回复有效市场编号 (1-${s.markets.length})。`;
    // 拉完整记录给精确结算判据 (Bettor r256 finding: 用户押注前须见完整规则+结算源, 否则吞钱风险).
    const dr = await api.poolMarket(m.id);
    const full = (dr.json && (dr.json.market || (dr.json.id ? dr.json : null))) || m;
    s.stage = 'detail'; s.market = full;
    const lines = [
      `📊 ${full.resolution_rule_spec}`,
      `${fmtDeadline(full.deadline)} · 已 ${full.bettor_count || 0} 人押 · maker stake ${full.maker_stake_kas ?? '?'} KAS`,
    ];
    // Bettor r78 ②: 显示池子分布 + 隐含赔率 (= Bettor r70 A 数据底座). pari-mutuel.
    if (full.yes_pool_kas != null && full.no_pool_kas != null) {
      const yp = Number(full.yes_pool_kas).toFixed(4);
      const np = Number(full.no_pool_kas).toFixed(4);
      const ypp = full.yes_implied_prob != null ? (full.yes_implied_prob * 100).toFixed(1) + '%' : '?';
      const npp = full.no_implied_prob != null ? (full.no_implied_prob * 100).toFixed(1) + '%' : '?';
      lines.push(`池子分布: YES ${yp} KAS (${ypp})  ·  NO ${np} KAS (${npp})`);
      lines.push('赔率 = 对方池 / 自方池 (押对越少人, 赢得越多)。');
    }
    if (full.outcome_market_source) lines.push(`结算源: ${full.outcome_market_source}`);
    lines.push('', '⚠ 押注前请看清上面【完整结算规则 + 结算源】— 这是判定输赢的唯一依据。', '你押哪边?  回复 1 = YES   ·   2 = NO');
    return lines.join('\n');
  }

  if (s.stage === 'detail') {
    const n = parseInt(raw, 10);
    if (n !== 1 && n !== 2) return '请回复 1 (YES) 或 2 (NO)。';
    s.side = n === 1 ? 'YES' : 'NO'; s.stage = 'amount';
    return `你选 ${s.side}。回复要押的 KAS 金额(数字), 最低 ${MIN_STAKE_KAS} KAS, 例如 5。`;
  }

  if (s.stage === 'amount') {
    const amt = parseFloat(raw);
    if (!Number.isFinite(amt) || amt <= 0) return '请回复有效的 KAS 金额(正数)。';
    if (amt < MIN_STAKE_KAS) return `最低押注 ${MIN_STAKE_KAS} KAS (合约 storage-mass 下限)。请回复更大的金额。`;
    if (!linkedAddr) {
      sessions.delete(tgUser);
      return '押注前需先绑定你的 Kaspa 地址: /link <你的 kaspatest 地址>。绑定后重新 /bet。';
    }
    s.amount = amt;
    const direction = s.side === 'YES' ? 0 : 1;   // PoolSide ctor: 0=YES 1=NO
    const pr = await api.poolRegisterPrep(s.market.id, { linkedAddr, direction, stakeKas: amt });
    if (!pr.ok || !pr.json || !pr.json.side_p2sh || pr.json.exact_stake_sompi == null) {
      sessions.delete(tgUser);
      return `押注准备失败: ${(pr.json && pr.json.error) || ('HTTP ' + pr.status)}`;
    }
    s.prep = { side_p2sh: pr.json.side_p2sh, exact_sompi: pr.json.exact_stake_sompi, direction };
    s.stage = 'confirm';
    const kas = sompiToKasStr(s.prep.exact_sompi);
    return [
      `📝 押注复核 — ${s.market.resolution_rule_spec}`,
      `方向 ${s.side} · 金额 ${kas} KAS`,
      '',
      '下一步你要【从自己的钱包】把以下精确金额付到以下精确地址 (bot 全程不持钥、不碰你的钱):',
      `金额: ${kas} KAS  (= ${s.prep.exact_sompi} sompi, 精确值)`,
      `地址: ${s.prep.side_p2sh}`,
      '',
      '⚠ 必须付【这个精确金额】到【这个精确地址】。这是按你的金额烤进合约的一次性地址:',
      '· 少付 → 资金被合约永久锁死、退不回 (refund 也救不了)。',
      '· 多付 → 超出部分被矿工吃掉、要不回。',
      '· 任意钱包都能付; 但中奖要用你【绑定地址】的钥匙领取。',
      '',
      `回复 1 = 确认付 ${kas} KAS 到这个一次性地址 (少付永久锁死, 多付被矿工吃掉)`,
      '回复 0 = 取消',
    ].join('\n');
  }

  if (s.stage === 'confirm') {
    // Bettor r9 ③ 数字确认: 全流程数字一致 + exact-match 脆弱 (CONFIRM_WORDS 撞「确认了」不命中) 已修.
    // 收兼容老指引: 1 / 确认 / yes / y 都接.
    const t = raw.toLowerCase();
    const ok = raw === '1' || raw === '确认' || t === 'yes' || t === 'y';
    if (!ok) { sessions.delete(tgUser); return '已取消, 未发生任何付款。随时 /bet 重新开始。'; }
    // Bettor r63 ② guard: linkedAddr 缺则别建 pending — 否则 poller confirm 调用 linked_addr 缺 silent fail.
    // 优先从持久 link store 取 (= 抗 bot 重启), 退到 caller 传入的 (= 旧路径兼容).
    const resolvedLinkedAddr = getLinkedAddr(tgUser) || linkedAddr || null;
    if (!resolvedLinkedAddr) {
      sessions.delete(tgUser);
      persistNow();
      return '⚠ 还没绑定你的 kaspatest 地址 — 请先 /link <你的 kaspatest 地址>, 再 /bet 重来。中奖时需要绑定地址的钥匙领。';
    }
    const kas = sompiToKasStr(s.prep.exact_sompi);
    pendingPayments.set(tgUser, {
      marketId: s.market.id, direction: s.prep.direction, stakeKas: s.amount, linkedAddr: resolvedLinkedAddr,
      side_p2sh: s.prep.side_p2sh, exact_sompi: s.prep.exact_sompi,
      question: s.market.resolution_rule_spec, side: s.side,
      deadline: s.market.deadline || null, since: Date.now(),
    });
    sessions.delete(tgUser);
    persistNow();  // Bettor r9 F1: 资金关键步同步 flush, 不走 debounce — 250ms 窗口崩 = 监控丢
    return [
      '✅ 已记录。请现在【从你的钱包】付款:',
      `金额: ${kas} KAS  (= ${s.prep.exact_sompi} sompi)`,
      `地址: ${s.prep.side_p2sh}`,
      '',
      '我在盯这个地址的链上到账, 检测到【精确金额】到账后通知你押注已入账。',
      '再次提醒: 务必付精确金额到精确地址, 错额无法挽回。/start 取消等待 (若已付款, 取消不退款)。',
    ].join('\n');
  }
  return null;
}
