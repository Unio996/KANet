# M-1.1 全命令能力/效果清单 v0.7（J2 主笔，J1 域视角复核已并入）

> **Status**: v0.7（2026-07-31 · J2）· **v0.7 = 新增 §2.5 三条边界实况**（redeem 建盘时存库/结算不编译 · 该 hex 零完整性校验 · branch→entrypoint 映射不确定 · 传输边界 = 进程内存边界）。只记实况,不下风险判断。
> **Status(v0.6)**: v0.6（2026-07-30 · J2）· **v0.6 = 新增 §2.3（交付③ 三态资格：retire 属生命周期轴，当前空集，写死 M0b 落地为其生效条件）**
> **Status(v0.5)**: v0.5（2026-07-30 · J2）· **待 @NWT 红队**（v0.4/v0.5 的改动尚未被红队过）
> **v0.5 修订记录**（相对已推的 v0.4 = commit `d029d166`）：**补齐 13 条从未被逐条列名的命令**，新增 §2.2。
> - 触发：拿**代码**（`kasia-relay/src/lib/commands.mjs` 的 `COMMAND_PAYLOAD_SCHEMA`）与本卡逐条比对 ⇒ 51 条里 **11 条在任何文档里都没有名字**，其中 **8 条是类 B 盲签**（D2 只写了「PREDICTION_SETTLE_TX 等 9 条」，其余 8 条只以数量存在）。补写时重跑断言，又发现 **2 条类 A** 亦从未列名 ⇒ 合计 13 条。
> - §2.2.1 写死**可推翻的穷尽性断言**（代码 51 / 覆盖 51 / 差 0）+ 取数命令 + 阳性对照。
> - §2.2.5 一并处置原「4 条重复计数」：**本卡为唯一活清单**，D2 那份 A/B/C 分类已被 v1.2 取代（实测：v1.2 里相关命令名命中皆 0），是历史来源而非平级清单。
> - 🔴 §2.2.6 标死证据强度：读的是 **payload schema + 源码注释**，**未逐条读 relay handler 函数体** ⇒ 「收款与输出约束」「幂等键」两列是从载荷字段推的，可能低估 handler 内部校验。
> - 🔵 §2.2.4 记了一格方法：那条「差=0」的断言**我写进文档后第一次跑就是假的（差=2）** ⇒ 判据：**把可推翻的断言写进交付物之后，第一件事是自己去推翻它一次。**
> **v0.4 修订记录**（2026-07-30 · 触发 = J2 对 M-1 DoD 五条逐条验收，结果 1 满足 / 4 不满足；Bettor 10:08 派工）：
> - **只改了一件事**：§2 表里 5 条 `submit` 命令的「是否可进公开应用契约」由 **是 → 否**（`SEND_MESSAGE`/`SEND_BROADCAST`/`PUBLISH_CARD`/`SPLIT_UTXO`/`CONSOLIDATE_UTXO`），依据 = DoD「无 verifier 的默认 internal」。新增 **§2.1** 写明依据、逐条对照表、两条具体风险、以及**本次不做什么**。
> - 🔴 **本版没有解决的 DoD 缺口（原样留着，不假装闭合）**：① 互斥性——`CHAIN_GET_*×3` 与 `GET_ADDRESS_UTXOS` 同时被 D2 类 A（6 条）与本卡 §2（16 条通用原语）各计一次 = **4 条重复计数**；② 14 列里**没有「经济效果 verifier」这一列**；⑤ **本清单本身从未被 NWT 红队过**（已有红队稿是 M-1.2 与 M-1.6，不是本卡）。
> - **v0.3 及更早的正文一字未动**，本版是**增量**：改 5 个单元格 + 新增 §2.1 + 本修订记录。

> **Status(v0.3 原文保留)**: v0.3（2026-07-22 · J2）
> **v0.3 修订记录**：并入 J1 covenant 域复核（`docs/2026-07-22-j1-covenant-domain-review-m1-1-m1-2.md`，J2 已独立交叉核 file:line——ShardLeaf.sil:61/PoolRoot.sil:54-65,92-114/p2sh.mjs:2667-2718,42-74 逐处实读吻合）：待办①坐实为真缺口（`BSHARD_REGISTER_BET` 无金额上限=TRANSFER 反模式第 6 例）；待办②③为 v0.1 误判、本版订正（claim_winner/close_commit 的终局/深度门在 covenant 层俱在，v0.1 只读 JS 包装层未进 .sil 就下"无检查"结论）。**方法论教训入档：判断"有没有检查"必须看强制执行层（covenant），不能只看请求发起层（relay JS）——JS 层没查 ≠ 系统没查。**
> **依据**：`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md` §D2 + M-1 §3（14 列定义原文）+ Owner 令："D2 号称穷尽却排除 16 条通用原语于分类外，是在自己身上违反 M1 互斥且穷尽"——本清单覆盖全部 ~50 条命令，不分类外。
> **列定义**（原文）：命令 / 效果类（read·derive·build·sign·submit·transfer·wallet-admin·state-mutate）/ 所用密钥与钱包 / 允许资产与网络 / 允许市场-家族-分支 / 输入 outpoint 范围 / 收款与输出约束 / 金额-费率上限 / 幂等键 / 所需证据与终局性 / 调用方能力 / 审计回执 / 吊销机制 / 是否可进公开应用契约。
> **本卡性质**：M-1 只读取证 + 文档，不改一行执行代码。诚实标注：多数行的"调用方能力/审计回执/吊销机制"三列现状全部是"无"（这正是 M0c 要建的东西，不是本清单漏填）。

---

## 0. 已并入的既有坐实证据（不重复劳动，指针引用）

- **类 A（6 条，纯计算/只读）+ 类 B（9 条，盲签）四层表**：`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md` §D2 附（J2 主核 + KANet-UI 复核，NWT 审过）。
- **custodial_transfer（relay.mjs:478-490）+ prediction_settle_tx（relay.mjs:734-758）完整参数面**：MF2/MF3 坐实证据，同上文档 §D2 类 B 段落。
- 本卡**新增覆盖范围**：类 C 全部 20 条（BSHARD_*/CLOSEZK_V2_*）+ 16 条"通用原语"里类 A/B 尚未逐条列出的部分（下方 §2 补齐）。

---

## 1. 类 C：relay 内建 covenant 编译器（20 条，本卡核心新增）

**共性列（20 条全部相同，先说一次不逐行重复）**：
- **效果类**：`sign·submit·state-mutate`（全部构造具体 covenant continuation 并广播）。
- **所用密钥与钱包**：relay 自己的 wallet（`getWallet()`），非调用方传入私钥——跟类 B（custodial_transfer/盲签 9 条）性质不同，这 20 条 relay 用**自己的**签名密钥，只是签的内容由 witness/inputs/outputs 参数决定。
- **允许资产与网络**：KAS，`wallet.getNetworkId()`（testnet-12，无跨网络参数，硬编码进 relay 启动配置）。
- **调用方能力 / 审计回执 / 吊销机制**：**现状全部"无"**——跟盲签 9 条同一个洞（M-1 摸底本身要暴露的缺口，不是这条命令特有）：relay 端 `case` handler 里没有任何 caller identity 校验、没有独立于链上 tx 本身的调用请求审计日志、没有吊销某个调用方权限的机制。这 20 条能被谁调用完全由"谁能连上 relay IPC"决定（M-1.2 威胁模型 NWT 在做）。
- **是否可进公开应用契约**：**否**（现状）——witness/inputs/outputs 是裸内部数据结构非 typed-intent，M0b 验收门明确"缺少已完成经济效果 verifier 的命令保持 internal"，这 20 条全部需要 typed-intent 包装才能毕业进公开契约（M0c/typed-intent 独立卡范围）。

