# J2 交件：预测市场 pool/ZK 全流程 simnet 彩排 + 主网 env 追加块（账本 (1826) 派工，清单 G/C/E/F）

分支 `coord/j2-pm-simnet-e2e-20261003`（基线 = `bshard-m3-deploy` @ e0e803d2，含 A 组 e715dc3b）。证据 `docs/provenance/2026-10-03-j2-pm-simnet-e2e/`。
**未改主网 env/代码、未碰主网钱、未重启主网**（主网 kaspad PID 4752、console PID 3436 全程未动；彩排进程已全部停掉并核过）。D-021：本件只含 simnet 数据，无主网地址/余额/密钥。

## 0. 先说结论（三条）

1. **🔴 全流程在「judge+propose 的 consolidate」处走不通，原因是结算侧没有随合约代币化（v0.3，账本 1188/1194）移植。** 下注一路是通的（建盘、6 委员池、两方下注全部生产代码真跑、真共识接受），但到截止后第一步 `consolidate` 就炸：`bshard insufficient input: Σin 70000000 < Σout 3020000000 + fee 3000000`。根因（读合约 + 读 relay 构造器逐条对）：合约入口已带代币参数（`ShardLeaf.consolidate_to_payout(psInIdx,psOutIdx,tok_prefix,tok_suffix)`、`PayoutShardV2.absorb(...tok_out,shard_amount,tok_prefix,tok_suffix)`、`zk_handoff(zkOutIdx,tokenInIdx,tokenOutIdx,tok_prefix,tok_suffix,模板A-D)`、`CloseZkV2.zk_close(...,tok_prefix,tok_suffix)`），而 `kasia-relay/src/lib/p2sh.mjs` 的结算侧构造器 `unlockBshardConsolidate[V2]`/`unlockBshardZkHandoff`/`unlockBshardZkClose`/`unlockCloseZkV2Claim` 全是 KAS 价值焊死的旧形、witness 不带代币参数（`grep tok_prefix|tok_out p2sh.mjs` 只命中 `unlockBshardRegister` 一处）。D-020 只改了「下注」，叶子 UTXO 的 KAS 侧只剩 0.2 KAS dust，池价值全在代币里。账本 (1486)「结算全链 8 步」是 proto-v0 的 RootClaim 线，不是 shard 线。
   ⇒ **主网此刻能建盘、能收注，但任何 zk_native 盘到期后无法 judge→propose→handoff→close→claim。** 我没有去补这个（≈6 个 relay 构造器 + JS 编排 + witness 重写，资金路径新功能，不在本单范围，须 Owner/NWT）。
2. **🔴 即便移植完成，主网 2.0.1 上 zk_close 也会被拒：`_ZK_GATE_COMPUTE_BUDGET = 1500` 不够。** 我用真 RISC0 Groth16 receipt（canonical sample，imageId c9918501…ce30）在**同一 kaspad 2.0.1 二进制**（sha256 8afe6a68…）的 simnet 上真花 gate：budget=1500 被节点拒 `script units exceeded the amount committed in the input: used=15502875, limit=15009999`；budget=1552 被接受（txid `cd89a0db4f9b6a3f7393929eac8643f4f2e6919a44488aa4af8a7338e7f7e1cc`）。最小 budget = 1551。这个常量是 TN12 实测值，对官方 2.0.1 偏小。
3. **🔴 本机现在出不了 Groth16 证明：WSL Ubuntu-24.04 没有 docker。** 生产 host 一进 `prove_with_opts(ProverOpts::groth16())` 即 `panicked at host/src/main.rs:82: called Result::unwrap() on an Err value: Please install docker first.`；Windows 侧 Docker Desktop 已装但服务/进程都没起、该发行版未启用集成。⇒ `ZK_PROVE_WORKER_ENABLED=1` 在主网开了也只会 `RISC0 proving fail`。（STARK 阶段约 1 分钟、r0vm 峰值 RSS ≥4.4 GB、nice 19 下仍吃满 16 核；同一 WSL 里 vLLM/avatarforcing 占 ~7.5 GB——起证明器时内存是真风险。）我没有去启 Docker Desktop（动整机服务，须 KANet-UI/Owner）。

