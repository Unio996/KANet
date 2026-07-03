# bshard 结算 Operator Runbook（G6，一页版，2026-07-04）

> 世界杯上线值守用。遇到市场卡在非终态 / daemon 报警时照此查，不确定就先只读排查，不要碰 protocol_status。

## 1. 先看 daemon 是不是活的

```
grep "\[settle-daemon\]" logs/console.log | tail -20
```
- 正常：每 60s（`TICK_MS`）打一行 tick，ripe 市场出现时打 `settling xxxxxxxx betCount=N shards=M`。
- 长时间没日志 → console 进程可能挂了，查 `SETTLE_DAEMON_ENABLED=1` 是否还在 `kanet.env`，console 是否活着。

## 2. 市场状态速查表

| protocol_status | 含义 | 需要人管吗 |
|---|---|---|
| `pending_bettors` | 还在接受押注，deadline 未到 | 不用 |
| `verifying` | deadline 已过，daemon 会自动 ripe 扫到 | 不用（等 tick） |
| `completed` | **每个 winner 都链上确认到账**（#33 修后的真不变量） | 不用 |
| `settled_partial_claims` | close 成功但部分 winner 没领到（#33 发现的历史 bug 类）| **是**——见 §3 |
| `needs_manual_attribution` | claim 时数据/编码问题（climb-fail/round-trip-fail），非时序问题 | **是**——需要人工看具体哪个 winner，重试没用 |
| `settle_failed` | 结算失败（含 ABSTAIN/build-fail/enforce-mismatch 等），已过 G5-5a 白名单重试 3 次 | **是**——见 §4 |
| `needs_rolling` | winner 数 > 1024，超出 payoutRoot depth-10 上限 | 上报，等 rolling payout-shard（task#18，未实现）|

## 3. 遇到 `settled_partial_claims`

- **别慌，钱在链上安全**：`PayoutShard.claim` 无 deadline，`refund_claim` 被 `require(closed==0)` 写死堵死（close 后永不可达）——不存在"过期丢失"或"退款臂偷跑"风险。
- 当前（2026-07-04）**没有自动补付机制**——§4.2 的 resume 引擎排在 #21-5b，未落地。
- 手动排查：查 `metadata.settle_evidence.unpaid_count` / `unpaid_total_sompi`（backfill 过的 20 盘有这两个字段）。
- 不要手动改 `protocol_status` 掩盖问题——这正是 #33 这次 bug 的根因模式（聚合状态标记没断言真谓词）。

## 4. 遇到 `settle_failed`

先查是哪一类（`logs/console.log` grep 该市场后 8 位 ID 的 `ALERT` 行）：
- **`UMA judge ABSTAIN`**：oracle 数据源拿不到判定（往往是 UMA 还没 resolve）。当前**没有自动 re-judge**——G7 扫描是一次性诊断脚本，不是常驻。人工确认权威源已 resolve 后需要手动触发重判（问 Bettor/NWT 当前有没有落地的 re-judge 入口）。
- **`>1024 winners`**：走 §2 的 `needs_rolling`，非此类。
- **其它（build-fail/submit-fail/not-landed 等）**：这些已经过 G5-5a 的 3 次退避重试还失败，说明问题比瞬时更持久（比如 payout_shards 行缺失、redeem hex 缺失）——需要读该市场的具体 ALERT 详情，不要盲目重跑。

## 5. 常用查询

```sql
-- 当前各状态分布
SELECT protocol_status, COUNT(*) FROM pool_markets WHERE protocol_version='v0.7' GROUP BY protocol_status;

-- 某市场的详细 evidence
SELECT metadata FROM pool_markets WHERE id = '<market_id>';
```

```
GET /api/system/canary-stats   -- 近7天 settle% (排除 0-bet)，> 80% = 门槛过
```

## 6. 铁律（别在值守时忘）

- **NO TX NO STATE**：任何"看起来卡住"的市场，先查链上真相（UTXO/close TX 是否 landed），不要信 DB 字段就动手。
- **别手动 UPDATE protocol_status 掩盖问题**——除非有链上证据支撑（如本次 #33 backfill 那样，链验先行、Bettor+NWT 双签后才改）。
- **有阻塞立即报 Bettor**，别自己憋着猜。