| 命令 | 家族/分支(covenant family·opcode) | 输入 outpoint 范围 | 收款与输出约束 | 金额-费率上限 | 幂等键 | 所需证据与终局性 |
|---|---|---|---|---|---|---|
| `BSHARD_REGISTER_BET` | ShardLeaf `register_append` OP_0 | leaf P2SH(无签名)+funding P2PK | relay 自算续约地址(per-state continuation)，无外部收款人 | **❌ 无上限（J1 核实+J2 交叉核坐实）**：covenant 仅 `require(stake>=min_bet)` 下限(ShardLeaf.sil:61)，JS 层 `unlockBshardRegister`(p2sh.mjs:2667-2718)与 `_assertTxInvariants`(:42-74)均无业务上限——TRANSFER 反模式第 6 例；资金来源限 relay 自身钱包(funding 全用 wallet.getPrivateKey() 签, :2703)，风险=掏空 relay 钱包非转移第三方资产；处置归属（NWT 裁, M-1.2 回填 cfd75d85）=本卡金额上限列 gap（TRANSFER 反模式家族），非 caller 身份/重放面, 不进 M-1.2 B-3, M-1.2 §5 已标注指回本行 | 无显式幂等键——console 侧 `bet_id`/`betId` 是上游概念，本条命令自己不带 | 无(下注登记本身即首次状态) |
| `BSHARD_CLAIM_WINNER` | PoolRoot `claim_draw` OP_1 | root P2SH(无签名)+ticket(bettorSig)+fee | winner 收款，收款人由 ticket 签名隐含绑定 | 无独立上限（受 covenant state 内 pool 值约束） | 无显式 | 需 ticket(bettorSig)真实签名 + **终局检查在 covenant 层强制（v0.3 订正 v0.1 误判）**：`closed==1` write-once 门(PoolRoot.sil:92)+`payout<=pool_value`(:98)+赢向绑定(:103)+merkle-proof 金额绑定到委员 attest 的 payoutRoot(:105-114)；relay JS 层不重复校验=架构正确分工非缺口 |
| `BSHARD_REFUND_CANCELLED` | PoolRoot `refund_draw` OP_2 | pool P2SH(无签名)+ticket(bettorSig) | 原路退本金给 bettor | 无独立上限 | 无显式 | closed flip 0→2，本条即终态转移 |
| `BSHARD_FOLD` | `__leader_fold`OP_1/`__delegate_fold`OP_2 | k children→1 parent | 输出=parent covenant 地址(relay自算) | n/a(结构折叠非价值转移) | 无显式 | 无独立终局检查 |
| `BSHARD_CLOSE_COMMIT` | PoolRoot `close_commit` OP_0，委员 4-of-5 | root P2SH+fee | closed 0→1 + outcome 写入 | n/a | 无显式 | **三门均在 covenant 层强制（v0.3 订正 v0.1 误判）**：`closed==0` write-once(PoolRoot.sil:54)+`count==shard_count` 深度防御门(:55, 源码注释原话)+`tx.time>=deadline*1000` 时间门(:56)+4-of-5 签名门(:59-65)；无缺口, relay JS 层(p2sh.mjs:2850-2898)只做签名收集=正确分工 |
| `BSHARD_SEAL_TO_ROOT` | PoolLeaf `seal_to_root` OP_3 | leaf P2SH(无签名)+funding | 全池 KAS→PoolRoot | n/a | 无显式 | 无独立终局检查 |
| `BSHARD_CONVERT_TO_FOLDNODE` | ShardLeaf `convert_to_foldnode` OP_1 | sealed leaf P2SH(无签名)+funding P2PK | leaf→FoldNode(relay自算续约地址) | n/a | 无显式 | 无独立终局检查 |
| `BSHARD_GENESIS_MINT_PAYOUT` | 市场创建铸空 PayoutShard(`populateGenesisCovenants`) | 无既有 outpoint(创世) | 返回 `payoutCovId` 供后续 ctor bake | n/a | 无显式(cov_id 本身是唯一性来源) | 创世操作，无前置终局 |
| `BSHARD_CONSOLIDATE` | PS `absorb`OP_0+SL `consolidate_to_payout`OP_1 | 单片全额，cov_id-bind destination | 归集进真 PayoutShard | n/a | 无显式 | cov_id 续约校验(CovenantBinding)，无独立深度门(同 K-18/P0 今晚查过的既有缺口) |
| `BSHARD_CLOSE_ATTEST` | 委员 4-of-5(pubkey-distinct) 背书 payoutRoot | 同 consolidate 后的 PayoutShard | closed 0→1 write-once + cov_id 续 | n/a | write-once 本身是幂等保护(第二次调用会因 state 已翻转而失败，需验证具体 fail 语义) | 委员签名数量+pubkey-distinct 校验 |
| `BSHARD_PAYOUT_CLAIM` | winner `store-payout` OP_2 | merkle climb+multi-word nullifier+recipient P2PK | 收款人=P2PK recipient(由 merkle 叶子决定) | 受 payoutRoot 分配值约束 | **nullifier 本身是幂等键**(防重复 claim 同一叶子) | merkle proof 验证+nullifier 未使用检查 |
| `BSHARD_CANCEL_ATTEST` | 委员 4-of-5 背书 refundRoot | 镜像 close_attest | closed 0→2 write-once + cov_id 续 | n/a | write-once | 委员签名数量+pubkey-distinct 校验 |
| `BSHARD_REFUND_CLAIM` | bettor `store-refund`(closed==2) | merkle climb+nullifier+recipient P2PK | 镜像 payout_claim | 受 refundRoot 分配值约束 | nullifier | merkle proof+nullifier 未使用+closed==2 前置检查 |
| `BSHARD_CLOSE_ATTEST_V2` | PayoutShardV2/ZK-native 委员 4-of-5 背书 | +attestedWinner/betsRoot/refundRoot/attestedAtMs(V2 独有字段) | 同 close_attest，V2 state(288B) | n/a | write-once | 委员签名+pubkey-distinct，同 V1 逻辑镜像 |
| `BSHARD_CONSOLIDATE_V2` | 同 consolidate，V2 state 序列化(288B，多4字段) | 同 consolidate | 同 consolidate | n/a | 无显式 | 同 consolidate |
| `BSHARD_ZK_HANDOFF` | PayoutShardV2 `zk_handoff` OP_4，无 continuation(终点) | consolidated_pool 一次性交给新铸 CloseZkRepro4 genesis | 输出=CloseZkRepro4 genesis | n/a | 无显式 | 生命周期终点操作，之后旧 covenant 不再可花费 |
| `BSHARD_ZK_CLOSE` | CloseZkRepro4 `zk_close` OP_0 | closed 1→2 + payoutRoot 写入，2-input(含真实 groth16 proof gate) | continuation state | n/a | write-once(closed 值翻转) | **真实 ZK proof 验证**(groth16 gate)，是本清单里唯一有密码学证明前置而非仅签名计数的一条 |
| `CLOSEZK_V2_CLAIM` | CloseZkV2 `claim` OP_3, closed==2 前置 | payoutRootField merkle climb+17-word nullifier+P2PK payout | splice 续约(state-in-address, 213B) | 受 payoutRootField 分配值约束 | nullifier(17-word) | merkle+nullifier+closed==2 检查 |
| `CLOSEZK_V2_ESCAPE_TRIGGER` | CloseZkV2 `escape_trigger` OP_1, closed 1→3 | write-once flag-flip，**不动钱**(守恒) | 无价值转移 | n/a | write-once | `tx.time`阈值链上机械裁决(OP_CHECKLOCKTIMEVERIFY 类逻辑) |
| `CLOSEZK_V2_ESCAPE_CLAIM` | CloseZkV2 `escape_claim` OP_2, closed==3 前置 | refundRootBaked merkle climb+17-word nullifier+P2PK(bettorPk) | 原额退款，**地址由 handler 自推不信 caller 标量**(NWT 复核过的正确范式) | 受 refundRootBaked 分配值约束 | nullifier | merkle+nullifier+closed==3 检查 |

