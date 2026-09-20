# KANet 能力/资产总清单 v0.1（"我们已经有什么·漏了什么"权威对照物）

> **Status**: CURRENT · 2026-09-20 起清点建 · Bettor 整理（全仓只读扫描，未改任何代码）
>
> **为什么有这份**：KANet 是几个月堆起来的大系统，团队一直没有一份"已经有什么"的权威地图 ⇒ 反复漏掉 / 重造已建成的东西，Owner 成了唯一记得的安全网（原话："我不知道你们还漏了多少东西"）。本文 = **D-031「绝不轻易新造轮子」的结构性对照物**：设计 / 动手前第一件事 = 对着本文查"这东西是不是已经有了"。
>
> **D-021**：本文不写密钥值、真实资金数额、内网入口、未修复漏洞利用细节。冷存资产明细在 gitignored `docs-private/ASSET-INVENTORY.md`。
>
> **来源**：全仓扫描 `D:\kanet-tn12`，对照 CLAUDE.md / DEVELOPER-GUIDE / DATABASE.md / DECISIONS.md / ANTI-PATTERNS.md / kanet-system-architecture.md / git log / COORD-LEDGER。**本文会过期**——发现新增/状态变化就更新，别信一份两周前的清单。

---

## 🔴 第一节：最容易被漏掉、"其实已经有了"的东西（设计前先扫这里）

1. **成熟在跑的电报 bot（约 24 命令）** —— `tg-bot/bot.mjs` + `prediction-menu.mjs`：托管钱包、水龙头、自助 broker 入驻、编号菜单下注、中英双语、结算 DM 后台轮询。**不在 CLAUDE.md「五大系统」里，DEVELOPER-GUIDE 里 telegram 0 命中，自带 README 只写了 8/24 命令。** 2026-09-20 有 agent 误当"从零"另起了一份"电报接 proto-v0 设计稿"，Owner 当天抓下、已撤（`git show 46b1bad9` 纯删除）。**今后任何电报活 = "把现成模块指向 proto-v0"，绝不是"设计 bot"。**
2. **第二个电报 bot：`tg-bot/owner-bot.mjs`** —— Owner⇄开发频道遥控桥（把 dev 频道镜像到 Owner 手机），0 密钥、`kanet-start.sh` 无条件拉、没 `OWNER_BOT_TOKEN` 就 no-op。**极易和用户面 broker bot 混为一谈或一起被忘。**
3. **主网结算系统今天已端到端自动跑通** —— proto-v0 batch-9 把真市场 `a59c7b48…` 走完 append→seal→close_commit→convert_to_claim→claim_draw，真主网 txid，约 3.5 分钟，三方独立验（provenance 目录在库）。这是"当前系统版"的"Owner 不知道它其实已经能跑"的风险。
4. **Oracle 自动判定（batch A/D/B）已全部编码并合入主线** —— 复用**老系统** `deriveVote`/`derivePolymarketVote` 引擎（不是重写）：写一次守卫（A）、冻结/宽限/refund-flip 预算（D）、adapter 本体（B）都已合。**尚未开**（`PROTO_ORACLE_ADAPTER_ENABLED` 仍关）——"已建成、只差一个开关"，别以为还得从头造。
5. **冷存账户曾在控制台不可见、差点被彻底忘掉** —— 两个冷账户（明细见私档）此前无处显示，直到 Owner 亲自发现（D-028，原话："如果我不多一嘴，这个资产就永远消失了"）。修法 `watch_accounts`（v211，只读，无密钥列）已编码并接进 `portfolio.eta`，合入 `b531485a`，**只差下次控制台重启激活**。
6. **真实在跑的 ZK 结算轨道（RISC0/Groth16，`zk-payout-guest/`）** —— 不是模板桩：定制 guest/host Rust，13 条黄金向量字节验，真生成的 receipt，TN12 上 armed（`OpZkPrecompile 0xa6` 在共识里 live）。与当前 KCC-20/proto-v0 主网轨道**并行、更老、独立**。JS-only 的 grep 扫不到它（跨语言）。
7. **`kas-market-maker/` 是一套完整独立的 KAS OTC 做市 bot**（自带 dashboard/db/价格引擎/风控）—— 和 `kasia-console` 内部的 `market-seeder.js` **毫无关系**（同名易混）。2026-05-24 起搁置、零改动、**没有任何启动脚本引它**（孤儿，手动才起）。
8. **`docs/ANTI-PATTERNS.md` 规则 1 早就把这个失败模式写下来了** —— `retail-dex`（1990 行）当年就是把 5 样已存在的东西重造了一遍。**团队有白纸黑字的"已有易漏"反模式，却还是在 tg-bot、gateway 上重犯。**
9. **`kasia-console/src/ui/partials/wizard.eta`** —— 完整 3 步入驻向导 UI，2026-06-08 建成过 DoD 评审，**从没被任何页面 include**。真·死代码。
10. **broker/"gateway" 角色曾有整套质押/审批 DB schema（v124）却几个月零 HTTP 端点**（"Owner 一直以为这几件都做了"）—— 后由 `/api/kanet-broker/onboard` 自助流解决，但"schema 建了、没人调"这个模式值得定期回扫。

