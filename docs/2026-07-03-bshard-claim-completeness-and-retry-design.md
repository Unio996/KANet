# bshard claim-completeness 正确性 bug + 有界重试 — 设计（J2 起草，待 NWT 审）

> 起点：多签排序调查的副产品。原本要设计"claim-threading 停摆自动重试"（可靠性问题），
> 排查证据链过程中发现真正问题是**正确性 bug**：daemon 会把"部分 winner 未领取"的市场
> 标记成 `completed`，跟"全部 winner 已领取"在 DB 里无法区分。两个问题同源、同一个循环，
> 合并成一份设计。

## 1. 问题（读码实证，非推测）

`kasia-console/src/services/bshard-auto-settler.mjs` `settleMarketLive()` 的 claim 循环：

```js
for (const cd of claimData) {
  if (!cd.climbOk) { ctx.alert(...); claims.push({...error}); continue; }        // 丢单点①
  if (roundTripFail) { ctx.alert(...); claims.push({...error}); continue; }      // 丢单点②
  const claimRes = await ctx.relayPost(...);
  if (!claimRes?.txId) { ctx.alert(...); claims.push({...error}); break; }       // 丢单点③
  if (!received) { ctx.alert(...); claims.push({...error, txId}); break; }       // 丢单点④
  if (spliceCheck fails) { ctx.alert(...); claims.push({...error, txId}); break; } // 丢单点⑤
  claims.push({...ok}); // 正常
}
return { ok: true, closeTxid, claims, plan };   // ← 无条件 true, 不检查 claims 是否等于 plan.winners
```

`bshard-settle-daemon.mjs:227` 只检查 `!r.ok || !r.closeTxid`，两者都通过就在 L236 无条件写
`protocol_status = 'completed'`。**`completed` 从来没有被断言等价于"每个 winner 都拿到钱"。**

## 2. 实测规模（全量重放，非抽样，2026-07-03，v2 修订）

方法：复用生产函数 `getMarketBets`（shard-aware，非重造）+ `computePariMutuelPayout` +
`buildPayoutRoot`，对每个 `completed` 状态的 bshard 市场按 winDir∈{0,1} 重算 payoutRoot，
跟 `metadata.settle_evidence.payout_root` byte-exact 比对，命中的方向 = 推断历史结果（⚠ 见
§2.2 必改-4，这个比对基准本身待链上锚二次确认），再拿重算的 `winners.length` 跟
`evidence.claim_txids.length` 比。

**自校验**（2 个已知案例，重算 payoutRoot 必须 byte-exact 命中，否则不许跑全量）：
- `mf0o4`（3 分片，90 注，83 winner，daemon 自治结算）→ 命中，gap=0 ✅
- `4p0f6`（单片，4 注，2 winner）→ 命中，gap=0 ✅

### 2.1 v1 结果（gap 单谓词，已知不完整——见 §2.2）

- 61 "干净"（gap=0）
- 20 个 tier1 疑漏付，缺口合计 169 个 winner-slot
- 4 个无法验证（历史 driver-script 手驱：ozzeu/pb73v/gp8hy/2ysnl，evidence schema 不同，非本 bug 新增风险）

### 2.2 🔴必改-1 修正：gap=0 不等于干净

丢单点④（not-landed）/⑤（splice-mismatch）push 的记录带 `txId` 但 `received` 可能是 `false`。
若 break 恰好发生在最后一个 winner，`claim_txids.length === winners.length` 但该笔未必到账——
gap=0 的"干净"判定漏了这类情况。`settle_evidence` 不存 per-claim `received` 明细，DB 层能做的
最强第二谓词 = 交叉比对该市场是否曾触发过任何一种到账疑虑 alert（not-landed/splice-mismatch/
submit-fail/climb-fail/round-trip-fail）。

**实测坐实**：`2pu1o`（expected=2, recorded=2, gap=0，v1 判"干净"）日志里有
`claim not landed 606be169 — STOP threading` 记录——**确凿的假阴性案例**。

**v2 修正结果**（85 个 completed 市场，交叉比对全量 ALERT 日志）：
- **tier1（计数缺口）：20 个，不变**
- **tier2（计数对上但曾有到账疑虑 alert）：1 个新增（2pu1o）**
- **clean_provisional：60 个 —— 这是"暂定"不是"证明"**，只代表"日志窗口内未发现已知疑点"，
  不能代表"链上确认无误"（`verifyClaimLanded` 本身若存在假阳性 bug，不会留下任何 alert，这个
  方法天生看不见）。
