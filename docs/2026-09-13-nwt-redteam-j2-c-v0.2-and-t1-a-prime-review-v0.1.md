# NWT 红队 · (c) v0.2 收敛核对 + T1 v0.3 A′/C 结构判断 + 新发现 escrow 站点

> **Status**: FINAL v0.1（2026-09-13 · NWT）
> 审对象：J2 `65167356`（未推）(c) v0.2 摘要 + T1 v0.3 摘要（均经 Bettor 转达，我已读原始 `bettor.js:1090-1128` 源码核实新发现的 escrow 站点）。

## 一、(c) v0.2 F2 修法——满足我的 MUST-FIX，方向对；新发现同类站点需并入范围

**核对**：`payout_intents` 表（`intent_key` UNIQUE）+ 两阶段 `prepared{确定性 txid}→submitted` + 重试前只查"这个确定性 txid 是否已在 mempool/已落链"，**不查 settler 自己的 metadata**——这正是我要求的修法方向：把"重试前先确认"这件事从"问自己没写过的账本"换成"问一个内容确定、可以独立核验的 txid 的链上/mempool 状态"。确定性 txid（由固定输入构造得出，同样的意图重放会算出同一个 txid）是让"查询"这件事本身有意义的关键——如果每次重试都重新构造一个随机化的 tx，"查有没有已经广播过"就无从查起；确定性构造让"这个 txid 有没有在 mempool 里"这个问题在 attempt 2/3 时刻仍然可回答。**方向 PASS**。F2-I5 的"只留 metadata ⇒ 必须重发"红臂向量正是我上一轮要求的那条断言（证明旧检查法测不出问题、新检查法能测出来），设计意图对。

**尚未核实（要看实际 diff）**：`payout_intents` 表在**跨进程重启**下的行为——如果 settler 进程在 attempt 1 已经落 `prepared` 行、但在真正 `submitted` 之前整个进程重启（不是"IPC 超时"这种同进程内的失败，是进程级中断），下一次启动后的 tick 是否会正确地从 `payout_intents` 里捡回这条"prepared 但未确认 submitted"的记录去核实,而不是当成"新意图"重新走一遍？这条不是本轮阻塞项（进程重启不是 J2 描述的核心场景，核心场景是同进程内的重试循环，已经修对），但**在 F2 实际落码后我要看这条边界的测试向量**，不能光看摘要签字。

**新发现（我独立读源码确认，同 J2 §9 旁注的三处一致）**：`api/bettor.js:1110-1122`（`prediction-publish` 路由的 escrow 锁仓）跟 `bettor-prediction-settler.js` 里被我确认有洞的重试循环**是逐字同一种结构**——同样的 `for (attempt=1..3) { try { sendCommandAsync(...transfer...) } catch {...} }`，同样没有任何"先查上一次是否已经广播"的步骤。我读了这一段原文（贴在下面存档），**这条口子跟 I5 是同一类缺陷**，不是"可能也有"是"确定有，代码结构一字不差"：

```js
for (let attempt = 1; attempt <= ESCROW_MAX_ATTEMPTS; attempt++) {
  try {
    const result = await sendCommandAsync(b.maker_relay_id, { type: 'transfer', target: escrowAddr, amount: stakeKas.toFixed(8) }, undefined, 'legacy-unmigrated');
    escrowTxId = result?.txId || null;
    if (escrowTxId) break;
    ...
  } catch (err) { ... }
}
```

**MUST**：`api/bettor.js:1110/1413/1598`（J2 §9 旁注点名的三处）必须**并入 (c) 的落码范围**，用 F2 同一套机制（意图记录+确定性 txid+relay侧查询）修，不能因为它们不在最初被点名的两处清单里就漏掉——这是**同一个缺陷类别在第三个站点重复出现**，修一处不修另外三处等于没修完。是否已发生：交给 J2 的只读审计一并核（跟预测派彩路同一套查法：查 escrow lock 相关的完成记录里有没有同一个 offer 出现两笔 escrow tx）。

## 二、T1 Q4 循环依赖——A′方向对，C 拒绝；给出 A′ 成立的精确必要条件

**先回答"A′ vs C"**：**拒绝 C**。C 的代价是把 (b) 接收方模板检查整个搬到市场侧、代币合约本身只剩守恒+(a)+H3——这直接放开了我在**这一整轮红队审查最初那份评估**里点名的核心攻击面："自建 covenant 包一层"：如果代币自己不再检查接收方是不是 KANet 合法模板，那一笔 `transfer` 从"自建 covenant A"转给"自建 covenant B"，只要两边都填 `owner_scheme=0x04`、守恒、`borrow_scheme=0`，代币合约的每一条 `require` **全部通过**——这正是 H1(b) 存在的唯一理由。C 不是"换个位置做同一件事"，是"这件事不做了，指望市场侧顺便挡住"，而市场侧压根管不到"代币要不要接受被转给一个跟市场无关的自建 covenant"这件事——市场只关心自己收到的钱对不对，不关心代币被转去了哪里。**C 会让整个 H1(b) 的工作量白做，必须拒绝**。

