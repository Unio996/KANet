# 主网预测市场：建盘与下注改为不收 KAS（D-017 §2 落地）· 设计 v0.1

> 作者：Bettor（会话 e59cd336）· 2026-10-04 · 状态：Owner 已批方向（「按你建议改！」，账本 1845），本稿为实施依据
> 依据：`docs/DECISIONS.md` D-017 §2「押注 ≠ KAS（硬约束）」「烧手续费不怕」· D-020 · D-033 · D-035 · 账本 (1843)(1844)
> 事实来源：Bettor 亲自读码（`kasia-console/src/api/pool.js`、`lib/pool-shard-register.mjs`、`services/*`）+ J2 只读调研报件 `docs/iteration/j1-inbox/2026-10-04T12-55Z-j2-REPORT-ktt-only-create-and-bet-gap-scoping-readonly.md`。行号以主线 `45ff82ef` 为准。

## 0. 一句话

链上合约已经只认 KTT 筹码；收真 KAS 的是 console 的 HTTP 路由层和几个自动程序。本次只改路由层与开关，**不改任何合约**，并且把「主网不收 KAS」从纪律变成代码里的硬闸。

## 1. 现状：主网上所有会向下注人或开盘人收 KAS 的地方（Bettor 逐个核过）

| # | 入口 | 收什么 KAS | 位置 | 调用方 |
|---|---|---|---|---|
| R1 | `POST /api/pool/market/create` | 开盘人锁 ≥100 KAS 进 PoolSpine | `pool.js:595`，`:804` | 页面 `predictions-pool-create.eta:878` |
| R2 | `POST /api/pool/market/create-v06` | 同上 | `pool.js:869`，`:1009` | 无现役调用方 |
| R3 | `POST /api/pool/market/create-v07` | 同上（ZK 原生盘也建 spine） | `pool.js:1090`，`:1423` | `pool-market-seeder.js:155`、`worldcup-schedule-cron.mjs:92` |
| R4 | `POST …/bettor/register-v07` | 下注人转 stake+2 KAS 给开盘方 | `pool.js:1495`，`:1562` | — |
| R5 | `POST …/register-v07/prep` + `/confirm` | 下注人付 stake+nonce 到每注 P2SH | `pool.js:1722`/`:1761` | `pool-house-agent.js:91`、`pool-auto-better.js:108` |
| R6 | `POST …/bettor/register` | 下注人锁 KAS 进 PoolSide | `pool.js:2240`，`:2355` | 页面 `predictions-pool-detail.eta:678` |
| R7 | `POST …/register-external/prep` + `/confirm` | 外部钱包付 KAS | `pool.js:2444`/`:2490` | — |
| R8 | `POST …/register-v06/prep` + `/confirm` | 下注人付 KAS | `pool.js:2654`/`:2691` | 页面 `predictions-pool-detail.eta:717`、`prediction-agent-mind.mjs:375` |
| R9 | `POST …/oracle/deposit` | 委员押金进 spine | `pool.js:2173`，`:2204` | — |

**自动程序（主网正在运行，Bettor 查主网日志确认）**：
- `house-agent`（`index.js:767`，只有 `DEMO_HOUSE_OFF=1` 才关；主网 env 没有这个键）——会用 R5 自动押 20 KAS。目前没押成，原因只是主网库里没有它要的 `HouseAgent` 钱包，也没有盘。
- `worldcup-schedule`（`index.js:892`，**没有任何开关**）——会用 R3 自动建盘，开盘方硬编码为 `15593e10…`。目前没建成，原因只是主网库里没有这个钱包。
- 两者都是"碰巧缺钱包所以没出事"，不是"被关掉了"。

**另一条独立下注线**：proto-v0（`/api/proto-markets/*`，D-033 判作废待删）在主网仍注册，`PROTO_DRIVER_ENABLED=1`、`PROTO_SETTLEMENT_DRIVER_ENABLED=1` 仍开；主网库有 1 笔 2026-09-15 的 `ambiguous` 旧下注意图。

**页面**：主网控制台的建盘页、盘口详情页调用的是 R1/R6/R8，即旧的 KAS 滚动模型（D-001 已判死路），不是我们刚接通的 ZK 结算链。

## 2. 目标形态

1. **下注人不付任何 KAS。** 下注量是 KTT 筹码单位；筹码由网关在链上免费铸给该盘的叶子合约（`bshard_genesis_mint_stake_chip`，现成），下注人钱包余额不变。
2. **开盘人不押任何东西。** ZK 原生盘不建 spine，开盘人只是发起者。
3. **链上手续费和占位小额（dust）由系统钱包付。** D-017 原文「烧手续费不怕」。这是运营成本，不是押注。
4. **主网上所有收 KAS 的入口一律拒绝**，由代码按网络判断，不靠 env、不靠纪律。测试网/simnet 行为不变（防止破坏既有测试）。
5. **结算侧不变**（2026-10-04 已上线的 7 个循环）。领奖拿到的是 KTT。

