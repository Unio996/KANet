# J2 交件：预测市场主网「接通清单」代码侧（账本 (1810)，只查不改）

范围：对 GOAL.md 第 1 条线「把测试网预测市场指向主网」，列代码侧缺口。**只读代码与账本，未改代码/env、未广播、未写设计。**
基线：`origin/bshard-m3-deploy` @ `51c02cd4`。另跑了一条只读核对：`compilePayoutShardRedeem` 缺 tokenTmplHash 时确实 throw「tokenTmplHash 必须是 32B hex」（证明校验存在；调用点漏传由 grep 证明，整条下注路径未跑）。读过 (1809)、KANet-UI 走查件。
口径：「读码」= 我读了该行附近上下文；「未核」= 没读到足以下结论、或需要跑才知道。D-021：本件不含地址/余额/密钥值。
路径省略前缀均为 `kasia-console/src/`；relay 侧写全。

## 0. 先说三件事（影响排序）

1. **🔴 比 testnet-12 残留更靠前的缺口（走查件没列）：下注注册入口没把三个模板哈希传进去。**
   `api/pool.js:1603`（register-v07）与 `:1864`（register-v07/confirm）调用 `registerBettorOnShard` 时参数里**没有** `tokenTmplHash / claimTmplHash / marketSuffixHash`（`grep tokenTmplHash api/pool.js` 只有注释命中）。
   而 `lib/pool-shard-register.mjs:140-143`（`compilePayoutShardRedeem`）、`:219-221`（`compileShardLeafRedeem`）、`:348-350`（`computeCloseZkTmplAnchor`）对这些值做 32B hex 校验，缺则 throw；`ensurePayoutShard`（:237）/`ensurePayoutShardV2`（:451）建每个市场首注创世时都会走到。`registerBettorOnShard` 自己也不读 env（该文件 `process.env` 只有 SILVERC 路径与 J2_DEBUG_DUMP_CTOR）。
   ⇒ **按读码，现树上任何市场的首注都会在创世编译处 throw「tokenTmplHash 必须是 32B hex」，zkNative 与否都一样。** 来源：D-019 迁移时账本裁定「12 个 JS 消费者这次不改」（`pool-shard-register.mjs:133` 附近注释），调用点没跟上。**未核：我没跑，需用现成单测/最小 dry 调用确认；若属实，它先于任何 testnet-12 问题挡住「下注」。**
   对照：结算侧 `lib/bshard-close-transport.mjs:555-569`（`buildZkHandoffRequestV2`）是**从 env 读**这三个值，并用 `assertZkHandoffTmplCoherent`（:512）与 `payout_shards` 行里记的值比对——即「注册侧写入的值」必须与「结算侧读 env 的值」同源，目前注册侧是空的。
2. **② 的「旧编译器」问题基本是假警报，但有两处真残留（见 §2）**：下注注册两处 `silverc` 参数是死传参；真走旧编译器的是 `bshard-close-voter.js:228`（V1 投票器，默认关）与 OracleStake_v1（委员押金地址，见 §3）。
3. **testnet-12 写死里「主网真路径会走到」的只有 4 处**（§1-A）；其余是 env 已设 mainnet 就不触发的回退（§1-B）。主网 env 已设 `KASPA_NETWORK=mainnet`（走查件述）。

## 1. testnet-12 写死 / 回退全清单（再自己 grep 全 src + relay + shared 补全）

分类：**A 主网真路径会走到 / B 回退（env=mainnet 时不触发，env 丢失才触发）/ C 刻意双网 / D 其它业务线与 UI 文案 / E 测试夹具与默认形参**。
通用现成解法：`lib/kaspa-network.mjs` 的 `configuredNetwork()`（未设即 throw，不回退）与 `assertAddressOnNetwork()`；同文件 `api/pool.js:1525`（`bettor_relay_id` 分支）已是这个写法；`services/oracle-pool-chain-scanner-cron.mjs:35`、`oracle-pool-renewal-cron.mjs:128`、`bshard-settle-daemon.mjs:57` 已迁。lint `R-NET-PREFIX-INFER/EITHER` 已翻 BLOCK（提交 `346adbce`）。

