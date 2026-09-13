# 批 T（KCC-20 测试币）并入 silverscript v1 迁移计划 · 评估骨架 v0.1（只评估 · 不写 .sil · 不落 src）

> **Status**: DRAFT-FOR-REVIEW · **v0.7**（2026-09-13T11:4xZ · Bettor 终裁（NWT c5c88415）：**主网集瘦身 v2 采纳 = 7 + 新 2**、不开事故账、C1 角色 1 只留设计；本版按 7+2 **重算批 A 九条计数与 T3**（见紧接下方「v0.7 重算」表），重编清单同步）· v0.6（2026-09-13T11:31Z · **P8 实测**：`docs/2026-09-13-j2-p8-foldnode-seal-to-root-double-count-offline-test-v0.1.md`——脚本层双记成立（10/10），但 **fold-tree 家族在 TN12 从未上链且 (A) 重设计已废弃、relay 无任何 1→N covenant 路径** ⇒ 非活缺陷；**主网集瘦身 v2（建议）**：剔除 FoldNode / FoldNode_sealonly / PoolLeaf / PoolShard_fold / PoolLeaf_nofold_probe ⇒ 主网集 = ShardLeaf / ShardLeaf_direct / PayoutShard / PayoutShardV2 / RootClose / RootClaim / CloseZkV2 **≈7 + 新 2**；**C1 三处随 fold-tree 出集**，角色 1 修复退为"复活 fold-tree 才做"（NWT 已 GREEN 的设计留档）· v0.5（2026-09-13T11:2xZ · **H5 写法离线实证成立**：`docs/2026-09-13-j2-h5-no-token-input-proof-vectors-v0.1.md`（7 向量全部与预期一致 + harness 自检 + 超界即拒，产物 `docs/provenance/2026-09-13-j2-h5-p7-no-token-input-vectors/`）· **C1 角色 1 最小修设计**：`docs/2026-09-13-j2-c1-manual-entry-role1-design-v0.1.md`（含 seal_to_root 双记推演交 NWT 判）· T3 数字仍撤回）· v0.4（2026-09-13T11:3xZ · NWT 红队 `docs/2026-09-13-nwt-redteam-j2-batch-t-v0.3-and-recompile-list-v0.1.md` f4abb387 四条全收：① H5 不在场证明改为遍历输入按模板匹配（**P7 试编过**，§0.5 H5 行更新）· ② C1 三处手写 entry **实核 = 三选一一种都没实现**，allow 不能直接贴，列独立任务（§3 C1 行）· ③ A2/A8 **逐字节实证等价**（§T0 ⑦）· ④ T3 数字撤回不作排期依据（§3 T3 行））· v0.3 10:5xZ · NWT 红队 `docs/2026-09-13-nwt-redteam-j2-batch-t-h5-and-skeleton-v0.1.md` 4ac7a6e9：**H5「在场≠同意」升 MUST，与 H1 正交两条都要**；T0 方法论 / §2 瘦身 / §5 Q2 预案 PASS ⇒ 本版 §0.5 加 H5 行、§3 T3 按"每条共花代币入口新增显式代币输出校验 + 正反向量"重估；并挂上 42 文件 v1.0.0 全量重编清单 `docs/2026-09-13-j2-silverscript-v100-full-recompile-list-v0.1.md` 的两条新静态规则）· v0.2 T0 实证 10:5xZ · v0.1 骨架 10:3xZ · J2 · 交 NWT → Bettor → 合约/市场改造 = 钱路 ⇒ Owner 批（D-017 §3）。

## v0.7 重算 · 主网集 7 + 新 2（Bettor 终裁 · 数据 = 重编清单 `results_A.json` 按文件过滤，非重估）

**主网集（既有 7）**：`ShardLeaf` · `ShardLeaf_direct` · `PayoutShard` · `PayoutShardV2` · `RootClose` · `RootClaim` · `CloseZkV2`；**新 2**：`KanetTestToken`（T1）· `KanetTokenClaim`（T2）。**出集**：fold-tree 家族 5（FoldNode / FoldNode_sealonly / PoolLeaf / PoolShard_fold / PoolLeaf_nofold_probe，2026-06-20 架构性废弃）· rolling 系 ≈12 · 签名型 escrow 6 · 探针 8。

