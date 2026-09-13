# Owner 指令 · 主网跑 KANet · 押注资产 = 自发免费无限铸造的 KCC-20 测试币 · 评估 v0.1

> **Status**: DRAFT v0.1（2026-09-13 · J1 @younio · docs only · 侧分支 `coord/j1-mainnet-testtoken`）· 给 NWT 审 → Bettor cherry-pick
> **定位**：`docs/2026-09-07-bettor-mainnet-pivot-assessment-v0.1.md`（含 v0.2 追加）的**补丁**——只补"押注资产"这一格，**不改其四个前置、不改四波顺序**。
> **铁律 0**：本稿不动任何代码、不动 live 树、不动 pinned silverc；§6 的落地步骤每一步各自过 报备→审→批→测。
> **不是法律意见**（§5）。

---

## 0. 一句话

**主网上跑 KANet，但押注用的不是 KAS，而是一个 KANet 自发的 KCC-20 代币：任何人、任何时候、零成本、无上限地铸造；只能存在于 covenant 里、不能进个人地址。** 前者让它在结构上不可能有价格，后者让它在结构上长不出二级市场。手续费用真 KAS 烧（Owner 裁定：不怕）。

## 1. Owner 裁定（2026-09-13 原话，本稿的输入）

| # | 原话 | 本稿读法 |
|---|---|---|
| 1 | 「我想合规跑主网，审下很多节点同步，节点不够诸多问题」 | 主网 = 解 TN12 拓扑病（9/7 评估 §2 已列）+ 合规前提 |
| 2 | 「肯定不能 kas 直接押注，是要出问题的」 | 押注资产 ≠ KAS，这是硬约束 |
| 3 | 「自己发一个币（KCC-20 L1 原生代币），完全不销售，就是测试用，在主网测试」 | 代币 = 应用层测试筹码，L1 原生（covenant 强制）而非索引器标准 |
| 4 | 「任何人可以无限 mint，这个机制好！」 | **采纳为核心机制**（§3.2） |
| 5 | 「烧手续费不怕」 | 费用**不是否决项**；再平衡 cron 重设计只为效率（9/7 评估 §A），不为省钱 |
| 6 | 「我对公网还贡献节点」 | 主网节点 = 公共品，同时是"我们跑基础设施"的可信度 |
| 7 | 「聚焦真正应用，系统配置会省下大量时间」 | 目标是把运维时间换成应用时间 |

⚠ Owner 原话写的是"krc20"——**本稿按 KCC-20 处理**：KRC-20 是 Kasplex 索引器标准（链下解释、L1 不强制），KANet 结算走 covenant/ZK，市场合约要能在链上**强制**持有与转移，只有 KCC-20（covenant 约束）做得到。

## 2. 与 9/7 主网评估的关系

- 9/7 评估结论"可转、应尽快"**不变**；四个前置（G-1 钱路闸 / 42 合约迁 silverscript v1 / NO-TX 两处违反 / 主网用官方 release）**不变**。
- 改的只有**资金面**一列：

| 波 | 9/7 评估资金面 | 本稿 |
|---|---|---|
| 0 只读节点 | 0 | 0（不变） |
| 1 通信/身份 | 手续费级 | 手续费级（不变） |
| 2 签名型结算小额 | 单笔 ≤10 KAS / 日 ≤100 KAS | **押注 = 测试币；KAS 只作手续费**；额度改为"手续费钱包日上限" |
| 3 ZK 结算 | 按盘上限 | 同上 |

- 6/6 handoff 那句「项目终点 = 测试网公开 demo，非 mainnet」（`docs/2026-06-06-handoff-briefing.md:41`）**已被 Owner 9/7 主网指令取代**；其**G5 口径**（`:40`「测试币零价值，禁"大钱/保护资金/退款金额"框架，不报经济闭环」）**原样沿用到主网测试币**。

## 3. 机制（可执行）

### 3.1 标准：KCC-0020（已合并）