**待办①②③——已闭（v0.3）**：J1 域复核（`docs/2026-07-22-j1-covenant-domain-review-m1-1-m1-2.md` §1）进 p2sh.mjs 函数体+对应 .sil 源码核实完毕，J2 独立交叉核 file:line 吻合。结论已回填 §1 表内对应三行：①真缺口（无上限，TRANSFER 反模式第 6 例）；②③v0.1 误判已订正（covenant 层俱在）。
- `BSHARD_ZK_CLOSE` 的 groth16 proof gate 是本清单唯一"真密码学证明"而非"签名数量计数"的命令，M0c 的 evaluator 设计时这条应该单独对待（proof 验证失败 vs 签名不足，是两种不同的 fail-closed 语义）。

### 1.1 v0.4 新增第 15 列：**经济效果 verifier**（类 C 20 条逐条，无一留空）

**为什么单开一节而不是改表**：原 14 列定义里没有这一列，而 M-1 DoD 第 2 条要的就是它（「每个 sign/submit/transfer/state-mutate 命令都指向经济效果 verifier」）。类 C 那张表是 7 列压缩版（共性列在表上方说过一次），直接塞第 15 列会把已批准的表结构改掉——**本节以子表补列，原表一字未动**。

**填法（不发明，逐条从本卡已有的「所需证据与终局性」列派生）**：verifier = **在这条命令的经济效果出错时，谁会拒绝它**。

| 命令 | **经济效果 verifier** | 强度 |
|---|---|---|
| `BSHARD_ZK_CLOSE` | **groth16 ZK proof**（链上验证，非签名计数） | 🟢 密码学证明 |
| `BSHARD_CLAIM_WINNER` | covenant：`closed==1` write-once(PoolRoot.sil:92) + `payout<=pool_value`(:98) + 赢向绑定(:103) + merkle-proof 绑定委员 attest 的 payoutRoot(:105-114) | 🟢 covenant 强制 |
| `BSHARD_CLOSE_COMMIT` | covenant：`closed==0` write-once(:54) + `count==shard_count`(:55) + `tx.time>=deadline*1000`(:56) + 4-of-5 签名门(:59-65) | 🟢 covenant 强制 |
| `BSHARD_PAYOUT_CLAIM` | covenant：merkle proof + nullifier 未使用 | 🟢 covenant 强制 |
| `BSHARD_REFUND_CLAIM` | covenant：merkle proof + nullifier + `closed==2` | 🟢 covenant 强制 |
| `CLOSEZK_V2_CLAIM` | covenant：payoutRootField merkle + 17-word nullifier + `closed==2` | 🟢 covenant 强制 |
| `CLOSEZK_V2_ESCAPE_CLAIM` | covenant：refundRootBaked merkle + nullifier + `closed==3`；收款地址由 handler 自推、不信 caller 标量 | 🟢 covenant 强制 |
| `CLOSEZK_V2_ESCAPE_TRIGGER` | covenant：`tx.time` 阈值链上机械裁决；且**不动钱**（守恒） | 🟢 covenant 强制 |
| `BSHARD_CLOSE_ATTEST` / `_V2` / `BSHARD_CANCEL_ATTEST` | covenant：委员签名数量 + pubkey-distinct + write-once | 🟢 covenant 强制 |
| `BSHARD_REFUND_CANCELLED` | covenant：`closed` 0→2 write-once（本条即终态转移） | 🟢 covenant 强制 |
| `BSHARD_CONSOLIDATE` / `_V2` | 🟡 **部分**：cov_id 续约校验（CovenantBinding）在，**而无独立深度门**（本卡原文） | 🟡 部分 |
| `BSHARD_ZK_HANDOFF` | 🟡 **部分**：生命周期终点操作，旧 covenant 之后不可花费；**无独立前置 verifier** | 🟡 部分 |
| `BSHARD_REGISTER_BET` | 🔴 **无**：covenant 仅有 `stake>=min_bet` 下限(ShardLeaf.sil:61)，**无上限**；JS 层亦无（p2sh.mjs:2667-2718 / :42-74） | 🔴 无 |
| `BSHARD_FOLD` | 🔴 **无**（本卡原文「无独立终局检查」） | 🔴 无 |
| `BSHARD_SEAL_TO_ROOT` | 🔴 **无**（同上） | 🔴 无 |
| `BSHARD_CONVERT_TO_FOLDNODE` | 🔴 **无**（同上） | 🔴 无 |
| `BSHARD_GENESIS_MINT_PAYOUT` | 🔴 **无**（创世操作，无前置终局） | 🔴 无 |

**统计**（按**命令**数，不是按表行数——上表有 2 行是合并行：`CLOSE_ATTEST/_V2/CANCEL_ATTEST` 覆盖 3 条、`CONSOLIDATE/_V2` 覆盖 2 条）：
🟢 covenant/ZK 强制 = **12 条**（8 条独立行 + 合并行 3 条 + `REFUND_CANCELLED` 1 条）· 🟡 部分 = **3 条** · 🔴 无 = **5 条** ⇒ **12+3+5 = 20，无一留空** ✅

🔴 **按 DoD 第 3 条「无 verifier 的默认 internal」⇒ 🔴 那 5 条与 🟡 那 3 条,「是否可进公开应用契约」应为「否」。**
而本卡 §1 共性列原本就把类 C 全部 20 条标成**否（现状）** ⇒ **这一条 DoD 在类 C 上恰好已经满足**，不需要改表；本节把「为什么否」从"witness 是裸结构"补成"其中 8 条连 verifier 都没有"。

🔵 **而 16 条通用原语那半见 §2.1**（5 条 submit 已在 v0.4 改为「否」）。**类 A 6 条 / 类 B 9 条的 verifier 列不在本卡**——它们以指针形式存在于 D2，属本卡 v0.4 未闭合的穷尽性缺口（见文首修订记录）。

---

## 2. 16 条"通用原语"（Owner 点名不可自外于分类之外，逐条列出）

**v0.2（Bettor 方向审 n1 折入）**：`TRANSFER`/`ECDSA_SIGN`/`SIGN_INPUT_FOR_SETTLE` 三条高风险行原稿只填了 4/14 列——正是我自己在 §3 指出的"贴通用原语标签被无意识降级审查"那个病在本卡内复现了一半，这次补全跟类 C 同款 14 列全量待遇，不因为"通用+早就有"就简化处理：

