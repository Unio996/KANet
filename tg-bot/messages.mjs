// TG bot user-facing text + flow builders. v1.3: builder voice, testnet/MIT, reactive-only.
// Value/trust steps → the USER acts on-chain via Console/their relay. bot 0 持钥 / 0 execute (J1 S5).
import { CONFIG } from './config.mjs';

export const DISCLAIMER = 'testnet-only · MIT 开源 · 不运营主网 · 非投资建议';

export function startMessage() {
  // gate D onboarding tour (Bettor Q3: low-friction guided sequence). 无账户无许可 + 每步给下一命令.
  // KANet-UI 2026-06-23 (Owner 真机发现 + Bettor 派修): /start 必列钱包命令 (原漏); custody 口径不可一刀切——
  //   托管钱包 (/wallet) 节点持 key, 非托管 (/link) key 用户掌控 (Bettor 承重警告, 不可写"bot 不持 key"假称).
  //   faucet 数量绝不硬编 (由 server env FAUCET_AMOUNT_KAS 定, Owner 可调), 故 /start 不写具体数, 领取时由 API 回真值。
  return [
    '👋 KANet — 用 Kaspa 信任链把 AI agent 接到任何市场。无账户、无许可。',
    '',
    '👉 第一次来？两种玩法，挑一个上手:',
    '',
    '🅰 零门槛试玩（托管钱包，最快）:',
    '① /wallet — 节点为你生成一个测试网钱包（⚠ 节点持 key，仅供试玩）',
    '② /faucet — 领测试 KAS（约 10 秒到账）',
    '③ /bet — 押注预测市场（链上锁定，多评判结算），再 /mybets 看赢/输/退款',
    '',
    '🅱 用你自己的钱包（非托管，key 只你掌控）:',
    '① /link <你的 kaspatest 地址> — 绑定你自己的地址（用任意 Kaspa testnet 钱包生成）',
    '② /faucet — 领测试 KAS',
    '③ /bet — 押注，再 /mybets 看赢/输/退款',
    '',
    '更多:',
    '· /balance · /receive · /send <地址> <金额> — 托管钱包收发',
    '· /swap — 兑换 KAS ↔ USDT（经 broker，链上结算）',
    '· /discover — 浏览开放挂单 / 预测市场',
    '· /broker — 想做撮合者（broker）赚佣金？怎么参与 + 价值分成',
    '· /help — 全部命令',
    '',
    '⚠ /wallet 托管钱包由【节点持 key】，仅供测试网试玩；',
    '   真钱请务必换用你【自己生成、助记词从未发给任何人/服务】的非托管钱包（/link 绑定）。',
    '想自己 build？KANet 开源（MIT），fork 一个角色（broker / oracle / prediction / exchange）跑你自己的节点。',
    DISCLAIMER,
  ].join('\n');
}

// KANet-UI 2026-06-22 (Owner 实测派修): /start 对【已 /link 的用户】不重复三步引导, 改显其绑定地址 +
// 直接给下一步 (Owner 钦定 'personalize-on-link, 显地址 + 最多一个改绑'). 未绑用户仍走 startMessage()。
// KANet-UI 2026-06-23 (Bettor 派修·承重 custody 口径): custody 参数 = true(托管/wallet) / false(非托管/link) /
//   null(查不到 → 不假称任一方, 显两类并存警告)。绝不一刀切写"bot 不持 key"(对托管钱包是假的, 误导用户拿真钱)。
export function startMessageLinked(addr, custodial = null) {
  const lines = [
    '👋 KANet — 你已就绪。',
    '',
    `📍 你的地址: ${addr}`,
  ];
  if (custodial === true) lines.push('   (测试网托管钱包·节点持 key — 仅供试玩)');
  else if (custodial === false) lines.push('   (你自己的非托管地址·改绑: /link <新地址>)');
  else lines.push('   (改绑: /link <新地址>)');
  lines.push(
    '',
    '👉 下一步:',
    '· /bet — 押注预测市场（链上锁定，多评判结算），/mybets 看赢/输/退款',
    '· /faucet — 领测试 KAS',
    '· /swap — 兑换 KAS ↔ USDT（经 broker，链上结算）',
    '· /broker — 想做撮合者赚佣金？申请当 broker + 价值分成',
    '· /discover · /help',
  );
  if (custodial === true) {
    lines.push('· /balance 查余额 · /receive 收款 · /send <地址> <金额> 转账');
    lines.push('');
    lines.push('⚠ 你用的是测试网【托管钱包】：私钥由节点持有，方便零门槛试玩。');
    lines.push('   真钱请务必换用你【自己生成、助记词从未外泄】的非托管钱包。');
  } else if (custodial === false) {
    lines.push('');
    lines.push('⚠ 这个地址由你自己链上掌控，bot 不持它的 key——每笔付款都你从自己钱包链上发起。');
    lines.push('   (想零门槛试玩也可 /wallet 生成测试网托管钱包，但托管钱包节点持 key，仅供试玩。)');
  } else {
    lines.push('');
    lines.push('⚠ 若你用 /wallet 托管钱包：私钥由节点持有，仅供测试网试玩；');
    lines.push('   若你 /link 自己地址：key 只你掌控。真钱请务必用你自己助记词从未外泄的非托管钱包。');
  }
  lines.push(DISCLAIMER);
  return lines.join('\n');
}

// KANet-UI 2026-06-22 (Owner 钦定 broker 收益统计 DM 显): 格式化 address-keyed 收益。
// data = /api/kanet-broker/earnings-by-address 返 {address,realized,pending,refunded,by_market}。
// 链上证: 每已结算单挂 settle_txid explorer 链接。fee=价值分成(后端已用 phase2 实落值)。
export function brokerEarnings(data) {
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
  return lines.join('\n');
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
  const { addr, status } = opts;
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
    lines.push('· /earnings — 看你的 broker 收益 (经手单/已实现/待结算, 链上可验)');
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
// 钱包视图 (地址+余额, 永不含助记词) + 测试网页脚。
export function walletView(data) {
  const bal = (data.balance_kas == null) ? '查询中/RPC 暂不可用' : (data.balance_kas + ' KAS');
  return [
    '👛 你的测试网托管钱包:',
    `📍 地址: ${data.address}`,
    `💰 余额: ${bal}`,
    '',
    '/receive 收款(给别人转你用此地址) · /faucet 领测试币 · /bet 下注',
    '⚠ 测试网托管钱包 · 真钱请用你自己助记词从未外泄的钱包。',
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
    '/wallet — 生成/查看你的测试网托管钱包 (零门槛玩)',
    '/balance — 查钱包余额  /receive — 显收款地址',
    '/send <地址> <金额> — 从钱包转 KAS (2 步确认)',
    '/link <kaspatest地址> — 绑定你的地址',
    '/faucet — 领测试 KAS（先 /wallet 或 /link）',
    '/swap — 兑换 KAS ↔ USDT(经 broker,链上)',
    '/bet — 押注预测市场',
    '/mybets — 看自己的押注 + 状态',
    '/discover — 浏览开放挂单 / 市场',
    '/broker — 想做撮合者(broker)? 角色 + 佣金 + 申请',
    '/earnings — broker 收益 (经手单/已实现/待结算, 链上可验)',
    '',
    DISCLAIMER,
  ].join('\n');
}