| # | 位置 | 类 | 现状（读码） | 现成解法 | 规模 | 钱路/需 simnet | 前置依赖 |
|---|---|---|---|---|---|---|---|
| 1 | `api/pool.js:1519` | A | register-v07 的 `freshBettor`（body 带 `bettor_pk` 且无 `bettor_relay_id`，「cross-node 命门③ fixture」路径）写死 `network='testnet-12'`，后面 `:1540` 起用它推 P2SH 地址 ⇒ 主网会算出 kaspatest 地址 | 照同函数 `:1525` 用 `configuredNetwork()` | 1 行 / 1 文件 | 是（地址进下注 tx）；P2SH 推导可单测，**真广播需验** | 无。该分支是否被 UI 走到：**未核**（`predictions-pool-detail.eta:678/717/735` 发的 body 未读） |
| 2 | `api/pool.js:127` | A | `kaspa-onchain` 预言源 URL 写死 `api-tn12.kaspa.org`；`deriveCanonicalFromSourceKind`（:131）结果存进 `spec.data_source_canonical`（:142，进 `resolution_rule_spec`） | 同形的 `kasia-relay/src/lib/api.mjs:5` 有 mainnet 表；或 `lib/explorer-url.mjs` | 1 行 | 不直接是钱路；**若 canonical 进了 predicateCommit（`resolution_rule_spec` 进哈希：未核）则改它会改创世字节** | 仅当市场用 `kaspa-onchain` 源才触发；搜题→Polymarket 源不走这里 |
| 3 | `services/zk-prove-worker.mjs:100` | A | `buildAndFundGate` 用 `addressFromScriptPublicKey(spk,'testnet-12')` 算 gate 地址，随后 `transfer` 给它 ⇒ 主网会把钱转向 kaspatest 地址（relay 多半拒，未核） | `configuredNetwork()` | 1 行 | **是（资金转出）**；需 simnet/主网小额 dry 验 | 受 `ZK_PROVE_WORKER_ENABLED` 与 `ZKPROVE_OFF`（`index.js:627`）门控，现 0；开它前必须先改 |
| 4 | `lib/bshard-close-transport.mjs:244` | A(对 simnet 验) / B(对主网) | `KASPA_NETWORK==='mainnet' ? 'mainnet' : 'testnet-12'`：主网 env 下正确；**simnet/devnet env 下会错算成 testnet 地址**，使 K-18 coherence gate 误 FAIL | `configuredNetwork()` | 1 行 | 是（门在 consolidate/签名之前挡）；影响「在 simnet 验」这条前置 | 做 ②④ 的 simnet 验证前先改，否则验证环境本身偏 |
| 5 | `api/pool.js:1141` | B | `KASPA_NETWORK \|\| 'testnet-12'`，用于 create-v07 自动派生 merkle root 的 RpcClient networkId | `configuredNetwork()` | 1 行 | 否（读链） | env 必须保持 mainnet |
| 6 | `api/oracle-pool.js:211,375,385,389,468` | B | 同形回退，5 处（enroll 推 stake P2SH、chain-snapshot、timeout-unlock） | `configuredNetwork()` | 5 行 / 1 文件 | enroll 的 P2SH 是委员押金地址 ⇒ **改错/回退错会让押金打进 kaspatest 地址**，属钱路 | env 保持 mainnet |
| 7 | `services/preprune-capture-worker.mjs:139` | B | IBD 门 `expectNet = env.KASPA_NETWORK \|\| 'testnet-12'`，与 `getServerInfo().networkId` 比，不等 fail-closed | `configuredNetwork()` | 1 行 | 否 | env 丢失时门恒 `network-mismatch` ⇒ 跳过类 tick 全停 |
| 8 | `api/bettor.js:2069` | B | 仅用于 explorer 链接 | `configuredNetwork()` | 1 行 | 否 | — |
| 9 | `api/relay.js:157` | B/A | 「导入/创建 relay」`network \|\| 'testnet-12'`，决定新 relay 地址前缀（:162 `NetworkType.Testnet`）；调用方不传 network 就得到 kaspatest 地址 | `configuredNetwork()` | 2 行 | 是（新 relay 即新资金地址） | 要新增主网委员/下注 relay 时才用到 |
| 10 | `api/pool.js:3907` | C | `/api/node/income` 刻意同时推两网地址 | 无需改 | 0 | 否 | — |
| 11 | `api/tg-wallet.js:27`、`lib/custodial-network.mjs:5` | D | CR-2 守卫：电报托管钱包只支持 testnet-12，网络不符即拒 | 不动（已合入 GREEN） | 0 | — | 与本线无关；主网 env 下该模块按设计拒绝 |
| 12 | `api/chat.js:609`、`api/dev-channel-v1.js:178-337`、`api/kanet-broker.js:22-38`、`lib/broker-escrow-check.mjs:12`、`services/worldcup-schedule-cron.mjs:21` | D | 水龙头/开发频道/broker 的 kaspatest 地址校验与演示地址 | 与预测市场无关 | — | — | — |
| 13 | `ui/predictions-pool-create.eta:719` | D(UI) | 前端写死 `https://api-tn12.kaspa.org/transactions/`（txid 外链） | 照 `lib/explorer-url.mjs` 单源 | 1 行 | 否 | 与 #2 同族；「只做 UI」线 |
| 14 | `ui/predictions.eta:5-32` | D(UI) | 首访弹窗/横幅写「testnet-12 真 e2e / 仍 testnet」 | 文案 | 数行 | 否 | 用户面文案 ⇒ 须 Owner 批（铁律 0） |
| 15 | `db/migrate.js:5167`（列默认 `'testnet-12'`）、`:5772`（CHECK 闭枚举含 mainnet）、`lib/u1-s10-identity.mjs:23` | E/D | S10 身份表网络列 | 枚举已含 mainnet | 0 | — | — |
| 16 | `lib/u1-v198-migration-acceptance.mjs`、`lib/broker-refund-classify.mjs:22`（默认形参）、`services/broker-refund-dedup.js:107`、`broker-state-authority.js:571` | E | 默认形参/验收夹具；两处调用点是否显式传 network：**未核** | — | — | — | broker 线，非本线 |
| 17 | relay 侧 `kasia-relay/src/lib/api.mjs:6`（含 mainnet 表项）、`wallet.mjs:11,129`、`utxo-split.mjs:54`（testnet-12→testnet-10 仅给 wasm Generator 的映射）、`p2sh.mjs:214`（`compileEscrow` 默认形参，无生产调用点，仅文档引用）、`p2sh.mjs:492`（注释）、`per-bet-p2sh.mjs:55`、`shared/lib/kaspa-network.mjs:12-18`（映射表） | E | 映射表/默认形参/注释；mainnet 分支均存在 | — | — | — | `unlockP2SHMultiSig` 等调用方传的 networkId：**未核** |

