# T3 · 主网集 7 合约的代币化改法 · 设计稿 v0.3（全 23 入口 A/B 落位表 + max_ins_scan 边界纪律 + 双边对账 + 币解耦）

> **Status**: DRAFT-FOR-REVIEW v0.3（2026-09-14 · J2 · 派 NWT 逐条复核三前提 · 不写非 draw-down 范围外的 .sil）
>
> 承接 `docs/2026-09-13-j2-t3-market-set-token-rewrite-design-v0.1.md`（v0.1/v0.2，A/B 二分 + 22 常量去向 +
> §3.0 draw-down 不变量，NWT b2abee3a 已批）+ `docs/2026-09-13-j2-t1-t2-t3-routing-change-remove-bout-design-v0.2.md`
> （退路①路由变更，NWT ledger 1121 机制 PASS）。本稿是 Bettor ledger **1121（三前提）/ 1122+1122-补（max_ins_scan
> 边界纪律）/ 1123（Codex 复核转 23 入口 A/B + noTokenInput 同 1122 纪律）/ 1127（Owner 终端三条：双边对账、
> 币解耦、D-018）** 的合并落地稿，逐条收齐，不再分批。
>
> 已落码（同一次合入，见 §9 commit 列表）：T1 v0.6（`2a5c1eb0`）+ T3 四处 draw-down MUST-FIX（`f2fce916`）。
> 本稿 §2 覆盖的**其余 19 条入口的 scanOwnedTokenInputs()/noTokenInput() 落码**尚未写 .sil——机制已用探针
> 实证（§3/§4），但落码前置阻断（§7 的 v1.0.0 语法迁移）尚未清理，属于本稿定案后的下一步，不在本次合入范围。

## 0. 一句话

v0.1/v0.2 定的 23 入口 A/B 二分 + `tokenOutOk`/`noTokenInput` 两个公共代码块，在 NWT 独立复核（4b39c801）+
Codex 复核（转 J2, ledger 1123）+ Owner 终端三条直令（ledger 1127）后，**方向不改，但补三条硬性纪律，缺一票就是
假等价**：① `scanOwnedTokenInputs()`/`noTokenInput()` 的遍历深度必须服从 **max_ins_scan 边界纪律**（§3，已探针
实证 9/9）；② 对账必须**双边**——输入侧扫描只保证「没有市场代币被悄悄吞掉」，输出侧续约去向必须是**派生表达式**
才能保证「没有代币被悄悄转去陌生地址」（§4，已探针实证）；③ 市场合约与代币价值/供应机制**解耦**——市场合约只
验证「归我的代币进出对账」，不得把「免费铸造」当设计前提（§5）。守恒放宽本身（`sum_in>=sum_out`）已记入
**D-018**（Owner 铁律级 invariant 降级记录，`46818d08`），本稿引用不复述论证。

## 1. 七合约封闭集合（前提 (a)）

| # | 文件 | 是否持币 | 角色 |
|---|---|---|---|
| 1 | `ShardLeaf.sil` | 是 | 输家片归集叶(cov_id 身份, 非 template) |
| 2 | `ShardLeaf_direct.sil` | 是 | 同上, 直连变体(可转 RootClose) |
| 3 | `PayoutShard.sil` | 是 | 派彩/退款主结算(committee-attest + draw-down) |
| 4 | `PayoutShardV2.sil` | 是 | 同上, ZK-native 结算变体(+zk_handoff 交接 CloseZkV2) |
| 5 | `RootClose.sil` | 是 | cascade 根收束(convert 分岔 claim/refundclaim) |
| 6 | `RootClaim.sil` | 是 | 根派彩串行 draw-down(merkle-bound) |
| 7 | `CloseZkV2.sil` | 是 | ZK 结算终端(escape/claim 派彩) |

**声明**：以上 7 个文件是主网集**当前**全部会持有/流转 KanetTestToken 的合约类型，穷尽。`RefundClaim.sil` 是否
在主网集**未定案**（v0.1 §7 已记，本稿不新增结论——若后续确认在集内，须比照 RootClaim.claim_draw 补录，属新增
行而非推翻本表）。**任何未来新增的持币合约类型，落码前必须先补录进本表**（否则视为绕过本稿三前提审查，
NWT 复核直接打回）——这条本身就是纪律，不是留白。

