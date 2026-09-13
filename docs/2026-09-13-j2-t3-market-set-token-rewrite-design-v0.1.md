# T3 · 主网集 7 合约的代币化改法 · 设计稿 v0.1（23 入口逐条二选一 + 22 常量去向 + 向量计划 · 不写 .sil）

> **Status**: DRAFT-FOR-REVIEW **v0.1**（2026-09-13 · J2 · Bettor 派工（NWT 合审 89eadff4，ledger 1053）· 输入裁决：**T1 v0.5 GREEN**（三 MUST 独立重编兑现；Q7 `winner_pk = byte[32]`）· **T2 骨架方向 GREEN**（Q1 裁 (b) 领取合约自核代币输出——NWT 对 (a) 构造了 close_attest 浅检查攻击；Q6 SHOULD；§3.3 形 NWT 从 codegen 源码确认与 P13 互证；§3.1 委员收窄为一个 `committee_hash`）· **Q8 裁决**：判据 = **结构性用途才强制 ctor**；`gateTmplHash` **MUST 留 ctor**（搬状态 = 创世状态不受检的洞开在 ZK 电路锚上）；其余 6 个模板 hash **留 ctor**（Bettor：家族链单向不成环）；`poolMerkleRoot`/`committee_hash` 可搬，**T4 对照升 MUST**；`market_id` 删；`predicate_commit` baked-use 两行删；`seal_count`/`min_bet` 由本稿拍 · **Bettor 拍 T4 对照范围 = 市场创世全部状态字段**（单源产物逐字节对照 + P2SH 重算 + `market_genesis` intent + landed 硬门）· 数据 = 盘点稿 `docs/2026-09-13-j2-t3-mainnet-set-ctor-inventory-for-q8-v0.1.md`（22 常量位点）+ 本机 7 文件 34 处 `.value` 引用逐行（§3）· 交 NWT → Bettor → 🔴 市场合约 = 钱路 ⇒ Owner 批（D-017 §3）后才写 `.sil`。

## 0. 一句话

主网集 7 合约的 **23 条入口**逐条定：**A 类 15 条**（会与代币共花）= 把每处 KAS value-weld 换成**代币 amount weld**（`validateOutputStateWithInputTemplate` 核代币输出 `owner/amount/0x04/0x00/0/0`），**B 类 8 条**（不共花）= 加 P13 形不在场证明（witness 供代币模板前后缀 + 状态 `token_tmpl_hash` blake3 现场验 + 尾匹配）；**22 个非状态 ctor 常量**按 Q8 裁决：**7 个模板 hash 留 ctor**（`gateTmplHash` MUST），**13 个搬进状态**（含我拍的 `seal_count`/`min_bet`），**`market_id` 删**，**`predicate_commit` 搬状态 + 删两行 baked-use**，`rootclose_init_payoutRoot` 改字面量；市场状态新增 **4 个代币锚字段**（`token_tmpl_hash / token_prefix_len / token_suffix_len / claim_tmpl_hash`），全部进 T4 创世对照（MUST）。34 处 `.value` 引用逐行给替换（§3）。向量：A 类每条 ≥3、B 类每条 4 档、外加 T4 五条。

## 1. 22 个非状态 ctor 常量的去向（Q8 裁决落地 · 附盘点稿位点）

