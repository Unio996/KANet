// TG bot user-facing text + flow builders. v1.3: builder voice, testnet/MIT, reactive-only.
// Value/trust steps → the USER acts on-chain via Console/their relay. bot 0 持钥 / 0 execute (J1 S5).
import { CONFIG } from './config.mjs';
import { t } from './i18n.mjs';

export const DISCLAIMER = 'testnet-only · MIT 开源 · 不运营主网 · 非投资建议';

export function startMessage(lang = 'en') {
  // §11 v2 (Owner 终裁 2026-06-27): 22行→6行精简. 详情移 /help. 首次用户+1行 /help 提示.
  // custody 警告保留 1 行(NWT 承重 bar: 不可删/弱化). faucet 数量不硬编.
  // Owner 2026-06-28: 首次用户加 /hot 指针(老用户嵌 5 热榜, 首次用户给指针兜底).
  const text = [
    t(lang, 'start_title'),
    '',
    t(lang, 'start_commands'),
    t(lang, 'start_commands_extra'),
    '',
    t(lang, 'start_hot'),
    '',
    t(lang, 'start_custody_warn'),
    t(lang, 'start_help'),
  ].join('\n');
  const langBtnKey = lang === 'en' ? 'start_lang_btn_zh' : 'start_lang_btn_en';
  return { text, keyboard: { inline_keyboard: [[{ text: t(lang, langBtnKey), callback_data: 'lang:toggle' }]] } };
}

// §11 v2 (Owner 终裁 2026-06-27): 老用户极简, 无 /help 提示行. custody 双守行永在.
// Owner 2026-06-28: 老用户顶部嵌紧凑 5 热榜(标题+池+人数+深链按钮) + /hot 兜底. trending 传 null→无块.
// Owner 2026-06-28 UX重构: 加赛事聚合卡区 (sportsGroups != null → ⚽ 赛事区), 热榜/新盘双区.
export function startMessageLinked(addr, custodial = null, trendingMarkets = null, botUsername = null, sportsGroups = null, lang = 'en') {
  const shortAddr = addr.length > 20 ? addr.slice(0, 17) + '…' : addr;
  const custLabel = custodial === true
    ? t(lang, 'start_linked_custodial_label')
    : custodial === false
      ? t(lang, 'start_linked_non_custodial_label')
      : t(lang, 'start_linked_mixed_label');
  const custWarn = custodial === false
    ? t(lang, 'start_linked_non_custodial_warn')
    : t(lang, 'start_linked_custody_warn');
  const cmdLine = t(lang, 'start_linked_commands');
  const lines = [
    t(lang, 'start_linked_title'),
    `📍 ${shortAddr}  ${custLabel}`,
    '',
    cmdLine,
    '',
    custWarn,
  ];
  const buttons = [];

  // 🔥 热榜区 (bettors>=3 真实热度)
  if (trendingMarkets && trendingMarkets.length > 0) {
    const block = _compactTrendingBlock(trendingMarkets, botUsername, lang);
    lines.splice(2, 0, ...block.lines);  // insert after header, before commands
    buttons.push(...block.buttons);
  } else if (trendingMarkets !== null) {
    lines.splice(2, 0, '', t(lang, 'start_trending_empty'), '');
  }

  // ⚽ 赛事聚合卡区 (新盘/冷启动, 信任卡, 无 bettor 门)
  const sportsBlock = sportsGroups && sportsGroups.length > 0 ? sportsCardBlock(sportsGroups, botUsername, lang) : null;
  if (sportsBlock) {
    // 在 commands 行前插赛事区
    const insertAt = lines.indexOf(cmdLine);
    const at = insertAt >= 0 ? insertAt : lines.length - 2;
    lines.splice(at, 0, ...sportsBlock.lines);
    buttons.push(...sportsBlock.buttons);
  }

  const langBtnKey = lang === 'en' ? 'start_lang_btn_zh' : 'start_lang_btn_en';
  buttons.push([{ text: t(lang, langBtnKey), callback_data: 'lang:toggle' }]);
  return { text: lines.join('\n'), keyboard: { inline_keyboard: buttons } };
}