已完成且可交付的：ZK_GATE_TMPL_HASH 算出并自证（§1）、env 追加块草稿（§1）、F 组逐问答案（§3，每条标 实验/读码/未验）、6 池抽 5 的选人逻辑（§4）、发现清单（§5）。

## 1. 主网 env 追加块草稿（只写在报件里，未应用）

### 1.1 `ZK_GATE_TMPL_HASH = 4ec7ca3d46db552d87f90636ebefe681f9995249423d52ac30b8c7f258043ac7`
- 输入只有两样：**imageId** `c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30`（= `zk-close-builder.mjs ZK_GATE.imageId` = `zk-payout-guest/TOOLCHAIN.lock.json canonical_image_id` = canonical sample 的 `image_id`，三处核过相等）+ canonical sample（`zk-payout-guest/proofs/3o6cs-attest-0a358fa0/`，gate suffix 只依赖 imageId，设计见 `gate-tmpl-hash.mjs` 头注）。算法 = `computeGateTmplHash`（`blake2b(0x20 ‖ 800B suffix)`）。
- **我又独立重编了一遍 guest**：在 worktree 副本树 `nice 19 / jobs 2` 重编，`scripts/verify-image-id.sh` 输出 `got = want = c9918501…ce30`、`IMAGE_ID OK`，`payout.bin` 366748 B sha256 `885c6fca…` 与 TOOLCHAIN.lock 一致（日志 `zk_build.log`）。⇒ 与 KANet-UI 的复现互为第二份证据。
- 复现命令（任一机器，需 ZKSDK wasm 在 `D:/rusty-kaspa-zksdk-isolated/...`，DB_PATH 指向任意临时库）：
  `cd kasia-console && DB_PATH=<tmp.db> KASPA_NETWORK=mainnet CONSOLE_ENCRYPTION_KEY=<64hex> node src/lib/gate-tmpl-hash.selftest.mjs`（6 项断言全绿，含「现场推导 == 烤死值」「两条切法一致」「跨源漂移 fail-loud」）；或 `docs/provenance/2026-10-03-j2-pm-simnet-e2e/print_gate_hash.mjs`（输出 JSON，`equal: true`，见 `print_gate_hash.log`）。
- 注意：该值**必须与 `ZK_GATE.gateTmplHash` 字节相等**，否则 `ensureGateTmplHashFresh` 在 zkNative 创世处 fail-loud（`gateTmplHash 跨源漂移`）。imageId 一变（重编 guest）必须同时改这两处。

### 1.2 其余四个值
```
ZK_TOKEN_TMPL_HASH=225ebcdec51f5439326e6bc48e47c288ceacbd3bea07aea6771548eeed44d80e   # KanetTestToken v1（A 组已定；v2=1913076b…仅比对用，别填）
ZK_CLAIM_TMPL_HASH=395949e1b6079c79bc5c36565188fd67afca7b75fd37adf264bd44bdbefd21e1   # KanetTokenClaim（协议常量）
ZK_MARKET_SUFFIX_HASH=153e039542278c14c55d655e880bc2e90823b9352cb20ac7486523a4a029ebbf
ZK_CLOSEZK_SIL_PATH=D:/kanet-tn12/kasia-console/src/lib/CloseZkV2.sil                  # 生产检出内的路径
```
- **SUFFIX 选值**：`sha256("kanet-zk-market-suffix-hash:unused-since-ledger-1415")`（复现：`printf 'kanet-zk-market-suffix-hash:unused-since-ledger-1415' | sha256sum`）。理由：①该字段账本 1408/1415/1458 起已不进任何 ctor，只作 `payout_shards.market_suffix_hash` 记账和 `assertZkHandoffTmplCoherent`/K-18 步骤 (c) 的相等比对，所以值本身无语义；②选**非全零**、自描述的常量，避免「全零 = 没配」的人眼混淆；③🔴 **一旦有市场建盘就不能再改**：行里存的是建盘时的值，handoff 时拿当前 env 比，改了就 `assertZkHandoffTmplCoherent` 拒；TOKEN/CLAIM 同理（这三个 env 一经首个市场落库即冻结）。simnet 彩排里我用的是全零，两者对生产读取点 `readZkTemplateHashes` 都过（只验 32B hex）。
- `ZK_CLOSEZK_SIL_PATH` 注意是**主网生产检出**里的路径（我彩排用的是 worktree 路径）。