| 项 | 42 全量（重编清单 §2） | **主网集 7** | 说明 |
|---|---|---|---|
| A1 `entry` | 42 / 104 | **7 / 23** | |
| A2 `byte[36]` | 24 / 106 | **4 / 6** | ⑦ 已证逐字节等价 |
| A3 `as byte[N]` | 13 / 52 | **4 / 17** | |
| A4 `checkMsgSig` | 1 / 2 | **0** | |
| A5 `State {` / 外模板 struct | 13 / 23 · 16 / 31 | **4 / 7 · 5 / 16** | RootClose 1 处外模板需手工 `struct` 声明（A5-manual） |
| A6 拼接包 `byte[]()` | 12 / 90 | **2 / 19** | |
| A7 hash 参数包 | 20 / 79 | **6 / 23** | |
| A8 `byte[N](int)`→`as` | 1 / 6 | **1 / 6**（PayoutShardV2） | ⑦ 已证逐字节等价 |
| A9 spk 比较同型 | 3 / 3 | **2 / 2** | |
| 严格臂结果 | 17/42 过 | **4/7 过**（PayoutShard · PayoutShardV2 · RootClaim · ShardLeaf_direct）· 3 个只剩批 B（CloseZkV2 · ShardLeaf · RootClose，RootClose 另叠 A5-manual） | 诊断臂（中和 tx.time）6/7 过 |
| C1 新静态规则 | 3 命中 | **0** | 三处全在出集文件里 ⇒ 角色 1 只留设计 |
| 批 B `tx.time` | 24 文件 / 43 处 | **3 文件**（CloseZkV2 · ShardLeaf · RootClose；处数按计划附录 A 逐处表取） | |

**T3 重算（结构不变，数字换底）**：主网集入口 = **23 条手写 entry + 0 条 covenant 声明**（原 34 = 31 + 3；出集的 11 条里含全部 3 条 cov 声明与 C1 三处）。每条入口二选一：(A) 会与代币共花 ⇒ 读法改 `amount` + `validateOutputStateWithInputTemplate` 核代币输出（H5 MUST，向量一正一反）；(B) 不共花 ⇒ H5 不在场证明（遍历输入按模板尾部匹配，P7 已实证，向量 0/1/多/差一字节四档）。**排期口径**：T3 ≈ 23 入口 × (一段校验 + ≥2 向量)，仍是批 T 主体；具体工时等 T1 代币合约定稿（H1/H2/H3 三条 require 定型后，(A)/(B) 分类才能逐入口落）再报。

## T0 · v1.0.0 原语实证（2026-09-13 · 全部本机自跑 · 隔离 clone `scratch/_j2_silverc_v100`@`3ed9733` · exe sha256 前 16 `4378ba6557f7b7b0`（自建，与 J1 报的官方包 `ce1e0ef5…` 不是同一个二进制，语义同 commit）· 探针与产物在 `scratch/_j2_t0_probes/`）

