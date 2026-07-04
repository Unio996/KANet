# bshard-settle-daemon 错误处理模块化设计（草稿，2026-07-04）

> Owner 定调：现有基础上改良，模块化，结构化。不是补丁，不是重写。
> 领域：J2（结算域）出草稿，NWT co-设计（今天审计最懂脆点），J1 配合（判定源），Bettor 协调+co-verify。
> 节奏：非 launch 阻塞（世界杯 ESPN 判定不走 UMA，①告警 +②防御补丁已兜住 7/5 上线）。不赶，做扎实。

## 0. 背景（今天的证据链）

今天从 Owner 一句"经常退化，机制不够强壮"出发，团队一路查实：

1. **#21/#48**：`settle_failed` 是永久终态——`selectRipeMarkets` 的 SQL 明确排除它，一旦进入，daemon 再也不会主动重新尝试，只能人工把状态改回 `verifying`。
2. **#48 三层 bug**：显示逻辑读错字段 → 假阴性判定"你输了" → 结算成功之后的收尾代码抛错，被外层重试包装器当整体失败，把刚写对的 `completed` 覆盖成 `settle_failed`。根因是 `_settleOneMarketAttempt` 内部的 catch 边界把**业务失败 / 瞬态故障 / 纯代码 bug**三类完全不同性质的异常，用同一套"重试 3 次不行就永久放弃"逻辑处理。
3. **NWT 系统审计**：逐行看完 `bshard-settle-daemon.mjs` 全部 catch 分支，确认这个"catch-all conflate"模式还有其它命中点（shadow ledger 裸调用、writeback 静默吞错），今天已修两处（①②防御补丁），但上游的分类问题没解决。
4. **tsmah/pz9l4/klsiw 活案例**：三个 Polymarket 镜像盘（比特币价格题）deadline 刚过 0.2 小时就被 UMA 返回 ABSTAIN，daemon 同一 tick 内重试 3 次不行就秒级标记 `settle_failed`——但 UMA 的 optimistic oracle **本来就需要几小时到几天**才能 finalize（Polymarket 标准流程：propose + bond → 2 小时 dispute window → 无人挑战则 finalize；若被 dispute，升级到 DVM 投票，可能再要 48-96 小时）。0.2 小时的 ABSTAIN 是完全正常的"还没来得及判"，不是"判不了"。

**核心诊断**：当前系统把三种性质不同的失败——①我们自己的代码 bug、②暂时性基础设施故障（RPC 抖动）、③外部预言机（UMA）尚未完成裁决——全部塞进同一个"重试 3 次→ 永久 settle_failed"的桶里，靠人工事后翻查/重置。今天①（告警）②（防御补丁）已经把"静默卡死"变成"可见+可手动纠正"，但**没有从根本上让系统自己分辨这三类失败该怎么对待**。

## 1. 设计目标

- **不重写，改良现有结构**：`_settleOneMarketAttempt` / `computeSettlePlan` / `settleMarketLive` 的核心结算逻辑（今天验证过，proven）保持不动；只重构"失败之后怎么处置"这一层。
- **失败分类，各走各的路**（模块①）：同一个 catch 不再一视同仁。
- **UMA 耐心等待，不是绕过**（模块②，Owner 钦定方向）：UMA-pending 的盘持续 re-judge 直到真正 finalize 或真正超时，不是秒级放弃，也不是用 CoinGecko 之类的替代源抢跑（那是"绕过 UMA"，Owner 已否决——UMA 是 Polymarket 镜像盘的权威裁决源，不能自行判定后可能跟官方分道扬镳）。
- **可验证**：每一类失败的处置路径都要有对应的 regression test（复用 test-framework 现有结构）。

## 2. 模块① — 失败分类器（Failure Classifier）

### 2.1 三类失败的定义

