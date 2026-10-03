# J2 交件：接通清单 A 组代码修补 + C 组查值 + B 组押金编译器核验（账本 (1813)）

分支 `coord/j2-pm-hookup-a-20261003`（独立 worktree `scratch/_j2_wt_pm_a`，node_modules 为真拷贝，无 junction）。**只合不部署**。
证据目录：`docs/provenance/2026-10-03-j2-pm-hookup-a-simnet/`（脚本 + 日志）。D-021：本件无地址余额/密钥值（simnet 地址为一次性）。

## 0. 结论速览
| 项 | 结果 |
|---|---|
| A1 下注注册补传三模板值 + 缺值 400 | ✅ 已改；单测 + 主网同款 kaspad 2.0.1 simnet 真共识「建盘→首注创世→第二注」通过（V1 与 V2/zkNative 各一遍） |
| A1 顺带发现并修的两个同族缺口 | 🔴 `ensurePayoutShardV2` 创世不写三列（NULL ⇒ zk_handoff 一致性门必拒）；`ensurePayoutShard`(V1) 不写 `market_suffix_hash` ⇒ K-18 coherence 步骤(c) 对每个 V1 市场必 FAIL。已改，见 §1 |
| A2 testnet-12 → `configuredNetwork()` | ✅ 9 处已改；**`api/relay.js:157` 未改**（M0a manifest 管辖，见 §2） |
| A3 WSL 指定发行版 | ✅ `-d ${ZK_PROVE_WSL_DISTRO \|\| 'Ubuntu-24.04'}` |
| A4（env，不改码） | 见 §3 |
| C 组三个值 | ✅ 现算出两个真值；MARKET_SUFFIX 给依据，见 §4 |
| B 组押金编译器 | 🔴 新编译器**编不出**旧脚本；旧脚本真共识可用；**但 relay 解锁手续费写死 100000 < v2.0.1 最低 175500 ⇒ 现状解不出来**，见 §5 |

## 1. A1 改了什么（`kasia-console/src`）
- `lib/pool-shard-register.mjs`：新增 `readZkTemplateHashes(env)` + `ZK_TEMPLATE_ENV_NAMES`——三个值（`ZK_TOKEN_TMPL_HASH / ZK_CLAIM_TMPL_HASH / ZK_MARKET_SUFFIX_HASH`）的**单一读取点**（缺→`missing`、非 32B hex→`malformed`，归一小写）。
- `lib/bshard-close-transport.mjs`（结算侧 `buildZkHandoffRequestV2`）：三处 env 检查 + 三处读取替换为同一个读取函数，未另写一套；`computeCloseZkTmplAnchor` 传入的也是它读出的值。
- `api/pool.js`：`_zkTemplateHashesOrReject(reply)`，缺/坏 ⇒ **付款/转账之前** `400 {error:'zk_template_env_missing', message, missing, malformed}`。接入点：单体 `register-v07`（pool_merkle_root 检查之后）、`_v07PrepConfirmPrelude`（prep 与 confirm 共用，所以付款前就拒）；两处 `registerBettorOnShard` 调用展开 `...zkTmpl`。
- `ensurePayoutShardV2`：创世时把 `token_tmpl_hash / claim_tmpl_hash / market_suffix_hash` 写入 `payout_shards`。**此前 INSERT 只有 9 列 ⇒ 三列为 NULL ⇒ `assertZkHandoffTmplCoherent`（`bshard-close-transport.mjs`）对任何 zkNative 市场 handoff 一律 throw「payout_shards.xxx 是 NULL」**。
- `ensurePayoutShard`(V1)：加 `marketSuffixHash` 形参并写入。**原因**：`lib/bshard-payout-family-coherence.mjs:180` 对 `v1_committee` 要求三列都是合法 hex，写入方不写 ⇒ K-18 gate（`buildProposeCloseRequestV2` 前置）对每个 V1 市场 FAIL。**这一条与原注释「market_suffix_hash 不再写入（K-18 谁编译谁 declare）」相左——是写入方与读取方（coherence）互相矛盾，我按读取方的硬要求补写，已把原注释改成指向新注记；若 Bettor 认为应改读取方，请划掉这一行，只回退 V1 INSERT 一处。**
- 不碰：`silverc` 死传参（`pool.js:1589/1856`）、V1 投票器等（非本次范围）。