小结：A 类 4 处共约 4 行改动，B 类约 10 行；全部「换成 `configuredNetwork()`」，不需要新造函数。其中 #3 #6 #9 碰资金地址，必须 simnet/小额验。

## 2. 下注注册等 4 处「旧编译器」vs D-019 `compileSilV100`

D-019 锚点：`lib/pool-bshard-artifacts.mjs:112,258`（`DEFAULT_SILVERC_V100_PATH` + `compileSilV100`，每次编译前验二进制 sha256 + 黄金样本 `scripts/silverc-pin.json`）；启动自检 `:221`、`index.js:133`。

| 位置 | 现状（读码） | 会不会产出与主网其它环节不一致的字节 | 判据 | 现成解法 | 规模 |
|---|---|---|---|---|---|
| `api/pool.js:1589`、`:1856`（`silverc = SILVERC_LEGACY_PATH…`） | 算出来传给 `registerBettorOnShard({…silverc…})`。但该函数体内**不使用** `silverc`：`pool-shard-register.mjs` 里 `silverc` 只出现在 JSDoc（:495）与一条注释（:540），`PayoutShard/ShardLeaf/PayoutShardV2/CloseZkV2` 全部走 `compileSilV100`（:150,:176,:212,:223,:369,:443）。 | **否——死传参**，不影响字节。 | `grep -n "silverc" lib/pool-shard-register.mjs` 看函数体无引用；读码结论，**未跑** | 删这两行与 `silverc` 实参 | 4 行 / 1 文件；非钱路（但与 §0-1 的补参同文件，建议同一笔） |
| `lib/pool-bshard-market-setup.mjs:20` | 老「bshard M3 genesis builder」，用 `compileSil`（旧 schema）编 PoolRoot/PoolLeaf/PoolSide/ShardLeaf（:51,:76,:128,:210） | **生产无导入者**：`grep pool-bshard-market-setup` 仅命中 `pool-bshard-artifacts.mjs`（注释）、自身、`scripts/lint-kanet.mjs`。当前下注路径用 `ensurePayoutShard*`+`compileShardLeafRedeem`，不经它。 | 同上 grep；**未核**脚本/测试里的引用（只扫了 src+scripts 非 test） | 不动，或标 DEPRECATED | 0 |
| `services/bshard-close-voter.js:46`（用于 :228 `deriveTicketAddr` → `compileSil(PoolSide…)`） | V1 投票器用**旧编译器**重算 PoolSide 票据地址，来核「票据地址是否在链」。现下注路径铸的票据是 `computePoolSideTicketArtifact`（`pool-bshard-artifacts.mjs:402`，**V100**）。 | **会不一致**（旧编译器 PoolSide vs V100 PoolSideTicket 不同合约/不同编译器）⇒ V1 投票器的 C1 级2-B 反换身份检查在新市场上会判不过。 | 默认不启动（`BSHARD_CLOSE_VOTER_ENABLED=1` 才起，:262）；V2 投票器（:548）不引用 `SILVERC`（grep 仅 :46,:230）。**判是否一致需 simnet 验** | 主网只走 V2 即可绕开；或改用 V100 版（`computePoolSideTicketArtifact`）——属设计选择，**不在此件决定** | 若改：~5 行 / 1 文件；钱路（投票/签名前置检查），需 simnet |
| `lib/pool-bshard-artifacts.mjs:33`（模块默认 `SILVERC`）及其 `compileSil` 调用者 `computePoolRootArtifact/Spine/PoolSide`（`:306-343`，使用者 `pool-refund-builder.mjs`、`bshard-close-enforce.mjs`） | 旧家族 helper，被「退款构建/enforce」读 | 取决于被保护的市场是否旧家族：**未核** | — | — | — |
| `lib/pool-p2sh.mjs:20`（经 `lib/oracle-stake-v1.mjs` 的 `compileAndComputeP2SH`）、`lib/prediction-escrow-ss.mjs:33` | **OracleStake_v1（委员押金地址）仍用旧编译器**；`api/oracle-pool.js:219`（enroll）与 `services/oracle-pool-chain-scanner.mjs`（派生已登记 stake 的 P2SH 去扫 UTXO）都经它 | 登记侧与扫描侧同用旧编译器 ⇒ 内部互相一致；但**与「主网集 v1.0.0 单源 pin」不一致**，且 `OracleStake_v1.sil` 是否在 D-019 迁移清单内：**未核**（读 `docs/2026-09-14-j2-d019-silverc-v100-migration-inventory-v0.1.md` 可定，我没读全） | 须读迁移清单 + simnet 实测押金地址 vs 解锁（`timeout-unlock`，`oracle-pool.js:457`） | 若需迁：按 `computeStakeP2SH_v1` 一处改 | 钱路（押金 UTXO），需 simnet 真共识验 |

