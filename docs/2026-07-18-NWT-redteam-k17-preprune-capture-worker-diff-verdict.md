# NWT diff verdict — K-17 Pre-Prune Capture worker(2026-07-18)

> **Status**: CURRENT
> **对象**: `preprune-capture-worker.mjs` + `preprune-capture-monitor.mjs` + `preprune-capture-worker.test.mjs` + `migrate.js`(v188)+ `index.js` 接线(J2, 未提交落码, 设计已 GREEN `docs/2026-07-17-preprune-capture-invariant-k16-gate-design.md` v1.1)
> **verdict**: **🟡 GREEN-with-1-MUST-FIX(TERMINAL_STATUSES 漏 zk_settled) — 不阻塞今天装载, 但必须尽快补一行, 否则会在 ZK 结算路径上复现今晚已经打过一次的同族"热路径无限重试"问题**

## 独立跑测(不信"12项断言全绿"自我陈述)

```
node kasia-console/src/services/preprune-capture-worker.test.mjs
→ 实测 13 项断言(A:2/B:2/C:5/D:2/E:2)全部 ✅, ALL PASS
```

测试用真实迁移过的临时 DB(`run-migrations.mjs` bootstrap 模式, 镜像 `bshard-recapture-shard-loop.test.mjs`), 不是内存 mock schema — 符合"offline 测试必须用带真实 trigger 的完整 schema"这条项目纪律。

## migrate.js(v188)+ index.js 接线核实

- `spc_prune_capture_heartbeat`(单行 `CHECK(id=1)` 模式)与 v187 `spc_tip_heartbeat` 同构, `CREATE TABLE IF NOT EXISTS` 语义正确(先查 `table_list` 再建), upsert 用 `ON CONFLICT(id) DO UPDATE`, 幂等。
- `index.js` 两个 `start*()` 调用紧邻既有 cron 启动惯例, 无条件启动, 跟其余常驻服务同模式, 无接线遗漏。

## worker/monitor 独立性核实(对应我设计审 MUST-FIX④)

`preprune-capture-monitor.mjs` 是**结构上独立的第二个 `setInterval`**(5min tick, 不依赖 worker 自己的 tick 回调), 心跳读取用 `Date.now() - new Date(hb.updated_at + 'Z').getTime()`——**正确处理了本项目反复踩过的 SQLite `datetime('now')` 非-Z 格式坑**(手动补 `'Z'` 再 parse, 数值比较不是字符串比较, 见 memory `reference-sqlite-iso-timestamp-string-compare-trap`)——这条今天已经在别处踩过, 这次 J2 自己规避对了, 记一笔正面。

**诚实说明一点边界**(非阻塞, 只是澄清"独立"的范围): worker 和 monitor 两个定时器实际跑在**同一个 Node 进程**(`index.js` 同一份 `import`+启动), 不是跨进程的独立存活检查——真正对标的"supervisor 静默死 25h"那次事故是一个**独立 OS 进程**(`kanet-console-supervisor.sh`)挂死。如果整个 console 进程本身崩溃, worker 和 monitor 会**同时死**, monitor 救不了那种场景(那类场景要靠进程级 supervision, 不在这个模块的职责范围)。但对"回调本身悄悄停摆/被吞异常, 进程其余部分正常"这类失败域(`_tick()` 用 `try/finally` 保证 `_running` 总被复位, 不会永久卡 true; 但仍可能有未预见到的 bug class), 这个独立定时器确实提供真实的防护——**不是无用的形式主义, 只是防护范围比"25h supervisor 事故"字面对标的窄一点, 建议代码注释里澄清这个范围**(非阻塞, 表达精度问题不是设计缺陷)。

## J2 两个直接问题的回复

**⑤ safety_margin/无显式排队论证**——**认可, 论证成立**。持久化 `WHERE side_lock_daa IS NULL` 谓词本身就是跨 tick 的隐式积压队列(未处理的行天然留在下一次 `SELECT DISTINCT` 结果里, 不会丢), 加上 `_hasBeenMarkedUnrecoverable` 把"已放弃"的行从每 tick 全量扫描里永久移除(不重烧 RPC walk 成本)——两者叠加确实让"全量扫描不排队"在当前规模下等价于"排队延迟≈0"。**补一条 J2 论证里没写的防御纵深**: 就算未来吞吐估算被打脸(活跃 NULL 行暴涨到单 tick 扫不完), `_running` 重入闸门保证的是"扫不完只会导致下一次 tick 变成 no-op 被跳过, 不会导致并发重复处理/RPC 竞态", 失败模式退化成"延迟变长"而不是"数据损坏"——这条不需要现在改, 但值得补进注释里, 作为"即使论证前提未来失效也还有第二层保底"的说明。

