# GO-F：主网 covenant 金丝雀设计页 v0.1（2026-09-14 · KANet-UI · Bettor 1191 派工 · 只写不执行）

> **Status: DRAFT**。权威：`docs/2026-09-14-nwt-redteam-rootclose-tokenization-and-mainnet-covenant-blocker-v0.1.md`（GO-F 这个名字的出处——该文档结论"本项目确实从未对真实主网节点广播测试过一笔 covenant 交易，端到端从未验证"，Bettor 明确认可，"已立 GO-F 金丝雀验证补上"）。**本页只设计，不执行任何广播/转账/签名**。执行门分两层，不能合并：① 本页 → NWT 红队审 → 方向批准（"设计可以照这个做"）；② **广播动作本身须 Owner 单独批**（Bettor 1191 原话），即便①已过，广播前仍要另一次独立的 Owner GO，不能"设计批了就等于广播批了"。

## 0. 背景与阻断前提

### 0.1 为什么现在做这件事
`docs/2026-09-14-nwt-redteam-rootclose-tokenization-and-mainnet-covenant-blocker-v0.1.md` 独立核实（`consensus/core/src/config/params.rs:269/:370/:724`，官方 `v2.0.1` 标签）：官方主网 `MAINNET_PARAMS.toccata_activation = ForkActivation::new(474_165_565)`，covenant 相关校验由 `toccata_activation.is_active(block_daa_score)` 门控（`tx_validation_in_utxo_context.rs::check_scripts()`）。**当前主网 DAA 远超这个阈值**（本人本次会话独立探针核实：`daa=539153306`，见标准 hourly probe 记录，`539,153,306 > 474,165,565`）——covenant 在官方主网上已经激活很久了，不是"即将激活"或"刚激活"。**唯一站得住的缺口**：本项目自己的代码，从未真的对一个真实主网节点广播过一笔 covenant 交易——所有既有 covenant 相关证据（P9/P10/P11/P12 探针、`.test.json` 向量、`cli-debugger` 运行期向量）都是**离线**的（`cli-debugger` 本地跑，不碰任何真实 RPC 节点），本项目现有唯一一处**真实广播过** covenant genesis 的代码路径（`kasia-relay/src/lib/p2sh.mjs:1865` `unlockBshardGenesisMintPayout()`，走 `populateGenesisCovenants`+`rpc.submitTransaction`）历史上只在 TN12 跑过，从未指向过官方主网节点。GO-F 要补的就是这一个具体、狭窄的缺口："我们的代码构造的 covenant genesis 交易，官方主网节点真的会接受"——不是重新验证 covenant 机制本身（那是共识层的事，源码已经核对过），是验证**我们这边的实现**。

### 0.2 阻断前提（本页写清楚，不代为满足）
1. **身份必须先存在且已启动**——GO-F 需要一个已经持有真实 KAS、relay 进程已在跑的 mainnet 身份来签名+广播（见 §1）。这个身份来自迁移第 2 批（`docs/2026-09-14-kanetui-mainnet-migration-batch2-small-exec-v0.1.md`），**本页写作时第 2 批尚未执行**——GO-F 的广播动作不能早于第 2 批验收通过。
2. 本页（设计）本身不需要等第 2 批完成就能写/审，但**广播执行**必须排在第 2 批之后。
3. NWT 2-1 热钱包硬上限（`RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800`/`_TOTAL_MAX_KAS=1000`）已部署生效（`docs/provenance/2026-09-14-kanetui-hotwallet-mainnet-deploy/`）——GO-F 用的身份余额（1.59 或 7.46 KAS）远低于两个上限，不受影响，只是记录这条已满足的前提，不是待办。

## 1. 身份

**用迁移进来的小额账号**（迁移 runbook `docs/2026-09-14-kanetui-mainnet-account-migration-runbook-v0.1.md` §8、GO-E 清单 `docs/2026-09-13-kanetui-mainnet-relay-identity-funding-checklist-v0.1.md` 状态注记已定的同一条决定）：`Bettor`（1.59303211 KAS）或 `Trader-A`（7.45579730 KAS）二选一——两者选哪个对本页设计没有实质影响，留给 Bettor/Owner 定，本页不代为拍板。`Trader-B` 因 Rule 1 零引用 grep 命中源码硬编码常量，**永不能**用作这个用途，此前已定，本页不重复展开判据本身。

### 1.1 GO-E 纪律怎么用在这里——一个需要 Bettor/NWT/Owner 明确确认的分歧点

