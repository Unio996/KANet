// TG bot user-facing text + flow builders. v1.3: builder voice, testnet/MIT, reactive-only.
// Value/trust steps → the USER acts on-chain via Console/their relay. bot 0 持钥 / 0 execute (J1 S5).
import { CONFIG } from './config.mjs';

export const DISCLAIMER = 'testnet-only · MIT 开源 · 不运营主网 · 非投资建议';

export function startMessage() {
  // §11 v2 (Owner 终裁 2026-06-27): 22行→6行精简. 详情移 /help. 首次用户+1行 /help 提示.
  // custody 警告保留 1 行(NWT 承重 bar: 不可删/弱化). faucet 数量不硬编.
  return [
    '👋 KANet — 无账户，无许可。',
    '',
    '① /wallet 钱包   ② /faucet 领币   ③ /bet 押注',
    '▸ /broker 赚佣金   ▸ /help 全部命令   ▸ /link 绑自己钱包',
    '',
    '⚠ 托管·节点持 key·真钱请 /link 非托管钱包',
    '→ /help 完整指南',
  ].join('\n');
}

// §11 v2 (Owner 终裁 2026-06-27): 老用户极简, 无 /help 提示行. custody 双守行永在.
export function startMessageLinked(addr, custodial = null) {
  const shortAddr = addr.length > 20 ? addr.slice(0, 17) + '…' : addr;
  const custLabel = custodial === true ? '托管·仅试玩' : custodial === false ? 'key 你掌控' : '托管/非托管';
  const custWarn = custodial === false
    ? '⚠ 你的地址 key 只你掌控。/wallet 也可生成托管测试钱包。'
    : '⚠ 托管·节点持 key·真钱请 /link 非托管钱包';
  return [
    '👋 KANet · 你已就绪',
    `📍 ${shortAddr}  ${custLabel}`,
    '',
    '▸ /bet 押注   ▸ /faucet 领币   ▸ /wallet 钱包',
    '▸ /broker 赚佣金   ▸ /help 全部命令',
    '',
    custWarn,
  ].join('\n');
}

// KANet-UI 2026-06-22 (Owner 钦定 broker 收益统计 DM 显): 格式化 address-keyed 收益。
// data = /api/kanet-broker/earnings-by-address 返 {address,realized,pending,refunded,by_market}。
// 链上证: 每已结算单挂 settle_txid explorer 链接。fee=价值分成(后端已用 phase2 实落值)。
// T4 (2026-06-27): nodeIncome = /api/node/income/:pk 返回值 (可选). 非 node 用户传 null 静默略过.
export function brokerEarnings(data, nodeIncome = null) {
  const explorer = (CONFIG.network === 'mainnet') ? 'https://explorer.kaspa.org' : 'https://explorer-tn12.kaspa.org';
  const r = data.realized || {}, p = data.pending || {}, rf = data.refunded || {};
  const by = data.by_market || [];
  if (!by.length) {
    return [
      '💰 你的 broker 收益',
      `📍 ${data.address || ''}`,
      '',
      '还没有经手任何市场。当有市场用你的地址当 broker + 结算后, 1.6% 佣金会落你地址, 这里就能看到。',
      '想接市场? /broker 申请 / 看状态。',
    ].join('\n');
  }
  const lines = [
    '💰 你的 broker 收益',
    `📍 ${data.address || ''}`,
    '',
    `✅ 已实现: ${r.pool_kas || '0'} KAS (${r.n_markets || 0} 单已结算)`,
    `⏳ 待结算: ${p.pool_kas || '0'} KAS (${p.n_markets || 0} 单进行中)`,
  ];
  if ((rf.n_markets || 0) > 0) lines.push(`↩ 已退款: ${rf.pool_kas || '0'} KAS (${rf.n_markets} 单 — 市场退款, 未赚到)`);
  lines.push('', '经手市场 (最近):');
  const icon = (s) => s === 'settled' ? '✅' : (s === 'refunded' ? '↩' : '⏳');
  for (const m of by.slice(0, 10)) {
    const id = String(m.id || '').slice(-12);
    let line = `${icon(m.status)} …${id}  ${m.fee_kas} KAS`;
    if (m.settle_txid) line += `  ${explorer}/txs/${m.settle_txid}`;
    lines.push(line);
  }
  if (by.length > 10) lines.push(`… 余 ${by.length - 10} 单 (在 web broker-home 看全部)`);
  lines.push('', `共经手 ${by.length} 个市场 · 每笔分润落你地址, 链上可验。`);
  // T4: 附加 node 委员收益 (若该地址是本机 relay)
  if (nodeIncome && nodeIncome.total_settled_markets > 0) {
    lines.push('', '⚙ Node 委员收益 (你的地址是本机 oracle relay)');
    lines.push(`  累计: ${nodeIncome.total_node_income_kas?.toFixed(8) || '0'} KAS (${nodeIncome.total_settled_markets} 个市场, 链验)`);
    if ((nodeIncome.pending_tx_index_count || 0) > 0)
      lines.push(`  ⏳ ${nodeIncome.pending_tx_index_count} 笔待索引 (稍后刷新)`);
    lines.push('  注: 均用收款地址 pk 查询; v0.6 用独立签名 key 的极少数情况下该部分可能漏统计。');
  }
  return lines.join('\n');
}