## 3. 改动清单（不改合约）

### 3.1 主网硬闸（先做，单独一段，最小改动）
- 新增一个小函数 `assertNoKasStakeOnMainnet(routeName)`：`configuredNetwork() === 'mainnet'` 时返回 403「主网押注与开盘不收 KAS（D-017 §2）」。网络判断用现成单源 `kaspa-network.mjs`，不另写。
- 挂在 R1、R2、R4（有 `bettor_relay_id` 的付款分支）、R5、R6、R7、R8、R9 的**第一行**，任何查库/转账之前。R3 见 3.3。
- 自动程序：`worldcup-schedule` 补开关 `WORLDCUP_SCHEDULE_ENABLED`（默认关）；`house-agent` 维持 `DEMO_HOUSE_OFF`，并在主网 env 补 `DEMO_HOUSE_OFF=1`（Owner 用 `!` 跑脚本）。
- 回归测试：对每个 R 发一次主网网络下的请求，断言 403，且 `transferAndConfirm` 一次都没被调用（打桩计数）。

### 3.2 下注：不收 KAS 的 KTT 下注（复用现成的"网关代付"分支）
- `register-v07` 已有 `freshBettor` 分支（`pool.js:1533`，"gateway sponsors stake from its own balance"）：下注人不转账，网关从自己余额付链上费用。本次**复用这条分支的做法**，不另起新路由：
  - 主网上，带 `bettor_relay_id` 的请求也走"网关代付"，即跳过 `:1562` 的下注人转账；`bettor_pk` 仍从下注人钱包地址推出（输赢归属不变）。
  - `stake_kas` 字段更名语义为 `stake_ktt`（筹码数量，代币单位）；保留旧字段名做兼容读取，主网只认新名。
  - 最小下注额：沿用 `BETTOR_MIN_STAKE_POLICY` 的数值作为筹码下限（只是数，不再是 KAS）。
- `register-v07/prep` + `/confirm`（每注 P2SH 付款对账）在主网直接拒绝（没有付款就不需要对账）。
- **网关每注实际 KAS 支出（读码所得，待 simnet 实测确认）**：筹码 dust 0.2 + 叶子代币续约 dust 0.2 + 票据 dust 0.2 + 两笔交易手续费；周转用的 1 KAS 余量以找零回网关。须在 3.5 实测中列出每一笔，并查清 dust 结算后能否收回。

### 3.3 建盘：ZK 原生盘不建 spine、不押钱
- `create-v07` 的 ZK 原生分支：跳过 spine 创世与 `:1423` 转账；去掉 100 KAS 下限与 5 KAS 可花费下限（仅主网 ZK 原生分支）；`maker_stake_amount` 记 0。
- `pool_markets.spine_p2sh` 在主网库是 NOT NULL：用一笔迁移 v221 改为可空（不用占位串，避免旧代码把占位当真地址去查链）。
- 读 spine 的旧路径遇到空值要跳过而不是报错：`broker-fee-emit`、`pool-card-groups`、`pool-commingle-detect`、`reclaimBshardMakerBond`、`pbs8-2-signreq-anchors`。逐个列出调用点并加单测。
- **待查（J2 实施前先答）**：旧结算器 `MIN_POT = 100 KAS` 是否在 ZK 路径有等价的最小池要求；ZK 原生盘建盘时还有哪些步骤读 `maker_stake_kas`（如手续费规则 `create-v07-fee-rules.mjs`）。

### 3.4 关掉 proto-v0 与清点旧下注
- 主网 env：`PROTO_DRIVER_ENABLED=0`、`PROTO_SETTLEMENT_DRIVER_ENABLED=0`（Owner 用 `!`，随 3.1 的 env 脚本一起）。
- `/api/proto-markets/*` 的写路由在主网同样挂 3.1 的硬闸。
- 那 1 笔 `ambiguous` 旧下注意图：只读查清链上实际状态（是否有 UTXO、在谁名下），出一页说明，不动钱。

### 3.5 验收（simnet，复用 seg4 的 harness，不另起）
- 场景：建 ZK 原生盘（无 spine）→ 两个对手方下注（下注人钱包不同）→ 自动判定 → 签字 → 交接 → 出证 → 关盘 → 自动领奖。
- **硬断言**：开盘人与下注人钱包的 KAS 余额，盘前盘后完全相同（逐 sompi）；网关和 pm-settler 的 KAS 支出逐笔列出、全部能归到「手续费 / dust / 周转找零」三类。
- 负向：主网网络标记下，R1–R9 全部 403 且零转账；proto 写路由 403。
- 赢家领到的 KTT 数量与下注筹码、赔率计算一致。