Bettor 1191 原话"走 GO-E 九步纪律（手动、一次性）"——**这句话有两种读法，本页必须先把分歧摊开，不能自己悄悄选一种**：

- **读法 A（本页采纳的读法）**：GO-F 的**广播这个动作本身**借用 GO-E 的**纪律模式**——手动触发、零自动化接线（不写 cron/watchdog 去做这件事）、每一步留证据、不因为"反正只是个小动作"就跳过任何一步。这跟 GO-E 清单里"ephemeral manual relay 五条硬门"是同一种精神，但**不要求**逐字套用 GO-E §5 的九步表格（那张表是为"一次性验证身份、验证完即删"这个场景设计的）。
- **读法 B（本页明确不采纳，原因如下）**：逐字套用 GO-E 九步流程，包括**步骤⑧ DELETE**——即 GO-F 广播用完这个身份就把它从 `relay_nodes` 删掉。**这条在当前语境下会跟迁移本身的目的冲突**：`Bettor`/`Trader-A` 是 Owner 1168 决定"所有已知账户都要导入"里的正式一员，迁移 runbook 把它们当作要长期留存的迁移结果，不是"验证完就扔"的一次性马甲身份——GO-E 九步表原本设计给的是一个**专门新建、只为验证用**的身份（v0.1-v0.4 那版"新建一行"），现在改成"复用刚迁移进来的这一行"之后，字面上还留着"步骤⑧ DELETE"这句话，但**没有人重新审过"删掉这一行"这个后果在新语境下还对不对**——迁移 runbook §8 那条状态注记只说"流程本身不变，换个行"，没有正面回答"这一行还要不要在验证完之后被删掉"这个问题。

**本页的立场**：GO-F 广播完成后**不删除** `Bettor`/`Trader-A` 这一行——它是迁移结果的一部分，删掉等于撤销了第 2 批迁移的一部分工作，这不是 GO-F 该做的决定。本页只借用 GO-E 的"手动、零自动化、留证据"这个纪律精神，不套用"用完即删"这个动作。**这个判断本页给出但不视为定论**——是否要重新审一次"迁移进来的账号，验证用途结束后要不要删"这个问题（跟 GO-F 本身无关，是任何"复用迁移账号做一次性验证"场景都会遇到的通用问题），留给 Bettor/NWT/Owner 在审这份设计页时明确表态，本页不代为拍板，只负责把分歧点摆出来不藏着。

## 2. 交易设计：选 KanetTestToken genesis，不新造 probe covenant

### 2.1 为什么选 KTT genesis
- `KanetTestToken`（`kasia-console/src/lib/sil-v1/KanetTestToken.sil`，设计文档 `docs/2026-09-13-j2-t1-kanet-test-token-kcc20-contract-design-v0.1.md` v0.5 A″ 定稿，NWT 红队审 `docs/2026-09-13-nwt-redteam-j2-t1-token-sil-implementation-review-v0.1.md` GREEN）**genesis 本身零权限、零签名、零上限**——设计文档原话（§2.1）："铸造 = 构造一个输出...用任意资金输入授权（`GenesisCovenantGroup`，同 relay `p2sh.mjs:1885` 形），得到新 covenant-id。零校验、零签名、零上限 = Owner 裁定 4"。共识层面：`covenant_id` 由共识重算比对（`WrongGenesisCovenantId` 规则，`covenants.rs::CovenantsContext::from_tx`，NWT/J2/源码三方互证），但**genesis 输出自己声明的状态字节完全不受检**（"genesis outputs are validated but do not populate covenant contexts"）——**这正好匹配 Bettor 要求的"免权限、dust级金额、无第三方受害者"**：genesis 这个动作不需要任何人签名/批准就能构造，不触碰除广播者自己以外的任何账户，天然没有第三方受害者。
- **本仓不存在比 KTT genesis 更简单的可部署候选**：`ProbeOutCovId.sil`/`ProbeBoutCombo.sil`/`ProbeBoutLoop.sil`/`ProbeBoutCov.sil`（`docs/provenance/2026-09-13-j2-t1-token-sil-implementation/`）都是 V-T-6 调试期用的**离线 debugger 专用隔离探针**，从未编译成可部署产物、不接 wallet、不是为真实广播设计的——拿它们改造成能广播的东西，工作量比直接用已经审过、已经编译好字节码（`KanetTestToken.compiled.json`，3863 B，NWT 独立重编字节一致）的 KTT 更大，且要重新走一轮红队审，不划算。
- **本页明确限定范围：只做 genesis，不调用 `transfer`**——KTT 的花费路径（`transfer`）有一个已知未闭合的坑 `V-T-6`（`docs/provenance/2026-09-13-j2-t1-token-sil-implementation/KNOWN-GAP-V-T-6.md`，状态 OPEN：`binding=cov` 框架下 `OpOutputCovenantId`+`validateOutputStateWithTemplate` 组合失败，隔离探针单独测两个原语都过）——**genesis 阶段不执行任何脚本**（见上一条），跟 `transfer` 的这个坑完全无关，选择"只 genesis 不 transfer"让 GO-F 天然绕开一个尚未解决的已知问题，不是碰巧躲过、是刻意这样设计范围。