// /hot 热门市场 (Owner 热需求 2026-06-27): T5 trending top-N 格式化.
// markets = trending[]. 返 {text, keyboard} — keyboard = CopyText 深链按钮.
// 支持 card_group_id 分组: 同一 card_group_id 的盘组成一块显示(非散盘).
export function hotMarkets(markets, botUsername) {
  if (!markets || !markets.length) {
    return { text: '暂无热门市场 (市场创建中, 稍后再试)。', keyboard: null };
  }
  function parseTitle(raw) {
    try { const p = JSON.parse(raw); return p.title || raw; } catch { return raw; }
  }
  function fmtDl(deadline) {
    if (!deadline) return '';
    const h = Math.round((Number(deadline) * 1000 - Date.now()) / 3600000);
    return h > 0 ? `${h}h 后截止` : '已过期';
  }
  function legLabel(legKey) {
    if (!legKey) return '';
    if (legKey.startsWith('winner_')) return legKey.slice(7) + ' 赢';
    if (legKey.startsWith('spread_')) return legKey.split('_').slice(1).join(' ');
    if (legKey.startsWith('total_o_')) return '大球 O' + legKey.slice(8);
    if (legKey.startsWith('total_u_')) return '小球 U' + legKey.slice(8);
    return legKey;
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
  const lines = ['🔥 热门市场 Top ' + markets.length + ' · 活跃度+资金加权', ''];
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
    for (const m of gMarkets) {
      const label = m.leg_key ? legLabel(m.leg_key) : parseTitle(m.title || '').split(' — ')[1] || m.id.slice(0, 8);
      const shareUrl = `https://t.me/${BOT}?start=${m.id}`;
      buttons.push([{ text: `🎯 ${label}`, copy_text: { text: shareUrl } }]);
    }
    lines.push('');
    idx++;
  }
  // Singles
  for (const m of singles) {
    const title = parseTitle(m.title);
    const short = title.length > 40 ? title.slice(0, 38) + '…' : title;
    const cat = CAT[m.category] || '🌐';
    const yesOdds = m.yes_implied_prob != null ? Math.round(m.yes_implied_prob * 100) + '%是' : '';
    lines.push(`${idx}. ${cat} ${short}`);
    lines.push(`   💰${(m.total_pool_kas || 0).toFixed(0)} KAS · 👥${m.bettor_count || 0}人${yesOdds ? ' · ' + yesOdds : ''}`);
    const shareUrl = `https://t.me/${BOT}?start=${m.id}`;
    buttons.push([{ text: `🎯 押 #${idx} ${short.slice(0, 20)}`, copy_text: { text: shareUrl } }]);
    lines.push('');
    idx++;
  }
  lines.push('点按钮复制深链 → 转给朋友/自己打开直接押注');
  return { text: lines.join('\n'), keyboard: { inline_keyboard: buttons } };
}

