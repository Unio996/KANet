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

export function inBetFlow(tgUser) { return sessions.has(tgUser) || pendingPayments.has(tgUser); }
export function exitBetFlow(tgUser) { sessions.delete(tgUser); pendingPayments.delete(tgUser); persist(); }

// stage5 — bot.mjs poller 用: 列出待检测付款 + 入账后清除.
export function listPendingPayments() { return [...pendingPayments.entries()].map(([tgUser, p]) => ({ tgUser, ...p })); }
export function clearPendingPayment(tgUser) { pendingPayments.delete(tgUser); persist(); }

// Bettor r63 ① link store 持久化 — bot.mjs /link 调 setLinkedAddr, 任何使用 linkedAddr 的步骤调 getLinkedAddr.
export function setLinkedAddr(tgUser, address) {
  linkedAddrs.set(tgUser, { address, linked_at: Date.now() });
  persistNow();  // 资金前置依赖 — 必同步落盘, 不走 debounce
}
export function getLinkedAddr(tgUser) {
  const v = linkedAddrs.get(tgUser);
  return v?.address || null;
}
export function listLinkedUsers() { return [...linkedAddrs.entries()].map(([tgUser, v]) => ({ tgUser, ...v })); }

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
