# NWT 正式 re-audit — 退款出路 E1(v0.3)

> 作者 NWT · 2026-08-26 · 被审 = `docs/2026-08-26-j2-refund-deadlock-exit-design.md` **`7a3540ad`**(v0.3)
> 前序:v0.1 NWT `235c6187` = PASS-WITH-MUST-FIX(①承重 + ②③④)。本文核 v0.2/v0.3 是否把全部 MUST-FIX + 两问 + 三 env 审点落齐。

## 1. 独立全读者枚举复核(不核 J2 的表, 自建表对打)
`grep -rn refund_authorization kasia-console/src`(全仓, 我独立跑)分类,与 J2 §7.1(c) 16 处表**逐格收敛**:
- **决策读者恰两处**:R① `refund-authorization.mjs:91`(P1 谓词 allow/deny)、R② `settler:493`(legacy tick 选择键=自动签广播)。
- **计数一处**:L `settler:383-384`(backlog,只数不动钱)。
- **写两处**:W-A `dispatchRefund:2740-2745`(读入参非 metadata)、W-B `authorizeRefundByOwner:322-324`。其余注释/文案/常量。
- ✅ **无第四决策读者**(独立 grep 坐实,与 J2 表一致)。
- ✅ **R① 三调用点全收敛同一谓词**(我实读):`assertBettorRefundAuthorized` 全仓仅两处调用 `claim-auto:75` 与 `pool.js:433`(经 `buildBettorRefundClaim`),而**手动端点 pool.js:4048 与 legacy tick:511 都走 buildBettorRefundClaim → :433** ⇒ 三条花钱路(claim-auto / 手动 / tick)全过 R①:91,无旁路。批次门放 R①:91 + R②:493 即三入口全覆盖。

## 2. MUST-FIX / 两问 / 三 env 审点逐条核(HEAD `7a3540ad`)
| 项 | v0.3 落点 | 核 |
|---|---|---|
| ① 授权=上膛(承重) | §7.1「授权字段是自动 tick 选择键,写它=上膛」+ §0/§3"状态不动/Owner按批"措辞收窄 | ✅ |
| ① 硬次序 | §7.1(a):buildBettorRefundClaim 前后 landed-verify(三入口共用同 helper,修 claim-auto:146/pool.js:518-540/tick:511)→ NWT diff + 1 side 实弹 → **然后**才允许写授权 | ✅ 硬次序 |
| ① Owner 按批真控制 | §7.1(b)ⅰ 独立批次门(非靠手写授权) | ✅ |
| 问1 批次门覆盖几处 | §7.1(b)ⅰ **三处**:R①:91 + R②:493 + L:383-384(计数拆「未授权」/「已授权不在当前批」两格) | ✅ 我定的三处(非两处)已采 |
| 问2 甲 禁缺省 | §7.1(d)甲:禁抄 `||1`(settler:496/507 模式),`if(!b\|\|b.trim()==='')⇒关`,代码无缺省 | ✅ |
| 问2 乙 空==空 fail-open | §7.1(d)乙:等值比较**之前**先 fail-closed on 空 env;SQL `? IS NOT NULL AND ? <> '' AND json_extract(f) IS NOT NULL AND json_extract(f)=?` | ✅ 正是我审点乙 |
| 问2 丙 持久化=永久上膛 | §7.1(d)丙:kanet.env 不许常驻,per-batch 瞬时(命令行前缀/放完删),batch-id 精确 | ✅ 正是我审点丙 |
| ② 单输入自保 | §7.2:pre-check 纵深+早筛,硬锁=同输入双花(side_lock_tx:0 单输入);关2 复核 `addFeeInput=false`(relay.mjs:881-903) | ✅ |
| ③ 上界含已领 | §7.3:广义候选=legacy tick 现集合,含 stale 已领(ko421),读数=上界不当笔数 | ✅ |
| ④ spine-已花 | §7.4:链核加 `landed(spine_p2sh, spine_lock_tx)=false` 按 outpoint,commingled 逐盘(3 spine 承载 46 盘) | ✅ |
| 落码序 + 验收臂 | §7.5 七步(前置未闭后步不动)+⑥放完清 env + 三验收臂(放行前 env 空⇒候选0/env=本批⇒仅本批/清后⇒候选0+grep 零) | ✅ |

## 3. E1 re-audit verdict
- **E1(`7a3540ad`)= 通过正式 re-audit, doc-layer GREEN。** 全部 ①②③④ + 两问(读者表/env fail-closed)+ 三 env 审点(甲乙丙)落齐;独立枚举坐实无第四决策读者、三调用点收敛同谓词。
- **GREEN 边界(同其它三稿)**:GREEN = 设计闭合,**≠ 执行授权**。执行受 §7.5 七步硬闸 + Owner 批 + 节点 UTXO 可用 + **跨节点 J1 DB 协调**(D-001 铁律 0.5:两把 pk 在 J1 侧,本机核不了,以 J1 报数为准)四重前置。
- **落码前实施轮 NWT 逐处核**:①三入口 landed-verify 同 helper + 输入单一性断言(关2 diff GREEN + 1 side 实弹)②批次门三处 fail-closed SQL(甲乙丙)③链核四臂含 spine-已花按 outpoint。**任一未闭,不写任何一盘授权。**
