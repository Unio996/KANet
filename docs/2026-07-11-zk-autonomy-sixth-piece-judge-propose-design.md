# ZK 自治化第六件：ZK-native judge + propose 自治（真正的最后一格）

> **Status**: DRAFT（J2 出稿，待 NWT 红队 + Bettor 方向审，落码前不动任何代码，铁律0）
> Owner 直令，b0uoi 验收局当场立卡 #go7ihf.2/#go7ihf.3（"六环零人工"口径炸出的真缺口）。

## 0. 需求核销表（照例对照，防第四件那种 scope-drift 重演）

b0uoi 验收局(2026-07-11 深夜)如实揭露：账上"自治边界"一直写"judge/propose/handoff/enqueue 人工"
四格，第四/五件已经修了 handoff+enqueue 两格，**judge/propose 这两格从未被任何一件自治化工作
覆盖过**——今晚验证时判定条件满足后市场卡在 `verifying` 干等，靠 Bettor 授权一次 sanctioned 人工
propose 才能继续往下验证第四/五件。本文档补的就是这最后两格：**judge（谁赢）+ propose（发起
close 签名请求）**，让 ZK-native 市场从 deadline 到 attest 全程零人工。

| 自治边界原有格子 | 现状 | 对应产物 |
|---|---|---|
| attest | ✅ 已自治(voter/submit cron) | 既有 `bshardCloseSubmitV2Tick` |
| handoff | ✅ 第五件已自治 | `zkHandoffAutonomousTick` |
| enqueue(liveness 恢复) | ✅ 第四件已自治 | `retryZkProveJobAfterHandoffLanded` |
| zk_close | ✅ (b) 已自治 | `zkCloseTickV2` |
| claim | ✅ (c) 已自治 | `claimAutonomousTick` |
| **judge + propose** | ❌ **从未自治过**(b0uoi 首次真实撞到) | **本文档** |

## 1. 现状（读码坐实）

- V1（非 zk_native）市场的 judge+propose 由 `selectRipeMarkets`/`_settleOneMarketAttempt`
  （`bshard-settle-daemon.mjs`）自治处理——但 `selectRipeMarkets` 的 WHERE 子句**显式排除**
  `resolution_rule_spec.zk_native===true` 的市场（`bshard-settle-daemon.mjs:319`，2026-07-06
  Bettor 推演抓出的"反向结构隔离"：V1 的 22 参 close_attest witness 打不动 ZK-native 的 26 参
  PayoutShardV2 covenant，混进来会 fail-closed 反复重试污染 events）。**这是有意为之的正确隔离，
  不是本文档要拆的墙**——本文档要做的是给 zk_native 市场补一条平行的自治路径，不是把它塞回 V1。
- `judgeWinDir(market)`（`bshard-settle-daemon.mjs`，**已 export**）本身跟 zk_native/V1 无关——
  同一份判定逻辑（ESPN/polymarket-UMA/`blockhash_parity`）两边通用，b0uoi 走的正是这份函数里的
  `blockhash_parity` 分支。**不需要重新实现判定逻辑，直接复用这个已 export 的函数**。
- `endBlockHash(daa)`（同文件，包了一层 `fetchEndBlockHashCanonical`）**当前未 export**——今晚
  MAX_WALK 根治（v183 index）已经让它变快变稳，这条也该复用而非重新实现，落码时需要加进 export 列表。
- `buildProposeCloseRequestV2(marketId, {winningDirection, endBlockHash, settlerRelayId})`
  （`bshard-close-transport.mjs`）**已经完全自包含**——今晚 b0uoi 验收局手动调用过一次，证实
  函数本身零需要改动，只是"谁来调"这一层缺自治触发（跟第五件 `buildZkHandoffRequestV2` 同款
  处境——函数早就写好了，缺的是调用点）。

## 2. 方案：新独立 tick，同款 ctx 注入模式

**新 tick `zkJudgeProposeAutonomousTick`**（`zk-autonomy-ticks.mjs`，与 (b)(c)(e) 同文件同风格）：
- 扫描条件：`protocol_version='v0.7'` + `resolution_rule_spec.zk_native===true` + `deadline_daa +
  FINALITY_BUFFER <= currentDaa`（同 V1 `selectRipeMarkets` 的 finality 门槛，不用更松的口径）+
  `protocol_status IN ('pending_bettors','verifying')` + `metadata` 里**没有** `bshard_close_
  request_v2`（还没 propose 过）。
- per-market running 互斥：复用 `_zkAutonomyLeases`（同 (b)(c)(e)）。
- 命中即：① `ctx.judgeWinDir(market)` 取 winDir（ABSTAIN 会 throw，同 V1 行为，见 §4）；②
  `ctx.endBlockHash(market.deadline_daa)` 取 endBlockHash；③ `ctx.buildProposeCloseRequestV2(
  marketId, {winningDirection, endBlockHash, settlerRelayId})`。三步全部现读链上/DB，零 caller-fed
  中间值（跟第五件同一条纪律）。
- kill switch 独立：`ZK_JUDGE_PROPOSE_TICK_ENABLED`（默认 OFF，同 (b)(c)(e) 上线纪律）。
- ctx 提供方（`bshard-settle-daemon.mjs`）：`judgeWinDir` 已 export 直接复用；`endBlockHash`
  加进 export 列表；`buildProposeCloseRequestV2` 静态 import（同第五件 `buildZkHandoffRequestV2`
  的 import 方式，无循环依赖风险，已核实两文件互不引用）。

## 3. 失败恢复（复用第五件同款纪律，非重新设计）

- **judge ABSTAIN**（UMA-pending/ESPN 数据未就绪）：`judgeWinDir` 会 throw——本 tick catch 住记
  `events`，**不重试计数器/不进入 V1 那套完整 `scheduleUmaRejudge` 分级退避表**（那套是 V1 专属
  的复杂机制，本文档 v1 用跟第五件一样的简单冷却间隔：上次尝试距今 < 冷却窗口 → 跳过）。如实
  声明：这是比 V1 简化的方案，若 zk_native 市场后续大规模接入 UMA/polymarket 判定源，冷却窗口
  是否够用需要重新评估——不在本次范围内解决。
- **propose 广播/build 失败**（`buildProposeCloseRequestV2` 本身 throw）：跟 judge ABSTAIN 一视
  同仁，同一个冷却计时器管，下次 tick 自然重试。propose 不是"广播后可能 landed 但轮询超时"这类
  资金操作（`publishCloseRequestV2` 只是写 DB 供委员 daemon 后续去读，不碰链），**不需要第五件
  那种 pending-marker 智能恢复机制**——失败了直接下次冷却期满重来即可，无"已经真实广播成功"
  的中间态需要追踪。

## 4. 验收

1. offline test：扫描条件命中"zk_native+deadline 已过+未 propose"的市场；已 propose 的市场不
   重复命中；非 zk_native 市场不被本 tick 碰（继续走 V1 `selectRipeMarkets`原路径, 双向隔离）。
2. judge ABSTAIN 场景：mock `judgeWinDir` throw，断言市场状态不变（不误标任何终态），`events`
   记录，下次 tick 在冷却期外重试。
3. 开 ON 后第一个真实市场：全链手动核对（judge→propose→attest→handoff→enqueue→prove→close→
   claim 全八步，J2 手动核对，同 b0uoi 验收局纪律，不因自治停止链验）。
4. Bettor/NWT 双签后 `ZK_JUDGE_PROPOSE_TICK_ENABLED` 转常态 ON——**这一格闭合后**，"ZK 彻底投入
   实用"（六环全自治：judge+propose+attest+handoff+enqueue+close+claim）才是准确表述。