- 无法验证：4 个，不变

需要 J1 链上确认的从 20 个扩为 **21 个（tier1+tier2）**，另外 60 个 clean_provisional
**必须做分层抽样链验**（不同 betCount 规模/不同分片数各抽样），不许直接采信。

## 3. 证据分级（硬规则，不许混）

| 层级 | 产出 | 允许的结论用词 |
|---|---|---|
| DB 重放 gap 计数（v1） | 逐市场 expected/recorded/gap 表 | "⚪疑漏付(tier1)"，禁止"确认漏付" |
| DB 重放 + 日志交叉比对（v2） | tier1/tier2/clean_provisional 三分类 | tier2 同样只能叫"疑漏付"；clean_provisional 只能叫"暂定"，不能叫"干净" |
| 链上确认（J1，下一步，见 §4.2/§6） | 逐 winner 地址 + 逐 tier + 抽样 clean_provisional | 通过才可升级 "🔴确认漏付" 或降级 "虚惊" |

在链上确认完成前，**任何过往"N winners 实领"的里程碑文档/sign-off 引用都标"待复核"，
不得再被当证据引用**（这些市场的 `evidence.winners` 字段本身就是本 bug 的产物）。

### 🔴必改-4：payoutRoot 比对基准是循环取证，需链上锚二次确认

§2 用 `metadata.settle_evidence.payout_root` 作为"真实历史 winDir"的判定基准——但
`settle_evidence` 正是本 bug 的产物家族，拿它当 ground truth 有循环风险（如果这个字段本身
也可能写错，我的方向推断就建立在沙地上）。真正的锚在链上：`closeTxid` 对应的 close_attest
交易 witness 里有委员实际签署的 committed root（命门③已验证过 witness 含真根）。

**修法**：J1 链上确认任务追加一列——对 tier1+tier2 共 21 个市场，从 close TX witness 提取
committed root，与 DB `metadata.settle_evidence.payout_root` 做 byte-exact 比对。全部一致，
本设计 §2 的方向判定才算追认有效；任何不一致立即单独升级——那意味着 DB 记录的 root 本身
就是错的，比"漏付 winner"更严重（committed root 是委员实际签署对象，不该跟 DB 存的不一致）。

## 4. 修复设计

### 4.1 新终态 `settled_partial_claims`（替代无条件 `completed`）

`settleMarketLive` 返回值加 `claims.length < plan.winners.length` 判定；daemon 写库时按下表分流：

| 条件 | 新状态 |
|---|---|
| `claims.length === plan.winners.length` 且全部条目 `received===true` **且无 error 字段**（见 🟡风险-2） | `completed` |
| 否则（数量不足 / 存在 `received===false` / 存在 `received===true` 但带 error） | `settled_partial_claims` |

`completed` 语义钉死为不变量：**`completed ⇔ 每个 winner 都有链上确认（`received===true` 且无 error）的 claim TX`**。
落一条回归测试，见 🟡风险-2 的三 fixture 要求。

### 4.2 `settled_partial_claims` 可重入重试 —— resume 模型（读 `PayoutShard.sil` 源码定型，非猜）

**🟠硬门已答（读源码，不是读文档/记忆）**：`claim` entrypoint（`kasia-console/src/lib/PayoutShard.sil`
L171-225）用调用方传入的 `merkle_index` 查 nullifier bitmap（`w0..w16`）某一位是否为 0
（未领），只 `require` 这一位是 0，**不要求 index 递增/按序**——covenant 层面 claim 之间
无顺序约束。"看起来像串行链"纯粹是物理限制：每个 claim 花的都是同一条
`validateOutputState` 续出来的 continuation UTXO，一次只能有一笔交易花它，但**花哪个
winner、什么顺序，covenant 不关心**。原设计"逐 winner 独立查 slot"的措辞不准确，重写为：

**resume 算法（正确形状）**：
1. **链上找当前 continuation UTXO 的 tip**——walk 该 payout shard 从 close TX 起的花费历史
   直到最新未花费输出，**绝不信 DB 记的 `psOutTxid`/`curRedeem`**（splice-mismatch 报警本身
   就是 DB 记录跟链上分叉的证据）。
