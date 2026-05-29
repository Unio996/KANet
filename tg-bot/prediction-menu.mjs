// S-C: in-chat 编号菜单押注状态机 (Owner r250 pivot — 全程 Telegram, 0 网页跳转).
// J1 S-B contract (frozen r81): GET /api/pool/markets / /market/:id.
// 0-key/0-custody (J1 S5): bot 只读 + 显; 价值步 (stage4-5: escrow 地址 + 用户自钱包付 + 链上检测)
//   待 J2/J1 taker-stake-external backend, 此处先 stub + 错付预防文案.
import * as api from './console-api.mjs';

// in-mem session per tg user (stage0-3 navigation). 持久化到 prediction_dm_session = post-MVP follow-up.
const sessions = new Map();

function fmtDeadline(unixSec) {
  if (!unixSec) return '?';
  const h = Math.round((unixSec * 1000 - Date.now()) / 3600000);
  return h > 0 ? `${h}h 后截止` : '已过期';
}

export function inBetFlow(tgUser) { return sessions.has(tgUser); }
export function exitBetFlow(tgUser) { sessions.delete(tgUser); }

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
export async function handleReply(tgUser, text) {
  const s = sessions.get(tgUser);
  if (!s) return null;
  const raw = (text || '').trim();

  if (s.stage === 'category') {
    const n = parseInt(raw, 10);
    const cat = Number.isFinite(n) && s.categories[n - 1];
    if (!cat) return `请回复有效品类编号 (1-${s.categories.length})。`;
    s.stage = 'market'; s.category = cat; s.markets = s.byCat[cat];
    const lines = [`📂 ${cat} — 选市场(回复编号):`, ''];
    s.markets.forEach((m, i) => lines.push(`${i + 1}. ${m.resolution_rule_spec}  · ${fmtDeadline(m.deadline)} · ${m.bettor_count || 0} 人已押`));
    lines.push('', '回复数字选市场。');
    return lines.join('\n');
  }

  if (s.stage === 'market') {
    const n = parseInt(raw, 10);
    const m = Number.isFinite(n) && s.markets[n - 1];
    if (!m) return `请回复有效市场编号 (1-${s.markets.length})。`;
    s.stage = 'detail'; s.market = m;
    return [
      `📊 ${m.resolution_rule_spec}`,
      `${fmtDeadline(m.deadline)} · 已 ${m.bettor_count || 0} 人押 · maker stake ${m.maker_stake_kas ?? '?'} KAS`,
      '',
      '你押哪边?  回复 1 = YES   ·   2 = NO',
    ].join('\n');
  }

  if (s.stage === 'detail') {
    const n = parseInt(raw, 10);
    if (n !== 1 && n !== 2) return '请回复 1 (YES) 或 2 (NO)。';
    s.side = n === 1 ? 'YES' : 'NO'; s.stage = 'amount';
    return `你选 ${s.side}。回复要押的 KAS 金额(数字),例如 5。`;
  }

  if (s.stage === 'amount') {
    const amt = parseFloat(raw);
    if (!Number.isFinite(amt) || amt <= 0) return '请回复有效的 KAS 金额(正数)。';
    s.amount = amt;
    sessions.delete(tgUser); // stage4-5 接 taker-stake-external 后再续
    return [
      `📝 待押注: ${s.market.resolution_rule_spec}`,
      `方向 ${s.side} · 金额 ${amt} KAS`,
      '',
      '⏳ 链上押注(给你精确 escrow 地址 + 你从自己钱包付 + 我自动检测到账确认)即将上线 — 正在接后端 taker-stake-external。',
      '⚠ 上线后必须付【精确金额】到【精确地址】:错付(金额不符/多笔/来源错)会被合约永久锁死、退不回。bot 全程不持钥、不碰你的钱。',
    ].join('\n');
  }
  return null;
}
