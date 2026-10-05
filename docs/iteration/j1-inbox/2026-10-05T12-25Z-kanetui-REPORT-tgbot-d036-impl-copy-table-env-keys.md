# KANet-UI → Bettor: D-036 电报口子主网预测市场接线 — 实现状态 + 文案表(待 Owner 批)+ Owner env 键清单

> **Status**: CURRENT (实现完成并过单测; **未部署**; simnet e2e 待跑; 文案全部是草稿, Owner 批之前一律不算定稿)。2026-10-05, KANet-UI。
> 分支 `coord/kanetui-tgbot-mainnet-pm-20261005`(基于 f9f3de1d)。上游依据: 同日缺口图 `2026-10-05T12-15Z-kanetui-REPORT-tgbot-pm-gap-map-mainnet-no-kas.md`。

## 1. 做了什么(对应派工 1–5)

| 派工 | 实现 | 位置 |
|---|---|---|
| 1 列表 | `/bet` `/hot` 拉 `GET /api/pool/markets?status=pending_bettors`, 只留 v0.7 + `zk_native` + 截止未到(留 5 分钟); 金额全是筹码; 主网不再用 proto-markets | `tg-bot/mainnet-pm.mjs` `visiblePoolMarkets`, `mainnet-pm-handlers.mjs` |
| 2 下注 | 详情页 YES/NO 按钮 → 回复整数筹码(≥1, 小数/0/文字拒) → 一步 `POST …/bettor/register-v07` 体 `{linked_addr, direction, stake_ktt}`, `stake_ktt = 筹码×1e8`(BigInt 整数字符串); 未 `/link` 先引导 `/link`; 无任何 prep/confirm/付款/自动付款/pending 路径 | `console-api.mjs` `poolRegisterV07Gateway` |
| 3 每日上限 | bot 侧每个 Telegram 用户每 UTC 日 `TG_BET_MAX_PER_USER_DAY`(默认 5), 只在服务端确认成功后计数, 落盘 `_bet_cap.json`(抗重启); 满了回"明天再来"; 服务端 429(`bet_cap_pk_day` / `bet_cap_global_day`, 带 `resets_at`)同一礼貌文案并显示重置时间, 不计入 bot 侧次数 | `createCapTracker`, `mapRegisterFailure` |
| 4 我的押注 | `/mybets` `/record`: `GET /api/pool/my-positions?linked_addr=`, 按 `logical_market_id` 分组, 筹码口径, 状态 已到账 / 待领 / 金额待定 / 输 / 等开奖 / 押注中 / 已取消(与控制台页面同口径, 同一套判定) | `positionKind`, `formatMyPositions` |
| 5 开奖通知 | `pollSettleResultsMainnet`: `did_win` 变非空通知一次、到账落链(`actual_payout_kas` 非空)再通知一次, 按 `logical_market_id` 去重(键 `<id>:result` / `<id>:paid`); **首轮只播种**(新绑定用户的历史盘不会被一次性轰炸) | `bot.mjs`, `pickNotifications` |

- 公钥推导: bot 不碰密钥也不自己推导, 送 `linked_addr`, 服务端(J2 在 `coord/j2-bet-cost-gate-20261005` 的 register-v07 里)用 my-positions 同一个 `deriveXOnlyPubkey`, 每日上限按推出的 pk 计(Bettor 已确认)。**所以本分支的下注要等 J2 那笔合并后才能真跑通。**
- 接线顺序: `registerMainnetPm` 在 `registerReadonlyShell` **之前**注册(grammY 先注册者先处理), 无押注会话的文本 `next()` 交还只读壳; TN12/非主网路径一个字节没动(`isReadonlyShell` 门控)。
- 测试: 新增 `tg-bot/mainnet-pm.test.mjs` 17 条(纯逻辑 + 假 bot 接线, 假 api 对任何 prep/confirm/proto 调用直接报错); 既有 `readonly-handlers` 17/17、`readonly-shell` 24/24、`readonly-i18n` 6/6(其中第 5 条原来禁一切 "KAS" 字样, 我改成"只许否定句里出现 KAS", 与控制台页面口径一致, 请 Bettor 审这一处改动)、`prediction-menu-prune` 5/5。lint 0 错。
- `test/l2*.test.mjs` 等老集成测试在本机本来就跑不全(基线 2/5, 缺 DB 目录/真 console), 我没动它们, 也没有因我的改动变坏的证据; 它们不覆盖主网分支。
- **未做/待做**: ① simnet e2e(列表→2 人下注→触顶→收盘→通知→my-positions), 要 J2 起 harness 且 J2 的 register-v07 `linked_addr` + 429 先到位; ② 开奖通知"对真实 simnet 持仓验证"(派工 5 要求)同样等 e2e; ③ `/start <深链>` 对 pool id(非十六进制)不生效(只读壳的深链只认 8–64 位十六进制); 控制台页面上的 TG 框已隐藏, 暂不需要, 若要深链需另改一笔。