2. **解码 tip 的 witness state**：`w0..w16` bitmap 直接就是链上权威的"谁已领"清单——不需要
   另外"从花费历史反推已付集合"，bitmap 本身即真相源。
3. 对 bitmap 里仍为 0 的 merkle_index 逐个提交 claim，**顺序不重要**（covenant 不管），但
   必须串行提交（每笔必须花上一笔的 continuation 输出，物理只能串行）。
4. **幂等谓词** = 步骤 2 的 bitmap 状态本身，**不需要**（也不能）用"winner 地址是否存在
   landed UTXO"这种收款侧判定——原提法的假阴性（winner 已花掉收到的钱）/假阳性（同地址凑巧
   收到同额别的 UTXO）风险由此自然消除：判定锚从来就该是 tip 的 nullifier bit，不是收款
   地址余额。
- **错误分类白名单**：只有丢单点③④⑤（submit-fail / not-landed / mempool-race 类）进重试循环；
  丢单点①②（climb-fail / round-trip-fail）不进——见下方，这两类需要独立终态,不能沉默停驻。
- **有界 + 退避**：重试预算耗尽（如 5 次，指数退避）后停驻，报警升级为需 operator 介入
  ——注意这不是因为资金会过期（§4.3 已证 claim 无 deadline），纯粹是运维卫生（防止一个
  持续故障的中继/网络问题无限重试刷交易）。

#### 🟡风险-1：丢单点①②不能沉默停驻在同一队列状态里

原设计只说"①②不进重试循环"，没写它们的终态——会以 `settled_partial_claims` 停驻且永不被
队列处理，等于换了个名字的静默失败。**修**：climb-fail/round-trip-fail 触发时立即报警 +
单独标记 `needs_manual_attribution`（不是 `settled_partial_claims`），跟"重试预算未耗尽,
等下一轮"的市场分开队列状态，防止两类问题混在一起靠肉眼从日志里区分。

### 4.3 未领取 winner 的逃生路 —— 读源码定型，sweep 机制不需要建

**🟡原疑虑已被源码直接排除，不是靠探针，是靠读 `PayoutShard.sil` 逐条 require：**

**① claim 有没有 deadline**：`claim`（L171-225）/`refund_claim`（L334-390）两个 entrypoint
全文没有任何 `tx.time`/locktime 约束。**claim 永远可领，不会过期**。剩余未领 winner 的资金
不存在"逃生路窗口关闭"的风险——需要的只是"daemon/operator 之后再对同一 winner 重试
claim"，不是一个新机制。

**② refund 臂在 close 之后是否仍可触发（原必改-3 的核心担忧：判决翻案/双重受益）**：
`cancel_attest`（refund 的委员背书入口，L232）第一行 `require(closed == 0)`；`close_attest`
（L67）第一行同样 `require(closed == 0)`——两者共享同一前置条件、写向互斥的目标状态
（`closed:1` vs `closed:2`，L163/L322）。`closed` 是合约持久状态，一次性 XOR 闩：
**一旦 close_attest 把 closed 设成 1，cancel_attest 的前置条件永久为假，refund_claim
（要求 closed==2）永远不可达**。这是源码结构直接证明的事实，不是"预期应该 BUST 待验证"，
是"BUST 是这份合约唯一可能的行为，逻辑上不存在别的分支"。

**结论**：不需要新建 unclaimed-winner sweep covenant 机制。post-close 剩余资金的逃生路
= 既有的 `claim` entrypoint 本身（无限期可用）。§6 J1 任务卡里"refund 臂 post-close 探针"
从阻塞项降级——**不需要用真实市场做实弹广播测试**（NWT 红队指出的风险：若假设错了，探针
本身就是那个漏洞的执行，且不该拿有真实未领 winner 的 21/60 个市场试验）。源码分析已经
是零风险、确定性的答案；若仍想要链上层面 belt-and-suspenders 确认，应挑一个**团队完全
控制、零真实资金**的干净测试盘专门构造，非阻塞、非优先。

#### 🟡风险-2：`completed` 判定谓词遗漏"到账但带 error"的情况

