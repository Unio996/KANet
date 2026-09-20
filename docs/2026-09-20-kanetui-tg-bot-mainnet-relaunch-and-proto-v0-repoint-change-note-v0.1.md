# 电报 bot 接主网：复启 + 指向 proto-v0 合并变更说明 v0.1（只写不落码）

> **Status**: CURRENT
>
> 起草 KANet-UI · 2026-09-20 · 对应 Bettor 转达的 D-031（"绝不轻易新造轮子"）与 Owner 立项（"电报口子对外交互很重要"）。**草稿，待 Bettor 审，未执行、未落码。**
>
> **这不是新设计稿。** 它只做三件事：① 把 2026-09-19 搁置的两份现成文档（`docs/2026-09-19-kanetui-mainnet-tg-bot-wiring-runbook-v0.1.md`（页首 v0.2，下称 **runbook**）与 `docs/2026-09-19-kanetui-cr1-cr2-tg-bot-mainnet-guards-change-spec-v0.1.md`（下称 **CR 页**））**对当前代码逐条重核**（各页页首都写了"复启须重核"）；② 把 runbook 当时明说"不在范围"的"bot 接 proto v0"并进同一张变更清单，做成**一次设计、一次批**；③ 列出重核中新发现、必须由 Bettor/Owner 裁的边界。runbook 的 Stage A/B、§1 前置、§2 broker 身份、§3 env/token、§4 state 清理、§7 回滚**原样沿用，本页只引 § 号、不重写。**
>
> **D-021**：本页无密钥值、地址、余额；`proto` 路由的鉴权状况只写"无鉴权、仅靠回环绑定"这一既有设计事实，不写利用细节。

## 0. 一句话

runbook + CR 页里的每个坐标（B-1 / B-2 / B-4 / B-5、manager / 启动顺序）**在当前 HEAD `f7f99044` 上全部仍然成立**（下面 §1 逐条）；两页搁置以来相关文件**零提交**。所以"复启"是把 CR-1/2/3 原样拿出来做。真正新增的只有一件：**"指向 proto-v0"这一半，proto-v0 现在的形状（单操作员、无用户身份）决定了 bot 能安全指过去的只有读侧**——这条要 Bettor/Owner 在批准前看到（§3）。

## 1. 复启重核表（每行自查命令都在 runbook 对应节里；这里只给"当时 → 现在"）

核对基线：生产检出与 `origin/bshard-m3-deploy` 同为 `f7f99044`；`git log --since=2026-09-19` 对 `tg-bot/`、`_launch_tg_bot.mjs`、`api/tg-wallet.js`、`api/link.js`、`services/tg-bot-manager.js`、`api/settings.js` **均无提交**。

| 项 | runbook/CR 页写的 | 现在（本次实核） | 结论 |
|---|---|---|---|
| B-1 启动器 | `_launch_tg_bot.mjs` 读 `../kanet.env`、`:3200`、`testnet-12`、broker-1 UUID | 同（`:8` 读 env、`:23-25` 三处写死、`:29` 日志） | **未变** → CR-1 原样 |
| B-2 托管钱包 | `tg-wallet.js:27 NETWORK='testnet-12'`；`:25` AUTH；`:57/:86/:152` 三路由；`/send` 靠 `CUSTODIAL_RELAY_ID` 未设 ⇒ 503 | 同；`/diagnose` 仍在 `:112` 不挂 AUTH | **未变** → CR-2 原样 |
| B-4 `/link` | `bot.mjs:236` 只收 `kaspatest:`；`link.js` 只校验前缀 `kaspa` | `bot.mjs:236` 同；`link.js` 行号 **24 → 23** | **未变**（行号漂 1）→ CR-3 原样 |
| B-5 | `settings.js:194` start 写 `tg_bot_enabled=1`；`:200` stop 写 0 | 同 | 未变 |
| manager/启动序 | `tg-bot-manager.js:74` fork 注入；`index.js:569 ensureIngestSecret`、`:636 startTgBotIfConfigured` | manager `:74` 同；index.js 行号 **569→571、636→638**（顺序不变：先 ingest 后拉 bot） | 未变（行号漂 2） |
| bot 默认值 | `config.mjs:8 :3200`、`:19 testnet-12` | 同 | 未变（仍由 CR-1 的 a/c 断言兜底） |
| 前置 1.2–1.7 | bot 未跑、库无 bot 配置行、托管钱包/绑定/onboarding=0、`pool_markets`=0 | `GET /api/tg-bot/status`：`running=false`、`token_configured=false`、`broker_relay_id` 空；库：`tg_bot%` 配置键 none、`tg_custodial_wallets`/`user_notification_prefs`/`broker_onboarding`/`pool_markets` 均 0；bot 进程 0 | **仍全过** |
| §4 state | `pendingPayments` 须 0 | `_state.json`：`pendingPayments`=0（`linkedAddrs`=4、`sessions`=4 仍是 TN12 时代残留，§4 仍要备份+清） | 未变 |
| §5.1 开关表 | `PROTO_DRIVER_ENABLED`/`PROTO_SETTLEMENT_DRIVER_ENABLED` **保持未设** | 🔴 **现已 =1**（另有 `PROTO_SETTLEMENT_DRIVER_INTERVAL_MS=20000`），其余（seeder/预测 agent/自动下注/挖矿归并/ZK worker=0/false、`AUTO_BET_RELAYS` 未设、`KANET_TESTNET_NO_LIMITS` 无）**未变** | **唯一被现实改掉的前提**（见 §3） |
| §5.2/§9 "bot 没有任何 proto 调用" | bot 无 `/api/proto` 请求 | 仍然：`tg-bot/*.mjs` 对 `api/proto`、`proto-markets`、`/api/tokens` 零命中；bot 的全部 console 访问都收口在 `tg-bot/console-api.mjs` 一个文件 | 未变；**收口这点让"指向"可控**（§2 P1） |
| 现有 broker 身份 | 库里仅 `Trader-A` 一行 `role=broker`，另建不复用（OQ-3） | 同 | 未变 |