| 问 | 结论 | 证据 |
|---|---|---|
| **① 一个 covenant 能否读另一个输入 covenant 的状态** | **能**。`readInputState(int)`（同模板）与 `readInputStateWithTemplate(idx, prefixLen, suffixLen, expectedTemplateHash)`（异模板，核模板 hash + P2SH 承诺后解码）；写回用 `validateOutputStateWithInputTemplate(...)`。**v1.0.0 自带的 `kcc20-minter.sil` 就是"控制 covenant 读代币 covenant 状态并校验其输出"这一模式的官方范例** | `docs/TUTORIAL.md:1247-1287`（v1.0.0）· `docs/kcc20-book/src/kcc20-minter-contract.md` · 探针 **P1**（KCC-0020 六字段 struct + `readInputStateWithTemplate` + `require(t.owner == OpInputCovenantId(this.activeInputIndex))`）rc1 与 v1.0.0 **都编过**，产物 4852 B 同长 |
| **② `owner_scheme 0x04` 的授权判据** | 规范侧 owner-authentication bytes = Empty（NWT 已核）；silverscript 范例里的**证明形 = 同 tx 花了 owner covenant 的一个输入**：`require(OpCovInputCount(owner) > 0)`（v1.0.0 `kcc20.sil:18`）或 `require(OpInputCovenantId(witness) == owner)`（book 版 cd3857d）。🔴 **推论（承重）**：授权只证"市场 covenant 在场"，**不证市场 covenant 同意了代币的去向** ⇒ 市场合约每一个会与代币输入共花的入口，都必须自己 `validateOutputStateWithInputTemplate` 校验代币输出（minter 范例正是这么做的），否则任何市场花费路径都是提币口。这条直接加进 §3 T3 的每处改动判据 | `silverscript-lang/tests/examples/kcc20.sil` · 探针 **P2**（两种写法同时 require）rc1/v1.0.0 都编过 |
| **③ "状态初始化须常量"（#246）打不打到我们** | **打不到**。规则 = 状态字段初值不得含运行时表达式或可执行 opcode（`tx.*`、`blake3(...)`）；ctor 参数直赋合法；**编译期整数算式在 v1.0.0 反而放宽**（rc1 拒 `init_amount + 1`，v1.0.0 过）。本机 14 个 covenant 文件 **68 个状态初值全是裸 ctor 参数引用**（`init_*`），零算式零 hash | 探针 P3a（ctor 直赋）rc1 ✓ v1.0.0 ✓ · P3b（`init_amount + 1`）rc1 ✗ `expression requires runtime evaluation` → v1.0.0 ✓ · P3c（`blake2b(init_owner)`）两版都 ✗（v1.0.0 文案 `initializer must be a constant expression`）· 上游测试 `rejects_runtime_state_initializer_expressions` / `state_initializers_accept_compile_time_integer_arithmetic`（f5c2c29）· 盘点命令见 §6 |
| **④ `tx.outputs[i].scriptPubKey` introspection + 前缀切片（H1 模板前缀锁）** | **都在**。全匹配形 `require(tx.outputs[0].scriptPubKey == byte[](new ScriptPubKeyP2SH(h)))` 与切片形 `require(spk.slice(0, prefix_len) == template_prefix)` 两版都编过。⇒ H1 (b) 可用 ctor 烤前缀集实现，**不必**改代币合约源；换编译器/换模板 = 换 ctor 重部署代币 covenant（多版本并存或迁移 tx，§0.5 H1 已述） | 探针 P4（全匹配）/ P4b（切片）rc1/v1.0.0 都编过 · TUTORIAL `slice(`:859 |
| **⑤（顺手核）#245/#246 其余三条对我们的影响** | (i) redeem script 大小上限 = `MAINNET_PARAMS.new_max_signature_script_len` = **250,000 B**，txscript 后 Toccata 脚本上限 1,000,000 B、opcode 上限 1,000,000；本机 DB 已部署最大 redeem = `payout_shards.payout_redeem_hex` **11,098 B**（722 行）、`market_shards` 450 B、`pool_bettor_sides` 2,003 B ⇒ **差 20 倍以上，不构成风险**。(ii) covenant 声明 `from/to` 界 ≤ `MAX_FOR_LOOP_ITERATIONS = 10,000`：我们只有 3 个文件用 `#[covenant(... from = max_fan_in, to = 1)]`（FoldNode / PoolLeaf / PoolShard_fold），其余 covenant 是手写 `OpCov*`；`max_fan_in` 生产值远小于 10,000。(iii) ctor 参数须常量表达式：我们的 ctor 全是 JSON 值，不涉及 | `rusty-kaspa consensus/core/src/config/params.rs:27` · `crypto/txscript/src/lib.rs:77-82,145` · DB 量命令见 §6 |
| **⑥（顺手核）08-30 批 A 迁好的 4 份 `.v1.sil` 在 v1.0.0** | `Blake2bProbe.v1` ✓（105 B）· `OpPickWitness.v1` ✓ · `CheckSigFromStackProbe.v1` ✗ `function 'checkSigFromStack' not found`（= 批 A 已知项 `checkSigFromStack→checkMsgSig`，那份副本没改到）· `WinningsPool_v1.v1` 未编（ctor 5 参跨行，我的自动喂参没抓到；它不在主网集，不追）| `scratch/_j2_t0_probes/v100_*.json` |
| **产物形** | 顶层 `schema_version / compiler_version("0.1.0") / structs / contracts.<Name>.compiled.bytecode + entries.<e>`（covenant 声明生成 `__covenant_entrypoint_auth_<f>` / `__leader_<f>` + `__delegate`）；`compiler_version` 仍 `0.1.0` ⇒ J1 §8 "pragma 保持 `^0.1.0`" 实证一致 | `v100_P1_crossread.json` |
| **⑦（v0.4 · NWT ③）A2 / A8 逐字节等价** | **A2 `byte[34]→byte[36]`：等价**。pinned 8065184 与 v1.0.0 对 `new ScriptPubKeyP2PK(pubkey(pk))` 构造的**值完全相同** = `000020` ‖ pk(32) ‖ `ac` = **36 字节**（legacy 反汇编 `<push32:pk> <push3:000020> SWAP CAT <push1:ac> CAT`；v1.0.0 `<push3:000020> <push32:pk> CAT <push1:ac> CAT`），都与 `TXOUTPUTSPK` 比较 ⇒ legacy 的 `byte[34]` 只是**声明宽度与实际不符**（编译器不校验），v1.0.0 把类型改正为真实宽度，值逐字节不变。**A8 `byte[N](int)→(x as byte[N])`：等价**。`byte[1](8)` 与 `(8 as byte[1])` 都落成 `OP_8 OP_1 0xcd(NUM2BIN)`；`byte[](1000,8)` 与 `(1000 as byte[8])` 都落成 `<push2:e803> OP_8 0xcd` ⇒ 同一 opcode、同一参数、同一输出字节。差异只在 dispatch 序言（r1）与 locals 的 OVER/PICK/DROP 排布（r3/r4）——正是计划 §5 辅证已列的四条中性剥离规则 | `scratch/_j2_t0_probes/{legacy,v100}_P8_a2.json` / `_P9_a8.json`（反汇编 `scratch/_j2_v1mig/disasm_lib.mjs`）|
| **⑧（v0.4）离线向量跑法** | v1.0.0 `cli-debugger --run-all --test-file <x>.test.json`：`tx.inputs[]` 支持 `utxo_value / covenant_id / state / constructor_args`、`active_input_index`、`outputs[].authorizing_input`。**每输入可显式喂 `signature_script_hex`**（`debugger/cli/src/main.rs:712/810` `explicit_input_sigs.push(input.signature_script_hex…)`，README 未写但代码有）⇒ **H5 的 0 / 1 / 多匹配 + 尾部差一字节四档向量可离线跑**，不必等真链；README 缺这一字段属上游文档陈旧（同 DECL.md:426） | `debugger/cli/README.md:127-190` · `main.rs:810` |