// Compact 5-market block for /start embed: title+pool+bettors per market, deeplink buttons.
function _compactTrendingBlock(markets, botUsername, lang = 'en') {
  const BOT = botUsername || 'KANET_Broker_bot';
  function parseTitle(raw) { try { const p = JSON.parse(raw); return p.title || raw; } catch { return raw; } }
  // §11 v3: extract per-leg human label from JSON title ("Match — Brazil to win" → "Brazil to win")
  function legButtonLabel(raw, legKey) {
    try {
      const p = JSON.parse(raw);
      if (p.title) { const parts = p.title.split(' — '); if (parts.length > 1) return parts.slice(1).join(' — '); }
    } catch {}
    if (!legKey) return '';
    if (legKey.startsWith('winner_')) return legKey.slice(7) + (lang === 'zh' ? ' 赢' : ' Win');
    if (legKey.startsWith('spread_')) return legKey.split('_').slice(1).join(' ');
    if (legKey.startsWith('total_o_')) return (lang === 'zh' ? '大球 O' : 'Over O') + legKey.slice(8);
    if (legKey.startsWith('total_u_')) return (lang === 'zh' ? '小球 U' : 'Under U') + legKey.slice(8);
    return legKey;
  }
  // Show implied probability % only when ≥1 real bettor and probability is 5–95% (avoids misleading extremes)
  function probSuffix(m) {
    if (!(m.bettor_count > 0) || m.yes_implied_prob == null) return '';
    const pct = Math.round(m.yes_implied_prob * 100);
    return (pct >= 5 && pct <= 95) ? ` ${pct}%` : '';
  }
  const lines = ['', t(lang, 'trending_header')];
  const buttons = [];
  // Deduplicate card_groups: show once per group
  const seen = new Set();
  let idx = 1;
  for (const m of markets) {
    if (m.card_group_id) {
      if (seen.has(m.card_group_id)) {
        // Add this leg's button (sibling leg)
        const label = legButtonLabel(m.title || '', m.leg_key);
        buttons.push([{ text: `🎯 ${label}${probSuffix(m)}`, callback_data: 'bet:market:' + m.id }]);
        continue;
      }
      seen.add(m.card_group_id);
      // Count siblings in this group
      const groupSize = markets.filter(x => x.card_group_id === m.card_group_id).length;
      const totalKas = markets.filter(x => x.card_group_id === m.card_group_id)
        .reduce((s, x) => s + (x.total_pool_kas || 0), 0);
      const firstTitle = parseTitle(m.title || '');
      const matchName = firstTitle.includes(' — ') ? firstTitle.split(' — ')[0].trim() : firstTitle.slice(0, 35);
      const label = legButtonLabel(m.title || '', m.leg_key);
      buttons.push([{ text: `🎯 ${label}${probSuffix(m)}`, callback_data: 'bet:market:' + m.id }]);
    } else {
      const title = parseTitle(m.title || '');
      const short = title.length > 22 ? title.slice(0, 20) + '…' : title;
      buttons.push([{ text: `🎯 ${short}${probSuffix(m)}`, callback_data: 'bet:market:' + m.id }]);
    }
    idx++;
  }
  lines.push(t(lang, 'trending_more'));
  lines.push('');
  return { lines, buttons };
}

// KANet-UI 2026-06-28 (Owner 钦定 broker 收益 DM): 单笔 fee 到账 DM 文案.
// ev = { fee_sompi, market_title, market_id, settle_txid } (broker_fee_landed payload).
export function brokerFeeDmText(ev, lang = 'en') {
  const feeKas = ((ev.fee_sompi || 0) / 1e8).toFixed(4);
  const title = String(ev.market_title || ev.market_id || '').slice(0, 40);
  return [
    t(lang, 'fee_dm_title'),
    t(lang, 'fee_dm_body', { title }),
    t(lang, 'fee_dm_amount', { kas: feeKas }),
    t(lang, 'fee_dm_link'),
    '',
    t(lang, 'fee_dm_testnet_note'),
  ].join('\n');
}