## 2. 合并变更清单（一次设计、一次批；每行一个批准层级）

| # | 内容 | 改哪里 | 批准 | 何时生效 | 来源 |
|---|---|---|---|---|---|
| CR-1 | 启动器只继承环境、`CONSOLE_URL` 由 `PORT` 推导、不读 TN12 env、fail-closed 断言、`scrub` 黑名单 | `_launch_tg_bot.mjs` + 新纯函数 `src/lib/tg-bot-launch-env.mjs` + 测试 | Bettor 批 + NWT 审 | fork 时读盘，**无需重启 console** | CR 页 §1，**照抄不改** |
| CR-2 | 托管钱包三路由网络不符 ⇒ 503 | `src/api/tg-wallet.js` + 新测试 + pilot-isolation harness 一行 | Bettor 批 + NWT 审 | **需重启 console**（进程内模块）→ **并入下一次本来就要做的主网重启**（oracle 批 A/D/B 已在等 Owner 批的那次），bot 开闸必须晚于它 | CR 页 §2，**照抄不改** |
| CR-3 | `/link` 接受 `kaspa:`、拒 `kaspatest:`；`link.js` 同步按 `KASPA_NETWORK` 校验前缀 | `tg-bot/bot.mjs:236`（用户面）+ `api/link.js:23` | **Owner** | bot 侧下次拉起；`link.js` 随 console 重启 | runbook §0 B-4，**未变** |
| P1 | **读侧指向 proto-v0**：bot 的"看市场/看某市场状态与结果"改读 proto 接口 | `tg-bot/console-api.mjs` 增读函数（`GET /api/proto-markets`、`/api/proto-markets/:id`、`/api/tokens`）；`prediction-menu.mjs`/`bot.mjs` 的市场列表与详情渲染改用 proto 字段（问题、状态、截止、最小注、代币、判定题的 side_map/outcome_end）。字段逐项对照留到落码前核（**待核**，不在本页猜） | **Owner**（用户面） | bot 侧下次拉起 | 新增，但只是"把已有 `console-api.mjs` 收口点的目标换成已在跑的接口" |
| P2 | **写侧 `/bet`** | **本页不提出改法**——见 §3。它不是"换个端点"，是能力边界 | Bettor 先裁；涉及 Owner | — | — |
| 文案 | runbook §6 五条（免责、testnet 字样、隐藏 `/faucet` `/wallet` `/send`、`/broker_apply`） | `i18n.mjs`/`messages.mjs`/`bot.mjs` | **Owner** | bot 侧 | runbook §6，**未变**；P1 落地后再补一条"市场列表现在是 proto 市场"的用户可见说明 |
| 沿用 | broker 身份新建、token 走 DB 配置（路径 X）、state 备份清空、Stage A 隔离演练、Stage B 主网开闸、回滚 | — | 见 runbook §7、§2、§3.2、§4 | — | **原样** |

批准流水（一次设计一次批）：本页 → Bettor 审 → CR-1/2 走 NWT；CR-3 + P1 + 文案 三项都是用户面，**合成一份 Owner 单**，由 Bettor 单点上报；Owner 批后才有任何落码（铁律 0）。

## 3. 重核中新发现、必须在批准前裁的边界（这是本页真正的新信息）

runbook §5.2/§9 当时写"bot 没有 proto v0 调用，且**不得**在结算后半程完成前给 bot 加 proto 接线"。现在结算后半程已在主网跑通、`PROTO_*` 驱动开关已开——**那句"不得接"的前提已过期**（上表 §5.1 一行）。但对着 `api/proto.js`（`/bet` `:233`、`/claim` `:336`）读代码，"指向 proto-v0"的写侧有三处结构性事实，**不是开关、不是文案**：

