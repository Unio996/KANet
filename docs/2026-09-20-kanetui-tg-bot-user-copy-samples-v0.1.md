# 电报口子接主网 — 用户可见文案样图 v0.1（中英）

> **Status**: CURRENT（草稿：**样图，未落码**；交 Bettor 转 Owner 过目，Owner 定稿后才写进 `i18n.mjs` / `messages.mjs` / `bot.mjs`，铁律 0：用户面）
>
> 依据：Owner 单四点已批（`docs/2026-09-20-kanetui-tg-bot-owner-approval-sheet-v0.1.md`）；字段来源见变更说明 §3.2（`docs/2026-09-20-kanetui-tg-bot-mainnet-relaunch-and-proto-v0-repoint-change-note-v0.1.md`）；runbook §6 的 5 条待定文案已并入本页。D-021：样图里的地址/数字都是占位。
>
> 口径：这个电报口子 = **只读壳**（看市场与结果、绑定主网地址；不能自助下注）。押注资产是**零价值测试代币**，不是真钱。样图里 `⟨…⟩` 是运行时填入的值。

## 1. `/start` 开头（Owner 已定：免责/首次说明放这里）

**中文**
```
ℹ️ KANet 电报机器人已迁到主网（只读版）
· 这里的市场用的是零价值测试代币，不是真钱
· 和之前测试网不同：暂时不能在电报里自助下注——可以查看市场与结果、绑定你的主网地址
· 旧的绑定与会话已重置，请重新绑定：/link <你的主网地址>
· 想参与下注请联系运营者

/bet 看市场 · /hot 热门 · /link 绑定地址 · /help
```
**English**
```
ℹ️ The KANet Telegram bot has moved to mainnet (read-only)
· Markets here use zero-value test tokens, not real money
· Unlike the old testnet: you can't place bets from Telegram for now — you can view markets & results and link your mainnet address
· Your old link and sessions were reset — please link again: /link <your mainnet address>
· To take part in betting, contact the operator

/bet Markets · /hot Trending · /link Link address · /help
```
（已绑定用户的 `/start` 同样在开头带这段；"我的下注 / 领水 / 钱包"按钮撤掉，见 §7。）

## 2. `/help`

**中文**
```
KANet 主网机器人（只读）
/start 开始 · /link 绑定主网地址 · /bet 看市场 · /hot 热门市场
/mybets、/record：暂不可用（见说明）· /broker /earnings：运营者功能 · /lang 切换语言 · /support 反馈

押注资产为零价值测试代币；本机器人不托管资金、不持有你的私钥。
开源 · 非投资建议
```
**English**
```
KANet mainnet bot (read-only)
/start Start · /link Link mainnet address · /bet Markets · /hot Trending
/mybets, /record: unavailable for now (see notes) · /broker /earnings: operator features · /lang Language · /support Feedback

Stake assets are zero-value test tokens; this bot holds no funds and no private keys.
Open source · not investment advice
```
（`help_disclaimer` 现写 "testnet-only · 不运营主网"，改为上面最后一行；`help_custody_*` 三条托管说明整块删——主网期没有托管钱包。）

## 3. `/link`

| 场景 | 中文 | English |
|---|---|---|
| 用法 / 格式不对 | `用法：/link <你的主网地址（kaspa: 开头）>` | `Usage: /link <your mainnet address (starts with kaspa:)>` |
| 给了测试网地址 | `这是测试网地址（kaspatest:）。请提供主网地址（kaspa: 开头）。` | `That's a testnet address (kaspatest:). Please send a mainnet address (starts with kaspa:).` |
| 成功 | `✅ 已绑定：⟨地址⟩。注意：目前电报里不能自助下注，绑定后可用于查看信息。` | `✅ Linked: ⟨address⟩. Note: betting from Telegram isn't available yet; linking lets you view info.` |

## 4. `/bet` 与 `/hot`（读侧：主网真实市场）

