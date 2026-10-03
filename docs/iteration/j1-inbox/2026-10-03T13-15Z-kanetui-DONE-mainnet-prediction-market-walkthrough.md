# KANet-UI 交件：主网预测市场五步零花费走查（账本 (1808) 派工；GOAL.md 第 1 条线）

范围：只读 + 不花钱。对主网 console :3202（PID 3436，HEAD 235f4e64 起的 bshard-m3-deploy）。**未调用任何 POST / 写库 / 签名 / 广播接口，未改 env、代码，未重启，未碰私钥，未触 proto-v0 的页面操作。**
方法与口径：
- 实测 = 我对 :3202 发的 GET 请求（状态码与返回形状）、对 `console.mainnet.db` 的只读 SELECT 行数。
- file:line = 代码阅读（子代理先扫、我抽查了关键几处：pool.js 无 KCC-20 关键词、pool-shard-register.mjs:556-572 方向A 注释、proto.js:38 占位函数、SILVERC 二进制存在）。**其余 file:line 为代码阅读结论，未逐条人工复核。**
- env 开关：只读 `kanet.mainnet.env` 里值为 0/1/true/false 的开关名与值，其它键只核"名字在不在"，未读取、未抄录任何密钥值。「env 未设」= 该名字不在 env 文件里，行为取代码默认值。
- D-021：本文不含余额、密钥值、地址。

## 一、关键事实先说（影响读五步表）

1. **主网 console 上有两套"下注"实现，不是一套。**
   - **pool 路径**（`/api/pool/*`，测试网那套预测市场，页面 `/predictions/pool/create`、`/predictions/pool/:id`）。路由层 `api/pool.js` 里 KCC-20/KTT 关键词 0 处；但它的下注调用 `registerBettorOnShard`（`api/pool.js:1585`、`:1852` → `lib/pool-shard-register.mjs`），该库里有 KCC-20 押注"方向A"（`pool-shard-register.mjs:556-572`，每笔先无签名铸 stake chip 再与持仓合并，Owner 2026-09-26 批）。⇒ 押注币逻辑在库层、不在路由层。
   - **proto 路径**（`/api/proto-markets/*`、`/proto-markets*` 页）= `PROTO_RELAY_ID` / `PROTO_DRIVER_ENABLED` / `PROTO_SETTLEMENT_DRIVER_ENABLED` 这套。**这是已被 Owner 作废的 proto-v0**。主网库里现有 3 个 proto 市场、3 注（含标题 "Canary: prototype v0 first mainnet market"）。本件按派工**不把它当答案**，只在表里标注"proto 路径"以免混淆。
2. **D-019 §4 记的三个"旧 pin 下坏"调用点，在当前树里已迁到新 pin（`compileSilV100`）**——DECISIONS 里的行号已漂移：
   - `api/pool.js:~180` → 现为 `_resolveZkNativeCtorExtras`（`api/pool.js:163-199`），:197 调 `computeCloseZkTmplAnchor`（`lib/pool-shard-register.mjs:348-372`，已用 `compileSilV100`）。
   - `bshard-close-transport.mjs:~518` → 现为 `buildZkHandoffRequestV2`（`lib/bshard-close-transport.mjs:~518-585`），:585 同上，命令带 `dryRun`，函数内默认 true。
   - `closezk-v2-mint.mjs:~226` → 锚点计算在 :277，`compileCloseZkV2Redeem`(:96-123) 经 `compileSilV100`；文件内旧 `SILVERC_ZK` 常量(:19)已标 DEPRECATED、无引用。
   - 活进程佐证：stdout 有 `[silverc-pin] PASS sha256=4378ba65... golden=RootClaim ok`；`D:/silverscript/versioned-builds/` 下 silverc-v100 / legacy / zk 三个二进制都在；env 有 `SILVERC_V100_PATH`（值未记录）。
   - ⚠ **仍走旧编译器 `SILVERC_LEGACY_PATH`（默认 silverc-legacy-2c46231）的位置**：`api/pool.js:1589`、`:1856`（下注注册两处），`lib/pool-bshard-market-setup.mjs:20`，`services/bshard-close-voter.js:46`。是否与"主网集 = v1.0.0 单源 pin"冲突**我未验证**（只读阶段没走下注）。
   - 代码里**没找到**"主网未部署修复前禁止建盘"的代码级闸（DECISIONS.md:78 的约束，只看到运维约定）。