// KANet-UI 2026-06-28 (Owner 钦定首页赛事聚合卡): 赛事卡区文本+按钮.
// groups = card_groups endpoint 返 [{card_group_id, event_title, home_team, away_team, legs:[{id,leg_key,kind,label,total_pool_kas,bettor_count,yes_implied_prob}]}]
export function sportsCardBlock(groups, botUsername, lang = 'en') {
  if (!groups || groups.length === 0) return null;
  const BOT = botUsername || 'KANET_Broker_bot';
  const lines = ['', t(lang, 'sports_header'), t(lang, 'sports_subheader')];
  const buttons = [];
  for (const g of groups) {
    const teamLine = (g.home_team && g.away_team)
      ? `${g.home_team} vs ${g.away_team}`
      : (g.event_title || g.card_group_id || '').slice(0, 30);
    const totalPool = (g.total_pool_kas || 0).toFixed(0);
    const totalBettors = g.total_bettor_count || 0;
    lines.push(`🏟 ${teamLine} · 💰${totalPool}KAS${totalBettors > 0 ? ` · 👥${totalBettors}人` : ` · ${t(lang, 'sports_new')}` }`);
    const rowBtns = [];
    for (const leg of (g.legs || []).slice(0, 3)) {
      const label = _legLabel(leg, lang);
      const prob = _legProb(leg);
      rowBtns.push({ text: `${label}${prob}`, callback_data: 'bet:market:' + leg.id });
    }
    if (rowBtns.length) buttons.push(rowBtns);
  }
  lines.push('');
  return { lines, buttons };
}

function _legLabel(leg, lang = 'en') {
  const lk = String(leg.leg_key || '');
  if (lk.startsWith('winner_')) {
    const team = lk.slice(7);
    if (lang === 'zh') {
      return team === 'home' ? '主队赢' : team === 'away' ? '客队赢' : team === 'draw' ? '平局' : team + ' 赢';
    }
    return team === 'home' ? 'Home Win' : team === 'away' ? 'Away Win' : team === 'draw' ? 'Draw' : team + ' Win';
  }
  if (lk.startsWith('total_o_')) return (lang === 'zh' ? '大球 O' : 'Over O') + lk.slice(8);
  if (lk.startsWith('total_u_')) return (lang === 'zh' ? '小球 U' : 'Under U') + lk.slice(8);
  if (lk.startsWith('spread_')) return lang === 'zh' ? '让球' : 'Spread';
  return (leg.label || lk).slice(0, 10);
}
function _legProb(leg) {
  if (!(leg.bettor_count > 0) || leg.yes_implied_prob == null) return '';
  const pct = Math.round(leg.yes_implied_prob * 100);
  return (pct >= 5 && pct <= 95) ? ` ${pct}%` : '';
}

