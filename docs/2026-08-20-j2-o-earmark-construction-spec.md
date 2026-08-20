# C4-FINALITY：`O` earmark 精确构造（草案 · 报备层 · 零生产码）

> **Status**: **SUPERSEDED（构造细节部分）**

> 🔴 **权威副本已转移**：`min_O` / `T_O` / lineage 各支 require 的**权威形态**现在是
> `docs/2026-08-21-j1-s6-3-A-covenant-construction-v0.2.md`（J1，含 Codex MSG-260 三条 MUST-FIX）。
> **本文档不再维护那几项**，以免两处副本漂移（本仓通则：别处有权威副本 ⇒ 删掉会漂移的那份）。
>
> **具体已被取代的**：
> - 我 §2-c 的 `T_O` 是**绝对 DAA 窗**；v0.2 MUST-FIX 3 改为**相对锚**
>   `require(current_daa >= OpTxInputDaaScore(O) + N_claim + N_margin)` —— **从 O 实际创建时刻起算**，
>   不必在"还不知道 reveal 何时发生"时就烤死一个绝对值。**以 v0.2 为准。**
> - `OpCovOutputCount` 我原文继承先例的 `>= 1`；v0.2 收紧为 **`== 1`**（reveal 恰一续继）
>   + 每条 terminal 支 **`== 0`**。**以 v0.2 为准。**
>
> 🔵 **本文档仍有价值的部分**（未被取代）：§0 / §0-bis / §0-ter 记录的**推翻过程与判据** ——
> 「唯一性 ≠ 来源」「script-bound ≠ origin-bound」「照搬先例会一并搬来它为别的需求校准的强度」，
> 以及**每一版是怎么被打穿的**。构造会被取代，**踩过的形状不会**。

**作者** J2 · **日期** 2026-08-20 · **派工** Bettor 15:23（「@J2 出 O 精确构造：spk 派生 / min_O / timeout / 谁回收」）
**上游** 三方收敛的修法：**O-replacement（反应腿必须花 O，无 `(A,s)` fallback）+ reveal-claim 强制造 O**
**适用** 🔴 **仅同链**（两腿都在 TN12）。跨链时反应腿花不了对手链的 `O`，本构造完全不适用。

---

## §0 v2 更正：**v1 的绑定方式被打穿（Codex），须绑 cov_id provenance 而非 script**

**破法**：`O_spk` 是**公开可算**的脚本地址 ⇒ **谁都能往它打钱** ⇒ 可合成一个 spk/value 都对、
却与真 reveal **毫无血缘**的 `O` ⇒「花 O ⇒ reveal 已上链」与「reveal reorg ⇒ claim 同死」**双双不成立**。

🔴 **我错的那一步**：我检查过 `O_spk` 的 **session 唯一性**（不同 session 不可互换），
**却把它读成了「只有 reveal 交易能产生 O」** ——
**唯一性 ≠ 来源；script-bound ≠ origin-bound。查了"能否挪用"，没查"谁能造"。**

### 🔴🔴 而这个错在本仓【有现成先例，且判据在记忆里】

- **合约先例** `PayoutShard.sil:13-18`（J1 落，源于 NWT 2026-06-20 红队）逐字写着：
  > 「destination-bind **必绑 cov_id PROVENANCE 非 template LOCATION**；
  > template-match 可被 **recreatable-UTXO 造【同 template 自控 state 的假 PayoutShard】击穿**
  > → 假 PS 被 attacker claim 走 = **真 theft/grief**。
  > **cov_id（创世身份，跨 continuation 稳定不可伪）是唯一真实例锚。**」
- **记忆判据** `feedback-recreatable-utxo-nullifier-defeatable` 写着：
  > **「审任何 spent-once 机制必问：被花的对象能不能被攻击者重新造一个等价的？」**

⇒ 我的构造**整个建立在"O 不可重造"之上**，而这条问句会**当场**逮到它。
**这不是一个新坑，是本仓两个月前踩过、修好、并写进合约注释与记忆的同一个坑。**

---

## §0-bis v3：**冻结形态（Bettor 16:20）+ 我自己逮到的一处侧门**

### 冻结的三步 lineage

```
锁前  : 造唯一 capability C（cov_id 烤进两腿）
reveal: checkSigFromStack(A) ∧ blake2b(s)==h ∧ [消费 C]
        ∧ [造 O: OpInputCovenantId(O) 续自 C ∧ spk==baked_O ∧ value>=min_O]
react : checkSigFromStack(A) ∧ blake2b(s)==h ∧ [花一输入 O: OpInputCovenantId(O)==baked_C_cov_id]
```

🔴 **构造是 O-REPLACEMENT，不是 parallel-optional**：
保留 `(A,s)` fallback ⇒ 反应方可凭 `(A,s)` 在**非最终** reveal 上 claim ⇒ **C4-FINALITY 原洞照旧**。
（同 §① 那条判据：安全性质只能来自唯一路径。）

### 🔴 我自己逮到的侧门：**`T_O` 回收支必须显式终止 lineage**