**T0 总判**：批 T **可以"并入"**（不必重排）：所需四个原语 v1.0.0 全有且实编通过；#245/#246 的新拒绝对本机 14 个 covenant 文件按盘点**零命中**。**新增的承重点是 ②的推论**——市场合约每条共花代币的路径都要校验代币输出，这把 §3 T3 从"≈48 处 value 引用改读法"扩成"每条入口加代币输出校验"，量级从"每处小改"升到"每入口一段 + 一组正反向量"。§1 里"13 个 covenant 文件大概率要改状态初始化"**撤回**。
> 派工：Bettor SendMessage 10:1xZ（(a)(b) 之后、(c) 之前）。输入：J1 `docs/2026-09-13-owner-mainnet-test-token-kcc20-free-mint-assessment-v0.1.md`（`origin/coord/j1-mainnet-testtoken` 5c6995e9）§3/§6/§8 · D-017（Bettor 五拍：合约 `sil-v1/KanetTestToken.sil`、ticker KTT、目录 `sil-v1/`、批 T 位置 = 批 A 后、批 D 前）· J2 `docs/2026-08-30-j2-silverscript-v1-migration-plan-v0.1.md` §3–§5 · 本机 `kasia-console/src/lib/*.sil` 盘点（2026-09-13 自跑）。
> 行号随 HEAD `8f1e107f`。**骨架 = 结构与量级；数字标"估"的都是估，标"实核"的才是跑过的。**

## 0. 一句话

批 T 不是"多一个合约"，是把 **stake 的载体从 KAS 输出值换成另一个 covenant 的状态字段**——这碰到 bshard 家族每一个按 `tx.outputs[i].value` 记账的地方（估 ≈48 处 / 9 文件）和四条 settler/payout 构造路径。它能否做，第一个要核的不是工程量，是 **silverscript v1.0.0 能不能在一个 covenant 里读另一个输入 covenant 的状态**（KCC-20 `owner_scheme 0x04` 的授权形靠它）；没这原语，批 T 的形要整个换。

## 0.5 硬输入（NWT 红队 verdict `docs/2026-09-13-nwt-redteam-j1-kcc20-testtoken-v0.1.md` §8 · origin 6d3f97a0 · Bettor 10:2xZ 转达）——**四条缺一条本稿自判 HOLD**

| # | NWT 条 | 本稿落点 | 现状 |
|---|---|---|---|
| H1 | (a) `owner_scheme==0x04` 只挡裸地址，挡不住自建平凡 covenant 当钱包场外流转（KCC-0020 covenant-id/v1 owner-authentication = **Empty**）⇒ **(b) 模板前缀锁 = 必要项**，不是可选升级 | **T1 加一条 `require`**：`transfer`/`mint` 的每个接收输出 `tx.outputs[i].scriptPubKey` 的前缀必须匹配 KANet 市场/领取模板前缀（introspection TN12 已有，记忆 `reference-silverscript-real-capabilities`；v1.0.0 是否仍有 ⇒ 并入 T0 ④ 核）。**维护成本**：模板前缀 = 编译产物 ⇒ 每次编译器升级/合约改动，代币合约里烤的前缀集也要重烤 + 重部署代币合约（代币是 covenant，状态可迁移但脚本不可改 ⇒ 实际是"新代币合约 + 旧币按旧规则 transfer 到新合约"的迁移 tx，或者接受多版本并存）；建议前缀集烤成 ctor 参数（T0 ③ "状态初始化须常量" 是否允许 ctor 值 ⇒ 决定能不能不改源只换 ctor） | 未设计；本稿 §3 T1 行按此改 |
| H2 | §3.5 三入口的"测试态/稳定币态"切换必须是**编译期常量 + 新部署**，不能是运行时状态标志；pause 入口预留正反向量计划 | T1：三入口的态用源码常量（`const MODE_TEST = true` 类）编译，切态 = 改常量重编 + 新合约；**不**放进 KCC-20 状态字段、不放进 `extension_commitment`。向量：pause 入口在测试态"任何输入都过"（正）+ "构造稳定币态常量重编后同输入被拒"（反，跨两个编译产物比） | 未设计 |
| H3 | `borrow_scheme` 部署时显式钉死 `0x00 disabled/v1` + 负向量（KCC-0020 §5 borrowed receive 是第二条转移路径） | T1：`mint`/`transfer` 的每个 `next_states[i].borrow_scheme == 0x00` 硬 require；负向量 = 构造 `borrow_scheme=0x01` 的接收态期望拒 | 未设计 |
| H4 | §6-4 "领取 covenant 名下"：KCC-0020 状态里**没有"名下"身份概念** ⇒ 绑定未设计，NWT 判 HOLD | **T2 必须单独开一节（verify-value-source 承重点）**：赢家身份怎么进领取 covenant——候选形：领取 covenant 的 ctor 烤 `winner_pubkey`（状态初始化须常量 ⇒ 可行性归 T0 ③）+ 花费入口 `checkSig(winner)`；代币状态 `owner = 领取 covenant-id`。"余额 = 名下求和"就是"以 `winner_pubkey` 为 ctor 参数的所有领取 covenant 的 amount 之和"——是**链下索引**，不是链上概念，稿里要写明。且结算 tx 里"谁是赢家"这个值必须由 settler 从本机 relay 自取的链值/共识结果派生，不收 caller 标量（接位档 ctx-hooks 纪律） | 未设计；本稿 §3 T2 行按此扩 |

