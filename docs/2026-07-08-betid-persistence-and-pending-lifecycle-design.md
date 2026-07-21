> **Status**: CURRENT

# betId 服务端持久化(#19)+ pendingPayments 生命周期硬化(#10) — 防复发设计

**作者**: J2 · **日期**: 2026-07-08 · **背景**: Martin 孤儿单事故(2笔押注卡在"已付款但未注册", 源头是
tg-bot 的 `betId`/`pendingPayments` 都是纯内存态, 4 次 console 重启期间任一 in-flight 付款窗口都同样会死)。
Owner 钦定"测试网重点是防复发, 不纠结历史沉没成本"——本设计 = #19+#10 的根治方案(不是 Martin 那两笔的救单,
救单走 `adminConfirmByAddress`, 已 GO 落码 commit `2839e5e1`)。

---

## 0. 一句话

**#19 根因**: per-bet 地址推导公式里塞了一个从不持久化的 `randomUUID()`(betId), 一旦持有它的进程(tg-bot,
console 的子进程)重启, 这个值永久丢失, 已经据此付款的用户变成孤儿单。
**#10 根因**: `pollPendingBets()` 只在 5 个显式分支(deadline 过期/linkedAddr 缺失/成功/错付/linkedAddr 错误)
清空 pending 记录, 但**没有任何机制区分"confirm 调用本身失败(网络/RPC/500)"和"confirm 明确说还没收到付款"**
——两者都落进"else 静默继续轮询"分支, 而 in-flight 的付款窗口期间进程重启会让整个 pending 状态(含 betId)
清零, 之后即使 confirm 本该继续轮询也没人在轮询了(不是 pendingPayments 被清空的问题, 是内存态本身不扛重启)。

## 1. 既有资产清单(不重造)

| 需要的东西 | 复用来源 |
|---|---|
| prep/confirm 的 (marketId, bettorPk, direction, betId) → 确定性 payAddr 派生 | `pool.js` `_v07PrepConfirmPrelude`(`get_per_bet_address` relay 命令), 逻辑本身不用改 |
| `pool_bettor_sides` 表(已注册成功的记录, 唯一权威真相源) | 不动, 本设计只补"注册成功前"这段窗口的持久化缺口 |
| `pollPendingBets()` 的 5 个显式清空分支 | `tg-bot/bot.mjs:476-507`, 逻辑保留, 只加"区分瞬态失败 vs 明确未付款"这一层 |
| migrate.js 版本号规则 | 当前最新 v181(见文件尾), 本设计新表走下一个可用版本号(实现时核对, 不在设计里写死避免过时) |

## 2. #19 修法: prep 时服务端持久化 betId

### 2.1 新表 `pool_bet_preps`(建议名, 实现时可调整)

**⚠ 本节 2026-07-08 08:06 已按 NWT 红队意见修正**(初版用 (market,bettorPk,direction) 三元组当 UNIQUE
索引 UPSERT, NWT 抓到这会在"同三元组二次加注、第一笔还没确认"场景把第一笔的 betId/payAddr **覆盖冲掉**——
betId 存在的唯一目的就是解决"同 bettor 同方向允许多笔独立追加下注"的碰撞, 三元组唯一索引恰好摧毁了这个语义,
会重新引入 Martin 案同一个 bug。修正: 唯一性建在 `bet_id` 本身(每笔 prep 都是一条独立记录, 不覆盖), 恢复
时按三元组查"最近若干条未确认记录"而非假设只有一条。)

```sql
CREATE TABLE pool_bet_preps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  logical_market_id TEXT NOT NULL,
  bettor_pk TEXT NOT NULL,
  direction INTEGER NOT NULL,
  bet_id TEXT NOT NULL,
  pay_addr TEXT NOT NULL,
  exact_stake_sompi INTEGER NOT NULL,
  stake_kas REAL NOT NULL,
  confirmed_at INTEGER,           -- NULL = 未确认(仍在途); confirm 成功后回写此列, 非 NULL = 已有归宿
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_pool_bet_preps_betid ON pool_bet_preps(bet_id);
CREATE INDEX idx_pool_bet_preps_triple ON pool_bet_preps(logical_market_id, bettor_pk, direction, confirmed_at);
```

