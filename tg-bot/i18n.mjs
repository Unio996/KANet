// KANet TG Bot — 中心化 i18n 模块 (Step 1: EN + ZH 核心用户旅程)
// Bettor 2026-06-29 架构: 不 inline 三元, 全走 t(lang, key, vars) 单入口.
// 加第三语言 = 只加 LANGS[<code>] 块, 所有调用点零改动.

export const SUPPORTED_LANGS = ['en', 'zh'];

export const LANGS = {
  en: {
    // /start (unlinked)
    start_title: '👋 KANet — No account. Permissionless.',
    start_commands: '① /wallet Wallet   ② /faucet Get coins   ③ /bet Place bets',
    start_commands_extra: '▸ /broker Earn fees   ▸ /help All commands   ▸ /link Your wallet',
    start_hot: '🔥 /hot — See open markets, bet directly',
    start_custody_warn: '⚠ Custodial · Node holds key · Use /link for real funds',
    start_help: '→ /help Full guide',

    // /start (linked)
    start_linked_title: '👋 KANet · You\'re ready',
    start_linked_custodial_label: 'Custodial · Testplay only',
    start_linked_non_custodial_label: 'Key you hold',
    start_linked_mixed_label: 'Custodial/Non-custodial',
    start_linked_commands: '/bet More markets · /faucet Get coins · /wallet Wallet · /help',
    start_linked_custody_warn: '⚠ Custodial · Node holds key · Use /link for real funds',
    start_linked_non_custodial_warn: '⚠ Your address key is yours alone. /wallet can also generate a custodial test wallet.',
    start_trending_empty: '🔥 Trending: None · /hot to see',

    // Trending block (inside /start)
    trending_header: '🔥 Open Markets — Tap button to enter:',
    trending_more: '/hot for more markets',

    // Sports cards block (inside /start)
    sports_header: '⚽ Sports Betting',
    sports_subheader: 'Tap button to bet directly · /hot trending',
    sports_new: 'New',

    // /hot
    hot_empty: 'No open markets right now (markets creating, try later).',
    hot_title: '🔥 Trending Markets Top {n} · Activity+fund weighted',
    hot_footer: 'Tap button for market details · /bet all markets',
    hot_trust_card: '💰 Funds P2SH-locked on-chain · Rules publicly auditable · Auto-refund on expiry',
    hot_fail: 'Failed to load markets, try again later.',

    // Deadline
    deadline_hours: '{h}h until close',
    deadline_expired: 'Expired',

    // Market full
    market_full: '⚠ This market is full, cannot place bet.\n\nSend /start for available markets 👇',

    // Category menu
    bet_category_title: '🎲 Prediction Markets — Reply with number:',
    bet_category_footer: 'Reply a number. /start to exit anytime.',
    bet_worldcup_label: '🏆 FIFA World Cup',
    bet_search_label: '🔍 Search markets (reply keyword)',
    bet_no_markets: 'No open markets right now. Check back later, or /discover.',

    // Market list
    bet_market_worldcup_head: '🏆 World Cup',
    bet_market_list_footer: 'Reply number to select (see full settlement rules).',
    bet_market_item: '{i}. {title}  · maker {maker} · {deadline} · {count} betted',

    // Search
    bet_search_prompt: '🔍 Reply a keyword (e.g. "FIFA" / "Bitcoin" / "Mariners"). /start to exit.',
    bet_search_head: '🔍 Search "{term}" — {count} markets (reply number):',
    bet_search_none: '🔍 No markets found for "{term}". Try another keyword, or /start → /bet to browse.',

    // Detail page
    bet_detail_maker: 'Maker: {maker}',
    bet_detail_deadline_count: '{deadline} · {count} betted · maker stake {stake} KAS',
    bet_detail_rules_header: '📋 Settlement rules:',
    bet_detail_odds: 'Pool: YES {yp} KAS ({ypp})  ·  NO {np} KAS ({npp})',
    bet_detail_odds_explain: 'Odds = other-side pool / your-side pool (fewer bettors = higher payout if right).',
    bet_detail_low_pool: '⚠ Total pool {total} KAS < 100 KAS — below settlement threshold. Market may not settle.',
    bet_detail_oracle: '🔮 Settled by KANet decentralized oracle committee, on-chain.',
    bet_detail_warn: '⚠ Read the full settlement rules before betting — this is the ONLY basis for outcome.',
    bet_detail_question: 'Which side?',

    // YES/NO buttons
    btn_yes: '🟢 Bet YES',
    btn_no: '🔴 Bet NO',

    // Side stage
    bet_side_invalid: 'Reply 1 (YES) or 2 (NO).',
    bet_amount_prompt: 'You chose {side}. Reply the KAS amount (number), min {min} KAS, e.g. 5.',

    // Amount stage
    bet_amount_invalid: 'Please reply a valid KAS amount (positive number).',
    bet_amount_min: 'Minimum bet is {min} KAS (contract storage-mass floor). Reply a larger amount.',
    bet_amount_no_link: 'Link your Kaspa address first: /link <your kaspatest address>. Then /bet again.',
    bet_amount_expired: '⌛ This market closes soon (<10 min), not enough time for transfer+confirmation. /bet to select another.',
    bet_amount_prep_fail: 'Bet prep failed: {error}',

    // Confirm page (HTML mode)
    bet_confirm_header: '📝 Bet Review — {title}',
    bet_confirm_direction: 'Side: {side} · Amount: {kas} KAS',
    bet_confirm_step: 'Next: send KAS from <b>your own wallet</b> to the address below (bot holds no keys, never touches your funds).',
    bet_confirm_amount_label: '💰 Suggested amount (tap to copy): <code>{kas}</code> KAS',
    bet_confirm_sompi: '   = <code>{sompi}</code> sompi',
    bet_confirm_addr_label: '📮 Address (tap to copy):',
    bet_confirm_uri_label: '📲 Or copy this URI into your wallet (fills address+amount):',
    bet_confirm_warn1: '⚠ This address is generated for your specific bet — any wallet works:',
    bet_confirm_warn2: '· Min <b>1 KAS</b>. Under 1 KAS won\'t register, funds get stuck awaiting refund.',
    bet_confirm_warn3: '· You can send more than shown — actual position is based on what you send.',
    bet_confirm_tip: 'Tip: tap-to-copy the address, paste in wallet then send.',
    bet_confirm_key_warn: '· Any wallet works; but to claim winnings you need the key for your <b>linked address</b>.',
    bet_confirm_prompt: 'Reply <b>1</b> = Confirm send {kas} KAS to this address',
    bet_confirm_cancel_hint: 'Reply <b>0</b> = Cancel',

    // Confirm stage handling
    bet_confirm_no_link: '⚠ No linked kaspatest address — /link <your kaspatest address> first, then /bet again. Need your address key to claim winnings.',
    bet_confirm_cancelled: 'Cancelled, no payment occurred. /bet anytime to start over.',

    // Auto-pay (custodial)
    bet_autopay_success: '✅ Auto-paid {kas} KAS from custodial wallet.\nWaiting for on-chain confirmation (~1-2 min)…\n⚠ Payment sent — cancelling does not refund.',
    bet_autopay_faucet_hint: '\n💡 Custodial balance too low ({bal} KAS). /faucet to get test coins then try again.',

    // Manual pay
    bet_manual_pay_header: '✅ Recorded. Please pay NOW from your wallet:',
    bet_manual_pay_amount: 'Amount: {kas} KAS  (= {sompi} sompi)',
    bet_manual_pay_addr: 'Address: {addr}',
    bet_manual_pay_watching: 'Monitoring this address on-chain. Once ≥1 KAS arrives, I\'ll confirm your bet.',
    bet_manual_pay_min: 'Any ≥1 KAS accepted — actual position based on amount received. /start to cancel monitoring (if already paid, cancel does NOT refund).',

    // Pending payment status
    bet_still_pending: 'Still waiting for your payment:\nAmount {kas} KAS → address {addr}\nPayment auto-confirms on-chain. /start to cancel.',

    // Stale session
    stale_session: '⌛ This looks like a reply to a previous bet flow, but the local session no longer exists (bot restarted or session expired).\nThat bet was not continued, no payment was monitored. Please /bet again.',
    generic_help: 'Use /help for commands · /bet to place bets · /swap to exchange · /link to link address',

    // Misc market errors
    market_not_found: 'Market not found. /bet to choose another.',
    market_bad_spec: 'This market has incomplete settlement rules, betting is disabled (you can\'t know the outcome basis). /bet to select another.',

    // Shared bet flow labels
    btn_share: '🔗 Share this market',
    bet_market_list_head: '{head} — Choose market (reply number):',
    bet_invalid_number: 'Reply a valid number (1-{max}).',
    bet_invalid_market: 'Reply a valid market number (1-{max}).',
    market_count: '{n} markets',

    // /lang
    lang_set_en: '✅ Language set to English.',
    lang_set_zh: '✅ 已切换到中文。',
    lang_usage: 'Usage: /lang en or /lang zh',
  },

  zh: {
    // /start (unlinked)
    start_title: '👋 KANet — 无账户，无许可。',
    start_commands: '① /wallet 钱包   ② /faucet 领币   ③ /bet 押注',
    start_commands_extra: '▸ /broker 赚佣金   ▸ /help 全部命令   ▸ /link 绑自己钱包',
    start_hot: '🔥 /hot — 看热门市场, 直接押注',
    start_custody_warn: '⚠ 托管·节点持 key·真钱请 /link 非托管钱包',
    start_help: '→ /help 完整指南',

    // /start (linked)
    start_linked_title: '👋 KANet · 你已就绪',
    start_linked_custodial_label: '托管·仅试玩',
    start_linked_non_custodial_label: 'key 你掌控',
    start_linked_mixed_label: '托管/非托管',
    start_linked_commands: '/bet 更多市场 · /faucet 领币 · /wallet 钱包 · /help',
    start_linked_custody_warn: '⚠ 托管·节点持 key·真钱请 /link 非托管钱包',
    start_linked_non_custodial_warn: '⚠ 你的地址 key 只你掌控。/wallet 也可生成托管测试钱包。',
    start_trending_empty: '🔥 热门市场: 暂无 · /hot 查看',

    // Trending block
    trending_header: '🔥 热门可押市场 — 点下方按钮进入:',
    trending_more: '/hot 看更多市场',

    // Sports cards block
    sports_header: '⚽ 赛事押注',
    sports_subheader: '按下方按钮复制深链 → 直接押注 · /hot 热榜',
    sports_new: '新盘',

    // /hot
    hot_empty: '暂无热门市场 (市场创建中, 稍后再试)。',
    hot_title: '🔥 热门市场 Top {n} · 活跃度+资金加权',
    hot_footer: '点按钮进入市场详情押注 · /bet 全部市场',
    hot_trust_card: '💰 资金链上 P2SH 锁定 · 规则公开可审计 · 到期自动退',
    hot_fail: '热门市场加载失败, 稍后再试。',

    // Deadline
    deadline_hours: '{h}h 后截止',
    deadline_expired: '已过期',

    // Market full
    market_full: '⚠ 这个市场已满员，无法再押。\n\n发 /start 获取最新可押的盘 👇',

    // Category menu
    bet_category_title: '🎲 押注预测市场 — 选(回复编号):',
    bet_category_footer: '回复数字选项。随时 /start 退出。',
    bet_worldcup_label: '🏆 世界杯专题',
    bet_search_label: '🔍 搜索市场 (回复关键词找)',
    bet_no_markets: '现在没有可押注的市场。稍后再来,或 /discover 看看。',

    // Market list
    bet_market_worldcup_head: '🏆 世界杯专题',
    bet_market_list_footer: '回复数字选市场(看完整结算规则)。',
    bet_market_item: '{i}. {title}  · 出单人 {maker} · {deadline} · {count} 人已押',

    // Search
    bet_search_prompt: '🔍 回复关键词 (= 题干含的字, 比如 "FIFA" / "Bitcoin" / "Mariners")。/start 退出。',
    bet_search_head: '🔍 搜 "{term}" — {count} 个市场(回复编号):',
    bet_search_none: '🔍 "{term}" 没找到符合的市场。回复别的关键词, 或 /start 退出后 /bet 看品类。',

    // Detail page
    bet_detail_maker: '出单人: {maker}',
    bet_detail_deadline_count: '{deadline} · 已 {count} 人押 · maker stake {stake} KAS',
    bet_detail_rules_header: '📋 结算规则:',
    bet_detail_odds: '押注池分布: YES {yp} KAS ({ypp})  ·  NO {np} KAS ({npp})',
    bet_detail_odds_explain: '赔率 = 对方池 / 自方池 (押对越少人, 赢得越多)。',
    bet_detail_low_pool: '⚠ 总池 {total} KAS < 100 KAS, 不到结算门, 押了 deadline 后无法结算。',
    bet_detail_oracle: '🔮 由 KANet 去中心化委员预言机按上述规则裁决、链上结算。',
    bet_detail_warn: '⚠ 押注前请看清【完整结算规则】— 这是判定输赢的唯一依据。',
    bet_detail_question: '你押哪边?',

    // YES/NO buttons
    btn_yes: '🟢 押 YES',
    btn_no: '🔴 押 NO',

    // Side stage
    bet_side_invalid: '请回复 1 (YES) 或 2 (NO)。',
    bet_amount_prompt: '你选 {side}。回复要押的 KAS 金额(数字), 最低 {min} KAS, 例如 5。',

    // Amount stage
    bet_amount_invalid: '请回复有效的 KAS 金额(正数)。',
    bet_amount_min: '最低押注 {min} KAS (合约 storage-mass 下限)。请回复更大的金额。',
    bet_amount_no_link: '押注前需先绑定你的 Kaspa 地址: /link <你的 kaspatest 地址>。绑定后重新 /bet。',
    bet_amount_expired: '⌛ 这个市场快截止了 (剩 <10 分钟), 转账+入账来不及。请 /bet 选别的市场。',
    bet_amount_prep_fail: '押注准备失败: {error}',

    // Confirm page (HTML mode)
    bet_confirm_header: '📝 押注复核 — {title}',
    bet_confirm_direction: '方向 {side} · 金额 {kas} KAS',
    bet_confirm_step: '下一步: <b>从你自己钱包</b>转 KAS 到下面地址 (bot 全程不持钥、不碰你的钱).',
    bet_confirm_amount_label: '💰 建议金额 (点一下复制): <code>{kas}</code> KAS',
    bet_confirm_sompi: '   = <code>{sompi}</code> sompi',
    bet_confirm_addr_label: '📮 地址 (点一下复制):',
    bet_confirm_uri_label: '📲 或复制此 URI 粘到钱包 (一键填好地址+金额):',
    bet_confirm_warn1: '⚠ 这地址是为你这一笔单子生成的, 用任意钱包付都行:',
    bet_confirm_warn2: '· 最低 <b>1 KAS</b>。低于 1 KAS 不入账, 钱会卡在地址里等 refund。',
    bet_confirm_warn3: '· 金额可以高于建议值 — 实际转多少, 仓位就按你转入的金额算。',
    bet_confirm_tip: '建议: 用 tap-to-copy 复制地址, 钱包粘贴再发。',
    bet_confirm_key_warn: '· 任意钱包都能付; 但中奖要用你<b>绑定地址</b>的钥匙领取。',
    bet_confirm_prompt: '回复 <b>1</b> = 确认转 {kas} KAS 到这个地址',
    bet_confirm_cancel_hint: '回复 <b>0</b> = 取消',

    // Confirm stage handling
    bet_confirm_no_link: '⚠ 还没绑定你的 kaspatest 地址 — 请先 /link <你的 kaspatest 地址>, 再 /bet 重来。中奖时需要绑定地址的钥匙领。',
    bet_confirm_cancelled: '已取消, 未发生任何付款。随时 /bet 重新开始。',

    // Auto-pay (custodial)
    bet_autopay_success: '✅ 已从托管钱包自动付 {kas} KAS。\n等链上确认 (~1-2 分钟)…\n⚠ 托管已发出，取消等待不退款。',
    bet_autopay_faucet_hint: '\n💡 托管余额不足 ({bal} KAS)，/faucet 领测试币后重试一键付。',

    // Manual pay
    bet_manual_pay_header: '✅ 已记录。请现在【从你的钱包】付款:',
    bet_manual_pay_amount: '金额: {kas} KAS  (= {sompi} sompi)',
    bet_manual_pay_addr: '地址: {addr}',
    bet_manual_pay_watching: '我在盯这个地址的链上到账, 检测到 ≥1 KAS 到账后通知你押注已入账。',
    bet_manual_pay_min: '任意 ≥1 KAS 都接受 — 实际仓位按你转入额算。/start 取消等待 (若已付款, 取消不退款)。',

    // Pending payment status
    bet_still_pending: '仍在等待你的付款入账:\n金额 {kas} KAS → 地址 {addr}\n付款后我会自动确认。/start 取消等待。',

    // Stale session
    stale_session: '⌛ 这句像是回前次押注流程的话, 但本地会话已不存在(bot 重启或会话过期)。\n之前那笔押注没续上, 也没启动付款监控。请重新 /bet 走一遍。',
    generic_help: '用 /help 看命令 · /bet 押注 · /swap 兑换 · /link 绑定地址',

    // Misc market errors
    market_not_found: '市场未找到。/bet 重选。',
    market_bad_spec: '这个市场缺完整结算规则, 不让押 (= 押了你不知道凭什么判输赢)。/bet 选别的。',

    // Shared bet flow labels
    btn_share: '🔗 分享此市场',
    bet_market_list_head: '{head} — 选市场(回复编号):',
    bet_invalid_number: '请回复有效编号 (1-{max})。',
    bet_invalid_market: '请回复有效市场编号 (1-{max})。',
    market_count: '{n} 个市场',

    // /lang
    lang_set_en: '✅ Language set to English.',
    lang_set_zh: '✅ 已切换到中文。',
    lang_usage: '用法: /lang en 或 /lang zh',
  },
};

/**
 * Translate key with optional variable substitution.
 * Vars: { key: value } replaces {key} in the string.
 * Falls back to 'en' if key missing in requested lang.
 */
export function t(lang, key, vars = {}) {
  const table = LANGS[lang] || LANGS.en;
  let str = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : (LANGS.en[key] ?? `[${key}]`);
  for (const [k, v] of Object.entries(vars)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v == null ? '' : String(v));
  }
  return str;
}

/**
 * Auto-detect lang from Telegram language_code.
 * zh-hans, zh-hant, zh → 'zh'. Everything else → 'en' (international default).
 */
export function detectLang(languageCode) {
  if (!languageCode) return 'en';
  if (String(languageCode).toLowerCase().startsWith('zh')) return 'zh';
  return 'en';
}
