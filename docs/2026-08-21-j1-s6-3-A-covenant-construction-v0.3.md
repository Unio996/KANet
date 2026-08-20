# §6-3 A：fair-exchange 结算 covenant 完整构造（v0.3 · 报备层 · 零生产码）

> **Status**: CURRENT（v0.3 取代 v0.2，补 NWT 逮到的两-lineage 原子焊接缝）
> **作者** J1 · **日期** 2026-08-21 · **派工** Bettor 16:22（出构造）+ 17:13（v0.2 修三条）+ 17:31（v0.3 补原子绑定）
> **上游** J2 O-spec v4（`docs/2026-08-20-j2-o-earmark-construction-spec.md`）+ Codex MSG-260 verdict（`coordination/codex-bridge/responses/RESPONSE-20260820-MSG260-S6-3-O-LINEAGE-CODEX-REVIEW.md`，GREEN DIRECTION 架构接受）。
> **适用** 🔴 **仅同链**（两腿都在 TN12）。跨链退 R1/light-client（O 构造完全不适用 + 仍需正 finalized-reveal 证，Codex MSG-260 附加条件）。

---

## §0.5 v0.2 变更（Codex MSG-260 三条 MUST-FIX + A-absent 全清）

Codex 判**架构 GREEN**（script→cov_id provenance pivot / O-REPLACEMENT 无 (A,s) fallback / terminal 支必终止 lineage 三项 ACCEPTED），但 v0.1 构造**未 design-closed**，三条 MUST-FIX 全在我文档，逐条修：

- 🔴 **MUST-FIX 1（我的真 bug，认）**：v0.1 行 36/98 把 reveal 侧本金 refund 写成 `require(A-absent)` = **回退到 v0.7 已否决错**（covenant 能正验一个提交的 A，**证不了链下 A 全局不存在**）。NWT 逐字核实两处。⇒ 改 **P-SAFE-1 单-live-lineage state machine**（§4-d 新写法），**A-absent 谓词全清**。这是我这 session 反复的错类（验机制在、漏它实际强制不了）+ 回退已否决设计，判据入册 [[feedback_read-the-thing-not-a-copy]]。
- 🔴 **MUST-FIX 2**：`OpCovOutputCount(cid) >= 1` 允许**多个**续链 output → 违反唯一 capability。⇒ reveal 支改 **`== 1`**（恰一续继），每条 terminal/refund/cancel 支 **续链 output == 0** + 变异负测。教训：照搬 `ShardLeaf.sil:101` 的 `>=1` 是"活先例挡住的是它当初那个洞（允许多续继合理），不是我这个洞（要求唯一）"——先例 guard 带着为**别的需求**校准的强度（J2 判据，采纳）。
- 🔴 **MUST-FIX 3**：`T_O` 从绝对 DAA deadline 改**相对 O 创建**：`current_daa >= OpTxInputDaaScore(O) + N_claim + N_margin`。用 O 自己 input 的本地 DAA 事实，不重新引入无锚绝对窗（O-lineage 采纳的初衷就是不靠外部/模糊 finality 钟）。

---

## §0.6 v0.3 变更（NWT 逮到的两-lineage 原子焊接缝 = MUST-FIX）

NWT 红队"P-SAFE-1 lineage ↔ O cov_id-lineage 交互"逮到 v0.2 承重缝，J2/我独立收敛同一修法：

