# 15 个 Stranded 盘退款路由设计（workstream A）

> **Status**: CURRENT（design，待 NWT 红队 + Bettor 审 + Owner 批钱路才能执行广播）

**Owner**: J2
**日期**: 2026-07-19
**授权范围**: Bettor 派工 workstream A（Gate0 收口后续，15 盘/67192.52KAS 确认 stranded 退款 scope）
**Source commit**: `506dd789`（本设计基于此 commit 读码，未改任何 live 代码/未广播任何 TX）

---

## 目标

给 Gate0 报告（`docs/2026-07-19-gate0-pruning-margin-blast-radius-report.md`）确认的 15 个 stranded 盘（`ojizv/aukqt/9ez2u/kr5l4/jepu1/vzhep/gzx6w/gic37/iftk7/dhxcp/kngkl/dwk36/5ybz4/j34vb/9jaty`，共 1679 笔押注/67192.52KAS）设计统一退款路由：每盘退给谁多少、按什么锚、守恒校验、幂等性——按 Bettor 原始派工要求。

## ✅ 前置依赖状态（2026-07-19 12:00Z Bettor 已拍板，非阻塞）

**背景**：今晚早前已完成、NWT+Bettor 均审 GREEN 的 `deriveRefundCommitteeSeed` 修复（commit `5a0b2772`，把退款路径的 committee-seed 派生从依赖 `endBlockHash`——对已剪裁的老盘物理不可达——改成只依赖 `marketId + poolMerkleRoot`）目前只存在于 `review/j2-refund-committee-seed` 分支，**尚未 merge 进 `bshard-m3-deploy`**（live 在跑的分支）。NWT 独立核实坐实：live 分支 grep `deriveRefundCommitteeSeed` 零命中。

**Bettor 决定（12:00Z）**：**不单独抢 merge**——铁律0：这是钱路码（`computeRefundPlan`），merge 进 live = 改变 live 分支钱路行为，需要 Owner 批，不是 Bettor 能单拍的事；而且退款执行本身还在 DESIGN 阶段（Owner 目前只批了"设计"，没批"执行"）。**代码本身已就绪、已审 GREEN，留在 review 分支，等这套完整退款路径（本设计）走完 设计→红队→Owner 批执行 那一刻，跟整条退款路径一起 merge 上 live**，不提前单独上。

**对本设计的影响**：**不阻塞设计工作本身**——本文档的设计内容基于 `review/j2-refund-committee-seed` 分支（含该修复）的代码状态撰写/验证。执行阶段（Owner 批准之后）需要先完成这次 merge，作为执行前置步骤之一，写入下方"批量执行方案"。

---

## 现有基础设施盘点（不重造，复用已建好的执行管线）

`computeRefundPlan` + `cancelMarketLive`（`bshard-auto-settler.mjs:643-815`）已经是一套**完整、成熟、已生产验证过**的退款执行管线（不是从零设计）：

1. **`computeRefundPlan(marketId, ctx)`**——纯计算，不碰链：
   - 取该盘全部 bet（`getMarketBets`，跨 shard 聚合）。
   - 退款叶子 = 每笔 bet 原样退自己的 stake（一 bet 一 leaf，不判赢家，人人都退）。
   - Committee VRF 选择（合并①修复后：`deriveRefundCommitteeSeed(marketId, poolMerkleRoot)`，锚点纯 `pool_merkle_root`，不依赖 `endBlockHash`/`deadline_daa`/`side_lock_daa`）。
   - 计算预期 cancelled-PayoutShard 地址（driver-side enforce 用，防误广播）。

2. **`cancelMarketLive(marketId, ctx)`**——编排执行（NO-TX-NO-STATE 全程守恒）：
   - build `bshard_cancel_attest` preimage → driver enforce 硬闸（`psContAddress` 必须等于预期地址，不等直接拒绝广播）。
   - 4-of-5 committee 逐个签名（`sign_input_for_settle`）。
   - assemble + `committee_pk_hash` 自核（防篡改）。
   - submit cancel_attest → **verify LANDED**（`verifyClosedLanded`，链上确认后才继续，不是广播了就当完成）。
   - 逐笔 `bshard_refund_claim` threading（每笔退款是链上一次 continuation-spend）：
     - climb proof 自核（merkle 证明验证失败 → 标记 error，不强行继续）。
     - P2PK round-trip 校验（`ctx.p2pkSpk` 反推地址必须匹配，防地址推导错）。
     - 提交 → **verify claim LANDED**（不 landed 立刻 STOP threading，不继续链式吐钱）。
     - 每笔成功后更新 `consolidated_pool -= amount` + merkle bitmap（`w0..w16` 位图标记该 leaf 已认领）+ continuation redeem script 重算，下一笔用新 redeem。
     - **splice mismatch 检测**：算出的新 continuation 地址如果跟 relay 返回的对不上，立刻 STOP（防状态分叉）。
   - 返回 `{ok, cancelTxid, claims, complete, needsManualAttribution}`——`complete=false` 时明确列出哪些笔未完成，不静默吞。

**这意味着本设计不需要"设计新机制"**，核心工作是：①推动前置阻塞项解决（merge fix）；②验证这套现成管线在 15 个具体盘上跑通没有边界问题；③补齐运维层（批量调度、进度追踪、Owner 批准流程）。

---

## 每盘退给谁多少（锚点/守恒）