### 1.3 settler / fee relay 候选（排除 broker/proto/KTT/escrow/委员钱包）
主网 `relay_nodes`（只读查名字/角色，未取地址）：stress-user-01~08、stress-control-01(=SERVICE_ESCROW)、J2、KANet-UI(=KTT 面板)、Trader-A(role=broker)、Qclaude、Trader-M、Bettor、NWT、proto-v0-funds(=PROTO_RELAY_ID)、oracle-mn-01~06。
- **推荐：新建一个专用 relay（如 `pm-settler`），`BSHARD_SETTLER_RELAY_ID` 与 `SETTLE_DAEMON_FEE_RELAY_ID` 填同一个 id**（同钱包的理由见 §3 F3）。理由：现有 relay 个个已有职能——KANet-UI 是 KTT 面板钱包、proto-v0-funds 属已作废 proto 线、Trader-A 是 broker、stress-* 是压测、oracle-mn-* 是委员（委员不得兼 settler，且 `is_oracle=1` 的 relay 受 broker/oracle 互斥约束）；结算钱包要放流动资金并被守护进程自动花，必须职能单一、可单独限额（它也计入 `RELAY_HOTWALLET_*` 800/1000 的总额）。
- 次选（不想新建钱包时）：Bettor（role=predictor）。不选 J2/NWT/Qclaude（人的工作钱包），不选 KANet-UI（KTT 面板）。
- 其余 relay 角色（maker/gateway）不在本单；注意 gateway = maker relay 会代管下注者的 KAS 本金（见 §5 发现 9）。
- `SETTLE_DAEMON_CONSOLE_BASE=http://127.0.0.1:3202`。

### 1.4 E 组开关（依赖链取值）——**全部「待结算侧移植 + 通过 §6 门槛后再开」，现在一个都不要开**
依赖链 `JUDGE_PROPOSE → VOTER_V2 → SUBMIT_V2 → HANDOFF → PROVE_WORKER → CLOSE_TICK_V2 → CLAIM`，每一格只在上游状态存在时才有活干，所以**按链顺序逐个开、每开一个重启一次并看一轮日志**（开关=配置变更，走重启窗 + 记账）：
```
ZK_JUDGE_PROPOSE_TICK_ENABLED=1      # 1 判定+提案（需 FEE relay 可用：链上读 chain_get_block_at_daa）
BSHARD_CLOSE_VOTER_V2_ENABLED=1      # 2 委员签 close_attest（前置：6 个 oracle-mn 的 is_oracle=1）
BSHARD_CLOSE_SUBMIT_V2_ENABLED=1     # 3 收签名并广播 close_attest
ZK_HANDOFF_TICK_ENABLED=1            # 4 门① 转 CloseZkV2
ZK_PROVE_WORKER_ENABLED=1            # 5 出证（前置：docker 就绪，见结论 3；每盘注资 gate ≈1 KAS 默认）
ZK_CLOSE_TICK_V2_ENABLED=1           # 6 zk_close（前置：computeBudget 修到 ≥1552）
ZK_CLAIM_TICK_ENABLED=1              # 7 领奖（前置：FEE=settler 同钱包 + transfer 带 admin 头，见 F3）
# 保持不设/为 0：SETTLE_DAEMON_ENABLED（V1 委员签名老路）、BSHARD_CLOSE_VOTER_ENABLED（V1 投票器，旧编译器重算 PoolSide 与新市场不一致）、ZK_CLOSE_TICK_ENABLED（旧骨架）、POOL_SEEDER_ENABLED、DEMO_*、PREDICTION_AGENT_ENABLED
# 可选：各 *_TICK_MS 默认 30000 够用；彩排里我设 10000 只为快
```
- 判定类型建议首盘用 `judge_type=blockhash_parity`（纯链上、不依赖外网；彩排里 judge + endBlockHash 两步都走通，炸在后面的 consolidate）；polymarket 源需主网能出 Polygon RPC。
- `KANET_TESTNET_NO_LIMITS` 必须保持不设（主网 env 里本来就没有）。

