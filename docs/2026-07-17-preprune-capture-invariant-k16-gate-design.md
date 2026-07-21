# 剪裁前捕获 Invariant + K-16 纳入 + 机器门禁 — 设计框架稿 v0.1

> **Status**: DESIGN v1.1 — NWT 设计审(dd6496b0)3 项 MUST-FIX + 发现A/B 全折入,待 NWT 复核 → 拆实现卡。
> **作者**: Bettor(架构师帽)· 2026-07-17 · 依据: Owner immediate 令(08:03Z"把这次事故正式纳入 K-16,并把'剪裁前捕获'变成机器门禁")+ j34vb 生存探针三重坐实(本地全网不可逆)。
> **v1.1 变更**: ①K-17 独立编号(查 K-01~K-16 目录定,precondition 型全独立有先例,非倾向);②finality 门(发现A,防 reorg 抢捕获写错值);③prune_survival 三态(点③,durable_index_backed 防误伤);④worker 存活监控复用 spc_tip_heartbeat(点④);⑤safety_margin 加积压方法论(点②);⑥并发写幂等 note(发现B)。
> **事故锚**: j34vb-s0 8 条 side_lock_daa NULL 越过剪裁点 60,357,590 物理不可逆(ledger ⑯)。

## 1. 事故一句话

`side_lock_daa`(money-path 关键链派生值,委员排除/canonicalBetOrder 依赖)在 8 条下注上丢失且**全网不可逆**——不是节点问题,是**捕获时机设计缺陷**撞上链的正常剪裁行为。

## 2. 根因(读码坐实,非推断)

- **捕获点 1(ingest)**: `trade-protocol-filter.js:1255` — 下注上链时,若 side_lock UTXO 仍在 mempool(尚无 accepting-block),取不到 daa → **存 NULL**(fail-loud 记 warn,不瞎猜)。这一步正确。
- **捕获点 2(lazy recapture)**: `bshard-close-transport.mjs:248` / `pool-market-settler.js:765` — 结算/enforce 时若仍 NULL 则 backward-walk 补齐。
- **缺陷**: 捕获点 2 是**按需触发**(结算才补),没有**独立于结算生命周期、在剪裁窗口内主动补齐**的机制。j34vb 盘 ingest-NULL 后,盘要几天后才到期结算,期间数据静静越过剪裁点;等结算触发 recapture 时,backward-walk 撞剪裁墙,永久丢失。
- **一句话**: money-path 关键值允许"ingest-time NULL + 结算时 lazy 恢复",而恢复所需的链数据有**剪裁寿命**,两个时间窗口没有被约束对齐 → 数据可用性故障。

## 3. 新 Invariant:K-17 Pre-Prune Capture(独立编号,查资产定,非倾向)

> **K-17 — Pre-Prune Capture**
> 任何 money-path 依赖的链派生值(accepting-block daa、block_time、block_hash 等),若其恢复依赖会被链剪裁的数据,则该值必须在一个**双边有效窗口**内完成本地持久化:**晚于** accepting-block 达到 finality depth(值已稳定、不会被 reorg 改写),**早于**对应数据进入剪裁窗口(数据还在、可读)。不得依赖剪裁窗口外的 lazy 恢复作为唯一捕获路径;也不得在 finality 前抢捕获(见 §5 finality 门,NWT 发现A)。

- **编号决策(NWT 点① 退回查资产, 已查 K-01~K-16 目录)**: 现有目录里 precondition 型 invariant(K-01/02/03/04 "No X, No Y" + K-09 Confirmed State Only)**全部是独立顶层编号**, 无"某条 K 下挂子款矩阵"的结构先例; K-16 是 containment 型(Fault Containment)。K-17=precondition 型("必须在剪裁前捕获"), 按目录既有惯例独立顶层编号成立; 引入"K-16 子款"反而是新造结构(违反继承优化)。**不违反 D-002 反增殖**: K-17 补的是现有 16 条无一覆盖的真实缺失约束(同 K-16 本身即 2026-07-15 completeness audit 新增), 非重复登记。
- 与 K-16(Fault Containment)关系: **剪裁是一种数据可用性故障**(链的正常、必然行为,非异常)。K-16 问"谁的故障感染谁";K-17 是**时间维度的 precondition**——"链数据的有限寿命"这个故障源,不得让 money-path 关键输入不可恢复。两者类型不同(containment vs precondition), 独立编号避免搅浑 K-16 读者"每行都是如何隔离故障"的预期。
- **K-16 故障注入矩阵仍新增一行**(K-17 独立不妨碍此): 注入="活跃 money-path 的关键链值持续 NULL 直到其恢复数据越过剪裁点";必须保持的能力="该值在 finality 后、剪裁前已被主动补齐,结算不依赖已剪裁数据"。这是 K-17 在 K-16 矩阵里的**故障场景登记**(一个 invariant 可以既独立成条、又在故障矩阵里有对应注入行,不是重复)。