- 🔴 **缝**：`LOCKED`（P-SAFE-1 lineage）与 `C`（cov_id lineage）是**两个独立 covenant UTXO**。§4-b（消费 C 造 O）与 §4-d 的 `LOCKED-transfer` 支**各自独立** require `checkSigFromStack(A)∧blake2b(s)==h`，**两处 witness 字面相同，但 v0.2 没有一句把它们钉到同一笔 tx**。
- 🔴 **精确逻辑断链**：安全依赖 **s 被揭 ⟺ O 被造**。v0.2 有「消费 C ⟹ 造 O」（§4-b）+「领 principal ⟹ 揭 s」（§4-d transfer），但**缺「揭 s ⟹ 消费 C」**——故 s 可在【不消费 C ⇒ 不造 O】的 tx 里被揭。叠加 O-REPLACEMENT 去掉 (A,s) fallback ⇒ 首动方**只广播 LOCKED-transfer 那一笔**（拿本金 + s 公开）、**不广播造 O 那笔** ⇒ 反应方无 O 可花、无 fallback ⇒ **本该被 enforce-O-creation 堵住的 griefing/盗窃重现**。
- ✅ **修法（J2/我同款，源码域我裁可建）**：`LOCKED-transfer` 支加 `require(OpInputCovenantId(C_idx) == cid)`——强制**同一笔 tx 必须也消费 C**，C 被消费即触发其 §4-b 支强制造 O。⇒ 揭 s ⟹ 消费 C ⟹ 造 O 三段原子焊死（§4-d 新写法 + §2.5 拓扑）。
- 🔴 **附带 cutoff 排序不变量（我补，v0.2/J2 提议均未含）**：须 `T_cutoff_LOCKED <= C_terminal_refund_cutoff`。否则 LOCKED-transfer 活窗内，同笔消费 C 可走 C 的 terminal-refund 支（不造 O）绕过焊接。
- 🔨 J2 判据（采纳）：**「生产 X 是领钱的前提」= 必须【同一笔 tx】；拆成两笔，它退化成两个各自独立可分别选择的动作，攻击者只选对自己有利那一个**（= "安全性质只能来自唯一路径"，此处路径被【拆成两步】而分岔）。J2 判据（采纳）：**这条缝的缺失约束【不在任何一行代码里】**——故负测是**交易级变异**（改怎么提交，不改任何 require 行），与族 B 语句级变异不同层（§6.2b）。

---

## §0 本文交付什么（先写死，防被读成别的）

Bettor 16:22 定的 **REDTEAM-HOLD 解除三闸**——本文逐条给**源码级**答案 + 把冻结的三步 lineage 落成**显式 require 清单**，每一条都锚到【活生产合约的 file:line】，不靠"我记得可以"。

> 🔴 **可建性锚定纪律**：cov_id lineage 那几个原语（`OpInputCovenantId`/`OpOutputCovenantId`/`OpCovOutputCount`）的可建性，**证据是它们在 `ShardLeaf.sil:99-105` 已上链跑通且被 NWT 红队过**，不是读 codegen。**但 `checkSigFromStack`（A2 原语）腿必须在 canonical 树 `8065184` 上写 + 上链 e2e**——我这台 `/d/silverscript` 检出 `aedad5b` 无此原语（编译报错），别用它编本构造（见记忆 `j1tn-boot-0819` §0c 树分歧）。

---

## §1 它交付的安全性质

> **反应腿的 claim 在【结构上】不可能早于 reveal 被链收录；且 reveal 一旦被 reorg，反应腿 claim 同时失效。**

不是"等够深度"，是**共存亡**：`O` 由 reveal 交易创造，reactive claim 花掉它、且校验它血缘续自 reveal 侧唯一 capability `C`。
⇒ 专属 finality 预算参数 `F_reveal` **从安全承重位移除**（退化成"每笔交易等自己确认"的通用问题）。⇒ **同链无委员、无深度参数**。

---

## §2 冻结的三步 lineage（Bettor 16:20，O-REPLACEMENT 非 parallel-optional）

```
锁前  : 造唯一 capability C（cov_id 共识派生；把该 cov_id 烤进两腿）
reveal: checkSigFromStack(A) ∧ blake2b(s)==h
        ∧ [消费 C：OpInputCovenantId(C_in)==baked_C_cov_id]
        ∧ [造 O：OpOutputCovenantId(O_out)==baked_C_cov_id ∧ spk==baked_O ∧ value>=min_O]
react : checkSigFromStack(A) ∧ blake2b(s)==h
        ∧ [花一输入 O：OpInputCovenantId(O_in)==baked_C_cov_id]（无 (A,s) fallback）
refund: reveal 侧本金走 P-SAFE-1 单-live-lineage（cutoff 前只 validated-reveal 转移消费 LOCKED；cutoff 后 still-unspent LOCKED 转 terminal refund，无 A-absent 谓词）；O 侧 T_O 相对 O 创建退首动方（lineage-terminal，§4-d）
```

🔴 **必须 O-REPLACEMENT**：保留 `(A,s)` fallback ⇒ 反应方可凭 `(A,s)` 在**非最终** reveal 上 claim ⇒ C4-FINALITY 原洞照旧。安全性质只能来自**唯一路径**（J2 判据，采纳）。

## §2.5 显式 principal 拓扑（v0.3 补 —— v0.2 欠此=NWT 缝的根）

> v0.2 没显式钉死"哪个 principal 在哪个 covenant、哪支揭 s、哪支花 O"，这条欠拓扑正是原子焊接缝的根。钉死：