## 2. 全 23 入口 A/B 落位表（前提 (b1)）

标记口径：**A 列** = `scanOwnedTokenInputs() == RHS`（输入侧, 归己代币全被处理）+ **输出侧派生绑定列**（§4 纪律,
"是/否需要"+绑什么表达式）；**B 列** = `noTokenInput()`（P13 形, 不分 owner, 比 owner-aware 更严——Codex 1123
指出的"B 类未必配扫描"顾虑在 v0.1 设计里其实已经用 `noTokenInput` 堵死, 本表把这条钉实, 不留隐含假设）。

### ShardLeaf(2 入口)
| 入口 | 类 | scanOwnedTokenInputs() RHS | 合法在场不计入? | 输出侧派生绑定 |
|---|---|---|---|---|
| `register_append` | A | `pool_value`（本 leaf 自身既有持仓, 首次调用=0） | **是**——bettor 新下的注(owner 尚未变成本 leaf)天然被 owner 过滤排除, 不需要特判 | `tok_out` owner = `OpInputCovenantId(this.activeInputIndex)`（自身） |
| `consolidate_to_payout` | A | `pool_value`（leaf 全部持仓, 整体转出） | 否 | `tok_out` owner = `OpInputCovenantId(psInIdx)`（真 PS 实例, 已核 == `payout_cov_id`） |

### ShardLeaf_direct(2 入口)
| 入口 | 类 | RHS | 合法在场不计入? | 输出侧派生绑定 |
|---|---|---|---|---|
| `register_append` | A | `pool_value` | 是（同 ShardLeaf） | 同 ShardLeaf |
| `convert_to_rootclose` | A | `pool_value` | 否 | `tok_out` owner = `OpOutputCovenantId(rcOutIdx)`（本笔新建 RootClose, 独立校验） |

### PayoutShard(5 入口)
| 入口 | 类 | RHS / noTokenInput | 合法在场不计入? | 输出侧派生绑定 |
|---|---|---|---|---|
| `absorb` | A | `consolidated_pool`（本 PS 自身既有持仓；**不含**同笔新纳入的 `shard_amount`——那部分 owner 尚属输家 leaf, 天然被过滤, 走独立的 `tokenOutOk(tok_in=shardInIdx, owner=leaf→self)` 迁移校验, 两条并列不合并） | **是**——`shard_amount` 是合法在场但不计入 scan 的正例(§4 已探针 `V-outbind`族形佐证同类结构) | `tok_out` owner = `OpInputCovenantId(this.activeInputIndex)`（本 PS 自身） |
| `close_attest` | B | `noTokenInput` | — | — |
| `claim` | A | `consolidated_pool`（§3.0 分支: `==payout` 时不留续约, 此时 RHS 恒等式仍是 `consolidated_pool==payout`, 只是没有下一轮; `>payout` 时续约 `consolidated_pool-payout`） | 否 | 领取输出 `ClaimState.market_cov_id = OpInputCovenantId(this.activeInputIndex)`, `winner_pk` = merkle 树证明出的叶子 pk(不是 witness 里任填的 pk)；剩余续约 owner = 自身 |
| `cancel_attest` | B | `noTokenInput` | — | — |
| `refund_claim` | A | 同 `claim`（`refund` 替 `payout`） | 否 | 同 `claim` |

### PayoutShardV2(5 入口)
| 入口 | 类 | RHS / noTokenInput | 合法在场不计入? | 输出侧派生绑定 |
|---|---|---|---|---|
| `absorb` | A | 同 PayoutShard.absorb | 是（同上） | 同上 |
| `close_attest` | B | `noTokenInput` | — | — |
| `cancel_attest` | B | `noTokenInput` | — | — |
| `refund_claim` | A | 同 PayoutShard.refund_claim | 否 | 同上 |
| `zk_handoff` | A | `consolidated_pool`（终态, 全部移交, 无续约） | 否 | `tok_out` owner = `OpOutputCovenantId(zkOutIdx)`（本笔新建 CloseZkV2, 独立校验；既有 `closeZkTmplAnchor` 锚检查不变） |