结论：**就走查件问的这 4 个点，pool.js 两处 + market-setup 不会产出不一致字节；真风险在 OracleStake_v1（押金地址）与 V1 投票器。**

## 3. ③ 委员池注册与 create-v07 路径

- **建盘门槛**（两层，都在 `api/pool.js`）：
  - `:1108-1127` `COMMITTEE_SIZE_GUARD = 5`：最新 `oracle_pool_chain_view` 快照 `pool_size<5` ⇒ 503；无快照也 503。（走查件写的 :1157 是第二层。）
  - `:1155-1167` 自动派生 `pool_merkle_root` 时再查 `derived.pool_size < COMMITTEE_SIZE`（`services/pool-committee-sampler.mjs:24` `COMMITTEE_SIZE = 5`）⇒ 400。
- **注册接口（现成）**：`POST /api/oracle-pool/enroll`（`api/oracle-pool.js:200`）入参 `staker_pk_x`、`lock_until_daa`、可选 `signing_relay_id`（用于上链广播 envelope）→ 写 `oracle_stake_enrollments`，回 `next_step: transfer ≥1 KAS to <p2sh> with lockTime=…`；扫描器 `services/oracle-pool-chain-scanner.mjs`（cron `oracle-pool-chain-scanner-cron.mjs`，`index.js:805`）验链上 UTXO 后入池；续期 `oracle-pool-renewal-cron.mjs`（`index.js:809`）。`POST /api/oracle-pool/seed`（:102）已是空壳（INSERT 已删，只验 `get_pubkey`）——**不能用它造池**。
- **锁定金额常量**：`lib/oracle-stake-v1.mjs:65` `ORACLE_STAKE_MIN_SOMPI = 100_000_000`（1 KAS，也是扫描器 `oracle-pool-chain-scanner.mjs:88` 的计入门槛）；合约手续费区间 `ORACLE_STAKE_FEE_MIN/MAX = 1000 / 1e8`（:66-67）；建盘 maker 质押下限 100 KAS、下注下限 0.5 KAS（走查件引 `/api/pool/config`，我未单独核常量位置）。委员 bond 默认 0（`api/pool.js:1201` `oracle_bond_kas` 默认 0）。
- **需要「该 relay 是 oracle」的另一条门**：`bettor-prediction-voter` 只扫 `relay_nodes.is_oracle=1` 的 relay（走查件述 `bettor-prediction-voter.js:67`）；`is_oracle` 的写入点在 src 里**未找到**（`agent-v2.eta:1528` 注释写「chain enrollment 单源，不双写 is_oracle」）；`oracle_registry`（`POST /api/oracle/announce`，`api/bettor.js:2161`，TTL 24h）是 bettor 路径用的另一张表。**两套登记（链上 enrollment vs registry/is_oracle）各管不同消费者，哪些必须都做：未核**。
- **跨节点/去中心**：委员需 5 名**不同**的 oracle 身份；单机上可用多个本机 relay 各自 enroll（测试网做法，见 `docs/` 与账本，我没逐条挖）。主网哪些 relay 能当委员：KANet-UI 配置侧件覆盖。
- 规模：**登记本身是调现成接口，不需改码**（前提是 §1 #6 的 enroll 网络回退不触发，即 env=mainnet）。