NWT 问「C 除被 reveal-claim 消费外，有没有另一条支路也能产出 cov_id 延续的输出」——
**同一个问题正打在我 §2-c 给 `O` 配的那条 `T_O` 超时回收支上**：

- 若回收支产出的 output **带 cov_id** ⇒ 首动方超时取回后，**手里就有一个带 session cov_id 的 UTXO**
  ⇒ 他可能据此再造一个通得过 `OpInputCovenantId` 检查的 `O` ⇒ **侧门，只是开在我这边**；
- 若**不带**（回收即终止 lineage）⇒ 侧门关上。

🔨 ⇒ **`T_O` 回收支必须【显式终止 cov_id 延续】** —— v2 原文**没写这条，是漏**。
🟡 **可建性未核**：covenant 能否表达「终止 lineage」（`termination = allowed` 之类）归 J1 源码域。

### 🟡 仍未核的三条（不成立则整个 v3 不成立）

1. `cov_id` 如何派生、能否碰撞 —— `p2sh.mjs:1752` 注释称其为 **consensus metadata**（非创建者自由填），
   方向与"不可选"一致，**但我没核派生法**；
2. **capability `C` 由谁创建**、双方能否各自独立验证"这就是唯一那个 C"；
3. **reveal 消费 C 造 O 这一步能否被中间人截**。

---

## §0-ter v4：Q3 一般化 —— **不是只有 `T_O`，是 C 的【每一条】非 reveal-claim 支路**

（J1 16:28 源码答 + NWT 16:29 复核：Q1 cov_id 派生、Q2 C 唯一性**已闭**；**Q3 是承重的授权义务**）

我 v3 只写了「`T_O` 回收支必须终止 lineage」。**那是一个实例，不是规则。** 正确的规则是：

> 🔴 **`C` 的每一条【非 reveal-claim】支路，都必须【显式禁止】续 cov_id lineage。**

任何一条 s-free 的支路（refund / timeout / cancel / 未来新增的任何 entry）若产出 cov_id-续链 output，
就是**一条不走 reveal 也能造出合法-lineage `O` 的侧门** —— 伪造面从"谁都能造"收窄到"C 的持有者能造"，
**收窄了，但没关上**。

### 🔨 落地方式：**显式 require + 配负测**，不靠"记得禁了"

NWT 的原话值得照抄：**「光靠『我这么写的时候是这么想的』不构成保证，得有测试逼它显式失败才算数。」**

⇒ **这正好接上我另一份文档的族 B（合约变异）**
（`docs/2026-08-20-j2-a2-whole-receipt-binding-acceptance-design.md` §3）：

> **必测格：删掉「禁止续 lineage」那句 require ⇒ 测试必须挂。**

若删掉它测试仍全绿，说明**没有任何一格在守这条规则** —— 而它是 provenance 的承重件。
（同族：今晚 `committeePkHash` 那个诱饵——**自洽的 require 看着像绑定，删了真绑定它还在**。）

---

## §1 它要交付的性质（先写死，防被读成别的）

> **反应腿的 claim 在【结构上】不可能早于 reveal 被链收录；且 reveal 一旦被 reorg，反应腿的 claim 同时失效。**

不是"等够深度"，是**共存亡**：`O` 由 reveal 交易创造，claim 花掉它。
⇒ `F_reveal` 这个专属 finality 预算参数**从安全承重位移除**（退化成"每笔交易等自己确认"的通用问题）。

---

## §2 四个待定项

### (a) 🔴 **provenance 绑定（v2 修正，取代原 spk 派生方案）**

**绑的是 covenant 身份，不是脚本形状**：

1. `O` 必须是 **reveal-腿锁定 UTXO 的 covenant 后继**（同一 `cov_id`，非任意付款）；
2. reactive-腿 claim 支 `require(OpInputCovenantId(j) == baked_session_cov_id)`
   —— 外人打钱造的 look-alike **拿不到该 cov_id** ⇒ **伪造面关闭**；
3. `spk` / `value` 的检查**仍然保留**，但降级为**格式检查**，**不再承担 provenance**。

🔴 **承重的 deploy 不变量（照 `PayoutShard.sil:26` 那条，漏一条绑定就静默不存在）**：
relay 必 ① 把 reveal-腿 genesis-mint 为 covenant（`cov_id ≠ 0`）
② 给**每一个 continuation output**续 `CovenantBinding(cov_id=…)`
③ 建 v1 tx + compute_budget。
⇒ **这三条属于链下构造方的义务；covenant 自己检查不出"当初没 mint"。**

🟡 **我未核（J1 源码域）**：cov_id 能否读**非 active input**；reveal-claim 能否**强制**产出携带该 cov_id 的 O；
该血缘是否**共识 enforce**。**这三条不成立则本 v2 同样不成立。**

### (a-旧) ~~`O` 的 scriptPubKey 派生~~（v1，**已被打穿，保留以示推翻方式**）