## 2. 彩排实况（simnet，生产 console + 11 个真 relay 子进程；每步 txid + 节点原文）

环境：官方 kaspad 2.0.1（`D:\rusty-kaspa-v201\kaspad.exe`，sha256 前缀 8afe6a68，与主网同一个二进制）`--simnet --utxoindex --unsaferpc`，独立 appdir/端口（wRPC 29717/gRPC 18412/p2p 18411，不碰主网 17110）；3 个挖矿循环（币付我的银行密钥）把 DAA 速率顶到 ≈8.5/s 以贴近服务端「100ms/DAA」假设。生产 console（worktree 代码，`:3299`，库独立）+ `createRelayNode` 建 11 个 simnet relay（maker/settler/fee/bettorA/bettorB/oracle-1~6）。起 console 的 env = `env.simnet.template`（照主网 env 结构：关全部自动/演示类，ZK 五值，上面 §1.4 的 7 个开关全开且 tick 10s）。

| 步 | 动作（生产入口） | 结果 | txid / 节点原文 |
|---|---|---|---|
| 1 | 6 委员 `POST /api/oracle-pool/enroll`（`signing_relay_id` 上链 envelope，每人 2 段）+ 押金 1.05 KAS 转质押 P2SH + 生产 scanner | ✅ 池 6 人 | 押金 `ca1227ec…9a01`(o1) `e2801a59…2390`(o2) `8968abfb…ee7e`(o3) `28574391…3c58`(o4) `75a69e15…3128`(o5) `c666b164…ccea`(o6)；envelope 如 `79578b54…73bc`/`b22dc76d…d686`(o1)，其余见 `s1_committee.log`；`chain-snapshot`: `poolSize:6 scanned:6 valid:6 rejected:0` |
| 2 | `POST /api/pool/market/create-v07`（zk_native 默认，`judge_type=blockhash_parity`，maker 质押 130 KAS，`pool_merkle_root:auto`） | ✅ 3 秒 | market `ext-pool-v07-1791046984583-04gyh`，spine_lock_tx `51ba655c6abf025ce8eb1d7bc449817312ddc85d98a12b1f98419dd6b20ae6c1`。首次试 maker 100 KAS 被拒：`maker_stake_kas 100 < min spendable 125 KAS`（公式 `ceil(12500/oracle_fee_pct)`，oracle_fee 默认 100bps ⇒ 125；调大 oracle_fee_pct 可降，但 ≥100 的政策下限仍在） |
| 3 | bettorA 10 KAS→YES，bettorB 20 KAS→NO，`POST …/bettor/register-v07` | ✅ 34 s / 23 s（含 PayoutShardV2 创世、ShardLeaf 创世、stake chip 铸造、register_append） | leaf `6da731493c779b45110b4a853fef9cbe3ad87d491416d5eba63a0177563366ce`、`858083e04c2ccedd5bbe604dbfa930050086a13d17d38bdc32921b5d30952f7b`；payoutCovId `8234a2c4…5117`。**A 组补的三模板 env 在真路由上生效**（无 env 时是 400，上次已单测） |
| 4 | `ZK_JUDGE_PROPOSE_TICK`：判定（blockhash_parity）→ endBlockHash → `buildProposeCloseRequestV2` | ❌ 前两步过，卡在 consolidate | 事件 `zkJudgeProposeTick_propose_error` @17:05:34：`consolidate shard 0 no land: {"error":"bshard insufficient input: Σin 70000000 < Σout 3020000000 + fee 3000000","phase":"execution"}`（`evidence_snapshot.json`） |
| 5+ | 委员签 / handoff / 证明 / zk_close / claim | **未验**（被 4 阻断） | 见 §3 隔离实验 |

