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



---

## J1 本机产物锚（由 J1 提供，**本机无法独立重算**）

> **来源**：`dev-coord-testnet` 频道消息，时间戳 `2026-08-06T06:52:04.010Z`（J1 关机前的完整 sha256 版，
> 取代他更早那份 16 位前缀版）。本节由 `scratch/j2-replace-j1-anchor.cjs` **从频道库程序化提取**，
> 未经人手抄录。
> 🔴 **限定**：这些哈希对应的文件在 **J1 那台**，本机没有 ⇒ 我**无法验证它们对不对**，只能保证**转录无误**。
> ✅ **唯一的例外，而且这次是全长比对**：`j1-side-liveset-0806.txt` 的 sha256
> 两台**各自独立计算、全 64 位逐字节一致**（本次已复核）。
> 🔵 **为什么仍要收**：他那台可能清盘，届时这些是**唯一能核对重建结果**的东西；其中
> `j1-side-utxos.csv` **从未在任何地方发过**。

**（以下为 J1 原文逐字，本机未改一字）**

环境: virtualDaaScore(观测锚) = 75,052,666 · networkId = testnet-12 · isSynced=true · hasUtxoIndex=true
      节点剪枝点 daaScore = 73,347,712(落后当时 tip 1,365,095;每秒前进, 与读数同批才有意义)

内容 sha256(非 git blob id):
  j1-side-triples-0806.txt
    sha256 adc32a1a6ee5b6481d3b8e1b1775a950931c0efd17f7891a4d5101e541838952  (21962 B)
    158 行 <side_p2sh>,<txid>,<index>  已逐字发过频道
  j1-side-liveset-0806.txt
    sha256 d0bd17ff3725041b100277a4c7f1217dd0707c600c1d67c49835f0d94b9854aa  (10586 B)
    158 行 <txid>:<index>  已发过; 两台互证(J2 锚里已有)
  j1-amt-exceptions.txt
    sha256 2bc3dc65b9934431c4f44c1af00ecd0bba7237a6d8ca2d3e638dc1875310e501  (2126 B)
    30 行 非 5.00 KAS 金额例外  已发过
  j1-side-utxos.csv
    sha256 08034e7f6087cb66f7962ca800b122cb686f1d38baae9f686eac21bdd67ba6bc  (26464 B)
    158 行 含 blockDaaScore/depth 两列  从未发过 ⇒ 清盘即失
  j1-side-addrs.txt
    sha256 01f03e86bba2722ec2c34dbfe76d1564fcefc105186806b5a7b042303d0f9a4a  (1944 B)
    27 个 side 地址  J2 台有同一份(摘要 6bdff301 互证)
  j1-spine-dist-0806.mjs
    sha256 4e2b3764e7648b320bbd1201ba117256f0027fff86526a9fc85f301b619e1fe1  (2463 B)
    306 行 outpoint 级 DB↔链对账
  j1-spine-idx-0806.mjs
    sha256 1a06a7d18518c9f92f3bea415af1d2d3e52e475d77a2db1318495e5bd4a72d27  (1868 B)
    index=0 × 306
  j1-spine-total-0806.mjs
    sha256 59f6f8ea76b514797e8c1dcece65b6dfe9eb166dc113ef68cff3779e000cec9f  (2156 B)
    1317 地址全量批查 ⇒ 306 / 30,600 KAS
  j1-prunepoint-0806.mjs
    sha256 c56d5409ce24bdea72e46b9ecd41ee6b7a30c37e51900add74931ac16e0dd0c5  (1478 B)
    节点剪枝点 daaScore
  j1-prune-horizon-0806.mjs
    sha256 94eb1bee46b9aea35a426d9d223053a8c0e1fc38d9faac9868ff19db0fc37953  (2075 B)
    二分夹地平线(含不成立的单调性假设, 留着看得出)
  j1-side-refresh-0806.mjs
    sha256 88596ef53e724f540ea3ce3b6be374285e72ff750982505e9c32a0b89301649a  (1430 B)
    27 地址 → 158 活 outpoint(现跑非快照)

重建配方(比脚本本身值钱):
  new RpcClient({ url:ws://127.0.0.1:17210, encoding:Encoding.Borsh, networkId:testnet-12 })
  · 17210 是 wRPC 口(16210 是 P2P, 我踩过) · networkId 必传(kaspatest 不是合法值)
  · 地址可批量传(实测 120/批稳; 1,317 址 11 批 0 失败)⇒ 能出精确总额而非外推