| 对象 | covenant | 谁的钱 | 唯一合法消费路径 |
|---|---|---|---|
| `LOCKED(session)` | P-SAFE-1 lineage | **首动方**本金 | 反应方**花 O** 领走（O-lineage）；或 cutoff 后首动方 terminal-refund |
| `C` | cov_id lineage capability | 无（dust 种子） | 首动方 reveal-claim 消费 C 造 O（§4-b）；或 cutoff 后 terminal-refund |
| `O` | C 的续继 | = LOCKED 的领取凭证 | 反应方花 O 领 LOCKED；或 T_O 后首动方回收 |
| 反应方本金 | （对称的另一个 LOCKED'） | **反应方**本金 | 首动方揭 s 领走 |

🔴 **焊接点**：首动方揭 s 领**反应方本金**（LOCKED'-transfer，§4-d）的**同一笔 tx** 必须消费 C 造 O（v0.3 焊接 require）。⇒ 首动方拿反应方的钱 ⟺ 造出 O ⟺ 反应方能凭 O 拿首动方的 LOCKED。**任一方拿钱都强制给对方留下拿钱的凭证，无单边。**

---

## §3 三闸的源码级答案

### 🟢 闸① cov_id 必须协议派生不可选 —— **闭**

**实读 `kasia-relay/src/lib/p2sh.mjs:1767`**：cov_id 由 **consensus 重算赋**
`cov_id = covenant_id(funding.outpoint, [psOut])` —— 是**创世 funding outpoint 的派生值（像合约地址由部署 outpoint 决定），不是创建者可填字段**（`:1758` 注 "consensus metadata; UtxoEntry.covenantId"；`_psInputCovId` 只读不写）。

⇒ 攻击者要撞一个 `=baked` 的 cov_id，须同时 (a) 找到 hash 到目标值的 funding outpoint = blake2b 系**原像攻击**；(b) 真控且花掉那个特定 outpoint。两者 = 不可行。**"假 cov_id≠baked→BUST" 成立。**
🔵 补强防呆（活先例）：`ShardLeaf.sil:101 require(OpCovOutputCount(ps_cov) >= 1)`（"NWT 钉"）令**零/非法 cov_id 直接 fail**（cid=0 非 covenant 数据→fail，堵 `0==0` 平凡通过——否则相等检查沦为自洽空话）。🔴 **但本构造 reveal 支收紧到 `== 1`（MUST-FIX 2）**：ShardLeaf 允许多续继故用 `>=1`，capability C 要求**唯一**故须 `==1`（`==1` 同时兼防呆+唯一性）。先例 guard 带的是为**别的需求**校准的强度，不可照搬（§0.5 MUST-FIX 2）。

### 🟢 闸② C 创建流双方可独立验唯一 —— **闭（配一条链下义务）**

因每个 candidate C 的 cov_id = f(其 funding outpoint) **各不同** ⇒ 单方私藏多个不同 cov_id 的 C **没有操控优势**：reactive 支只认 baked 那一个 cov_id，别的 candidate 造的 O 全 `OpInputCovenantId(O)==baked` 不过 → BUST。
**前提（= 链下构造方义务，须落 deploy 核验）**：双方在**两腿锁定之前**，各自独立核 `baked_cov_id` = 一个【真上链存在（genesis-mint，cov_id≠0）且具单出口性（闸③）】的 C。= `PayoutShard.sil:26` "漏一条绑定就静默不存在" 同族义务。

### 🔴 闸③ C 只有唯一出口产合法 lineage —— **承重那条：可建，但是【漏写即静默】的授权义务**

cov_id 续链靠 output 上的 `CovenantBinding`（continuation handler 拿 input cov_id 设 output binding，p2sh.mjs:1759）。**哪条 spend 支能产续链 output，由 C 的脚本逐支控**（bshard `PoolSpine_v08_chunk` 就是 per-branch `validateOutputState` 续 `OpInputCovenantId 本 covenant 身份`）。

⇒ **C 必须写成：只有 reveal-claim 支（`checkSigFromStack(A)∧blake2b(s)==h`）许产 cov_id 续链 output；C 的任何 refund/timeout 支【禁止产带 cov_id 的 output】（只许 terminal 明文出）。**