验收（本机，KASPA_NETWORK 按各测试自设）：
- 新增 `src/api/pool-zk-template-env.test.mjs`：读取点四形；`register-v07` 缺 env ⇒ 400 `zk_template_env_missing`（点名三个 env）、env 齐 ⇒ 越过该闸（落到下一个 503「gateway relay not alive」）；prelude 接线 + 两个调用点展开；`ensurePayoutShard`/`V2` 三列写入、V2 行过 `assertZkHandoffTmplCoherent`；A2 主网取值（mainnet / 未设 throw / simnet）。**全绿**。
- 随改的既有测试：`bshard-close-transport-zk-tmpl-coherent.test.mjs`（接线断言的字符串锚点随代码改）、`preprune-capture-worker-ibd-gate.test.mjs`（夹具全是 testnet-12，原靠默认回退；现显式设 `KASPA_NETWORK`）。两者与 `bshard-close-transport-coherence-gate`、`preprune-capture-worker`、`closezk-v2-anchor-crosscheck` 复跑全绿。
- 对照：`admin-dedup / feedback / pool-bettor-refund-claim / proto` 四个 api 测试在**未改的基线上同样失败**（缺 env/DB_PATH 入口），与本次无关。
- lint-kanet：改动文件 0 error。

### simnet 真共识（主网同款 `D:\rusty-kaspa-v201\kaspad.exe` 2.0.1，sha256 8afe6a68…，`--simnet`，独立 appdir/端口 29617，已关；主网 4752 零触碰）
`provenance/…/driver.mjs`：直调生产 `registerBettorOnShard` + 生产 relay `unlock*`，env 取**生产读取点**。
- V1 committee 市场：PayoutShard 创世 `326461173d8c…7714:0`；bet1（ShardLeaf 创世 + 首笔 register_append）`4f3ba7f56b535b750323ef2baf057aa3370c673430456cbdf066a252c626b210`（count 1）；bet2 `9984e6a219a9f3604711d10347502823cdc5ea1844525e9b03f368896ff3a889`（count 2，pool 25000000）。
- V2 zkNative 市场：PayoutShardV2 创世 `432056c4698850052591a1b5ecf6a7509f9b069360a8da2c530494ade9add89f:0`；bet1 `b0d6d38f9d0d9732c0089a5457278973805af3319787e9f875048e47d6df2cc1`；bet2 `251dc44aa6ed380d90fa0dd54e493eed38427d3553c45c71c638f27a8f0b6e35`。
- 落库读回（`readback.log`）：V2 行三列 = token `225ebcde…` / claim `395949e1…` / suffix `0×64`，且 `assertZkHandoffTmplCoherent` PASS；V1 行 suffix 在本次 simnet 跑时仍是 NULL（那时 V1 补写还没改，是该跑法暴露的缺口；补写后的 V1 三列由单测覆盖，**未重跑 simnet**——只动 DB INSERT，不影响合约字节）。
- 节点原文：节点接受全部 tx（`registerBettorOnShard` 内部 `landed()` 逐笔确认 UTXO 落地才推进状态）；`getMempoolEntry` 对终态 leaf 返回「Transaction … not found」（已出块）。
- 如实：①「建盘」在 D-020 分片架构下 = `pool_markets` 行 + 首注创世，本验没走 `create-v07` 的 HTTP 路由（那条需 oracle 池 ≥5 的链上快照）；②`ZK_GATE_TMPL_HASH` 用测试值（只烤进 V2 的 closeZkTmplAnchor，本验不涉 zk_close）；③ 日志里 12 条 `mass-floor:observe` 是 relay 的观测式估算（上界 201768 克 ⇒ 要 20,176,800 sompi），实付 1,000,000 sompi 节点照收——估算偏保守，**真实 mass 未取得（交易已出块，无 mempool 条目）**，主网手续费余量仍应以 `getMempoolEntry` 权威值为准。

