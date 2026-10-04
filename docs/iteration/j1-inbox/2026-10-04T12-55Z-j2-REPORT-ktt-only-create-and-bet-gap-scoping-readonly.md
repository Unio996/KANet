# J2 报件 · 主网「建盘 + 下注全程 KTT」缺口盘点（只读，无代码改动、无广播、无写库、无改 env）

> 派工：Bettor cross-session（账本 1843 后）。依据：`docs/DECISIONS.md` D-017 §2「押注 ≠ KAS（硬约束）」、D-020、D-033、D-035。
> 读的树：主检出 `master` @ `25d04033`（含 2026-09-23 D-020 移植进 `ShardLeaf.sil` 的代码）。主网库只以 `readonly` 打开。
> 所有「现状」都是读代码 / 读主网库得来；「估段」是估计，未实测。

## 0. 结论（先看这段）

1. **链上侧的下注已经是 KTT 原生**：生产路径 `registerBettorOnShard` → `ShardLeaf.sil`（D-020 移植版）把下注量记成 KTT「筹码」（`amount = stake` 代币单位）并并入池代币输出；KAS 只剩 dust。
2. **违反 D-017 的是 HTTP 入口层，不是合约层**：`register-v07`、`register-v07/prep` + `/confirm` 仍向下注人收**真 KAS**（stake + 2 KAS 垫款 / 带 nonce 的 pay_amount），maker 侧 `create-v07` 仍锁**真 KAS ≥100**。
3. **maker 侧在 KTT 原生设计里根本没有位置**：承载 maker KAS 的 `PoolSpine*.sil` 被明确排除在主网合约集之外（`mainnet-sil-set.json` `excludedLegacyExamples`；批 T 评估 §rolling 系「主网不部署」）。`create-v07` 却仍建 spine —— 我之前的 simnet 彩排（seg1–4）也是走这条，**没有演练过「无 spine 的建盘」**，这条要如实记下。
4. 没有任何一个现成的 env 开关能干净地关掉 `create-v07` / `register-v07`；唯一不改代码的拒绝办法是改 env + 重启（§4），这属 Bettor/Owner 动作。
5. 🔴 **附带发现**：主网 console 的 env 里 `PROTO_DRIVER_ENABLED=1`、`PROTO_SETTLEMENT_DRIVER_ENABLED=1` 仍开着，proto-v0 路由在主网已注册且可读（§1.2）。D-033 把 proto-v0 定为作废、待删。

## 1. 问题 (1)：D-020 单笔 KTT 下注路径在哪、有没有接生产路由、用哪套主网集 .sil

### 1.1 D-020 路径在代码里有两份，不要混

| | 合约 | builder / 编排 | 路由 | 状态 |
|---|---|---|---|---|
| **A. proto-v0 单片直转** | `ShardLeaf_direct.sil`（`register_append` 11→10 参，取消 stake 筹码输入；成功后 `convert_to_rootclose`）→ `RootClose` → `RootClaim` | `lib/proto-register-append-witness.mjs`、`proto-broadcast-ops.mjs`（`buildRegisterAppendAndBroadcast`）、`proto-bet-intent.mjs`、`services/proto-driver.mjs` | `POST /api/proto-markets/create`、`/:id/bet`、`/:id/resolve`、`/:id/claim`、`/:id/withdraw`（`api/proto.js`） | 主网已接线、已跑过：见 §1.2 |
| **B. 生产多片滚动** | `ShardLeaf.sil`（2026-09-23 把 D-020 的「去 stake 输入 + 合并池代币输出」移植进来，两文件 `register_append` 保持同语义）→ `PayoutShardV2` → `CloseZkV2` → `KanetTokenClaim`/`RefundClaim` | `lib/pool-shard-register.mjs`（`registerBettorOnShard`、`convergeShardLeafOwnRedeemLen`）、`pool-register-builder.mjs`、`pool-bshard-artifacts.mjs`（`computeKttTokenArtifact`、`computePoolSideTicketArtifact`）；relay `p2sh.mjs` `unlockBshardRegister`、`unlockBshardGenesisMintShardLeaf`、`bshard_genesis_mint_stake_chip` | `POST /api/pool/market/:id/bettor/register-v07`、`/register-v07/prep`、`/register-v07/confirm`（`api/pool.js` 1495 / 1722 / 1761） | 我的 seg1–4 结算侧移植（建盘 → 下注 → judge → close → claim）就挂在这一套上 |