## 4. ④ ZK 五个值（env）在代码里如何计算/读取

| env | 读取处 | 值的含义与来源 | 现成脚本能否对主网产出 |
|---|---|---|---|
| `ZK_GATE_TMPL_HASH` | `api/pool.js:171,185,2015,2105`；`bshard-close-transport.mjs:555,579` | gate redeem suffix 的 blake2b，只依赖 guest `imageId`；`lib/gate-tmpl-hash.mjs:computeGateTmplHash` 可现算，`ensureGateTmplHashFresh`（:81）在 zkNative 创世前 `force` 校验 env==`zk-close-builder.mjs ZK_GATE.gateTmplHash`==现算 | **可**：`gate-tmpl-hash.selftest.mjs` 有三源一致断言；依赖 canonical sample `zk-payout-guest/proofs/3o6cs-attest-0a358fa0/`（读码，**该目录在本树是否存在：未核**）与 ZK-SDK wasm（`ZKSDK_WASM_PATH`）。**TN12 时代的 `kanet.env:233` 已有一个值（被 gitignore）**，网络无关，只要 imageId 未变就可参照——是否仍等于现 `ZK_GATE.gateTmplHash`：**未核**（我没读该值，只看到它存在，读它属 KANet-UI 配置侧） |
| `ZK_CLOSEZK_SIL_PATH` | `api/pool.js:172,186`；`bshard-close-transport.mjs:556,580` | `CloseZkV2.sil` 路径；仓内 `lib/CloseZkV2.sil` 即是；`kanet.env:232` 已有写法 | 无需脚本，是路径 |
| `ZK_TOKEN_TMPL_HASH` | `api/pool.js:177,197`；`bshard-close-transport.mjs:560,567` | `KanetTestToken` 模板哈希（协议常量，编译一次全市场复用；`scripts/proto-v0-template-anchors.mjs` 注释「订正」段已论证）。现成函数：`pool-bshard-artifacts.mjs:432 computeKttTokenArtifact`（V1）/`:477 computeKttV2TokenArtifact`（V2，D-035 面板用）→ `templateHashHex`。**注意：v1 与 v2 是两个合约，env 该填哪个：未核**（`register_append` 方向A 用的是 v1 `computeKttTokenArtifact`，`pool-shard-register.mjs:22`） | **可**：`scripts/proto-v0-template-anchors.mjs` 的 token 段是现成产出路径，但文件名属已作废的 proto-v0（Owner：不得再碰）⇒ 建议**参照其算法、不直接跑**；等价调用就是 `computeKttTokenArtifact({amount:0,ownerCovIdHex:…})` 取 `templateHashHex`（参数取值：未核） |
| `ZK_CLAIM_TMPL_HASH` | 同上 `:178` / `:561,568` | `KanetTokenClaim` 模板哈希（`lib/KanetTokenClaim.sil`）。proto 脚本注释称它**逐市场变化**（RootClaim 烤 shard_pool_id），但 v0.3 方案C 删字段后对 `KanetTokenClaim` 是否仍逐市场：**未核** | 仅 `proto-covenant-builder.mjs:489` 有编译 `KANET_TOKEN_CLAIM_SIL` 的代码（proto 线）；非 proto 路径**没找到**产出该值的现成函数 ⇒ 缺口 |
| `ZK_MARKET_SUFFIX_HASH` | `api/pool.js:179`；`bshard-close-transport.mjs:562,569` | **已不进 ctor**：账本 1408/1409/1415 把该字段从 `CloseZkV2.sil` 删了（`pool-shard-register.mjs:337-345` 注释）；env 检查是遗留，仅供 `payout_shards.market_suffix_hash` 记账与 `assertZkHandoffTmplCoherent`（:512）比对 | 无产出脚本；此检查是否还需保留属设计问题，**不在此件** |

