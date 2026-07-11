# ZK 自治化第四件：handoff-landed 触发 enqueue 重试（scope-drift 补件）

> **Status**: DRAFT（J2 出稿，待 NWT 红队 + Bettor 方向审，落码前不动任何代码）

## 0. 原始需求核销表（Bettor 钦定：设计稿必须对照 7/9 原始清单逐项核销，禁止再丢件）

7/9 原始"自治化三件"（COORD-LEDGER 7/9 行）：
> a. **enqueue 时序修复**: attest 时 auto-enqueue 必 fail 等 continuation, job#7/#9 两市场复发, 需
> **handoff-landed 触发重试**——liveness 缺口
> b. ZK_CLOSE_TICK=ON
> c. claim driver 自治 tick

| 原始需求项 | 现状 | 对应产物 |
|---|---|---|
| (a) enqueue 时序修复 / handoff-landed 触发重试 | **从未实现**（J2+NWT 双独立 grep 7/10 证实，scope-drift：`2026-07-09-zk-autonomy-three-parts-design.md` 成稿时把 (a) 静默替换成"landed-gated 持久化"——那是另一个真问题（广播 ack≠落链），但不是这条 liveness 缺口） | **本设计文档** |
| (b) ZK_CLOSE_TICK=ON | ✅ 落码 `daeef3b8`，bvh2c 验证 DoD 达成，双签常态 ON | `zk-autonomy-ticks.mjs` zkCloseTickV2 |
| (c) claim driver 自治 tick | ✅ 落码 `daeef3b8`，bvh2c 验证 DoD 达成，双签常态 ON | `zk-autonomy-ticks.mjs` claimAutonomousTick |
| （插入项，非原始三件，但真实修了一个问题）landed-gated 持久化 | ✅ 落码 `4ebe4750` | 门①`writeZkContinuation`/门②`advanceZkContinuationAfterSpend` 调用点 |

**本文档只做一件事**：把原始 (a) 补回来。不重新讨论 (b)(c)（已完体），不碰 landed-gated 持久化（已完体且独立正确）。

## 1. 现状根因（读码坐实，非猜测）

- `_tryEnqueueZkProve`（`bshard-close-voter.js:681`）在 `close_attest_v2` 落链确认后**立即**调用
  `enqueueZkProveJob` 插入一条 `status='pending'` 的 `zk_prove_jobs` 行。这一步**不检查** zk_handoff
  （门①）是否已经广播/落地——`enqueueZkProveJob` 本身（`zk-prove-enqueue.mjs`）也没有这个检查。
- `zk-prove-worker.mjs`（第 168-181 行）轮询取到 `pending` job 后，花任何 CPU/钱之前才检查
  `market.metadata.zk_continuation` 是否存在（= 门① mint 是否已成功广播过）。**不存在就直接
  `_fail(job, '...还没有 zk_continuation(zk_handoff 还没成功广播过)...')`**，`status` 变成 `failed`，
  没有任何后续自动重试。
- **门① handoff 目前仍是人工步骤**（COORD-LEDGER 7/10 记账"自治边界...judge/propose/handoff/enqueue
  仍人工"）。attest 落链是自动/半自动的，但 handoff 广播往往滞后（人工排期），worker 的轮询间隔远
  快于人工 handoff 的响应时间——**结果是几乎每次新市场的第一次 enqueue 尝试都会在 handoff 落地前被
  worker 捞到并判 failed**，job#7、job#9 两次真实复发，全靠 J2 事后发现+手动重置 job 状态。
- 这不是"随机小概率 bug"，是**结构性必然**：只要 handoff 保持人工，且 worker tick 间隔 < 人工响应
  时间，这条路径每个新市场都会至少 fail 一次。

## 2. 方案：handoff-landed 事件触发的 retry

**触发点**：`writeZkContinuation` 成功调用之后——这正是"门① handoff 已确认 landed"这一事实第一次
在系统里成立的时刻（唯一调用点：`bshard-close-transport.mjs:530-535`，紧跟在 `check_utxo_landed`
确认之后，landed-gated 纪律已经把这个时点钉死为"真落地"，本设计直接复用，不新造判定）。