## 2. 主网机器人仍然可见、但不在本次范围的旧命令(请 Bettor/Owner 定: 隐藏还是单独批文案)

`/broker` `/earnings`(运营者功能)、`/support`(反馈)、`/verify`、`/lang`、`/discover`(已改文案)、`/champions`(只读壳已回"专题已结束")。其中 `/broker /earnings /support /verify` 走旧 handler 的旧文案(可能含 KAS/testnet 字样), **本表不含, 也没人审过**。

## 3. 文案表(主网机器人用户可见的全部新文案; 中英; 全部待 Owner 批)

首次接触(`ro_start_notice`)必须说清"零价值测试筹码"——已写在第一条, 且写明"不是真钱、不需要 KAS"。`{…}` 是变量。

| key | 中文 | English |
|---|---|---|
| `start_lang_btn_zh` |  | 🌐 中文 |
| `hot_fail` | 热门市场加载失败, 稍后再试。 | Failed to load markets, try again later. |
| `service_busy` | ⏳ 系统繁忙，请稍后再试。 | Service busy, please retry in a moment. |
| `link_fail` | 绑定失败: {error} | Link failed: {error} |
| `ro_start_notice` | ℹ️ KANet 电报机器人（主网）<br>· 这里押注用的是免费的零价值测试筹码——不是真钱，也不需要 KAS<br>· 先绑定你的主网地址：/link <你的主网地址（kaspa: 开头）><br>· 然后 /bet 选市场押注；/mybets 看你的押注 | ℹ️ KANet on Telegram (mainnet)<br>· You bet with free, zero-value test chips — not real money, and no KAS is needed<br>· Link your mainnet address first: /link <your mainnet address (starts with kaspa:)><br>· Then /bet to pick a market and place a bet; /mybets shows your bets |
| `ro_start_commands` | /bet 看市场 · /hot 热门 · /link 绑定地址 · /mybets 我的押注 · /help | /bet Markets · /hot Top markets · /link Link address · /mybets My bets · /help |
| `ro_help` | KANet 主网机器人<br>/start 开始 · /link 绑定主网地址 · /bet 看市场并押注 · /hot 热门市场<br>/mybets、/record 我的押注 · /lang 切换语言 · /support 反馈<br><br>押注用零价值测试筹码（不需要 KAS）；本机器人不托管资金、不持有你的私钥。<br>每天有押注次数上限。<br>开源 · 非投资建议 | KANet mainnet bot<br>/start Start · /link Link mainnet address · /bet Markets & betting · /hot Top markets<br>/mybets, /record Your bets · /lang Language · /support Feedback<br><br>Bets use zero-value test chips (no KAS needed); this bot holds no funds and no private keys.<br>A daily limit on bets applies.<br>Open source · not investment advice |
| `ro_link_usage` | 用法：/link <你的主网地址（kaspa: 开头）> | Usage: /link <your mainnet address (starts with kaspa:)> |
| `ro_link_wrong_network` | 这是测试网地址（kaspatest:）。请提供主网地址（kaspa: 开头）。 | That's a testnet address (kaspatest:). Please send a mainnet address (starts with kaspa:). |
| `ro_link_invalid` | 这个地址无效（校验失败）。请检查后重新发送主网地址（kaspa: 开头）。 | That address isn't valid (checksum failed). Please check it and send a mainnet address (starts with kaspa:). |
| `ro_link_ok` | ✅ 已绑定：{addr}。现在可以用 /bet 押注了。 | ✅ Linked: {addr}. You can now bet with /bet. |
| `ro_list_empty` | 现在没有进行中的市场，稍后再来。 | No open markets right now, check back later. |
| `ro_when_hours` | 还剩 {h} 小时 | {h}h left |
| `ro_when_minutes` | 还剩 {m} 分钟 | {m} min left |
| `ro_when_expired` | 已过截止 | Deadline passed |
| `ro_detail_title` | 📌 {q} | 📌 {q} |
| `ro_detail_deadline` | 截止：{when} | Deadline: {when} |
| `ro_detail_not_found` | 没找到这个市场（可能已下架）。用 /bet 看当前市场。 | Market not found (it may have been removed). See current markets with /bet. |
| `ro_discover` | 浏览：<br>· /bet — 看市场并押注<br>· /hot — 热门市场<br>· /mybets — 我的押注<br>· /link — 绑定主网地址<br>· /help — 全部命令 | Browse:<br>· /bet — Markets & betting<br>· /hot — Top markets<br>· /mybets — Your bets<br>· /link — Link a mainnet address<br>· /help — All commands |
| `ro_champions_ended` | ℹ️ 该专题已结束。看当前市场请用 /bet。 | ℹ️ This topic has ended. See current markets with /bet. |
| `ro_unavailable` | ℹ️ 该功能在主网期暂不开放。 | ℹ️ This feature isn't available on mainnet for now. |
| `pm_list_title` | 📊 可以押注的市场 — 点下方按钮看详情： | 📊 Markets open for bets — tap one for details: |
| `pm_hot_title` | 🔥 可押市场 Top {n} — 点下方按钮看详情： | 🔥 Markets to bet on (Top {n}) — tap one for details: |
| `pm_line_open` | {q} · 押注中 · {when} | {q} · Open · {when} |
| `pm_list_footer` | 押注用的是零价值测试筹码，不是真钱，也不花 KAS。 | Stakes are zero-value test chips, not real money, and cost no KAS. |
| `pm_detail_status` | 状态：押注中 | Status: Open for bets |
| `pm_detail_pool` | 当前池：YES {yes} 筹码 · NO {no} 筹码 | Pool: YES {yes} chips · NO {no} chips |
| `pm_detail_min` | 最少押 1 筹码（零价值测试筹码，不需要 KAS） | Minimum stake: 1 chip (a zero-value test chip — no KAS needed) |
| `pm_need_link` | 要押注，请先绑定你的主网地址：/link kaspa:… ——你的筹码会记在这个地址下。 | To bet, first link your mainnet address: /link kaspa:… — your chips are recorded under that address. |
| `pm_btn_yes` | YES | YES |
| `pm_btn_no` | NO | NO |
| `pm_side_yes` | YES | YES |
| `pm_side_no` | NO | NO |
| `pm_amount_prompt` | 📌 {q}<br>你选了 {side}。请回复要押多少筹码（整数，至少 1）。筹码是零价值测试代币，不花 KAS。 | 📌 {q}<br>You picked {side}. Reply with how many chips to stake (a whole number, at least 1). Chips are zero-value test tokens; this costs no KAS. |
| `pm_chips_format` | 请回复一个整数，比如 5。 | Please reply with a whole number, for example 5. |
| `pm_chips_min` | 最少押 1 筹码。 | The minimum stake is 1 chip. |
| `pm_chips_max` | 这个数太大了。 | That number is too large. |
| `pm_busy` | 正在提交你的押注，请稍等… | Your bet is being submitted, one moment… |
| `pm_bet_ok` | ✅ 押注成功：{q}<br>{side} · {chips} 筹码。开奖后会通知你。/mybets 可以看你所有的押注。 | ✅ Bet placed: {q}<br>{side} · {chips} chips. We will message you when the market is decided. /mybets shows all your bets. |
| `pm_cap_bot` | 今天的押注次数已达上限（{max} 次），明天再来吧（{resets} 重置）🙂 | You've reached today's limit of {max} bets. Come back tomorrow (resets at {resets}) 🙂 |
| `pm_cap_server` | 今天的押注名额已满，明天再来吧（{resets} 重置）。这次没有花任何东西。 | Today's betting limit has been reached. Please come back tomorrow (resets at {resets}). Nothing was spent. |
| `pm_closed` | 这个市场已经不收押注了。 | This market is no longer taking bets. |
| `pm_denied` | 这个地址不能押这个市场。 | This address can't bet on this market. |
| `pm_bad_request` | 这笔押注没能受理，请检查数额后再试。 | That bet couldn't be accepted. Please check the amount and try again. |
| `pm_bet_fail` | 这笔押注没成功（没有花任何东西），请稍后再试。 | The bet didn't go through (nothing was spent). Please try again later. |
| `pm_mybets_title` | 📒 你的押注（共 {n} 个市场） | 📒 Your bets ({n} markets) |
| `pm_mybets_empty` | 你还没有押注。用 /bet 选一个市场吧。 | You have no bets yet. Use /bet to pick a market. |
| `pm_mybets_more` | ……还有 {n} 个市场 | …and {n} more markets |
| `pm_pos_open` | {side} · {stake} 筹码 · 押注中 | {side} · {stake} chips · open for bets |
| `pm_pos_awaiting` | {side} · {stake} 筹码 · 等开奖 | {side} · {stake} chips · waiting for the result |
| `pm_pos_lose` | {side} · {stake} 筹码 · 输 | {side} · {stake} chips · lost |
| `pm_pos_win_paid` | {side} · {stake} 筹码 · 赢 · 已到账 {payout} 筹码 ✅ | {side} · {stake} chips · won · {payout} chips paid ✅ |
| `pm_pos_win_pending` | {side} · {stake} 筹码 · 赢 · 待领 {pending} 筹码 | {side} · {stake} chips · won · {pending} chips waiting to be paid |
| `pm_pos_win_pending_generic` | {side} · {stake} 筹码 · 赢 · 发放中 | {side} · {stake} chips · won · payout in progress |
| `pm_pos_win_unknown` | {side} · {stake} 筹码 · 赢 · 金额确认中 | {side} · {stake} chips · won · amount being confirmed |
| `pm_pos_cancelled` | {side} · {stake} 筹码 · 已取消 | {side} · {stake} chips · cancelled |
| `pm_notify_win` | 🎉 已开奖：{q}<br>你押的 {side} 赢了！筹码正在发到你绑定的地址。 | 🎉 Decided: {q}<br>Your {side} bet won! Your chips are being paid out to your linked address. |
| `pm_notify_lose` | 已开奖：{q}<br>你押的 {side} 这次没赢。 | Decided: {q}<br>Your {side} bet did not win this time. |
| `pm_notify_paid` | ✅ 已到账：{q}<br>{payout} 筹码已发到你绑定的地址。 | ✅ Paid out: {q}<br>{payout} chips have arrived at your linked address. |

