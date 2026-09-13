# T4 · 增补稿 v0.3（创世对照清单扩到 8 合约·T3 v0.3/v0.4 代币化新增 ctor 常量·核出一处既有假设失实）

> **Status**: DRAFT-FOR-REVIEW v0.3（2026-09-14 · J2 · ledger 1195 派发，承接 T4 v0.2，只增补/更正 §2.1.1 相关
> 内容，不改动 v0.2 其余各节。输入：T3 v0.5 as-built 稿（`docs/2026-09-14-j2-t3-as-built-and-merge-readiness-
> v0.5.md`）§2/§5 第4项 + 本次对 8 个文件 `.sil` 源码的直接核对）

## 0. 一句话

T4 v0.2 §2.1.1 写"7 个模板 hash 留在 ctor"的清单时，T3 的代币化（v0.3/v0.4，ledger 1183/1186/1188）还没
落码。代币化给全部 8 个文件新增了 `token_tmpl_hash`（8 文件全有）+ `claim_tmpl_hash`（KanetTokenClaim 的
模板，5 文件有，**与 RootClose 已有的同名 `claim_tmpl_hash` 字面重名但指向不同物**）+ `market_suffix_hash`
（5 文件有）三个新的 ctor-only 常量，T4 §2.1.1 的清单需要扩到覆盖它们。本次核对源码时**顺手发现一个此前
没人核过的问题**：T4 v0.2 §2.1 表格把 `poolMerkleRoot`/`committee_hash`/`predicate_commit` 归类为"已搬
状态"（可以用 cheap-tier 状态区位点比对），但**当前 `PayoutShard.sil`/`PayoutShardV2.sil`/`RootClose.sil`
的实际源码里，这三个字段仍是纯 ctor 参数，没有被赋值进任何 mutable state 变量**——它们跟"7 个模板 hash"
结构上是同一类东西（ctor-only、`state_span` 之外），T4 v0.2 §2.1 假设的"cheap tier 可覆盖"目前**不成立**。

## 1. 更新后的 ctor-only 哈希/锚常量完整清单（覆盖全部 8 文件）

沿用 T4 v0.2 §2.1.1 的判据：这类字段的覆盖路径是步骤 **(c)**（全字节重编译比对）+ **(d)**（P2SH 核对），
**不进 §2.1 的状态字段表**——机制本身不变，本节只是把枚举补全。

| 常量名 | 出现的文件 | 类别 | 备注 |
|---|---|---|---|
| `ps_tmpl_hash` | `ShardLeaf`/`ShardLeaf_direct`/`RootClaim`/`RefundClaim`（4 文件，v0.2 写"×3"时 `RefundClaim` 还没收口进 8 合约，本次更正为 ×4） | 原 7 个之一 | dust PoolSide-ticket 模板锚 |
| `rootclose_tmpl_hash` | `ShardLeaf_direct` | 原 7 个之一 | `convert_to_rootclose` foreign-template 桥 |
| `closeZkTmplAnchor` | `PayoutShardV2` | 原 7 个之一 | `zk_handoff` 桥接 `CloseZkV2` 用 |
| `claim_tmpl_hash`（**RootClose 语境**，指向 `RootClaim` 模板） | `RootClose` | 原 7 个之一 | `convert_to_claim` foreign-template 桥 |
| `refundclaim_tmpl_hash` | `RootClose` | 原 7 个之一 | `convert_to_refundclaim` foreign-template 桥 |
| `gateTmplHash` | `CloseZkV2` | 原 7 个之一 | ZK 电路/guest image 锚，只能靠 (c)+(d)（v0.2 §2.1.1 已论证，不进逐字段比对） |
| **`token_tmpl_hash`**（T3 v0.3/v0.4 新增） | **全部 8 文件**（`RootClose`/`ShardLeaf`/`ShardLeaf_direct`/`PayoutShard`/`PayoutShardV2`/`RootClaim`/`RefundClaim`/`CloseZkV2`） | **新增** | 代币模板锚（KanetTestToken），`scanOwnedTokenInputs`/`noTokenInput`/`readInputStateWithTemplate` 现场 blake3 核对用（Bettor 1151 裁：市场只嵌 hash，不烤代币字节本身） |
| **`claim_tmpl_hash`**（**T3 v0.3 新语境**，指向 `KanetTokenClaim` 模板，**与上面 RootClose 那个字面同名、指向不同物**） | `RootClaim`/`RefundClaim`/`PayoutShard`/`PayoutShardV2`/`CloseZkV2`（5 文件） | **新增** | claim 家族"目的地重定向"用，创建新 `KanetTokenClaim` 实例时核对（ledger 1183） |
| **`market_suffix_hash`**（T3 v0.3 新增） | `RootClaim`/`RefundClaim`/`PayoutShard`/`PayoutShardV2`/`CloseZkV2`（5 文件） | **新增** | `KanetTestToken.market_tmpl_suffix` 字节的 blake3 承诺，写入新建 `KanetTokenClaim` 实例的 `ClaimState.market_suffix_hash` 字段用 |