### 2.2 具体构造（设计层面，不是可执行代码——脚本本身需要另派实现+另经 NWT 审）
KTT 的 genesis 输出（设计文档 §2.1 原话）：
```
scriptPubKey = P2SH(prefix ‖ encode(State{
  amount, owner, owner_scheme, borrow_scheme, borrow_guard, extension_commitment
}) ‖ suffix)
```
六个状态字段（设计文档 §1）里，**本页建议 GO-F 的 genesis 故意构造成"天生不可花"的实例**：
- `owner_scheme` 填 `0x04` 以外的值（如 `0x00`），或 `owner` 填任意/全零 32 字节——设计文档 §2.1 自己写明这样的结果"这些实例不可花（§2.2 只认 0x04 + 模板在场），等于自毁；不是漏洞，是免费无限的代价"。
- **这样做的好处对 GO-F 场景是双重的**：① 天然、永久排除任何人（包括我们自己）误花这笔 canary 输出的可能，不需要额外的"锁定"机制；② §5 的回滚/失败处置章节因此大幅简化——不存在"这笔资金后续要怎么处理"的问题，dust 从一开始就是有意、可预期、有界的一次性沉没成本，不是"卡住的资金"。
- `amount` 字段填一个任意小整数（如 `1`）——这是 KTT 内部的代币供应量记账单位，**跟这个 UTXO 本身承载的真实 KAS 面值（sompi）是两回事，不要混淆**（见 §4 成本核算专门强调这条）。
- 构造机制：镜像 `kasia-relay/src/lib/p2sh.mjs:1865` `unlockBshardGenesisMintPayout()` 已经验证过的模式——`populateGenesisCovenants([new GenesisCovenantGroup(...)])` + 签名 + `rpc.submitTransaction`，只是把目标脚本/状态编码换成 KTT 的（`KanetTestToken.compiled.json` 的 bytecode + 上面这组状态字段），不是从零设计广播机制，是复用本仓已经在 TN12 真实跑过的同一套 genesis 广播代码形状，换一个目标合约。
- 这段构造逻辑本身要写成**一次性、经 NWT 审查的脚本**（同迁移 runbook §3.1 对一次性高权限脚本的一贯要求），本页只给设计，脚本代码不在本页交付范围内，需要另派。

### 2.3（可选）第二枚金丝雀：post-Toccata 大 witness
Bettor 1191 item③要求验证"post-Toccata 大 witness（>10,000 B）被接受"，可选加一笔。背景核实（GO-F 出处文档 §3-4）：`max_signature_script_len` 是 `ForkedParam`（`params.rs:472-473`），Toccata 前 10,000 字节、**Toccata 后 250,000 字节**——当前主网早已过 Toccata（见 §0.1），理论上限是 250,000 字节。**本仓目前没有任何文档专门论证过"为什么要用一笔真实广播去验证这个新上限"**——这是本页新增的设计内容，不是抄自哪份既有文档，理由是：GO-E 清单里已经有先例（步骤⑦"实测兜底，不能只信静态审计"，NWT 抓到过一次静态列举有盲区被漏掉的真实坑）——只读 `params.rs` 源码确认新上限是 250,000，跟真的广播一笔超过旧上限（10,000）、验证真实主网节点确实按新上限接受而不是按旧上限拒绝，是两件不同确信度的事，同一种"读代码不能代替真实跑一次"的纪律,GO-F 既然要做第一笔就顺手把这条也测掉，比日后再单独立一次金丝雀划算。
- 构造方式（设计层面）：同 §2.2 的 genesis 交易，但把签名脚本人为填充到超过 10,000 字节（例如用无意义但语法合法的填充数据撑大 `sigScript`，具体填充方式留给实现脚本决定，只要求最终字节数明确超过 10,000 且明确低于 250,000，取一个有安全边界的中间值如 ~20,000-50,000 字节，不贴着上限走）。
- 这一笔是**可选**的——如果 Owner/Bettor 认为第一笔（普通大小的 genesis）已经足够回答"我们的实现能不能被主网接受"这个核心问题，可以先只做第一笔，第二笔另择时机。本页不强制两笔必须同批做。