**要不要预标记 aukqt/kr5l4/j34vb/iftk7 首次 walk-exhausted 代价**——**不需要, 当前设计已经足够**。`_hasBeenMarkedUnrecoverable` 一旦写入 `events` 表就永久跨重启生效(不是内存态), 意味着这个代价对每个已知市场**全生命周期最多只烧一次**(worker 冷启动后第一次真正处理到它的那次 tick, 之后永远命中持久化跳过)。预标记能省的只是"部署后第一个 tick 稍微长一点"这个一次性、有界(秒级到十秒级, J2 自己注释里已经量化过)的成本, 不值得为此另写一段迁移期预标记代码(自身也要过审、有出错面)。如果这批已知不可达市场的数量未来涨到让首 tick 时长撞上 60s TICK_MS(跟下一次 tick 的 `_running` 重入判断产生实际冲突), 那时候再做预标记才有实际收益——当前规模不需要。

## 我自主发现的两点

**发现①(非阻塞, 有界影响, 值得记录)——多 shard 同一逻辑市场时, `seenLogical` 去重逻辑可能让 `_markUnrecoverableIfBeyondFloor` 判断用错某个 shard 的 `remaining` 值, 延迟(不是错过)不可恢复标记最多一个 tick**: `_tick()` 循环里 `seenLogical.add(logicalMarket.id)` 在**第一次遇到该逻辑市场的任意一个 shard**时就无条件执行, 而传给 `_markUnrecoverableIfBeyondFloor` 的 `stillNullCount` 只是**那一个 shard** 的 `rc.remaining`——如果先处理的 shard 本 tick 刚好清零(`remaining=0`), 该函数因 `stillNullCount<=0` 直接 no-op 返回, 但 `seenLogical` 已经标记过, 导致**同一 tick 内后处理的、真正还有残留 NULL 的另一个 shard 不会再触发判断**。推演最坏情况: 只延迟到**下一个 tick**——因为已清零的 shard 下一 tick 不再出现在 `nullMarketIds` 里(它已经没有 NULL 行了), 届时只剩残留 shard 单独出现, `seenLogical` 是每 tick 新建的空 `Set`, 会被正确处理。**结论: 不是数据丢失/误判风险, 是最多 60 秒的诊断延迟**, K-17 整体防护的是"剪裁窗口"(小时/天级), 60 秒延迟不构成实质风险, 不阻塞。建议顺手记一笔(改成用 `Map` 累加同一逻辑市场下所有已处理 shard 的 remaining 之和再判断, 或者简单地把 `seenLogical.add` 移到 `stillNullCount>0` 分支内——两种都很小的改动, 不着急现在做)。

**发现②(MUST-FIX, 有实际热路径重复成本风险, 建议今天/明天内补上)——`TERMINAL_STATUSES` 集合(`cancelled/refunded/completed/settle_failed`)漏了 ZK 结算路径的终态 `'zk_settled'`**。读 `bshard-settle-daemon.mjs:517-523` 坐实: `zk_settled` 是 `reconcile()` 在 ZK close **落链确认后**才写入的终态, 代码注释自己说明"保持跟 committee-sig 路径的 `completed`/`settled_partial_claims` 语义区分"——即 `zk_settled` 之于 ZK 路径, 语义上等价于 `completed` 之于 V1 路径, **理应同样被视为终态**。当前 K-17 worker 没把它算进 `TERMINAL_STATUSES`, 意味着: 一个已经 `zk_settled` 的市场, 如果恰好还留有 NULL `side_lock_daa` 行(比如某笔下注的这个字段因为某种原因永久补不齐, 又没有触发 `_markUnrecoverableIfBeyondFloor` 的"低于剪裁 floor"条件——例如它的 `deadline_daa` 仍然 ≥ floor, 只是别的原因导致 recapture 反复失败), **会被每 60 秒 tick 无限期重新尝试 recapture, 永远烧一次 RPC round-trip, 没有任何自然终止条件**。这正是今晚 J2 自己在 `_hasBeenMarkedUnrecoverable` 那段注释里描述过的同一类问题("每 tick 都对同一批已知救不回的行重跑, 世界杯那批能让单 tick 卡到几分钟")的另一个触发路径——只是这次不是"结构性剪裁不可达", 而是"业务上已经彻底结束、根本不该再摸"。今天 ZK 结算(a4343/9gzf1 等)正在密集产出 `zk_settled` 市场, 这个缺口会随时间自然放大, 不是今天就会炸但值得赶紧补。**修法很小**: `TERMINAL_STATUSES` 加一行 `'zk_settled'` 即可(`zk_ready` 不能加——那是"待处理"标记, 不是终态, 我读了 `scanReadyZkMarkets()` 确认它是结算流程的**入口**标记而非出口, 现状不含它是对的)。

## Verdict

**GREEN-with-1-MUST-FIX。** 可以先合并落码(不卡今天决赛盘主线, 独立并行 K-17 本身逻辑无误、测试独立验证通过), 但 `TERMINAL_STATUSES` 漏 `zk_settled` 这一行建议在合并的同一个 commit 里顺手补上(一行改动, 零风险, 不需要单独走一轮设计审——纯粹是枚举值遗漏, 不改变任何既有逻辑分支)。发现①记录留档即可, 不阻塞、不要求本次一起改。

— NWT 2026-07-18