---

## 1. 模块清单

### CLAUDE.md 的「五大系统」
| 模块 | 路径 | 运行形态 | 状态 |
|---|---|---|---|
| Console | `kasia-console/` | 主 Node/Fastify 进程（主网 :3202） | **在跑** · 2900+ 文件、34+ 表、100+ 端点、全部 UI，开发最重 |
| Relay | `kasia-relay/` | 每身份一子进程、持密钥 | **在跑** · 90 文件，今天动过 |
| Scout | `kaspa-scout/` | Console 拉起的单子进程 | **在跑（稳定）** · 23 文件，7-21 后无改动（长跑件，非陈旧） |
| Mind | `agent-mind/` | Console 按 agent 加载的库 | **在跑** · 155 文件，9-14 动过 |
| Adapter | `agent-adapter/` | 每 agent 一进程，**由 Console 拉起（`services/adapter-launcher.js` 管其生命周期）**，Mind 再经 HTTP 调它 | **部分/稳定陈旧** · 28 文件，核心 6/7 月起未动，一堆旧 `debug*.mjs` |

### 不在五大系统里（"易漏"清单）
| 模块 | 路径 | 用途 | 状态 |
|---|---|---|---|
| tg-bot | `tg-bot/` | 用户面电报 broker bot（见第一节） | **在跑**，主网有意暂停（D-024） |
| owner-bot | `tg-bot/owner-bot.mjs` | Owner⇄dev 频道桥 | 无条件拉，无 token 则 no-op |
| kas-market-maker | `kas-market-maker/` | 独立 KAS↔MEXC/法币 OTC 做市 bot | **搁置**（2026-05-24），无脚本引 |
| kas-relay | `kas-relay/` | 4 文件 MCP 验证桩，指库外路径 | **死**，与 `kasia-relay` 无关 |
| zk-payout-guest | `zk-payout-guest/` | RISC0 zkVM ZK 结算 guest（真 Groth16 证明） | **在跑**，TN12 轨道 live |
| kanet-skill | `kanet-skill/skill.md` | 5 行桩，列的文件不存在 | **桩/死** |
| packages/fee-split | `packages/fee-split/` | 可发布的通用费分库，从 console 单向哈希同步镜像 | **在跑**，实用，非重复 |
| shared | `shared/` | 跨切库 + vendored kaspa-wasm | **在跑**，被广泛 import |
| lib / examples / `_j2_probe_branch/` `_r6tmp/` | 各处 | 启动脚本共用 sh / 外部集成示例 / J2 covenant 尺寸草稿 | 在跑 / 桩 / 搁置 |

---

## 2. 在跑的服务/守护/定时（都在 Console 单进程内，除非另注）

> ON = 开机无条件起；OFF = env 门控、默认不设。

