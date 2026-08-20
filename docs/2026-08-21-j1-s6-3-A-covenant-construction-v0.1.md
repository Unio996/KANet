# §6-3 A：fair-exchange 结算 covenant 完整构造（v0.1 · 报备层 · 零生产码）

> **Status**: CURRENT
> **作者** J1 · **日期** 2026-08-21 · **派工** Bettor 16:22（「@J1 出完整 §6-3 A covenant 构造，归 A2 covenant 域，落码 Owner 批实现闸」）
> **上游** J2 O-spec v3（`docs/2026-08-20-j2-o-earmark-construction-spec.md`）+ 三方收敛修法：**O-replacement（反应腿必须花 O，无 `(A,s)` fallback）+ covenant-id lineage provenance**（Codex option B/C，复用 §15/bshard 续链活先例）。
> **适用** 🔴 **仅同链**（两腿都在 TN12）。跨链退 R1/light-client（O 构造完全不适用，Codex MSG-260 与我 §6-3 B 洞1 同判）。

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
refund: reveal 侧 A-absent@T_react_refund 退本金；O 侧 T_O 退首动方（lineage-terminal，§4-d）
```

🔴 **必须 O-REPLACEMENT**：保留 `(A,s)` fallback ⇒ 反应方可凭 `(A,s)` 在**非最终** reveal 上 claim ⇒ C4-FINALITY 原洞照旧。安全性质只能来自**唯一路径**（J2 判据，采纳）。

---

## §3 三闸的源码级答案

### 🟢 闸① cov_id 必须协议派生不可选 —— **闭**

**实读 `kasia-relay/src/lib/p2sh.mjs:1767`**：cov_id 由 **consensus 重算赋**
`cov_id = covenant_id(funding.outpoint, [psOut])` —— 是**创世 funding outpoint 的派生值（像合约地址由部署 outpoint 决定），不是创建者可填字段**（`:1758` 注 "consensus metadata; UtxoEntry.covenantId"；`_psInputCovId` 只读不写）。

⇒ 攻击者要撞一个 `=baked` 的 cov_id，须同时 (a) 找到 hash 到目标值的 funding outpoint = blake2b 系**原像攻击**；(b) 真控且花掉那个特定 outpoint。两者 = 不可行。**"假 cov_id≠baked→BUST" 成立。**
🔵 补强防呆（活先例）：`ShardLeaf.sil:101 require(OpCovOutputCount(ps_cov) >= 1)`（"NWT 钉"）令**零/非法 cov_id 直接 fail** —— 这正是闸①要的"非法值不许通过"，已在库。

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
require(OpCovOutputCount(cid) >= 1);                // 零/非法 cov_id 防呆  ← ShardLeaf.sil:101
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

### (d) refund / T_O 回收（全部 lineage-terminal）
- **reveal 侧本金 refund**：`require(A-absent) ∧ require(tx.time >= T_react_refund)`（DAA，`<5e11`）。
- **O 的 T_O 回收**（付回首动方）：`require(tx.time >= T_O)`（DAA），**产出必须 terminal 明文出、无 CovenantBinding 续链**（闸③；J2 自逮侧门）。
- **C 的 terminal-refund**：同样**产出无续链**（闸③）。

---

## §5 min_O / T_O / spk∧value 双 require

- **spk∧value 必须一起 require**（reveal-claim 支）：只查 spk 不查 value，首动方可造 dust/0 值形似 O，反应方花它付不起费 = 等价没造（malform 绕过，J2 §2-b）。
- **min_O 口径**：≥ 反应腿 claim 最坏手续费 + KIP-9 存储质量地板。**复用既有常量**（`_BSHARD_FEE_PER_INPUT = 1_000_000n` 等），不新造。🟡 具体数值未拍（§7）。
- **T_O 不等式**：`T_O > 反应方 claim 落链最坏用时 + margin`（DAA，`<5e11`，不得与其它 cutoff 混单位，v1.3 裁）。太早 ⇒ 首动方抢回 O ⇒ 反应方结构性 claim 不了 = 新洞。

---

## §6 deploy 不变量（漏一条静默不存在）+ 负测

1. **genesis-mint 义务**：relay 必 ① 把 C genesis-mint 为 covenant（`cid≠0`）② 每个 continuation output 续 `CovenantBinding(cid)` ③ 建 v1 tx（`TX_VERSION_TOCCATA`）+ compute_budget。**covenant 自己检查不出"当初没 mint"**（`PayoutShard.sil:26` 同款）。
2. **单出口负测（承重）**：手写一条 C 的 refund 支令其产**带 cid 的 output**，**必须 BUST**。同理 O 的 T_O 回收支产带 cid output 必须 BUST。**漏则闸③静默失效。**
3. **A2 腿 e2e**：`checkSigFromStack` 合法签过 / 改一位拒 —— 必在 canonical `8065184` 树上编 + 上链跑，读 codegen 不算（OP_PICK 教训）。
4. **cov_id 派生 e2e**：造两个不同 funding outpoint 的 candidate C，验其 cid 不同、且只有 baked 那个的 O 过 reactive 检查。

---

## §7 明列未决（不假装闭合）

1. **min_O 具体数值** —— 待运营给最坏手续费口径，我不拍数字（§5）。
2. **「反应方 claim 落链最坏用时」无权威值** —— 是 T_O 不等式的输入，同链可保守上界（本链费市场可读），比 §6-3 B 跨链版好定；仍需一个具名保守常量，不硬编经验值。
3. **checkSigFromStack A2 腿的 canonical-树 e2e 尚未跑**（§6.3）—— 这是本构造落码前的硬前置，归 canonical 树（非我这台）。
4. **跨链完全不适用** —— 反应腿花不了对手链的 O，退 R1/light-client（与 Codex MSG-260、我 §6-3 B 洞1 同判）。

---

## §8 可建性证据表

| 构造件 | 原语 | 证据（活先例 / 编译器） | 状态 |
|---|---|---|---|
| 读非 active 输入 cov_id | `OpInputCovenantId(idx)` | `ShardLeaf.sil:99`（上链+NWT 红队） | ✅ 已证 |
| 强制续链输出 | `OpOutputCovenantId(idx)==cid` | `ShardLeaf.sil:104` | ✅ 已证 |
| 零/非法 cov_id 防呆 | `OpCovOutputCount(cid)>=1` | `ShardLeaf.sil:101`（"NWT 钉"） | ✅ 已证 |
| cov_id 共识派生不可选 | consensus metadata | `p2sh.mjs:1767` `covenant_id(outpoint,[out])` | ✅ 已证 |
| per-branch 续链管控 | `validateOutputState` | `PoolSpine_v08_chunk.sil:93/226` | ✅ 已证 |
| O 形状 | `OpTxOutputSpkSubstr` / `.value` | `compile.rs:3572` + CloseZkV2:125-126 | ✅ 已证 |
| hashlock | `blake2b` | 既有 covenant 普遍用 | ✅ 已证 |
| 时锁下界 | `tx.time >= X`（DAA） | `ShardLeaf.sil:96`、30 处 lower-bound | ✅ 已证 |
| adaptor 揭示签 | `checkSigFromStack(A)` | canonical `8065184`（#132） | 🟡 待 canonical 树 e2e |

⇒ **净判断**：同链 O-replacement + covenant-id lineage 的 provenance **结构闭**（三闸源码级有答，承重件全锚活先例）；**唯一落码前硬前置 = 闸③单出口负测 + A2 腿 canonical-树 e2e**。跨链退 R1。落码 Owner 批实现闸。
