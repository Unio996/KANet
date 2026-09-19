> **Status**: CURRENT（2026-09-20，NWT；对象 = `origin/coord/j2-batch9-1-code-v0` 的 E 笔 `a57db3d5`，父 C `7294aedd`；J2 README `docs/provenance/2026-09-20-j2-batch9-1-e-chain-parents/README.md`）

# 批 9-1 E 笔审（chainParents + 四个 builder 的构造前断言）—— NWT

方法：在我自己的独立检出（`D:\kanet-nwt-cand`，`a57db3d5`，独立 `npm ci`）读全 diff（`proto-tx-assembly-settlement.mjs` +135/−17、新夹具、三个既有测试的调用点更新）；亲跑五套测试；做 **17 个我自己的变异**（`nwt-mutate-e.cjs`，每个跑三个测试文件）与 J2 的六个"加载期崩溃"变异的归因复跑；对一个疑点做了**真实构造的实测探针**（`nwt-e1-identity-probe-builder.cjs`，在一个临时副本里跑、跑完即删，`git status` 空）。D-021：无密钥 / 余额 / 地址。

## 结论：**GREEN（附 1 条小 MUST，转入 F 笔；F 落前 E 不得接线）**

本笔无任何生产调用方、既有代码行为字节不变（golden 12/0 我复跑一致），所以**合入无运行时效果**；但 E-1 是"E 这道断言到底证明了什么"的问题，必须在 9-2b 接线**之前**由 F 补上。

| 类 | 编号 | 内容 |
|---|---|---|
| **MUST（小，进 F）** | **E-1** | **`chainParents[role]` 没有绑定到 outpoint——builder 无法确认"被证明的链上事实"就是"它实际要花的那个 UTXO"**。`{value, spkLen, hasCovenant}` 是某个 outpoint 的属性，脱离 outpoint 就只是三个数。**实测**（真实构造，close_commit）：`chainParents` 按 outpoint A 生成（fee 面值 / spk 长度 / `hasCovenant=false`），builder 入参 `feeUtxo` 换成**另一个 outpoint B**（同面值、同 spk）⇒ **builder 接受，构造出的交易花的是 B**；对照臂（B 面值 +1）⇒ 正确抛 `chain_parents_mismatch`（role=fee），说明断言本身是活的，缺的是身份绑定。为什么要紧：这道断言存在的全部理由（§19.4 / Codex 条件③）就是"mass 的 plurality 取决于**被花输入**的真实形态，必须来自链上事实而非 builder 常量"；而毒化 fee UTXO（同 spk、带 covenant 绑定）恰是同面值同 spk、仅 covenant 位不同的另一个 outpoint——只要接线里 `withFeeParent` 用的候选与传给 builder 的 `feeUtxo` 不是同一个（选取缓存陈旧、重试换了候选……），断言就绿灯放行、mass 低估。（节点共识仍是最后一道墙——tx 会被拒，不损资金；所以是 MUST-小而不是 P0。）**修法**：C 的 `verifyStepInputsOnChain` / `withFeeParent` 产出的每个条目带 `outpoint:{txid, index}`（C 手上就有，取自经 M6 断言的 `u` 与 fee 候选）；`assertChainParentsMatchBuilder` 的 `used[role]` 加 `outpoint`（seal：`leafOutpoint` / `heldInput.{txid,vout}` / `feeUtxo`；close_commit：`rootCloseOutpoint` / `feeUtxo`；convert_to_claim：`rootCloseOutpoint` / `heldTokenOutpoint` / `feeUtxo`；claim_draw：`rootClaimOutpoint` / `ticketOutpoint` / `heldTokenOutpoint` / `feeUtxo`），逐项相等（txid 统一小写、index 数值比较），不符 ⇒ `chain_parents_mismatch`（`.role`）。测试：把我的探针作为回归（A 证据 / B 实花 ⇒ 抛错，role=fee），加每个角色的 outpoint 变异。 |
| SHOULD | E-2 | **`classifyC1Error` 对 `ChainParentsError` 返回 `null`**（C 的分级器只认 C 自己的三类错误）。E 新增的错误类型落进 9-2b 时若把 `null` 当"不是 C1 错误、照常重试"，就是把接线 bug 当瞬时故障。F 顺手在 `classifyC1Error` 里按 `err.code === 'chain_parents_mismatch'` 识别（**别 import builder 模块**——C 不该依赖 kaspa 产物构造链），归 `settlement_c1_programming_error` / 非瞬时，加一条测试。 |
| SHOULD | E-3 | **来源保证仍靠约定**：builder 只能核 chainParents 的**内容**，核不了它**是不是**从 `verifyStepInputsOnChain` / `withFeeParent` 来的；`withFeeParent` 也只做形状检查（错误信息写着"须来自 fee.candidates"，代码不核）。9-2b 验收加一条**源码扫描**（同 D26-scan 的思路）：非测试源码里四个 builder 的调用点，其 `chainParents` 只能是 `verifyStepInputsOnChain` / `withFeeParent` 结果的标识符，禁字面量对象。E-1 落地后 `withFeeParent` 的候选还可要求"outpoint 属于 `fee.candidates` 列表"，结构性堵掉手造候选。 |
| SHOULD | E-4 | 夹具 `proto-chain-parents-fixtures.mjs` 头注写"生产代码不得 import"，**没有机器守着**。加一条与 D26-scan 同型的小扫描：非测试文件不得 import 该模块。（我核了现状：非测试文件中该名字只出现在它自己的头注里。） |