## 4. 机器门禁(把 K-17 变成 merge/CI gate)

对齐现有 money-path manifest(073295ae)+ lint 首批(d35e707c):

1. **manifest 新增声明字段**: 每个 money-path 列出其依赖的 `chain_derived_values[]`,每个含 `{name, capture_point: ingest|lazy_recapture, prune_survival}`。
2. **`prune_survival` 三态(NWT 点③ 防误伤 durable index)**:
   - `guaranteed_before_prune` — 有主动补齐 worker(§5)在剪裁前捕获保证;
   - `durable_index_backed` — 恢复源本身**不受剪裁**(如 spc_daa_index 51a6494d 持久 daa→block 索引),lazy 读它已经安全,不需要额外 worker;
   - `none` — 真正裸露(现场 backward-walk 剪裁敏感链状态,无保证),该拦。
3. **lint 规则 R-PREPRUNE-CAPTURE**: 若某 chain_derived_value 的 `capture_point=lazy_recapture` 且 `prune_survival=none` → **block merge**(side_lock_daa 当前状态正是 none,会被拦;读 spc_daa_index 的合法路径标 durable_index_backed 放行,不误伤)。
4. **运行期证据**: manifest 声明的"剪裁前补齐 worker"必须真实存在、被 required_tests 覆盖、**且其存活心跳被独立监控**(§5,呼应 K-10"声明的 worker 不存在=拒")。

## 5. 主动补齐 worker(实现接口,J2/settler 域细化;NWT 三 MUST-FIX 已折入)

- **职责**: 常驻扫描所有活跃盘 `side_lock_daa IS NULL` 的行,在**双边窗口内**主动 recapture 补齐(晚于 finality、早于剪裁)。
- **🔴 finality 门(NWT 发现A, MUST-FIX)**: worker 捕获前**必须确认 accepting-block 已过 finality depth**(复用 `DEFAULT_FINALITY_DEPTH=50`)。未过 finality 的行**本轮不捕获**、等下一 tick 再看——在 finality 前抢写的 daa 可能被 reorg 改写,**错误值比 NULL 更危险**(NULL 诚实说"不知道",错值带假自信进 money-path 判定)。这与 J1 今天给 spc_daa_index 补的同一防线(51a6494d)一致,原样复用,非可选。配 [[reference-landed-shallow-confirm-reorg-phantom-leaf]]。
- **🔴 剪裁前阈值 + 积压方法论(NWT 点②, MUST-FIX)**: 触发阈值 `tip_daa - pruning_depth + safety_margin`。safety_margin **不能只按单行时延**(worker tick + walk 耗时)估——必须覆盖**最坏积压**: worker 自身宕机 N 小时后复活,面对几十条都逼近剪裁边界的 NULL 行,受限吞吐(每 tick 能 walk 几条 / RPC rate limit)下,队列尾部能否在剩余窗口内清完。方法论 = `max(单行时延, 最坏宕机时长 × 积压速率 ÷ worker 吞吐)`,宁大勿小。
- **🔴 存活监控(NWT 点④+K-16 递归, MUST-FIX)**: worker 存活**必须独立监控,不靠 worker 自报活**(那是同一单点)。**直接复用今天已验证的 `spc_tip_heartbeat` 模式**(v187/51a6494d,60s 心跳+巡检),不另造。**实证依据**: 今天 console-supervisor 静默死近 25h 无人发现——若新 worker 又是"正常时管用、死了没人知道",这份设计就是同一个病(lazy 保护悄悄失效)的复发而非根治。心跳断=告警,不是等下次事故才发现。
- **与 J1 spc_daa_index(51a6494d)关系**: 那是 daa→block 持久索引(recapture 的恢复源,§4 `durable_index_backed` 指它),本 worker 是**主动触发者**——有索引 ≠ 有人在剪裁前触发补齐,互补不重复。
- **fail-loud(两类)**: ①某 NULL 行数据已越剪裁点(补不回)→ 告警+标"不可恢复"终态供替代结算识别;②worker 自身心跳断→独立监控告警(见上)。
- **并发写(NWT 发现B, 观察项)**: 本 worker 与结算时 lazy-recapture(pool-market-settler.js:765)都写 `side_lock_daa IS NULL` 行。实现卡须显式确认: `UPDATE ... WHERE side_lock_daa IS NULL` 天然幂等(先写者赢,后写者 WHERE 落空 no-op),不产生冲突——留一行 note 焊死,不留"两条写路径没人明说会不会撞"的空白。

## 6. j34vb 存量(已丢失,替代结算)

8 条已不可逆,不在本门禁范围(门禁防未来)。替代结算路径(不依赖 side_lock_daa 的判定)= **J2 settler 域设计件**,本稿只定接口: 替代路径须能从 §5 worker 标记的"不可恢复"终态识别这些行,并给出一个**不依赖 side_lock_daa <= deadline_daa 委员排除**的可结算判定(或按豁免先例收口,规模 395KAS/2bettor,身份内外待查同 fy1yk 方法论)。