**唯一索引语义(修正后)**: 唯一性建在 `bet_id`(每次 prep 都是一条独立 INSERT, 同一 bet_id 重复 prep 用
`ON CONFLICT(bet_id) DO UPDATE`覆盖同一笔的重算——这是安全的, 因为 bet_id 相同代表调用方明确是"重试同一笔",
不是"追加新一笔")。三元组 (market,bettorPk,direction) 上只建普通索引(非唯一), 允许同一用户同方向存在多条
未确认(confirmed_at IS NULL)记录, 对应"允许无限次追加下注"这个既有语义。

### 2.2 `_v07PrepConfirmPrelude` 落码点(pool.js)

在 `payAddr = perBet.address` 确定之后(`pool.js` prep/confirm 共用的 `_v07PrepConfirmPrelude` 函数内,
`get_per_bet_address` relay 命令返回之后), 加一行:

```js
sqlite.prepare(`
  INSERT INTO pool_bet_preps (logical_market_id, bettor_pk, direction, bet_id, pay_addr, exact_stake_sompi, stake_kas, created_at)
  VALUES (?,?,?,?,?,?,?,?)
  ON CONFLICT(bet_id) DO UPDATE SET
    pay_addr=excluded.pay_addr, exact_stake_sompi=excluded.exact_stake_sompi,
    stake_kas=excluded.stake_kas, created_at=excluded.created_at
`).run(logicalMarketId, bettorPk, v.direction, b.bet_id, payAddr, payAmountSompi, v.stakeAmount / 1e8, Math.floor(Date.now() / 1000));
```

confirm 成功注册后(`pool_bettor_sides` 写入成功那一刻), 补一行:
```js
sqlite.prepare(`UPDATE pool_bet_preps SET confirmed_at = ? WHERE bet_id = ?`).run(Math.floor(Date.now() / 1000), b.bet_id);
```
这样"未确认"(孤儿嫌疑)记录 = `confirmed_at IS NULL` 且超过合理等待窗口(如 deadline 已过或若干分钟无进展)
的行, 恢复/巡检工具按这个条件扫描, 不需要假设"每个三元组只有一条"。

**关键**: 写入这两行的地方分别在 prep/confirm 共用的 prelude 与 confirm 成功分支, 每次调用都独立记录
(不覆盖历史), 幂等安全(同 bet_id 的 UPSERT 只更新自己, 不影响其它 bet_id 的记录)。

### 2.3 恢复路径

console/tg-bot 重启后, 若 `pendingPayments`(内存)里没有某个 tgUser 的记录但 DB 里 `pool_bet_preps` 有
`confirmed_at IS NULL` 的行, 用 (market, bettorPk, direction) 查出**全部**未确认记录(可能不止一条, 见
§2.1 修正)、按各自 `pay_addr` 逐条核实链上是否已有付款(有则用该行的 betId 重建 confirm 请求; 多条都有
付款则每条独立重建, 不假设只处理一条), 重建 `pendingRecord`, 让 `pollPendingBets()` 继续盯这些——**这是
#19 真正根治的效果: betId 不再是"用完就扔的一次性随机数", 而是有服务端存根可查的确定性映射输入, 且支持
同一用户同方向存在多笔独立在途记录这个既有语义**。

### 2.4 是否要移除 randomUUID, 改用确定性 betId?

**本设计不做这一步**(J1 曾提出的更彻底方案: betId 本身也确定性推导, 而非随机)。理由: `betId` 的存在意义
是"同一用户同一方向的第 N 笔独立追加下注需要不同的 payAddr"(允许无限次加注), 若改成确定性推导(比如按
`(market,bettor,dir)` 的历史下注计数生成), 需要额外一个"我这是第几笔"的计数器状态, 复杂度不降反升。
**持久化随机值**(本设计方案)比**消除随机性**更简单、风险更低, 是本次的选择。

## 3. #10 修法: pendingPayments 生命周期 + pollPendingBets 分支硬化

### 3.1 问题精确定位(读 `bot.mjs:476-507`, 非猜测)