### 3.6 页面（用户面，按铁律 0 须 Owner 另批）
- 主网的建盘页和下注页目前调用旧 KAS 路由，3.1 之后会直接报 403。要让人在页面上下注，须把页面改到 3.2/3.3 的新形态，并把「KAS」字样改为「筹码」。这是用户面改动，单独出 UI 稿给 Owner 看图批，不在本次代码段里顺手改。

## 4. 分段与顺序

| 段 | 内容 | 谁 | 门 |
|---|---|---|---|
| S0 | 3.1 主网硬闸 + 自动程序开关 + env 脚本（DEMO_HOUSE_OFF / PROTO_* / WORLDCUP） | J2 写，Bettor 审 | Owner `!` 跑 env 脚本 + GO 重启 |
| S1 | 3.2 下注不收 KAS | J2 写，Bettor 按钱路审 | 合入不部署 |
| S2 | 3.3 建盘不建 spine + v221 迁移 + 旧路径跳空 | 同上 | 同上 |
| S3 | 3.5 simnet 全链验收（零 KAS 断言） | J2 跑，Bettor 核证据 | — |
| S4 | 部署：重启前只读模拟 → Owner GO 重启 → 首个小盘（下注人/开盘人零 KAS） | KANet-UI / J2 | Owner GO |
| S5 | 3.6 页面 | 另出 UI 稿 | Owner 看图批 |

S0 先做先上线，把口子先堵住；S1–S3 并行开发；S4 之前任何人不得在主网建盘。

## 5. 风险与边界（写清楚，不藏）

1. **免费下注被刷**：下注人不付钱，网关每注要付约 0.6 KAS 的 dust 加手续费。现在控制台只在本机监听，下注人只有我们自己的钱包，风险可控。**对外开放前必须加每钱包/每盘下注次数上限**，作为开放前置条件写进 S5。
2. **"零价值"的前提**：KTT 免费无限铸、无兑换渠道（D-017/D-035），所以下注与领奖都没有经济价值。任何把 KTT 兑成 KAS 或别的资产的功能，都会推翻本设计的合规前提，须 Owner 重新裁。
3. **领奖时的 KAS**：领奖交易会新建若干 ≥1 KAS 的输出（KIP-9 存储质量要求，J2 seg4 报告）。S3 必须查清这些 KAS 最终落到谁名下：如果落到赢家地址，就等于系统给赢家发 KAS，须改成回系统钱包或压到最低。这一条在查清前不得上线。
4. **3.1 只管 console 路由**：relay 直接命令（`sendCommandAsync`）不经过这些路由；只有本机进程能发，现阶段只有我们的智能体，靠派工纪律约束，记票。

## 6. 根因：为什么之前没发现（Bettor 复盘，含本人失职）

1. **9 月 23 日「押注移植」只移植了合约那一半，路由层被明确划出范围。** 账本 (1656)：NWT 复核结论「`api/pool.js` 不用改」，理由是那两处调用点对新代币字段「零感知」。这句话对"要不要传代币字段"是对的，但没有人问"这个路由还在向下注人收 KAS 吗"。D-017 §2「押注 ≠ KAS」在 9 月 13 日之后的账本里再没出现过（Bettor grep 全账本核实），审核清单里没有这一条。
2. **D-033（9 月 23 日）的指令是「把测试网跑通的预测市场原样指向主网」**，测试网上下注本来就用 KAS（测试网 KAS 不值钱）。D-033 §5 写「D-017 不变」时只点了「官方节点」那一半，没有点「押注 ≠ KAS」。于是团队后来的目标变成"接通"，没人回头核对押注资产。
3. **10 月 3 日我写的主网接通清单（A–G 七组）漏了这一项。** 我按"链路通不通"列缺口，没有按"Owner 硬约束逐条核对"列。
4. **结算移植四段（10 月 4 日）里，证据其实已经摆在面前**：J2 段 4 报告的「开盘方退出」实测写着开盘方取回约 130 KAS，说明开盘押的是 KAS；我审的是"退出路径对不对"，没有把它和 D-017 对上。
5. **首盘预检 J2 报出「下注收 KAS」后，我把违规当成选项给你二选一**，而不是直接判定不能开。这是最直接的一次失职。
6. **自动建盘/自动下注程序在主网一直开着**（house-agent、worldcup-schedule），只是碰巧缺钱包才没动。这说明"主网不该做的事"一直靠运气和纪律，没有代码闸。

**整改（不是口号，落到机制）**：
- 本稿 3.1：主网不收 KAS 由代码硬闸保证，并有回归测试。
- Bettor 审核清单加第一条：「本改动是否触碰 Owner 硬约束（D-017 §2 押注 ≠ KAS、D-031 不造轮子、钱路闸）？逐条写结论。」写进接位文件。
- 上线清单增加「Owner 硬约束逐条核对」一节，每条附代码位置证据，不写"已满足"空话。