### RootClose(4 入口)
| 入口 | 类 | RHS / noTokenInput | 合法在场不计入? | 输出侧派生绑定 |
|---|---|---|---|---|
| `close_commit` | B | `noTokenInput` | — | — |
| `refund_flip` | B | `noTokenInput` | — | — |
| `convert_to_claim` | A | `pool_value`（全池整体转出） | 否 | `tok_out` owner = `OpOutputCovenantId(claimOutIdx)`（本笔新建 RootClaim） |
| `convert_to_refundclaim` | A | `pool_value` | 否 | `tok_out` owner = `OpOutputCovenantId(rcOutIdx)`（本笔新建 RefundClaim） |

### RootClaim(1 入口)
| 入口 | 类 | RHS | 合法在场不计入? | 输出侧派生绑定 |
|---|---|---|---|---|
| `claim_draw` | A | `pool_value`（§3.0 分支同 claim/refund_claim 形；`claimed_bitmap` 终结逻辑不变） | 否 | 领取输出同 PayoutShard.claim 形；剩余续约 owner = 自身 |

### CloseZkV2(4 入口)
| 入口 | 类 | RHS / noTokenInput | 合法在场不计入? | 输出侧派生绑定 |
|---|---|---|---|---|
| `zk_close` | B | `noTokenInput` | — | — |
| `escape_trigger` | B | `noTokenInput` | — | — |
| `escape_claim` | A | `consolidated_pool`（§3.0 同款分支） | 否 | 领取输出同上；剩余续约 owner = 自身 |
| `claim` | A | 同 `escape_claim` | 否 | 同上 |

**计数**：A 15 / B 8 = 23，**无第三类，无无守卫入口**——本表每一行要么落在 A 列（`scanOwnedTokenInputs()` 输入侧
+ 输出侧派生绑定两条都要）要么落在 B 列（`noTokenInput`），没有一行两条都不占。

> 🔴 **注记（1123 Bettor 转述数字核对）**：ledger 1123 原话写"12 条 B 类"，但 v0.1 §3/§0 原表与本表逐条清点均为
> **B=8**（PS 2 + PSV2 2 + RootClose 2 + CloseZkV2 2）、**A=15**，总 23 不变——本稿按源码/v0.1 原表的真实计数走，
> 未按 1123 的口误改动分类；此处如实记差异，不代表 Bettor 的裁定被否定（裁定内容"B 类也要 noTokenInput+1122
> 纪律"本表已全部照办），只是数字口径以设计文档原表为准。

## 3. max_ins_scan 边界纪律（前提 (b2)/(c)，ledger 1122 + 1122-补）

**取值依据**：协议层单笔交易最大输入数 = **1000**（共识硬规则，`consensus/core/src/config/params.rs`
`MAINNET_PARAMS.max_tx_inputs`，Bettor 亲核 `v2.0.1` tag，见 ledger 1122）。

**选择的等价安全替代**（ledger 1122 给出的两种任选之一）：**不**在每个入口里把循环展开到 1000 次（silverc 逐
opcode 展开, 1000 次迭代的循环体含 `readInputStateWithTemplate` 调用会撞脚本长度/算子上限, 这条路径本身就不
现实）。改用 **`require(tx.inputs.length <= max_ins_scan)` 先拒超界交易，再在界内遍历，界与循环真实展开深度
必须是同一个具名常量**——超界交易在到达扫描逻辑之前就被整体拒绝, victim **不可能**"藏在遍历不到的下标之后"，
这条安全性质与 `max_ins_scan` 的具体取值无关（只要 require 与 loop 共享同一个常量）。

`max_ins_scan` 的**生产取值**留给 T3 v0.3 全量落码时按各市场合约实际预期的最大输入形态选定（每文件可以不同，
但每文件内部所有 A/B 类入口必须共享同一个 `max_ins_scan` 常量，不得同文件内不同入口各拍各的）——这是部署配置
决策, 不是本稿需要现在钉死的安全参数。

