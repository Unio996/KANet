# ZK 自治化第五件：handoff 广播自治（自治链最后一格）

> **Status**: DRAFT（J2 出稿，待 NWT 红队 + Bettor 方向审，落码前不动任何代码，铁律0）
> Owner 直令：与佣金独立模块（B线）并行，A线（本文档）J2 主笔 #glbh5v.2。

## 0. 需求核销表（照例对照，防第四件那种 scope-drift 重演）

当前自治边界（`project-zk-autonomy-switches-on-bvh2c-dod` memory，如实表述）：**attest（voter/submit
cron）+ zk_close + claim 三环自治，judge/propose/**handoff**/enqueue 人工**。enqueue 的 liveness 缺口
已由缺件④（`retryZkProveJobAfterHandoffLanded`）补齐——但④只解决"handoff 落地后 enqueue 怎么恢复"，
**handoff 广播本身仍要人工调 `POST /api/admin/pool/zk-handoff-v2`**（唯一调用点，见 §1）。本文档补的
就是这最后一格：attest landed 后，门①（`buildZkHandoffRequestV2`）自动触发，不需要人再手点。

## 1. 现状（读码坐实）

`buildZkHandoffRequestV2(marketId, {settlerRelayId, dryRun})`（`bshard-close-transport.mjs:446`）**只有
一个调用点**：`pool.js:1837` 的 admin 端点，人工 POST 触发。函数本身已经完全自包含、零 caller-fed 值源
（`grep` 确认，唯一入参只有 `marketId`/`settlerRelayId`/`dryRun`）——`state`/`gateTmplHash`/`templateA-D`/
`feeSompi`/`relayAddr` 全部函数内部现读链上/env 派生，这点**天然满足**"值源全链锚禁 caller-fed"的要求，
不需要额外改造。函数内部已有 landed-gated 逻辑（广播后 `check_utxo_landed` 确认 30 次轮询，未确认则
零持久化返回）——落码只需要"谁来调用它"这一层，不碰函数本体一个字。

`bshardCloseSubmitV2Tick`（`bshard-close-voter.js:717`）attest 落链的两个分支（`resumed`/首次广播）都在
`_persistAttestedPsState` 之后紧跟 `clearCloseRequest(market.id, 'attested_v2')`（写入独立 `protocol_status`
值）+ `_tryEnqueueZkProve(market, req)`（同步、纯 DB 操作，不涉及链）。

## 2. 方案：独立 tick，不内联挂进 submit tick

**决策（含理由，非拍脑袋）**：不在 `bshardCloseSubmitV2Tick` 的两个 attest-landed 分支里直接
`await buildZkHandoffRequestV2(...)`。理由：
1. 该函数内部含一笔真实 `transferAndConfirm`（fee 转账+深确认，可能耗时到 90s 量级）+ 广播 + 30 次
   landed 轮询——比 `_tryEnqueueZkProve`（纯同步 DB）重得多。内联会让 submit tick 为一个市场的 handoff
   卡住 90s+，拖慢同一 tick 里其它 pending 市场的 attest 处理。
2. 复用 (b)(c) 已验证的模式（`zk-autonomy-ticks.mjs`：独立 tick + 独立 running-mutex + 独立 kill switch）
   —— 一致性优于自己另起一套内联逻辑。

**新 tick `zkHandoffAutonomousTick`**（`zk-autonomy-ticks.mjs`，与现有 `zkCloseTickV2`/
`claimAutonomousTick` 同文件同风格）：
- 扫描条件：`payout_shards.payout_redeem_hex` 现读 `readPayoutShardV2AttestedState` 得 `closed===1`
  （已 attest）**且** `pool_markets.metadata` 里**没有** `zk_continuation` 字段（尚未 handoff）。
- per-market running 互斥：复用 `_zkAutonomyLeases`（现有 Set，`zk-autonomy-ticks.mjs:60`）——这个市场
  在 zk_close/claim tick 眼里此刻还没有 `zk_continuation`，天然不会跟它们抢占同一把锁；反过来本 tick
  跑的时候也把市场 id 加进同一个 Set，防止本 tick 自己的下一轮 tick 跟这一轮重叠。