| **H5（v0.3 · NWT 4ac7a6e9 升 MUST）** | `owner_scheme 0x04` 的授权判据（`OpCovInputCount(owner) > 0` / `OpInputCovenantId(witness) == owner`）只证市场 covenant **在场**，不证它**同意**这笔代币去向；市场合约多入口（结算/投票/fold/close/register…），**任何一条**未显式校验代币输出的入口 + 一笔代币转移拼进同一 tx = 提币口。与 H1 正交：H1 管目的地形态，H5 管本次交易的意图 | **T1**：`mint`/`transfer` 的 0x04 判据不变（防伪造持有形态）。**T3**：主网集每个文件、每条**会与代币输入/输出共存于同一 tx** 的 spend 分支，必须 `validateOutputStateWithInputTemplate(...)` 显式核代币输出的 `owner / amount / owner_scheme / borrow_scheme`；不会共花代币的分支要能**证明**它不会。🔴 **v0.4 订正（NWT f4abb387 ① MUST-FIX）**：不在场证明**不能**写 `require(OpCovInputCount(token_cov) == 0)`——`OpCovInputCount` 吃具体 covenant-id，多实例代币模型下市场合约不可能预知要查哪个 id。**改为遍历本 tx 输入、按代币模板字节匹配**：P2SH 输入的 `scriptPubKey` 只是哈希，模板字节在 **`tx.inputs[i].sigScript` 尾部**（v1.0.0 grammar `input_field` 有 `sigScript`；`readInputStateWithTemplate` 的 prefix/suffix 就是按 sigScript 尾部定位的）⇒ `for (i, 0, tx.inputs.length, max_ins) { ss = tx.inputs[i].sigScript; if (ss.length ≥ L && ss.slice(ss.length−L, ss.length) == token_tmpl_suffix) found = true } require(!found)`，`token_tmpl_suffix` 与 H1 (b) 同源烤进 ctor。**探针 P7 `scratch/_j2_t0_probes/P7_no_token_input.sil` v1.0.0 编过（217 B）**。向量：0 / 1 / 多个匹配输入三档 + 一个"尾部差一字节"的弱注入臂；离线跑法见 §T0 ⑧。**验收**：每条共花分支一正一反向量（反 = 同入口条件全满足、只把代币输出改到别的 covenant / 改金额 ⇒ 必须拒）。官方 `kcc20-minter.sil` 的 `checkMinterKcc20NewState` / `checkRecipientKcc20NewState` 就是这个形 | 未设计；§3 T3 行按此重估 |

NWT §8 另两条（§3 领取绑定、§6 drain + 重新同步措辞）不阻塞开始设计，但要在批 T 稿各开一节交 NWT 审；§3 = 上表 H4，§6 归 KANet-UI 退役 runbook（已转）。

## 1. 与 J1 §8 两个事实的对账（rc1 → v1.0.0 重跑）