| 常量（文件） | 裁决 | 去向 | 改动 |
|---|---|---|---|
| `gateTmplHash`（CloseZkV2:17） | **MUST 留 ctor**（NWT） | ctor | 不动。理由记档：ZK 电路锚若进状态，创世状态不受检 ⇒ 攻击者创世一个锚指向自己 guest 的 CloseZk 实例——虽然 T4 对照能拦 console 自己的创世，拦不住别人创世；留 ctor = 换 guest 就是换模板，模板 hash 由代币/上游烤死 |
| `ps_tmpl_hash`（ShardLeaf:24 / ShardLeaf_direct:27 / RootClaim:16）、`rootclose_tmpl_hash`（ShardLeaf_direct:31）、`closeZkTmplAnchor`（PayoutShardV2:38）、`claim_tmpl_hash`（RootClose:32）、`refundclaim_tmpl_hash`（RootClose:33） | 留 ctor（Bettor） | ctor | 不动。家族链 Leaf→PS→Root→Claim 单向，无环；代价 = 下游改则上游重编，接受 |
| `poolMerkleRoot`（PayoutShard:36 / PayoutShardV2:36） | 可搬 + T4 对照 MUST | **状态** | ctor 改 `init_poolMerkleRoot`，状态字段 `byte[32] poolMerkleRoot`；6 处 `cXCur == poolMerkleRoot` 不改（读状态同名） |
| `committee_hash`（RootClose:30） | 可搬 + T4 MUST | **状态** | 同上；:75 的 blake2b 比较不改 |
| `market_id`（ShardLeaf:23 / ShardLeaf_direct:26） | **删** | — | ctor 删参；P2SH 唯一性由 `shard_pool_id`（状态）+ 代币锚字段共同保证（T4 对照核 `shard_pool_id` 唯一） |
| `predicate_commit`（PayoutShard:37 / PayoutShardV2:37） | 搬状态 + 删 baked-use | **状态** | ctor 改 `init_predicate_commit`；删 PayoutShard:84/:246、PayoutShardV2:98/:201 四行 `require(blake2b(byte[](predicate_commit)) != predicate_commit)` |
| `seal_count`（ShardLeaf:26 / ShardLeaf_direct:29） | 本稿拍 | **状态** | 理由：按市场分片数配置（DoD=1 只是现状）；int 等值/比较，零结构性用途；T4 对照免费覆盖。ctor 改 `init_seal_count` |
| `min_bet`（ShardLeaf:27 / ShardLeaf_direct:30） | 本稿拍 | **状态** | 同上；最小注按市场定是产品面（Owner 可调）；语义从 sompi 改代币 amount |
| `shard_pool_id`（ShardLeaf:25 / ShardLeaf_direct:28 / RootClaim:17） | 是 | **状态** | 写进 ticket 的值 / RootClaim:67 等值 |
| `payout_cov_id`（ShardLeaf:28） | 是 | **状态** | :100/:104 等值；provenance 形保留（创世时 console 填下游 PS 实例 id，T4 对照核它 == 真 PS 创世 cov id） |
| `deadline`（ShardLeaf:29）、`deadline_ms`（RootClose:31）、`attestedAtMs`（CloseZkV2:20） | 是 | **状态** | 三处 `tx.time` 比较与**批 B temporal 迁移同处改**（重编清单批 B 恰是这三文件）；CloseZkV2 与 PayoutShardV2 的 `attestedAtMs` 统一为状态 |
| `betsRootBaked`、`refundRootBaked`（CloseZkV2:18-19） | 是 | **状态** | :45 hash 输入 / :100 等值不改 |
| `rootclose_init_payoutRoot`（ShardLeaf_direct:32） | 恒零 | **字面量** | :111 改 `payoutRoot: byte[32](0x00…)`；ctor 删参 |

**计数**：留 ctor 7 · 搬状态 13 · 删 1 · 字面量 1 = 22。**新增状态字段（每个市场合约）**：`token_tmpl_hash byte[32]`、`token_prefix_len int`、`token_suffix_len int`（A/B 两类都要）+ `claim_tmpl_hash byte[32]`（只有创建领取输出的入口所在文件：PayoutShard/PayoutShardV2/RootClaim/CloseZkV2；RootClose 已有 `claim_tmpl_hash` 但按裁决留 ctor——**注意两者不同物**：RootClose 的是 RootClaim 模板，这里的是 KanetTokenClaim 模板）。ctor 只剩 `init_*` + 7 个留下的模板 hash。**T4 对照（MUST）覆盖全部状态初值**：对 13+4 个新/搬字段逐字节比单源产物或 console 权威值，`shard_pool_id`/`payout_cov_id` 另核唯一性/存在性。

## 2. 两个公共代码块（伪码 · 每文件一份 helper）

```
// (A) 代币输出核 —— 每条共花入口调一次或多次(每个代币输出一次)
function tokenOutOk(int tok_out, int tok_in, int amount, byte[32] owner) : bool {
    validateOutputStateWithInputTemplate(tok_out,
        TokenState { amount: amount, owner: owner, owner_scheme: 0x04, borrow_scheme: 0x00,
                     borrow_guard: ZERO32, extension_commitment: ZERO32 },
        tok_in, token_prefix_len, token_suffix_len, token_tmpl_hash);   // 三参 = 状态(P12)
    return true;   // 原语失败即 abort; 返回值只为单出口
}
// (B) 不在场证明 —— P13 形(provenance …-t2-p13-no-token-proof-a2)
function noTokenInput(byte[] tok_prefix, byte[] tok_suffix) : bool {
    require(blake3((tok_prefix.length as byte[8]) + tok_prefix + (tok_suffix.length as byte[8]) + tok_suffix) == token_tmpl_hash);
    … P7 循环: tx.inputs[i].sigScript 尾 == tok_suffix ⇒ found …
    return !found;
}
// 领取输出(A 类里创建 KanetTokenClaim 的入口)
validateOutputStateWithTemplate(claim_out, ClaimState { market_cov_id: OpInputCovenantId(this.activeInputIndex), winner_pk: pk, amount: payout, token_tmpl_hash: token_tmpl_hash },
                                c_prefix, c_suffix, claim_tmpl_hash);   // Q1 (b): 领取状态含 token_tmpl_hash
```
`TokenState` 六字段布局 = KCC-0020 §2 原文序（T1 §1）；`tok_in` = 本 tx 里任一代币模板输入（用它的 sigScript 尾部取模板字节——`validateOutputStateWithInputTemplate` 的定位法），A 类入口都至少有一个代币输入。