- 命中即调 `buildZkHandoffRequestV2(marketId, {settlerRelayId, dryRun: false})`。**relay id 解析**
  （Bettor n2，#glhaey.2）：daemon 自己解析 `process.env.BSHARD_SETTLER_RELAY_ID`（同 `bshard-settle-
  daemon.mjs:42` 的 `ZK_SETTLER_RELAY_ID` 既有模式——每个文件各自读同一个 env var 派生自己的常量，不
  跨模块 import 别处的常量），成功/失败都记 `events`（同 `_writeZkAutonomyErrorEvent` 既有模式）。
- kill switch 独立：`ZK_HANDOFF_TICK_ENABLED`（默认 OFF，同 (b)(c) 上线纪律——offline test 全绿 + 一个
  真实市场手动验证 + Bettor/NWT 双签才 ON）。

## 3. 与缺件④的衔接（零额外接线）

`buildZkHandoffRequestV2` 成功路径末尾已经接了缺件④的 `retryZkProveJobAfterHandoffLanded`
（`bshard-close-transport.mjs:530-546`，本 session 早前落码）——**这条路径是共享的，不关心调用方是人工
POST 还是这个新 tick**。本次落码后，"attest 落地→（本文档）自动 handoff→（缺件④）自动 retry 卡住的
enqueue→（既有）zk-prove-worker 捡起→（(b)）zk_close 自治→（(c)）claim 自治"，五环首尾相接，全自动。

## 4. 失败恢复（如实披露，非完美方案，留给 NWT 判断是否需要 v1 就补）

`buildZkHandoffRequestV2` 若广播成功但 landed-check 30 次轮询内未确认，函数**提前 return，不写
`zk_continuation`**（#22 族纪律：广播成功不等于落链）——这意味着下一轮 `zkHandoffAutonomousTick` 扫描
仍会命中同一个市场（`zk_continuation` 还是缺的），再次尝试。这次重试会用同一个 `ps.payout_ps_outpoint`
去 build 一笔新 tx：
- 若上一笔广播其实**没有**真的 landed（node 拒绝/mempool 丢弃）：这次重试是正确、安全的重新广播。
- 若上一笔广播其实**已经** landed（只是轮询窗口内没等到确认）：这次重试会拿一个已经被花掉的 outpoint
  去 build，在 relay 侧撞 "UTXO not found" 安全失败（Kaspa UTXO 模型天然防双花，不是资金风险）——
  代价是浪费一次 `transferAndConfirm`（多转一笔 fee dust 到 relay 自己地址，钱没丢，下次还能用，只是
  空转）。

**裁定（Bettor n1，#glhaey.2，取代上面"v1 直接接受空转"的原倾向）**：纯无条件重试的空转代价不是
一次性的——tick 30s 一轮，市场卡在这个态的每一轮都会烧一笔真实 fee dust 转账，卡数小时 = 可观 churn
（既浪费又在 `events`/链上留一堆噪音记录）。**采用中间方案：per-market 尝试冷却**——`events` 表已有
本市场上次 `zkHandoffAutonomousTick` 尝试的时间戳（每次尝试无论成败都记一条，见 §2），扫描时对每个
候选市场先查"上次尝试距今是否 ≥ 冷却间隔"（数值同 tick 周期同量级，比如 5 分钟量级，具体值 NWT/落码
时定，不是本文档的架构决策点），未到冷却时间的候选跳过，不发起新的 `buildZkHandoffRequestV2` 调用。
**这不是 resume-marker**（不追踪"上一笔具体 txid 是否已 landed"这种精确状态），只是限速——之前空转的
物理成因（花钱操作可能因窗口内轮询超时而被误判失败）依然存在，冷却只是把"每 30s 烧一次"降到"每
冷却周期烧一次"，用更小的代价换同样的自愈能力。

**②裁定为 v1 必做，非可选（Bettor #gljs86.2，推演补刀）**：若某次 handoff 广播**真落链但轮询窗口
错过**，`zk_continuation` 永远不会被写（landed-gated 纪律本身没错）——此后每轮不做智能恢复的话，都会
拿已经被那笔真实落链 tx 花掉的 `ps.payout_ps_outpoint` 去 build 新 tx，永远撞 "UTXO not found"，**这个
市场永久死锁**，不是"安全空转"——恰好把这套自治化本来要消灭的"卡死等人工"换个形态留下，跟今晚整晚
在解的同一类问题（stuck forever）复发。成本评估如下（不需要完整 resume-marker 状态机）：
`buildZkHandoffRequestV2` 在
landed-check 超时的分支（`bshard-close-transport.mjs:527-528`）仍然 `return result`，**`result.txId`/
`result.closeZkAddress` 对调用方可见**（函数本身不用改一个字）。本 tick 自己在捕获到"广播成功但超时"
这个返回值时，把 `{txId, closeZkAddress}` 存进一个轻量 metadata 字段（例如 `zk_handoff_pending`，跟
`bshard_close_submit_v2_pending_txid` 同精神，非同一份）。下一轮扫描时，若候选市场带这个 pending
字段，**先** `checkUtxoLanded(closeZkAddress, txId)` 而非直接重新广播：
- landed=true：说明上次广播其实真的成功了，只是轮询窗口内没等到——直接调 `writeZkContinuation`（用
  pending 字段里存的同一批值，不重新推导）补齐持久化 + 清掉 pending 字段，**不发起新广播**（"智能恢复"，
  零新增 fee 消耗）。
- landed=false：清掉 pending 字段，走正常路径重新调 `buildZkHandoffRequestV2`（这次是真安全的重新
  广播，同上面的分析）。
成本可控：不需要重建 witness/build-preimage（那是 resume-marker 完整状态机才要做的事），只需一次
`checkUtxoLanded` 命令 + 复用已有的 `writeZkContinuation`——两者都是现成函数。**①（冷却）+②（智能
恢复）一起落码**，互补而非二选一：②处理"确实只是超时"这类可以零成本恢复的情形，①兜底"网络持续
拥堵、连② 也没法在合理时间内确认"这类更差情形下的限速阀门。

## 5. 验收

1. offline test：(a) 扫描条件命中"已 attest 且无 zk_continuation"的市场；(b) 已有 `zk_continuation`
   的市场不重复命中（不会跟 (b)(c) 抢同一市场）；(c) running-mutex 并发触发只广播一次。
2. 开 ON 前：一个真实市场手动验证全链（attest→本 tick 自动 handoff→缺件④自动 retry→prove-worker→
   (b)(c) 自治收尾），J2 手动核对，不因为自治停止链验。
3. Bettor/NWT 双签后 `ZK_HANDOFF_TICK_ENABLED` 转常态 ON（同 (b)(c) 纪律）。