**新函数** `retryZkProveJobAfterHandoffLanded(marketId)`（新文件或并入 `zk-prove-enqueue.mjs`，待
NWT 建议归属）：
1. 查 `zk_prove_jobs WHERE market_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1`。
2. **只在 `error` 字段命中 `zk-prove-worker.mjs:178` 那条固定模板的可辨识子串**（`'还没有
   zk_continuation'`，全代码库唯一来源，grep 确认无其他调用点复用这句话）时才重置——**不blanket-retry
   所有 failed job**（真实数据错误如 Σleaf 不守恒/fee_leaves 空，重试等于再烧一次 CPU 复现同一个
   注定失败的结果，属于需要人工看的真错误，不能被本机制悄悄吃掉）。
3. 命中则 `UPDATE zk_prove_jobs SET status='pending', error=NULL, updated_at=datetime('now') WHERE
   id=?`，并写一条 `events` 表审计记录（复用既有 `_writeZkCloseTickErrorEvent` 风格，非新造模式）。
4. 未命中（没有 failed 行，或 failed 行是别的原因）→ 静默返回，不报错、不新建 job（`_tryEnqueueZkProve`
   在 attest 时已经建过唯一一条，本函数不重复造 job）。
5. 调用处：`bshard-close-transport.mjs:535`（`writeZkContinuation` 调用之后一行），try/catch 包裹，
   失败只 log 不影响 handoff 本身已落链的事实（镜像 `_persistAttestedPsState`/`_tryEnqueueZkProve`
   同款"钱路已成立，记账/排队失败不倒灌回钱路状态"纪律）。

## 3. 边界与风险

- **不改 `zk-prove-worker.mjs` 的 fail-closed 检查本身**——那条检查是正确的、已经救过场（job5/3o0a6
  事故），本方案只是给它失败之后补一条自动恢复路径，不动检查逻辑一个字。
- **不改 `enqueueZkProveJob`/`_tryEnqueueZkProve`**——它们的职责边界（attest 落链就建 job）保持不变；
  liveness 缺口修在"失败之后怎么恢复"这一层，不是"一开始该不该建 job"那一层。
- **幂等/并发**：`writeZkContinuation` 每个市场生命周期只调用一次（门①只发生一次），本函数是这次
  调用的直接同步续联，不存在并发触发多份 retry 的场景，不需要 mutex。
- **重试次数**：无上限计数器——如果 handoff 真落地了但 job 仍然反复失败（说明失败原因其实变了，
  比如 handoff 落地后又暴露另一个真实数据问题），下一次 worker 拾取会给出新的、不同的 `error`，
  不会再匹配 `'还没有 zk_continuation'` 子串，本机制天然不会对新错误无限重试。
- **字符串匹配的脆弱性（如实披露）**：匹配的是 `zk-prove-worker.mjs:178` 的固定中文模板子串。若未
  来有人改这句提示文案而没同步改这里，本机制会静默失效退化为"今天的手动模式"（不会更差，只是
  恢复不了自动化）——比匹配失败去动一个错误的 job 安全。落码时在两处各留一条注释互相指向，防止
  未来单独改文案的人不知道有这个耦合。

## 4. 验收（NWT 落码复核会点名核对）

1. offline test：构造一条 `status='failed', error='...还没有 zk_continuation(zk_handoff 还没成功广播过)...'`
   的 job，调用 `retryZkProveJobAfterHandoffLanded`，断言 `status` 变回 `pending` 且 `error` 清空。
2. **负例**：构造一条 `error='enqueueZkProveJob: Σleaf(...) != consolidatedPool(...)'`（真实数据错误）
   的 failed job，调用后断言 **不被**重置（仍是 `failed`，`error` 不变）——防止本机制退化成 blanket retry。
3. 无 failed job 时调用（市场从未失败过）：断言不抛错、不新建行。
4. 集成点：`bshard-close-transport.mjs` 调用处包 try/catch 的行为（模拟 retry 函数内部抛错，断言
   handoff 本身返回值不受影响）。
5. 开 ON 后第一个真实市场：如实观察一次 attest→（若 handoff 滞后）job 变 failed→handoff 落地→job
   自动变回 pending→worker 下一 tick 捡起→proving 正常跑完，J2 手动核对一次全链（不因为自治就停止
   链验，同 (b)(c) 上线时的纪律）。