## 3. 验证点

1. **节点 accept（mempool）**：`rpc.submitTransaction({transaction, allowOrphan:false})` 返回值本身（含 txId）是第一道确认——本仓已有 `p2sh.mjs:97` 附近的 mass-observe 包装模式（成功后查 `getMempoolEntry` 做权威 mass 对照）可以直接复用同一个观测模式，不需要另外设计一套"怎么确认进了 mempool"的机制。
2. **节点 accept（上链）**：等待若干确认（沿用本仓已有的"落地确认"惯例，同结算/`bshard`路径用的 `check_utxo_landed`/`minDepth` 判据，`pool.js`/`bshard-close-enforce.mjs` 已有先例——不新发明一套确认深度判据）。
3. **`OpCovenantId` 读回非零**：广播后用 `getUtxosByAddresses` 查这笔 genesis 输出对应的 UTXO，读 `entry.covenantId`（同 `kasia-relay/src/lib/p2sh.mjs:1850` `_psInputCovId()` 已经在用的字段路径——真实生产代码已经在用这个读法，不是新设计）。**光"非零"不够严谨**——本页要求同时**独立重算期望值**（`covenant_id(funding.outpoint, [genesis_output])`，同 `unlockBshardGenesisMintPayout()` 头注释描述的算法）并逐字比对，不是看到非零就算过，要看到"非零且等于我们自己独立算出来的那个值"，这才是真正验证了共识层的诚实性检查确实按预期工作，不是只验证了"这个字段有被填"这个更弱的事实。
4. **covenant 绑定字段在 RPC 里可见**：同第 3 点，`getUtxosByAddresses` 返回结构里能查到 `covenantId`（或 `entry.covenant`/`covenant.covenantId` 等价路径，`_psInputCovId()` 三选一兜底写法已经说明这个字段在不同 RPC/wasm 版本下的路径可能不完全一致，实现脚本要按跑起来的真实返回结构确认，不能假设哪个字段名一定对）这件事本身就是这一条的验证内容，不是独立于第 3 点的另一件事——第 3/4 两点其实是同一次查询产出的两个观察角度（"值对不对" vs "字段能不能被看到"），证据页可以合并记录。
5. **（可选）大 witness 被接受**：同第 1/2 点方法验证第二笔金丝雀，额外记录实际使用的 `sigScript` 字节数，确认落地成功且没有被 `max_signature_script_len` 拒绝。

## 4. 成本上限：≤0.1 KAS（含费），每笔独立核算

🔴 **不要混淆两个不同的"金额"**：KTT `State.amount` 字段是代币内部供应量记账单位（§2.2 建议填 `1`），**跟这笔 UTXO 本身承载的真实 KAS 面值（sompi）完全无关**——真正花钱的是 UTXO 的 `value` 字段（dust 级）+ 交易费，不是 `amount` 这个数字，实现脚本和后续证据页都要把这两者分开记录，不能把 `amount:1` 误读成"只花了 1 sompi"。

- **UTXO 面值**：取一个 dust 级但不会被节点当作粉尘拒绝的最小值（本仓有 `p2sh.mjs` 等既有代码里对 dust 阈值的处理经验，实现脚本应直接复用而不是猜一个数字——本页不猜具体 sompi 数，留给实现阶段读代码确认）。
- **交易费**：优先用真实 `kaspa-wasm calculateTransactionMass('mainnet', signedTx)` 算出真实 mass，再乘 `MIN_SOMPI_PER_MASS`（`p2sh.mjs:41` 附近定义，`tx-mass-ub.mjs` 上界证明表引用为 100 sompi/mass）——**mainnet 不受 `tx-mass-ub.mjs` 头注释描述的那个 wasm panic 影响**（`Params::from(NetworkId)` 缺分支的问题只发生在 `'testnet-12'`，注释原文逐字核实过），所以第一选择是直接调真实 wasm mass 计算，`tx-mass-ub.mjs` 的上界证明表可以作为独立交叉核对，不是必须依赖的主路径。
- **数量级判断（非精确数字，实现阶段以真实工具算出的数字为准）**：普通 genesis（§2.2）交易体积小（单输入单输出 + 几百字节的 P2SH 前后缀与状态编码），mass 大概率落在几百量级，费用远低于 0.1 KAS；大 witness 金丝雀（§2.3，签名脚本填充到 ~20,000-50,000 字节）的 mass 会显著更高（`size` 项与 `sigscript` 长度线性相关，`mass_per_tx_byte=1`），但即便按 50,000 字节估算，`50,000 × 1 × 100 sompi = 5,000,000 sompi = 0.05 KAS`，仍在 0.1 KAS 以内——**这是数量级判断，不是精确承诺**，实现脚本广播前必须用真实工具重新算一遍，确认真实数字确实 ≤0.1 KAS 才能广播，超出就要缩小填充字节数，不能凭这里的估算直接执行。
- **本页把 0.1 KAS 理解为每笔独立的上限**（UTXO 面值+费用合计），不是两笔金丝雀加总的上限——如果两笔都做，总花费上限是这两笔各自 0.1 KAS 之和（≤0.2 KAS）。这个理解如果跟 Bettor 原意不符，请在审这份设计页时明确纠正，本页只是把自己的理解写清楚，不代为扩大或缩小范围。