| 项 | J1 §8 事实 | 对我计划的影响 | 量级 |
|---|---|---|---|
| 编译器版本 | v1.0.0 = `3ed9733`（09-09）；`COMPILER_VERSION` 仍 `"0.1.0"`；`pragma ^1.0.0` 被拒 | 计划 §3「正式版切 `^1.0.0`」**反过来**：42 个 `.sil` 的 `pragma silverscript ^0.1.0` **保持不动**，等上游升常量再切；`sil-v1/` 目录不改 pragma 只改语法 | 0 行代码改；计划文本改 1 段 |
| #245/#246 新增 ≈2000 行静态拒绝（资源上限 / covenant 展开界 / 脚本限制 / **状态初始化须常量**） | 批 A/B/C 在 rc1 上的离线编译**全部作废重跑**——批 A 的源改动（`entry` 104/42、`byte[36]` 106/24、`x as byte[N]` 42/13、`checkMsgSig` 2/1）语法在 v1.0.0 不变，**不用重做**；要重做的是**编译 + 向量 + 新拒绝的分诊** | **估**：重编 42 文件 = 分钟级；分诊 = 新一批"C′"——按"状态初始化须常量"这一条，本机盘点带 `#[covenant`/covenant 字样的 **13 个文件**（CloseZkV2 / FoldNode / FoldNode_sealonly / PayoutShard / PayoutShardV2 / PoolLeaf / PoolLeaf_nofold_probe / PoolShard_fold / PoolSpine_v08_chunk / PoolSpine_v0_7_1 / ShardLeaf / WinningsPool_v1 / …）**大概率每个都要改状态初始化写法**；其余 29 个非 covenant 文件估批 A 后直接过（J1 实核 Blake2bProbe 1/42 已过）。"covenant 展开界"最可能打到 `PoolSpine_v08_chunk.sil`（333 行、28 处 value 引用、7 处 covenant）与 `PayoutShard*`（≈400 行）。**⇒ 🔴 v0.2 撤回本格的"13 个文件大概率要改状态初始化"：T0 ③⑤ 实证该规则与脚本上限对本机 14 个 covenant 文件零命中；剩下真正要重跑的只是"重编 + 向量"，源改动不重做。** 42 文件全量重编仍值得做一次拿完整清单（批 A 语法改动只有 4 份副本做了，其余 38 份要先做批 A 才能进 v1.0.0） |

## 2. 迁移集本身先瘦身（D-017 之后，42 不再是 42）

TN12 退役 + D-001「rolling 死路」⇒ 下面这些**不需要迁到主网**（只作 pinned 编译器取证保留）：
- 探针 9 个：`Blake2bProbe / CheckSigFromStackProbe / ProbeC_selfonly / RootStub_probe ×5 / PoolLeaf_nofold_probe / PoolSpine_i_proto`（已部署 TN12 的探针字节码走 pinned 复现，D-016 注记不变）。
- rolling 系（PoolSpine v06/v07/v0_7_1/v08_*、PoolSide 全系、PoolRoot、PoolSpine.sil）≈12 个：D-001 已裁死路，TN12 未结盘 Owner 不逐盘收摊 ⇒ 主网**不部署**。
- 签名型 escrow（PredictionEscrowUnanimous5 / ConsensualMid / PredictionPoolUnanimous3 / OracleStake_v1 / WinningsPool_v1 / RefundClaim）≈6 个：主网波 2「签名型结算小额」若仍要它们，才迁；**押注换成代币后它们的 stake 逻辑也全变**（同 §3），不是"直接迁"。
- **真正的主网集 = ZK/bshard 家族 ≈9–10 个**：`PoolLeaf / ShardLeaf / ShardLeaf_direct / FoldNode(+sealonly) / PoolShard_fold / PayoutShard / PayoutShardV2 / RootClose / RootClaim / CloseZkV2`。
⇒ 🔵 **请 Bettor 拍**：批 T 的合约面按"主网集 ≈10 + 新 2（代币 + 领取）"算，不按 42。42 的批 A/B/C 离线重跑仍做（取证 + 验证编译器），但**只有主网集进批 D**。

## 3. 批 T 的工程面（按依赖顺序 · 全部估）