| 命令 | 效果类 | 所用密钥与钱包 | 允许资产与网络 | 允许市场-家族-分支 | 输入 outpoint 范围 | 收款与输出约束 | 金额-费率上限 | 幂等键 | 所需证据与终局性 | 调用方能力 | 审计回执 | 吊销机制 | 是否可进公开应用契约 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `HANDSHAKE` | read | relay 自己身份 | n/a | n/a | n/a | 无价值转移 | n/a | 无 | n/a | 无 | 无 | 无 | 是(纯身份，无价值面) |
| `SEND_MESSAGE` | build·submit | relay 自己签名密钥 | n/a(消息非链上资产) | n/a | n/a | 消息广播，无 KAS 转移 | n/a | 无 | n/a | 无 | 无 | 无 | **否**（v0.4 重分类：`submit` 且无 verifier ⇒ 默认 internal；见 §2.1） |
| `SEND_BROADCAST` | build·submit | 同上 | n/a | n/a | n/a | 频道广播 | n/a | 无 | n/a | 无 | 无 | 无 | **否**（同上，v0.4 重分类） |
| `PUBLISH_CARD` | build·submit | 同上 | n/a | n/a | n/a | 名片发布 | n/a | 无 | n/a | 无 | 无 | 无 | **否**（同上，v0.4 重分类） |
| `TRANSFER` | sign·submit·**transfer** | **relay 自己钱包** | KAS，`wallet.getNetworkId()` | n/a(非 covenant，普通 P2PK 转账) | relay 自己 UTXO 集(自动选币) | **收款地址+金额完全由调用方 `target`/`amount` 决定，relay 零校验合理性**(是否白名单收款人/是否超预算) | **现状无独立上限**——跟 custodial_transfer 同族风险，只是花的是 relay 自己的钱不是别人的 | 无显式(重复调用=重复转账) | n/a | **无**(跟盲签 9 条同一现状) | **无**(链上 tx 本身可查，但无独立"谁在何时申请了这笔转账"的调用请求记录) | 无 | **否**——需先有金额/收款人 scope 才能公开(M0c 范围) |
| `CUSTODIAL_TRANSFER` | sign·submit·transfer·**wallet-admin** | **调用方传入的外部 privkeyHex**(relay.mjs:478-490，MF2/NWT 已坐实) | KAS | n/a | 该私钥对应地址的 UTXO 集 | 同 TRANSFER，且私钥本身经 IPC 传递(见 §D2 类 B 完整分析) | 现状无独立上限 | 无显式 | n/a | 无 | 无独立审计(私钥用后即弃，无留痕) | 无 | 否(唯一"relay 签别人钥匙"的命令，M-1 caller identity 最高优先级) |
| `SPLIT_UTXO` | build·submit | relay 自己钱包 | KAS | n/a | relay 自己 UTXO | UTXO 管理，产出仍归 relay 自己 | targetCount 参数决定份数，无金额上限 | 无显式 | n/a | 无 | 无 | 无 | **否**（v0.4 重分类：`submit` 且无 verifier；且 `targetCount` 无上限 ⇒ 可被用来把 relay 钱包碎片化到发不出交易，见 §2.1） |
| `CONSOLIDATE_UTXO` | build·submit | relay 自己钱包 | KAS | n/a | relay 自己 UTXO | 同上 | n/a | 无显式 | n/a | 无 | 无 | 无 | **否**（同上，v0.4 重分类） |
| `GET_RPC_STATE` | read | n/a | n/a | n/a | n/a | 只读 | n/a | n/a | n/a | 无 | n/a | n/a | 是 |
| `ECDSA_SIGN` | sign | relay 自己私钥 | n/a(非链上 tx，任意消息签名) | n/a | n/a | **签任意调用方传入的 `message`，relay 对内容零校验** | n/a(签名操作本身无金额概念) | 无显式 | n/a | **无**——跟 custodial_transfer 同族风险(签名对象由调用方完全决定，relay 不知道自己在签什么语义的东西) | 无独立审计(签名结果返回给调用方，relay 侧无独立记录"谁申请签了什么") | 无 | **否**(需先有消息内容/用途白名单才能公开) |
| `GET_PUBKEY` | read | n/a | n/a | n/a | n/a | 只读 | n/a | n/a | n/a | 无 | n/a | n/a | 是 |
| `SIGN_INPUT_FOR_SETTLE` | sign | relay 自己私钥 | KAS(签的是 kaspa tx 的某个 input) | n/a(不绑定任何特定 market/covenant family) | **调用方指定 `input_index`，relay 不校验这个 index 对应的 UTXO 语义**(是不是真的这笔结算该花的那个 input) | **签调用方传入的 `tx_hex` 任意 input**——relay 不理解这笔交易的收款人/金额/用途 | 无独立上限(受 tx_hex 本身金额约束，但 relay 不核实这个金额是否合理) | 无显式 | n/a | **无**——跟盲签 9 条同一模式(relay 不理解这笔交易语义，纯粹执行签名动作) | 无独立审计 | 无 | **否**(需 typed-intent 包装才能公开，M0c/typed-intent 范围) |
| `CHECK_UTXO_LANDED` | read | n/a | n/a | n/a | n/a | 只读查询 | n/a | n/a | n/a | 无 | n/a | n/a | 是 |
| `GET_ADDRESS_UTXOS` | read | n/a | n/a | n/a | n/a | 只读查询 | n/a | n/a | n/a | 无 | n/a | n/a | 是 |
| `CHAIN_GET_CURRENT_DAA_SCORE`/`CHAIN_GET_BLOCKS_FROM_DAA_SCORE`/`CHAIN_GET_BLOCK_AT_DAA` | read | n/a | n/a | n/a | n/a | 只读链查询(3 条合并一行) | n/a | n/a | n/a | 无 | n/a | n/a | 是 |

**Owner 那句话验证成立**：`ECDSA_SIGN`(签任意消息)+`SIGN_INPUT_FOR_SETTLE`(签任意 tx input)两条通用原语，风险模式跟类 B 盲签 9 条几乎一样(relay 对签名内容零校验，纯粹执行调用方给的字节)——之前分类只覆盖 A6+B9+C20=35 条，这两条+`TRANSFER`/`CUSTODIAL_TRANSFER` 混在"16 条通用原语"标签下被无意识降级审查，是原分类穷尽性的真实漏洞，M-1.1 完整清单已经堵上。

### 2.1 v0.4 重分类：5 条 `submit` 命令由「可进公开契约=是」改为「否」

**依据**：M-1 DoD 第 2、3 条逐字 ——「每个 sign/submit/transfer/state-mutate 命令都指向经济效果 verifier」+「**无 verifier 的默认 internal**」。
**触发**：2026-07-30 J2 对 DoD 逐条验收（5 条 DoD 满足 1、不满足 4），Bettor 10:08 派工 (3)。

| 命令 | 效果类 | 审计回执 | 吊销机制 | 经济效果 verifier | v0.3 标法 | **v0.4 标法** |
|---|---|---|---|---|---|---|
| `SEND_MESSAGE` | build·**submit** | 无 | 无 | 无 | 是 | **否** |
| `SEND_BROADCAST` | build·**submit** | 无 | 无 | 无 | 是 | **否** |
| `PUBLISH_CARD` | build·**submit** | 无 | 无 | 无 | 是 | **否** |
| `SPLIT_UTXO` | build·**submit** | 无 | 无 | 无 | 是 | **否** |
| `CONSOLIDATE_UTXO` | build·**submit** | 无 | 无 | 无 | 是 | **否** |

**为什么这不是"改个标签"**：这 5 条都能**让 relay 向链上广播交易**，而三列同时为「无」——没有独立的调用请求审计（链上 tx 可查，但查不到"谁在何时申请了它"）、没有吊销某个调用方的机制、没有任何 verifier 说得出这笔广播的经济效果该是什么。若一个外部程序照 v0.3 的标法接进来，它拿到的是**能广播、而我们既回收不了也审计不了**的能力。

**两条具体的、不靠"原则上"的风险**（v0.4 新增，逐条可查）：
- `SPLIT_UTXO`：`targetCount` **无上限**（本表金额-费率上限列原文：「targetCount 参数决定份数，无金额上限」）⇒ **无上限的结构性参数 ⇒ relay 钱包的 UTXO 拓扑可被外部调用方任意改变**。本仓已有同一失败面的实证记录（UTXO 拓扑劣化导致 relay 发不出交易）。
- `SEND_MESSAGE`/`SEND_BROADCAST`/`PUBLISH_CARD`：每次广播**花 relay 自己的手续费**，而速率上限「无」、配额「无」、审计回执「无」⇒ **无上限的计费动作 ⇒ 余额可被耗尽；无回执 ⇒ 事后不可归因、且无法只切断某一个调用方**。