- `kaspanet/kccs` PR#2 **2026-08-20 合并**（head `a124b28`；文档头 Status 仍写 Draft，Updated 2026-08-25）。仓里 7/16 那批 KCC 文档写"PR#2 Draft 未合并"——**已陈**，引用时按已合并。
- 状态布局（必须、按序）：`amount:int · owner:byte[32] · owner_scheme:byte · borrow_scheme:byte · borrow_guard:byte[32] · extension_commitment:byte[32]`。
- `owner_scheme` 默认表：`0x00 p2pk-schnorr/v1 · 0x01 p2pkh-schnorr/v1 · 0x02 p2pkh-ecdsa/v1 · 0x03 p2sh/v1 · 0x04 covenant-id/v1`。
- **规范对 minting 完全沉默**（无 minter 概念、无供应上限条款）⇒ 铸造规则是**应用自定义**，"任何人无限 mint"不与规范冲突。
- `extension_commitment` = 应用扩展状态的摘要，KANet 需要挂市场 id 之类时用它。
- ⚠ silverscript v1.0.0 自带的 `tests/examples/kcc20.sil` 是**旧布局**（`ownerIdentifier/identifierType/amount/isMinter`），与合并规范不同——**只作 `#[covenant(binding=…)]` 语法参考，布局以规范为准**。

### 3.2 免费无限铸造（核心）

```
entry mint(int amount, byte[32] to, byte to_scheme)：
  · 不校验签名、不校验调用者、不校验来源
  · amount 任意正整数、无供应计数、无上限
  · 唯一约束 = 产出状态合法（§3.3）
```
**论证**：一个任何人随时可零成本无限复制的东西，二级市场撑不住任何价格——这是**机制**，不是"我不卖"这种**承诺**。它把 §5 的合规论证从"运营者的意图"移到"链上可验证的性质"。

### 3.3 转移限制（两档，v0.1 取 (a)）

| 档 | 规则 | 效果 | 代价 |
|---|---|---|---|
| **(a) 只许 covenant 持有** | `transfer` 与 `mint` 的每个 `next_states[i].owner_scheme` **必须 == 0x04**（covenant-id/v1）；拒 0x00–0x03 | 币**永远不落到个人地址**，人手里拿不住，OTC 无从谈起 | 一行 `require`；规范本就要求 transfer 校验 owner_scheme 受支持，这里只是把支持集收成 {0x04} |
| (b) 只许 KANet 市场模板持有 | 在 (a) 之上，接收 covenant 的输出 `scriptPubKey` 必须匹配 KANet 市场模板前缀（introspection `tx.outputs[i].scriptPubKey`，TN12 全有，见记忆 `reference-silverscript-real-capabilities`） | 连"别人写个 covenant 把它包起来"都堵死 | 模板前缀随编译器变（v1 迁移期 P2SH 全换），每次迁移要同步；先不做 |

**v0.1 = 免费 mint + (a)**。(b) 列为升级项，等 42 合约迁完、模板稳定后再议。

### 3.4 对外口径（每次都要有，一次都不能少）

「**测试币 · 无价值 · 任何人免费无限铸造 · 只能用来押注**」。G5 沿用：不报盈亏、不报"资金"、不报"保护资金"。
`/api/faucet/request` 改为直接发链上 `mint`（外部口 404 那条 `docs/2026-07-26-external-program-kaspa-onboarding-recipe.md:77` 另案）。

## 4. 它不解决的（写明，防误读）

1. **四个前置一个都没免**：G-1 enforce / 42 合约迁 v1 / `exchange-machine.js:828` + `bettor-prediction-settler.js:198` 两处 NO-TX 违反 / 主网 v2.0.1 官方 release。测试币不改这些。
2. **真 KAS 照烧**：币没价值，费有——再平衡 0.046 KAS/笔、12–39 KAS/天（9/7 §A）。Owner 裁定不怕；但 relay 私钥 40 处常驻从此看守的是**真余额**，密钥分离按 NWT 真钱清单 MUST。
3. **测不到对抗行为**：没人攻击一个没价值的市场。预言机博弈、委员共谋、结算抢跑——预测市场最要命的部分——这一期**零覆盖**。对内对外都要说清：**验证的是管线，不是经济安全。**

## 5. 合规注记（非法律意见）

- 测试币阶段本身风险低：无对价、无销售、无二级市场（§3.2/3.3 使之结构性成立）。
- **风险时点 = 公开宣称"主网预测市场"那一刻**；监管看的是运营者整体，而路线图上有第二方向（发债/稳定币）。**第二方向不在本稿、不公开、不上链**（Owner 已认"合规准备不够"）。
- Owner 在匈牙利 ⇒ MiCA 适用。上主网**公开**前拿一页匈牙利/MiCA 意见；本稿的 §3.2/3.3 就是给律师看的"它为什么不是加密资产发行"的技术论据。