**计数**：原 7 个 distinct 名称（跨 6 个文件出现，`ps_tmpl_hash` 一名四见）+ 新增 3 个 distinct 名称（跨
8+5+5=18 处 ctor 槽位）= **10 个 distinct 名称，覆盖全部 8 文件、共 25 处 ctor-only 哈希/锚槽位**。

## 2. 名称碰撞警告（沿用 T4 v0.2 §2.1 row 24 已指出的坑，本次扩大点名）

T4 v0.2 §2.1 第 24 行已经写过一句"与 RootClose 已有的 `claim_tmpl_hash`（RootClaim 模板，留 ctor）不是同一
物"——当时只提到 `RootClose` 一处。**本次核对确认：这个同名不同物的碰撞现在存在于 6 个文件里**（`RootClose`
的 `claim_tmpl_hash` 指向 `RootClaim` 模板；`RootClaim`/`RefundClaim`/`PayoutShard`/`PayoutShardV2`/
`CloseZkV2` 的 `claim_tmpl_hash` 全部指向 `KanetTokenClaim` 模板）。**任何后续写 T4 对照/解码器代码的人，
必须按"文件名 + 字段名"两段式唯一识别，不能只按字段名分组**——否则会把两种完全不同的模板锚混在同一个
比对桶里，产生假阳性或假阴性都有可能（例如误用 `RootClose.claim_tmpl_hash` 的真实值去对照
`RootClaim.claim_tmpl_hash` 应该等于的值，两者本来就不该相等，误报"漂移"）。这条纪律建议直接写进
`bshard-payout-family-coherence.mjs` 未来的解码器命名规范（例如 `claim_tmpl_hash` 只在跨文件比较文档/
注释里使用全限定名 `RootClose.claim_tmpl_hash` vs `RootClaim.claim_tmpl_hash`，不要图省事简写）。

## 3. 如实记录：`poolMerkleRoot`/`committee_hash`/`predicate_commit` 目前不是状态字段（本次核对新发现）

T4 v0.2 §2.1 表格第 25/26/27 行把这三个字段写成"PayoutShard/PayoutShardV2（搬状态）"/"RootClose（新增位点，
需要 `decodeRootCloseState`）"——暗示它们已经（或即将）从 ctor 移进 mutable state，可以用 cheap-tier 的
"解码状态区 + 位点比对"覆盖，不需要每次都跑全量 recompile。

**本次直接读 `PayoutShard.sil`/`PayoutShardV2.sil`/`RootClose.sil` 当前源码逐行核对，结论是：这三个字段
在当前代码里都还是纯 ctor 参数，合约体内没有对应的 `int/byte[32] xxx = init_xxx;` 或 `xxx = xxx;` 赋值语句
——它们不在 `state_span` 覆盖的运行期状态字节里，跟"7+3 个模板/代币锚"是完全同一类东西（ctor-only）**。
这与 T4 v0.2 §2.1 的假设不符——**如果这个假设是"T3 §1 计划要做但目前还没做"，那不算矛盾，只是排期问题；
如果假设的是"T3 已经做了"，那这条现在是错的**——本次核对范围（T3 v0.3/v0.4 代币化）没有看到任何一处把
这三个字段搬进 state 的改动，两份 T3 设计稿（v0.3/v0.4）也都没提过这件事，怀疑 T4 v0.2 写作时依据的是
一份更早期、尚未真正落码的 T3 §1 计划文本，而非已落码的当前状态。