## 5. 回滚/失败处置

- **铁律基线**：`docs/guide/rules/00-no-tx-no-state.md`（NO TX NO STATE CHANGE）——任何 provenance/DB 记录只能在**真实确认落地**之后才能推进，不能在 `submitTransaction` 一返回就乐观写入"成功"，这条对 GO-F 同样适用，不因为是"金丝雀/低风险"就降低这条纪律。
- **§2.2 的设计选择本身就是最大的一层"回滚"**：genesis 构造成天生不可花的实例（`owner_scheme≠0x04`），dust 花费从一开始就是有界、可预期的一次性沉没成本，**不存在"资金卡住需要救援"这种场景**——这是刻意的范围收窄，不是碰运气。
- **失败模式逐条处置**：
  1. `submitTransaction` 直接被拒（RPC 层报错，例如格式不对/费用不够）——没有任何资金离开原地址，没有链上状态变化，按报错信息诊断+改脚本，不需要任何"回滚"动作。
  2. 进了 mempool 但迟迟不确认/被驱逐——标准 UTXO 行为，原 UTXO 会在 mempool entry 过期/被驱逐后恢复可花状态（这是 kaspad mempool 的既有机制，不是本项目要另写代码处理的东西）——**这条本页未独立验证 mainnet 节点的实际驱逐策略，只是基于标准 UTXO 语义的推断，如果执行阶段观察到跟预期不同，按实测结果为准，不要求预先证明**。
  3. 落地了，但 §3 第 3/4 点的 `covenantId` 读回结果跟独立重算的期望值不一致——**这不是资金损失事件**（genesis 本身已经不可花），是验证/实现层面的问题，需要停下来诊断具体哪一步的理解或代码有误，不需要任何链上补救动作。
  4. 一切按预期：广播成功、落地确认、读回值与期望值一致——完成，§6 证据清单据此收尾，没有后续动作。
- 本页产出本身（设计文档）不构成任何风险动作——真正的风险点在广播那一刻，且广播前有独立的 Owner 批准这一道闸（§0 执行门），本页不需要为"写这份文档"本身设计回滚。

## 6. 证据清单（执行完成后落 `docs/provenance/<日期>-kanetui-mainnet-covenant-canary-goF/`）

- 身份选定记录（`Bettor` 或 `Trader-A`，哪一个、为什么）。
- 实际使用的一次性构造脚本（经 NWT 审查版本，脚本本身或指向脚本 commit 的引用）。
- 广播响应：`submitTransaction` 完整返回（含 txId）、`getMempoolEntry` 观测结果。
- 落地确认：区块/确认深度、`getUtxosByAddresses` 查得的完整 UTXO 记录（含 `covenantId` 字段原始值）。
- 独立重算的期望 `covenant_id`（算法+输入值+计算结果），与读回值的逐字比对结论。
- 实际花费：UTXO 面值（sompi）+ 实际 mass + 实际费用（真实 `calculateTransactionMass` 调用输出，不是估算），确认 ≤0.1 KAS。
- KTT 状态字段实际取值（`amount`/`owner`/`owner_scheme`/`borrow_scheme`/`borrow_guard`/`extension_commitment`，均为公开链上数据，不含任何密钥材料）。
- 若执行了 §2.3 大 witness 金丝雀：实际字节数、mass 构成明细、落地确认结果。
- 明确写"本次不涉及"的范围：`transfer`/花费路径、`V-T-6` 相关行为、多输入/整合场景——本金丝雀严格只验证"我们的代码构造的 genesis covenant 交易，真实主网节点是否接受、字段是否如实回显"这一件事，不代表 KTT 花费路径或更复杂场景已经过主网验证。