§4.1 分流表原写"全部 `received===true`"——不够。丢单点⑤（splice-mismatch）的条目可能
`received===true`（verifyClaimLanded 已确认到账）但**同时带 error**（是到账**之后**的续约
校验失败，不影响这笔钱本身，但意味着链路状态跟 DB 记的下一棒起点对不上）。**修**：完成谓词
改为"全部条目 `received===true` **且无 error 字段**"。回归测试注入 fixture 从两种加到三种：
①全部成功 ②人为注入一次 not-landed(丢单点④) ③人为注入一次 splice-mismatch(丢单点⑤,
received=true 但有 error)——三种都要断言正确分流到 completed / settled_partial_claims。

### 4.4 耦合声明

本设计新增的所有查询点全部复用 `getMarketBets`（`pool-bettor-sides-query.mjs`，已是 shard-aware
helper，5 处已迁移点之一），**不新增裸写 `pool_bettor_sides WHERE market_id =` 的站点**，不落在
线8 那 41 处待迁移雷区里。lint rule `R-SHARD-BLIND` 覆盖，提交前跑 `node scripts/lint-kanet.mjs`。

## 5. 立即动作（不等本设计过审，零风险，已执行）

- ✅ 影子探测器 v2 `scratch/_j2_claim_completeness_shadow_watch.mjs`：只读，不改结算代码，
  90s 轮询新晋 `completed` bshard 市场，tier1(计数缺口)/tier2(曾有到账疑虑 alert) 立即报警。
  已用 Monitor 常驻挂起。**已知限制**：tier2 判定读 `logs/console.log`（当前活跃日志，非全量
  历史），只对本次挂起之后新完成的市场可信；历史市场的权威 tier2 结果以下面的全量重放脚本
  （读完整 `logs/kanet-start.log`）为准。
- ✅ 全量重放脚本 v2 `scratch/_j2_claim_completeness_audit_v2.mjs`：双 fixture 自校验通过后
  才允许跑全量，产出本设计 §2.2 的 tier1/tier2/clean_provisional 三分类。

## 6. NEXT

1. **J1 链上确认（取证不改码，不用等本设计过审）**：
   - tier1+tier2 共 **21 个**市场：走 §4.2 的 resume 算法——链上 walk 每个市场的 continuation
     链到 tip，解码 tip 的 nullifier bitmap 得到权威"谁已领"清单，逐 winner 与 DB
     `claim_txids` 比对，证据格式：
     `{market_id, winner_pk, expected_amount, claim_txid_if_any, chain_confirmed(=bitmap位读出), close_witness_root, db_root_match}`。
     **这一步的产出直接就是 §4.2 resume 算法要的"当前 tip + 已付集合"真实样本，两条线互喂，
     J1 先做这个不是额外工作量，是同一份取证的正面。**
   - `close_witness_root` / `db_root_match`：见 §2.2 必改-4，从 close TX witness 提取
     committed root 跟 DB 存的 `payout_root` 比对。
   - refund 臂 post-close 确认：**已从阻塞项降级**（见 §4.3，源码读出 `closed` 是一次性 XOR
     闩，cancel_attest 要求 `closed==0`，close_attest 已把它设 1 后前置条件永久为假——
     结构上确定不可达，不需要用真实市场做实弹广播）。如仍想 belt-and-suspenders 确认，
     必须挑一个**团队完全控制、零真实资金的干净测试盘**，非阻塞、非优先，不占 21 个疑漏付
     市场的验证资源。
   - 60 个 clean_provisional 做分层抽样链验（按 betCount 规模/分片数分层各抽），不直接采信。
2. 本设计过 NWT 审后落码（§4.1-4.3），非 money-adjacent 部分（影子探测器/重放脚本）已先行。
3. 4 个无法验证市场（ozzeu/pb73v/gp8hy/2ysnl）人工过一遍，确认是 evidence-schema 差异
   而非新的丢单模式。
4. 🔵认识论（暂缓，等链上确认收尾、结论定级后再写）：本次发现的模式拟沉淀进
   `docs/ANTI-PATTERNS.md`——"聚合状态标记（如 `completed`）在写入点没有断言其定义谓词
   （每个成员链上确认），后续所有引用该标记的证据链整体失效"。跟"状态漏注册"类近亲不同族
   （这条是"状态语义无断言"），现在先记一笔，不抢在链验结果之前定性。