## 一、我亲跑与变异
- 亲跑（独立检出）：`proto-tx-assembly-settlement-golden` **12/0**、`proto-tx-assembly-settlement` **43/0**、`proto-claim-draw` **53/0**、`proto-settlement-chain-checks` **51/0**、`proto-settlement-c1` **32/0**——与 J2、Bettor 自报逐项相同。
- **我的 17 个变异**（每个跑 claim-draw + assembly + golden 三个文件；还原后 sha256 逐位一致 `6b847aa9…`，`git status` 空）：**12 被抓，5 存活，均为等价 / 冗余**：
  - e10 / e11（claim_draw 的 ticket / held 期望面值改用 `CONTINUATION_OUTPUT_SOMPI`）——**等价**：`GENESIS_OUTPUT_SOMPI` 与 `CONTINUATION_OUTPUT_SOMPI` 现在同为 `20_000_000n`。顺带的观察：对常量角色（leaf / rootClose / rootClaim / held / ticket），J2 的 ③（对 `EXPECTED_INPUT_VALUE_SOMPI`）与 ④（对 builder 用值）**目前指向同一个数**，二者冗余；④ 真正带来新信息的只有 seal 的 `heldInput.value`（调用方给的）与各步 `feeUtxo.value`。不是问题，两个常量将来分家时它们才各自承重。
  - e14（seal 内部布局守卫关闭）——**等价**（只在将来布局漂移时才触发）。
  - e15（`isPlainObj` 放行数组）——**等价**：数组入参随后在"缺失"分支仍抛 `ChainParentsError`（只是 `.role` 不同）。
  - e17（`spkLen <= 0` 改 `< 0`）——**等价**：`spkLen=0` 随后被"与 builder 现算长度相等"拒掉。
  - 被抓的包括我点名的 J2 清单外项：`0x` 前缀归一化（e1）、只对 fee 关掉 ④ / hasCovenant / spkLen（e2–e4）、首 / 尾角色被跳过（e5 / e6）、hasCovenant 下标错位（e7）、额外角色键容忍（e8）、③ 整体去掉（e9）、close_commit fee 用值改常量（e12）、seal held 用值改常量（e13）、`continuationOutputIndices` 改 `[1]`（e16）。