## 3. 23 条入口逐条（A/B · 34 处 `.value` 逐行替换）

标记：**弃 KAS weld** = 该行改为代币 amount 语义（进 `tokenOutOk` 的 `amount`），KAS 侧只剩 dust（`≥ DUST` 或不核）；**保留** = 与钱无关。

### ShardLeaf（2 入口 · 2 value 引用）
| 入口 | 类 | 改法 |
|---|---|---|
| `register_append` | **A** | 新增参 `int tok_in, int tok_out`。bettor 的代币输入 → 输出 owner **= `OpInputCovenantId(this.activeInputIndex)`**（本 leaf），`amount == stake`；`pool_value + stake` 改代币记账 `pool_amount + stake`；**:79** `tx.outputs[leafOutIdx].value == pool_value + stake` → **弃 KAS weld**（leaf 输出只带 dust）；ticket 创建（:69 `validateOutputStateWithTemplate(…ps_tmpl_hash)`）不变 |
| `consolidate_to_payout` | **A** | 新增 `tok_in, tok_out`。leaf 名下全部代币 → owner **= `OpInputCovenantId(psInIdx)`**（真 PS 实例，:100 已核 `== payout_cov_id`），`amount == pool_amount`；**:106** `tx.outputs[psOutIdx].value == tx.inputs[psInIdx].value + pool_value` → 弃 KAS weld；PS 侧 `absorb` 同笔核同一代币输出（两边都核 = H5 正交） |

### ShardLeaf_direct（2 · 2）
| 入口 | 类 | 改法 |
|---|---|---|
| `register_append` | **A** | 同 ShardLeaf；**:92** 弃 KAS weld |
| `convert_to_rootclose` | **A** | 代币 → owner **= `OpOutputCovenantId(rcOutIdx)`**（RootClose 是本笔新建输出），`amount == pool_amount`；**:114** `tx.outputs[rcOutIdx].value == pool_value` → 弃；:111 `payoutRoot` 改字面量零 |

### PayoutShard（5 · 8）
| 入口 | 类 | 改法 |
|---|---|---|
| `absorb` | **A** | 代币（owner = 输家 leaf）→ owner **= 本 PS**（`OpInputCovenantId(this.activeInputIndex)`），`amount == shard_amount`；**:55** `shard_value = tx.inputs[shardInIdx].value` → 改读**代币输入状态** `readInputStateWithTemplate(tok_in, token_prefix_len, token_suffix_len, token_tmpl_hash).amount`；**:62** weld → 代币 `consolidated_pool + shard_amount` |
| `close_attest` | **B** | 加 `noTokenInput(tok_prefix, tok_suffix)`（witness 两参）；**:167** `== consolidated_pool` KAS weld → 弃（PS 输出 dust） |
| `claim` | **A** | 代币 → **领取输出**（§2 第三块，`amount == payout`，`winner_pk` = merkle 叶 pk）+ 剩余代币 owner = 本 PS `amount == consolidated_pool − payout`；**:217/:224** 两处 KAS weld → 弃 |
| `cancel_attest` | **B** | 加 `noTokenInput`；**:326** 弃 |
| `refund_claim` | **A** | 代币 → 领取输出（`winner_pk` = bettor pk，`amount == refund`）+ 剩余 owner = 本 PS；**:382/:389** 弃 |

### PayoutShardV2（5 · 7）
| 入口 | 类 | 改法 |
|---|---|---|
| `absorb` | **A** | 同 PayoutShard；**:65/:76** |
| `close_attest` | **B** | `noTokenInput`；**:180** 弃 |
| `cancel_attest` | **B** | `noTokenInput`；**:283** 弃 |
| `refund_claim` | **A** | 同 PayoutShard；**:333/:344** 弃 |
| `zk_handoff` | **A** | 全部代币 → owner **= CloseZkV2 输出 cov id**（`OpOutputCovenantId(zkOutIdx)`；:378 模板锚核不变），`amount == consolidated_pool`；**:398** 弃；本 PS 终态无续约 |