> 🔴 **本节只给结论,不给可照做的步骤** —— 依据(Bettor 2026-07-30 10:16 裁定)：
> **缺陷与修法一起发布 = 标准做法；修法落地前单独发布缺陷 = 发配方。**
> 而本次修法**没有落地**（见下方"本次不做的"）。具体形态留在团队内部记录，
> **待 M0c 的闸落地后再并回本节** —— 到那时它就是"缺陷+修法一起发布"。

🔴 **本次不做的**（说清边界，免得这条被读成"已经修好了"）：
- 本次**只改清单标法**，**没有**在 relay 或 Console 侧加任何 enforcement —— 也就是说，**现在挡住这 5 条的是"公开契约里不写它们"，不是代码里的闸**。真正的闸属于 M0c（scope evaluator / caller identity / 审计回执）。
- 我**没有核实**这 5 条此刻是否已经被任何既有的对外契约/文档暴露出去过。若已暴露，撤回它是一个单独的动作，不在本次范围。

---

## 2.2 v0.4 补齐：**11 条从未被逐条列名的命令**（其中 8 条是盲签类）

### 2.2.0 为什么它们缺了 —— 根因一行

`roadmap-v0.2 §D2` 逐字写的是「**类 B 盲签（9，风险排三类之首）：PREDICTION_SETTLE_TX 等 9 条**」——
**只写了一个名字，其余 8 条只以"等 9 条"这个【数量】存在**。而本卡 §0 说「类 B 9 条以指针引用 D2」⇒ 指针指过去，那头没有名单。

🔨 **于是两份文档的总数都对得上 51，而 8 条最危险的命令从来没有被逐条列过。**
判据：**一份清单声称穷尽时，判据是「逐条点得出名」，不是「总数对得上」** —— "等 N 条"这种写法会让总数校验永远通过。

### 2.2.1 可推翻的穷尽性断言（写死取数方法，让下一个人一条命令推翻它）

```
来源（唯一真相，不是另一份文档）：kasia-relay/src/lib/commands.mjs 的 COMMAND_PAYLOAD_SCHEMA
取数命令：
  grep -oE "^\s{2}[A-Z][A-Z0-9_]+:" kasia-relay/src/lib/commands.mjs | sed 's/[: ]//g' | sort -u | wc -l
断言（2026-07-30 J2 实测）：
  代码去重命令数 = 51 · 本卡逐条覆盖 = 51 · **差 = 0**
🔵 阳性对照（证明比对有功率，而不是空读）：BSHARD_ZK_CLOSE 在本卡命中 > 0
```

🔴 **DoD① 的验收方法由此改**（Bettor 2026-07-30 10:25 立）：**「清单穷尽」必须对着【代码】断言，不许对着另一份文档断言**，且断言要带那个数（代码 N / 覆盖 N / 差 0）。

### 2.2.2 那 8 条盲签（类 B，逐条列名 + 15 列）

**共性列（8 条相同，说一次不重复）**：效果类 = `sign·submit`（`SWEEP_PER_BET` 另含 `transfer`）· 所用密钥 = **relay 自己的签名密钥，签的是调用方传入的 `redeem_script_hex`** · 允许资产与网络 = KAS / `wallet.getNetworkId()` · 调用方能力 = **无** · 审计回执 = **无** · 吊销机制 = **无** · **经济效果 verifier = 🔴 无**（relay 对调用方传入的脚本零结构/opcode 校验，实证 `relay.mjs:786-816`）· 是否可进公开应用契约 = **否**。

| 命令 | 载荷字段（COMMAND_PAYLOAD_SCHEMA 原文） | 收款与输出约束 | 幂等键 | **经济效果 verifier** |
|---|---|---|---|---|
| `POOL_SETTLE_TX` | spine_p2sh_address · side_p2sh_addresses · spine_redeem_script_hex · side_redeem_script_hexes · required_input_outpoints · **outputs** · spine_sigs_by_input · spine_input_count · winner | **`outputs` 由调用方给** | 无 | 🔴 无 |
| `POOL_REFUND_DISAGREEMENT_TX` | spine_p2sh_address · spine_redeem_script_hex · required_input_outpoints · **outputs** · spine_sigs_by_input · silent_oracle_index · signing_pair | **`outputs` 由调用方给** | 无 | 🔴 无 |
| `POOL_REFUND_MAKER_UNJOINED_TX` | spine_p2sh_address · spine_redeem_script_hex · required_input_outpoint · **output** | **`output` 由调用方给** | 无 | 🔴 无 |
| `POOL_SIDE_REFUND_CANCELLED_TX` | side_p2sh_address · side_redeem_script_hex · required_input_outpoint · **output** | **`output` 由调用方给** | 无 | 🔴 无 |
| `PREDICTION_SETTLE_TX` | p2sh_address · redeem_script_hex · required_input_outpoints · **outputs** · sigs_by_input · winner | **`outputs` 由调用方给** | 无 | 🔴 无 |
| `PREDICTION_SETTLE_CONSENSUAL_TX` | 同上 | **同上** | 无 | 🔴 无 |
| `PREDICTION_REFUND_TX` | p2sh_address · redeem_script_hex · **branch** | 输出不在载荷里（分支由 `branch` 选） | 无 | 🔴 无 |
| `STAKE_UNLOCK_TX` | p2sh_address · redeem_script_hex · **to_address** · lock_time | 🔴 **收款地址 `to_address` 完全由调用方给** | 无 | 🔴 无 |
| `SWEEP_PER_BET` | per_bet_address · redeem_hex | 扫回 gateway（`transfer` 效果） | 无 | 🔵 **有（8 条里唯一）**：目的地 = `wallet.getAddress()`，relay 自取、**不接受调用方指定**（`relay.mjs:692` 实读，见 §2.4.5）|

（上表 9 行 = `PREDICTION_SETTLE_TX`（D2 唯一列过名的那条）+ **此前缺名的 8 条**。）

### 2.2.3 另外 3 条：任何分类里都没有出现过

| 命令 | 载荷字段 | 效果类 | **经济效果 verifier** | 可进公开契约 |
|---|---|---|---|---|
| `GET_ARM_STATUS` | **`[]`**（无必填字段；源码注释：`Path B 围栏 §2.7 — read-only`） | read | n/a（只读，无经济效果） | 是 |
| `PREDICTION_SETTLE_BUILD_PREIMAGE` | p2sh_address · required_input_outpoints · outputs | **build**（构造待签 preimage，载荷里**无** `redeem_script_hex`、**无** 签名） | 🔴 无 | **否**（`outputs` 由调用方给；它构造的 digest 会被后续签名命令消费） |
| `PREDICTION_SETTLE_CONSENSUAL_BUILD_PREIMAGE` | p2sh_address · required_input_outpoints · outputs · winner | **build**（同上） | 🔴 无 | **否**（同上） |

### 2.2.4 补：类 A 里只活在 D2、本卡从未列名的 2 条

写完 2.2.2/2.2.3 后重跑那条穷尽性断言，**差不是 0，是 2** —— 以下 2 条只出现在 `roadmap-v0.2 §D2` 的类 A 名单里，本卡从未列过：

| 命令 | 载荷字段 | 效果类 | 所用密钥 | **经济效果 verifier** | 可进公开契约 |
|---|---|---|---|---|---|
| `GET_PER_BET_ADDRESS` | （D2 原文：纯派生，relay 自己算 redeem_hex 返回，**零签名**） | derive·read | 无（不签名） | n/a（无经济效果，不动钱） | 是 |
| `POOL_V07_COMPUTE_REFUND_MASS` | （D2 原文：纯计算） | derive·read | 无（不签名） | n/a（同上） | 是 |