补充：注册侧与结算侧要**同源**读这些值（§0-1）；`closezk-v2-mint.mjs:96`（`compileCloseZkV2Redeem`）与 `computeCloseZkTmplAnchor` 都吃同一组。

## 5. ⑤ 第一原则最低范围：services/ 全目录（204 项）+ index.js 启动注册，逐缺口「复用 / 参照 / 为何不能用」

扫描方式：`ls services/`（204）+ `grep start*(` index.js（约 70 个启动点）。与预测市场相关的服务如下；与本线无关的（aave/aevo/hyperliquid/broker-*/exchange-*/bsc/tron/sol/across/…）整类略过，已列出类名不逐个展开。

| 缺口 | 现成可用 | 结论 |
|---|---|---|
| 委员池造池 | `api/oracle-pool.js` enroll、`services/oracle-pool-chain-scanner(-cron).mjs`（`index.js:805`）、`oracle-pool-renewal-cron.mjs`（:809）、`pool-committee-sampler.mjs`、`oracle-sampler.js`（旧 registry 抽样） | **复用** enroll+scanner+sampler；`oracle-sampler.js` 属 oracle_registry 老路，**参照**；`/oracle-pool/seed` **不能用**（INSERT 已删） |
| 建盘 | `api/pool.js` create-v07；`services/pool-market-seeder.js`（`POOL_SEEDER_ENABLED` 默认关，`index.js` 另处启动）；`services/polymarket.js`（搜题 :2772 已通） | **复用** create-v07；seeder 是自动批量造盘，**不是接通必需**（需要时再开）；走查件说搜题已通 |
| 下注 | `lib/pool-shard-register.mjs registerBettorOnShard`（方向A KCC-20）；`services/pool-auto-better.js`、`pool-house-agent.js`、`pool-bot-autofund.js`（`DEMO_*_OFF` 开关，`index.js:761-773`） | **复用** registerBettorOnShard，**但先补 §0-1**；三个 demo 服务是测试网演示负载，**不能用**（会在主网自动下注/补款，须保持 `DEMO_*_OFF=1`：**未核主网 env 现值**，属配置侧） |
| 委员判定 | `bettor-prediction-voter.js`（`index.js:718` 无开关，扫 `is_oracle=1`）、`bshard-close-voter.js` V1(`:725`,开关 `BSHARD_CLOSE_VOTER_ENABLED`)/V2(`:728`,`BSHARD_CLOSE_VOTER_V2_ENABLED`)/Submit V2(`:729`,`BSHARD_CLOSE_SUBMIT_V2_ENABLED`)、`prediction-parallel-judgment.mjs`、`prediction-agent-mind.mjs`（`PREDICTION_AGENT`）、`oracle-voter-health-monitor.js` | **复用** V2 投票+提交（测试网做法）；V1 带旧编译器问题（§2）**不复用**；`prediction-agent-mind` 是 LLM 判例，开不开属决策：**未核** |
| 结算 | `pool-market-settler.js`（`index.js:734` 无开关，已用 `assertAddressOnNetwork`）、`pool-market-settler-v06.mjs`、`bshard-settle-daemon.mjs`（`SETTLE_DAEMON_ENABLED`:66、`ZK_CLOSE/CLAIM/HANDOFF/JUDGE_PROPOSE_TICK_ENABLED`:68,1059,1123,1147、`BSHARD_SETTLER_RELAY_ID`:48、`SETTLE_DAEMON_FEE_RELAY_ID`:61）、`bshard-auto-settler.mjs`、`settler-router.js`、`prediction-payout-gate.mjs`、`bettor-refund-claim-auto.mjs`（`BETTOR_REFUND_CLAIM_ENABLED`）、`tx-landed-reconciler.mjs` | **复用**（网络层已迁 `configuredNetwork`，读码 `bshard-settle-daemon.mjs:57`、`pool-market-settler.js:89`）；只剩 ZK 生成端 `zk-prove-worker.mjs:100`（§1 #3） |
| ZK 证明 | `zk-prove-worker.mjs`（`ZK_PROVE_WORKER_ENABLED`:119）、`zk-prove-server.mjs`、`lib/gate-tmpl-hash.mjs`、`lib/zk-close-builder.mjs` | **复用**；**外部进程（risc0 证明器）起不起、在哪：属 KANet-UI 运维侧，未核** |
| 链上读/IBD 门 | `rpc-health.js`、`preprune-capture-worker.mjs`（#7）、`spc-daa-index-monitor.mjs` | **复用**；#7 回退见 §1 |
| proto 线 | `proto-driver.mjs`、`proto-settlement-driver.mjs`、`proto-oracle-adapter.mjs`（`index.js:973-976`） | **不能用**：proto-v0 已作废（Owner 定性），GOAL.md 明令不得再碰；`lib/proto-*` 同理 |
| 其余 | broker-*、exchange-*、aave/aevo/hyperliquid、bsc/tron/sol、across、mind/agent/health 类约 150 项 | 与本线无关，**未逐个读** |