## 6. 落地步骤（每步各自过铁律 0）

1. **波 0 不变**：S-2 第二台机、v2.0.1 官方、只读。
2. **代币合约**：`kasia-console/src/lib/sil-v1/KanetTestToken.sil`（名待 Bettor 拍）——KCC-0020 六字段布局 + `mint` 无校验 + `transfer`/`mint` 限 `owner_scheme==0x04`。
   - 编译器：**silverscript v1.0.0 官方二进制**（sha256 `ce1e0ef5…4b29af`）。🔴 **pragma 保持 `^0.1.0`**：本会话实测 v1.0.0 二进制 `COMPILER_VERSION` 仍是 `"0.1.0"`（`compiler/mod.rs:55`），`^1.0.0` 被拒（"cannot support pragmas that cover future major versions"）——J2 迁移计划 §3"正式版切 `^1.0.0`"**要反过来**，等上游升常量再切。
   - 构造参数按 `docs/CONSTRUCTOR_ARGS.md`（v1.0.0 新增）：`[{"kind":"bytes","value":[…]}, …]`。
3. **先 TN12 staging**（9/7 §3 原则：每波先 TN12 再主网），再主网 genesis。
4. **市场合约侧（真正的工程量）**：pool/bshard 的 stake 从 KAS 输出值改为代币 covenant 状态 `amount`，市场 covenant 以 `owner_scheme 0x04` 持币、结算时 `transfer` 给赢家的**市场领取 covenant**（仍是 0x04，不进个人地址；领取 covenant 再按 (a) 规则继续持有——个人"钱包余额"= 其名下领取 covenant 的 amount 之和）。归 J2，与 42 合约 v1 迁移**同批**（9/7 §B「最大工程量」）。
5. **验收**：行为向量（每 `require` 一正一反，J2 计划 §5 法）+ 主网真链（手续费级）。
6. **CLAUDE.md 铁律 0.5 注记**另笔补 2026-09-13 状态：上游 v1.0.0 无 OP_PICK bug（#178 重构消除，非合并我们的修复）；本机修复只对仍用 0.1.0 的第三方有意义。

## 7. 请 NWT 判 / 请 Bettor 拍

1. 转移档 (a) 是否够，(b) 何时提上来。
2. 代币名 / ticker / 合约文件名。
3. 是否向 `kaspanet/kccs` 提一条 "permissionless mint 用例" 说明——**对外动作，GO 前不做**。
4. 本稿与 J2 v1 迁移计划的合并点（建议：并入批 A 之后、批 D 之前，作为"批 T"）。
5. `sil-v1/` 目录 vs `*_v1.sil` 后缀（J2 计划 §6-1 悬而未决，本稿倾向目录）。

## 8. 本会话实测坐标（v1.0.0，只写 scratchpad，未入库）

| 项 | 结果 |
|---|---|
| v1.0.0 = `3ed9733`（2026-09-09）；rc1→v1.0.0 仅 4 commit，但 #245/#246 新增 ~2000 行静态拒绝（资源上限 / covenant 展开界 / 脚本限制 / 状态初始化须常量） | J2 批 A/B/C 在 rc1 上做的离线编译**要在 v1.0.0 重跑** |
| `compile_byte_sequence_cast_call`（`builtin.rs:157`）只收 1 参；`OpNum2Bin` 处 `emit_op(OpNum2Bin, -1)`；手工 `stack_depth` 记账全仓 **7 处**（我们树 112） | OP_PICK off-by-one **不在**；卡 `2026-07-28-…byte-equivalence-card.md` §七 的数 = 7 ⇒ 机制整体替换 |
| `Blake2bProbe.sil` 只改 `entry` + `byte[36]` + 喂 ctor，v1.0.0 编过 **210 B**（J2 rc1 数同长；字节逐一未验）| 1/42 |
| `Cargo.toml version = "1.0.0"`，`COMPILER_VERSION = "0.1.0"`；`pragma ^1.0.0` 拒、`^0.1.0` 过 | 上游 issue 列表到 #251 无人报 |
| 仓里 42 个 `.sil` 全 `^0.1.0`；`sil-v1/` 不存在 | 迁移未落库 |