// KANet-UI 2026-06-22 (Owner 钦定 broker 收益统计 DM 显): 格式化 address-keyed 收益。
// data = /api/kanet-broker/earnings-by-address 返 {address,realized,pending,refunded,by_market}。
// 链上证: 每已结算单挂 settle_txid explorer 链接。fee=价值分成(后端已用 phase2 实落值)。
// T4 (2026-06-27): nodeIncome = /api/node/income/:pk 返回值 (可选). 非 node 用户传 null 静默略过.
export function brokerEarnings(data, nodeIncome = null, lang = 'en') {
  const explorer = (CONFIG.network === 'mainnet') ? 'https://explorer.kaspa.org' : 'https://explorer-tn12.kaspa.org';
  const r = data.realized || {}, p = data.pending || {}, rf = data.refunded || {};
  const by = data.by_market || [];
  if (!by.length) {
    return [
      t(lang, 'earnings_title'),
      `📍 ${data.address || ''}`,
      '',
      t(lang, 'earnings_no_markets'),
      t(lang, 'earnings_no_markets_apply'),
      '',
      t(lang, 'earnings_testnet_note'),
    ].join('\n');
  }
  const lines = [
    t(lang, 'earnings_title'),
    `📍 ${data.address || ''}`,
    '',
    t(lang, 'earnings_realized', { kas: r.pool_kas || '0', n: r.n_markets || 0 }),
    t(lang, 'earnings_pending', { kas: p.pool_kas || '0', n: p.n_markets || 0 }),
  ];
  if ((rf.n_markets || 0) > 0) lines.push(t(lang, 'earnings_refunded', { kas: rf.pool_kas || '0', n: rf.n_markets }));
  lines.push('', t(lang, 'earnings_recent'));
  const icon = (s) => s === 'settled' ? '✅' : (s === 'refunded' ? '↩' : '⏳');
  for (const m of by.slice(0, 10)) {
    const id = String(m.id || '').slice(-12);
    let line = `${icon(m.status)} …${id}  ${m.fee_kas} KAS`;
    if (m.settle_txid) line += `  ${explorer}/txs/${m.settle_txid}`;
    lines.push(line);
  }
  if (by.length > 10) lines.push(t(lang, 'earnings_more', { n: by.length - 10 }));
  lines.push('', t(lang, 'earnings_total', { n: by.length }));
  // T4: 附加 node 委员收益 (若该地址是本机 relay)
  if (nodeIncome && nodeIncome.total_settled_markets > 0) {
    lines.push('', t(lang, 'earnings_node_title'));
    lines.push(t(lang, 'earnings_node_total', { kas: nodeIncome.total_node_income_kas?.toFixed(8) || '0', n: nodeIncome.total_settled_markets }));
    if ((nodeIncome.pending_tx_index_count || 0) > 0)
      lines.push(t(lang, 'earnings_node_pending', { n: nodeIncome.pending_tx_index_count }));
    lines.push(t(lang, 'earnings_node_note'));
  }
  lines.push('', t(lang, 'earnings_testnet_note'));
  return lines.join('\n');
}

