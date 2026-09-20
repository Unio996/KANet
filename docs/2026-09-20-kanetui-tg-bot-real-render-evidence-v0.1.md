# 电报只读壳 — 真实渲染对比证据 v0.1（中英）

> **Status**: CURRENT（证据页，非设计）。用【真 i18n + 真 readonly-shell/handlers 代码 + 主网 console 真实 `GET /api/proto-markets` 数据】渲染；假的只有 Telegram ctx（收集回复）与 `linkBind`（不真绑定）。代码 = 分支 `coord/kanetui-tgbot-p1-cr3` 头 `61d5f588`。对照样图页 `docs/2026-09-20-kanetui-tg-bot-user-copy-samples-v0.1.md`（Owner 已批）。D-021：无真实地址（`/link` 例子是占位）、无余额。

```text
live markets: 3; statuses: resolved,cancelled,cancelled

=== [zh] /start ===
ℹ️ KANet 电报机器人已迁到主网（只读版）
· 这里的市场用的是零价值测试代币，不是真钱
· 和之前测试网不同：暂时不能在电报里自助下注——可以查看市场与结果、绑定你的主网地址
· 旧的绑定与会话已重置，请重新绑定：/link <你的主网地址>
· 想参与下注请联系运营者

/bet 看市场 · /hot 热门 · /link 绑定地址 · /help
   [buttons] «🌐 English»→lang:toggle

=== [zh] /help ===
KANet 主网机器人（只读）
/start 开始 · /link 绑定主网地址 · /bet 看市场 · /hot 热门市场
/mybets、/record：暂不可用（见说明）· /broker /earnings：运营者功能 · /lang 切换语言 · /support 反馈

押注资产为零价值测试代币；本机器人不托管资金、不持有你的私钥。
开源 · 非投资建议

=== [zh] /link kaspa:qq… (主网地址) ===
✅ 已绑定：kaspa:qqexampleexampleexampleexampleexampleexample00000000000000。注意：目前电报里不能自助下注，绑定后可用于查看信息。

=== [zh] /link kaspatest:qq… (测试网地址) ===
这是测试网地址（kaspatest:）。请提供主网地址（kaspa: 开头）。

=== [zh] /link 乱写 ===
用法：/link <你的主网地址（kaspa: 开头）>

=== [zh] /bet ===
📊 主网市场（只读）— 点下方按钮看详情：

1. Canary: prototype v0 first mainnet market (retry-3) · 已结算 · 结果 NO

（暂不能在电报里下注）
   [buttons] «1. Canary: prototype v0 first …»→ro:m:a59c7b483caafdda

=== [zh] /hot ===
🔥 热门市场 Top 1（只读）— 点下方按钮看详情：

1. Canary: prototype v0 first mainnet market (retry-3) · 已结算 · 结果 NO

（暂不能在电报里下注）
   [buttons] «1. Canary: prototype v0 first …»→ro:m:a59c7b483caafdda

=== [zh] 点详情按钮 ro:m:<已结算市场> ===
📌 Canary: prototype v0 first mainnet market (retry-3)
状态：已结算 · 结果 NO
最小下注：1 KTT（零价值测试代币）
🔒 电报里暂不能下注。想参与请联系运营者。

=== [zh] 直接打开已取消市场链接(深链) ro:m:<已取消市场> ===
📌 Canary: prototype v0 first mainnet market
状态：已取消
最小下注：1 KTT（零价值测试代币）
🔒 电报里暂不能下注。想参与请联系运营者。

=== [zh] /mybets ===
ℹ️ 暂不可用：主网市场目前不区分"是谁下的注"，所以无法按你的地址列出下注或战绩。等这项能力上线后会开放。

=== [zh] /record ===
ℹ️ 暂不可用：主网市场目前不区分"是谁下的注"，所以无法按你的地址列出下注或战绩。等这项能力上线后会开放。

=== [zh] /discover ===
浏览：
· /bet — 查看主网市场（只读）
· /hot — 热门市场 Top5
· /link — 绑定主网地址
· /help — 全部命令

=== [zh] /champions ===
ℹ️ 该专题已结束。看当前市场请用 /bet。

=== [zh] /wallet (隐藏) ===
ℹ️ 该功能在主网期暂不开放。

=== [zh] /faucet (隐藏) ===
ℹ️ 该功能在主网期暂不开放。

=== [zh] /broker_apply (隐藏) ===
ℹ️ 该功能在主网期暂不开放。

=== [en] /start ===
ℹ️ The KANet Telegram bot has moved to mainnet (read-only)
· Markets here use zero-value test tokens, not real money
· Unlike the old testnet: you can't place bets from Telegram for now — you can view markets & results and link your mainnet address
· Your old link and sessions were reset — please link again: /link <your mainnet address>
· To take part in betting, contact the operator

/bet Markets · /hot Trending · /link Link address · /help
   [buttons] «🌐 中文»→lang:toggle

=== [en] /help ===
KANet mainnet bot (read-only)
/start Start · /link Link mainnet address · /bet Markets · /hot Trending
/mybets, /record: unavailable for now (see notes) · /broker /earnings: operator features · /lang Language · /support Feedback

Stake assets are zero-value test tokens; this bot holds no funds and no private keys.
Open source · not investment advice

=== [en] /link kaspa:qq… (主网地址) ===
✅ Linked: kaspa:qqexampleexampleexampleexampleexampleexample00000000000000. Note: betting from Telegram isn't available yet; linking lets you view info.

=== [en] /link kaspatest:qq… (测试网地址) ===
That's a testnet address (kaspatest:). Please send a mainnet address (starts with kaspa:).

=== [en] /link 乱写 ===
Usage: /link <your mainnet address (starts with kaspa:)>

=== [en] /bet ===
📊 Mainnet markets (read-only) — tap a button below for details:

1. Canary: prototype v0 first mainnet market (retry-3) · Settled · Result NO

(Betting from Telegram isn't available yet)
   [buttons] «1. Canary: prototype v0 first …»→ro:m:a59c7b483caafdda

=== [en] /hot ===
🔥 Trending markets Top 1 (read-only) — tap a button below for details:

1. Canary: prototype v0 first mainnet market (retry-3) · Settled · Result NO

(Betting from Telegram isn't available yet)
   [buttons] «1. Canary: prototype v0 first …»→ro:m:a59c7b483caafdda

=== [en] 点详情按钮 ro:m:<已结算市场> ===
📌 Canary: prototype v0 first mainnet market (retry-3)
Status: Settled · Result NO
Min stake: 1 KTT (zero-value test token)
🔒 Betting from Telegram isn't available yet. Contact the operator to take part.

=== [en] 直接打开已取消市场链接(深链) ro:m:<已取消市场> ===
📌 Canary: prototype v0 first mainnet market
Status: Cancelled
Min stake: 1 KTT (zero-value test token)
🔒 Betting from Telegram isn't available yet. Contact the operator to take part.

=== [en] /mybets ===
ℹ️ Not available yet: mainnet markets don't record who placed a bet, so bets and records can't be listed per address. This will open once that capability ships.

=== [en] /record ===
ℹ️ Not available yet: mainnet markets don't record who placed a bet, so bets and records can't be listed per address. This will open once that capability ships.

=== [en] /discover ===
Browse:
· /bet — View mainnet markets (read-only)
· /hot — Top 5 trending markets
· /link — Link a mainnet address
· /help — All commands

=== [en] /champions ===
ℹ️ This topic has ended. See current markets with /bet.

=== [en] /wallet (隐藏) ===
ℹ️ This feature isn't available on mainnet for now.

=== [en] /faucet (隐藏) ===
ℹ️ This feature isn't available on mainnet for now.

=== [en] /broker_apply (隐藏) ===
ℹ️ This feature isn't available on mainnet for now.
```