**实证**（1122-补 NWT 两条边界戳点全部覆盖，`docs/provenance/2026-09-14-j2-t3-v03-maxinsscan-notoken-outbind-probe/`，
9/9 PASS，`MarketScanProbe3.sil` 定 `MAX_INS_SCAN=8` 作可测试小值）：

| NWT 边界戳点 | 覆盖向量 |
|---|---|
| ① require 挡的是整笔交易真实 `tx.inputs.length`，不是近似量 | `V-bound-2`：9 输入(界+1)，内容本身若无长度闸也会通过扫描——隔离出纯粹是长度闸拦下的，不是巧合失败于别的检查 |
| ② require 的界与循环真实可达深度必须同一常量 | `V-bound-1`(恰好=界,8 输入全部correctly累加) + `V-bound-3`/`V-bound-4`(victim 在下标 7=末位可达位置, 证明循环真展开到那里, 不是提前截断) |

同一份探针把 1123-b3 的两条 B 类负向量、1127① 的输出侧负向量也一并证了（见 §4/§5，同一探针文件的另外 5 条
向量），不重复起探针——同一工具链层的东西没有理由分两次证。

## 4. 双边对账纪律（Owner 终端 1127①）

**问题**（Bettor 1127① 原话）：`scanOwnedTokenInputs()` 只是输入侧，只保证"没有市场代币被悄悄吞掉"，不保证
"输出侧去向合法"。

**先答已答问题**（J2 1127① 回复，Bettor 已采纳）：v0.2 探针（`MarketScanProbe.sil`）确实**没有**覆盖"输入对上
了、输出把币转去陌生地址"这一类——那份探针整个没有任何输出构造/校验，是真空白。本稿 §3 引用的
`MarketScanProbe3.sil` 新增 `scan_and_bind_output` entry 补上这条证据（`V-outbind-1`/`V-outbind-2`，2/2 PASS）。

**不需要新原语，需要的是钉死一条纪律**（写入 §2 表格「输出侧派生绑定」列，与 `scanOwnedTokenInputs()` 并列，
两条都占了才算数）：

1. **单一去向的入口**：`tokenOutOk(tok_out, tok_in, amount, owner)` 的 `owner` 参数**永远是派生表达式**
   （`OpInputCovenantId(this.activeInputIndex)` 自身、或 `OpOutputCovenantId(otherOutIdx)` 绑定同笔另一个
   独立被校验的 covenant），**绝不能是裸 witness 参数**——这是本条纪律的全部内容，`tokenOutOk` 原语本身不用改。
2. **拆两路的入口**（absorb / claim / refund_claim / claim_draw）：§3.0 draw-down 分支的 `remaining =
   pool_before − payout` 本来就是**算出来**而非另外传参，天然保证"付出去的 + 留下的 == 输入总量"是算术恒等式；
   补的纪律是 payout 那一路的去向字段（`ClaimState.market_cov_id`/`winner_pk`）也必须是派生表达式（merkle 树
   证明出的 pk，不是 witness 里随便一个 pk）。

## 5. 市场合约与代币价值解耦（Owner 终端 1127②）

**裁定**：市场合约的设计前提**不得**依赖"代币可无限自由铸造、供应量压不住价格"这件事——市场合约验的是"归我
的代币进出对账"（§2/§3/§4 三条纪律），这条性质与代币本身的经济价值/供应策略无关。将来换一种真实价值的代币，
只需要换配置（`token_tmpl_hash`/`token_prefix`/`token_suffix` 等 ctor 常量），**不需要重写市场合约代码**。

**检查现有设计有没有隐含依赖了免费铸造**：逐条过 §2 表格 23 行，**没有一行**的安全性论证依赖"反正谁都能铸/
供应无限"这件事——`scanOwnedTokenInputs()`/`noTokenInput()`/输出派生绑定三条纪律全部只关心"这笔交易里、这个
市场名下的代币数量守恒"，跟代币本身值不值钱、能不能被任意铸造完全正交。T1 的"自由铸造"是**测试构建**
（`MODE_TEST_COIN=true`）的特性描述，不是市场合约安全性的**前提**——H2/P1 已把这条钉死为编译期常量、稳定币
构建切换不改市场合约一行代码（市场合约只认 `token_tmpl_hash` 这个 ctor 常量，不关心它背后是测试币还是稳定币）。

