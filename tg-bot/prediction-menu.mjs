// S-C: in-chat 编号菜单押注状态机 (Owner r250 pivot — 全程 Telegram, 0 网页跳转).
// J1 S-B contract (frozen r81): GET /api/pool/markets / /market/:id.
// 0-key/0-custody (J1 S5): bot 只读 + 显; 价值步 (stage4-5: escrow 地址 + 用户自钱包付 + 链上检测)
//   待 J2/J1 taker-stake-external backend, 此处先 stub + 错付预防文案.
import * as api from './console-api.mjs';

// in-mem session per tg user (stage0-3 navigation). 持久化到 prediction_dm_session = post-MVP follow-up.
const sessions = new Map();

// stage5: 用户已确认押注、等待链上付款检测的会话 (tgUser -> {marketId,direction,side_p2sh,exact_sompi,...}).
// bot.mjs poller 轮询这些, 调 backend confirm (3 验证 dest+amount+UNIQUE) → 入账后通知用户. in-mem v0.
const pendingPayments = new Map();

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
export function exitBetFlow(tgUser) { sessions.delete(tgUser); pendingPayments.delete(tgUser); }

// stage5 — bot.mjs poller 用: 列出待检测付款 + 入账后清除.
export function listPendingPayments() { return [...pendingPayments.entries()].map(([tgUser, p]) => ({ tgUser, ...p })); }
export function clearPendingPayment(tgUser) { pendingPayments.delete(tgUser); }

// /bet → stage0: 列品类 (按 pending_bettors 市场的 category 聚合)
export async function startBet(tgUser) {
  const r = await api.poolMarkets({ status: 'pending_bettors', limit: 200 });
  const markets = (r.json && r.json.markets) || [];
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
    if (!pr.ok || !pr.json || !pr.json.side_p2sh || pr.json.exact_sompi == null) {
      sessions.delete(tgUser);
      return `押注准备失败: ${(pr.json && pr.json.error) || ('HTTP ' + pr.status)}`;
    }
    s.prep = { side_p2sh: pr.json.side_p2sh, exact_sompi: pr.json.exact_sompi, direction };
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
      '确认无误回复「确认」继续, 我给付款指引并盯链上到账。回复其他取消。',
    ].join('\n');
  }

  if (s.stage === 'confirm') {
    const ok = raw === '确认' || raw.toLowerCase() === 'yes' || raw.toLowerCase() === 'y';
    if (!ok) { sessions.delete(tgUser); return '已取消, 未发生任何付款。随时 /bet 重新开始。'; }
    const kas = sompiToKasStr(s.prep.exact_sompi);
    pendingPayments.set(tgUser, {
      marketId: s.market.id, direction: s.prep.direction, stakeKas: s.amount, linkedAddr,
      side_p2sh: s.prep.side_p2sh, exact_sompi: s.prep.exact_sompi,
      question: s.market.resolution_rule_spec, side: s.side,
      deadline: s.market.deadline || null, since: Date.now(),
    });
    sessions.delete(tgUser);
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