**阻断点的链上事实**：叶子 UTXO 实际只有 0.2 KAS（`leaf 858083e04c:0=0.2KAS`，`payout shard d191a4e013:0=0.2KAS`），`current_leaf_state.pool_value=3000000000` 全是代币记账；`bshard_consolidate` 构造的 PS 续约输出 = `consolidated_pool(30 KAS)+0.2`，输入只有 0.2+0.2+0.3(fee)=0.7 ⇒ 预检就拒（没到共识）。即使绕过预检，合约入口要的 `tok_prefix/tok_suffix` witness 构造器也不会推（arity 2≠4）。
**附带观察（余额）**：两注的 KAS 本金（10+20）留在 gateway(maker relay) 钱包里没有进任何合约；maker 钱包 400→302.2（−130 质押 −约 1.8 建盘/下注基础设施费 +34.06 收到的下注款）。settler 只因那次失败的 propose 少了 0.032 KAS（自转 fee 的手续费）。`balances_after_bets.json` / `balances_final.json`。

## 3. F 组逐问答案

**F1 settler 做 handoff 要多少流动余额？**
- 现 builder（读码，`bshard-close-transport.mjs:588-596`）：handoff 前先 `transferAndConfirm(settler → settler 自己, 数额 == state.consolidatedPool, minDepth=20)`，把这笔当 fee 输入（`unlockBshardZkHandoff` 要求 `fee value == consolidated_pool`，PS 输出无余付空间）。⇒ **settler 需要可一次转出 ≥ 该盘 consolidated_pool(KAS 计) + ~0.02 KAS 的余额**，池越大越多（彩排盘 30 KAS 名义）。
- 但这个 builder 与代币化的 `PayoutShardV2.zk_handoff` 合约**已不兼容**（合约要 `tokenInIdx/tokenOutIdx/tok_*`，KAS 侧只要 ≥dust）。移植后真实需求预计降到「dust + 手续费」量级，但由移植设计决定 ⇒ **无法实测，标：未验**。
- 其它每盘固定占用（读码）：gate 注资默认 `ZK_GATE_FUND_SOMPI=1 KAS`（见 F2）；consolidate 每片 0.3 KAS 自转 fee（找零回 settler）；close_attest/claim 各 0.01~0.02 KAS 量级手续费。

**F2 zk_close 是否把整个 gate 余额烧作矿工费？每盘成本？**
- **是（读码 + 实验互证）。** `zk-close-dispatch.mjs:109` 发 `outputs: {}`（无 `change_address`）→ `unlockBshardZkClose` 的 `_appendChange` 不产生找零 → 输入(CloseZk 池价值 + gate 价值)里没出现在输出的部分全进手续费 ⇒ **实际手续费 = 整个 gate UTXO 价值（默认 1 KAS）**，声明的 `_bshardFeeV1(2)=0.02 KAS` 只是它的下限。
- 实验给了这笔费的真实底线：gate-only 花费在 budget 1552 下节点要求 **≥15,672,600 sompi（0.1567 KAS，compute mass 156,726）**；budget 1560 要求 15,752,600（mass 157,526）。再加 CloseZk 输入的质量会更高 ⇒ **gate 注资低于 ≈0.2 KAS 的话 zk_close 会因费不足被拒**，所以「烧」既是浪费也是现状下唯一让它过的余量。
- **每盘成本（现行为）≈ 1 KAS（gate 全烧）+ 零碎手续费 ≈ 1.1~1.2 KAS**；优化后（gate 注资 ≈0.3 KAS + 显式 fee 或给 change）≈ 0.2~0.3 KAS。这是建议，不在本单改。
- 同时必须修：`_ZK_GATE_COMPUTE_BUDGET 1500 → ≥1552`（结论 2）。