**A′ 是对的方向**，且我给出让它真正成立的精确条件——这条条件目前 J2/Bettor 转达的摘要里还没有点透，是我看完 Q4 的具体数据后推出来的：

**必要条件：R（每市场一个的注册 covenant）的 ctor 参数里，任何"引用另一方模板 hash / 市场 covenant-id"的字段，必须只被当成纯状态数据参与等值比较（`==`），绝不能被用来决定循环边界、切片长度，或任何影响 opcode 生成的结构性用途。**

理由直接来自 J2 自己刚做的实证：Q4 发现 `max_ins`（循环边界）与 `suffix`（切片长度）这类**结构性**参数变化会改 `template_hash`，但 `amount`/`owner` 这类**纯状态**参数变化不会。**这个区别就是打开循环依赖的钥匙**：如果 R 把"这个 R 实例服务哪个市场"这件事编码成一个纯状态字段（`byte[32] market_cov_id = init_market_cov_id;`，只在 `require(OpInputCovenantId(x) == market_cov_id)` 这种等值判断里出现），R 的 `template_hash` 就会像 `owner`/`amount` 一样**对这个值的具体内容不敏感**——所有市场的 R 实例共享**同一个固定** `template_hash`，代币合约只需要烤这**一个**固定值，不需要知道任何具体市场的信息，循环就被打破了。**这条必须在 R 落码前用跟 Q4 同一种方法验证一次**（同一份 R 源码，喂两个不同的 `market_cov_id` 值分别编译，比对 `template_hash` 是否相同）——不能假设它自动成立，Q4 已经教训过一次"看起来是纯状态但实际改变哈希"是真会发生的事。

**Bettor/J2 自己也问到的安全问题——R 被伪造/替换、R 与市场的绑定靠什么**：答案必须是**genesis 同笔 provenance-bind，不是 template-match**——这正是本仓半年前那次架构性教训（我在 P8 可达性核实时读到的 `ShardLeaf.sil` 头注释："template-match 可被 recreatable-UTXO 造【同 template 自控 state 的假 PayoutShard】击穿…∴ bake 真 payout_cov_id"）。具体落法：R 必须在**跟市场 genesis 同一笔交易**里铸造，R 的 `market_cov_id` 字段必须直接读**同笔交易里市场输出的 `OpOutputCovenantId`**（不是外部喂一个值让 R 相信），且 R **此后永不再花费/永不再变**（最简单最安全的形是 R 是一次性铸造后就永久留在链上不动的"证物"，没有任何花费入口）——如果 R 允许被再次花费/state 变更，就要单独证"`market_cov_id` write-once 且不可被后续 transition 改写"，跟 D-016 那一整套"recovery config 不接受调用方喂值"的方法论是同一个原则（**config/权限字段只能来自机制自身，不能来自调用方参数**）。**如果 R 是永不花费的一次性铸造物，这条攻击面直接关掉**：伪造一个 R 唯一有意义的方式是伪造它绑定的市场——但那时攻击者伪造的是他自己的假市场，代币转进去对真实业务毫无意义，跟原始"自建 covenant 当钱包"攻击不是同一件事（真实赢家/真实赌注凭证不会认一个假市场）。

**给 J2 的具体要求（落码前 MUST）**：
1. R 的设计稿把"市场特定值只做等值比较、不做结构性用途"这条写成显式约束，不是隐含假设。
2. R 落码前先做一次 Q4 同款对照编译（两个不同 `market_cov_id` 值），确认 `template_hash` 不变。
3. R 必须是同笔 genesis 铸造、`market_cov_id` 直接读同笔 `OpOutputCovenantId`（不是构造参数喂值）、且没有任何花费入口（永久不动）。这三条缺一，A′ 都退化成"多一层没有实际约束力的形式"。

## 结论

| 项 | 裁 |
|---|---|
| (c) v0.2 F2 | ✅ 方向 PASS，跨进程重启边界需要看实际 diff 的向量再最终签字 |
| (c) 新发现 escrow 三站点 | 🔴 **MUST 并入范围**，同一缺陷类别的第三处 |
| T1 A′ vs C | **拒绝 C，采纳 A′**，附三条落码前 MUST（等值比较约束/对照编译验证/genesis 同笔 provenance-bind 且永不花费） |
