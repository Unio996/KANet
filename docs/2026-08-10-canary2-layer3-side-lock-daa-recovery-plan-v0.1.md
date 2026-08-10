# canary#2 第三层 · `side_lock_daa` 缺口可恢复性探测 + 恢复计划 v0.1【DESIGN-ONLY · 待裁 · 未执行】

> **Status**: CURRENT
> **作者**: J2 · 2026-08-10 14:2xZ
> **上游**: `docs/2026-08-10-canary2-j34vb-settlement-execution-plan-v0.1.md`(前两层已拆,执行记录在该文件)
> **本文件此刻是【计划】。一个命令都没跑。**

---

## §0 执行纪律(沿用 canary#2 那四条,逐字)

1. 每步执行前贴出「我即将跑的确切命令」,执行后贴**原始输出**。
2. 任何一步读数与本计划不符 ⇒ **立即停、报 Bettor**,不自行判断「应该是等价的」。
3. 广播/写类动作先 dry-run / 先只读,再实做。
4. **NO TX NO STATE CHANGE**。

---

## §1 这一层是什么(2026-08-10 14:12:07 实测暴露)

前两层拆掉之后,`zkJudgeProposeAutonomousTick` 的失败换成了:
```
zkJudgeProposeTick_propose market=93-j34vb:
  committee-exclude: bettor 4173a91cef 无 side_lock_daa (fail-loud 防 cross-node fork, 镜像 sample L359-361)
```
**现查缺口**:
```
j34vb 总 side 行 10 · side_lock_daa NULL = 8 · 有值 = 2
  bettor 4173a91cef : 7 行(5 NULL + 2 有值: daa 59,950,126 / 60,244,919)  ← 报错点名的
  bettor 81101a7142 : 3 行(全 NULL)
```
🔴 **与 25 天前 COORD-LEDGER `:57` 记的「8/10 NULL」逐字相同** ⇒ **这 25 天 recapture 零进展**,与当时「7 个 walk 余量不够」一致。**不是没人试,是试了拿不回来。**

**候选修法**: `recaptureSideLockDaaForMarket`(`pool-market-settler-v06.mjs:420-442`)——
对每个 NULL 行调 `captureSideLockDaa`,拿到值就 `UPDATE … AND side_lock_daa IS NULL`(**CAS,不覆盖已有值**)。
其成败取决于 `:436` 的 `approxDaaHint = deadline_daa` 能否命中 **v183 `spc_daa_index`**(`:428-430` 注释:命中则几十步内找到,不用从 tip 硬走)。
🔵 ⇒ **与 `getBlockAtDaa` 设计 v0.3(`69ce2b9e`,NWT 终审 GREEN,等 Owner GO)是同一格** —— 第三层大概率是它的第一个真实用户。

---

## 🔴 §2 为什么现在不能测(时机本身是设计的一部分)

环境里 wasm **每 60 秒**被 `mining-utxo-consolidate.mjs` 的 cron 重新毒化(@KANet-UI 14:12 钉死路径)。
⇒ **此刻探到「找不到」,分不清是【链上真的走不回去】还是【wasm 又 trap 了】。**
⇒ 那会产出一个**看起来确定、实际被污染的阴性结论** —— 而阴性结论最难推翻:**它会让人把一条还活着的路判死。**
**⇒ 本计划的 S-A 必须在【重启窗#2 之后 + cron 止血生效之后】才跑。**

---

## §3 S-A · 可恢复性只读探针 —— **核心不是探针,是它的阳性对照**

🔴 **单探一个 NULL 行是【没有信息量】的**:探不到既可能是数据真丢,也可能是机器坏了/参数喂错。
✅ **本市场自带一个走同一条路径的阳性对照**:那 **2 行已有 `side_lock_daa` 的记录**(daa 59,950,126 / 60,244,919,同市场、同 bettor `4173a91cef`、同函数、同 hint)。

| 臂 | 输入 | 期望 | 若不符 |
|---|---|---|---|
| **阳性对照** | 已有值的那 2 行之一(`side_lock_tx=ae6a7a04…` 或 `afbaaf62…`) | **探针应重新找回一个 DAA,且 == 库里已存的值** | 🔴 **探不到 ⇒ 机器/环境/参数有问题,不是数据丢** ⇒ **停,不许对 NULL 行下任何结论** |
| **待测** | 8 个 NULL 行,逐个 | 找到 ⇒ 可恢复;找不到 ⇒ **仅在阳性对照通过的前提下**才算「这一行真丢」 | — |

🔨 **判据**: **阳性对照不过,整轮读数作废。** 这条写在前面,不是事后免责。
🔵 同族在册:对照臂必须走同一条路径;「没找到」与「没看完/机器坏了」读数相同。

**探针必须只读**: 只调 `captureSideLockDaa` 取返回值并打印,**不调 `recaptureSideLockDaaForMarket`**(后者会写)。
⚠ 落码时逐字确认 `captureSideLockDaa` 自身无写入 —— **我还没读它**,这是 S-A 落码前的前置。

---

## §4 S-B(仅当 S-A 判「可恢复」)· 执行 recapture

- 写操作,走**与 canary#2 同规格**:书面计划 → NWT 审 → Bettor 确认 → 执行,每步贴命令贴原始输出。
- 前态快照 → 执行 → 落值核实(**CAS 保证不覆盖那 2 个已有值**) → 观察下一个 propose tick 的错误是否再次变形态。
- 🔴 **停止条件**: 任何一行回填后 `side_lock_daa` 与探针读数不一致 ⇒ 停。

## §5 S-C(仅当 S-A 判「真丢」)· **不是技术修法,是钱路决策**

若阳性对照通过而 8 行仍探不到 ⇒ 这与 `kr5l4` 同族(leaf 真丢、缺高检出率历史源)。
🔴 **在册红线,写死**: **绝不照 shard-9 那个「标 `manual_recovery_refunded` 排除」的修法办** —— 那会把真实 bettor 排除出结算,是实实损失。
⇒ 归 Bettor 精炼后上报 Owner,**不由我处置**。

---

## §6 证据层级

| 陈述 | 层级 |
|---|---|
| 缺口 8/10 · 两个 bettor 的分布 | ✅ `[CONFIRMED·14:1xZ 现查]` |
| 25 天零进展 | ✅ `[CONFIRMED]` 现查 == ledger `:57` 记载 |
| `recapture*` 的 CAS 与 hint 机制 | ✅ `[CONFIRMED·现读 :420-442]` |
| `captureSideLockDaa` 是否纯只读 | 🔴 `[NOT-VERIFIED]` —— **S-A 落码前必须先读**,见 §3 末 |
| 这 8 行可不可恢复 | 🔴 `[NOT-ESTABLISHED]` —— **本计划就是去测它的**,现在没有答案 |
| 第三层修好就能结算 | 🔴 `[NOT-ESTABLISHED]` —— 前两层的经验:**每拆一层才看见下一层**。不预设第三层是最后一层。 |