3. **主网库里预测市场相关表全是 0 行**：`pool_markets` / `market_shards` / `payout_shards` / `pool_bettor_sides` / `pool_committee` / `oracle_registry` / `oracle_pool_membership` / `oracle_stake_enrollments` / `pool_bet_preps` / `prediction_maker_whitelist` / `oracle_history` / `pool_snapshots`。`GET /api/oracle/registry` → `count:0`，`GET /api/oracle-pool/state` → `total_members:0, active_members:0`。

## 二、五步表

| 步骤 | 页面 · 路由（file:line） | 主网现状 | 卡点原文 / 走到哪停 | 开关现值（env） | 与测试网差异 |
|---|---|---|---|---|---|
| ① Polymarket 搜题 | 页：`GET /predictions/pool/create`（`index.js:479`，`ui/predictions-pool-create.eta`，搜索 fetch 在 :622）。API：`GET /api/predictions/polymarket/search?q=`（`api/pool.js:2772`，只读，调 gamma-api.polymarket.com，超时 5s，q≥2 字符，无开关） | **通**：实测页 200；`q=bitcoin` → 200 `{"ok":true,"results":[{condition_id,question,description…` | 无卡点。同页只读 GET：`/api/pool/config`（:2125）200、`/api/pool/fee-config`（:2142）200、`/api/oracle/registry`（api/bettor.js:2210）200（0 条） | 无开关 | 无差异（同代码、同外部源）。`/api/pool/config` 现返 `oracle_silent_timeout_min:1440`（主网值），测试网为 30 |
| ② 建盘 | 页同①。API：`POST /api/pool/market/create`（`api/pool.js:578`，页面 :878 调用）、`create-v06`（:852）、`create-v07`（:1073）；前置 `POST /api/pool/prevet-extract`（:4132）、`/prevet`（:4146）是 LLM 评估不广播。ZK 管理端点 `/api/admin/pool/propose-close-v2`(:1914) `zk-handoff-v2`(:1945) `zk-close-v2`(:1983) `zk-close-gate-debugger`(:2072)，默认 dry_run。 | **页能打开（200）；建盘接口未调用（会写库/广播）**。读侧：`GET /api/pool/markets` 200，`total:0` | 停在页面"发起"按钮 → `POST /api/pool/market/create*`。代码读到的前置：ZK 原生市场需要 `ZK_GATE_TMPL_HASH` `ZK_CLOSEZK_SIL_PATH` `ZK_TOKEN_TMPL_HASH` `ZK_CLAIM_TMPL_HASH` `ZK_MARKET_SUFFIX_HASH`，缺则抛错（`api/pool.js:171-179`）；`create-v07` 还要 oracle 池规模 ≥ `COMMITTEE_SIZE_GUARD`=5（代码读，当前 oracle 池 0 人）。maker 质押下限 100 KAS（`/api/pool/config`）。 | env 里**没有**：`ZK_GATE_TMPL_HASH` `ZK_CLOSEZK_SIL_PATH` `ZK_TOKEN_TMPL_HASH` `ZK_CLAIM_TMPL_HASH` `ZK_MARKET_SUFFIX_HASH`、`ADMIN_*_ENABLED`（管理端点开关）、`KANET_TESTNET_NO_LIMITS`（⇒ 代码默认：限额生效）。env 有：`SILVERC_V100_PATH`、`POOL_SEEDER_ENABLED=0`、`KASPA_NETWORK=mainnet` | 测试网跑通时用 TN12 的 ZK 模板 hash env 与 `KANET_TESTNET_NO_LIMITS`；主网 env 无这些名字。`api/pool.js:1141` 对 `KASPA_NETWORK||'testnet-12'` 有回退（主网 env 已设 mainnet，不触发）；`api/pool.js:1519` register-v07 的 `freshBettor` **硬编码 `network='testnet-12'`**（见下"指向 TN12 的残留"） |
| ③ 下注（KCC-20/KTT 押注） | pool 页：`GET /predictions/pool/:id`（`index.js:537`，下注 fetch 在 `predictions-pool-detail.eta:678/717/735`）。API：`POST /api/pool/market/:id/bettor/register`（`api/pool.js:2217`）、`register-v06/prep|confirm`（:2631/:2668）、`register-v07`(:1478) + `/prep`(:1700) `/confirm`(:1739)、`register-external/prep|confirm`(:2421/:2467)。广播在 `registerBettorOnShard`（`lib/pool-shard-register.mjs`，方向A :556-572）。KTT 铸币/持仓另在 `api/tokens.js`（`GET /api/tokens` :165、`GET /api/ktt/holdings` :280）。 | **无市场可下注**（`pool_markets`=0，`/api/pool/markets` 空）。`GET /api/tokens` 200（有 KTT 定义）；`GET /api/ktt/holdings` 不带参数 400（需 owner 参数，我没带）。下注接口未调用 | 停在详情页"下注"按钮 → `register*`（`/prep` 是否纯预览**我没验证**，`/prep`/`/confirm` 分两步，confirm 才广播这一点是代码读的）。当前前置不满足：无市场 | pool 下注无独立开关（路由层）；`BROADCAST_CHUNK_TIMEOUT_MS`(`api/pool.js:235`，默认 90000，env 未设)。`AUTO_BET_TICK_MS=0`、`PREDICTION_AGENT_ENABLED=0`、`POOL_SEEDER_ENABLED=0`（自动下注/做市 off） | 测试网押 KAS；主网押 KCC-20(KTT)，方向A 逻辑在库层。该逻辑的实链验证记录是 2026-09-24/26 的 simnet，**主网从未走过**（pool 表 0 行） |
| ④ 委员判定 | `startPredictionVoterCron`（`services/bettor-prediction-voter.js:67`，`index.js:718` 启动，无开关，tick `PREDICTION_VOTER_TICK_SEC` 默认 300s，只扫 `is_oracle=1` 的 relay）；bshard 投票三个 cron（`services/bshard-close-voter.js`：`startBshardCloseVoterCron`:264 / `…V2Cron`:548 / `startBshardCloseSubmitV2Cron`:644，`index.js:724-729`）；手动 `POST /api/pool/market/:id/oracle/vote`（`api/pool.js:3986`）。只读：`GET /api/oracle-pool/state`（`api/oracle-pool.js:421`）、`/api/oracle/registry`、`GET /oracle` 页 | **页通（`/oracle` 200）；无委员**：oracle 注册表 0、池成员 0、`pool_committee` 0。判定 cron 会跑但无事可做（无市场、无 oracle relay） | 无按钮可到；链路缺人：`is_oracle=1` 的 relay 与池成员为 0；`create-v07` 要池 ≥5 | `BSHARD_CLOSE_VOTER_V2_ENABLED=0`、`BSHARD_CLOSE_SUBMIT_V2_ENABLED=0`（env 明示关）；`BSHARD_CLOSE_VOTER_ENABLED`（v1）env 未设⇒代码默认 off；`BSHARD_SETTLER_RELAY_ID` env 未设；`PROTO_ORACLE_ADAPTER_ENABLED` env 未设（proto 路径，且主网仅限白名单零价值币）；`ORACLE_SILENT_TIMEOUT_MIN` env 有该名（值非 0/1，未读）| 测试网有 5 人委员会跑过全流程；主网 oracle 池/注册表/质押登记表全为 0。测试网 `oracle_silent_timeout_min`=30，主网 `/api/pool/config` 返 1440 |
| ⑤ 结算 / 退款 | `startPoolMarketSettlerCron`（`services/pool-market-settler.js:198`，`index.js:734`，无开关，tick 300s）；`bshard-settle-daemon.mjs`：`startSettleDaemonCron`:1043 `startZkCloseTickV2Cron`:1101 `startClaimAutonomousTickCron`:1111 `startZkHandoffAutonomousTickCron`:1135 `startZkJudgeProposeAutonomousTickCron`:1162（`index.js:813` 起）；`bettor-refund-claim-auto.mjs:174`（`index.js:753`）；路由 `POST /api/pool/market/:id/settle`（:3961，只置 verifying 不广播）、`…/bettor-refund-claim`（:4101）、`POST /api/operator/settle-command`（`api/operator-settle.js:34`）。只读：`/api/pool/market/:id/settle-audit`(:3651) `/events`(:3534) 等 | **cron 在跑但无对象**（`pool_markets`=0）。`/api/pool/market/:id/*` 只读接口无市场可查，未测 | 停在：无市场；即使有市场，ZK 自治结算链各 tick 开关在 env 都没开（见右） | env 有：`ZK_PROVE_WORKER_ENABLED=0`。env **未设**（⇒ 代码默认 off）：`SETTLE_DAEMON_ENABLED` `ZK_CLOSE_TICK_V2_ENABLED` `ZK_CLAIM_TICK_ENABLED` `ZK_HANDOFF_TICK_ENABLED` `ZK_JUDGE_PROPOSE_TICK_ENABLED`；`BETTOR_REFUND_CLAIM_ENABLED` env 未设⇒默认开（`!== '0'`）。proto 路径：`PROTO_SETTLEMENT_DRIVER_ENABLED=1`（proto-v0，不计入） | 测试网结算走的是 daemon 自治 + 委员签名；主网 daemon 与全部 ZK tick 默认关（需 env 显式开）。`ORACLE_SILENT_TIMEOUT_MIN` 代码默认 30、主网值 1440（`pool-market-settler.js:101` 带告警） |

