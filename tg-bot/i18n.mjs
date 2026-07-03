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
    start_lang_btn_zh: '🌐 中文',

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
    bet_autopay_success: '✅ Auto-paid {kas} KAS from custodial wallet.\nWaiting for on-chain confirmation (~10 sec)…\n⚠ Payment sent — cancelling does not refund.',
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

    // /help
    help_title: 'Commands:',
    help_start: '/start — Intro + 3-step onboarding',
    help_wallet: '/wallet — Create/view wallet (address+balance+receive, zero barrier)',
    help_send: '/send <addr> <amount> — Send KAS from wallet (2-step confirm)',
    help_link: '/link <kaspatest addr> — Bind your own non-custodial address',
    help_faucet: '/faucet — Get testnet KAS (first /wallet or /link)',
    help_swap: '/swap — Exchange KAS ↔ USDT (via broker, on-chain)',
    help_lang: '/lang en|zh — Switch display language',
    help_bet: '/bet — Place bets on prediction markets',
    help_mybets: '/mybets — View your bets + status',
    help_record: '/record — Your win rate + net P&L summary card',
    help_discover: '/discover — Browse open markets / listings',
    help_broker: '/broker — Want to be a matcher (broker)? Role + fees + apply',
    help_earnings: '/earnings — Broker earnings (handled/realized/pending, chain-verifiable)',
    help_custody_note: 'Custodial wallet notes:',
    help_custody_1: '① Lost mnemonic still works — node holds key, /send /bet still work',
    help_custody_2: '② Want full control: /link bind your own wallet → /send transfer funds there',
    help_custody_3: '③ For real funds, use your own non-custodial wallet (mnemonic never shared)',
    help_disclaimer: 'testnet-only · MIT open source · no mainnet operations · not investment advice',

    // /wallet — generated (new wallet)
    wallet_gen_title: '✅ Testnet wallet created:',
    wallet_gen_addr: '📍 Address: {addr}',
    wallet_gen_mnemonic_label: '🔑 Mnemonic (12 words — back up NOW, shown only once):',
    wallet_gen_warn_title: '⚠️ Testnet custodial wallet (test play only) — read carefully:',
    wallet_gen_warn1: '· Mnemonic shown in this Telegram message — Telegram servers can see it → never use for real funds',
    wallet_gen_warn2: '· Private key held by node (server-custodial); server or your Telegram account compromised = funds at risk',
    wallet_gen_warn3: '· Testnet coins only, zero real value',
    wallet_gen_warn4: '· For real Kaspa use your own wallet whose mnemonic has never been shared with anyone',
    wallet_gen_warn5: '· Back up your mnemonic now — it is shown only once, the system will never show it again',
    wallet_gen_next: 'Next: /faucet to get testnet KAS → /bet to place bets. /wallet to view balance.',

    // /wallet — view (existing wallet)
    wallet_view_title: '👛 Your wallet',
    wallet_view_addr: '📍 Address: {addr}',
    wallet_view_bal: '💰 Balance: {bal}',
    wallet_view_bal_unavail: 'Loading / RPC unavailable',
    wallet_view_actions: 'Deposit to this address · /send to transfer · /faucet for coins · /bet to place bets',
    wallet_view_warn: '⚠ Custodial · Node holds key · Use /link for real funds',

    // /wallet — send confirm / done
    wallet_send_confirm_title: 'Please confirm transfer:',
    wallet_send_confirm_amount: '· Amount: {kas} KAS',
    wallet_send_confirm_to: '· Recipient: {to}',
    wallet_send_confirm_prompt: 'Reply /confirm to execute, /cancel to abort.',
    wallet_send_confirm_warn: '⚠ Testnet custodial wallet · For real funds use your own wallet with secure mnemonic.',
    wallet_send_done_title: '✅ Transfer submitted on-chain:',
    wallet_send_done_amount: '· Amount: {kas} KAS → {to}',
    wallet_send_done_tx: '· TX: {txid}',
    wallet_send_done_explorer: '· Explorer: https://explorer-tn12.kaspa.org/txs/{txid}',

    // /wallet inline error strings
    wallet_fail: 'Wallet operation failed: {error}',
    wallet_view_fallback: 'Your wallet: {addr}',
    wallet_no_wallet: "You don't have a wallet yet. /wallet to create one (zero barrier).",
    wallet_receive_label: 'Receive address (share with sender):\n{addr}\n⚠ Testnet wallet.',
    wallet_receive_no_wallet: "You don't have a wallet yet. /wallet to create one.",
    wallet_send_usage: 'Usage: /send <kaspatest addr> <amount KAS>\nExample: /send kaspatest:qq... 5',
    wallet_send_bad_addr: 'Invalid recipient address (must start with kaspatest:...)',
    wallet_send_bad_amount: 'Invalid amount — must be a positive number.',
    wallet_confirm_none: 'No pending transfer. /send <addr> <amount> to start.',
    wallet_confirm_timeout: 'Confirm timed out (>5 min), please /send again.',
    wallet_send_fail: 'Transfer failed: {error}',
    wallet_cancel_transfer: 'Transfer cancelled.',
    wallet_cancel_generic: 'Cancelled.',

    // /link
    link_usage: 'Usage: /link <your kaspatest address>',
    link_fail: 'Link failed: {error}',
    link_ok: '✅ Linked {addr}.\nYou\'ll be notified on-chain activity for this address.\n/bet to start betting.',

    // /faucet
    faucet_no_link: 'First /link <your kaspatest address> or /wallet to create one, then /faucet.',
    faucet_cooldown: 'You already claimed today — try again in about {hrs}h.',
    faucet_fail: 'Claim failed: {error}',
    faucet_ok: '✅ Sent {amt} to {addr}\ntx {tx}… (~10 sec to arrive)\nNext: /bet to place bets.',

    // /verify (deprecated)
    verify_redirect: 'Use /link <your kaspatest address> to bind. Then /bet to start betting.',

    // /discover
    discover_text: 'Browse:\n· /bet — Place bets on prediction markets (full menu)\n· /hot — Top 5 trending markets (activity+fund weighted)\n· /swap — Exchange KAS ↔ USDT (via broker)\n· /mybets — View your bets + status',

    // /earnings inline
    earnings_no_link: 'First /link <your kaspatest address> (= your broker receive address), then /earnings.',
    earnings_fail: 'Earnings query failed: {error}',

    // /broker_apply inline
    broker_apply_no_link: 'First /link <your kaspatest address> (this address = your broker receive address), then /broker_apply.',
    broker_apply_usage: 'Usage: /broker_apply <your @BotFather bot token>\nGet token from @BotFather with /newbot (looks like 123456:ABC-...).',
    broker_apply_fail: 'Application failed: {error}',
    broker_apply_ok: '✅ Application submitted!\n📍 Broker address: {addr}\n⏳ Status: Pending Owner approval (once approved, KANet auto-manages your bot, shows markets, fees go to your address).\nCheck status: /broker · Token is encrypted, never shown.',

    // /swap function (messages.mjs)
    swap_title: '💱 Exchange KAS ↔ USDT — via {name}',
    swap_testnet_note: '⚠ Swap is fully implemented and ready — mainnet only. This is a testnet preview: do NOT send KAS here.',
    swap_step1: '1) From your own wallet, send the KAS you want to exchange on-chain to the broker receive address:',
    swap_step2: '2) The broker will ask for your USDT receive chain + address (reply "use bnb 0x..." etc.), then sends payment on-chain.',
    swap_warn: '⚠ Your funds are under your control at all times: you initiate payment from your own address, bot never touches your funds.',

    // /broker role function (messages.mjs)
    broker_role_title: '🤝 Become a matcher (broker)',
    broker_role_desc1: 'broker = bring prediction markets / exchanges to users, earning protocol-set fees (paid to your on-chain address):',
    broker_role_fees: '· Value split (protocol constant): Winner 97% / oracle 1% / broker 1.6% / introducer 0.2% / node 0.2%',
    broker_role_no_custody: '· broker never holds user funds — users lock+pay on-chain themselves, you match+earn (fees go to your address)',
    broker_role_apply_steps: '👉 Apply to be a broker (3 steps):',
    broker_role_step1_noaddr: '① First /link <your kaspatest address> — this address is your broker receive address (fees go here)',
    broker_role_step2: '② Get a bot token from @BotFather with /newbot',
    broker_role_step3: '③ /broker_apply <your bot token> — submit application',
    broker_role_approved: '✅ You are an approved broker (address {addr})',
    broker_role_approved_bot: 'Your bot is (or will soon be) managed by KANet, showing all markets, fees go to your address.',
    broker_role_earnings: '💰 Earnings: Realized {realized} KAS ({n_realized} markets) · Pending {pending} KAS ({n_pending} markets)',
    broker_role_earnings_link: '· /earnings — Full chain-verified details (per market / explorer links)',
    broker_role_earnings_no_data: '· /earnings — View your broker earnings (handled/realized/pending, chain-verifiable)',
    broker_role_change_token: '· Change bot token: /broker_apply <new token>',
    broker_role_pending: '⏳ Your broker application is submitted (address {addr}), pending Owner approval.',
    broker_role_pending_note: 'Once approved your bot will be auto-managed by KANet. Change token: /broker_apply <new token>',
    broker_role_apply_has_addr: '👉 Apply to be a broker (you have address {addr}):',
    broker_role_apply_step1_hasaddr: '① Get a bot token from @BotFather with /newbot',
    broker_role_apply_step2_hasaddr: '② /broker_apply <your bot token> — submit application (pending Owner approval to activate)',
    broker_role_warn: '⚠ Application requires Owner approval before activation (prevents fee abuse/sybil). Your bot token is encrypted and never shown.',

    // brokerEarnings function (messages.mjs)
    earnings_title: '💰 Your broker earnings',
    earnings_no_markets: "You haven't handled any markets yet. When a market uses your address as broker + settles, the 1.6% fee goes to your address and you'll see it here.",
    earnings_no_markets_apply: 'Want to handle markets? /broker to apply / check status.',
    earnings_realized: '✅ Realized: {kas} KAS ({n} markets settled)',
    earnings_pending: '⏳ Pending: {kas} KAS ({n} markets in progress)',
    earnings_refunded: '↩ Refunded: {kas} KAS ({n} markets — market refunded, nothing earned)',
    earnings_recent: 'Handled markets (recent):',
    earnings_more: '… {n} more (view all in web broker-home)',
    earnings_total: 'Total {n} markets handled · each fee paid to your address, chain-verifiable.',
    earnings_node_title: '⚙ Node committee earnings (your address is this node\'s oracle relay)',
    earnings_node_total: '  Total: {kas} KAS ({n} markets, chain-verified)',
    earnings_node_pending: '  ⏳ {n} tx(s) pending index (refresh soon)',
    earnings_node_note: '  Note: queried by receive address pk.',
    earnings_testnet_note: 'ℹ testnet KAS only — not real money, not investment advice.',

    // brokerFeeDmText function (messages.mjs)
    fee_dm_title: '💰 Fee received',
    fee_dm_body: 'Your market "{title}" has settled',
    fee_dm_amount: 'This payment: +{kas} KAS',
    fee_dm_link: '▸ /earnings for details',
    fee_dm_testnet_note: 'ℹ testnet KAS only — not real money, not investment advice.',

    // notifyLine function (messages.mjs)
    notify_settle: '🎉 Your prediction market bet settled! If you won, KAS is at your /link address.\ntx {tx}… — /mybets to see how much you won.',
    notify_refund: '↩ Your market refunded (oracle source unavailable / arbitrators abstained, stake returned to your address).\ntx {tx}… — /mybets for details.',
    notify_broker_fee: '💰 Fee received {kas} KAS · Market: {title}\ntx {tx}… · /earnings for summary',
    notify_tx: '💰 On-chain activity on your address (may be bet settlement payout or refund).\ntx {tx}… — /mybets to check your bet results.',
    notify_generic: '🔔 On-chain activity: {type} · tx {tx}… · {time}',

    // pollPendingBets messages
    poll_deadline_passed: '⌛ Market has closed, stopped monitoring payment. If you already paid, it will still be counted/settled normally.',
    poll_registered: '✅ Bet confirmed! {side} · {kas} KAS\nMarket: {question}\nOn-chain arrival detected, side is locked. Winnings sent to your linked address after settlement.',
    poll_wrong_payment: '⚠ A payment with incorrect amount was detected at this address.\nPer contract rules, wrong-amount payments cannot be registered, and underpayments are permanently locked with no refund.\nYour bet is not registered. Do not send more to this address (further payments are also unrecoverable).',
    poll_linkedaddr_error: '⚠ Bet order error (backend: {error}).\nPlease /link <kaspatest address> first, then /bet again.\n(If you already paid to the address shown, that bet is unrecoverable — do not pay again.)',
    poll_no_linkedaddr: '⚠ This bet order has an error: missing linked address (old session data lost). Bet was not registered and will not auto-confirm. Please /link <kaspatest address> first, then /bet again through the full flow.\n(If you already paid to the address shown last time, that bet is unrecoverable — do not pay again.)',

    // pollSettleResults messages
    poll_win: '🎉 [{question}]\nYou won! Bet {side} {stake} KAS → expecting {payout} KAS payout (settle TX: {tx}...)\nFunds sent to your linked address — check wallet.',
    poll_lose: '😞 [{question}]\nYou lost.\nResult: {outcome} (you bet {side}) · Stake {stake} KAS\nSettle TX: {tx}...',
    poll_neutral: '📊 [{question}] Settled\nYour bet: {side} · {stake} KAS · settle TX {tx}...\nWaiting for final outcome annotation (will notify win/lose next poll).',
    poll_refund: '💸 [{question}] Refunded\nMarket cancelled/disputed, refund TX: {tx}...\nYour stake returned to linked address.',

    // /mybets (prediction-menu.mjs)
    mybets_no_link: '⚠ No linked address. First /link <kaspatest address> to see your bets.',
    mybets_fail: 'Query failed: {error}',
    mybets_empty: 'No bet history yet. /bet to start.',
    mybets_header: '📋 Your bets ({n} bets, {m} markets)',
    mybets_total_in: '💰 Total staked: {kas} KAS',
    mybets_total_back: '🔁 Total returned: {kas} KAS (won {won} + refunded {refunded})',
    mybets_total_active: '📍 Total active: {kas} KAS (still in system)',
    mybets_net: '📊 Net {sign}{kas} KAS',
    mybets_detail_prefix: 'Summary: {detail}',
    mybets_detail_open: 'Active {n} bets ({kas} KAS)',
    mybets_detail_awaiting: 'Awaiting result {n} bets ({kas} KAS)',
    mybets_detail_settled_pending: 'Pending payout {n} bets ({kas} KAS)',
    mybets_detail_lost: 'Lost {kas} KAS',
    mybets_status_win: '🎉 Won +{kas} KAS',
    mybets_status_lose: '😞 Lost -{kas} KAS',
    mybets_status_refunded: '💸 Refunded',
    mybets_status_settled_chain: '⚖ Settled · Awaiting payout (settle TX on-chain)',
    mybets_status_deadline_vote: '⏳ Past deadline · Awaiting committee vote',
    mybets_status_active: '📍 Active · Pays out after close',
    mybets_status_mixed: '📊 Mixed (won {won} · lost {lost} · active {open} · refunded {refunded} · pending {pending})',
    mybets_if_win: '  If win: {kas} KAS',
    mybets_dir_cnt: ' ({n} bets)',
    mybets_placed_at: '  Placed: {time}',
    mybets_deadline: '  Closes {deadline} · Auto-settles after close to linked address',
    mybets_addmore: '➕ More/reverse: {title}',

    // /record (formatRecordCard, prediction-menu.mjs) — 世界杯玩法 UI 战绩卡
    record_empty: 'No bet history yet. /bet to start.',
    record_title: '🏆 Your Record',
    record_bets_markets: '{n} bets across {m} markets',
    record_winrate: 'Win rate: {pct}% ({won}W-{lost}L)',
    record_winrate_none: 'Win rate: no settled bets yet',
    record_net: 'Net {sign}{kas} KAS',
    record_open: '📍 {n} still active',
    record_refunded: '💸 {n} refunded',
    record_footer: 'ℹ testnet KAS only — not real money, not investment advice.',
  },

  zh: {
    // /start (unlinked)
    start_title: '👋 KANet — 无账户，无许可。',
    start_commands: '① /wallet 钱包   ② /faucet 领币   ③ /bet 押注',
    start_commands_extra: '▸ /broker 赚佣金   ▸ /help 全部命令   ▸ /link 绑自己钱包',
    start_hot: '🔥 /hot — 看热门市场, 直接押注',
    start_custody_warn: '⚠ 托管·节点持 key·真钱请 /link 非托管钱包',
    start_help: '→ /help 完整指南',
    start_lang_btn_en: '🌐 English',

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
    bet_autopay_success: '✅ 已从托管钱包自动付 {kas} KAS。\n等链上确认 (~10 秒)…\n⚠ 托管已发出，取消等待不退款。',
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

    // /help
    help_title: '命令:',
    help_start: '/start — 介绍 + 三步上手',
    help_wallet: '/wallet — 生成/查看钱包 (地址+余额+收款, 零门槛玩)',
    help_send: '/send <地址> <金额> — 从钱包转 KAS (2 步确认)',
    help_link: '/link <kaspatest地址> — 绑定你自己的非托管地址',
    help_faucet: '/faucet — 领测试 KAS（先 /wallet 或 /link）',
    help_swap: '/swap — 兑换 KAS ↔ USDT(经 broker,链上)',
    help_lang: '/lang en|zh — 切换显示语言',
    help_bet: '/bet — 押注预测市场',
    help_mybets: '/mybets — 看自己的押注 + 状态',
    help_record: '/record — 你的胜率 + 净盈亏战绩卡',
    help_discover: '/discover — 浏览开放挂单 / 市场',
    help_broker: '/broker — 想做撮合者(broker)? 角色 + 佣金 + 申请',
    help_earnings: '/earnings — broker 收益 (经手单/已实现/待结算, 链上可验)',
    help_custody_note: '托管钱包说明:',
    help_custody_1: '① 丢了助记词不影响花费权 — 节点持 key, /send /bet 仍正常用',
    help_custody_2: '② 想自主掌控: /link 绑你自己钱包地址 → /send 把币转过去',
    help_custody_3: '③ 真钱务必用你自己生成、助记词从未外泄的非托管钱包',
    help_disclaimer: 'testnet-only · MIT 开源 · 不运营主网 · 非投资建议',

    // /wallet — generated
    wallet_gen_title: '✅ 已为你生成测试网钱包:',
    wallet_gen_addr: '📍 地址: {addr}',
    wallet_gen_mnemonic_label: '🔑 助记词 (12 词, 现在就备份, 只显示这一次):',
    wallet_gen_warn_title: '⚠️ 测试网托管钱包 (仅试玩), 务必看清:',
    wallet_gen_warn1: '· 助记词显示在这条 Telegram 消息里, Telegram 服务器看得到 → 切勿用于真钱',
    wallet_gen_warn2: '· 私钥由节点托管 (服务器持有), 方便直接玩; 但服务器或你的 Telegram 账号被盗 = 此钱包币会失',
    wallet_gen_warn3: '· 仅测试币, 零真实价值',
    wallet_gen_warn4: '· 真用 Kaspa 请用你【自己生成、助记词从未发给任何人/服务】的钱包',
    wallet_gen_warn5: '· 现在就备份助记词, 它只显示这一次, 系统不会再给你看',
    wallet_gen_next: '下一步: /faucet 领测试 KAS → /bet 下注。/wallet 看地址余额。',

    // /wallet — view
    wallet_view_title: '👛 你的钱包',
    wallet_view_addr: '📍 地址: {addr}',
    wallet_view_bal: '💰 余额: {bal}',
    wallet_view_bal_unavail: '查询中/RPC 暂不可用',
    wallet_view_actions: '转入用此地址 · /send 转出 · /faucet 领币 · /bet 押注',
    wallet_view_warn: '⚠ 托管·节点持 key·真钱请 /link 非托管钱包',

    // /wallet — send confirm / done
    wallet_send_confirm_title: '请确认转账:',
    wallet_send_confirm_amount: '· 金额: {kas} KAS',
    wallet_send_confirm_to: '· 收款: {to}',
    wallet_send_confirm_prompt: '回 /confirm 执行, /cancel 取消。',
    wallet_send_confirm_warn: '⚠ 测试网托管钱包 · 真钱请用你自己助记词从未外泄的钱包。',
    wallet_send_done_title: '✅ 转账已上链:',
    wallet_send_done_amount: '· 金额: {kas} KAS → {to}',
    wallet_send_done_tx: '· TX: {txid}',
    wallet_send_done_explorer: '· 浏览器: https://explorer-tn12.kaspa.org/txs/{txid}',

    // /wallet inline error strings
    wallet_fail: '钱包操作失败: {error}',
    wallet_view_fallback: '你的钱包: {addr}',
    wallet_no_wallet: '你还没有钱包。/wallet 生成一个 (零门槛玩)。',
    wallet_receive_label: '收款地址 (把它给对方往这转):\n{addr}\n⚠ 测试网钱包。',
    wallet_receive_no_wallet: '你还没有钱包。/wallet 生成一个。',
    wallet_send_usage: '用法: /send <kaspatest地址> <金额KAS>\n例: /send kaspatest:qq... 5',
    wallet_send_bad_addr: '收款地址非法 (须 kaspatest:...)',
    wallet_send_bad_amount: '金额非法, 须正数。',
    wallet_confirm_none: '没有待确认的转账。/send <地址> <金额> 发起。',
    wallet_confirm_timeout: '确认超时 (>5 分钟), 请重新 /send。',
    wallet_send_fail: '转账失败: {error}',
    wallet_cancel_transfer: '已取消转账。',
    wallet_cancel_generic: '已取消。',

    // /link
    link_usage: '用法: /link <你的 kaspatest 地址>',
    link_fail: '绑定失败: {error}',
    link_ok: '✅ 已绑定 {addr}。\n这个地址有链上动态会通知你。\n/bet 开始押注。',

    // /faucet
    faucet_no_link: '先 /link <你的 kaspatest 地址> 绑定，再 /faucet 领测试币。',
    faucet_cooldown: '你今天已领过测试币，约 {hrs} 小时后可再领。',
    faucet_fail: '领取失败：{error}',
    faucet_ok: '✅ 已发 {amt} 到 {addr}\ntx {tx}…（约 10 秒到账）\n下一步：/bet 开始押注。',

    // /verify (deprecated)
    verify_redirect: '用 /link <你的 kaspatest 地址> 绑定即可。/bet 开始押注。',

    // /discover
    discover_text: '浏览:\n· /bet — 押注预测市场 (全菜单选品类/市场)\n· /hot — 热门市场 Top5 (活跃度+资金加权)\n· /swap — 兑换 KAS ↔ USDT (经 broker)\n· /mybets — 看自己的押注 + 状态',

    // /earnings inline
    earnings_no_link: '先 /link <你的 kaspatest 地址> 绑定 (= 你的 broker 收款地址), 再 /earnings 看收益。',
    earnings_fail: '收益查询失败: {error}',

    // /broker_apply inline
    broker_apply_no_link: '先 /link <你的 kaspatest 地址> 绑定 (这地址 = 你的 broker 收款地址), 再 /broker_apply。',
    broker_apply_usage: '用法: /broker_apply <你的 @BotFather bot token>\n去 @BotFather 发 /newbot 拿 token (形如 123456:ABC-...)。',
    broker_apply_fail: '申请失败: {error}',
    broker_apply_ok: '✅ 申请已提交！\n📍 broker 地址: {addr}\n⏳ 状态: 待 Owner 审批 (批准后 KANet 自动托管拉起你的 bot, 对外呈现市场, 带量佣金落你地址)。\n查状态: /broker · token 已加密存储绝不外显。',

    // /swap function
    swap_title: '💱 兑换 KAS ↔ USDT — 经 {name}',
    swap_testnet_note: '⚠ 兑换功能已完整实现，仅在主网运行。这是测试网预览，请勿在此发送 KAS。',
    swap_step1: '1) 从你自己的钱包,把要兑换的 KAS 链上转到 broker 收款地址:',
    swap_step2: '2) broker 会问你 USDT 收哪条链 + 地址(回复 "用 bnb 0x..." 之类),然后链上回款。',
    swap_warn: '⚠ 钱全程你自己链上掌控:你从自己地址发起付款,bot 不经手、碰不到你的钱。',

    // /broker role function
    broker_role_title: '🤝 成为撮合者 (broker)',
    broker_role_desc1: 'broker = 把预测市场 / 兑换撮合给用户, 按协议内置佣金收费(落你自己的链上地址):',
    broker_role_fees: '· 价值分成(协议常量): 赢家 97% / oracle 1% / broker 1.6% / introducer 0.2% / node 0.2%',
    broker_role_no_custody: '· broker 不碰用户资金 —— 用户全程自己链上锁仓+付款, 你只撮合+收佣 (佣金进你地址)',
    broker_role_apply_steps: '👉 申请当 broker (3 步):',
    broker_role_step1_noaddr: '① 先 /link <你的 kaspatest 地址> — 这地址就是你的 broker 收款地址(佣金落这)',
    broker_role_step2: '② 去 @BotFather /newbot 拿一个你自己的 bot token',
    broker_role_step3: '③ /broker_apply <你的 bot token> — 提交申请',
    broker_role_approved: '✅ 你已是 approved broker (地址 {addr})',
    broker_role_approved_bot: '你的 bot 已(或即将由 KANet 托管)拉起, 对外呈现全部市场, 带量成交的佣金落你地址。',
    broker_role_earnings: '💰 收益: 已实现 {realized} KAS ({n_realized}单) · 进行中 {pending} KAS ({n_pending}单)',
    broker_role_earnings_link: '· /earnings — 完整链验详情 (各单/explorer 链接)',
    broker_role_earnings_no_data: '· /earnings — 看你的 broker 收益 (经手单/已实现/待结算, 链上可验)',
    broker_role_change_token: '· 改 bot token: /broker_apply <新 token>',
    broker_role_pending: '⏳ 你的 broker 申请已提交 (地址 {addr}), 待 Owner 审批。',
    broker_role_pending_note: '审批通过后你的 bot 会被 KANet 自动托管拉起。换 token: /broker_apply <新 token>',
    broker_role_apply_has_addr: '👉 申请当 broker (你已绑地址 {addr}):',
    broker_role_apply_step1_hasaddr: '① 去 @BotFather /newbot 拿一个你自己的 bot token',
    broker_role_apply_step2_hasaddr: '② /broker_apply <你的 bot token> — 提交申请 (待 Owner 审批后激活)',
    broker_role_warn: '⚠ 申请提交后需 Owner 审批才激活(防佣金滥用/女巫)。你的 bot token 加密存储、绝不外显。',

    // brokerEarnings function
    earnings_title: '💰 你的 broker 收益',
    earnings_no_markets: '还没有经手任何市场。当有市场用你的地址当 broker + 结算后, 1.6% 佣金会落你地址, 这里就能看到。',
    earnings_no_markets_apply: '想接市场? /broker 申请 / 看状态。',
    earnings_realized: '✅ 已实现: {kas} KAS ({n} 单已结算)',
    earnings_pending: '⏳ 待结算: {kas} KAS ({n} 单进行中)',
    earnings_refunded: '↩ 已退款: {kas} KAS ({n} 单 — 市场退款, 未赚到)',
    earnings_recent: '经手市场 (最近):',
    earnings_more: '… 余 {n} 单 (在 web broker-home 看全部)',
    earnings_total: '共经手 {n} 个市场 · 每笔分润落你地址, 链上可验。',
    earnings_node_title: '⚙ Node 委员收益 (你的地址是本机 oracle relay)',
    earnings_node_total: '  累计: {kas} KAS ({n} 个市场, 链验)',
    earnings_node_pending: '  ⏳ {n} 笔待索引 (稍后刷新)',
    earnings_node_note: '  注: 均用收款地址 pk 查询。',
    earnings_testnet_note: 'ℹ 仅测试网 KAS · 非真钱 · 非投资建议。',

    // brokerFeeDmText
    fee_dm_title: '💰 收益到账',
    fee_dm_body: '你经手的市场「{title}」已结算',
    fee_dm_amount: '本笔 +{kas} KAS',
    fee_dm_link: '▸ /earnings 看明细',
    fee_dm_testnet_note: 'ℹ 仅测试网 KAS · 非真钱 · 非投资建议。',

    // notifyLine
    notify_settle: '🎉 你押注的预测市场结算了! 押中的话 KAS 已到你 /link 地址。\ntx {tx}… — 回 /mybets 看你赢了多少。',
    notify_refund: '↩ 你押注的市场退款了 (裁决源不可得 / 仲裁人弃权, 押金退回你地址)。\ntx {tx}… — /mybets 看详情。',
    notify_broker_fee: '💰 佣金到账 {kas} KAS · 市场: {title}\ntx {tx}… · /earnings 看汇总',
    notify_tx: '💰 你的地址有链上入账 (可能是押注结算赢款或退款)。\ntx {tx}… — /mybets 看你的押注结果。',
    notify_generic: '🔔 链上动态: {type} · tx {tx}… · {time}',

    // pollPendingBets messages
    poll_deadline_passed: '⌛ 市场已截止, 停止盯付款。若你已付款会照常入账/结算。',
    poll_registered: '✅ 押注已入账! {side} · {kas} KAS\n市场: {question}\n链上到账检测成功, side 已锁仓。结算后用绑定地址领取。',
    poll_wrong_payment: '⚠ 检测到一笔金额不符的付款到该地址。\n按合约规则, 金额不符的付款无法被正确入账, 且【少付会被永久锁死、无法退回】。\n你的押注未成立。请勿再向此地址付款 (重复付款同样无法挽回)。',
    poll_linkedaddr_error: '⚠ 押注单异常 (后端: {error})。\n请先 /link <kaspatest 地址> 重新绑定, 再 /bet 重走流程。\n(此前显示的付款地址若已付, 押注无法挽回 — 别再付了。)',
    poll_no_linkedaddr: '⚠ 这笔押注单异常: 缺绑定地址 (bot 旧版会话丢失). 押注未成立, 也不会自动确认。请先 /link <kaspatest 地址>, 再 /bet 重新走完整流程。\n(若已付款到上次显示的地址, 押注无法挽回 — 别再付了。)',

    // pollSettleResults messages
    poll_win: '🎉 [{question}]\n你赢了! 押 {side} {stake} KAS → 应到账 {payout} KAS (settle TX: {tx}...)\n钱已发到你的绑定地址 — 钱包查看到账.',
    poll_lose: '😞 [{question}]\n你输了。\n开奖: {outcome} (你押的是 {side}) · 押 {stake} KAS\nsettle TX: {tx}...',
    poll_neutral: '📊 [{question}] 已结算\n你的押注: {side} · {stake} KAS · settle TX {tx}...\n等待最终开奖标注 (下次会推确切赢/输).',
    poll_refund: '💸 [{question}] 已退款\n市场取消/分歧, 退款 TX: {tx}...\n你的押注退回到绑定地址.',

    // /mybets
    mybets_no_link: '⚠ 还没绑定地址。先 /link <kaspatest 地址> 再看押注。',
    mybets_fail: '查询失败: {error}',
    mybets_empty: '你还没有押注记录。/bet 开始押。',
    mybets_header: '📋 你的押注 ({n} 笔, {m} 个市场)',
    mybets_total_in: '💰 投入总: {kas} KAS',
    mybets_total_back: '🔁 返回总: {kas} KAS (赢实拿 {won} + 退款 {refunded})',
    mybets_total_active: '📍 在押总: {kas} KAS (还在系统里的钱)',
    mybets_net: '📊 净 {sign}{kas} KAS',
    mybets_detail_prefix: '明细: {detail}',
    mybets_detail_open: '押注中 {n} 笔 ({kas} KAS)',
    mybets_detail_awaiting: '等开奖 {n} 笔 ({kas} KAS)',
    mybets_detail_settled_pending: '待入账 {n} 笔 ({kas} KAS)',
    mybets_detail_lost: '已输 {kas} KAS',
    mybets_status_win: '🎉 赢 +{kas} KAS',
    mybets_status_lose: '😞 输 -{kas} KAS',
    mybets_status_refunded: '💸 已退款',
    mybets_status_settled_chain: '⚖ 已结算 · 待入账 (链上 settle TX 已上)',
    mybets_status_deadline_vote: '⏳ 已截止 · 等委员投票出结果',
    mybets_status_active: '📍 已押注 · 截止后开奖',
    mybets_status_mixed: '📊 混合 (赢 {won} · 输 {lost} · 等 {open} · 退 {refunded} · 待入账 {pending})',
    mybets_if_win: '  若赢可拿 {kas} KAS',
    mybets_dir_cnt: ' ({n} 笔)',
    mybets_placed_at: '  押注于 {time}',
    mybets_deadline: '  截止 {deadline} · 开奖后自动结算到账绑定地址',
    mybets_addmore: '➕ 加注/反手: {title}',

    // /record (战绩卡)
    record_empty: '还没有押注记录。/bet 开始押注。',
    record_title: '🏆 你的战绩',
    record_bets_markets: '{n} 笔押注 · {m} 个市场',
    record_winrate: '胜率: {pct}% ({won}胜{lost}负)',
    record_winrate_none: '胜率: 暂无已结算押注',
    record_net: '净盈亏 {sign}{kas} KAS',
    record_open: '📍 {n} 笔押注中',
    record_refunded: '💸 {n} 笔已退款',
    record_footer: 'ℹ 仅测试网 KAS · 非真钱 · 非投资建议。',
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