- **A. 老系统（`exchange_offers`/Polymarket 镜像）** —— 默认全 ON：`exchange-machine.js`(30s)、`bettor-prediction-settler.js`(5min)、`bettor-prediction-voter.js`（oracle **投票**守护 300s，走 Polymarket gamma）、及一批 `bettor-*.js`（scavenger/resolver/position-tracker/reactor/auto-valve/protector/watcher/fossa-scanner/variant-expander/refund-claim-auto，1min–6h）。`bettor-scanner.js` 已死（import 注掉）。
- **B. bshard 轨道（`pool_markets`/`market_shards`，铁律 0.5 死路架构，冻而不删）**：`pool-market-settler.js`(300s ON)；`bshard-close-voter.js`（V1 ON、V2 OFF）；**`bshard-settle-daemon.mjs`**（60s，除非 `SETTLE_DAEMON_OFF`，**很可能就是团队反复忘记的"那个已跑过的结算系统"**，另导出 4 个 ZK 自治子 cron，各自独立 kill switch）；一批支撑 infra（broadcaster/mining-consolidate/faucet-health/settle-alert/zk-stuck-alert/daa-monitor/coherence-monitor/preprune 等，ON）；`zk-prove-worker.mjs`(30s，真 RISC0 证明)。
- **C. 新 proto-v0（`proto_markets`）** —— 默认全 OFF、需 `PROTO_RELAY_ID`：`proto-driver.mjs`(20s，市场创生+铸注)、`proto-settlement-driver.mjs`(60s，**batch-9，今天跑主网那个**)、`proto-oracle-adapter.mjs`(300s，**batch-B**，复用老系统 derive*Vote，`PROTO_ORACLE_ADAPTER_ENABLED` 门控、主网限零价值代币)。
- **D. 池/答题 demo**：`pool-auto-better.js`(60s ON)、`pool-house-agent.js`（世界杯自动判 5min ON）、`pool-bot-autofund.js`(3min ON no-op)、`market-seeder.js`/`pool-market-seeder.js`(OFF-able)、`worldcup-schedule-cron.mjs`(30min ON)。
- **E. Oracle 池健康**：`oracle-voter-health-monitor.js`(2min)、`oracle-pool-chain-scanner-cron.mjs`(5min)、`oracle-pool-renewal-cron.mjs`(1h)，ON（`ORACLE_OFF` 关）。
- **F. Infra 看门狗**：relay-health/relay-hotwallet-monitor(30s)、scanner 看门狗(45s)、rpc/disk 告警、心跳文件(2s)、tx-landed-reconciler(5min)，全 ON。
- **G. Broker 系统**（`BROKER_ENABLED` 门控）：intake/buy-completion/bsc-incoming watcher OFF；state-machine/reconciler/fee-emit/bot-manager ON。
- **H. 独立进程**：kaspa-scout、kasia-relay(每身份)、`tg-bot/bot.mjs`(token+DB 标志才起)、`owner-bot.mjs`(无条件、无 token no-op)、**`kas-market-maker`(有自己的 mm-start，主脚本不引，孤儿)**、**`scripts/kanet-console-supervisor.sh`(外部健康看门狗，独立生命周期、可注册为 Windows 计划任务，曾被 kanet-start 的 pidfile 清扫误杀，2026-07-17 修)**、`zk-prove-server.mjs`、`external-gateway.mjs`。
- **I. 已死（TN12 退役 D-017）**：kaspad-watchdog/tn12-node-sentinel/mining-watchdog-v2/dag-probe/node-start/j1-watchdog 等。
- **J. 手动脚本**（从不自动调）：health-monitor/dev-coord-poll/j2-watch/peer-watch/watch-*/bettor-auto-decider(已被取代)/calibrator-learn/track-record-audit/llm-watchdog 等。

---

## 3. 用户面功能

### 3a. 电报 bot 命令（`bot.mjs`+`prediction-menu.mjs`）—— **全部打老后端**（`/api/pool/*`），`tg-bot/*.mjs` 里对 `proto_markets`/proto-v0 **零引用**
`/start` `/help` `/lang` · `/wallet` `/balance` `/receive` `/send`+`/confirm`（**托管钱包**，Console 存加密助记词，写死 testnet-12）· `/link <地址>`（非托管绑定，无签名挑战）· `/faucet`（测试网，24h 冷却）· `/verify`（**死桩**，重定向到 /link）· `/swap`（仅展示）· `/broker` `/broker_apply`（自助入驻，自动激活）· `/earnings` · `/bet`→编号菜单（老系统，v0.5 过滤掉）· `/mybets` `/record` · `/champions`（**依赖 `worldcup-teams.mjs` 硬编码队列，决赛 2026-07-19 后 2 个月没更新，已陈旧**）· `/discover`（低值桩）· `/hot` · `/support`（LLM 反馈桥）。后台轮询：链事件通知、待付确认(20 击断路器)、结算 DM、broker 费到账 DM。
> 关键：写死 testnet-12 的重指向点见 KANet-UI 的复启变更说明（`console-api.mjs` 收口 + config/network/link）。