**F3 FEE relay 与 settler 是否须同钱包？**
- **是，至少 claim 路径必须同钱包（读码）。** `claimAutonomousTick` 用 `mintFeeUtxo`（`bshard-settle-daemon.mjs:109-116`）从 **FEE relay** 自转 0.3 KAS 造 fee UTXO，`cmd.inputs.fee.address = feeUtxo.address`（FEE relay 地址）、`changeAddress` 也是它，但 `relayCall` 发给 **settler relay**（`:1090-1098`），`unlockCloseZkV2Claim` 用 `wallet.getPrivateKey()`（= 执行命令的 settler 密钥）签 fee 输入（`p2sh.mjs` claim 段 `createInputSignature(unsigned, 1, wallet.getPrivateKey())`）。fee UTXO 的 P2PK 属于 FEE relay ⇒ settler 的签名过不了。⇒ **两个 id 填同一个 relay**，或改 claim 用 settler 自己的 fee UTXO。
- handoff/close/propose 不用 FEE relay 当钱包（fee 由 settler 自己造）；FEE relay 在 propose 里只当**链读取器**（`chain_get_current_daa_score`/`chain_get_block_at_daa`，任何在线 relay 都行）。
- **另有一个独立的硬坑（实验验证）**：`mintFeeUtxo` 走 `POST /api/relay/:id/transfer`，**不带 `x-kanet-admin-secret`**；主网 env 设了 `ADMIN_SECRET_FUNDS` ⇒ 403。我在彩排 console 上设了同类 secret，用与 `apiTransfer` 完全同形的请求复现：`{"error":"admin auth fail (x-kanet-admin-secret 缺失/不匹配, tier=ADMIN_SECRET_FUNDS)"} HTTP 403`（`fee_transfer_no_header.log`）。⇒ claim 路径在主网必败，除非守护进程改为带头或走 `sendCommandAsync` 内部来源。

## 4. is_oracle=1 置位后的选人（生产函数在真实 6 人池 + 真实 market 行上跑，`voter_selection.log`）

- 池 6 人、委员会 5 人。`excludePks = [maker_pk, broker_pk, …全部下注者 pk]`（`bshard-auto-settler.mjs:98/763` 口径；`pool-committee-sampler.mjs` 过滤后须 ≥5）。
  - 真实盘（maker=broker，两注者都不在池）：OK，5 人。
  - maker 恰在池内（排除 1 个）：OK，5 人。
  - **maker 与 broker 是池内两个不同委员 / maker 在池 + 1 个注者在池（排除 2 个）：`THROW pool must have >= 5 members after excludePks filter (got 4)` ⇒ 该盘永远抽不出委员、结算卡死。** ⇒ **运维规则：6 个 oracle-mn 钱包不得同时充当 maker、broker 或下注者（最多容一个）**；`register-v07` 已对「下注者 ∈ 该盘 oracle 集」回 403，但 maker/broker 没有等价闸（建议在 create-v07 对 maker_pk/broker_pk ∈ 池 的情形 fail-fast）。
  - 500 次随机 seed 抽样，每委员入选 401~433 次（期望 83%），无偏。