🔴 **=`PayoutShard.sil:26` 病**：这条**漏写就静默开侧门**——若 C 的 refund 支没被显式禁止续链，它照样能产一个"血缘合法但没真 reveal s"的 O ⇒ 伪造面从"外人凭空造"缩成"C 持方走 refund 支绕开 reveal 造 O"。**这正是 J2 自逮的 T_O 侧门的一般化**：不止 O 的 T_O 回收支要终止 lineage，**C 自己的每一条非 reveal 支也要**。

---

## §4 covenant require 清单（每条锚到活先例）

> 记号：`A` = 公开 attestation pubkey（两腿 baked）；`s` = adaptor secret，`h=blake2b(s)`（两腿 baked）；`cid` = baked_C_cov_id。

### (a) capability C（锁前 genesis-mint）
- genesis-mint 一个 covenant 实例，consensus 赋 `cid = covenant_id(funding.outpoint,[C_out])`（不可选，闸①）。
- **C 的 spend 脚本只有两支**：`reveal-claim`（下 b）与 `terminal-refund`（下 d 的 C 侧）。**无第三支、无任何其它支产续链 output**（闸③）。
- 活先例：`unlockBshardGenesisMintPayout`（p2sh.mjs:1767，genesis-mint cov_id≠0）。

### (b) reveal-claim 支（消费 C、造 O）
```
require(checkSigFromStack(A, sig_A));               // A2 原语，canonical 8065184 树
require(blake2b(s) == h);                           // adaptor 揭示
require(OpInputCovenantId(C_in_idx) == cid);        // 消费的是真 C  ← ShardLeaf.sil:99 同款
require(OpCovOutputCount(cid) == 1);                // MUST-FIX 2: 恰一续继(唯一 capability)。==1 同时兼防呆(cid=0 非 covenant→fail, 堵 0==0 平凡通过)+唯一性; ShardLeaf:101 用 >=1 是因它允许多续继, C 要唯一故收紧到 ==1
require(OpOutputCovenantId(O_out_idx) == cid);      // 造的 O 续 cid  ← ShardLeaf.sil:104
require(OpTxOutputSpkSubstr(O_out_idx,0,len) == baked_O_spk);   // O 形状（格式，不承 provenance）
require(tx.outputs[O_out_idx].value >= min_O);      // §5
```

### (c) reactive-claim 支（花 O，校验血缘）
```
require(checkSigFromStack(A, sig_A));
require(blake2b(s) == h);
require(OpInputCovenantId(O_in_idx) == cid);        // 花的 O 血缘续自真 C  ← ShardLeaf.sil:99 同款
// 无 (A,s) fallback — 唯一路径
```
🔵 **`OpInputCovenantId(idx)` 按任意索引读【非 active 输入】= 已证**（ShardLeaf.sil:99 `psInIdx` 就是非 active 索引，上链跑通）。⇒ 多输入（O + fee）时按索引点准 O 那条，可建。

### (d) refund / T_O 回收（全部 lineage-terminal，MUST-FIX 1+3 修）
🔴 **MUST-FIX 1：本金 refund 走 P-SAFE-1 单-live-lineage state machine，不编码 A-absent 谓词**。covenant 证不了链下 A 全局不存在——只能验它自己 LOCKED 对象的**本地正事实**（被没被 validated-reveal 消费过）：
- **reveal 侧本金锁 = `LOCKED(session)` covenant**，恰两条互斥后继支：
  - **transfer 支**（cutoff 前，v0.3 加原子焊接）：
    ```
    require(current_daa < T_cutoff_LOCKED);
    require(checkSigFromStack(A, sig_A));
    require(blake2b(s) == h);
    require(OpInputCovenantId(C_idx) == cid);   // 🔴 v0.3 焊接: 同一笔 tx 必须也消费 C ⇒ 触发 C 的 §4-b 强制造 O ⇒ 揭s⟹消费C⟹造O 原子
    ```
    validated-reveal 转移消费 LOCKED（正事实，非"证 A 不存在"）。**焊接 require 强制这笔 tx 同时把 C 作为 input**（`OpInputCovenantId(C_idx)==cid` = ShardLeaf:99 读非 active input pattern），C 一被消费其 §4-b 支即强制造 O ⇒ 无法"拿本金却不造 O"。
  - **terminal-refund 支**（cutoff 后）：`require(current_daa >= T_cutoff_LOCKED)`——**still-unspent LOCKED** 转 terminal 明文退首动方。互斥由 UTXO once-spend 天然保证：reveal 发生 ⇒ LOCKED 已被 transfer 支花掉 ⇒ refund 支无 UTXO 可花（不需证 A-absent）。
  - **产出必须 terminal 明文出、无续链**（闸③；`OpCovOutputCount == 0`）。