| # | 件 | 落在哪 | 改什么 | 量级（估） | 钱路/Owner 批? |
|---|---|---|---|---|---|
| **T0 前置核**（不核不动） | silverscript v1.0.0 原语 | 上游 `docs/DECL.md` + `TUTORIAL.md` + `tests/examples/kcc20.sil`（旧布局，只看语法） | ① 一个 covenant 能否读**另一个输入**的 covenant 状态（`tx.inputs[i].state`/等价物）；② `owner_scheme 0x04` 的授权判据规范原文（是"同 tx 里有该 covenant-id 的输入"还是别的）；③ 状态初始化须常量 ⇒ 市场 covenant-id 怎么烤进代币状态（ctor 参数是否算"常量"）；④ `tx.outputs[i].scriptPubKey` introspection 在 v1.0.0 是否仍在（H1 模板前缀锁靠它） | 半天读文档 + 4 个最小 `.sil` 试编（离线） | 否 |
| T1 | 代币合约 `sil-v1/KanetTestToken.sil` | 新文件 | KCC-0020 六字段布局；`mint` 无校验；`transfer`/`mint` 的 `next_states[i].owner_scheme == 0x04`（H1 (a)）+ **接收输出 scriptPubKey 前缀 ∈ 模板集**（H1 (b)，必要项）+ `borrow_scheme == 0x00`（H3）；三个预留入口的态 = **编译期常量**（H2）；行为向量每 require 一正一反 + H2/H3 负向量 | ≈150–220 行 + 向量 ≈14 条 | **是**（D-017 §3 "代币合约改造 = 钱路"） |
| T2 | 领取 covenant（winner claim） | 新文件 `sil-v1/KanetTokenClaim.sil`（名待拍） | 只许 0x04 持有 ⇒ 赢家"钱包余额" = 其名下领取 covenant 的 amount 之和（J1 §6-4）；持有者 = bettor pubkey 但载体仍是 covenant；花费 = 再 transfer 到别的市场 covenant | ≈60–100 行 | **是** |
| T3（**v0.3 按 H5 重估**） | 市场合约 stake 读法 **+ 每条共花代币入口的显式代币输出校验** | 主网集 11 文件（含 ShardLeaf_direct）；心智模型从"改 ≈48 处 value 读法"换成"**按入口**"：本机盘点 `grep -c "entry \|#\[covenant"` 主网集 **入口 34 条 = 31 手写 entry + 3 covenant 声明**（CloseZkV2 4 · PayoutShard 5 · PayoutShardV2 5 · RootClose 4 · PoolShard_fold 4+1 · PoolLeaf 2+1 · ShardLeaf 2 · ShardLeaf_direct 2 · FoldNode 1+1 · FoldNode_sealonly 1 · RootClaim 1，取自重编清单 A1 逐文件计数） | 每条入口二选一：(A) 会共花代币 ⇒ 读法改 `amount` + `validateOutputStateWithInputTemplate` 核代币输出（owner/amount/owner_scheme/borrow_scheme）；(B) 不共花 ⇒ `require(OpCovInputCount(token_cov) == 0)` 显式排除。另加 **C1**（重编清单 §3：FoldNode/PoolLeaf/PoolShard_fold 的手写 entry 在 v1.0.0 须 `allow` 注解或改 cov-bound 声明）与 H5 同一批人审——两者都是"这条入口的组校验谁负责"的问题。🔴 **v0.4 C1 实核（NWT ② 的前置 MUST）**：读了三处正文（`FoldNode.sil:82 seal_to_root` · `PoolLeaf.sil:59 register_append` · `PoolShard_fold.sil:53 register_append`）——**三处都没有任何 covenant 组检查**：既无 `require(OpCovInputCount(cov_id) == 1)`（角色 1 拒绝共享执行），也不判 input zero（角色 2/3），只做各自的 `validateOutputState*` + value weld。⇒ DECL.md:321-335 的三选一**一种都没实现**，`allow` 注解**不能直接贴**（贴了 = 编译器不再查、而手写逻辑本来就没查）。**最小修 = 角色 1**：三处入口第一行加 `require(OpCovInputCount(OpInputCovenantId(this.activeInputIndex)) == 1);`（本入口拒绝与同 covenant 其它输入共花）+ 注解；这是**语义新增**（批 C），向量 = 单 covenant 输入通过 / 同 cov 两输入其一跑手写 entry ⇒ 拒。🟡 顺手发现请 NWT 判：`seal_to_root` 无组检查时，若同一 tx 里另一 FoldNode 输入跑 `fold` leader（会把本输入的 pool_value 折进新 leaf），而本输入又要求 root 输出 `value == pool_value`，同一笔 pool_value 会被记两次——是否构成账面膨胀取决于 root 模板的 covenant 归属与外部补款，v0.4 不下结论，列为 C1 修复前的红队项 | **v0.4 撤回数字**（NWT ④）：不在场证明从"一段 require"变成"遍历 max_ins 个输入的模板匹配"，单入口成本上升，向量要测 0/1/多匹配三档；三条 C1 入口叠角色 1 修复。**T3 数字等 P7 向量（§T0 ⑧）与 C1 修法落定后重报，现估不作排期依据**；结构不变：主网集 11 文件重审级，是批 T 主体 | **是** |
| T4 | 下注入口（stake 进场） | `api/pool.js`（bet 路径）+ `kasia-relay/src/relay.mjs:6xx` per-bet P2SH 派生 + `per-bet-p2sh.mjs` | 现在 = bettor 付 KAS 到 per-bet P2SH；改为 bettor 自 `mint`（免费）+ 把代币 covenant 的 owner 烤成市场 covenant-id；per-bet P2SH 是否还需要（隔离付款根的动机是 KAS 并发花费，代币下没有这个问题）待 T0 ② 答完再定 | 中：一条新 tx 构造路径 + 一条旧路径退役 | **是** |
| T5 | settler / payout 构造 | `services/pool-market-settler.js`、`lib/pool-shard-settle.mjs`、`lib/bshard-close-transport.mjs`、`services/bettor-prediction-settler.js`（本机 grep 命中的 4 个 KAS 输出构造文件） | 赔付输出 = 代币 `transfer` 到 T2 领取 covenant；KAS 输出只剩 fee；`check_utxo_landed` 的"落链"判据从 KAS UTXO 改为代币 covenant UTXO | 中-大：4 文件；且 (c) 稿的 NO-TX 两处在同一文件（`bettor-prediction-settler.js:198/216`），**落码顺序：先 (c) 后 T5** | **是** |
| T6 | ZK 侧 | `services/zk-prove-worker.mjs`、CloseZkV2 的 guest 输入（RISC0） | 证明里绑定的 pool 总额/份额从 KAS 值改为代币 amount；VK 不变则 guest 变 ⇒ VK 变 ⇒ 链上 `OpZkPrecompile` 的 VK 承诺全换 | 大：guest 改 + VK 重生成 + 全套 E1 字节证重做（D-016 那套） | **是** |
| T7 | 账本/DB | `DATABASE.md` + migrate（fund_lock / spending ledger / 余额面全是 KAS 口径） | 新增代币 covenant 记账表或给现表加 `asset` 列；G5 口径（不报盈亏）不变 | 中 | 改表走 DATABASE.md 规范；钱路口径 Owner |
| T8 | faucet → mint | `api/faucet*`（J1 §3.4） | 直接发链上 `mint` | 小 | 是（发 tx） |
| T9 | UI/操作面 | KANet-UI 域 | 余额 = 领取 covenant 求和；页面文案「测试币·无价值·免费无限铸造」每次都带 | 中 | 用户面 ⇒ Owner |