// /hot 热门市场 (Owner 热需求 2026-06-27): T5 trending top-N 格式化.
// markets = trending[]. 返 {text, keyboard} — keyboard = CopyText 深链按钮.
// 支持 card_group_id 分组: 同一 card_group_id 的盘组成一块显示(非散盘).
export function hotMarkets(markets, botUsername, lang = 'en') {
  if (!markets || !markets.length) {
    return { text: t(lang, 'hot_empty'), keyboard: null };
  }
  function parseTitle(raw) {
    try { const p = JSON.parse(raw); return p.title || raw; } catch { return raw; }
  }
  function fmtDl(deadline) {
    if (!deadline) return '';
    const h = Math.round((Number(deadline) * 1000 - Date.now()) / 3600000);
    return h > 0 ? t(lang, 'deadline_hours', { h }) : t(lang, 'deadline_expired');
  }
  // §11 v3: extract per-leg label from JSON title, fallback to legKey parsing
  function legLabel(raw, legKey) {
    try {
      const p = JSON.parse(raw);
      if (p.title) { const parts = p.title.split(' — '); if (parts.length > 1) return parts.slice(1).join(' — '); }
    } catch {}
    if (!legKey) return '';
    if (legKey.startsWith('winner_')) return legKey.slice(7) + (lang === 'zh' ? ' 赢' : ' Win');
    if (legKey.startsWith('spread_')) return legKey.split('_').slice(1).join(' ');
    if (legKey.startsWith('total_o_')) return (lang === 'zh' ? '大球 O' : 'Over O') + legKey.slice(8);
    if (legKey.startsWith('total_u_')) return (lang === 'zh' ? '小球 U' : 'Under U') + legKey.slice(8);
    return legKey;
  }
  // Show implied probability % only when ≥1 real bettor and probability is 5–95%
  function probSuffix(m) {
    if (!(m.bettor_count > 0) || m.yes_implied_prob == null) return '';
    const pct = Math.round(m.yes_implied_prob * 100);
    return (pct >= 5 && pct <= 95) ? ` ${pct}%` : '';
  }
  const CAT = { sports: '🏆', politics: '🗳', other: '🌐', test: '🧪' };
  const BOT = botUsername || 'KANET_Broker_bot';
  // Separate card-group markets from singles (insertion-order preserved)
  const groupsMap = new Map();
  const singles = [];
  for (const m of markets) {
    if (m.card_group_id) {
      if (!groupsMap.has(m.card_group_id)) groupsMap.set(m.card_group_id, []);
      groupsMap.get(m.card_group_id).push(m);
    } else {
      singles.push(m);
    }
  }
  const lines = [t(lang, 'hot_title', { n: markets.length }), ''];
  const buttons = [];
  let idx = 1;
  // Card groups
  for (const [, gMarkets] of groupsMap) {
    const firstTitle = parseTitle(gMarkets[0].title || '');
    const matchHeader = firstTitle.includes(' — ') ? firstTitle.split(' — ')[0].trim() : firstTitle;
    const totalKas = gMarkets.reduce((s, m) => s + (m.total_pool_kas || 0), 0);
    const maxBettors = Math.max(...gMarkets.map(m => m.bettor_count || 0));
    const dl = fmtDl(gMarkets[0].deadline);
    lines.push(`${idx}. ⚽ ${matchHeader} · ${gMarkets.length} 盘`);
    lines.push(`   💰${totalKas.toFixed(0)} KAS · 👥${maxBettors}人${dl ? ' · ' + dl : ''}`);
    // §11 信任卡 (J1 定版 2026-06-28): 全真原语·不超卖·禁写「自动结算/无法作弊/去信任」(Track B 未完成)
    lines.push(`   ${t(lang, 'hot_trust_card')}`);
    for (const m of gMarkets) {
      const label = legLabel(m.title || '', m.leg_key);
      buttons.push([{ text: `🎯 ${label}${probSuffix(m)}`, callback_data: 'bet:market:' + m.id }]);
    }
    lines.push('');
    idx++;
  }
  // Singles
  for (const m of singles) {
    const title = parseTitle(m.title);
    const short = title.length > 40 ? title.slice(0, 38) + '…' : title;
    const cat = CAT[m.category] || '🌐';
    const prob = probSuffix(m);
    lines.push(`${idx}. ${cat} ${short}`);
    lines.push(`   💰${(m.total_pool_kas || 0).toFixed(0)} KAS · 👥${m.bettor_count || 0}人${prob ? ' · YES' + prob : ''}`);
    buttons.push([{ text: `🎯 押 #${idx} ${short.slice(0, 20)}${prob}`, callback_data: 'bet:market:' + m.id }]);
    lines.push('');
    idx++;
  }
  lines.push(t(lang, 'hot_footer'));
  return { text: lines.join('\n'), keyboard: { inline_keyboard: buttons } };
}

// 兑换 flow — show broker X's KAS receiving address; the USER pays on-chain from their own wallet.
// bot 0 execute: 只显地址 + 引导 + deep-link。broker-intake-watcher 在链上检测到付款后继续。
export function swapFlow(broker, lang = 'en', network = 'testnet-12') {
  const name = broker?.name || 'broker';
  // Testnet gate: hide send-KAS steps entirely to prevent accidental fund loss.
  // Feature is implemented and tested; exchange only runs on mainnet.
  if (network !== 'mainnet') {
    return [t(lang, 'swap_title', { name }), '', t(lang, 'swap_testnet_note')].join('\n');
  }
  const addr = broker?.address || '(broker 未配置 — Owner 在 Console 设置页选)';
  return [
    t(lang, 'swap_title', { name }),
    '',
    t(lang, 'swap_step1'),
    `   ${addr}`,
    t(lang, 'swap_step2'),
    '',
    t(lang, 'swap_warn'),
  ].join('\n');
}