- 本机 voter 侧：`bshardCloseVoterV2Tick` 对 `is_oracle=1` 的本机 relay 逐个判「自己 pk ∈ committee_pks」才签；6 个 oracle 全在本机且全 `is_oracle=1`，所以 5 人委员会全能签（达到 ≥4 的法定数）。彩排里该 tick 每 30s 空转 `0 pending`——因 propose 没成功，**真正签名这一步未验**。
- **置位副作用已观察**：`is_oracle=1` 同时会唤醒老的 `prediction-voter` cron（`index.js:718`，无开关）。6 个 voter、1 个有注的 zk_native 盘、3 个 tick：`1V1 voted=0 | pool voted=0 skipped=0 errored=0`，无任何动作（`prediction_voter_lines.log`）。主网置位前后预期同样安静，但这是一个**不受开关控制**的新消费者，值得 KANet-UI 置位后盯一两轮日志。

## 5. 发现清单

| # | 严重度 | 位置 | 事实 | 建议 / 谁 |
|---|---|---|---|---|
| 1 | 🔴 阻断 | `p2sh.mjs` 结算侧构造器 vs 合约 | 见结论 1：consolidate/absorb/handoff/close/claim 的 witness 与价值逻辑都是代币化之前的 | 立项移植（先 consolidate+absorb，再 handoff/close/claim）；Owner 拍、NWT 审、simnet 真共识验；移植前主网别开放新盘（§6） |
| 2 | 🔴 | `p2sh.mjs _ZK_GATE_COMPUTE_BUDGET=1500` | 2.0.1 上 groth16 需 ≥1551 | 改 1600 量级常量（钱路，须审） |
| 3 | 🔴 | WSL Ubuntu-24.04 无 docker | groth16 出证不可用 | KANet-UI：起 Docker Desktop 并启用该发行版集成（或发行版内装 docker），注意内存；起证明器前先看 `free`（同 WSL 有数字人 ~7.5 GB） |
| 4 | 🔴 | `bshard-settle-daemon.mjs apiTransfer`（`mintFeeUtxo`） | 不带 admin 头，主网 `ADMIN_SECRET_FUNDS` 已设 ⇒ 403 | 守护进程改带头/内部通道；或 claim 不用 mintFeeUtxo |
| 5 | 🟠 | FEE relay ≠ settler | claim 的 fee 输入签名不过 | 两 id 填同一 relay（§1.3） |
| 6 | 🟠 | `zk-close-dispatch.mjs:109` | zk_close 无找零，gate 全烧（≈1 KAS/盘） | 显式 fee + 小 gate 或加 change_address |
| 7 | 🟠 | `bshard-settle-daemon.mjs:106/387` `_p2pkAddrSync` | `NetworkType.Testnet` 写死 ⇒ 主网/simnet 给出 `kaspatest:` 前缀（实测 `p2pk_prefix_check.log`：同一 pk 在 Testnet 得 `kaspatest:qr7k…`、Mainnet 得 `kaspa:qr7k…`）。claim 里 `bettorAddress` 来自它；P2PK 脚本字节与网络无关，所以也许能过，但会撞 relay 侧 `assertAddressOnNetwork` 之类的闸（**未验**，claim 被阻断） | 换 `configuredNetwork()` 映射；lint R-NET 系列应能抓 |
| 8 | 🟠 | `maker/broker ∈ 池` | 池仅 6 人，超 1 个被排除即无法抽委员（§4） | create-v07 fail-fast + 运维规则 |
| 9 | 🟠 经济 | register-v07 / gateway 托管 | 下注者的 KAS 本金进 gateway(maker relay) 钱包，合约里只有 0.2 KAS dust；价值载体是免费铸造的 KCC-20 代币（D-017）。有人建盘时 maker 要锁真 KAS ≥100~125 | 属设计事实非 bug，但 Owner 在开放主网新盘前应知道「本金不在合约里」 |
| 10 | 🟡 | `kasia-relay/src/lib/api.mjs` | `getApi(network)` 在 `transaction.mjs:154` 只构造、结果从不使用，simnet/devnet 下因表里没条目直接 throw `Unknown network "simnet"`（主网无影响）。彩排用一行 harness 补丁绕过，**未提交**（`harness-relay-api-simnet.patch`） | 死调用可删（非资金路径变更，可并入下次） |
| 11 | 🟡 | `api/relay.js` import-privkey | 非 mainnet 一律 `NetworkType.Testnet` ⇒ simnet relay 地址是 kaspatest（彩排因此直接用 `createRelayNode` 建 relay）；与已知票 relay.js:157 同族（M0a 管） | 已有票 |
| 12 | 🟡 | `create-v07` 的 `_deadline_daa` | `currentDaa + (deadline-now)/100ms`，即假设 10 DAA/s。主网 10bps 成立；仅提醒 simnet/低速网会错位 | 无需动 |
| 13 | 🟡 | `maker_stake` 下限 | `max(100 政策, ceil(12500/oracle_fee_bps))`：默认 100bps ⇒ 125 KAS | 开盘手册写明 |

