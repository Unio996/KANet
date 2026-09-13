# NWT 红队复核 · T4 v0.2（三处显式写 + 三问裁定落地）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`docs/2026-09-13-j2-t4-market-genesis-console-side-skeleton-v0.1.md` 提交 `7bbd5f33`（v0.2，对照 v0.1 `0f2fc739`）。

## 结论：**PASS**，三处显式写要求与三问裁定全部准确落地，一处引用细节写混了(不影响结论)

## 一、三处显式写——逐条核对，落地准确

**①§2.1.1 ctor 常量覆盖路径**：写法与我上一轮的原话一致——ctor 值(7 个留 ctor 的模板 hash)不在 `state_span` 里，`probeStructuralSignature` 的位点比对够不着，覆盖靠步骤(c)全字节重编译比对（天然覆盖，不是专门检查）与步骤(d) P2SH 核对（对 (c) 的独立交叉验证，堵的是"DB 记录被污染"与"tx 构造时又偏差"两个不同失败模式，这条区分是准确的，两步不是重复）。**PASS**。

**②(c) 硬前提已满足**：我直接 `git cat-file -e HEAD` 核实了 `submit-intent.mjs`/`escrow-landed-gate.mjs`/`tx-landed-reconciler.mjs` 三个文件——**现在确实都在主线 HEAD 上**（随 `91b2ac6c` 合入），不是空口说"应该已经合了"。§3 头部的更新准确反映了这一点。**PASS**。

**③§5.2 non-blocking 理由改写**：新理由(免费代币模型下漂移后果=自毁非被盗，受害者是市场自己不是第三方，时间线本身安全)跟我在 GO-B 审 `MINING_CONSOLIDATE_ENABLED` 那一轮用的判断依据(是否存在"资金正在被转移、每晚一秒损失扩大"的紧迫性)是同一条判据线——用在这里成立：市场创世漂移的后果确实不产生这种紧迫性。"复用既有调用点"降级为实现手段、跟"为什么可以不阻塞"分开写，这个区分是对的，不是文字游戏。**PASS**。

## 二、三问裁定——逐条核对，与我上一轮的批准逐字对应

- **Q1**（`cmdType`/`cmdBuilder` 泛化）：批准走独立小 diff、NWT 单独审，不跟 T4 docs 混——与我要求的一致。
- **Q2**（7 解码器）：批准折中方案，**且明确 `poolMerkleRoot`/`committee_hash` 进第一批**——这条我上一轮点名"不能只靠低频 full-tier 巡检兜底,必须进 cheap tier 第一批",这版 §2.1 已经按这个要求补了优先级排序理由。**PASS**。
- **Q3**（落表位置）：批准延后，不影响当前裁决。

## 三、一处引用细节写混了(不影响结论，供下次订正)

§2.1.1 最后一句把 `closeZkTmplAnchor` 与 `gateTmplHash` 并成"这类"一起引用 `PayoutShardV2.sil:378`、说是"4 段拼接的锚"——**我去核对了两个字段各自的真实代码,这句话只对其中一个成立**：

- `closeZkTmplAnchor`：确实在 `PayoutShardV2.sil:378`，确实是 `blake2b(templateA+templateB+templateC+templateD)` 四段拼接——**这部分描述准确**。
- `gateTmplHash`：**在另一个文件** `CloseZkV2.sil:48`，是 `blake2b(gatePrefix+gateSuffix)`**两段**拼接——不是"这类"里描述的四段，也不在 `PayoutShardV2.sil` 里。

**这个引用混淆不影响 §2.1.1 的核心结论**(两个字段都是 ctor 烤值、都只能靠整块字节重编译比对验证，这个判断对两者都成立)，只是"具体是几段拼接、在哪个文件"这个细节把两个不同字段的具体形态串到一起了。**建议下次订正引用，不阻塞本轮 PASS**。

## 四、给 Bettor 的处置建议

- **T4 v0.2 PASS**，可以按这份定稿继续走后续（Q1 的独立小 diff、cheap tier 第一批解码器落码等）。
- 一条非阻塞订正：§2.1.1 末句 `gateTmplHash` 的引用细节(段数/出处文件)与 `closeZkTmplAnchor` 混了，下次改稿时分开写清楚即可，不影响这轮结论。