- 🔴 **cutoff 排序不变量（v0.3，焊接生效前提）**：`T_cutoff_LOCKED <= C_terminal_refund_cutoff`。否则 LOCKED-transfer 活窗内，同笔消费 C 可走 C 的 terminal-refund 支（不造 O）绕过焊接。排序守住 ⇒ C 在 LOCKED-transfer 活窗内**唯一可走支 = reveal-claim（造 O）**。
- **O 的 T_O 回收**（付回首动方）：🔴 **MUST-FIX 3**：`require(current_daa >= OpTxInputDaaScore(O) + N_claim + N_margin)`（相对 O 创建的本地 DAA，非绝对窗），**产出 terminal 明文、`OpCovOutputCount == 0`**（闸③；J2 自逮侧门）。
- **C 的 terminal-refund**：同样 `OpCovOutputCount == 0`（闸③）。

---

## §5 min_O / T_O / spk∧value 双 require

- **spk∧value 必须一起 require**（reveal-claim 支）：只查 spk 不查 value，首动方可造 dust/0 值形似 O，反应方花它付不起费 = 等价没造（malform 绕过，J2 §2-b）。
- **min_O 口径**：≥ 反应腿 claim 最坏手续费 + KIP-9 存储质量地板。**复用既有常量**（`_BSHARD_FEE_PER_INPUT = 1_000_000n` 等），不新造。🟡 具体数值未拍（§7）。
- **T_O 相对锚（MUST-FIX 3）**：回收支 `require(current_daa >= OpTxInputDaaScore(O) + N_claim + N_margin)`——锚在 **O 自己 input 的 DAA**（本地祖先事实），`N_claim`（反应方 claim 落链最坏 DAA 跨度）+ `N_margin` 是**相对时长**，不是绝对 deadline。理由：O-lineage 采纳初衷=不靠外部/模糊 finality 钟；绝对窗会重新引入无锚绝对时间。太早（N 太小）⇒ 首动方抢回 O ⇒ 反应方结构性 claim 不了 = 新洞，故 N 须保守上界（§7）。

---

## §6 deploy 不变量（漏一条静默不存在）+ 负测

1. **genesis-mint 义务**：relay 必 ① 把 C genesis-mint 为 covenant（`cid≠0`）② 每个 continuation output 续 `CovenantBinding(cid)` ③ 建 v1 tx（`TX_VERSION_TOCCATA`）+ compute_budget。**covenant 自己检查不出"当初没 mint"**（`PayoutShard.sil:26` 同款）。
2. **唯一续继变异负测（MUST-FIX 2，承重·J2 验收族 B）**：① 把 reveal 支的 `OpCovOutputCount(cid) == 1` 改成 `>= 1` ⇒ 验收**必须挂**；② 让某条 terminal/refund/cancel 支产出**一个续链 output**（`OpCovOutputCount != 0`）⇒ 验收**必须挂**。⇒ 唯一性靠"改松有人红"，非"记得写 ==1"。**漏则闸③/唯一 capability 静默失效。**
2b. 🔴 **原子焊接负测（v0.3·NWT 缝·【交易级】变异，与上面语句级不同层）**：把 `LOCKED-transfer` 与 `C-consume/O-create` **拆成两笔 tx 分别提交** ⇒ 领本金那笔（LOCKED-transfer）**必须被拒**（因焊接 require `OpInputCovenantId(C_idx)==cid` 在同笔找不到 C）。J2 判据：这条缝的**缺失约束不在任何一行代码里**，故负测改的是【怎么提交】不是【哪一行 require】——J2 验收族 B 已加（`86c04c55`）。附：cutoff 排序负测——令 `T_cutoff_LOCKED > C_terminal_refund_cutoff`，构造"同笔消费 C 走 C 的 terminal-refund（不造 O）"⇒ 必须被拒。
3. **A-absent 全清核（MUST-FIX 1）**：全文 grep `A-absent` 必须**零命中**于 normative 构造（只许出现在 §0.5 变更说明里作为"已清除的旧写法"）。refund 只走 §4-d 的 still-unspent LOCKED state machine。
4. **A2 腿 e2e**：`checkSigFromStack` 合法签过 / 改一位拒 —— 必在 canonical `8065184` 树上编 + 上链跑，读 codegen 不算（OP_PICK 教训）。
5. **cov_id 派生 e2e**：造两个不同 funding outpoint 的 candidate C，验其 cid 不同、且只有 baked 那个的 O 过 reactive 检查。