### 已被取代、主网不再显示的旧只读壳文案(无需批, 仅留档)

| key | 中文(旧) | English(旧) |
|---|---|---|
| `ro_list_title` | 📊 主网市场（只读）— 点下方按钮看详情： | 📊 Mainnet markets (read-only) — tap a button below for details: |
| `ro_hot_title` | 🔥 热门市场 Top {n}（只读）— 点下方按钮看详情： | 🔥 Trending markets Top {n} (read-only) — tap a button below for details: |
| `ro_list_footer` | （暂不能在电报里下注） | (Betting from Telegram isn't available yet) |
| `ro_line_open` | {q} · 进行中 · {when} | {q} · Open · {when} |
| `ro_line_sealed` | {q} · 已封盘 · 等待结果 | {q} · Sealed · Awaiting result |
| `ro_line_settled` | {q} · 已结算 · 结果 {result} | {q} · Settled · Result {result} |
| `ro_line_settled_noresult` | {q} · 已结算 | {q} · Settled |
| `ro_state_open` | 状态：进行中 | Status: Open |
| `ro_state_sealed` | 状态：已封盘 · 等待结果 | Status: Sealed · awaiting result |
| `ro_state_settled` | 状态：已结算 · 结果 {result} | Status: Settled · Result {result} |
| `ro_state_settled_noresult` | 状态：已结算 | Status: Settled |
| `ro_state_cancelled` | 状态：已取消 | Status: Cancelled |
| `ro_detail_min_bet` | 最小下注：{n} {ticker}（零价值测试代币） | Min stake: {n} {ticker} (zero-value test token) |
| `ro_detail_no_bet` | 🔒 电报里暂不能下注。想参与请联系运营者。 | 🔒 Betting from Telegram isn't available yet. Contact the operator to take part. |
| `ro_mybets_unavailable` | ℹ️ 暂不可用：主网市场目前不区分"是谁下的注"，所以无法按你的地址列出下注或战绩。等这项能力上线后会开放。 | ℹ️ Not available yet: mainnet markets don't record who placed a bet, so bets and records can't be listed per address. This will open once that capability ships. |

## 4. Owner env 清单(只列键名与非密值; token 取自既有身份, D-023)

bot 进程环境(`kanet.mainnet.env` 里目前没有任何 `TELEGRAM_*` / `BROKER_RELAY_ID`; 以下为我从代码读出的, 启动方式(Settings 页写 `tg_bot_enabled` 还是 `_launch_tg_bot.mjs`)我没有实跑验证):

| 键 | 值 | 说明 |
|---|---|---|
| `KASPA_NETWORK` | `mainnet` | **必须**。缺省是 testnet-12, 会跑旧测试网行为 |
| `CONSOLE_URL` | `http://127.0.0.1:3202` | **必须**。默认 `:3200` 已退役 |
| `TELEGRAM_BOT_TOKEN` | (密, 既有 @KANET_Broker_bot 身份) | **必须**, 只给键名 |
| `TELEGRAM_BOT_USERNAME` | `KANET_Broker_bot` | 必须 |
| `INGEST_SECRET` | (密, 须与 console 一致) | **必须**, 只给键名 |
| `TG_BET_MAX_PER_USER_DAY` | `5` | 可选(默认 5): 每个 Telegram 用户每 UTC 日押注次数 |
| `TG_BOT_BET_CAP_FILE` | (默认 `tg-bot/_bet_cap.json`) | 可选; 该文件名已被 `_*` gitignore |
| `TG_SETTLE_POLL_MS` | `300000` | 可选(默认 5 分钟): 开奖通知轮询间隔 |
| `BROKER_RELAY_ID` | 可留空 | 本接线不需要 broker(下注走网关, 列表不按 broker 过滤) |

console 侧(J2 分支): `ZK_BET_MAX_PER_PK_DAY`(默认 5)、全局日上限的键名我没拿到(J2 说默认 50), 请 J2/Bettor 补进脚本。**绝不能出现在主网 env: `KANET_TESTNET_NO_LIMITS`**(D-023 §5)。

## 5. 风险 / 未知
- 无所有权证明(Owner 规则, 零价值筹码): 任何人 `/link` 别人的地址就能替那个地址押注、并看到该地址的押注。已按 Owner 规则接受, 记在这里。
- 开奖通知的 `did_win`/到账字段只在 ZK 原生盘上由 J2 的新分支写; 对真实持仓的验证要等 e2e。
- 播种逻辑(首轮不通知)的代价: 用户在**首轮轮询之前**就已开奖的盘不会通知(窗口 ≤ 5 分钟, 盘期数小时, 可接受)。
- 回调数据 ≤64 字节: id 超长的盘不会进列表(`cbData` 返回 null 被过滤), 当前 `ext-pool-v07-<ms>-<5位>` 约 31 字符, 余量充足。
- 老集成测试环境问题见 §1。