// 押注 flow — deep-link 到预测市场;用户自己链上锁仓 + 签名,bot 0 execute。
export function betFlow(broker) {
  const name = broker?.name || 'broker';
  return [
    `🎲 押注预测市场 — 经 broker ${name}`,
    '',
    '在 Console 选市场押注:你自己链上锁定,5 个 oracle 投票结算,全程链上可审计。',
    'broker 只撮合/引导,收协议内置的 broker 佣金(落 broker 链上地址)。',
    '',
    '⚠ 你自己链上锁定 + 签名,bot 不碰你的钱。',
    '直接 /bet 开始押注 (全 Telegram 菜单交互, 不跳网页)。',
  ].join('\n');
}

export function notifyLine(ev, lang = 'en') {
  const tx = (ev.txid || '').slice(0, 12);
  const evType = ev.event_type || 'event';
  // KANet-UI 线B P1 (Bettor v2 ③): settle/refund 事件友好化 — 用户押注有结果时给可读+可执行通知,
  // 指向 /mybets 看赢/输/退 + 金额(原 generic '🔔 event tx' 用户看不懂)。金额/赢输详情在 /mybets。
  if (/settle|payout|winner|distribut/i.test(evType)) {
    return t(lang, 'notify_settle', { tx });
  }
  if (/refund/i.test(evType)) {
    return t(lang, 'notify_refund', { tx });
  }
  if (evType === 'broker_fee_landed') {
    let meta = {};
    try { meta = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : (ev.payload || {}); } catch {}
    const kas = meta.fee_sompi ? (meta.fee_sompi / 1e8).toFixed(4) : '?';
    const title = meta.market_title || meta.market_id || '';
    return t(lang, 'notify_broker_fee', { kas, title, tx });
  }
  if (evType === 'tx') {
    return t(lang, 'notify_tx', { tx });
  }
  return t(lang, 'notify_generic', { type: evType, tx, time: ev.observed_at || '' });
}

// 成为撮合者 (broker / gateway) — Owner UI gap (2026-06-22): 公开面缺 user 级 'become broker' 入口.
// 严格 INFO-ONLY (Bettor security gate): 只讲角色 + 价值分成佣金 + 当前怎么参与(经 Owner/dev fork),
// 【绝不在公开 bot 面给自助注册按钮】—— broker 收 1.6% fee, 公开无 auth 自助注册 = fee 模型被滥用,
// 须先落 /identities trust auth 硬化(banked). bot 0-key/deep-link only, 此命令纯文字引导.
// ⚠ Owner待拍 final wording (同 startMessage).
// KANet-UI 2026-06-22 (Owner 实测派修 + onboarding 闭环已落): /broker 从 INFO-ONLY 升级为真接通自助
// 申请流 (地址制 onboarding 已落 + Owner trust 审批门 = auth 硬化已满足, 公开自助安全)。opts:
//   { addr: 用户 /link 地址 (无则提示先 /link), status: onboard/status 返回 (onboarded/status/trust_level) }
export function brokerRole(opts = {}, lang = 'en') {
  const { addr, status, earnings } = opts;
  const lines = [
    t(lang, 'broker_role_title'),
    '',
    t(lang, 'broker_role_desc1'),
    t(lang, 'broker_role_fees'),
    t(lang, 'broker_role_no_custody'),
    '',
  ];
  if (!addr) {
    lines.push(t(lang, 'broker_role_apply_steps'));
    lines.push(t(lang, 'broker_role_step1_noaddr'));
    lines.push(t(lang, 'broker_role_step2'));
    lines.push(t(lang, 'broker_role_step3'));
  } else if (status?.onboarded && status.status === 'approved') {
    lines.push(t(lang, 'broker_role_approved', { addr }));
    lines.push(t(lang, 'broker_role_approved_bot'));
    // T2 (2026-06-27): inline earnings summary for approved brokers.
    if (earnings) {
      const r = earnings.realized || {}, p = earnings.pending || {};
      lines.push(t(lang, 'broker_role_earnings', { realized: r.pool_kas || '0', n_realized: r.n_markets || 0, pending: p.pool_kas || '0', n_pending: p.n_markets || 0 }));
      lines.push(t(lang, 'broker_role_earnings_link'));
    } else {
      lines.push(t(lang, 'broker_role_earnings_no_data'));
    }
    lines.push(t(lang, 'broker_role_change_token'));
  } else if (status?.onboarded) {
    lines.push(t(lang, 'broker_role_pending', { addr }));
    lines.push(t(lang, 'broker_role_pending_note'));
  } else {
    lines.push(t(lang, 'broker_role_apply_has_addr', { addr }));
    lines.push(t(lang, 'broker_role_apply_step1_hasaddr'));
    lines.push(t(lang, 'broker_role_apply_step2_hasaddr'));
  }
  lines.push('');
  lines.push(t(lang, 'broker_role_warn'));
  lines.push(t(lang, 'help_disclaimer'));
  return lines.join('\n');
}

