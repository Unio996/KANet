# KCC1 测试语料 — 骨架/来源清单(初稿前置调查)

> **Status**: CURRENT
> **作者**: J1tn 2026-07-16 · Owner 7/16 指令三件之一(`docs/2026-07-16-owner-directive-kcc-participation.md` 近期三件②)
> **本文档定位**: 不是最终语料本身，是"每个必备类别对应哪些 KANet 真实覆盖产物"的骨架清单——防止凭空编造测试向量，先把类别锚到真实代码/文件，明天在此基础上抽取具体字节级向量出初稿。

---

## §0 Owner 要求的类别(逐字摘自指令原文)

单/多入口、有/无 selector、空 prefix、PoolSpine/Shard/PayoutShard/CloseZk 状态布局、covenant ID 所有权、模板升级、负例(错误 offset/时间单位/配对常量)。

## §1 真实来源盘点(读文件系统坐实，非猜测)

`kasia-console/src/lib/*.sil` 现有 34 个 SilverScript 模板文件，覆盖度按类别分类如下：

### §1.1 PoolSpine/Shard/PayoutShard/CloseZk 状态布局(Owner 类别④)

| covenant 角色 | 文件 | 行数 | 备注 |
|---|---|---|---|
| PoolSpine(现行) | `PoolSpine.sil` | 224 | 主干，配 `computeSpineArtifact()`(pool-bshard-artifacts.mjs:90) |
| PoolSpine(历史版本) | `PoolSpine_v06.sil`/`_v07.sil`/`_v0_7_1.sil` | — | 模板升级链(见§1.6) |
| PoolSpine(v08 分支) | `PoolSpine_v08_agg.sil`/`_v08_chunk.sil`/`_v08_shard.sil` | — | 三个 v08 变体并存，需先查清哪个是当前 live(待查) |
| PoolSide/Shard(现行) | `PoolSide.sil` | 135 | 配 `computePoolSideArtifact()`(同文件:111) |
| PoolSide(历史版本) | `PoolSide_v06.sil`/`_v07.sil`/`_v08_shard.sil`/`_v0_7_1.sil` | — | 同源模板升级链 |
| ShardLeaf | `ShardLeaf.sil`/`ShardLeaf_direct.sil` | — | `_direct` 变体含 selector(见§1.2) |
| PoolLeaf | `PoolLeaf.sil`/`PoolLeaf_nofold_probe.sil` | — | `_nofold_probe` 疑为红队/探针变体，非生产路径，需确认后再决定收不收进语料 |
| PayoutShard(现行) | `PayoutShard.sil` | 391 | |
| PayoutShard(升级版) | `PayoutShardV2.sil` | 401 | V1→V2 是天然的"模板升级"类别素材(§1.6) |
| CloseZk | `CloseZkV2.sil` | 209 | 命名已是 V2，V1 是否仍有历史 genesis 在链上需查(D-009 gateTmplHash 教训相关) |
| PoolRoot / RootClaim / RootClose | `PoolRoot.sil`/`RootClaim.sil`/`RootClose.sil` | — | 根节点角色，Owner 类别未显式点名但属同一状态机族，建议一并纳入 |
| FoldNode | `FoldNode.sil`/`FoldNode_sealonly.sil` | — | `_sealonly` 含 selector |
| RefundClaim | `RefundClaim.sil` | — | |

### §1.2 有/无 selector(Owner 类别②)

实测 `grep -l selector *.sil` 命中 5 个文件——**有 selector**：`FoldNode_sealonly.sil` / `PoolSpine_v08_agg.sil` / `PoolSpine_v08_chunk.sil` / `ProbeC_selfonly.sil` / `ShardLeaf_direct.sil`。
**无 selector 对照组**：现行主干 `PoolSpine.sil`/`PoolSide.sil`/`PayoutShard.sil`/`CloseZkV2.sil` 均未命中——天然形成"有/无 selector"的正例对照，不需要另造。

### §1.3 单/多入口(Owner 类别①)

待查——需要读各 `.sil` 文件本体数入口点(function/branch 数)分类，今天只做到"文件清单"层，明天读码判定各文件入口数。

### §1.4 空 prefix(Owner 类别③)

待查——需要结合 `pool-bshard-artifacts.mjs` 的 `computeSpineArtifact`/`computePoolSideArtifact` 实际调用点，找一个 prefix 为空字节串的真实/可构造案例（COORD-LEDGER 记录里"9999=free-tier 非硬墙"那条与 prefix/compute_budget 有关，需要交叉核对是否同一件事，不能想当然合并）。

### §1.5 covenant ID 所有权(Owner 类别⑤)

对应 `IDENTIFIER_COVENANT_ID=0x02`（KCC20 两窄意见①里已经分析过的同一个字段，见 `docs/2026-07-16-kcc20-two-narrow-comments-en-paste-ready.md`）——**这块语料可以直接复用 KCC20 意见稿里已经做过的 outpoint/所有权分析，不用重新调研**，明天重点是把那份分析转成 KCC1 要求格式的具体字节向量。

### §1.6 模板升级(Owner 类别⑥)

现成的真实升级链，不需要构造：
- PoolSpine: v06 → v07 → v0_7_1 → (v08_agg/v08_chunk/v08_shard 三分支)
- PoolSide: 同款版本链
- PayoutShard → PayoutShardV2
- CloseZk(V1 历史?) → CloseZkV2

每一步升级点对应的 gateTmplHash/imageId 配对问题就是 D-009 事故本身（`docs/2026-07-08-gate-tmplhash-live-derive-design.md`）——**这是最强的语料，因为是真实事故不是构造案例**，明天优先把这条整理成 KCC1 格式的"模板升级 round-trip 验证失败"负例。

### §1.7 负例：错误 offset/时间单位/配对常量(Owner 类别⑦)

三个真实历史事故可直接转化，不用编造：
1. **配对常量错位** = D-009 本身(imageId 换了 gateTmplHash 没跟着换，见§1.6)。
2. **时间单位错位** = 我自己的踩坑库记录"`tx.time`=lockTime literal=ms(unix-ts 闸必 *1000)"(CLAUDE.md SilverScript 踩坑库条目)，需要找到当时具体的错误 commit/diff 作为负例素材，明天去 `git log --grep` 定位。
3. **错误 offset** = 待查，需要问 J2/查 COORD-LEDGER 找一次具体的 offset 错误事故做素材（silverc pick_from_depth OP_PICK off-by-one 那次算不算这类？倾向算，因为效果同源，但那是编译器 bug 不是模板层 offset 硬编码错——两者要分清楚，不能混为一谈，明天核实后再定）。

## §2 明天的具体产出计划

1. 读完 §1.3/§1.4 待查项(各 .sil 文件入口数量 + 空 prefix 真实案例)。
2. 把 §1.6/§1.7 的三个真实历史事故转成 KCC1 期望的具体格式(输入字节 + 期望 reader 行为 + 期望 round-trip 结果)。
3. 出 KCC1 测试语料初稿（含上述所有类别至少一个真实、可复现的具体向量，不用编造数据）。
4. J2 协作部分：`v06/v07 定义为不同 settlement_profile`(Batch1 九步路线第3步)与本语料有交集，需要跟 J2 对一下他那边掌握的 v06/v07 差异细节，避免重复调查。

## §3 范围边界

本文档只做"骨架/来源盘点"，不含任何编造的字节向量。所有后续填充必须逐条标注来源(真实 commit hash / 真实文件路径 / 真实事故记录)，不接受"示例性质"的构造数据冒充真实语料。