| 类型 | 定义 | 例子（今天撞过的） | 该怎么处置 |
|---|---|---|---|
| **A. 代码 bug** | 我们自己的代码逻辑错误（变量未定义、类型错误、空指针等）——这类错误**不该存在**，出现就是需要立刻修的 bug，不是"结算失败" | `market is not defined`（#48，重构抽取函数时漏了变量作用域） | **绝不吞成 settle_failed**。记录完整 stack trace + 告警（比现有 settle_failed 告警更高优先级），**保留原状态不变**（比如还是 `verifying`，不误标失败，因为压根不是这个市场的结算出了问题，是我们代码坏了）。人工修代码后，市场自然会在下次 tick 正常重试。 |
| **B. 瞬态基础设施故障** | RPC 超时、网络抖动、UTXO 暂时未同步等——这类问题**过一会儿自己会好**，跟这个市场本身没关系 | `UTXO not found`、`ECONNREFUSED`、`no working Kaspa RPC` | 现有 G5-5a 同 tick 内退避重试（2s/4s/8s，3 次）**保留不变**——这层已经证明有效。3 次都不行，**不标记永久 settle_failed**，而是保留在 `verifying`（下个 tick 会自然重新扫到，不需要人工介入）。 |
| **C. 业务判定未完成** | 判定源（UMA/ESPN 等）明确返回"还没有结果"，不是错误，是**外部世界还没到那个时间点** | `UMA judge ABSTAIN`（tsmah 这类，UMA optimistic oracle 还在 liveness/dispute 窗口内） | 走模块②的 UMA re-judge 调度器（见下）。 |

### 2.2 分类判定逻辑（草案，待 NWT/J1 补充边界情况）

分类点在 `_settleOneMarketAttempt` 的顶层 try/catch（目前的 G5-5a 位置），改成：

```js
// 伪代码，非最终实现
try {
  // ... 现有 computeSettlePlan / consolidateAndBuildPsState / settleMarketLive / writeback 全部不动 ...
} catch (e) {
  const classification = classifyFailure(e, market);
  switch (classification.type) {
    case 'CODE_BUG':
      alertHighPriority(marketId, e); // 比 settle_failed 告警更醒目, 需要人立刻看
      return { ok: false, reason: 'code_bug', keepStatus: true }; // 不改 protocol_status
    case 'TRANSIENT':
      // 现有 G5-5a 重试逻辑处理过了；这里是重试耗尽后的兜底
      return { ok: false, reason: 'transient_exhausted', keepStatus: true }; // 留 verifying, 下 tick 自然重扫
    case 'BUSINESS_PENDING': // 目前只有 UMA ABSTAIN 这一种
      return await scheduleUmaRejudge(marketId, e); // 见模块②
    default:
      // 分类不出来的兜底——保守起见当代码bug处理(告警+不动状态), 不静默吞
      alertHighPriority(marketId, e);
      return { ok: false, reason: 'unclassified', keepStatus: true };
  }
}
```

`classifyFailure(e, market)` 的判定依据（初稿，需要红队审）：
- 错误信息匹配 `/is not defined|is not a function|Cannot read propert/i` → `CODE_BUG`（JS 运行时错误的典型特征）。
- 错误信息匹配现有 G5-5a 的 `TRANSIENT_RE` 正则（UTXO not found / fetch failed / ECONNREFUSED 等）→ `TRANSIENT`。
- 错误信息匹配 `/UMA judge ABSTAIN|judge ABSTAIN/` **且** `market.outcome_market_source === 'polymarket'` → `BUSINESS_PENDING`（UMA 专属，ESPN 的 ABSTAIN 目前没有慢速裁决场景，正常判不出就是判不出，仍走 #47 人工评估退款路，不进 re-judge 调度器）。
- 其它 → 保守当 `CODE_BUG`（fail-safe：宁可多告警，不可误判成"业务正常等待"而实际是代码坏了）。

**⚠ 待红队审的开放问题**：
1. `TRANSIENT` 重试耗尽后"留 verifying 不标记"——会不会导致这个市场被**每个 tick 反复重新尝试**（如果 RPC 长期挂，daemon 会一直重复扫到它、重复失败），浪费资源？需要一个"重试次数跨 tick 累加"的软上限（比如连续 20 个 tick 都失败 → 才升级成真正告警，但仍不是 settle_failed，是新增一个 `stuck_transient` 状态给人看）。
2. "分类不出来当代码 bug"这个 fail-safe 会不会太保守，导致某些其实是正常业务失败的场景被过度告警？需要看实际运行数据调整。

## 3. 模块② — UMA Re-judge 调度器

### 3.1 核心行为

UMA-pending 的市场（`outcome_market_source==='polymarket'` 且最近一次 judge 返回 ABSTAIN）：
- **不进 `settle_failed`**，进一个新状态 `uma_pending`（或复用 `verifying` 加 metadata 标记，具体哪个更好待定，见开放问题）。
- daemon 按退避间隔重新尝试判定，直到：
  - UMA finalize（`res.final === 'YES'|'NO'`）→ 正常走现有结算流程，完全复用 `settleMarketLive`。
  - 或者超过 **genuine-timeout 门槛** → 判定"真的长期无解"，转 `settle_failed`（这时候才是 #47 手动退款 runbook 该介入的场景）。