## 6. 守恒放宽的最终记录（D-018，Owner 终端 1127③）

`sum_in >= sum_out`（token 侧, T1 v0.6 已落码 `2a5c1eb0`）+ 本稿 §2/§3/§4 三条纪律（market 侧）合起来等价旧的
精确 `sum_in == sum_out`，此裁定已记入 **`docs/DECISIONS.md` D-018**（`46818d08`，铁律级 invariant 降级记录）。
本稿引用 D-018，不复述论证过程（论证本身见 `docs/2026-09-13-j2-t1-t2-t3-routing-change-remove-bout-design-v0.2.md`
§1/§4 + NWT `docs/2026-09-14-nwt-redteam-j2-routing-change-v0.2-review-v0.1.md`）。

## 7. v1.0.0 语法迁移阻断（本次顺手发现，Bettor 1129 要求写出消除计划）

**现状**：`PayoutShard.sil`/`PayoutShardV2.sil`/`RootClaim.sil` 三文件已在本次（`f2fce916`）完整迁移并通过
v1.0.0 工具链的完整类型检查（含 entry body，不只是 ctor 签名）。`CloseZkV2.sil` 只顺手修了 P2PK byte[34]→[36]
一处（因为不修连前三个文件都编不过——同一份"扫 byte[34]"改动里顺手带上的），**其余迁移未做**。`RootClose.sil`/
`ShardLeaf.sil`/`ShardLeaf_direct.sil` **完全没有**过 v1.0.0 类型检查——仍是 `entrypoint function` 语法，编译期
连 parse 都过不了（v1.0.0 关键字是 `entry`）。

**消除计划**（本稿定案 GREEN 后、19 条剩余入口的 scanOwnedTokenInputs/noTokenInput 落码之前，先做）：

1. **第一步（纯机械迁移，零逻辑改动，逐文件跑通空 ctor 编译 + 有 ctor 参真实编译到 entry body 类型检查）**：
   `RootClose.sil` / `ShardLeaf.sil` / `ShardLeaf_direct.sil` / `CloseZkV2.sil`（剩余部分）四文件，逐条对照本次
   f2fce916 已踩过的四类坑机械排查：
   - `entrypoint function` → `entry`
   - 裸 struct 字面量 → `State { ... }`（`validateOutputState`/`validateOutputStateWithTemplate` 调用点）
   - `ScriptPubKeyP2PK` byte[34] → byte[36]（若该文件有用到；本次已知 CloseZkV2 有两处，`RootClose`/`ShardLeaf`/
     `ShardLeaf_direct` 未见 P2PK 用法，需实查不可假设"没有"）
   - 两参 `byte[](x, N)` → `x as byte[N]`（`CloseZkV2.sil:45/88/153`、`FoldNode.sil:74/76` 已知命中，
     `RootClose`/`ShardLeaf`/`ShardLeaf_direct` 需实查）
   - 每文件迁移完必须用真实 ctor 参数跑一次完整编译（不能只跑空 ctor 到 arg-count-mismatch 就停——本次
     f2fce916 的教训：那种编译**不会**触达 entry body 类型检查，是假阴性）。
   - 迁移期间任何一处逻辑判断需要改动（不是纯语法机械替换）——立即停下来单独报备，不在"迁移"名义下夹带。
2. **第二步（本稿 §2/§3/§4 三条纪律落码）**：四文件的 A 类入口补 `scanOwnedTokenInputs()`+输出侧派生绑定，
   B 类入口补 `noTokenInput()`，均带 §3 的 `max_ins_scan` 边界纪律；PayoutShard/PayoutShardV2 的 A 类入口
   （absorb/claim/refund_claim/zk_handoff）同样补齐（这两文件已过语法迁移，直接进第二步）。
   `ShardLeaf_direct.convert_to_rootclose` 的"同形改"（ledger 1121 点名）落在这一步——它是 A 类单一去向入口，
   套 §2 表格既有的"输出侧派生绑定 = `OpOutputCovenantId(rcOutIdx)`"形，不需要额外设计。
