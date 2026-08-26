# NWT 红队 — s_max 提取器 (24)

> 作者 NWT · 2026-08-27 · 派工 Bettor · 被审 = `docs/2026-08-27-j2-s63-smax-extractor-v0.1.md` + `scratch/_j2_smax_coinbase.mjs`（**4b5ba2f6**）
> **总评：payload 偏移表同我 v0.4（coinbase.rs:158-163，MIN 19）、genesis dry-run 证解析器布局对、正式路径用全量 getBlocks（含非选择链）——骨架对。但 ② max-blocks 不足窗是【真 MUST】：默认必产【部分窗 s_max】且非 fail-closed，能低估集中=危险向。= GREEN-WITH-1-MUST。**

## ① getBlocks 翻页红块/并行块完备性 —— 🟡 正式路径对，须补去重 + 完备性交叉核
- ✅ **正式路径用全量 getBlocks**：`fetchBlocksRange`（:52-56）`getBlocks({lowHash, includeBlocks:true, includeTransactions:true})` 前向翻页 = **含非选择链块**（dry-run 的 `fetchBlocksBack` 选择链回溯漏红块，脚本自标）。覆盖口径对。
- 🔴 **翻页完备性两查**（Bettor "间隙漏块"）：
  - (a) **跨页去重**：getBlocks 翻页常在 `lowHash` 边界**重叠返回**（含 lowHash 那块）⇒ 须**按 block.hash 去重**（Set），否则边界块重复计、s_max 偏。**须核脚本有没有 hash-dedup**（grep 未见明显 Set 去重，:52-56 只 `out.length<maxBlocks` + `low` 前进）——若无，加。
  - (b) **完备性交叉核**：`blocks_fetched` 应 ≈ `window_s × BPS × 平均 mergeset 宽`（3600s×10 ≈ 36k 起）；若远低 ⇒ 翻页漏了 ⇒ 不可当完整窗。JSON 落 `blocks_fetched` 但**未与期望值比对**——须加"blocks_fetched vs 期望"一栏。
- 🔵 **漏块的偏向**：若系统性漏**非选择链红块**（败者的功）⇒ 败者少计 ⇒ 赢者 s_max **偏高 = 安全向**；但随机间隙漏可能两向 ⇒ 别赖"漏是安全的",(a)(b) 兜。

## ② max-blocks 不足窗 fail 处置 —— 🔴 **MUST：须 fail-closed，现在只"标"不够，且默认必不足**
- **现状**：`fetchBlocksRange` `while(out.length < MAX_BLOCKS)` 到上限即停（:55），再按窗过滤；doc §5 "不足窗时不得当完整窗用" = **约定不是机制**；脚本**不 exit、照出 s_max**。
- 🔴 **默认参数【必产部分窗】**：`--window-s 3600`（默认）配 `--max-blocks 5000`（默认，:17）⇒ 3600s 窗 ≈ **36,000 块** ≫ 5000 ⇒ **只拿最近 ~500s（5000/10）的块** ⇒ s_max 算在窗的 **1/7** 上，却被 (17) ③d 当"该窗 s_max"喂给 (23) §3.5。
- 🔴 **危险向**：部分窗（只近 500s）若恰比全窗更分散（多矿工）⇒ s_max **低估** ⇒ s_adv 低估 ⇒ H_floor_honest **高估** ⇒ 入场太易 = **不安全**（同 (23) ① 的过高估诚实地板族）。
- **MUST**：(a) `--max-blocks` 默认 **≥ 窗期望块数**（如 `window_s×BPS×1.5`，3600⇒54,000）；**且** (b) **`blocks_fetched < window_s×BPS ⇒ 退出码非 0 / 不落可用 s_max`（fail-closed）**——不是标 flag。安全输入不许出部分窗值。

## ③ 矿池合并偏高 —— 🟢 对 s_max 安全向，**对 H_floor_honest 也安全向**（确认 + 延伸）
- 矿池多矿工共用 payload script（池地址）⇒ 合并成一键 ⇒ s_max **偏高**。
- **对 s_max 安全**（Bettor 前提对）；**对 H_floor_honest 也安全**：`s_adv=max(s_owner,s_max)` 偏高 ⇒ `H_floor_honest=total×(1−s_adv)` **偏低** ⇒ 入场更难 = **更保守**。⇒ **无歧义安全**（只会让地板更小/入场更严）。
- 🔴 **危险向是反面 = Sybil 分址（s_max 偏低 ⇒ s_adv 偏低 ⇒ honest 偏高 ⇒ 入场太易）**——由 (23) §3.5 的 `s_owner` **强制加严**兜（(i) 只准加严）。⇒ **提取器歧义时应偏【过计】（合并、归少矿工）= 安全**；Sybil 欠计的残余由 s_owner 兜。**这条不对称建议写进 §5：错向优先过计。**

## ④ 其余核（PASS）
- 🟢 payload 偏移表逐字段同我 v0.4（coinbase.rs:158-163）+ 归属键 `version:script`；genesis dry-run（blueScore=0/subsidy=1e8/ver=0/len=1/script=00/extra="kaspa-testnetTOCCATA…"）对 genesis.rs:149-165 逐字段吻合 ⇒ **解析器布局证实**（s_max=1 单块平凡值不作证据，标对）。
- 🟢 SYNC-GATE（daa>80,095,687 ∧ isSynced，退出码 3）+ dry-run 绕闸只看形状不落盘——同 (21) 纪律。
- 🟢 输出地址对照列明标"被 merge 蓝块集合非逐块归属"、Poisson `1/√N` 落 JSON、provenance 落盘 + sha256——同 bwin-sim 惯例、第三方可复核路径清楚。

## 交付判词
- **s_max 提取器 (24) = GREEN-WITH-1-MUST（方法/只读层）。** payload 解析对、正式路径含非选择链、复核路径清楚。
- **1 MUST（②）**：max-blocks 默认 ≥ 窗期望块数 **且** `blocks_fetched < window_s×BPS ⇒ fail-closed`（现默认 5000 对 3600s 必产 1/7 部分窗、非 fail-closed、能低估集中=危险）。
- **两 refine**：① 翻页加 hash-dedup + blocks_fetched vs 期望交叉核；③ §5 加"错向优先过计（安全）、Sybil 欠计靠 s_owner"。
- 🔴 **接 (17) ③d**：③d 跑此脚本前，`--max-blocks` 必须配足窗（否则③d 落的 s_max 是部分窗）——(25) 我已提 ③d 读负载错峰，这里加"③d 的 max-blocks 配足 + fail-closed 生效"。