### RootClose（4 · 5）
| 入口 | 类 | 改法 |
|---|---|---|
| `close_commit` | **B** | `noTokenInput`；**:89** 弃 |
| `refund_flip` | **B** | `noTokenInput`；**:101** 弃 |
| `convert_to_claim` | **A** | 全池代币 → owner = `OpOutputCovenantId(claimOutIdx)`（RootClaim），`amount == pool_amount`；**:114** 弃 |
| `convert_to_refundclaim` | **A** | 同上 → RefundClaim；**:124** 弃 |

### RootClaim（1 · 2）
| 入口 | 类 | 改法 |
|---|---|---|
| `claim_draw` | **A** | **本稿主形（P12）**：代币 → 领取输出 `ClaimState{ market_cov_id: OpInputCovenantId(this.activeInputIndex), winner_pk: pk（merkle 叶）, amount: payout, token_tmpl_hash }`；剩余 owner = 本 root，`amount == pool_amount − payout`；**:94/:108** 弃；dust-ticket spent-once（:66）不变 |

### CloseZkV2（4 · 8）
| 入口 | 类 | 改法 |
|---|---|---|
| `zk_close` | **B** | `noTokenInput`；**:60** 弃 |
| `escape_trigger` | **B** | `noTokenInput`；**:68** 弃 |
| `escape_claim` | **A** | 代币 → 领取输出（`winner_pk` = bettor，`amount == stake`）+ 剩余 owner = 本合约；**:126/:128/:130** 弃（:128 的"最后一笔全额"分支 → 剩余 amount == 0 时不留代币输出） |
| `claim` | **A** | 同 escape_claim 形，`amount == payout`；**:193/:197/:199** 弃 |

**计数**：A 15 / B 8；`.value` 引用 34 处全部弃 KAS weld（改代币 amount weld 或删），**0 处保留**——主网集内 KAS 只剩 dust 与 fee。

## 4. 与批 B / C′ / T4 / T5 的顺序
- 每文件一次打开：本稿 A/B 改法 + 批 B `tx.time` temporal（ShardLeaf/RootClose/CloseZkV2）+ C′ 新拒绝分诊 + Q8 常量搬迁，**同一轮**。
- T4（创世对照 MUST）在任何市场创世之前落码；T5（settler/payout 构造）在 (c) 合入之后（`bettor-prediction-settler.js` 同文件）。

## 5. 向量计划（数字不作排期依据）
| 组 | 条数 | 内容 |
|---|---|---|
| A 类 ×15 | 每条 ≥3 | 正 · 反 owner 改别的 cov id · 反 amount 改；含领取输出的再加 反 `market_cov_id`（P12 四臂） |
| B 类 ×8 | 每条 4 | P13 两层：真字节+无代币 pass / 1 个代币输入 fail / witness 字节差一字节 fail / 输入尾差一字节 pass |
| 常量搬迁 | 每文件 1 | Q4 同款对照编译：换全部状态初值 ⇒ template_hash 不变；换任一留 ctor 的模板 hash ⇒ 变 |
| baked-use 删除 | 2 | 删前删后 hash 变（重编面记录，非回归） |
| T4 | 5 | T2 骨架 §4 |
| 翻转臂 | 每文件 1 | |

## 6. 请 NWT 判
1. `seal_count`/`min_bet` 我拍进状态（§1）。
2. B 类入口的 KAS dust weld 是否也要核 `≥ DUST`（防输出被压成 0 值不可花）——我倾向核一个常量 `DUST_MIN`（ctor 结构常量）。
3. `escape_claim`/`claim` 的"最后一笔全额"分支：代币 amount == 0 时不留代币输出——与 KCC-0020 `amount > 0` 约束一致，请确认。
4. 领取输出的 dust KAS 由结算 tx 的 fee 输入付（T2 Q3）——本稿按此写。

## 7. 没核到的
- 23 条入口的**完整参数签名**未逐条展开（v0.2 展开，落 .sil 前）；本稿只定每条要加的 `tok_in/tok_out/tok_prefix/tok_suffix/c_prefix/c_suffix` 参数。
- `readInputStateWithTemplate(...).amount` 读代币输入状态（absorb :55 的替换）在 v1.0.0 的形：P11 证 `Foreign m = readInputStateWithTemplate(...)` 可编；`.amount` 字段访问未单独试。
- CloseZkV2 `claim`/`escape_claim` 的输出形（现在是 P2PK 输出给 bettor？）——改为领取覆盖模板输出后 ZK journal 是否要变（`guestPayoutRoot` 叶公式含 pk 与 payout，不含输出形，应不变；未核）。
- RefundClaim 是否在主网集。