- **J2 自报第 ②：六个"加载期崩溃"变异（M-09/12/21/22/23/26）的归因**——J2 的变异脚本只跑 `proto-claim-draw.test.mjs`（顶层要先建整条链，故整体崩）。我把同六个变异对**三个**测试文件复跑：**六个在 `proto-tx-assembly-settlement.test.mjs` 里都有具名 FAIL（6–9 条），其中四个 golden 也红**；只有 claim-draw 这个文件是崩溃而非具名。所以"被点名的测试抓到"成立（在 assembly 测试里）；B2 / B4 在 claim-draw 内是否单独抓到仍未验（文件崩在它们之前）——这是可接受的归因粗糙，不要求改。
- **J2 自报第 ①（第一轮 1 个存活 M-06、补断言后整套重跑、旧输出改名留存 `mutation-e-raw-round1.txt`）**：做法对（证据只增不删、存活项当"测试没区分报文"处理而非"校验无效"）；我在 e15 / e17 上看到同一类"被后面的严格相等兜住"的等价形态，一致。

## 二、J2 的 8 条超出设计文字的取舍
1. 多加 ④（value 对 builder 实用面值）——**接受**。它对 seal 的 held 与 fee 有真信息（e13 / e12 证实有测试守着）。
2. fee 角色也核——**接受**（与我 §19.4 的"fee 项来自形态 L 条目"一致）；**E-1** 是它的自然延伸（核 outpoint）。
3. 出现该步输入角色之外的键即拒——**接受**（e8 被抓）。
4. 缺条目不当 false（设计原文 `?? false` 会静默放行）——**接受，且这是本笔最重要的一条正确修正**：照设计字面写就是我在 9-0 起一路防的"缺失被当良性默认值"。
5. 新增 `ChainParentsError`——**接受**（不污染 26 码的链上漂移闭集）；但见 **E-2**（分级器要认得它）。
6. 断言在私钥解密之前（close_commit / claim_draw），`heldArtifact` 上移——**接受**：我核了位置——close_commit 断言在 `decryptCommitteePrivkey` 之前、claim_draw 在 `decryptCommitteePrivkey` 与 `assertTicketSigningKey` 之前（该函数需要密钥，本来只能在其后）；`heldArtifact` 是纯函数，值不变（golden 证）。
7. 字面量下标改具名常量；seal 加布局自检——**接受**（golden 字节不变；自检对当前代码等价，e14）。
8. 新夹具文件——**接受**，附 **E-4**。夹具的 fee 项由 builder 入参的 `feeUtxo` 现算（happy path 上 fee 是"自证"，靠 B1 的显式覆盖变异抓不符）——头注已如实写明，可接受。

## 三、其余读码结论（无问题）
- `assertChainParentsMatchBuilder` 的判定顺序：入参对象 → 额外键 → 每角色（存在 → 形状 → hasCovenant → spkLen → ③ → ④）；`fail` 都带 `.step` / `.role`；内部错误（角色数与向量长度不符、`used` 缺项）抛普通 `Error` 而不是 `ChainParentsError`——**正确**（那是 builder 自己的 bug，不该被当成"调用方给的事实不符"）。
- 断言先于 `selectChangeShape` / `assertMassWithinCeiling`（四个 builder 各一处，J2 的"挪到之后"变异与我的读码位置一致）；close_commit / claim_draw 先于私钥解密（B1c 用"没有 new 过 PrivateKey"证明）。
- spkLen 的辨别力：所有 covenant / ticket 输入都是 P2SH（35 字节），所以对这些角色 `spkLen` 是常量、只对 fee（P2PK 34 字节）真正区分——**身份**（哪个 P2SH）不是它的职责，靠 C 的 M6 对 outpoint / spk 全等；这正是 **E-1** 要把两层接起来的原因。
- B3：`continuationOutputIndices:[0]` 用 relay 真代码 `validateFixedValueOutputs`（`kasia-relay/src/lib/covenant-broadcast.mjs`）验过。

## 没做 / 未证
- 没起 simnet（毒化 fee 向量按计划等 9-1 全部落完；E-1 落地后该向量应直接验"候选 A 取证、builder 花 B"被拒）；没审 D / F。
- 我的探针只覆盖 close_commit 的 fee 角色；其余角色 / 步骤的同类绑定缺口是**读码推断**（四个 builder 的 `used` 都只带 value 与 spk，不带 outpoint），未逐个跑。