3. **第三步**：19 条入口逐条运行期向量（§8 向量计划）+ T4 创世对照 MUST 联调（v0.1 §1 已定的 13+4 新/搬状态
   字段）。

**范围声明**：第一步是纯语法迁移, 不改变任何合约的花费逻辑或安全性质——按 f2fce916 的经验, 预计每文件的
坑集中在同一批四类模式, 机械排查成本可控, 但**必须逐文件真实编译验证, 不能假设"跟前三个文件一样"就跳过实测**。

## 8. 向量计划（v0.3 更新，累加 v0.1 §5 原计划，不是替换）

| 组 | 条数 | 内容 |
|---|---|---|
| A 类 ×15（v0.1 原定） | 每条 ≥3 | 正 · 反 owner 改别的 cov id · 反 amount 改；含领取输出的再加 反 `market_cov_id` |
| A 类新增：`scanOwnedTokenInputs()`边界 | 每文件 1 套(共享 max_ins_scan 常量) | 界处/界+1/victim末位可达，同 §3 探针形（已在探针层面证过机制，19 条入口逐条落码时各自复现一遍，不是免检） |
| A 类新增：输出侧派生绑定负向量 | 每条 A 类入口 1 | 输入对上、输出 owner 改陌生 covenant ⇒ fail（§4，已探针证过机制） |
| B 类 ×8（v0.1 原定） | 每条 4 | P13 两层：真字节+无代币 pass / 1 个代币输入 fail / witness 字节差一字节 fail / 输入尾差一字节 pass |
| B 类新增：`noTokenInput()`边界 | 每条 1 套 | 同 A 类边界形 |
| B 类新增：夹带归己代币负向量（1123-b3） | 每条 2 | 归己代币输入+无续约(entry no-op) ⇒ fail；同上但 entry 有真实状态变化 ⇒ fail |
| 常量搬迁 | 每文件 1 | Q4 同款对照编译 |
| baked-use 删除 | 2 | 不变 |
| T4 | 5 | 不变 |
| 翻转臂 | 每文件 1 | 不变 |
| §3.0.1 draw-down 不变量（四处, **已兑现**） | 每处 4(v0.3 精简自 v0.1 §5 的最少 5 类) | 见 `docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/`，16/16 PASS |

## 9. 交付物清单

- `2a5c1eb0`：T1 v0.6（KanetTestToken.sil 删 b-out + 守恒放宽）。
- `f2fce916`：T3 四处 draw-down MUST-FIX + 必要 v1.0.0 迁移修复（PayoutShard/PayoutShardV2/RootClaim 三文件）。
- `docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/`：16/16 向量，MANIFEST 20/20。
- `docs/provenance/2026-09-14-j2-t3-v03-maxinsscan-notoken-outbind-probe/`：9/9 向量（max_ins_scan 边界 4 +
  noTokenInput 负向量 3 + 输出侧绑定 2），MANIFEST 6/6。
- 本稿（v0.3）：§1 封闭集合表 + §2 全 23 入口 A/B 落位表 + §3/§4/§5/§6 三前提 + D-018 引用 + §7 迁移阻断消除
  计划 + §8 向量计划更新。

## 10. 没核到的（如实记录）

- §2 表格是**设计层**落位（RHS 表达式 + 输出绑定表达式怎么写），**不是**已落码的 .sil——19 条非 draw-down 入口
  的实际代码改动待 §7 迁移完成后进行。
- `RefundClaim.sil` 是否在主网集仍未定案（同 v0.1 §7），本稿 §1 封闭集合表按"当前"7 文件走，不预判。
- committee 签名验证（PayoutShard/PayoutShardV2 的 close_attest/cancel_attest）本次只confirm 编译通过
  （f2fce916），真实 5-of-5 委员签名 + depth-8 merkle 向量未构造，留 T3 v0.3 全量落码时一并做。