## 三、指向 TN12 的残留（代码读，未改）
- `api/pool.js:1519`：register-v07 的 `freshBettor` 写死 `network = 'testnet-12'`。
- `api/pool.js:3907`：`/api/node/income` 同时推 testnet-12 与 mainnet 两个地址。
- `api/pool.js:127`：`kaspa-onchain` oracle 源 URL 指 `api-tn12.kaspa.org`。
- `api/oracle-pool.js:211/375/385/389/468`、`api/pool.js:1141`：`KASPA_NETWORK || 'testnet-12'` 回退（主网 env 已设 mainnet，当前不触发）。
- `lib/bshard-close-transport.mjs:244`：值不是恰好 `'mainnet'` 就取 `'testnet-12'`。
- 对 `17210`、`netsuffix` 在上述文件内 grep 无命中。
- 相对干净的：`lib/kaspa-network.mjs` 无默认值，未设 `KASPA_NETWORK` 直接抛错；settler / voter / daemon 都经它取网络。

## 四、要让五步走通还缺什么（只列事实）
1. 主网上没有任何 pool 市场（`pool_markets`=0）；五步里 ②→⑤ 的下游读写对象全不存在。
2. 没有委员：oracle 注册表 0、oracle 池成员 0、`pool_committee` 0、`oracle_stake_enrollments` 0；`create-v07` 代码要求池规模 ≥5。
3. env 缺 ZK 原生市场创世要的五个名字：`ZK_GATE_TMPL_HASH` `ZK_CLOSEZK_SIL_PATH` `ZK_TOKEN_TMPL_HASH` `ZK_CLAIM_TMPL_HASH` `ZK_MARKET_SUFFIX_HASH`（代码缺则抛错）。
4. 自治结算/投票开关：`BSHARD_CLOSE_VOTER_V2_ENABLED=0`、`BSHARD_CLOSE_SUBMIT_V2_ENABLED=0` 明示关；`SETTLE_DAEMON_ENABLED` 及四个 `ZK_*_TICK_ENABLED` 在 env 未设（代码默认 off）；`BSHARD_SETTLER_RELAY_ID` env 未设。
5. 资金侧：未核。pool 建盘 maker 质押下限 100 KAS（`/api/pool/config`）、下注下限 0.5 KAS；没有读 relay 余额（按 D-021 与零花费口径不碰）。
6. 编译器：下注注册两处（`api/pool.js:1589/1856`）与 `pool-bshard-market-setup.mjs:20`、`bshard-close-voter.js:46` 仍指 `SILVERC_LEGACY_PATH`（legacy 二进制文件存在）；这些位置与"主网集 v1.0.0 单源 pin"是否一致，我没验证。
7. 代码里写死或回退到 testnet-12 的位置见第三节。
8. 没发现"主网未部署修复前禁止建盘"的代码级闸；DECISIONS.md:78 的约束目前只靠运维约定。
9. 押注币（KCC-20/KTT）的 pool 路径下注，主网零次实链经历；已知的验证记录在 simnet（2026-09-24/26）。
10. 我没有验证的：pool `/prep` 接口是否真的不广播；`register-v07`(:1478) 是否确实经 `registerBettorOnShard` 走到方向A 逻辑（`:1585/:1852` 的调用点属哪些路由未逐一核）。

## 五、附：本次实际调用清单（全为 GET / 只读 SELECT）
`/api/predictions/polymarket/search?q=bitcoin` 200；`/predictions` 200；`/predictions/pool/create` 200；`/oracle` 200；`/proto-markets`、`/proto-markets/create` 200（proto 路径，仅为确认不混淆）；`/api/pool/markets` 200（空）；`/api/pool/config` 200；`/api/pool/fee-config` 200；`/api/oracle/registry` 200（0）；`/api/oracle-pool/state` 200（0）；`/api/tokens` 200；`/api/ktt/holdings`（无参）400；`/api/pool/status`、`/pool` 404（路由不存在）；`/api/proto-markets` 200（proto）。DB：`console.mainnet.db` 只读打开，SELECT COUNT(*)。临时脚本在 `kasia-console/scratch/_kanetui_pm_readonly*_20261003.mjs`（gitignored）。