## 2. A2 改了什么（全部换 `lib/kaspa-network.mjs` 的 `configuredNetwork()`，未设即 throw）
| 位置 | 说明 |
|---|---|
| `api/pool.js:127` | `kaspa-onchain` 证据 URL 随网络：mainnet→`api.kaspa.org`，testnet-12→`api-tn12`，其它 throw（表同 relay `api.mjs`） |
| `api/pool.js:1141` | create-v07 自动派生 root 的 RPC networkId |
| `api/pool.js:1519` | register-v07 freshBettor 分支 |
| `api/oracle-pool.js` ×6 处（enroll / chain-snapshot ×3 / unlock） | 含押金地址 P2SH 推导，改前回退会把押金推向 kaspatest |
| `api/bettor.js:2069` | explorer 链接网络 |
| `services/zk-prove-worker.mjs` gate 地址 | **资金转出地址**，原写死 testnet-12 |
| `lib/bshard-close-transport.mjs:244` | K-18 门网络；原「非 mainnet 一律 testnet-12」，**simnet/devnet 验路会误 FAIL**，现 simnet 验路正常（本次 simnet 跑即走此路） |
| `services/preprune-capture-worker.mjs` IBD 门 | 未设 ⇒ 进 catch 返回 `rpc-fail`（fail-closed），不再默认当 testnet |
**未改**：`api/relay.js:157`（导入 relay 默认 `testnet-12`）——文件在 M0a manifest（`scripts/m0a-exception-manifest.json`，digest 失配）管辖，改动需 NWT 复审并更新 content_digest + 真实 review_ref，pre-commit 已拦下，我撤回了该改动，不自批。需要时请 Bettor 给 review_ref 或另派。`pool.js:3907` 刻意双网，未动。

## 3. A4（不改码，只写需求）
主网 console 需设 `SETTLE_DAEMON_CONSOLE_BASE=http://127.0.0.1:3202`：`services/bshard-settle-daemon.mjs:51` 默认 `http://127.0.0.1:3200`（已退役）。另：本次 A1 之后，主网要真正下注，需先设好 `ZK_TOKEN_TMPL_HASH / ZK_CLAIM_TMPL_HASH / ZK_MARKET_SUFFIX_HASH`（值见 §4），否则首注一律 400。

## 4. C 组查值
**`ZK_TOKEN_TMPL_HASH` = KanetTestToken v1 的模板哈希，不是 v2。**
依据：`registerBettorOnShard` 链（`pool-shard-register.mjs`）只 import `computeKttTokenArtifact`（v1），`grep computeKttV2 pool-shard-register.mjs` 为 0；ShardLeaf/PayoutShard 的 `tokenTmplHash` 钉的是 `register_append` 铸的押注 chip（v1 `sil-v1/KanetTestToken.sil`）。v2（`KanetTestTokenV2.sil`）是 D-035 钱包/面板用的另一个合约，与押注无关。simnet 真共识也是用 v1 值跑通的。
现算（主网 pin silverc v1.0.0，`tmpl_hashes.mjs`）：v1 = `225ebcdec51f5439326e6bc48e47c288ceacbd3bea07aea6771548eeed44d80e`（换 amount/owner 不变，是协议常量，与 `scripts/proto-v0-template-anchors.json` 一致）；v2 = `1913076b930a682efd88dff1982de61e7211da77b098bc6adffa05ba0780e883`（仅供对照）。

**`ZK_CLAIM_TMPL_HASH` 非 proto 路径能得出，且是协议常量**：`KanetTokenClaim.sil` 头注明写「无任何非状态 ctor 常量，模板对所有实例稳定」（v0.3 方案C，账本 1408）。用生产 helper `compileSilV100`（`lib/KanetTokenClaim.sil`）+ `extractTemplateArtifactV100`，换两组不同 ctor 编译出同一哈希：`395949e1b6079c79bc5c36565188fd67afca7b75fd37adf264bd44bdbefd21e1`（与 anchors.json 一致）。**缺的只是一个公开的、名字不带 proto 的现成函数**——现有等价物 `computeKanetTokenClaimGenesisArtifact`/`loadProtocolConstants` 在 `proto-covenant-builder.mjs`（proto 线，不得再碰）。需要自动化产出时，可参照 `provenance/…/tmpl_hashes.mjs`（15 行，只调用 `pool-bshard-artifacts.mjs`/`pool-template-artifact.mjs` 现成函数），不用新造算法。