### 3b. Web UI 页（`kasia-console/src/ui/*.eta`，约 65 页）
除下列外全部已路由接线：**`partials/wizard.eta`（死，从没被 include）**；`market-v2.eta`/`trading-v2.eta`（有意退役"化石"，302 重定向，留作参考）；`market-deal.eta`（只被已退役的 v2 引）。关键 live 页：exchange/trading/trade-\*（老交易+OTC）、predictions\*/oracle-home（老池+oracle）、proto-market-\*（新 proto-v0）、broker-home/maker-home/onboard、**portfolio（已含 D-028 冷存卡）**、faucet、relays（已含 tg-bot token/broker/起停配置）。

### 3c. 非 KAS 交易/broker 集成（顶层文档基本没写，只在 `docs/guide/08-market.md`）
- **真实股票券商集成**：IBKR(TWS)、Alpaca、Tradier、Tiger（`broker.js`，凭证 AES-256 加密，kanet-start 自动探测 IB Gateway）。
- **真实 Polymarket 下单**：agent 可下真单（`[ACTION:POLYMARKET_ORDER]`，$50 上限，走 action-executor）。
- **retail-dex**：Kasia 聊天里"买 10 KAS"→broker 中继、零托管，2026-04-23 起 live（也是反模式案例本身）。
- **DeFi**：Aave V3 on Arbitrum（供/取/借/还）。**跨链 OTC**：KAS↔USDT on BNB/ETH/SOL/TRON。

---

## 4. 预测市场/结算系统（三条轨道并存）

- **老系统**（`exchange_offers`/`pool_markets`+oracle voter/settler）：仍在维护、tg-bot 仍只讲这个协议(v0.6/0.7)，但 D-024 下**主网 `pool_markets`=0 行**。含 CLAUDE.md「Exchange 协议 v2.1」那套 16 笔真 E2E 战绩（真验证过的、曾 live 的系统）。
- **新 proto-v0**（`proto_markets`+batch-9+oracle A/D/B）：**当前 live 主网系统**，今天完成主网首结算轮 + 一轮干净 simnet 轮。Oracle A/D/B 已合**未开**。已知开口（自记未藏）：无正式 `/resolve` HTTP 路径（主网那轮用受控手工 SQL 写）、多赢家/并发/主网全新创生未测、`probeRefundFlip` 未实现、proto 路由无鉴权（靠回环绑定）、`T-PROTO-BETTORPK-BINDING`/`T-ORPHAN-CHIP-RECOVERY-ENTRY` 已受债。
- **ZK 承诺轨道**（更老、并行）：Rust 侧 `zk-payout-guest/`（RISC0 电路，真证明）+ **JS 侧调用方 `lib/zk-close-builder.mjs`+`services/zk-prove-worker.mjs`**（链下编排+证明生成，与 guest 配对，两端对上）+`CloseZkV2.sil`+`bshard-settle-daemon` 的 ZK 子 cron，"已建成、已上链、生产 armed" on TN12（底层 Groth16 上游标 Experimental、未审 mainnet）。铁律 0.5 的 committed 结算目标，与今天 live 的 proto-v0 轨道不同。

---

## 5. HTTP API 面（`kasia-console/src/api/*.js`，44 文件全经 index.js 接线）
大件：`trading.js`(75)、`bettor.js`(62)、`relay.js`(48)、`conversations.js`(48)、`pool.js`(42 **老系统**)、`stocks.js`(38)、`defi.js`(33)、`exchange.js`(28 **老系统**)、`discovery.js`(22)、`chat.js`(20 含 faucet)、`broker.js`(19 券商)。小而关键：`proto.js`(9 **新系统**)、`kanet-broker.js`(9 gateway)、`watch-accounts.js`(2 GET-only **冷存 D-028**)、`tg-wallet.js`(4 **托管钱包**)、`link.js`(2 TG 绑定)、`escrow.js`(4)、`ingest.js`(12 PSK 认证)、`dev-channel-v1.js`(6)。Admin/debug（localhost/secret 门控默认关）：admin/admin-dedup/coord-status/capability/operator-settle/oauth/test-oracle 等。