两者都在主网合约集内（`kasia-console/scripts/mainnet-sil-set.json` 共 11 个：`KanetTestToken`、`PayoutShard`、`PayoutShardV2`、`KanetTokenClaim`、`RefundClaim`、`CloseZkV2`、`RootClaim`、`RootClose`、`ShardLeaf`、`ShardLeaf_direct`、`PoolSideTicket`）。**B 用的是 `ShardLeaf.sil`，不是 `ShardLeaf_direct.sil`**；`ShardLeaf_direct` 只被 A（proto）用。

### 1.2 proto-v0 在主网的实况（只读）

- `GET http://127.0.0.1:3202/api/proto-markets` 返回 200 + 市场列表 ⇒ 路由已注册（说明启动时 `assertProtoRelayHealthy` 通过）。
- 主网库：`proto_markets` 3 行（2 个 `cancelled`、1 个 `resolved`＝`a59c7b48…`，创建于 2026-09-15）、`proto_bets` 3 行（1 `pending`、2 `confirmed`）、`proto_bet_intents` 3 行（1 `ambiguous`、2 `landed`）、`proto_settlement_intents` 4 行（全 `landed`，2026-09-20）。`pool_markets` 为 0 行。
- 主网 env：`PROTO_RELAY_ID`、`PROTO_DRIVER_ENABLED=1`、`PROTO_SETTLEMENT_DRIVER_ENABLED=1`、`PROTO_SETTLEMENT_DRIVER_INTERVAL_MS=20000` 都在。
- 该路径本身是 KTT-only（下注量=代币单位，relay 只付手续费），**但**：单操作员模型（`bettor_pk` 复用市场委员会 pubkey，一把钥匙兼委员 + 下注人）、结算是 `RootClose.close_commit` 的 1-of-1 模拟 5 委员，**不是**我们现在上线的 ZK/judge 结算链；D-033 §3/§5 已把它定为作废并取代 D-020/D-022 在 proto 上的表述。所以「把 proto 当成 KTT 下注入口」与 D-033 冲突，需要 Owner 裁，不是我能选的。
- 我没有碰这些路由，没有 POST。

### 1.3 生产路由里 KTT 与 KAS 各发生在哪（读 `pool.js` 1495–1635 + `pool-shard-register.mjs` 651–782）

- 下注时链上做的事（已是 KTT）：`bshard_genesis_mint_stake_chip` 无签名铸一枚 `amount = stake`、owner = leaf covenant id 的 KTT 筹码（落链确认后才继续）；`register_append` 消费 [held 池代币（续笔）, 筹码] 产出合并池代币输出 `amount = pool_value + stake`；另出 dust ticket（`PoolSideTicket`）。KAS 侧只有 dust（`TOKEN_GENESIS_DUST` 0.2 KAS、`TICKET_DUST` 0.2 KAS、`REGISTER_FUNDING_HEADROOM` 1 KAS 余量，大部分以找零回 gateway）。
- 入口收真 KAS 的地方：
  - `register-v07` 单步：`transferAndConfirm(bettor_relay_id → gateway, stake + 2 KAS)`（`pool.js:1562`）。
  - `register-v07/prep`+`/confirm`：下注人付 `stake + nonce` KAS 到 per-bet P2SH，confirm 后 `sweep_per_bet` 报销 gateway。
  - 链上并不需要这笔 KAS 去「垫」筹码（筹码是 gateway 免费铸的）；按代码读法，这笔 KAS 的去向只是 gateway 钱包。（读代码所得，未实测。）
- 下注量的单位：`stake_kas ≥ 1`（`BETTOR_MIN_STAKE_POLICY = 1e8`），当作代币单位 sompi 用；KTT 的单位语义要在方案里重新定。

## 2. 问题 (2)：maker 质押在 KTT 原生设计里怎么说