- **锚点 = `pool_merkle_root`**（每盘建市时 ctor-baked 的字段，链上不可变，不依赖任何可能被剪裁的历史区块数据）——这正是 Bettor 原始要求"不依赖已剪的 endBlock/side_lock_daa"的落地方式,合并①修复后天然满足。
- **退多少 = 每笔 bet 的原始 `stake_amount`**（`pool_bettor_sides.stake_amount`，不含费用/不含利息，退本金）。**一 bet 一 leaf**：同一 bettor 多笔独立退，不合并（跟现有 `computePariMutuelPayout` winner-per-bet 惯例一致，不发明新规则）。
- **守恒**：`consolidated_pool` 每次 claim 后原样扣减 claim 金额，链上通过 continuation-spend 的 UTXO value 直接体现（value 算术是 covenant 强制的，不是应用层"声称"的）。全部 claim 完成后 `consolidated_pool` 应归零（or 剩maker bond/broker fee 等非 bettor 部分，视该盘费用结构而定——15 个盘全部是 stranded 且未曾走到判定阶段，理论上无 broker/oracle fee 已切分，退款范围应为纯 bettor 本金，需要**逐盘核对 `payout_shards.consolidated_pool` 是否等于 `Σ stake_amount`**，若不等需要先查清差额去向再退，不能假设简单相等）。

## 幂等性

- **`w0..w16` merkle bitmap**（`payout_shards` 的 covenant state 字段之一）逐位标记哪个 `merkle_index` 已认领——`cancelMarketLive` 每次调用从头跑 `claimData`（`refundClaimData(plan.refunds)`），但每笔 claim 前应该先检查该 `merkle_index` 对应位是否已置位（**当前读到的代码里，claim 循环没有显式"跳过已认领"的前置检查，是从 `curState`/`psOutTxid` 顺着链上当前 UTXO 状态往下走，理论上重跑会从"链上实际还没花的那个 continuation UTXO"位置继续，因为 `ps.outpointTxid`/`ps.index`/`ps.consolidated_pool` 是查询 `ctx.psState(marketId)` 得到的当前链上状态，不是本地缓存的旧状态**——这意味着重跑天然是"从中断点续跑"而非"从头重复"，是安全的，但**这一点需要 NWT 红队专门确认 `ctx.psState` 确实每次都查询链上最新状态而非本地过期快照**，不能想当然）。
- **cancel_attest 本身**：`cancelMarketLive` 一开始就走 `computeRefundPlan`→build→enforce→sign→submit→verify landed，若 cancel 已经 landed（该盘之前已经 cancel 过、只是 claim 没跑完），重跑时 `computeRefundPlan` 会重新算出同样的 `expectedCancelledAddr`（确定性 seed，同输入同输出），但**如果 `ctx.psState` 此时已经是 closed=2 状态而非 closed=0，重复 build cancel_attest 会不会出错，需要红队确认这条边界路径**（目前 15 个盘应该都还没走到过 cancel 步骤，这条边界理论上暂不触发，但设计上要写清楚，不能假装没有这个问题）。

## 批量执行方案（15 盘调度）

- **执行前置步骤 0**：merge `review/j2-refund-committee-seed`（`5a0b2772`）进 `bshard-m3-deploy`，与本设计一起走 Owner 钱路批准（不提前单独 merge，见上）。
- **不建议一次性并发跑 15 盘**——committee VRF 抽样、relay 签名请求、链上广播都有真实资源/带宽约束，且部分委员候选可能重叠（同一批 relay 被多个盘同时抽中会排队签名）。
- **建议**：按 Gate0 报告里的分类顺序（先处理已 direct-unreachable 确认的 4 个大额盘 `aukqt/kr5l4/9ez2u/ojizv`，覆盖 54758KAS 的绝大部分金额，再处理剩余 9 个 boundary-monotonic 小额盘 + j34vb/9jaty），**逐盘串行执行 `dryRun=true` 先跑一遍**（`cancelMarketLive` 已原生支持 `ctx.dryRun`，四闸判定+preimage构建全走完，在签名广播前停手，输出判定结果供人眼核对——不新造机制，复用现有 dry-run 惯例），确认每盘的 `plan.betCount`/`plan.refundRoot`/`plan.committee` 合理后，再逐盘正式执行 + 每盘执行后独立验证 `complete===true`。
- **每盘执行记录**：写入一张进度追踪表（可复用 `events` 表 + `event_type='refund_progress'`，不新建表），字段包含 `market_id/status/claims_complete/claims_total/cancel_txid/started_at/completed_at`，供中途查询/断点续跑参考。

## 未覆盖 / 待确认（诚实标注）

1. **前置阻塞项**（见上）——merge 决定权在 Bettor/Owner，本设计不能替代那个决定。
2. **`consolidated_pool` 是否恰好等于 Σ stake_amount**——需要逐盘查询 `payout_shards` 实际状态核对，本设计未逐盘跑这个核对（15 盘工作量较大，留给红队阶段或执行前最后一步统一核对）。
3. **`ctx.psState` 查询时效性**（幂等性依赖它查真实链上状态而非缓存）——需要 NWT 专门确认。
4. **重复 build cancel_attest 的边界情况**（该盘已 closed=2 时重跑会发生什么）——目前 15 盘理论上都还没触发，但设计上留白，需要红队看代码确认行为，不能假装没有这条边界。
5. 本设计**未评估** 15 个盘各自的 committee 候选（VRF 选出的 5 个签名节点）是否都在线/可用——执行前需要逐盘做一次 liveness check（跟今晚早前 kr5l4/aukqt 那次一样的流程），本设计只覆盖"路由怎么算"，不覆盖"执行时委员是否配合签名"这条运维前提。