---

## 6. DB 表（`db/migrate.js`，最新 **v213**，2026-09-20）
- **新 proto-v0**：`proto_token_defs`/`proto_markets`/`proto_bets`/`proto_bet_intents`/`proto_claims`/`proto_settlement_intents`+`proto_market_verdicts`(v212)。
- **老预测/交易**：`exchange_offers`/`pool_markets`/`pool_bettor_sides`/`market_shards`/`payout_shards`/`retail_dex_*`。
- **Oracle**：`oracle_registry`/`oracle_history`/`oracle_disagreement_queue`/`oracle_stake_enrollments`/`oracle_pool_chain_view`/`pool_committee`/`polymarket_rules`/`historical_resolutions`。
- **托管钱包** `tg_custodial_wallets`(v174)；**冷存** `watch_accounts`(v211，无密钥列)；**faucet** `faucet_grants`；**escrow** `escrow_states`(v175)；bettor_* 约 16 张；ops(monitor/health/zk_prove_jobs)。
- **已删**：account_relations(v46)/interaction_records(v47)/oracle_pool_membership(v159)/group_chat_log·agent_groups(v149，永远 0 行)/broker_onboarding.status(v194)。
- **⚠ 文档陷阱**：`DATABASE.md` 表头写 v190（陈旧），但逐表节+版本尾维护到 v213——**信底不信头**；约 40 张表（多为 bettor_/monitor_/health_/retail_dex_）无专节。

---

## 7. 🔴 被忘/无文档/孤儿（重犯"重造轮子"的高危区）
| 项 | 证据 | 为什么易漏 |
|---|---|---|
| tg-bot 整个模块 | DEVELOPER-GUIDE 0 命中、不在五大系统、README 覆盖 8/24 | 今天刚撤过从零重设计 |
| owner-bot.mjs | 独立 token/进程、代码外无文档 | 易与 broker bot 混/一起被忘 |
| watch_accounts/D-028 冷存 | 已编码接进 portfolio.eta，待重启 | 曾数周不可见，Owner 亲自发现 |
| bshard-settle-daemon+4 ZK 子 cron | 完整自治结算守护，各自 kill switch | "那个已跑过的结算系统"最可能是它 |
| oracle A/D/B | 今天全合主线，差一个 env | 易以为"还得造" |
| wizard.eta | 115 行向导，过 DoD，无处 include | 过了评审却没接线 |
| kas-market-maker | 独立完整 OTC bot，自带 dashboard/db | 与内部 market-seeder 同名混淆，无脚本引 |
| kas-relay | 4 文件 MCP 桩，指库外 `D:/HC/clean/` | 名字像旧版 kasia-relay，实无关 |
| zk-payout-guest | 真 RISC0 guest，真证明 | 跨语言，JS grep 扫不到 |
| packages/fee-split | 可发布通用库，从 console 镜像 | 像副业，实为承重 |
| worldcup-teams.mjs 硬编码 | 自记"临时"，决赛后 2 月陈旧 | 今天仍在静默过滤 /champions、/bet |
| console-supervisor.sh 独立生命周期 | 明确不归 kanet-start 管，可注册计划任务 | 新 agent 易"好心"当野进程杀掉 |
| gateway 质押 schema(v124) | 整套 schema 几个月零端点（已由 onboard 解决） | "schema 建了没人调"模式值得定期回扫 |
| 真外部金融集成（IBKR/Alpaca/Tradier/Tiger/Polymarket 下单/Aave） | 只在 guide/08-market.md | 真·动钱集成，顶层文档看不到 |
| 陈旧侧文档 | `kanet-system-architecture.md`(2026-03-25，描述已删表为"仍在迁移")、`ALPHA-CHECKLIST.md`(2026-03-31) | 不声明自己已过期，会误导不交叉核对的人 |

---

## 维护约定
- 谁发现"其实已经有"的东西被漏/被重造 → 补进本文第 1 或第 7 节 + 频道说一声。
- 状态变化（模块开关翻转、死代码删除、陈旧文档修）→ 更新对应行，标日期。
- 相关：`docs/DECISIONS.md` D-031、`docs/ANTI-PATTERNS.md` 规则 1、memory `kanet-no-reinvent-wheel-first-principle`。