🔵 **这一格本身就是 2.2.1 那条断言的用处**：我先把断言写进文档，再跑一遍去验它 —— **而它当场就是假的（差=2）**。若只写不验，这份"全量清单"会带着一个"差=0"的自证条款发布出去。
🔨 判据：**把可推翻的断言写进交付物之后，第一件事是自己去推翻它一次。**

### 2.2.5 与 §2 通用原语表的重叠（原 (2) 消重复计数，一并解决）

`CHAIN_GET_*×3` 与 `GET_ADDRESS_UTXOS` 这 4 条，同时出现在 D2 类 A（6 条）与本卡 §2（16 条通用原语）⇒ 原先两处各计一次。

**处置（定一份为主）**：
- ✅ **本卡（m1-1）为唯一的活清单**，51 条逐条在此覆盖。
- 🔴 `roadmap-v0.2 §D2` 的 A/B/C 分类**已被 v1.2 取代**（实测：权威路线图 `docs/2026-07-25-kanet-trunk-roadmap-modularization-and-external-access.md` 里 `GET_ADDRESS_UTXOS`/`CHAIN_GET`/`类 A` 命中皆为 0；其中出现的 3 处 "D2" 是 mermaid 图节点 ID，与命令分类无关）⇒ **D2 那份是历史来源，不是与本卡平级的清单**，引用它时不得再作为"清单的另一半"。

### 2.2.6 本节的证据强度边界（不许被读成"逐条审过 handler"）

```
✅ 我读的是 kasia-relay/src/lib/commands.mjs 的 COMMAND_PAYLOAD_SCHEMA（载荷字段 = 逐字原文）
   + COMMAND_TYPES 的源码注释
🔴 我**没有**逐条读这 11 条在 relay.mjs 里的 handler 函数体
   ⇒ 「收款与输出约束」「幂等键」这两列是**从载荷字段推的**，不是从 handler 实读的
   ⇒ 若某条 handler 内部另有校验，本表会**低估**它 ⇒ 这一格要 @J1 域复核或后续实读补强
🔵 而「verifier = 无」这一列的依据是类 B 的共性（relay 对 caller 传入脚本零校验，
   实证 relay.mjs:786-816 已在 D2 坐实）——**不是**我逐条重新验的
🔴 且照 M-1 要求：**verifier 填"无"是把实况写下来，不是给它设计一个**。本节不提出任何修法。
```

---

## 2.3 交付③「public / internal / retire 三态资格」—— 答它，而不是给空集造一栏

**先分清两个被同一个数字编号的东西**（否则会互相顶替）：
- **交付③** = `public / internal / retire` **三态资格**（本节答这个）；
- **DoD③** = 「**无 verifier 的命令默认 internal**」（那一条已由 §1.1 与 §2.1 处理）。

### 2.3.1 retire 属于**另一条轴**，不是二态漏掉的第三个

权威路线图 v1.2 里 `retire` 出现两处，第二处（M0b 契约要求清单）的邻居是逐字这几行：
「**version pin、deprecation 和历史 profile**」「历史 profile 不被最新实现静默重解释」。

```
public / internal  ⇒ **安全资格轴**：这条命令能不能对外提供（M-1 管，本卡 §1.1 / §2.1 / §2.2 已逐条判）
retired            ⇒ **生命周期轴**：这条命令曾经提供过、现在不再提供
                     （与 version pin / deprecation / 历史 profile 同族，M0b 管）
```

🔵 **所以此前的二态设计不是缺陷** —— 它在安全资格那条轴上是完整的。第三态是 M0b 拉进来的，而我们现在处在 M-1。

### 2.3.2 三态 schema 成立，而 **retired 当前为空集**

| 状态 | 语义 | 当前成员 |
|---|---|---|
| `public` | 可进公开应用契约 | 见 §2 / §2.2 各表「是否可进公开应用契约 = 是」的条目 |
| `internal` | 不对外，仅内部可调 | 同上「= 否」的条目（含 v0.4 重分类的 5 条 + 全部盲签 + 类 C 20 条） |
| `retired` | 曾对外提供、现已退役 | **空集** |

**retired 为空集的理由（不是"没查"，是"没有指称对象"）**：**尚无版本化的对外契约** ⇒ 没有"曾经对外提供过"这件事 ⇒ 只有"删掉了"，没有"退役了"。
**实测佐证**：`kasia-relay/src/lib/commands.mjs` 全文检索 `deprecated / DEPRECATED / retired / RETIRED / obsolete / 废弃 / 退役 / 已停用` ⇒ **命中全部为 0**（阳性对照：该文件 287 行，非空）。

### 2.3.3 它何时会非空 —— 写死条件，让下一个人知道什么时候回来填

> **`retired` 开始有指称对象的条件 = M0b 落地（版本化的公开应用契约发布之后）。**
> 在那之前，本栏保持空集是**正确状态**，不是待办。

🔴 **本节刻意不做的**（Bettor 2026-07-30 10:32 裁定）：**不造 schema、不造迁移路径、不造退役流程** —— 那是**给空集造制度**。
🟡 **一件可做而未做的**：翻 34 个触及 `COMMAND_TYPES` 的 commit，查"历史上删过哪些命令"。**没做**，因为它答的是另一个问题（历史删除 ≠ 当前退役状态）。留白优于填一个答非所问的东西。

---

## 2.5 v0.7 新增：三条**边界实况**（M-1 = 安全边界发现；只记实况，不下风险判断）

> 依据：Bettor 2026-07-31 派工 1️⃣2️⃣3️⃣。三条都属"**这些命令的可调用性由什么决定**"，
> 而它们**不在任何一条命令的行里** —— 它们是绕过/穿透命令表的边界。

### 2.5.1 那 8 条盲签的 `redeem_script_hex` 从哪来 —— **建盘时存库，结算时原样取出**

```
实读 kasia-console/src/services/pool-market-settler.js:
  :2497  const spineRedeemHex = meta.spine_redeem_script_hex;
  :2498  if (!spineRedeemHex) throw new Error('market.metadata missing spine_redeem_script_hex');
  :2192  注释:「CRITICAL: spread prior metadata (= preserve spine_redeem_script_hex stashed at create time)」
  :2540  注释:「meta.spine_redeem_script_hex — PoolSpine_v06 compiled redeem (stashed at create-time)」
```

⇒ **结算时不编译任何 `.sil`**。⇒ 因此"这条命令对应哪个 `.sil`"**没有单一答案**：它等于"那个盘建的时候用的是哪一份"。

### 2.5.2 那份 hex 从存入到使用之间的完整性保护 = **无**

| 层 | 查了什么 | 结果 |
|---|---|---|
| Console 取出侧 | `pool-market-settler.js` 三处取出点（:1903 / :2497 / :2567）往下 15 行 | 🔴 无地址反推、无哈希比对、无与链上比 |
| relay 收到侧 | 逐个函数体查 `_addressFromRedeem`：`unlockPoolSpineP2SH` / `unlockPoolSpineRefundDisagreement` / `unlockP2SHMultiSig` / `unlockP2SHConsensual` / `unlockP2SH` / `unlockP2SHDual` / `unlockP2SH_SingleEntry` | 🔴 **7 / 7 命中皆为 0** |

🔵 **阳性对照（证明该工具存在且被使用）**：`_addressFromRedeem` 在 **BSHARD 线**上有 5 处 —— `unlockBshardGenesisMintPayout`:1749 · `unlockBshardConsolidate`:1788/:1789 · `unlockBshardConsolidateV2`:1833/:1834。