**`/bet` 列表（中文）**
```
📊 主网市场（只读）— 回复编号看详情：
1. ⟨问题，截断到 56 字⟩ · 进行中 · 还剩 ⟨N⟩ 小时
2. ⟨问题⟩ · 已结算 · 结果 YES
3. ⟨问题⟩ · 已封盘 · 等待结果

（暂不能在电报里下注）
```
**`/bet` list (English)**
```
📊 Mainnet markets (read-only) — reply with a number for details:
1. ⟨question, cut to 56 chars⟩ · Open · ⟨N⟩h left
2. ⟨question⟩ · Settled · Result YES
3. ⟨question⟩ · Sealed · Awaiting result

(Betting from Telegram isn't available yet)
```
**详情（中文）**
```
📌 ⟨问题⟩
状态：进行中（另有：已封盘·等结果 / 已结算·结果 YES 或 NO / 已取消）
截止：还剩 ⟨N⟩ 小时
最小下注：⟨n⟩ ⟨代币简称⟩（零价值测试代币）
🔒 电报里暂不能下注。想参与请联系运营者。
```
**Detail (English)**
```
📌 ⟨question⟩
Status: Open (others: Sealed · awaiting result / Settled · result YES or NO / Cancelled)
Deadline: ⟨N⟩h left
Min stake: ⟨n⟩ ⟨token ticker⟩ (zero-value test token)
🔒 Betting from Telegram isn't available yet. Contact the operator to take part.
```
- `/hot`：同上列表，最多 5 条（进行中的优先）。无市场时：`现在没有进行中的市场，稍后再来。` / `No open markets right now, check back later.`
- 已取消的老市场默认**不进列表**（只有在有人直接打开其链接时才显示"已取消"）。加载失败沿用现有 `service_busy` / `hot_fail` 文案。

## 5. `/mybets`、`/record`（没有数据可读）

**中文**：`ℹ️ 暂不可用：主网市场目前不区分"是谁下的注"，所以无法按你的地址列出下注或战绩。等这项能力上线后会开放。`
**English**: `ℹ️ Not available yet: mainnet markets don't record who placed a bet, so bets and records can't be listed per address. This will open once that capability ships.`

## 6. `/discover`、`/champions`

**`/discover`（中文）**
```
浏览：
· /bet — 查看主网市场（只读）
· /hot — 热门市场 Top5
· /link — 绑定主网地址
· /help — 全部命令
```
**`/discover` (English)**
```
Browse:
· /bet — View mainnet markets (read-only)
· /hot — Top 5 trending markets
· /link — Link a mainnet address
· /help — All commands
```
`/champions`（世界杯冠军盘）：从 `/help`、菜单撤下；仍被输入时回 `ℹ️ 该专题已结束。看当前市场请用 /bet。` / `ℹ️ This topic has ended. See current markets with /bet.`

## 7. 隐藏的入口（Owner 已批：藏 `/wallet` `/send` `/faucet`）

- 从 `/start` 按钮、`/help`、`/discover` 里**去掉**：`/wallet` `/balance` `/receive` `/send` `/confirm` `/faucet` `/swap`（`/swap` 文案现写"仅主网可用/测试网预览"，主网期无兑换，一并去掉）。
- 仍被手打时统一回：`ℹ️ 该功能在主网期暂不开放。` / `ℹ️ This feature isn't available on mainnet for now.`（服务端托管钱包路由另有网络守卫，返回 503，不产生任何钱包或转账。）
- `/broker_apply`（用户提交自己的 bot token）：**建议同样隐藏**——它属"外部 broker 入驻"，不是只读壳的一部分；手打回 `ℹ️ 暂不开放。`（Owner 请定：隐藏 / 保留。）`/broker` `/earnings` 保留文案，去掉其中"测试网"字样。

## 8. 其余带 "testnet / 测试网" 字样的键（runbook §6 第 3 条的落点）

`start_commands` `start_linked_commands` `bet_autopay_faucet_hint` `help_faucet` `wallet_*` `link_usage` `faucet_*` `swap_testnet_note` `broker_role_warn` `earnings_testnet_note` `fee_dm_testnet_note` `record_footer` `champions_footer` 及 `messages.mjs`/`bot.mjs` 内相关字面：处置一律三选一——**删除**（对应命令已藏）、**改成主网口径**（如 `earnings_*`、`fee_dm_*`：把"测试网 KAS"改为"测试代币/主网"）、**保留**（与网络无关）。落码时我逐键给 Owner 一张"键 → 处置"清单，样图确认后一次改完，不逐条来回。

## 9. 需要 Owner 定的（本页新增，附建议）

1. 上面每一屏的措辞（尤其 §1 的开头说明）——**定稿后我才写进代码**。
2. `/broker_apply` 隐藏还是保留（建议隐藏）。
3. 已取消的老市场是否完全不展示（建议不展示）。