// KANet-UI 2026-06-23 (Owner 钦定 托管钱包): 生成时的醒目警告 + 助记词 display-once (Bettor 钦定文案模板,
// 含③助记词过 Telegram 泄漏 + ④托管=TG账号安全 + 真钱用自己钱包口径; 不能埋)。
export function walletGenerated(address, mnemonic, lang = 'en') {
  return [
    t(lang, 'wallet_gen_title'),
    t(lang, 'wallet_gen_addr', { addr: address }),
    '',
    t(lang, 'wallet_gen_mnemonic_label'),
    `\`${mnemonic}\``,
    '',
    t(lang, 'wallet_gen_warn_title'),
    t(lang, 'wallet_gen_warn1'),
    t(lang, 'wallet_gen_warn2'),
    t(lang, 'wallet_gen_warn3'),
    t(lang, 'wallet_gen_warn4'),
    t(lang, 'wallet_gen_warn5'),
    '',
    t(lang, 'wallet_gen_next'),
  ].join('\n');
}
// 钱包视图 (地址+余额, 永不含助记词). NWT双守: 存款面必带 custody 警告行.
export function walletView(data, lang = 'en') {
  const bal = (data.balance_kas == null)
    ? t(lang, 'wallet_view_bal_unavail')
    : (data.balance_kas + ' KAS');
  return [
    t(lang, 'wallet_view_title'),
    t(lang, 'wallet_view_addr', { addr: data.address }),
    t(lang, 'wallet_view_bal', { bal }),
    '',
    t(lang, 'wallet_view_actions'),
    t(lang, 'wallet_view_warn'),
  ].join('\n');
}

// 转账 2 步确认 (Bettor: /send 必 confirm)。第一步显金额+目标+常驻托管警告, 待 /confirm。
export function walletSendConfirm(to, amountKas, lang = 'en') {
  return [
    t(lang, 'wallet_send_confirm_title'),
    t(lang, 'wallet_send_confirm_amount', { kas: amountKas }),
    t(lang, 'wallet_send_confirm_to', { to }),
    '',
    t(lang, 'wallet_send_confirm_prompt'),
    t(lang, 'wallet_send_confirm_warn'),
  ].join('\n');
}
export function walletSendDone(txId, amountKas, to, lang = 'en') {
  return [
    t(lang, 'wallet_send_done_title'),
    t(lang, 'wallet_send_done_amount', { kas: amountKas, to }),
    t(lang, 'wallet_send_done_tx', { txid: txId }),
    t(lang, 'wallet_send_done_explorer', { txid: txId }),
  ].join('\n');
}

export function help(lang = 'en') {
  return [
    t(lang, 'help_title'),
    t(lang, 'help_start'),
    t(lang, 'help_wallet'),
    t(lang, 'help_send'),
    t(lang, 'help_link'),
    t(lang, 'help_faucet'),
    t(lang, 'help_swap'),
    t(lang, 'help_bet'),
    t(lang, 'help_mybets'),
    t(lang, 'help_record'),
    t(lang, 'help_discover'),
    t(lang, 'help_broker'),
    t(lang, 'help_earnings'),
    t(lang, 'help_lang'),
    '',
    t(lang, 'help_custody_note'),
    t(lang, 'help_custody_1'),
    t(lang, 'help_custody_2'),
    t(lang, 'help_custody_3'),
    '',
    t(lang, 'help_disclaimer'),
  ].join('\n');
}