- **KTT 原生合约集里没有 maker 质押。** 批 T 评估把 `PoolSpine v06/v07/v0_7_1/v08_*`、`PoolSide` 全系、`PoolRoot` 归入「rolling 系，D-001 已裁死路，主网不部署」；`mainnet-sil-set.json` 的 `excludedLegacyExamples` 含 `src/lib/PoolSpine*.sil`。11 个主网集合约里没有任何一个带 maker KAS 保证金字段。T3/T4 设计稿（`2026-09-14-j2-t3-…v0.4`、`t4-…v0.3`）里也查不到 maker 质押条目。
- **tokenized 结算链不消费 spine。** 我 grep 了 `pool-shard-settle.mjs`、`bshard-close-enforce.mjs`、`zk-autonomy-ticks.mjs`、`bshard-settle-daemon.mjs`：没有对 `spine_*` 的依赖（只在 `pbs8-2-signreq-anchors.mjs`、`pool-commingle-detect.mjs`、`broker-fee-emit.mjs`、`pool-card-groups.mjs` 等旧路径里引用；`pbs8-2-signreq-anchors` 在非测试代码里无调用者）。seg4 simnet e2e 里 maker 的 130 KAS 没有进池：池只由两笔下注（30 KAS 单位）构成。
- 所以 maker 质押现在是一笔**与池无关的 KAS 保证金**，唯一出口是 spine 的 `refund_maker_unjoined`（deadline+7200s 后）。D-017 §2 一旦严格读，这笔也违规。
- 设计稿没有现成答案；**需要 Owner/Bettor 先定语义**，我只能给选项：
  - (B1，推荐) zk_native 市场**不建 spine，也不要 maker 质押**；maker 只是「建盘者 + gateway 垫手续费者」，maker 想表态就像普通下注人一样走 KTT 下注。
  - (B2) 保留 maker 保证金但换成 KTT：需要一个持有 KTT 的新 spine 合约（合约改动 + 重审），代价大，且没有需求依据。

## 3. 问题 (3)：要做到「建盘 + 下注全程 KTT」缺什么（估段：1 段≈我 seg3/seg4 一段的体量，粗估）

**合约改动：不需要。** 下注链路合约（`ShardLeaf`、`PoolSideTicket`、`KanetTestToken`）已是 KTT；maker 侧选 B1 就不涉及合约。选 B2 或选「下注人真持有并花掉自己的 KTT」才要动合约（见 A2）。

| # | 缺口 | 内容 | 估段 |
|---|---|---|---|
| A1 | **KTT 下注入口（去 KAS）** | 新路由（或 `register-v07` 加显式模式位，不改老行为）：不调 `transferAndConfirm` / 不建 per-bet P2SH；gateway 只用自己的 KAS 付 dust + 手续费；`stake` 改称 KTT 单位并重定最小额；沿用现有 `registerBettorOnShard` 与筹码铸造不动。prep/confirm 同理（或直接退役为单步，因为无付款要对账）。 | 1 段 |
| A2 | （视 Owner 裁）下注人**真花**自己的 KTT | 若要求下注人必须持有并转出 KTT：筹码需来自下注人的 `owner_scheme=0x00` KTT UTXO（D-035），而现在筹码 owner = leaf covenant id、无签名铸；要改成「下注人 KTT UTXO → 转给 leaf covenant」，涉及 `KanetTestToken` 转移分支、relay 构造器与 NWT 钱路重审。D-020 当年的理由是「KTT 免费无限铸，筹码证明不了任何事」，所以**推荐不做 A2**。 | 2–3 段（仅当选做） |
| B | **建盘去 spine / 去 KAS 质押** | `create-v07` 的 zk_native 分支：跳过 spine 创世与 `transferAndConfirm`，去掉 100 KAS 与 5 KAS 两道下限；`pool_markets.spine_p2sh` 现为 `NOT NULL`（主网库实测）⇒ 要么占位值要么一笔 migration（v221）改可空；对应处理 `broker-fee-emit`、`pool-card-groups`、commingle 检测、`reclaimBshardMakerBond` 对无 spine 的行优雅跳过；`maker_stake_amount` 记 0。 | 1–1.5 段 |
| C | **测试与彩排** | 单测（新入口不收 KAS、没有 transfer 调用、无 spine 行被各旧路径跳过）；simnet 端到端重跑 seg4 的 harness：建盘（无 spine）→ KTT 下注（≥2 人对手方）→ judge/close/prove/claim 全自治；断言「全程 maker/下注人钱包 KAS 净支出 = 0，gateway 只付手续费」。复用 seg4 的 `lib.mjs` 与 e2e 脚本，不另起。 | 1 段 |
| D | **审查与合入门** | 钱路改动 ⇒ NWT 复核 + Owner 批；lint/M0a manifest（`money-path-manifests.mjs`）更新；DB 文档 `docs/DATABASE.md`。 | 0.5 段（排队时间另算） |
| E | **主网护栏** | 在 A1/B 落地前，必须有对 `create-v07` / `register-v07` 的拒绝手段（见 §4）。 | 取决于 §4 |

