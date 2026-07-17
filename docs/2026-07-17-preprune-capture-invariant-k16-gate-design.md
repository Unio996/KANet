# 剪裁前捕获 Invariant + K-16 纳入 + 机器门禁 — 设计框架稿 v0.1

> **Status**: DESIGN — 待 NWT 红队设计审(架构师第一产出,红队过后拆实现卡)。
> **作者**: Bettor(架构师帽)· 2026-07-17 · 依据: Owner immediate 令(08:03Z"把这次事故正式纳入 K-16,并把'剪裁前捕获'变成机器门禁")+ j34vb 生存探针三重坐实(本地全网不可逆)。
> **事故锚**: j34vb-s0 8 条 side_lock_daa NULL 越过剪裁点 60,357,590 物理不可逆(ledger ⑯)。

## 1. 事故一句话

`side_lock_daa`(money-path 关键链派生值,委员排除/canonicalBetOrder 依赖)在 8 条下注上丢失且**全网不可逆**——不是节点问题,是**捕获时机设计缺陷**撞上链的正常剪裁行为。

## 2. 根因(读码坐实,非推断)

- **捕获点 1(ingest)**: `trade-protocol-filter.js:1255` — 下注上链时,若 side_lock UTXO 仍在 mempool(尚无 accepting-block),取不到 daa → **存 NULL**(fail-loud 记 warn,不瞎猜)。这一步正确。
- **捕获点 2(lazy recapture)**: `bshard-close-transport.mjs:248` / `pool-market-settler.js:765` — 结算/enforce 时若仍 NULL 则 backward-walk 补齐。
- **缺陷**: 捕获点 2 是**按需触发**(结算才补),没有**独立于结算生命周期、在剪裁窗口内主动补齐**的机制。j34vb 盘 ingest-NULL 后,盘要几天后才到期结算,期间数据静静越过剪裁点;等结算触发 recapture 时,backward-walk 撞剪裁墙,永久丢失。
- **一句话**: money-path 关键值允许"ingest-time NULL + 结算时 lazy 恢复",而恢复所需的链数据有**剪裁寿命**,两个时间窗口没有被约束对齐 → 数据可用性故障。

## 3. 新 Invariant:K-17 Pre-Prune Capture(建议编号,待 Owner/NWT 定)

> **K-17 — Pre-Prune Capture**
> 任何 money-path 依赖的链派生值(accepting-block daa、block_time、block_hash 等),若其恢复依赖会被链剪裁的数据,则该值必须在对应数据进入剪裁窗口**之前**完成本地持久化。不得依赖剪裁窗口外的 lazy 恢复作为唯一捕获路径。

- 与 K-16(Fault Containment)关系: **剪裁是一种数据可用性故障**(链的正常、必然行为,非异常)。K-16 问"谁的故障感染谁";K-17 是其在**时间维度**的特化——"链数据的有限寿命"这个故障源,不得让 money-path 关键输入不可恢复。
- K-16 故障注入矩阵**新增一行**: 注入="活跃 money-path 的关键链值持续 NULL 直到其恢复数据越过剪裁点";必须保持的能力="该值在剪裁前已被主动补齐,结算不依赖已剪裁数据"。

## 4. 机器门禁(把 K-17 变成 merge/CI gate)

对齐现有 money-path manifest(073295ae)+ lint 首批(d35e707c):

1. **manifest 新增声明字段**: 每个 money-path 列出其依赖的 `chain_derived_values[]`,每个含 `{name, capture_point: ingest|lazy_recapture, prune_survival: guaranteed_before_prune | none}`。
2. **lint 规则 R-PREPRUNE-CAPTURE**: 若某 chain_derived_value 的 `capture_point=lazy_recapture` 且 `prune_survival≠guaranteed_before_prune` → **block merge**(这正是 side_lock_daa 当前状态,会被这条规则拦住)。
3. **运行期证据**: manifest 声明的"剪裁前补齐 worker"必须真实存在且被 required_tests 覆盖(呼应 K-10 门禁"声明的 worker 不存在=拒")。

## 5. 主动补齐 worker(实现接口,J2/settler 域细化)

- **职责**: 常驻扫描所有活跃盘 `side_lock_daa IS NULL` 的行,在数据进入剪裁窗口前(阈值建议 `tip_daa - pruning_depth + safety_margin`,safety_margin 覆盖 worker tick 间隔+walk 耗时)主动 recapture 补齐。
- **与 J1 spc_daa_index 写入器(51a6494d)关系**: 那个是 daa→block 索引(让 recapture 能查),是**基础设施**;本 worker 是**主动触发者**——有索引不等于有人在剪裁前触发补齐,两者互补不重复(查资产核对: spc_daa_index 不含 NULL-side_lock 主动扫描)。
- **fail-loud**: worker 若发现某 NULL 行的数据**已越过剪裁点**(补不回)→ 立即告警+标记该行进"不可恢复"终态,不静默,供替代结算路径识别。

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

## 8. 待 NWT 红队设计审的点

- K-17 编号/措辞是否与既有 K-invariant 冲突;是否该并入 K-16 而非独立(我倾向独立:时间维度特化值得单列,但接受红队推翻)。
- safety_margin 取值方法论(worker tick + walk 耗时 + reorg 深度的上界,宁大勿小)。
- 门禁会不会误伤既有合法的 lazy 路径(存量 money-path 逐个过 manifest 时的迁移边界)。
- 主动补齐 worker 自身若故障(K-16 递归:补齐 worker 死了谁补)——是否需要 worker 的存活监控纳入 K-16。
