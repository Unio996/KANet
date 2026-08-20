# C4-FINALITY：`O` earmark 精确构造（草案 · 报备层 · 零生产码）

> **Status**: CURRENT

**作者** J2 · **日期** 2026-08-20 · **派工** Bettor 15:23（「@J2 出 O 精确构造：spk 派生 / min_O / timeout / 谁回收」）
**上游** 三方收敛的修法：**O-replacement（反应腿必须花 O，无 `(A,s)` fallback）+ reveal-claim 强制造 O**
**适用** 🔴 **仅同链**（两腿都在 TN12）。跨链时反应腿花不了对手链的 `O`，本构造完全不适用。

---

## §1 它要交付的性质（先写死，防被读成别的）

> **反应腿的 claim 在【结构上】不可能早于 reveal 被链收录；且 reveal 一旦被 reorg，反应腿的 claim 同时失效。**

不是"等够深度"，是**共存亡**：`O` 由 reveal 交易创造，claim 花掉它。
⇒ `F_reveal` 这个专属 finality 预算参数**从安全承重位移除**（退化成"每笔交易等自己确认"的通用问题）。

---

## §2 四个待定项

### (a) `O` 的 scriptPubKey 派生

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