## 6. 需拍板（我按默认处理的 + 需要 Owner/Bettor 的）

按默认继续的：env 值与候选 relay 按上写；彩排盘判定型选 blockhash_parity；不去修任何资金路径代码。
**请 Bettor/Owner 拍：**
1. **结算侧代币化移植立项与否、谁做、顺序**（建议 consolidate+absorb → zk_handoff → zk_close → claim，各自 simnet 真共识验 + NWT 红队；同时带上 #2 #4 #5 #6 #7 的修）。
2. **移植完成前，主网是否对外开放新盘/下注**。我的判断：下注能进、结算出不来；下注侧只落免费代币记账 + gateway 里的 KAS 本金，真正有风险的是 maker 锁的 ≥100 KAS（spine `settle_aggregate` 要 5 个委员签名里≥4 个；`refund_maker_unjoined` 只对「没人下注」的盘开）——**有人下注后 maker 质押的出口我没验**（标 未验，需要读 PoolSpine_v07 + 跑一遍）。在移植前建议只由 Owner 点名建盘，或在 create-v07 前加闸。
3. Docker/证明器就绪由 KANet-UI 排期（影响 E 组第 5 格）。

## 7. 复现与文件

`docs/provenance/2026-10-03-j2-pm-simnet-e2e/`：`env.simnet.template`、`setup.mjs`/`fund.mjs`（建 relay/注资）、`start_console.sh`/`stop_console.ps1`、`s1_committee.mjs`/`s2_create.mjs`/`s3_bets.mjs`（+ `.log`）、`set_oracle.mjs`（备份后只改 6 行）、`voter_selection.mjs`(+log)、`gate_spend.mjs`（+ `…budget1500_REJECTED.log` / `…budget1552.log`；`…feeparse_miss.log` 两份是我正则没解出 required 的失败重跑，原样留存）、`print_gate_hash.mjs`(+log)、`zk_build.sh`/`zk_build.log`、`zk_prove.sh`/`zk_proof_out/prove.log`（docker panic 原文）/`memwatch.log`、`fee_transfer_no_header.log`、`p2pk_prefix_check.log`、`evidence_snapshot.json`（无私钥）、`balances_*.json`、`console_zk_lines.log`、`harness-relay-api-simnet.patch`、`miner.mjs`/`utxo.mjs`/`q.mjs` 等小工具。银行/relay 私钥只在 `scratch/_j2_pm_e2e_sim/`（gitignored，simnet 无价值）。

**未验清单**：委员真签名（被阻断）、handoff/证明/zk_close/claim 的端到端、maker 质押在有注后的出口、claim 里 `kaspatest:` 前缀是否被拒、移植后 settler 真实流动余额、Groth16 实际出证耗时与内存（docker 缺）。