---

## §7 明列未决（不假装闭合）

1. **运营取值三项（min_O / N_claim / N_margin）无权威值，我不拍数字** —— `min_O`（§5，≥反应腿 claim 最坏费+KIP-9 地板）、`N_claim`（反应方 claim 落链最坏 DAA 跨度）、`N_margin`（T_O 相对锚安全余量，§4-d）。同链可保守上界（本链费市场/DAA 产出率可读，比 §6-3 B 跨链版好定），仍须落**具名保守常量**（复用既有 `_BSHARD_FEE_PER_INPUT` 等），不硬编经验值。
2. **checkSigFromStack A2 腿的 canonical-树 e2e 尚未跑**（§6.4）—— 本构造落码前硬前置，归 canonical `8065184` 树（非我这台）。
3. **cov_id 协议派生须落 durable 源码/runtime 证（Codex MSG-260 附加条件）** —— §3闸① 引 `p2sh.mjs:1767` 是 relay 侧构造注释；真权威=实际 Toccata path（consensus）的 cov_id 派生规则，须落一份 durable 源码/runtime 证据（同 silverc provenance doc 做法），不停在"relay 注释这么说"。
4. **跨链完全不适用 + 仍需正 finalized-reveal 证** —— 反应腿花不了对手链的 O，退 R1/light-client（Codex MSG-260 明示本轮不闭跨链）。

---

## §8 可建性证据表

| 构造件 | 原语 | 证据（活先例 / 编译器） | 状态 |
|---|---|---|---|
| 读非 active 输入 cov_id | `OpInputCovenantId(idx)` | `ShardLeaf.sil:99`（上链+NWT 红队） | ✅ 已证 |
| 强制续链输出 | `OpOutputCovenantId(idx)==cid` | `ShardLeaf.sil:104` | ✅ 已证 |
| 唯一续继（兼防呆） | `OpCovOutputCount(cid)==1`（MUST-FIX 2） | `ShardLeaf.sil:101` 用 `>=1`（允许多续继），本构造收紧 `==1` | ✅ 原语已证·`==1` 待验收变异负测 |
| terminal 支零续链 | `OpCovOutputCount==0` | `PoolSpine` per-branch 管控同款 | ✅ 原语已证·待变异负测 |
| cov_id 共识派生不可选 | consensus metadata | `p2sh.mjs:1767` `covenant_id(outpoint,[out])` | ✅ 已证 |
| per-branch 续链管控 | `validateOutputState` | `PoolSpine_v08_chunk.sil:93/226` | ✅ 已证 |
| O 形状 | `OpTxOutputSpkSubstr` / `.value` | `compile.rs:3572` + CloseZkV2:125-126 | ✅ 已证 |
| hashlock | `blake2b` | 既有 covenant 普遍用 | ✅ 已证 |
| 时锁下界 | `tx.time >= X`（DAA） | `ShardLeaf.sil:96`、30 处 lower-bound | ✅ 已证 |
| 多 covenant-input 一笔 tx（LOCKED+C 原子焊接） | `OpCovInputCount`/`OpCovInputIdx` + `OpInputCovenantId(C_idx)` | compile.rs:3577-78 + `ShardLeaf:99` 读非 active input cov_id | ✅ 已证（Q① 裁可建） |
| adaptor 揭示签 | `checkSigFromStack(A)` | canonical `8065184`（#132） | 🟡 待 canonical 树 e2e |

⇒ **净判断（v0.3）**：Codex 判**架构 GREEN**（cov_id-lineage + co-reorg PASS-AS-ARCHITECTURE）。v0.2 修三条 MUST-FIX；**v0.3 补 NWT 逮到的两-lineage 原子焊接缝**（LOCKED-transfer 加 `OpInputCovenantId(C_idx)==cid` 强制同笔消费 C + cutoff 排序不变量 + 显式 principal 拓扑 §2.5 + 交易级负测 §6.2b）。**落码前硬前置 = ① 唯一续继/单出口变异负测 + 原子焊接交易级负测（§6.2/6.2b） ② A2 腿 canonical `8065184` 树 e2e ③ cov_id 派生 durable 证（§7.3）**。v0.3 送 Codex MSG-261+ 复审过 ⇒ 同链 design-closed = 无委员结构 Tier-2。跨链退 R1。落码 Owner 批实现闸。