1. **proto-v0 是单操作员模型，没有用户身份。** `/api/proto-markets/:id/bet` 不读任何下注人身份，`bettor_pk` 固定取"本市场委员会公钥[0]"（代码注释即 Bettor 1354 裁定，`T-PROTO-BETTORPK-BINDING` 已知限制）。请求体只有 `direction` / `amount`。⇒ **电报用户的 `/link` 绑定地址在这条路径里根本用不上**，`/mybets`、结算/手续费 DM、`/earnings` 这些依赖"某用户的注"的命令在 proto-v0 上**没有数据可读**。
2. **`/claim` 要求候选注恰好 1 条，否则 409**（代码注释："needs a bettor filter param, not built in v0"）。多个用户押同一赢方 ⇒ 该市场的 claim 永久 409。⇒ 多用户下注在 proto-v0 上会**制造一个卡死的市场**，不只是"不好用"。
3. **下注花的是 proto relay 的钱，且无鉴权。** proto 路由无鉴权、仅靠回环绑定；bot 与 console 同机回环，所以 bot **能**调；每笔下注由 `proto-v0-funds` relay 出 fee（该 relay 有 5 KAS 硬顶，哨兵盯着；余额不写入本页，D-021）。若把 `/bet` 直接接到电报上，**任何 Telegram 用户都能消耗这枚牺牲 relay 的 fee**，没有逐用户额度。

**据此我的建议**（Bettor 裁）：
- **P1（读侧）现在就可做**：只读、无花费、无身份依赖，正是"重新指向已跑通模块"。老用户看到主网市场与结果。
- **P2（写侧）不在本次落码范围**：要让电报用户真下注，proto-v0 先得有"逐用户身份 + claim 按人筛 + 每用户额度"——那是 **proto-v0 自身的新开发**，不是接线；它该由 J2/Bettor 在 proto-v0 侧立项，bot 再指过去。我**不在此页设计它**（避免又造一份设计稿）。过渡期若 Owner 要求电报能"下注"，唯一不改 proto 的做法是**运营者代下**（bot 只收意向、由运营者经现有 HTTP 路由手工执行）——这是流程而非功能，是否要由 Owner 定。
- 因此 §2 的 CR-3 + P1 + 文案 合成的电报口子 = "**能应答、能绑定主网地址、能看主网 proto 市场与结果的只读壳 + 运营者代下的意向收集**"。runbook §9 那句"接线本身不带来主网下注能力"**依旧成立**，只是"只读壳"现在能看到真市场了。

### 3.1 P1 落码前须处理的旧代码（Bettor 能力总清单 e7c3c18e 提示 + 我读码核实，2026-09-20 追加）

`tg-bot/worldcup-teams.mjs` 头注释自称"**TEMPORARY 决赛夜专用**"：`WC_SURVIVING_TEAMS` 是硬编码的当时决赛两队，决赛（2026-07-19）后本已过期。它被 `prediction-menu.mjs:12`（`/bet` 世界杯专题）与 `messages.mjs:4`（首页赛事区 fallback）用 `isDecidedWorldCupMarket` 静默过滤市场。⇒ P1 若让市场列表仍经这两条路径渲染，**会静默滤掉/误标内容**。落码前逐一决定：P1 的 proto 市场列表**不走**世界杯专题与该过滤（首选，最小），或该过滤在 proto 数据上显式旁路。此项进 P1 的"待核字段对照"清单，不在本页展开设计。另：`owner-bot.mjs`（第二个电报桥，Owner ⇄ 频道）本次不起（runbook §3.5 已裁），不受影响。

## 4. 执行顺序（沿用 runbook §7，只标出与现状的差）

1. 本页 → Bettor 审 → CR-1/2 出正式 worktree 实现（沿 CR 页 §4 流程；**不在生产检出改文件**）→ NWT 审 → Bettor 合入。
2. CR-3 + P1 + 文案 → Bettor 合成 Owner 单 → Owner 批后同一 worktree 落码。
3. CR-2 随**下一次主网重启**生效（不为 bot 单开重启）；bot 开闸（Stage B B4）**晚于**那次重启，且晚于 §1 前置 1.10 的三项闭合读数。
4. Stage A 隔离演练照旧（假 token、隔离端口、空库）；Stage B 主网开闸须 Owner 点头，执行人 Bettor 指定。
5. 主网现在已是 live（哨兵盯回环与 relay 余额）：Stage B 开闸前**复核 `PROTO_*` 开关与 relay 余额**，读数进当次账本（runbook §1.12 那行"驱动开关全 0"须按现状改成"已知全开，且 bot 无写路径接入"）。

## 5. 需要 Bettor 回的三点

1. 认可 §3 的边界与建议（P1 读侧做、P2 写侧不在本次、下注走运营者代下或等 proto-v0 侧立项）？
2. CR-3 + P1 + 文案 合成一份 Owner 单由你上报，可以吗？（我出单稿，不发 Owner。）
3. 本页作为唯一的"复启+接 proto-v0"文档，是否再补一次对当前 HEAD 的、含 P1 字段对照的落码前核（P1 的字段逐项对照我留到你批之后做，避免现在猜）？

## 6. 本页没做的事

没改任何代码/env/库；没起 bot、没建 broker 身份、没写 token、没动 `_state.json`；没另起设计稿；没碰主网 console。runbook 与 CR 页正文一字未改（它们页首的"搁置"注记在正式复启批准后由我补一行"已复启，见本页"）。
