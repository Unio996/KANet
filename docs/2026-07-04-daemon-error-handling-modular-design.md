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

`classifyFailure(e, market)` 的判定依据（**Bettor + NWT review 后修订版**）：

**判定顺序（NWT 指出顺序敏感，显式写死，别在实现时随意调换）**：

1. **先查 `TRANSIENT`**：错误信息匹配现有 G5-5a 的 `TRANSIENT_RE` 常量（**直接 import 同一个常量，不重新定义等价的一份**——NWT 指出：分开维护两份"哪些算瞬态"的规则，以后各自改动会跑偏，一个说是瞬态一个说不是。单一 source of truth）。
2. **再查 `BUSINESS_PENDING`**：错误信息匹配 `/UMA judge ABSTAIN|judge ABSTAIN/` **且** `market.outcome_market_source === 'polymarket'` → `BUSINESS_PENDING`（UMA 专属。ESPN 的 ABSTAIN 目前没有慢速裁决场景，正常判不出就是判不出，仍走 #47 人工评估退款路，不进 re-judge 调度器）。
3. **再查 `CODE_BUG`**：**优先用结构化类型判定**（Bettor 指出：`e instanceof TypeError || e instanceof ReferenceError` ——JS 运行时错误的类型是确定的，比字符串正则稳，错误文案会变但 instanceof 不会）。字符串正则（`/is not defined|is not a function|Cannot read propert/i`）只作**次要信号**，用于 instanceof 判定不出来时的兜底（比如某些库把错误包装成普通 Error 对象而不是原生 TypeError/ReferenceError）。
4. **兜底 `UNCLASSIFIED`** → 保守当 `CODE_BUG` 同款处置（告警 + 不动状态）。

**为什么顺序是 TRANSIENT → BUSINESS_PENDING → CODE_BUG，不是反过来**（NWT 指出）：畸形 RPC 响应可能导致代码访问某个不存在的字段，抛出看起来像 `Cannot read property` 的错误——这本质是瞬态基础设施问题（RPC 返回不完整），不是我们代码坏了。如果先判 CODE_BUG 会错分类成"代码 bug"（结果只是多一次不必要的高优先级告警，不碰钱/状态，后果不严重，但会有噪音）。先查 TRANSIENT_RE 能把这类情况正确分流。

**⚠ 关键：外层调用方必须同步改造（NWT 抓到的接线缺口，这次不能再犯）**

`classifyFailure` 返回的 `keepStatus` 字段目前**只是伪代码里的意图表达**——现有 `settleDaemonTick`（`bshard-settle-daemon.mjs:340-369`）的外层调用逻辑（第 356-364 行）**完全不检查任何 keepStatus 字段**，`r.ok===false` 就无条件 `UPDATE protocol_status = 'settle_failed'`。如果只实现 `classifyFailure` 函数本身，不同步修改 `settleDaemonTick` 的调用点去读取并遵循 `keepStatus`，那么整个分类器算出来的判断会被现有逻辑直接无视——**这正是今天 #25（KI-49 同源模式）反复出现的"新字段/新逻辑加了但没有全链路接通"那类坑**。

**实现清单必须显式包含**：
- `_settleOneMarketAttempt` 内部改造（本设计 §2.2 的伪代码位置）。
- `settleDaemonTick` 第 357-360 行 **和** 第 362-364 行的 catch 块都要同步改：读 `r.keepStatus`（或者 `classifyFailure` 抛出的分类结果），为 true 则跳过 `UPDATE protocol_status`，只走告警路径。
- `settleOneMarket`（G5-5a 的外层重试包装器，如果它自己也有类似的无条件写 `settle_failed` 的逻辑）同样要检查。

**⚠ 待红队审的开放问题**：
1. `TRANSIENT` 重试耗尽后"留 verifying 不标记"——会不会导致这个市场被**每个 tick 反复重新尝试**（如果 RPC 长期挂，daemon 会一直重复扫到它、重复失败），浪费资源？**采纳 Bettor 方案**：加跨 tick 重试计数（存 `metadata.transient_retry_count`），超过软上限（比如连续 20 个 tick 都失败）→ 升级成新状态 `stuck_transient`（**不是 settle_failed**，仍会被 daemon 继续尝试自愈，只是告警级别提高让人知道"这个卡了挺久了"）。
2. "分类不出来当代码 bug"这个 fail-safe 会不会太保守？——**NWT 认可这个默认值选得对**：不管误判成哪一类，只要默认路径不改 `protocol_status`/不碰钱，出错代价就只是"多告警"，不会造成资金/状态风险。**实现时必须有对应测试用例**：一个"完全无法识别的错误类型"输入，验证 `classifyFailure` 的返回结果不会导致 `protocol_status` 被意外改写（锁住这个 fail-safe 属性）。

## 3. 模块② — UMA Re-judge 调度器

### 3.1 核心行为

UMA-pending 的市场（`outcome_market_source==='polymarket'` 且最近一次 judge 返回 ABSTAIN）：
- **不进 `settle_failed`**，复用 `verifying` + `metadata.uma_pending_since`（首次 ABSTAIN 时间戳）——最小改动（NWT/Bettor 背书）。
- daemon 按退避间隔重新尝试判定，直到：
  - UMA finalize（`res.final === 'YES'|'NO'`）→ 正常走现有结算流程，完全复用 `settleMarketLive`。
  - 或者超过 **genuine-timeout 门槛** → 判定"真的长期无解"，转 `settle_failed`（这时候才是 #47 手动退款 runbook 该介入的场景）。

