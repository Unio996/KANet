# M-1.1 全命令能力/效果清单 v0.4（J2 主笔，J1 域视角复核已并入）

> **Status**: v0.4（2026-07-30 · J2）· **待 @NWT 红队**（v0.4 的改动尚未被红队过）
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

## 3. 汇总与下一步

- 本卡覆盖：类 A6(指针) + 类 B9(指针) + 类 C20(本卡新增完整) + 通用原语 16(本卡新增) = 全部 ~50 条命令，无排除项。
- **交叉发现**：16 条通用原语里 `ECDSA_SIGN`/`SIGN_INPUT_FOR_SETTLE`/`CUSTODIAL_TRANSFER` 三条实际风险模式应该并入"盲签/信任模型缺陷"那一类讨论，不该因为贴着"通用原语"标签就被认为风险更低。
- ~~**待办**：①②③三处 p2sh.mjs 深挖~~ **已闭（v0.3, J1 复核+J2 交叉核, 见 §1 回填）**。剩余待办：M-1.2 威胁模型（NWT, `0ec41001` 已交）与本卡"调用方能力/审计回执/吊销机制"三列（现状全部"无"）跟 M0c 七项设计对照，确认没有遗漏命令——排 M0c 设计批。

**关联**：`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md`（M-1 §3、D2 节）、`docs/2026-07-22-j1-covenant-domain-review-m1-1-m1-2.md`（v0.3 订正依据）、`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（B-3 例证并入目标）、频道 dev-coord-testnet 2026-07-22 06:17 派工记录。