🔴 **而那 5 处的用途必须说准，否则会被读成校验**：它们是 `_matchUtxo(rpc, _addressFromRedeem(redeem), outpoint)` —— **先用调用方给的 redeem 推出地址，再去那个地址上找 UTXO**。
⇒ 这是**用调用方的 redeem 决定花哪个 UTXO**，**不是**拿它与一个独立来源比对。⇒ **即便在 BSHARD 线上，它也不构成"这份 redeem 是合法的"这种校验。**

🟡 **未查（明标）**：`pool_markets.metadata` 的**写入侧**有无保护（触发器/权限/只读约束）；exchange/prediction 线的 offer 表是否同样。

### 2.5.3 `prediction_refund_tx` 的 branch → entrypoint 映射 = **不确定**

```
relay 侧(两个 unlock 函数逐个读函数体, 映射相同): **branch N → OP_N**
   p2sh.mjs:275(unlockP2SH) / :770(unlockP2SHDual)  branch 0→'00' · 1→'51' · 2→'52'
relay.mjs:1269 handler 注释: 「branch 1 = refund_both」「branch 2 = refund_maker_unjoined」

而 escrow 合约有三份, **声明序互不相同**:
   PredictionEscrowUnanimous5     OP_0 settle_dispute · OP_1 settle_consensual
                                  · OP_2 refund_both · OP_3 refund_maker_unjoined
   PredictionEscrowConsensualMid  OP_0 settle_consensual · OP_1 refund_timeout
   PredictionEscrowMulti          OP_0 settleByMultiOracle · OP_1 refund
```

🔴 **⇒ 实况条目 = 「这条命令调到哪个 entrypoint —— 不确定，因为编号有两套且未对齐」。**

**三条未验（决定这一格成不成立，逐条写上）**：
1. 🔴 **selector 是否真的按声明序** —— 依据是既有的 covenant 审查经验，**未对这版编译器实测**；若排序不同，整条不成立。
2. 🔴 **哪个 offer 用哪份合约** —— redeem 从库里 offer 取，未逐条解出对应哪份 `.sil`。
3. 🔴 **未构造任何交易验证**（也不应验 —— 那是动钱）。

🔵 **显形状态（实测）**：`exchange_offers` 总行 164 · **`refund_txid` 非空 = 0**（expired 74 / cancelled 66 / timed_out 8 / completed 6 …全部为 0）。阳性对照：有 `escrow_p2sh` 的行 = 16。
⇒ **这条退款路一次都没有成功执行过。** 🔴 而"从未显形"同样兼容「路是通的，只是没人用过」—— 两者在这张表上读起来一样。

### 2.5.4 这 ~50 条命令的可调用性由什么决定 —— **进程内存边界，不是密码学边界**

**本节不重述论证，引出处**：`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md` §1（T-1 / T-2 / T-3；Bettor 2026-07-22 14:01 交叉核 file:line 全属实）。

```
T-1  relay IPC = Node fork 通道, **进程成员资格 == 全权(零认证零授权)**
     分发前唯一的门只校验 type 名 + 字段 typeof 形状, 零 caller 身份校验
     ⇒ Console 进程内任何代码都能对任意 relayId 发任意命令
T-2  console HTTP API(:3200) = **单一共享 secret**, 无身份/scope/nonce;
     同一把钥匙被 16+ 个不相关路由复用 ⇒ 任一路由的调用方 == 全 API 面的调用方
T-3  全链路零重放防护 ⇒ 一条抓到的合法请求可无限次重放
```

🔴 **明标空格（Bettor 2026-07-31 裁定的措辞，原样记，不在今天开新调查）**：

> **传输边界 = 进程内存边界 ⇒ 而【谁能在该进程内执行代码】未被独立枚举 —— 空格，未查。**

🔵 它**在范围内**（若边界是进程内存边界，那么谁能在那个进程里跑码 = 实际的能力边界，也就是"外部程序接入之后能做什么"的下一层），而本轮不查：它多半已被 M-1.2 场景 B（被攻陷 Console worker）覆盖一部分，且逐条枚举属新一轮调查。

### 2.4.5 `SWEEP_PER_BET` 定位 + `POOL_SETTLE_TX` 分支选择（J1 2026-07-31 · 只读源码 · 不与 2.4.1/2.4.3 重复）

**① `SWEEP_PER_BET` —— 它没有 covenant，所以"对应哪个 `.sil`"永远定位不到**

- redeem 由 JS 直接拼，不走 silverscript：`kasia-relay/src/lib/per-bet-p2sh.mjs:37-48` `perBetRedeem`
  逐字形状 = `PUSH32 <nonce32> ǀ OP_DROP ǀ PUSH32 <gw_xonly_pk32> ǀ OP_CHECKSIG`（68 字节）
  nonce 入 redeem 后随即 `OP_DROP` ⇒ 使每注 P2SH 唯一；`<gw x-only pk> OP_CHECKSIG` ⇒ **只有 gateway relay 能花**
- 地址 = `payToScriptHashScript(redeem)`（同文件 :58-59）

🔵 **而由此订正 §2 表里那一格**：本条的「收款与输出约束」**不是 🔴 无，而且它是这 8 条里唯一有硬约束的**——
`kasia-relay/src/relay.mjs:692` 逐字 `const gwAddr = wallet.getAddress();`
⇒ **扫回目的地由 relay 自己取，不接受调用方指定**（与其余 7 条 `outputs`/`output` 由调用方给**性质相反**）。

🔴 **而调用方仍然给两样**：`per_bet_address` + `redeem_hex`（`commands.mjs:134` / `:208`）
⇒ 调用方指定扫哪个地址并提供其赎回脚本，relay 用**自己的**密钥去签
⇒ 可被指向任意"赎回脚本以 gateway 公钥 `CHECKSIG` 结尾"的 P2SH。
🟡 而资金去向固定为 relay 自身地址 ⇒ 面是**让 relay 扫它本不该扫的地址**（噪音/关联性），**不是**资产转移给第三方。
**幂等键**：载荷无；二次调用由 UTXO 双花在共识层挡住（与 UTXO-only 那 6 条同一档）。

✅ **原「本条未验」已收（J1 2026-08-01 · 逐行读 `kasia-relay/src/lib/p2sh.mjs:318-376`）**：
`relay.mjs:687-689` 那三句注释自述**全部核实成立**——
`:325 const utxo = entries[0]` 单输入 · `:342 outputs: [new TransactionOutput(outValue, toSpk)]` 单输出 ·
`:327-328 fee` 从 `lockedAmount` 内扣 ⇒ **无 fee-input** · `:353 encodePayToScriptHashSignatureScript(sigHex)`
⇒ scriptSig = `[sig][redeem]`，**无 selector 字节**。

🔴 **而逐行读出两件注释没说的（这才是读它的收益，不是那三句对不对）**：

**① `:325 entries[0]` —— 命令叫 `sweep`（扫），函数只取【第一个】UTXO，且无 length 检查、无循环。**
```
const { entries } = await rpc.getUtxosByAddresses([p2shAddress]);
if (!entries?.length) throw ...        ← 只挡"一个都没有"
const utxo = entries[0];               ← 有 N 个也只花第 1 个，剩下 N-1 个【无声留在原地】
```
🔴 **要害不是"扫不干净"，是它扫不干净时【返回 ok:true + sweep_txid】**（`relay.mjs:699`）。
`relay.mjs:685-686` 注释说"未 sweep 由 reconciliation daemon 重试防失血"——那道兜底接的是
**「sweep 失败」**这个信号；而这里的形态是**「sweep 报成功，钱却留了一部分」**，
🔨 **两者在调用方那里读数不同：一个是错误，一个是成功。兜底若按"成不成"分诊，这一类结构上进不了它的视野。**
🟡 **边界（不许省略）**：① 我**没有读** reconciliation daemon（J2 piece④）——它到底按什么分诊，未验；
② per-bet 地址带 nonce 去重，正常应只有 1 个 UTXO ⇒ **N>1 能不能发生，我没证**。
⇒ 本条报的是**结构**（"有 N 个只花 1 个且报成功"），**不是实例**。