**⚠ 关键（NWT 指出，跟 §2.2 的接线缺口同类）**：`selectRipeMarkets`（`bshard-settle-daemon.mjs` 现有函数）目前的 SQL 只按 `deadline_daa` 判断"该不该 settle"，**不知道退避表这回事**——如果不改，daemon 每 60 秒 tick 都会把 `uma_pending` 的市场重新选进来尝试判定，对着 UMA 狂打请求（0-2 小时那档设计意图是"每 15 分钟"而不是"每 60 秒"）。`selectRipeMarkets` 必须读 `metadata.uma_pending_since` + 当前退避表所在档位，计算"距离上次尝试是否已经过了对应的间隔"，没过就跳过这个市场（不进 `ripe` 列表）。

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

## 5. 开放问题状态（NWT + Bettor review 后，2026-07-04 v2 收敛）

**已收敛（不再是开放问题）**：
1. ~~`uma_pending` 新状态还是复用 `verifying`~~ → **复用 `verifying` + `metadata.uma_pending_since`**（NWT/Bettor 背书，最小改动）。**但 `selectRipeMarkets` 必须同步改**（见 §3.1 关键提示）——这条本身不再"开放"，但**实现清单必须包含它**，不能只改 `_settleOneMarketAttempt` 却漏了 `selectRipeMarkets` 的退避判断（跟 §2.2 的 keepStatus 接线缺口是同一类"新逻辑没全链路接通"的坑，两处都要显式列进实现清单）。
2. ~~TRANSIENT 长期失败的软上限~~ → **已采纳 Bettor 方案**：跨 tick 重试计数存 `metadata.transient_retry_count`，超过 N（初定 20，实现时可调）→ 升级 `stuck_transient` 告警（非 settle_failed，daemon 仍继续自愈尝试）。
3. ~~v0.6 老系统要不要同款改良~~ → **Bettor 背书不动**，非本轮范围。

**仍待定（实现时确认）**：
4. 模块①的 `CODE_BUG` 告警渠道跟现有 `settle_failed` 告警（KANet-UI 今天建的 `settle-failed-alert.mjs`）是同一个 events 表 + 频道通知，还是需要更高优先级的独立通道？倾向**同表不同 `event_type`**，复用现有 alerting 基础设施（不新造监控机制）。

## 6. 实现清单（v2，整合 NWT + Bettor review）

供实现时对照，避免"新逻辑写了但没全链路接通"（今天已经在 #25/KI-49/#48 撞过三次同类坑）：

- [ ] `classifyFailure(error, market)` 纯函数：判定顺序 TRANSIENT_RE（import 复用 G5-5a 现有常量，不重新定义）→ BUSINESS_PENDING（UMA-ABSTAIN 专属）→ CODE_BUG（`instanceof TypeError/ReferenceError` 优先，正则次要兜底）→ UNCLASSIFIED（当 CODE_BUG 同款处置）。
- [ ] `_settleOneMarketAttempt` 顶层 catch 改造，调用 `classifyFailure`，按分类走不同分支（§2.2 伪代码位置）。
- [ ] **`settleDaemonTick`（`bshard-settle-daemon.mjs:340-369`）第 357-360 行 + 第 362-364 行两处 catch 都要同步改**：检查 `r.keepStatus`（或分类结果），为 true 跳过 `UPDATE protocol_status`，只走告警。**这是 NWT 抓到的关键接线缺口，实现时第一个验证点**。
- [ ] `scheduleUmaRejudge(marketId, abstainReason)`：写 `metadata.uma_pending_since`（首次）+ 更新重试计数。
- [ ] `selectRipeMarkets` 改造：读 `metadata.uma_pending_since` + 退避表当前档位，未到间隔的市场不进 `ripe` 列表。**这是第二个容易漏的接线点**。
- [ ] TRANSIENT 跨 tick 计数 + `stuck_transient` 告警状态。
- [ ] 测试用例：①一个"完全无法识别的错误类型"输入 `classifyFailure`，验证不会导致 `protocol_status` 被意外改写（锁住 fail-safe 属性，NWT 认可的设计点）。②模拟畸形 RPC 响应触发的 `Cannot read property` 类错误，验证被分类成 TRANSIENT 而不是 CODE_BUG（验证判定顺序生效）。③UMA re-judge 全链路：ABSTAIN → 退避等待 → finalize → 正常结算，验证 `verifying` 状态在整个等待期间不被误标记。
4. 这份设计目前只覆盖 `bshard-settle-daemon.mjs`（v0.7 bshard 结算路径）。`pool-market-settler.js`（v0.6 老系统）是否需要同款改良？范围待定，倾向不动（v0.6 是遗留系统，非本轮重点）。

---

*本设计草稿覆盖 Owner 2026-07-04"现有基础改良/模块化/结构化"定调。J2 主笔，NWT/J1/Bettor review 后再实现，不赶。*