// 兑换 flow — show broker X's KAS receiving address; the USER pays on-chain from their own wallet.
// bot 0 execute: 只显地址 + 引导 + deep-link。broker-intake-watcher 在链上检测到付款后继续。
export function swapFlow(broker) {
  const name = broker?.name || 'broker';
  const addr = broker?.address || '(broker 未配置 — Owner 在 Console 设置页选)';
  return [
    `💱 兑换 KAS ↔ USDT — 经 broker ${name}`,
    '',
    '1) 从你自己的钱包,把要兑换的 KAS 链上转到 broker 收款地址:',
    `   ${addr}`,
    '2) broker 会问你 USDT 收哪条链 + 地址(回复 "用 bnb 0x..." 之类),然后链上回款。',
    '',
    '⚠ 钱全程你自己链上掌控:你从自己地址发起付款,bot 不经手、碰不到你的钱。',
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

export function notifyLine(ev) {
  const tx = (ev.txid || '').slice(0, 12);
  const t = ev.event_type || 'event';
  // KANet-UI 线B P1 (Bettor v2 ③): settle/refund 事件友好化 — 用户押注有结果时给可读+可执行通知,
  // 指向 /mybets 看赢/输/退 + 金额(原 generic '🔔 event tx' 用户看不懂)。金额/赢输详情在 /mybets。
  if (/settle|payout|winner|distribut/i.test(t)) {
    return `🎉 你押注的预测市场结算了! 押中的话 KAS 已到你 /link 地址。\ntx ${tx}… — 回 /mybets 看你赢了多少。`;
  }
  if (/refund/i.test(t)) {
    return `↩ 你押注的市场退款了 (裁决源不可得 / 仲裁人弃权, 押金退回你地址)。\ntx ${tx}… — /mybets 看详情。`;
  }
  if (t === 'tx') {
    return `💰 你的地址有链上入账 (可能是押注结算赢款或退款)。\ntx ${tx}… — /mybets 看你的押注结果。`;
  }
  return `🔔 链上动态: ${t} · tx ${tx}… · ${ev.observed_at || ''}`;
}

// 成为撮合者 (broker / gateway) — Owner UI gap (2026-06-22): 公开面缺 user 级 'become broker' 入口.
// 严格 INFO-ONLY (Bettor security gate): 只讲角色 + 价值分成佣金 + 当前怎么参与(经 Owner/dev fork),
// 【绝不在公开 bot 面给自助注册按钮】—— broker 收 1.6% fee, 公开无 auth 自助注册 = fee 模型被滥用,
// 须先落 /identities trust auth 硬化(banked). bot 0-key/deep-link only, 此命令纯文字引导.
// ⚠ Owner待拍 final wording (同 startMessage).
// KANet-UI 2026-06-22 (Owner 实测派修 + onboarding 闭环已落): /broker 从 INFO-ONLY 升级为真接通自助
// 申请流 (地址制 onboarding 已落 + Owner trust 审批门 = auth 硬化已满足, 公开自助安全)。opts:
//   { addr: 用户 /link 地址 (无则提示先 /link), status: onboard/status 返回 (onboarded/status/trust_level) }
export function brokerRole(opts = {}) {
  const { addr, status, earnings } = opts;
  const lines = [
    '🤝 成为撮合者 (broker)',
    '',
    'broker = 把预测市场 / 兑换撮合给用户, 按协议内置佣金收费(落你自己的链上地址):',
    '· 价值分成(协议常量): 赢家 97% / oracle 1% / broker 1.6% / introducer 0.2% / node 0.2%',
    '· broker 不碰用户资金 —— 用户全程自己链上锁仓+付款, 你只撮合+收佣 (佣金进你地址)',
    '',
  ];
  if (!addr) {
    lines.push('👉 申请当 broker (3 步):');
    lines.push('① 先 /link <你的 kaspatest 地址> — 这地址就是你的 broker 收款地址(佣金落这)');
    lines.push('② 去 @BotFather /newbot 拿一个你自己的 bot token');
    lines.push('③ /broker_apply <你的 bot token> — 提交申请');
  } else if (status?.onboarded && status.status === 'approved') {
    lines.push(`✅ 你已是 approved broker (地址 ${addr})`);
    lines.push('你的 bot 已(或即将由 KANet 托管)拉起, 对外呈现全部市场, 带量成交的佣金落你地址。');
    // T2 (2026-06-27): inline earnings summary for approved brokers.
    if (earnings) {
      const r = earnings.realized || {}, p = earnings.pending || {};
      lines.push(`💰 收益: 已实现 ${r.pool_kas || '0'} KAS (${r.n_markets || 0}单) · 进行中 ${p.pool_kas || '0'} KAS (${p.n_markets || 0}单)`);
      lines.push('· /earnings — 完整链验详情 (各单/explorer 链接)');
    } else {
      lines.push('· /earnings — 看你的 broker 收益 (经手单/已实现/待结算, 链上可验)');
    }
    lines.push('· 改 bot token: /broker_apply <新 token>');
  } else if (status?.onboarded) {
    lines.push(`⏳ 你的 broker 申请已提交 (地址 ${addr}), 待 Owner 审批。`);
    lines.push('审批通过后你的 bot 会被 KANet 自动托管拉起。换 token: /broker_apply <新 token>');
  } else {
    lines.push(`👉 申请当 broker (你已绑地址 ${addr}):`);
    lines.push('① 去 @BotFather /newbot 拿一个你自己的 bot token');
    lines.push('② /broker_apply <你的 bot token> — 提交申请 (待 Owner 审批后激活)');
  }
  lines.push('');
  lines.push('⚠ 申请提交后需 Owner 审批才激活(防佣金滥用/女巫)。你的 bot token 加密存储、绝不外显。');
  lines.push(DISCLAIMER);
  return lines.join('\n');
}

// KANet-UI 2026-06-23 (Owner 钦定 托管钱包): 生成时的醒目警告 + 助记词 display-once (Bettor 钦定文案模板,
// 含③助记词过 Telegram 泄漏 + ④托管=TG账号安全 + 真钱用自己钱包口径; 不能埋)。
export function walletGenerated(address, mnemonic) {
  return [
    '✅ 已为你生成测试网钱包:',
    `📍 地址: ${address}`,
    '',
    '🔑 助记词 (12 词, 现在就备份, 只显示这一次):',
    `\`${mnemonic}\``,
    '',
    '⚠️ 测试网托管钱包 (仅试玩), 务必看清:',
    '· 助记词显示在这条 Telegram 消息里, Telegram 服务器看得到 → 切勿用于真钱',
    '· 私钥由节点托管 (服务器持有), 方便直接玩; 但服务器或你的 Telegram 账号被盗 = 此钱包币会失',
    '· 仅测试币, 零真实价值',
    '· 真用 Kaspa 请用你【自己生成、助记词从未发给任何人/服务】的钱包',
    '· 现在就备份助记词, 它只显示这一次, 系统不会再给你看',
    '',
    '下一步: /faucet 领测试 KAS → /bet 下注。/wallet 看地址余额。',
  ].join('\n');
}
// 钱包视图 (地址+余额, 永不含助记词). NWT双守: 存款面必带 custody 警告行.
export function walletView(data) {
  const bal = (data.balance_kas == null) ? '查询中/RPC 暂不可用' : (data.balance_kas + ' KAS');
  return [
    '👛 你的钱包',
    `📍 地址: ${data.address}`,
    `💰 余额: ${bal}`,
    '',
    '转入用此地址 · /send 转出 · /faucet 领币 · /bet 押注',
    '⚠ 托管·节点持 key·真钱请 /link 非托管钱包',
  ].join('\n');
}

// 转账 2 步确认 (Bettor: /send 必 confirm)。第一步显金额+目标+常驻托管警告, 待 /confirm。
export function walletSendConfirm(to, amountKas) {
  return [
    '请确认转账:',
    `· 金额: ${amountKas} KAS`,
    `· 收款: ${to}`,
    '',
    '回 /confirm 执行, /cancel 取消。',
    '⚠ 测试网托管钱包 · 真钱请用你自己助记词从未外泄的钱包。',
  ].join('\n');
}
export function walletSendDone(txId, amountKas, to) {
  return [
    '✅ 转账已上链:',
    `· 金额: ${amountKas} KAS → ${to}`,
    `· TX: ${txId}`,
    `· 浏览器: https://explorer-tn12.kaspa.org/txs/${txId}`,
  ].join('\n');
}

export function help() {
  return [
    '命令:',
    '/start — 介绍 + 三步上手',
    '/wallet — 生成/查看钱包 (地址+余额+收款, 零门槛玩)',
    '/send <地址> <金额> — 从钱包转 KAS (2 步确认)',
    '/link <kaspatest地址> — 绑定你自己的非托管地址',
    '/faucet — 领测试 KAS（先 /wallet 或 /link）',
    '/swap — 兑换 KAS ↔ USDT(经 broker,链上)',
    '/bet — 押注预测市场',
    '/mybets — 看自己的押注 + 状态',
    '/discover — 浏览开放挂单 / 市场',
    '/broker — 想做撮合者(broker)? 角色 + 佣金 + 申请',
    '/earnings — broker 收益 (经手单/已实现/待结算, 链上可验)',
    '',
    '托管钱包说明:',
    '① 丢了助记词不影响花费权 — 节点持 key, /send /bet 仍正常用',
    '② 想自主掌控: /link 绑你自己钱包地址 → /send 把币转过去',
    '③ 真钱务必用你自己生成、助记词从未外泄的非托管钱包',
    '',
    DISCLAIMER,
  ].join('\n');
}