### 3.2 退避间隔设计（草案，基于 UMA 实际协议参数）

查证：Polymarket 标准流程 = propose（带 bond）→ **2 小时** dispute window（无人挑战则 finalize）；若被 dispute → 升级 DVM 投票，可能再要 **48-96 小时**。

草案退避表（待 NWT/J1 review，数字不是拍脑袋，基于上面查的真实 UMA 参数）：

| deadline 过去的时间 | re-judge 间隔 |
|---|---|
| 0 - 2 小时 | 每 15 分钟（覆盖最常见的"无 dispute，2 小时内 finalize"这条路） |
| 2 - 6 小时 | 每 30 分钟（可能刚好卡在 propose 边缘或短暂 dispute） |
| 6 - 96 小时 | 每 2 小时（覆盖 DVM 投票升级场景，最长约 4 天） |
| > 96 小时 | **genuine-timeout**，转 `settle_failed`，走 #47 人工评估 |

`96 小时` 这个 genuine-timeout 数字直接来自 UMA 协议本身的 DVM 投票周期上限，不是我们编的——理论上 96 小时之后 UMA 自己都应该有结果了，超过这个还 ABSTAIN，大概率是真正的异常情况（比如市场从未被人 propose 结果、或 conditionId 本身有问题），值得转人工。

### 3.3 跟 #47 的关系

模块②的 genuine-timeout 触发后，market 转 `settle_failed`，**这时候，也只有这时候**，才是 `docs/2026-07-04-abstain-refund-manual-runbook.md` 该介入的场景——runbook 里"确认真永久判不了"这条前置检查，现在有了明确的机器判据（等过 genuine-timeout 门槛），不再是纯靠人工估摸。

## 4. 接口/边界（供 review）

- `classifyFailure(error, market) → { type: 'CODE_BUG'|'TRANSIENT'|'BUSINESS_PENDING'|'UNCLASSIFIED', detail }` — 纯函数，无副作用，可单独单测。
- `scheduleUmaRejudge(marketId, abstainReason) → { ok, action: 'scheduled'|'timeout_exceeded' }` — 读/写一个新表或 `pool_markets.metadata` 字段记录"第一次 ABSTAIN 的时间戳 + 已重试次数"，用于计算退避间隔和 genuine-timeout。
- 现有 `computeSettlePlan` / `settleMarketLive` / `cancelMarketLive`（#47）**零改动**，模块①②只影响它们**外层的调度和失败处置**。

## 5. 开放问题（等 NWT/J1/Bettor review）

1. `uma_pending` 是新状态还是复用 `verifying` + metadata 标记？新状态需要改 `selectRipeMarkets` 的 SQL（排除/包含逻辑要重新设计），复用 `verifying` 更小改动但语义不够清晰（跟"还没到 deadline 的正常等待"混在一起，需要在 metadata 里区分）。倾向复用 `verifying` + `metadata.uma_pending_since` 时间戳，最小改动，但要确认 `selectRipeMarkets` 不会因为退避间隔没到就浪费重试（需要在 SQL 或扫描逻辑里加时间判断，别每 60 秒 tick 都重新尝试 UMA，浪费 RPC 调用）。
2. 模块①的 `CODE_BUG` 告警渠道跟现有 `settle_failed` 告警（KANet-UI 今天建的）是同一个 events 表 + 频道通知，还是需要更高优先级的独立通道？建议同表不同 `event_type`，复用现有 alerting 基础设施。
3. TRANSIENT 长期失败（开放问题①提到的"重试耗尽但不标记，会不会一直被重扫浪费资源"）需要一个软上限设计，具体阈值待定。
4. 这份设计目前只覆盖 `bshard-settle-daemon.mjs`（v0.7 bshard 结算路径）。`pool-market-settler.js`（v0.6 老系统）是否需要同款改良？范围待定，倾向不动（v0.6 是遗留系统，非本轮重点）。

---

*本设计草稿覆盖 Owner 2026-07-04"现有基础改良/模块化/结构化"定调。J2 主笔，NWT/J1/Bettor review 后再实现，不赶。*