## 6. 给 Bettor 合成用：按「先后依赖」排的最小接线项（仅事实，不是设计）

1. §0-1 下注创世三个模板哈希未传（先确认真 throw，再决定从 env 取）—— **阻塞下注**。
2. ④ 的 `ZK_CLAIM_TMPL_HASH` 无非 proto 产出路径；`ZK_TOKEN_TMPL_HASH` 的 v1/v2 归属待定。
3. §1 A 类 4 处（#1 #2 #3 #4）与 B 类回退；#3 在开 ZK 证明器前必须先改；#4 在做 simnet 验前先改。
4. §2：OracleStake_v1 旧编译器 vs 主网 pin（押金地址/解锁），需 simnet 真共识验；V1 投票器不开。
5. §3：5 名委员 enroll（现成接口，前置 §1 #6 env=mainnet）。
6. 以上凡动字节/地址的项都是钱路 ⇒ 须 Bettor 审（铁律 0）、simnet 真共识验；用户面文案（§1 #13 #14）须 Owner 批。

## 7. 未核清单（汇总）
§0-1 是否真 throw；§1 #1 UI 是否走 freshBettor；#2 canonical 是否进 predicateCommit；#16 #17 默认形参的调用方；§2 market-setup 脚本/测试引用、`OracleStake_v1` 是否在迁移清单、pool-refund-builder/bshard-close-enforce 针对的市场家族；§3 `is_oracle` 写入点与两套登记的必要性、maker 质押常量位置；§4 `ZK_GATE_TMPL_HASH` 现值与 `ZK_GATE.gateTmplHash` 是否一致、canonical sample 目录是否在、token v1/v2、claim 是否逐市场；§5 demo 开关主网现值、PREDICTION_AGENT 取舍、证明器进程。