## 7. DoD + 派工

| 件 | owner | 前置 |
|---|---|---|
| K-17 文本 + K-16 故障注入矩阵新增行 | Bettor 出稿 → NWT 红队审 | 本稿 GREEN |
| R-PREPRUNE-CAPTURE lint + manifest 字段 | KANet-UI(manifest 域)| K-17 定稿 |
| 剪裁前补齐 worker | J2(settler 域)| K-17 定稿 + spc_daa_index 依赖确认 |
| j34vb 替代结算 | J2(settler 域)| worker 的"不可恢复"终态标记接口定 |

**共同 DoD**(承 Economic Kernel §12): canonical 规则/manifest 存在 + 真实现状样本(j34vb 就是) + 负样本(构造 ingest-NULL 未剪裁场景验 worker 补齐) + 独立验证 + CI/测试入口 + fail-loud + COORD-LEDGER 回写。

## 8. NWT 设计审(dd6496b0)折入记录

| NWT 项 | 处置 | 落点 |
|---|---|---|
| 点①K-17 编号(退回查资产) | 查 K-01~K-16 目录: precondition 型(K-01/02/03/04/09)全独立顶层编号有先例, 无子款结构; K-17 独立成立(非倾向) | §3 |
| 点② safety_margin 漏积压 | 加最坏宕机积压方法论(非只单行时延) | §5 |
| 点③ prune_survival 误伤 durable index | 二态→三态(加 durable_index_backed) | §4 |
| 点④ worker 存活监控(今 supervisor 死 25h 实证) | 复用 spc_tip_heartbeat 独立监控, 不自报活不另造 | §5 |
| 发现A(严重)finality 抢捕获写错值 | finality 门(DEFAULT_FINALITY_DEPTH=50), 未过不捕获 | §3 invariant 双边窗口 + §5 |
| 发现B 并发写 | 幂等 UPDATE...WHERE IS NULL 焊 note | §5 |

**全部 MUST-FIX + 发现折入 v1.1, 回 NWT 复核。** 复核 GREEN 后拆实现卡(§7 表)。

## 9. K-17 正式 invariant 文本 + K-16 矩阵行(草案·待 NWT 复核 GREEN 后逐字搬入 `docs/2026-07-15-KANet-Economic-Kernel-v0.1.md`)

> 照 K-16 既有格式(invariant 陈述 + "验收=故障注入"bullet, 非新造结构)。Bettor 静默期自推进(11:2xZ), 不依赖复核先起草, 复核推翻则据 verdict 改。**在复核 GREEN 前不落入宪法正文**。

### K-17 — Pre-Prune Capture

任何 money-path 依赖的链派生值(accepting-block DAA、block_time、block_hash 等), 若其恢复依赖会被链剪裁的数据, 必须在一个**双边有效窗口**内完成本地持久化: **晚于** accepting-block 达到 finality depth(值已稳定、不会被 reorg 改写), **早于**对应数据进入剪裁窗口(数据仍可读)。不得以剪裁窗口外的 lazy 恢复作为唯一捕获路径; 也不得在 finality 前抢捕获——未过 finality 的值可能被 reorg 改写, 错误值比 NULL 更危险(NULL 诚实说"不知道", 错值带假自信进 money-path 判定)。

**验收 = 故障注入**:
- 活跃 money-path 关键链值持续 NULL 直到其恢复数据越过剪裁点 → 该值在 finality 后、剪裁前已被主动补齐, 结算不依赖已剪裁数据;
- 补齐 worker 停摆 N 小时后复活 → 积压队列在剩余窗口内清完(safety_margin 覆盖最坏宕机, 非只单行时延);
- worker 遇 accepting-block 未过 finality depth 的行 → 本轮不捕获、下一 tick 再看(不抢写可能被 reorg 的值);
- 补齐 worker 心跳中断 → 独立监控告警(不靠 worker 自报活, 复用 spc_tip_heartbeat 模式)。

### K-16 故障注入矩阵新增行(K-17 在 K-16 里的故障场景登记, 与 K-17 独立成条不冲突)

在 K-16"验收=故障注入"清单**追加一条**:
- **链数据剪裁致关键值不可恢复**: 活跃 money-path 的链派生关键值(如 side_lock_daa)持续 NULL 直到恢复数据越剪裁点 → 必须保持: 该值在 finality 后剪裁前已被主动补齐, 结算路径不依赖已被物理剪裁的链数据。

> 编号依据(§3 已述): K-01/02/03/04/09 precondition 型全独立顶层编号有先例, K-17 独立成立; K-16 追加故障行是同一 invariant 在故障矩阵的登记(一条 invariant 既独立成条又在 K-16 矩阵有对应注入行, 非重复)。