现有 5 个分支(deadline 过期/linkedAddr 缺失/成功/错付/linkedAddr 硬错误)之外, **任何 confirm 调用本身的
瞬态失败(网络超时/RPC 503/500 内部错误)都会落进最后的隐式 `else`(505 行注释"payment not yet detected —
keep polling silently")**——这条注释本身就是不准确的: 它假设"不是以上4种情况 = 还没收到付款", 但实际上
"RPC 挂了/confirm 500"也会落进这里, 被误判成"正常还没付款, 继续等", 这是静默吞错(跟今晚 daemon 错误处理
审计抓到的同一族问题)。

**这不直接解释 Martin 案的清空**(Martin 案更可能是重启把内存态整个清零, 不是这条 else 分支的问题), 但
这条分支本身是独立的、该修的缺陷, 一并处理。

### 3.2 修法

```js
// bot.mjs pollPendingBets() 改动:
const r = await api.poolRegisterConfirm(...);
const j = r.json || {};
if (r.ok && (j.registered || j.already_registered || ...)) { /* 不变 */ }
else if (j.wrong_payment_detected) { /* 不变 */ }
else if (!r.ok && typeof j.error === 'string' && /linked.addr|linkedAddr/i.test(j.error)) { /* 不变 */ }
else if (j.pending === true) {
  // 明确的"还没收到付款"信号(confirm 自己说的), 继续静默轮询——这是唯一该走"什么都不做"的分支。
}
else {
  // 兜底: 既不是明确的4种已知结局, 也不是明确的"pending"信号——是未分类的失败(RPC超时/500/网络错误等)。
  // 不静默吞: 计一次失败次数, 连续失败超阈值(如10次=30s@3s轮询)才升级通知用户+记日志, 避免瞬态抖动误报,
  // 但也不让"看起来像还在等付款"的状态无限期掩盖真实故障。
  p._failCount = (p._failCount || 0) + 1;
  if (p._failCount > 10) {
    console.warn(`[pollPendingBets] ${p.tgUser} confirm持续失败(${p._failCount}次): ${JSON.stringify(j).slice(0,200)}`);
    // 不清空pending(钱还没处理完, 继续尝试), 但用户可见提示 + 日志可查, 不是纯静默。
  }
}
```

**核心改动**: 区分"confirm 明确返回 `pending:true`(还没收到付款, 这是正常态)"和"confirm 调用本身没有
返回预期结果(未分类失败)"——前者继续默默等待是对的, 后者需要计数+超阈值告警, 不能都用同一句"继续轮询"
糊弄过去。

### 3.3 pendingPayments 生命周期收紧(NWT 提的"生命周期 bug")

审计所有 `pendingPayments.delete/clear` 调用点(`prediction-menu.mjs:532/536/852/857`), 确认每一处删除前
是否都有对应的"这笔钱的归宿已经确定"(注册成功/退款/用户主动放弃/明确错付)——**如果发现有任何删除路径
是"因为进程重启/异常退出而不是因为归宿确定"而触发的, 那条路径本身就是 bug, 需要要么改成不删除(留给下次
poll 用持久化的 betId 重建), 要么在删除前先做一次 #19 的 pool_bet_preps 反查确认"这笔真的没有对应的
prep 记录了"才安全删除。**这条需要实现时逐个调用点核实, 本设计先立框架, 具体每个删除点的处置留实现阶段
逐条过一遍(不在设计阶段猜测哪个是 bug 哪个不是)。**

## 4. 验收标准

1. 单元测试: 对同一 (market, bettorPk, direction) 连续两次 prep(不同 betId 参数), `pool_bet_preps` 表
   只保留最新一条(UPSERT 语义验证)。
2. 集成测试: 模拟"prep 后立即重启进程(清空内存 pendingPayments)→ 用 pool_bet_preps 反查恢复 betId →
   confirm 用恢复的 betId 成功注册"全流程走通。
3. `pollPendingBets` 新分支: 模拟 confirm 返回非 200/非 pending:true 的响应, 验证连续 10 次触发告警,
   且不清空 pending(钱继续被追踪, 不是放弃)。

## 5. 范围边界(诚实标注)

- 本设计**不救 Martin 现有的两笔孤儿单**(那条走 `adminConfirmByAddress`, 已完成)。
- 本设计**不改变 betId 随机性本身**(§2.4 已论证为何不做)。
- pendingPayments 生命周期收紧(§3.3)的具体删除点核实**留实现阶段**, 设计阶段只提出框架和判断标准。

## 6. 签字区

- J2(设计): ✅ 2026-07-08
- NWT(红队): 待
- Bettor(GO): 待