**`ZK_MARKET_SUFFIX_HASH`：不影响任何合约字节，设什么都行，只要注册侧与结算侧一致。**
依据：账本 (1408)（撤销 H1(b)，代币不再认识市场）→ (1415)（5 个 .sil 的 `market_suffix_hash` ctor 参数 / ClaimState 字段 / 构造字面量一并删，`PayoutShard.sil:54`、`PayoutShardV2.sil:56`、`CloseZkV2.sil:28`、`RootClaim.sil:29` 现仅剩删除说明注释）→ (1458)（`compilePayoutShardV2Redeem` / `computeCloseZkTmplAnchor` 形参收窄，不再接收该值）。现在它只剩两个用途：`payout_shards.market_suffix_hash` 列的声明值，以及 `assertZkHandoffTmplCoherent` / coherence 步骤(c) 对「列非空 + 与 env 相等」的核对。
- **默认建议：设为任意固定 32 字节 hex（如 `0×64`，simnet 即这么跑通）**，零代码；
- **更干净的做法**是删这个检查链（`pool.js` `_resolveZkNativeCtorExtras` 与新增闸里的 suffix 项、`bshard-close-transport.mjs`、`bshard-payout-family-coherence.mjs:180`、`assertZkHandoffTmplCoherent` 的第三项），这属于设计取舍，超出 A 组授权，未做，等 Bettor/Owner 定。

## 4b. 本次未动的 ZK env
- `ZK_GATE_TMPL_HASH`、`ZK_CLOSEZK_SIL_PATH` 不在本任务内，未动；主网仍需设（路径即仓内 `lib/CloseZkV2.sil`）。

## 5. B 组：OracleStake_v1 押金地址，旧/新编译器
**一致性：无从比较——新编译器编不出该合约。** `compileSilV100(OracleStake_v1.sil)` 解析失败：`entrypoint function timeout_unlock(...)` 在 v1.0.0 语法下是 parse error（源码仍是 `pragma silverscript ^0.1.0` 旧语法，不在「主网集」）。旧编译器（`pool-p2sh.mjs` → `SILVERC_LEGACY_PATH`，2c46231）能编，同 ctor 输出 129 字节（`stake_cmp.mjs`）。后果：押金地址永远由旧二进制产生；只要 `silverc-legacy-2c46231.exe` 在位，登记侧、扫描侧、解锁侧三处一致；二进制丢了则全部算不出来。

**旧编译器产出的脚本在 2.0.1 真共识上的行为（simnet，`stake_simnet.mjs` / `stake_unlock2.mjs`）**
- 注资 2 KAS 进押金 P2SH ✅（`32190bc0…8857`，`d753d9f0…22d9`）。
- 反例：lockTime=0 解锁 ⇒ 节点拒（「failed to verify the signature script: Unsat…」，时间锁生效）✅。
- 正例（relay 现成函数 `unlockP2SH_SingleEntry`，即 `stake_unlock_tx` / `oracle-pool.js` timeout-unlock 所用）：**被拒**——`transaction has 100000 fees which is under the required amount of 175500`（mass 1755 × 100 sompi/克，v2.0.1 最低中继费）。函数里 `fee = kaspaToSompi('0.001')` 写死。
- 正例（我在 scratch 里用逐行同构的构造，只把手续费提到 300000）：**节点接受**，txId `5fda2912f8e0f2196ee5165462c7d6dfac6740a2d98b54fd8080c660ee76f166`，输出落地 ✅。⇒ 脚本本身可用，**问题只在手续费常量**。
- **后果（主网）：委员押金到期后，现有 relay 路径 `stake_unlock_tx` 解不出来**（每次都被最低中继费挡）。押金可在 `OracleStake_v1` 合约语义内用更高手续费手工解，但没有现成命令做。修法 = `kasia-relay/src/lib/p2sh.mjs` 的 `unlockP2SH_SingleEntry` 手续费改为按 mass 估算（同 `unlockKttV2Mint` 的 mass-aware 做法），属钱路改动，**未做**，需另批。合约允许的 fee 区间是 [1000, 1e8] sompi（`ORACLE_STAKE_FEE_MIN/MAX`），300000 在内。

## 7. 未覆盖 / 未核
- 没起真 console + 真 relay 子进程跑 HTTP→IPC 全链（同 KTT 先例的口径）；`register-v07/prep` `confirm` 的 400 靠 prelude 接线检查 + 单体路由实测，未单独发 HTTP 请求。
- `ZK_GATE_TMPL_HASH` 的真值与 imageId 配对未在本次核。
- V1 补写 `market_suffix_hash` 后未重跑 simnet（见 §1）。
- 主网真实最低费用对 6 笔创世/续笔 tx 的余量：未取得权威 mass。