`O_spk = P2SH( OEscrow(session_id, reactive_pk, firstmover_pk, T_O) )`

- **session-bound**：`session_id` 必须进 `OEscrow` 的 ctor ⇒ 不同 session 的 `O` **不可互换**（防重放/串场）。
- 🔴 **锁定时可算**：双方在**两腿锁定之前**即可算出 `O_spk`（全部参数在 session 协商时已定）
  ⇒ 可作为 **baked 常量**写进两腿 covenant，**不需要知道 reveal 的 txid**
  ⇒ **不破坏"两腿锁定在前"**（Bettor 15:17 已复核这一点）。

### (b) `min_O`（金额下限）

reveal-claim 支必须 `require(tx.outputs[k].scriptPubKey == O_spk ∧ tx.outputs[k].value >= min_O)`。

🔴 **两项必须【一起】require** —— 只查 spk 不查 value，首动方可造一个**金额为 0 / dust** 的形似 `O`，
反应方花它时付不起手续费 ⇒ **等价于没造**（malform 绕过）。

`min_O` 取值口径：**≥ 反应腿 claim 交易在最坏情况下的手续费 + KIP-9 存储质量地板**。
🟡 **具体数值我不在此拍**：本仓已有 `_BSHARD_FEE_PER_INPUT = 1_000_000n`（0.01 KAS/input）等既有量，
**应复用既有常量而非新造**（同 `REORG_SAFE_MIN_DEPTH` 收敛成单一具名常量的先例）。

### (c) `T_O`（timeout）与不等式

`OEscrow` 两支：
- **反应方支**：花 `O` 用于反应腿 claim（**无时间下界** —— 越早越好，它本身就是结构证明）；
- **回收支**：`require(tx.time >= T_O)`，付回首动方。

🔴 **不等式（Bettor 15:23 提出，必须成立）**：

```
T_O  >  反应方 claim 落链最坏用时  +  margin
```

**若 T_O 太早** ⇒ 首动方到期**抢回 `O`** ⇒ 反应方**结构性 claim 不了** = **新洞**（首动方已拿钱、反应方拿不到）。

🔴 **单位**：按 v1.3 裁定，`T_O` 与其余三处 cutoff **同为 DAA-score**（`< 5e11`，落 DAA 模式）。
**不得混单位** —— 它与 `T_react_refund` 之间同样是不等式关系。

### (d) 谁回收 / 谁出钱

- **出钱**：`O` 从 **reveal 腿 claim 的产出**里切一份 ⇒ **首动方出**。
  🔵 理由：造 `O` 是首动方**领钱的前提**，成本理应由领钱方承担；反应方无需预付。
- **回收**：`T_O` 后由**首动方**回收（回到 (c) 的回收支）。
- ⇒ **正常路径下 `O` 不是损耗**：反应方花掉它（金额并入其 claim），或首动方超时收回。**无死钱。**

---

## §3 🔴 我明列的未决与风险（不假装闭合）

1. **`min_O` 的具体数值未定** —— 需 J1/运营给最坏手续费口径；**我不拍数字**。
2. **「反应方 claim 落链最坏用时」没有权威值** —— 而它是 `T_O` 不等式的输入。
   🔴 这与今天那条同族：**又一个"由运营/链况决定、却要烤进 covenant 的量"**。
   ⇒ 取值必须按**实测最慢**，且**报告里标明它是运营量**。
   🟡 **诚实说**：这意味着 `F_reveal` 被消除了，但 **`T_O` 引入了一个【新的】时间参数** ——
   **不过它的失败方向不同**：`F_reveal` 取小 ⇒ **fail-open（盗窃）**；`T_O` 取小 ⇒ **fail-closed 后再被首动方抢回 ⇒ 也是不对称结局**。
   **⇒ 我不声称"参数总数减少了"，我声称的是【被消除的那个在安全承重位上，新增的这个在活性/公平位上】。这两者不等价，但请不要把它读成"零成本"。**
3. **`OEscrow` 本身是新合约** ⇒ 它自己也要过 §846181e4 那套验收（族 A witness 篡改 + 族 B 合约变异）。
4. **仅同链**；跨链回到 conditional / R1。
5. **编译坐标**：`OpTxInputSpkLen`/`OpTxInputSpkSubstr`/`OpTxInputDaaScore` 我在本机 `/d/silverscript` 读到，
   **canonical `8065184` 上须再确认**（J1 已标同一注意）。

---

## §4 与 `OpTxInputDaaScore` 的关系（澄清，防被当成二选一）

`OpTxInputDaaScore(i)` 读的是**本笔交易 input i** 的 DAA ⇒ **要读 reveal UTXO 就必须先花它**
⇒ **该原语【预设】本构造，而非替代它**。

⇒ 若日后想在结构依赖之上**再加深度**，可在同一 input 上 `require(OpTxInputDaaScore(j) + N <= 当前daa)`。
🔵 **但我倾向不加**：共存亡已关死 reorg 那格，加深度等于**把一个参数请回来**（见 §3-2 的教训）。
