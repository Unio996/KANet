# C4-FINALITY 同链构造：**两两独立性矩阵**（Shape B · 报备层 · 零生产码）

> **Status**: CURRENT（对 Codex 00:09 精确支集重建）

**作者** J2 · **日期** 2026-08-21
**被测对象** J1 的 §6-3 A covenant 构造（Shape B）· **支集权威**以该构造文档为准

> 🔴 **本文档已重写**：早前版本（Shape A 时期）含大量**已不存在的分支名**。
> 按「死分支名 = 该删不该留」的分级，历史节**整体删除**而非标注保留 ——
> 留着会让死分支名继续可被 grep 到、并被下一个人当成现役。
> **演进过程保留在 git 历史里，那里不会被误当成现状。**

---

## §1 支集（Codex 00:09 精确目标，5 对象 × 2 支 = 10 支）

| 记号 | 对象 | 两支 |
|---|---|---|
| `Rr` / `Rf` | `LOCKED_R`（反应方本金） | reveal-transfer / terminal-refund |
| `Cc` / `Cf` | `C`（capability） | reveal-continuation / terminal-refund |
| `Ft` / `Fg` | `LOCKED_F`（首动方本金） | **reveal-transition→`O_AUTHORIZED`** / **giveup** |
| `Ac` / `Ar` | **`O_AUTHORIZED`** | reactive-claim / recovery（锚 `OpTxInputDaaScore(O_AUTHORIZED)+N`） |
| `Oc` / `Or` | `O`（earmark） | reciprocal reactive-claim / recovery |

🔴 **支集必须从构造文档的【实际 spend 条件】读，不从任何叙述（含本文）抄。**
🔴 **新增任何一支 ⇒ 本表即失效**，须据新支集重建（已实际发生过一次：`Fg` 出现时带来 9 个新对）。

---

## §2 承重对（每对标：独占来自谁的下界支）

covenant **只能 enforce 下界**。「你须 X 前行动」不靠给你设上界（**上界不可表达**），
靠给**对方** recovery 支设 `>= X` ⇒ X 前对方那支被链上直接拒 ⇒ 你获得可 enforce 的独占窗。

| 对 | 判 | 机制 / 独占来源 |
|---|---|---|
| `Rr` × `Cc` | **WELD** | 同笔原子：领 `LOCKED_R` 必同笔消费 `C` 且转 `LOCKED_F` |
| `Rr` × `Cf` | **EXCL** | cutoff 排序：`Rr` 活窗内 `Cf` 未开 |
| `Ac` × `Oc` | **WELD（双向）** | 互为 co-input，各自 payout 焊死 |
| `Ac` × `Ar` | 独占 | 来自 `Ar` 的 `>=` 下界 |
| `Oc` × `Or` | 独占 | 来自 `Or` 的 `>=` 下界 |
| 含 `Rf` / `Cf` 且需 `O`/`O_AUTHORIZED` 存在者 | **EXCL（真空）** | 无 reveal ⇒ 该对象不存在 ⇒ 对面支不可构造 |
| `Fg` × 其余 | 🔴 **见 §3** | **free-option 降低、非消除** |

---

## §3 🔴 `Fg`（giveup）：**free-option 降低，非消除**

排序 `T_giveup >= T_cutoff_LOCKED_R` **降低**了它（起点从「随时」推到 cutoff），**但没关闭**：

- **`Rr`（reveal）没有上界** —— `T_cutoff_LOCKED_R` 只是 `LOCKED_R` refund 的**下界**，**不 disable reveal 支**；
- ⇒ cutoff 之后，只要对手方尚未 refund，首动方**仍可**在「reveal」与「giveup」间自由选。

⇒ **残留由 liveness bound**（对手方及时 refund 才关闭该窗），**不是结构性关闭**。

> 🔨 **这条修法曾被我提出并被判无效** —— 它默认了「某个下界 == 某个窗的关闭点」。
> **任何「某时刻之后就不能再 X」的推理，都要先问 `X` 有没有上界。**
> **没有上界的支，任何 cutoff 都关不掉它。**

---

## §4 第二根轴：**支 × 不变量**（两两矩阵照不到单支属性）

两两矩阵只看支与支之间；**单支是否满足既有不变量，它看不见**。

| 不变量 | 适用 | 逐支核 |
|---|---|---|
| 闸③：terminal 支 `OpCovOutputCount == 0` | 每条非-reveal 支 | 曾漏一条，已全扫补齐 |
| 时间量同域（DAA-score，`< 5e11`） | 每个时间常量 | 待逐支核 |
| 无上界表达 | 全构造 | 已有静态 grep 检查 |
| 每个 `>= X` 的 `X` 有排序出处 | 每条下界支 | 曾漏一条（`T_giveup`），已加 |

🔵 实际经验：**一条新支可同时违反两条不变量，而两条被两个人分别发现** ——
一个人拿一根轴看，各看到一半。

---

## §5 明列边界（防被当成覆盖证据）

1. **只保证没有格被跳过**，**不保证每格的机制判断对** —— 逐格仍须构造域与对抗审查各自核。
2. 🔴 **格是我画的**：支集若从「设计意图」而非「实际 spend 条件」导出，**画错格，穷举再完整也照不到**。
   （已发生过：把某支记成「被谁消费」而非「允许什么」，漏掉了它自己的独立 spend 路径。）
3. 🔴 **两两穷举 ≠ 全穷举**：需要 ≥3 支同时发生才触发的缝，**本表看不见**。
4. **约束可能根本不可 enforce**：重建任一时序格前先问 ——
   **这条约束在【它被 bake 的那一刻】，它引用的东西存在吗？**
5. **本表 = design-layer**。**script-layer 逐条对 `.sil` 核属 pre-code 门，尚未做。**