**影响**：Q2 裁定的"`poolMerkleRoot`/`committee_hash` 进 cheap tier 第一批"（T4 v0.2 §2.1 末段）**目前
无法直接落码**——没有状态区位点可解码，`decodeV1State`/`decodeRootCloseState` 这两个解码器如果现在写，
对这三个字段无字可解。**两条路，交 Bettor/NWT 裁**：
1. **先补一笔 T3 侧改动**，把 `poolMerkleRoot`/`committee_hash`/`predicate_commit` 从 ctor 移进 state（改
   合约的 genesis-state 布局，会改变 `state_span`，需要重新走一轮编译验证+向量，跟本次 T3 v0.3 代币化
   同等量级的工作，不是小改）；
2. **或者**：接受这三个字段维持 ctor-only，T4 §2.1.1 的清单再加 3 个名字（`poolMerkleRoot`/
   `committee_hash`/`predicate_commit`），一起归进"步骤 (c)+(d) 覆盖，不进状态字段表"这条路径——放弃
   "委员/oracle 身份锚优先覆盖 cheap tier"这个 Q2 排期理由本身要求的"更快检测"（cheap tier 每次构造前都
   查、full 只在创世时跑一次；如果这三个字段只能靠 full，日常构造前的"快查"就查不到它们，等于把 Q2 想
   优先覆盖的东西又推回最慢的那条路径）。

本稿不代为裁定选 1 还是 2——这需要 Bettor 判断"要不要为了 cheap-tier 覆盖这三个身份锚字段，再开一轮 T3
式的状态布局改动"这个成本是否值得，J2 只负责把"现状与 T4 v0.2 假设不符"这件事钉实、把两条路径摆清楚。

## 4. 没有变化的部分（明确排除，避免误读成本节重写了 T4 v0.2）

- §2.1 的"7+3=10 个新增"之外的**其余状态字段**（`shard_pool_id`/`payout_cov_id`/`deadline`/`seal_count`/
  `min_bet`/`betsRootBaked`/`refundRootBaked`/`attestedAtMs`）的覆盖计划、优先级排期（Q2 裁定的"5 个字段
  分期做"那部分）不受本稿影响——那些字段本来就在讨论的是"状态区位点"，跟本稿新增的"ctor-only 常量"是
  两条不同的路径，互不冲突。
- §3（`market_genesis` intent）、§4（消费门衔接）、§5（填错自毁的检测与告警）、§6（三问裁定）**原文不动**
  ——本稿只增补/更正 §2.1/§2.1.1 相关的枚举与一处新发现的假设失实，不涉及这几节。

## 5. 没核到的（如实记录，同 T4 v0.2 §7 体例）

- 本稿只核对了 `poolMerkleRoot`/`committee_hash`/`predicate_commit` 这三个字段"是否被赋值进 state 变量"这
  一个二元事实（读源码即可确认），**没有**进一步核对 T3 早期文档（v0.1/v0.2 设计稿）里是否有更早的、
  T4 v0.2 写作时依据的"计划搬状态"的具体出处——这条留给 Bettor/NWT 判断这个假设的历史来源，本稿不猜测。
- `decodeV1State`/`decodeRootCloseState` 两个解码器（T4 v0.2 §2.1 提过"新增"）目前都还没有落码，本稿第 3
  节的"两条路"判断建立在"当前 `.sil` 源码现状"之上，如果 Bettor 选路径 1（补一笔 T3 状态布局改动），
  这两个解码器的具体字节偏移表要在那笔改动落码、重新编译量测后才能定，本稿不预先假定数字。