合计：选 A1 + B1（推荐）≈ **3.5–4 段**；若加 A2 ≈ 6–7 段且要重审合约。以上不含 Owner/NWT 排队。

未决问题（需 Bettor/Owner 回答，我不自行决定）：
1. 「下注 ≠ KAS」是否接受「下注人不需持有 KTT，筹码由 gateway 免费铸」这种形态（A1）？还是必须下注人花自己的 KTT（A2）？
2. maker 质押取 B1（取消）还是 B2？
3. 要不要沿用 proto-v0 路径做一个临时的 KTT 入口（§1.2）？这与 D-033 冲突，我倾向于不要，仅列出事实。
4. 一个我没核实的风险：旧结算器里有 `MIN_POT = 100 KAS`（`pool-market-settler.js`，PoolSpine_v07 的约束），ZK 路径是否有等价最小池约束我这次没查；落 B 时要查清。

## 4. 问题 (4)：不改代码，能否在主网拒绝 `create-v07` / `register-v07`

只读核实的结论：**没有专门的启停开关**，现有闸都不是为此设计的。

- `POOL_SEEDER_ENABLED=0`（已设）只停自动做市 seeder，不影响 HTTP 路由。
- 控制台只绑 `127.0.0.1`（`HOST=127.0.0.1`），所以只有本机进程能调；但 `pool.js` 这几条建盘/下注路由**没有鉴权**（`ADMIN_IP_ALLOWLIST` 只管 admin 路由）。我对 `:3202` 的 GET 请求不需要任何凭证就返回了数据。当前的「禁令」靠的是纪律，不是机制。
- env 层面可行办法（都要改 env + 重启，属 Bettor/Owner，**我没动**）：
  - `POOL_MAKER_STAKE_MAX_KAS=1`：解析是 `parseFloat(...) || Infinity`，所以 `0` 不行、要用 `1`；`KANET_TESTNET_NO_LIMITS` 在主网未设，`maker_stake_kas > MAX` 的拒绝（`pool.js:1336-1337`）发生在 spine 的 `transferAndConfirm`（`:1423`）和落库**之前**；而最小 100 KAS 是无条件的 ⇒ `create` / `create-v06` / `create-v07` 对任何入参都 400，不花钱不写库。市场建不出来，`register-v07` 自然没有 `pending_bettors` 的目标（404）。这是我找到的最小、可逆、fail-closed 的办法。
  - 去掉 `ZK_TOKEN_TMPL_HASH` / `ZK_CLAIM_TMPL_HASH` / `ZK_MARKET_SUFFIX_HASH` 任一，`register-v07` 会在付款前拒绝；但这些值也被结算侧用，**不推荐**。
- 不改 env 的办法：没有。
- 另外：`PROTO_*` 键与 proto 路由是另一条独立的下注/建盘入口（§1.2），上面的办法管不到它们；是否关由 Bettor/Owner 裁（D-033 已定作废）。

## 5. 数字与口径

- 主网当前：`pool_markets` 0 行；`oracle_pool_chain_view` pool_size=6；relay 里 J2 / NWT / Bettor 均 `is_oracle=0`。
- 我之前对 Bettor 说「这条路由收 KAS」属实（§1.3）；我同时没有在那次预检里提醒的两点现在补上：spine 不在主网集；proto 驱动 env 仍开。

## 6. 没做的事

没有任何广播、POST、写库、改 env、重启、代码改动。唯一的写动作是本报件文件与我的 scratch 脚本（`D:\kanet-tn12\scratch\_j2_mainnet_m1\`，只读查询脚本，不含密钥）。
