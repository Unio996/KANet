# T3 · as-built 汇总稿 v0.5（8 文件全 24 入口代币化落码完成 · 联合合入准备）

> **Status**: DRAFT-FOR-REVIEW v0.5（2026-09-14 · J2 · Bettor ledger 1194 派发，六节：①提交清单 ②逐文件表
> ③§2 表最终打勾版 ④provenance 索引 ⑤开放项 ⑥联合合入准备。本稿是"做了什么"的记账稿，不是新设计——
> 设计权威仍是 v0.1/v0.2/v0.3/v0.4 四份稿，本稿只汇总落码结果并如实记录尚未闭环的部分）

## 0. 一句话

自 `2a5c1eb0`（T1 v0.6 基线）起 31 笔 commit，把 T3 v0.3 §2 表全部 **24 个入口**（A=16/B=8，8 文件封闭集，
含 v0.4 收口的 `RefundClaim.sil`）从设计落到编译通过 + 运行期向量证明，累计约 **205 条向量**全部 PASS
（各批次独立 README，明细见 §4）。批次④（本会话窗口，`24aea3cc`→`de7582ca`）是收官的最后四笔。

## 1. 侧分支自 `2a5c1eb0` 起全部提交清单

| # | Hash | 一行摘要 | 触及文件 | 状态（Bettor/NWT，据 ledger 引用） |
|---|---|---|---|---|
| 1 | `f2fce916` | 四处 draw-down MUST-FIX 落码(§3.0.1) + 必要 v1.0.0 迁移修复 | PayoutShard/PayoutShardV2/RootClaim | NWT `2026-09-13-nwt-redteam-...-v0.2-must-fix-and-codex-invariant-review-v0.1.md` 设计级 PASS，本笔落码兑现 |
| 2 | `949dfc96` | 全 23 入口 A/B 落位表+max_ins_scan 边界纪律+双边对账+币解耦(v0.3 设计稿) | docs/ | 设计稿，NWT `2026-09-13-nwt-redteam-j2-t3-market-set-token-rewrite-v0.1-review-v0.1.md` GREEN-with-ONE-MUST-FIX（即 #1） |
| 3 | `b5a2924c` | CloseZkV2.sil 纯 v1.0.0 语法迁移 | CloseZkV2 | 语法迁移，见 provenance `syntax-migration-closezkv2` 8/8 PASS |
| 4 | `b4f91725` | RootClose.sil 纯 v1.0.0 语法迁移 | RootClose | provenance `syntax-migration-rootclose` |
| 5 | `a2414013` | ShardLeaf.sil 纯 v1.0.0 语法迁移 | ShardLeaf | provenance `syntax-migration-shardleaf` |
| 6 | `6eaec993` | ShardLeaf_direct.sil 纯 v1.0.0 语法迁移 | ShardLeaf_direct | provenance `syntax-migration-shardleaf-direct` |
| 7 | `114272cc` | V-T-8 根因记档: readInputStateWithTemplate+validateOutputState 同函数共存运行期必崩 | docs/ | NWT `2026-09-13-nwt-redteam-j2-v-t-6-root-cause-v0.3-review-v0.1.md`（同族 V-T-6 文档确认属工具链层限制，独立复现四探针） |
| 8 | `99084e35` | AB10 死路论证 + AB11 通路(手写 State 编码绕开崩溃) | docs/ | ledger 1140/1142 |
| 9 | `edc8b959` | PayoutShard.absorb 落码(AB11 绕开 V-T-8) + close/cancel_attest noTokenInput | PayoutShard | provenance `payoutshard-absorb-ab11-and-batest`（含后续 5a0e2729/2bbf84fd 增补） |
| 10 | `2bbf84fd` | 补 noTokenInput() 的 1122 边界向量(界/界+1/victim 末位) | docs/provenance | 同上 |
| 11 | `22bf679a` | KanetTokenClaim.sil 落码(T2§2 领取 covenant) | KanetTokenClaim | provenance `j2-t2-kanettokenclaim` 9/9 PASS |
| 12 | `5a0e2729` | PayoutShard scanOwnedTokenInputs/noTokenInput 改回 P13 witness+blake3 形 | PayoutShard | ledger 1151 裁定（J2 自纠错误：误判 blake3 非内置函数） |
| 13 | `95e7c909` | KanetTokenClaim spend() 路径(ii) 加 ZERO32 目的地守卫 | KanetTokenClaim | NWT 1155/1158 MUST-FIX |
| 14 | `32e480d9` | KanetTestToken.transferPolicy 加 ZERO32 铸币守卫（**T1 v0.7**） | KanetTestToken | NWT 1158；`0073b0a5` 复核 v0.1 |
| 15 | `2d1e5e58` | PayoutShardV2.sil 代币化(absorb AB11+P13 + close/cancel_attest B 类) | PayoutShardV2 | provenance `payoutshardv2-absorb-batest-ab11` 13/13 PASS |
| 16 | `79fcfe1a` | RefundClaim.sil §7 v1.0.0 语法迁移 | RefundClaim | provenance `syntax-migration-refundclaim` 3/3 PASS |
| 17 | `f8e95e35` | RefundClaim.refund_payout 补 remaining==0 无续约分支 | RefundClaim | provenance `refundclaim-drawdown-mustfix` 4/4 PASS |
| 18 | `6bc8ff55` | RefundClaim.sil 代币化(退款目的地改 KanetTokenClaim 输出) | RefundClaim | provenance `refundclaim-tokenization` 6/6 PASS |
| 19 | `6bf315bf` | 更正 RefundClaim README 对 ZERO32 守卫的解释 | docs | ledger 1173 NWT 措辞纠正 |
| 20 | `a8f8b913` | KanetTokenClaim spend() 路径(i) 加 ZERO32 目的地守卫 | KanetTokenClaim | NWT 1176 MUST-FIX，同 class 另一半 |
| 21 | `01a12539` | CloseZkV2.sil 代币化(zk_close/escape_trigger B 类 + claim/escape_claim 重定向) | CloseZkV2 | provenance `closezkv2-tokenization` 11/11 PASS；NWT 全 GREEN（`c7eda166` 已推，ledger 1189） |
| 22 | `fbad9c67` | PayoutShardV2.zk_handoff 代币化(A 类全额转移给新 CloseZkV2) | PayoutShardV2 | provenance `payoutshardv2-zkhandoff-tokenization` 5/5 PASS；同上 NWT GREEN |
| 23 | `6156e98d` | RootClaim.sil 代币化(claim_draw 目的地改 KanetTokenClaim + AB11) | RootClaim | provenance `rootclaim-tokenization` 6/6 PASS；同上 NWT GREEN |
| 24 | `0d8a61ee` | PayoutShard.sil claim/refund_claim 代币化(KanetTokenClaim 重定向+AB11) | PayoutShard | provenance `payoutshard-claim-family-tokenization` 12/12 PASS；同上 NWT GREEN |
| 25 | `e9ff2171` | PayoutShardV2.refund_claim 代币化(claim 家族收尾) | PayoutShardV2 | provenance `payoutshardv2-refundclaim-tokenization` 6/6 PASS；同上 NWT GREEN |
| 26 | `24aea3cc` | **RootClose** convert_to_claim/convert_to_refundclaim ZERO32 目的地守卫(Codex/NWT 最高风险) | RootClose | provenance `rootclose-zero32-guard` 6/6 PASS；ledger 1188 已核已推 |
| 27 | `e52cc887` | 同步 CloseZkV2/PayoutShardV2.zk_handoff 的 ZERO32 守卫行内注释措辞 | CloseZkV2/PayoutShardV2 | ledger 1189，纯注释 |
| 28 | `60307fc1` | **RootClose** 全 23 入口 A/B 落位表代币化(Bettor 1188 纠正范围：RootClose 是持币合约) | RootClose | provenance `rootclose-tokenization` 24/24 PASS；ledger 1190 已核已推，**NWT 审中**（截至本稿撰写，尚无 GREEN 记录） |
| 29 | `07026eef` | **ShardLeaf** 全 A/B 落位表代币化 | ShardLeaf | provenance `shardleaf-tokenization` 15/15 PASS；ledger 1194 已核已推，**NWT 审中** |
| 30 | `de7582ca` | **ShardLeaf_direct** ZERO32 守卫 + 全 A/B 落位表代币化 | ShardLeaf_direct | provenance `shardleafdirect-tokenization` 14/14 PASS；ledger 1194 已核已推，**NWT 审中** |
| 31 | `c8153301` | as-built 稿 MAX_INS_SCAN 文档演进说明(裁定 8 成立)+ 新增活性核对开放项 | docs | ledger 1195 裁定 |
| 32 | `9ff095a3` | **ShardLeaf.consolidate_to_payout ↔ PayoutShard.absorb 手接口 MUST-FIX**(相接口重复计数导致代币冻结，修法 (b)：consolidate_to_payout 收窄为纯输入侧核对) | ShardLeaf(改) + PayoutShard(未改，仅新增跨合约验收向量) | provenance `shardleaf-payoutshard-handoff-fix` 10/10 PASS(3 ShardLeaf+7 PayoutShard)；NWT ledger 1196 发现 MUST-FIX，Codex ledger 1198 独立确认+补五条负向量，Bettor 1197 批 (b)；Codex 后续复核判该缺陷 CODE-CLOSED、同笔原子方向 SUPPORTED（见 #35/#36） |
| 33 | `cf2bdd0b` | as-built 稿补记 #31/#32 两笔 commit 的提交清单行 + 逐文件表更新(ShardLeaf/PayoutShard) | docs | — |
| 34 | `d1e53d11` | T4 v0.3：创世对照清单扩到 8 合约新 ctor 常量 + 核出 poolMerkleRoot/committee_hash/predicate_commit 三字段 T4 v0.2 假设失实 | docs | ledger 1195 |
| 35 | `5c8c2b6f` | T4 v0.3 加裁定引用(ledger 1200 选②：三字段保持 ctor-only 走(c)+(d)，cheap-tier 放弃) | docs | ledger 1200 |
| 36 | `0ca4fdb2` | T4 v0.4：tripwire 硬性注释+lint钩子方案(只写方案) + predicate_commit 措辞更正(结构完整性已covered/业务裁决门未接线) | docs | NWT 复核要求，ledger 1203 |
| 37 | `e0ae924a` | **PayoutShard.absorb sole-source MUST-FIX**(shardInIdx 必须是本笔交易唯一非自持同模板代币输入，否则同笔多个合法 leaf 只点名一个会静默销毁另一个) | PayoutShard | provenance `payoutshard-absorb-sole-source-fix` 6/6 PASS；Codex ledger 1208 独立发现，Bettor 核过成立；**待 NWT 独立复现** |
| 38 | `adc37c0a` | **PayoutShardV2.absorb sole-source MUST-FIX**(同 #37 逐字复制) | PayoutShardV2 | provenance `payoutshardv2-absorb-sole-source-fix` 6/6 PASS；同上；**待 NWT 独立复现** |

（表格从 #2 开始编号是因为 #1 `2a5c1eb0` 是范围起点，不计入"自其起"的清单本身；`949dfc96` 起才是本表主体，
上面按 `git log --oneline 2a5c1eb0..HEAD` 的时间序原样排列，未重排。）

**如实记录**：#28-30（`60307fc1`/`07026eef`/`de7582ca`）以及 #26-27 都还**没有**独立的 NWT redteam 复核文档
——只有 Bettor 本人"核过已推"的确认（ledger 1188/1189/1190/1194），NWT 的正式复核仍在进行中，本稿写作时点
尚未见到对应的 `docs/2026-09-14-nwt-redteam-*` 文件。这与 #21-25（claim 家族批次，已有 ledger 1189 引用的
"NWT 全 GREEN"）状态不同，不要混报。

## 2. 逐文件表：入口 × A/B × 向量数 × AB11 常量 × bytecode_length

| 文件 | ctor 参数数 | 入口(类) | AB11(OWN_PREFIX_LEN/OWN_STATE_LEN) | bytecode_length | state_span | 向量数(所在 provenance) |
|---|---|---|---|---|---|---|
| `RootClose.sil` | 12 | `close_commit`(B) `refund_flip`(B) `convert_to_claim`(A) `convert_to_refundclaim`(A) | 无 AB11(两 A 类均无续约) | 16802 | {1,87} | 6(zero32-guard) + 24(tokenization) = 30 |
| `ShardLeaf.sil` | 12 | `register_append`(A) `consolidate_to_payout`(A，`9ff095a3` 手接口 MUST-FIX 后收窄为纯输入侧核对) | 1/36 | 15166（`9ff095a3` 后，原 15542） | {1,36} | 15(tokenization) + 3(handoff-fix，本文件那半) |
| `ShardLeaf_direct.sil` | 12 | `register_append`(A) `convert_to_rootclose`(A) | 1/36 | 15687 | {1,36} | 14(tokenization) |
| `PayoutShard.sil` | 25 | `absorb`(A，`e0ae924a` 加 sole-source 两条 require) `close_attest`(B) `cancel_attest`(B) `claim`(A) `refund_claim`(A) | 1/204 | 32779（`e0ae924a` 后，原 25967） | {1,204} | 23(absorb-ab11-and-batest) + 12(claim-family) + 7(handoff-fix) + 6(absorb-sole-source-fix) = 48 |
| `PayoutShardV2.sil` | 30 | `absorb`(A，`adc37c0a` 加 sole-source 两条 require) `close_attest`(B) `cancel_attest`(B) `refund_claim`(A) `zk_handoff`(A) | 1/288 | 29328（`adc37c0a` 后，原 22518） | {1,288} | 13(absorb-batest-ab11) + 6(refundclaim) + 5(zkhandoff) + 6(absorb-sole-source-fix) = 30 |
| `RootClaim.sil` | 13 | `claim_draw`(A) | 1/96 | 2991 | {1,96} | 6(tokenization) |
| `RefundClaim.sil` | 12 | `refund_payout`(A) | 无 AB11(直接读, 无续约同函数组合) | 2656 | {1,87} | 6(tokenization) + 4(drawdown-mustfix) + 3(语法迁移) = 13 |
| `CloseZkV2.sil` | 28 | `zk_close`(B) `escape_trigger`(B) `escape_claim`(A) `claim`(A) | 1/213 | 13382 | {1,213} | 11(tokenization) + 8(语法迁移) = 19 |
| `KanetTestToken.sil`（T1 v0.7） | 10 | `transfer`(binding=cov) `mint_issuer` `clawback` | — | — | — | 15(v06-implementation，14 PASS+1 设计内预期 fail) |
| `KanetTokenClaim.sil`（T2） | 5 | `spend`（两条路径 (i)/(ii)，各自独立 ZERO32 守卫） | — | — | — | 9(kanettokenclaim) |

**入口 A/B 落码风格的一个如实记录（本次调查发现，非缺陷）**：`scanOwnedTokenInputs()` 有**两种**实现形态并
存于代码库——(a) 多输入循环扫描版（`RootClose`/`ShardLeaf`/`ShardLeaf_direct` 全部、`PayoutShard`/
`PayoutShardV2` 的 `absorb`），用于"可能有多笔归己代币需要累加"的场景；(b) 单笔直读版（`PayoutShard.claim`/
`refund_claim`、`PayoutShardV2.refund_claim`/`zk_handoff`、`RootClaim.claim_draw`、`RefundClaim.refund_payout`、
`CloseZkV2.escape_claim`/`claim`），用 `readInputStateWithTemplate`+`heldTk.amount==X` 直接核对，因为这些
入口按设计只持有**恰好一笔**代币（终态 claim/handoff 入口）。两种形态都各自在已核过的 README 里有独立向量
证明，**不是**代币化风格不统一的疏漏——只是 A 类落位表的"合法在场不计入"这条纪律只在**可能有多笔**的场景
才需要循环扫描，单笔场景直读更简单也同样安全。

## 3. §2 表最终打勾版（24 入口全部落码完成）

标记口径同 v0.3 原表：**A** = `scanOwnedTokenInputs()==RHS` 或等效单笔直读 + 输出侧派生绑定；**B** =
`noTokenInput()`。**covenant 绑定列**：✅=已加独立 `!=ZERO32`（或更强的精确 cov_id provenance 匹配）守卫，
不依赖模板字节匹配代付。

| 文件 | 入口 | 类 | 落码 | covenant 绑定 | 向量 |
|---|---|---|---|---|---|
| ShardLeaf | `register_append` | A | ✅ | ✅（owner=self，派生表达式） | ✅ |
| ShardLeaf | `consolidate_to_payout` | A | ✅ | ✅（owner=已核==payout_cov_id 的 ps_cov，精确 provenance，非仅 !=ZERO32） | ✅ |
| ShardLeaf_direct | `register_append` | A | ✅ | ✅（同上） | ✅ |
| ShardLeaf_direct | `convert_to_rootclose` | A | ✅ | ✅（新增 `!=ZERO32`，"同 RootClose convert 形"） | ✅ |
| PayoutShard | `absorb` | A | ✅ | ✅（owner=self） | ✅ |
| PayoutShard | `close_attest` | B | ✅ | — (B 类无输出侧代币绑定项) | ✅ |
| PayoutShard | `claim` | A | ✅ | ✅（`claimCovId!=ZERO32`，1158/1173 系统性扫查） | ✅ |
| PayoutShard | `cancel_attest` | B | ✅ | — | ✅ |
| PayoutShard | `refund_claim` | A | ✅ | ✅ | ✅ |
| PayoutShardV2 | `absorb` | A | ✅ | ✅ | ✅ |
| PayoutShardV2 | `close_attest` | B | ✅ | — | ✅ |
| PayoutShardV2 | `cancel_attest` | B | ✅ | — | ✅ |
| PayoutShardV2 | `refund_claim` | A | ✅ | ✅ | ✅ |
| PayoutShardV2 | `zk_handoff` | A | ✅ | ✅ | ✅ |
| RootClose | `close_commit` | B | ✅ | — | ✅ |
| RootClose | `refund_flip` | B | ✅ | — | ✅ |
| RootClose | `convert_to_claim` | A | ✅ | ✅（`24aea3cc` 新增，Codex/NWT 点名最高风险） | ✅ |
| RootClose | `convert_to_refundclaim` | A | ✅ | ✅（同上） | ✅ |
| RootClaim | `claim_draw` | A | ✅ | ✅ | ✅ |
| CloseZkV2 | `zk_close` | B | ✅ | — | ✅ |
| CloseZkV2 | `escape_trigger` | B | ✅ | — | ✅ |
| CloseZkV2 | `escape_claim` | A | ✅ | ✅ | ✅ |
| CloseZkV2 | `claim` | A | ✅ | ✅ | ✅ |
| RefundClaim | `refund_payout` | A | ✅ | ✅ | ✅ |

**计数**：24/24 落码 ✅，16 个 A 类全部 covenant 绑定 ✅，8 个 B 类按设计无此项。**全表清空**——这是批次④
（本会话窗口）收官后达成的状态，此前 `RootClose`/`ShardLeaf`/`ShardLeaf_direct` 三文件是最后的空白。

## 4. Provenance 索引

按日期分两组，`2026-09-13`（T1/T2 早期探针）与 `2026-09-14`（T3 主批次，含语法迁移与代币化）：

**2026-09-13**：`j2-h5-p7-no-token-input-vectors`、`j2-p8-foldnode-seal-double-count`、
`j2-t1-p12-market-writes-own-covid`、`j2-t1-p9-ktt-feasibility-probe`、`j2-t1-token-sil-implementation`、
`j2-t1-v0.2-market-scan-probe`、`j2-t2-p13-no-token-proof-a2`

**2026-09-14**：`j2-t1-v06-implementation`、`j2-t2-kanettokenclaim`、`j2-vt8-read-external-plus-self-continue-probe`、
`j2-t3-v03-syntax-migration-{rootclose,shardleaf,shardleaf-direct,closezkv2,refundclaim}`、
`j2-t3-v03-drawdown-mustfix`、`j2-t3-v03-refundclaim-drawdown-mustfix`、
`j2-t3-v03-maxinsscan-notoken-outbind-probe`、
`j2-t3-v03-payoutshard-absorb-ab11-and-batest`、`j2-t3-v03-payoutshard-claim-family-tokenization`、
`j2-t3-v03-payoutshardv2-{absorb-batest-ab11,refundclaim-tokenization,zkhandoff-tokenization}`、
`j2-t3-v03-{rootclaim,refundclaim,closezkv2}-tokenization`、
`j2-t3-v03-rootclose-zero32-guard`、`j2-t3-v03-rootclose-tokenization`、
`j2-t3-v03-{shardleaf,shardleafdirect}-tokenization`、`j2-t3-v03-shardleaf-payoutshard-handoff-fix`、
`j2-t3-v03-payoutshard-absorb-sole-source-fix`、`j2-t3-v03-payoutshardv2-absorb-sole-source-fix`

全部 `docs/provenance/` 下均含 `README.md`+源码副本+向量 JSON+`run.log`+`MANIFEST.sha256`（n/n 文件计数）。
累计向量数（§2 表逐行相加，不同 provenance 各自独立计数，非去重后的唯一断言数）≈ **205 条**，全部 PASS
（`j2-t1-v06-implementation` 的 15 条里 1 条是"设计内预期 fail"的翻转臂，不是缺陷）。

## 5. 开放项（如实记录，未闭环）

1. **V-T-8 上游未解**：`readInputStateWithTemplate` + 本合约 `validateOutputState`(self-continuation) 同函数
   共存运行期必崩，是 silverc **架构级**限制（`114272cc`/`99084e35` 记档），当前处置 = AB11 手写编码绕开
   （`ShardLeaf`/`ShardLeaf_direct`/`PayoutShard`/`PayoutShardV2`/`RootClaim`/`CloseZkV2` 六文件命中）。**没有
   修 silverc 本身**——这条限制会持续影响未来任何"需要同时读外部代币状态 + 续自己 State"的新入口，AB11 只是
   逐次绕过，不是根治。V-T-6 根因复核（`2026-09-13-nwt-redteam-j2-v-t-6-root-cause-v0.3-review-v0.1.md`）也
   记录"确切的 `binding=cov` codegen 那一行本身未诊断（超出 2h 预算）"，同一未闭环。

2. **RootClose 体积**：代币化后编译产物 `16802` 字节，远超文件头注释"~825B seal 目标预算"。Bettor（1191）
   已核实主网 post-Toccata（DAA≈539.1M）`sigScript` 上限 250,000B，**尺寸本身合法**。**mass 估算已更正
   （Bettor 1196）**：真实公式 `compute=size×1`、`transient=size×TRANSIENT_BYTE_TO_MASS_FACTOR(=4)`，**没有**
   额外的 double-blake2b 按字节计费项——v0.1 初版曾套用 `ShardLeaf_direct` 文件头 2026-06-20 probe-B 的
   "~9u/byte"经验比率估算约 167,150 mass 单位，这个套用**已确认是错的**并撤回；按真实公式对 `rc_prefix+
   rc_suffix=16715` 字节重算，`compute≈16,715`、`transient≈66,860`（均远小于误估的 167,150）。`compute`
   部分精确细节仍交 NWT 复核，但量级判断不应再引用已撤回的旧估算。

3. **hand-off 原子性（ShardLeaf.consolidate_to_payout ↔ PayoutShard.absorb）—— 已闭环（NWT 1196 MUST-FIX，
   Bettor 1197 批 (b)，见 `docs/provenance/2026-09-14-j2-t3-v03-shardleaf-payoutshard-handoff-fix/`）**：
   v0.5 初版记录的"未展开的设计问题"——本次证实"独立两步"的假设是**错的**：`KanetTestToken.transferPolicy`
   的 `(b-in)` 路由检查逼出 `consolidate_to_payout` 与 `absorb` 结构上**必须同笔原子**（新输出 owner=X 要求
   covenant=X 的输入同笔在场，PS 的 covenant 在场就必然要求 `absorb` 同笔跑）。NWT 红队独立发现：`ShardLeaf`
   原实现在 `consolidate_to_payout` 里自建了一个 owner=ps_cov 的中间态代币输出，被 `absorb` 的
   `scanOwnedTokenInputs` 全扫描重复计入，导致 `shard_amount>0` 时代币永久冻结（非被盗）。修法：
   `consolidate_to_payout` 去掉自建的代币输出，收窄为纯输入侧核对（`scanOwnedTokenInputs()==pool_value`），
   relabel 完整交给 `absorb` 已有（未改动、已 GREEN）的 `tok_out` 一步做完。`PayoutShard.sil`/
   `PayoutShardV2.sil` 零改动。`ShardLeaf_direct.convert_to_rootclose` **不适用同一修法**（创建的是本笔
   新建的 RootClose genesis 输出，没有对手方 entry 同笔运行，必须自己造代币输出，同 `RootClose.convert_to_
   claim` 形状）。10 条跨合约向量 PASS（含 Codex ledger 1198 补的五条负向量），全部 flip-expect 复核。

   **后续（ledger 1208）**：Codex 复核这笔修复时判"P+S 双计数"这个具体缺陷 **CODE-CLOSED**、"同笔原子"
   方向 **SUPPORTED**，但独立发现了**另一条**缺口——`absorb` 只验 `shardInIdx` 单点的模板/金额，不证明它
   是本笔交易里**唯一**的"同模板、非本 PS 持有"代币输入，两个合法 `ShardLeaf` 同笔各自
   `consolidate_to_payout`、`absorb` 只点名一个会导致另一个被**静默销毁**。已修（`e0ae924a`/`adc37c0a`，
   两文件各一 commit，新增 `countStrayNonOwnedTokenInputs` 排除法计数 + `shardTk.owner!=self` 双重核对），
   见 `docs/provenance/2026-09-14-j2-t3-v03-{payoutshard,payoutshardv2}-absorb-sole-source-fix/`，各 6/6
   向量 PASS，全部 flip-expect 复核，**待 NWT 独立复现**（尚未见到复核记录）。

4. **RootClaim/RefundClaim ctor 变更对 T4 创世对照的影响**：T4 创世骨架设计（`docs/2026-09-13-j2-t4-market-
   genesis-console-side-skeleton-v0.1.md` §2.1.1）列出"7 个模板 hash 留 ctor、不进状态字段表"的清单
   （`ps_tmpl_hash×3`/`rootclose_tmpl_hash`/`closeZkTmplAnchor`/`claim_tmpl_hash`/`refundclaim_tmpl_hash`/
   `gateTmplHash`）——这份清单写于 **T3 v0.3 代币化之前**。本次代币化给 `RootClaim`（10→13）、`RefundClaim`
   （9→12）、`RootClose`/`ShardLeaf`/`ShardLeaf_direct`（各 +1）、`PayoutShard`/`PayoutShardV2` 新增了
   `token_tmpl_hash`（全部新增文件）+ `claim_tmpl_hash`（KanetTokenClaim 的，`RootClaim`/`RefundClaim`/
   `PayoutShard`/`PayoutShardV2` 命中，注意**不是** T4 清单里已有的同名 `RootClose.claim_tmpl_hash`——两者
   字面同名但指向不同模板，T4 §2.1 表自己也注记过这条"不是同一物"）+ `market_suffix_hash`（同批四文件）
   这些**全新的 ctor-only 常量**。**T4 §2.1.1 的"7 个"清单需要更新为覆盖这些新增常量**（步骤 (c) 全字节
   重编译比对天然覆盖，但步骤 (d) P2SH 核对与"7 个"这个具名数字如果被后续实现直接抄，会漏掉新增字段）——
   本次未修改 T4 设计文档，留给 T4 落码时核对。

5. **本分支落后 canonical**：`scripts/lint-kanet.mjs` 持续报告本地 `HEAD` 落后 `origin/bshard-m3-deploy`
   146+ commits（且随本次提交还在增长）。撰写本稿时发现一个具体缺口：`docs/2026-09-14-nwt-redteam-j2-routing-
   change-v0.2-review-v0.1.md`（`KanetTestToken.sil` 文件头注释直接引用这份文档）存在于 canonical
   `bshard-m3-deploy`（`4b39c801`），但不在本分支祖先链里。这份文档的 precondition (c) 原话"`max_ins_scan`
   必须钉在≥协议实际最大输入数"，字面上似乎与本次全部落码用的 `MAX_INS_SCAN=8`（`RootClose`/`ShardLeaf`/
   `ShardLeaf_direct`/`PayoutShard`/`PayoutShardV2` 五文件）冲突——v0.5 初版把这条记为待 NWT 确认的开放项。

   **裁定（Bettor ledger 1195，已闭环这条文档层面的疑问）**：权威是 **1122 + 1122-补**——Bettor 明确允许
   "先 `require(len(tx.inputs)<=界)` 拒超界交易，再界内遍历"这个结构，NWT 认可的判据是**"victim 无处可藏"
   这条安全性质**，不是具体数字；`a036641c`（NWT 红队复核 T3 v0.3+T1 v0.6+drawdown MUST-FIX）已对 v0.3 §3
   这条论证给出 GREEN。`4b39c801` precondition (c) 的**字面**表述（"必须≥1000"）被这条更晚的裁定取代——
   **`MAX_INS_SCAN=8` 在安全性质上成立**，不需要机械改成 1000。文档层面的不一致到此解决，不再是开放项。

   **但裁定同时加了一条新的活性核对要求（尚未完成，见下方新增开放项 6）**：安全性质成立不等于"8 这个界不会
   拒绝合法交易"——`界=8` 意味着任何真实产生 >8 输入的合法场景都会被结构性拒绝（这是可用性问题，不是安全
   漏洞，但如果真实场景确实需要更多输入，界需要按场景调高）。这条核对本稿写作时尚未做，见 §5 第 6 项。

6. **`MAX_INS_SCAN=8` 的活性核对（Bettor 1195 新增，本次已做，结果如下）**：对照 `kasia-console/src/lib/`
   真实构造这些交易的代码（`pool-register-builder.mjs`/`pool-shard-register.mjs`/`pool-shard-settle.mjs`/
   `bshard-close-transport.mjs`/`pool-close-builder.mjs`/`pool-claim-builder.mjs` 等），逐入口核实：

   | 入口 | 真实交易输入数（旧 KAS-value 形态，代码可查） | 备注 |
   |---|---|---|
   | `ShardLeaf/ShardLeaf_direct.register_append` | 2（leaf + relay 单笔资金输入） | `pool-register-builder.mjs:57-87`，`bettorFunding` 虽类型标 `[...]` 数组，唯一真实调用点 `pool-shard-register.mjs:396-399` 恒传 1 个元素 |
   | `ShardLeaf.consolidate_to_payout` + `PayoutShard.absorb`（已确认同笔） | 3（payoutshard + shardleaf + fee） | `pool-shard-settle.mjs:446-484` `consolidateAllShards`——**逐分片各起一笔交易，不批量合并**，印证"一 shard 一 tx"不是"多 shard 一 tx" |
   | `PayoutShard/V2.close_attest` | 2（payoutshard + fee） | `bshard-close-transport.mjs:407-410`；B 类本就无代币输入 |
   | `PayoutShardV2.zk_handoff` | 2（payoutshard + fee） | `bshard-close-transport.mjs:531-540` |
   | `RootClose.close_commit` | 2（root + fee） | `pool-close-builder.mjs:64-67` |
   | `PayoutShard.claim`（旧 `PoolRoot`-era 构造器，供参考） | 3（root + ticket + fee） | `pool-claim-builder.mjs:96-100`，疑似已被 `RootClaim` 拆分取代，未确认仍在用 |
   | `RootClose.refund_flip`/`convert_to_claim`/`convert_to_refundclaim`、`PayoutShard/V2.cancel_attest`/
     `refund_claim`、`ShardLeaf_direct.convert_to_rootclose` | **无真实调用方** | 这些入口作为 relay 命令类型字符串在 `kasia-console/src/lib/*.mjs` 里零命中——T3 本次落码的代币化参数（`tokenInIdx`/`tokenOutIdx`/`stakeInIdx`/`tok_prefix`/`tok_suffix`）**尚未被任何交易构造器接入**，是纯 `.sil` 层实现，还没有对应的 console 侧调用代码 |

   **结论**：所有已确认有真实调用方的入口，最大输入数在 **2-3** 之间（含 fee 输入），远低于 8；代币化新增
   的字段各占**一个具名槽位**（不是数组），不会把这些数字推高到接近 8。**没有发现任何"多分片批量合并"/
   "多代币输入累加"/"ZK close 多 nullifier 输入"的真实批量场景**——所有"多 shard"/"多 bettor" 语义都是
   **串行、逐笔独立交易**处理的，不是攒进一笔宽交易。`MAX_INS_SCAN=8` **对已确认场景成立、且留有充分余量**
   （8 vs 实际 2-3，约 2.5x-4x 冗余）。**如实记录局限**：这个结论建立在"旧 KAS-value 形态的构造器代码"
   之上——T3 代币化的新签名还没有真实调用方，无法验证 console 侧接入这些新参数后是否会引入新的、更宽的
   输入需求（例如把 `stakeInIdx`/`tokenInIdx` 的资金来源从"relay 单笔资金"改成"用户钱包自由 UTXO 选择"，
   那样 `bettorFunding` 类型标注的 `[...]` 数组就可能不再恒为 1 个元素）——这条留给 console 侧真正接入
   代币化字段时重新核实，不是本次能提前证明的。

## 6. 联合合入准备

**范围**：T1 v0.7（`KanetTestToken.sil`，`32e480d9` 起，含 `95e7c909`/`a8f8b913`/`22bf679a` 的 `KanetTokenClaim`
T2 一并算作 T1/T2 分支的一部分，虽非"8 文件"封闭集本身）+ 8 文件封闭集（`RootClose`/`ShardLeaf`/
`ShardLeaf_direct`/`PayoutShard`/`PayoutShardV2`/`RootClaim`/`RefundClaim`/`CloseZkV2`）+ 全部相关
`docs/`（v0.1-v0.4 设计稿 + v0.5 本稿）+ 全部 `docs/provenance/2026-09-13/14-*` 目录。**语法迁移 commit
（`b5a2924c`/`b4f91725`/`a2414013`/`6eaec993`/`79fcfe1a`）与代币化 commit 都在同一条侧分支
`coord/j2-t3-market-sil` 上，按提交顺序天然是"迁移先、逻辑后"，无需重排。

**与主线可能冲突的文件（范围提示，merge-tree 预演本身由 Bettor 做）**：
- 8 个 `.sil` 文件本身——如果 canonical 分支上有其它并行工作也在改这些文件（例如 `4b39c801` 所在的路由变更
  批次可能也touch了部分 market 合约），需要按内容合并而非机械三方合并，因为本次改动量大（每文件多处新增
  ctor 字段+新函数+入口签名扩展）。
- `docs/2026-09-14-j2-t3-market-set-token-rewrite-design-v0.4.md`/`v0.3.md`——如果 canonical 上有更新版本
  （如 v0.5/v0.6 已经在别处产生），需要先核对本稿引用的版本号是否仍是最新设计权威。
- `docs/DECISIONS.md`——D-018（`46818d08`）本次引用多次，但**本分支本地这份文件不含 D-018 词条**（已用
  `git log --all` 确认该 commit 存在于历史中，只是不在本分支祖先链——需要 merge 时自然带入，不是本分支
  自己漏写）。

**Owner 批准状态**：市场创世/合约实现属于"钱路"类改动，按铁律 0/D-017 §3，真正部署（非隔离开发）需要 Owner
终端单点批准；本稿只汇总"已落码+已本地验证"的工程状态，不代表已获准上线。

## 7. 文件清单

本稿本身即交付物，无附属文件。引用的全部 31 笔 commit 与 22 个 provenance 目录见 §1/§4，均已推送至
`coord/j2-t3-market-sil`（截至 `de7582ca`，含批次④）。
