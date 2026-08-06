# P1 证据链输入的哈希锚（2026-08-06）

> **Status**: CURRENT — 纯哈希与计数，**不含任何行级数据**（无地址 / 无 txid / 无金额 / 无 pk）。
> 由 `scratch/j2-gen-anchor-doc.cjs` **程序生成**，未经人手抄录。

## 为什么有这份文件

支撑 P1 那组数字（847.01 / 361.45 KAS）的两个输入文件都在 gitignored 的 `scratch/` 里，
**只存在于单台机器上**。频道里有结论，但没有底数。这份文件不解决"别人能不能复现"
（那要 Owner 定数据发布边界），它解决一个更窄但很实的问题：

> **将来任何人拿到一份 cohort CSV，可以一算就知道它是不是支撑这组数字的那一份。**

它挡住的是这一类错误：**重新导出一份、以为是同一批，其实时间窗已经变了**
（`p1_cohort_export.cjs` 用 `Date.now()` 判到期，Codex 逐字点过这一格）。

🔴 **一个抄错的锚比没有锚更坏** —— 它会让核对者得出"文件不一样"的假警报。
本文件生成当天就发生过一次：同一个 sha256 被手抄进频道消息时错了最后一位（`…041b` → `…0411`），
由另一台机器独立重算才发现。**故本文件由脚本直出，且校验方式写在下方。**

## 输入锚

| 文件 | 行数（含表头） | sha256（全文件） |
|---|---|---|
| `scratch/j2-cohort-rows.csv` | 126 | `a39db333b447cad82597fbe93d05ff5284a9538dd32d87aa50aa36522b8fc5f7` |
| `scratch/j1-158-received.txt` | 158 | `d0bd17ff3725041b100277a4c7f1217dd0707c600c1d67c49835f0d94b9854aa` |
| `scratch/j2-dryrun-classification.csv` | 126 | `e8083ed296d7bcd2e68c9d59b0d7fc684270ae2ee4a0b823baceae97e3c4d5d3` |

- **`j2-cohort-rows.csv`** — cohort 输入 — 125 个 bettor side 行(1 行表头)。由 p1_cohort_export.cjs 导出。
- **`j1-158-received.txt`** — 链读输入 — J1 对 27 个 side_p2sh 跑 getUtxosByAddresses 的结果, canonical outpoint 一行一条。
- **`j2-dryrun-classification.csv`** — 分类输出 — p1_classify_dryrun.cjs 的产物(含 1 行表头)。

## 环境锚

| 项 | 值 |
|---|---|
| source HEAD（生成时） | `74460eec61f6a0fa303b3a3f16f4b6f250f6d45f` |
| 分类器 git blob id | `e7957f695ed7dca40d940d6549397167150a329b` |
| 链读观测锚 | `virtualDaaScore = 75052666` |

🔴 **注意两种 sha 不要混**：上表"sha256（全文件）"是**内容哈希**；"git blob id"是 **git 对象 id**，
两者都是十六进制串但算法不同，不可互相比对。

## 跨机互证（同一天）

`j1-158-received.txt` 的 sha256 由 **两台机器各自独立计算**，结果一致 —— 这是文件在两台之间
未被改动的证据。另：两台各自算出的"27 个 side 地址排序后拼接"的 sha256 前 16 位同为
`6bdff301993a5fce`，证明两边用的是同一份地址清单。

## 怎么用

```bash
# 手上有一份 cohort CSV，想知道是不是这一份：
sha256sum <你的文件>          # 与上表比对；不等 = 不是同一批，上面那组数字不适用于它
```

🔴 **它证明"是不是同一份文件"，不证明"文件内容是对的"。** 后者依赖当时的链读与代码，见
`docs/iteration/COORD-LEDGER.md` 当日记录与 `p1_classify_dryrun.cjs` 的注释。