**② `:327 const fee = kaspaToSompi('0.001')` —— 静态常数 fee，非 mass-aware。**
🔵 而同一个仓库里，另一条钱路被明令禁止这么写：`kasia-console/src/services/pool-market-settler.js:2470`
逐字「**Bettor 红线 2 (Bettor r239): fee = mass × rate, 禁静态常数**」，并因此写了
`computeMassAwareV07RefundFee`。⇒ **同一条红线在这条路上没有落到。**
🟡 **分量压准，不报成缺陷**：这是 1-in/1-out + 68 字节 redeem 的固定小形状，
100,000 sompi 大概率**高于** mempool floor（= 多付，不是过不去）⇒ 面是**浪费**不是**卡住**。
🔴 而"大概率"是推理不是读数 —— **本节不给它一个实算值**（要给就得按 KIP-9 实算一次，那是另一格）。

**② `POOL_SETTLE_TX`：分支与版本语义由【调用方载荷】决定**（补 2.4.3——那一节讲的是 `prediction_refund_tx`）

- `kasia-relay/src/relay.mjs:866` 逐字 `settleEntrypoint: cmd.settle_entrypoint || 0`
  （注释自述：`1 = v08 settle_aggregate (entry1)`；`0 = v05/06/07 / v08 chunk`）
- 同 handler `:837`：`committee_data` **仅当** `cmd.protocol_version` 为 `'v0.6'`/`'v0.7'` 时才转发

⇒ **走哪条 covenant entrypoint、按哪个版本语义组装，取决于调用方给的字段。**
🔴 **而"选错分支会不会被 covenant 挡住"未验**——各 entrypoint 有自己的 `require`，
但那是**推理不是读数**；本节不下这个判断。

🟡 **并存版本**（`p2sh.mjs` 注释实读）：`PoolSpine.sil` / `_v06` / `_v07` / `_v08_chunk` / `PoolSide.sil` / `_v07`
分别出现在 `:810-811,845,955,1065,1195,1414` ⇒ **同一条命令在不同盘上落到不同合约**。

---

## 3. 汇总与下一步

- 本卡覆盖：类 A6(指针) + 类 B9(指针) + 类 C20(本卡新增完整) + 通用原语 16(本卡新增) = 全部 ~50 条命令，无排除项。
- **交叉发现**：16 条通用原语里 `ECDSA_SIGN`/`SIGN_INPUT_FOR_SETTLE`/`CUSTODIAL_TRANSFER` 三条实际风险模式应该并入"盲签/信任模型缺陷"那一类讨论，不该因为贴着"通用原语"标签就被认为风险更低。
- ~~**待办**：①②③三处 p2sh.mjs 深挖~~ **已闭（v0.3, J1 复核+J2 交叉核, 见 §1 回填）**。剩余待办：M-1.2 威胁模型（NWT, `0ec41001` 已交）与本卡"调用方能力/审计回执/吊销机制"三列（现状全部"无"）跟 M0c 七项设计对照，确认没有遗漏命令——排 M0c 设计批。

**关联**：`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md`（M-1 §3、D2 节）、`docs/2026-07-22-j1-covenant-domain-review-m1-1-m1-2.md`（v0.3 订正依据）、`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（B-3 例证并入目标）、频道 dev-coord-testnet 2026-07-22 06:17 派工记录。

---

> 🔴 **以下一节由 @KANet-UI 于 commit `41296217` 推入，而 J2 的 v0.7 推送(`2263fc4d`)因从本地旧基线建树而将其整节覆盖。2026-07-31 J2 发现后原样恢复，一字未改。**

## §2.4 「哪一层在拦」—— 8 条盲签命令的双层实读（v0.7 · 2026-07-30）

> **并入者**：Bettor（J2 交 covenant 侧材料 · KANet-UI 交 relay 侧实读 · KANet-UI 确认本节）
> 🔴 **本节不加表列**：加一列要动全表每一行，机械风险大于收益；而这份数据只覆盖 8 条，用一节记更准。

### 🔴 结论(而它就是 M-1 要产出的那句话)
```
对这 8 条命令：**relay 会照单签发 —— 不检查收款方、不检查金额、没有幂等。**
⇒ 拦不拦完全取决于 covenant 层，**而目前只验证了 8 条里的 2 条。**
```

### ✅ relay 层 —— 8 / 8 实读 handler
| 结果 | 覆盖 |
|---|---|
| 收款与输出约束 = **无** · 幂等键 = **无** | **8 / 8** |
| 唯一的 relay 级检查 | `prediction_refund_tx` 的 branch 必 1\|2，否则 throw —— 是**分支选择器**，不是收款约束 |
| 低于 sign 类风险的 | 两条 `*_BUILD_PREIMAGE` = build-only，不签不广播 |

🔵 **而这一格的"一致"是有信息量的**：J2 从**载荷字段推**得到"无"，KANet-UI 从**函数体实读**同样得到"无"
⇒ **不同来源 · 不同方法 · 同一结论**。（对照：两人 grep 同一个文件得到同一答案，只是同一次测量做了两遍。）

### 🔴 covenant 层 —— 2 / 8 有逐字材料，6 / 8 **没查过**
| 命令 | covenant 侧 | 强度 |
|---|---|---|
| `POOL_REFUND_MAKER_UNJOINED_TX` | `PoolSpine_v07.sil :: refund_maker_unjoined` —— require 逐字已抄 | **双层实读** |
| `POOL_SIDE_REFUND_CANCELLED_TX` | `PoolSide_v07.sil :: refund_market_cancelled` —— require 逐字已抄 | **双层实读** |
| 其余 6 条（结算类为主） | 🔴 **未读** —— 部分连"对应哪个 .sil"都未定 | **只有 relay 一层** |

🔴 **"未读" ≠ "没有防线"。** 这两者在任何表上都必须看得出区别，否则读的人会把"没查过"读成"查过了没有"。

### 🟡 三条边界（原样保留，不许在引用时省略）
```
① makerStakeAmount 的 ctor 值与库列一致 ⇒ **已验 140/140（阴性对照 0/140）**
   🔴 **作用域 = 那 140 个 pruned_expired_waived 盘**；其余 v0.7 盘没做过这个核
   🔨 一条"已验证"若不带作用域，会被按最大范围读
② 版本歧义：仓里有**两个 v0.7 家族的 .sil**，而库列只写 `v0.7` ⇒ 光看库列定不了版本
   ⇒ 本次按 `*_v07` 读。**把"它曾经存在"也写下来** —— 否则下一个人会再撞一次
③ 🔨 **引用 .sil 时引【entrypoint 名 + require 原文】，不要引行号**
   —— 行号是一次手工测量的快照，.sil 一动它就陈，而没有任何检查会发现
   （实例：本轮一条注释的行号已陈 6 行，而内容仍对；在册同族那次赔过钱）
```

### 📌 未完成（明标，不是黑洞）
```
· 6 条 covenant 侧未读 ⇒ 排 M-1 闭合之后；起点现成（本节 + 上述版本歧义注）
· 穷尽性断言（代码 51 / 覆盖 51 / 差 0）⇒ 由 KANet-UI 用**不同谓词**独立 re-count 中
```