**依赖**：T0 → T1 → (T2 ∥ T3) → T4 → T5 → T6；T7 与 T3 同期；T8/T9 尾随。**批 T 在计划里的位置**（Bettor 拍 = 批 A 后、批 D 前）成立的前提：T0 通过；T3 的 ≈48 处与批 C′（v1.0.0 新拒绝分诊）**同一轮过手**，不要两次打开同一批文件。

## 4. 这稿现在就能做、且不花钱的三件

1. **v1.0.0 二进制重编 42 文件拿错误清单**（离线；`versioned-builds/` 独立目录，禁 `target/release` 漂移）——把 §1 的"估"变成"实核"。
2. **T0 三问**：读 DECL.md/TUTORIAL.md + 3 个最小试编。
3. §2 瘦身清单给 Bettor 拍。

## 5. 请 NWT 判 / 请 Bettor 拍

1. §2：主网集按 ≈10+2 算、rolling 系与探针不进批 D——是否成立。
2. T0 ①：若 v1.0.0 **没有**跨输入读 covenant 状态的原语，批 T 的替代形（例：市场 covenant 自己持有 amount 字段、代币只作"收据"）要另起一稿，本稿 §3 作废重写。**这一条决定批 T 是"并入"还是"重排"。**
3. T4 的 per-bet P2SH 去留。
4. 落码顺序：(c) NO-TX 修 → T5，两稿同文件。

## 6. 没核到的 + 自查命令

- §3 全部量级为估；≈48 处 value 引用是 `grep -c "\.value\|amount"` 的粗数，含 fee/dust。
- KCC-0020 规范（`kaspanet/kccs`）原文本机没有 clone，`owner_scheme 0x04` = Empty 那句按 NWT 红队稿 §2 转述；silverscript 范例用的仍是旧四字段布局（`ownerIdentifier/identifierType/amount/isMinter`），六字段布局的 P1 struct 是我照规范转述写的，**字段顺序未对规范原文核**。
- `WinningsPool_v1.v1.sil` 未在 v1.0.0 编（ctor 跨行）；不在主网集。
- 自查（行号/数字会陈，跑一遍推翻本稿）：
  ```bash
  # 状态初值是否全为裸 ctor 参数（应全 CONST）
  cd kasia-console/src/lib && for f in CloseZkV2 FoldNode FoldNode_sealonly PayoutShard PayoutShardV2 PoolLeaf PoolShard_fold PoolSpine_v08_chunk PoolSpine_v0_7_1 ShardLeaf ShardLeaf_direct WinningsPool_v1 RootClose RootClaim; do awk '/^[[:space:]]*(entry|function|#\[)/{exit} /^[[:space:]]*(int|bool|byte(\[[0-9]*\])?|pubkey)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/{rhs=$0;sub(/^[^=]*=[[:space:]]*/,"",rhs);sub(/;.*$/,"",rhs);print (rhs~/^[A-Za-z_][A-Za-z0-9_]*$/?"CONST":"EXPR"), FILENAME, rhs}' $f.sil; done | sort | uniq -c | awk '{print $1,$2}' | sort -k2 | uniq -c
  # 已部署 redeem 最大字节数 vs 250,000
  cd kasia-console && node -e "const D=require('better-sqlite3');const db=new D('D:/kanet-tn12/kasia-console/data/console.db',{readonly:true});console.log(db.prepare('SELECT MAX(LENGTH(payout_redeem_hex))/2 b FROM payout_shards').get())"
  # 探针重跑（v1.0.0 自建 exe）
  cd scratch/_j2_t0_probes && for p in P1_crossread P2_ownerproof P3a_init_ctor P3b_init_expr P3c_init_hash P4_spk_lock P4b_spk_prefix_slice; do ../_j2_silverc_v100/target/release/silverc.exe $p.sil --ctor $p.args.json -o /dev/null; echo "$p exit=$?"; done
  ```
